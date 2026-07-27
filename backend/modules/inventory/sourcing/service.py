# backend/modules/inventory/sourcing/service.py
"""
Service layer for Product Sourcing - Business logic and calculations
"""
import hashlib
import logging
import re
from typing import List, Dict, Optional, Any, Tuple
from datetime import datetime
from decimal import Decimal

from common.currency import get_exchange_rates, convert_to_gbp
from .repository import SourcingRepository
from .gsheets_service import GSheetsService

logger = logging.getLogger(__name__)


class PdfParseCancelled(Exception):
    """Raised to cooperatively abort PDF parsing when the client disconnects."""


# Percentage band the merge phase occupies on the import progress bar. The parse
# that follows reports from MERGE_PROGRESS_END to 100 (see import_matrix_pdf's
# progress_floor), so the bar advances smoothly across both phases.
MERGE_PROGRESS_END = 8

# Baseline "nothing detected" supplier-identification result — what detection
# degrades to when the AI is disabled, the PDF is unreadable, or no match found.
_IDENTIFY_EMPTY = {
    'enabled': False,
    'detected_name': None,
    'matched_supplier_id': None,
    'matched_supplier_name': None,
    'confidence': 0.0,
}

# Max documents identified per AI request in the multi-file importer. Each
# document contributes ONE page (its first) to a bundled PDF sent in a single
# multimodal call, so this also caps pages-per-call. One request handles the
# common case; larger uploads split into a few calls so a single request never
# gets unwieldy — without reintroducing the per-file rate-limit bursts that made
# one-call-per-file detection slow and inconsistent.
_IDENTIFY_PAGES_PER_CALL = 15


def dedupe_pdf_blobs(pdf_blobs: List[bytes]) -> Tuple[List[bytes], int]:
    """Drop empty and byte-for-byte identical PDF uploads, keeping first-seen order.

    Two files with the same SHA-256 of their raw bytes are guaranteed to have
    identical content, so re-parsing the second is pure waste — extra pages in
    the merged document mean extra AI work and tokens for no new pricing data.
    We dedupe up front, before merging/parsing, so the cost is paid once per
    distinct document regardless of how many times the user attaches it.

    Returns ``(unique_blobs, duplicates_skipped)`` where ``duplicates_skipped``
    counts the non-empty blobs dropped as exact duplicates (empties are not
    counted as duplicates — they were never usable).
    """
    seen = set()
    unique: List[bytes] = []
    skipped = 0
    for blob in pdf_blobs:
        if not blob:
            continue
        digest = hashlib.sha256(blob).digest()
        if digest in seen:
            skipped += 1
            continue
        seen.add(digest)
        unique.append(blob)
    return unique, skipped


def merge_pdfs(pdf_blobs: List[bytes], progress_cb=None) -> bytes:
    """Stitch several uploaded PDF blobs into one PDF, preserving their order.

    The importer parses a price list as a single document — and the parser (AI
    or deterministic) already treats a multi-page file as several documents
    merged together, dating each page on its own. So when the user uploads more
    than one PDF we merge them here, up front, rather than parsing each
    separately (which would multiply AI calls and lose cross-document conflict
    resolution).

    ``progress_cb(percent, message)`` (optional) is invoked per source file so
    the user sees the merge happening before parsing starts; merge progress
    occupies 1..MERGE_PROGRESS_END%. A PdfParseCancelled raised by the callback
    propagates (cooperative cancel); any other callback error is swallowed.

    Empty blobs are skipped and byte-for-byte identical uploads are deduped (see
    dedupe_pdf_blobs) so the same document isn't parsed twice. A single
    (remaining) blob is returned unchanged (no re-encode, no progress — the parse
    phase reports from 0). Raises ``ValueError`` if nothing usable was supplied or
    a blob isn't a readable PDF, so the API surfaces a 400 rather than a 500.
    """
    import io
    import pypdfium2 as pdfium

    def _report(percent: int, message: str) -> None:
        if progress_cb:
            try:
                progress_cb(percent, message)
            except PdfParseCancelled:
                raise  # cooperative cancellation must abort the merge
            except Exception:
                pass  # progress errors must never break the merge

    blobs, skipped = dedupe_pdf_blobs(pdf_blobs)
    if not blobs:
        raise ValueError("No PDF files provided")
    if skipped:
        logger.info("Skipped %d duplicate PDF upload(s) before merge", skipped)
    if len(blobs) == 1:
        return blobs[0]

    total = len(blobs)
    merged = pdfium.PdfDocument.new()
    sources = []
    try:
        for i, blob in enumerate(blobs):
            _report(1 + int((i / total) * (MERGE_PROGRESS_END - 1)),
                    f"Merging PDF {i + 1} of {total}…")
            try:
                src = pdfium.PdfDocument(blob)
            except Exception as e:  # noqa: BLE001 — corrupt/non-PDF upload
                raise ValueError(f"Could not read one of the PDF files: {e}") from e
            sources.append(src)
            merged.import_pages(src)
        _report(MERGE_PROGRESS_END, f"Merged {total} PDFs — reading…")
        buf = io.BytesIO()
        merged.save(buf)
        return buf.getvalue()
    finally:
        # import_pages copies pages into `merged`, and save() has already run by
        # the time finally executes, so it is safe to release every handle here.
        for src in sources:
            src.close()
        merged.close()


def _merge_first_pages(chunk: List[Tuple[int, bytes]]) -> Tuple[Optional[bytes], List[int]]:
    """Bundle the FIRST PAGE of each file in ``chunk`` into one PDF for a single
    multimodal supplier-detection call.

    ``chunk`` is ``[(file_index, pdf_bytes), ...]``. Returns
    ``(merged_pdf_bytes, page_map)`` where ``page_map[k]`` is the original
    ``file_index`` that produced the merged PDF's (k+1)-th page — so the caller
    can map the model's per-page answers back to files. Files that are empty,
    unreadable, or have no pages are skipped (they simply won't appear in
    page_map). Returns ``(None, [])`` when nothing usable remained.
    """
    import io
    import pypdfium2 as pdfium

    merged = pdfium.PdfDocument.new()
    sources = []
    page_map: List[int] = []
    try:
        for file_index, blob in chunk:
            if not blob:
                continue
            try:
                src = pdfium.PdfDocument(blob)
                if len(src) == 0:
                    src.close()
                    continue
                sources.append(src)
                merged.import_pages(src, [0])  # first page only — keeps tokens low
            except Exception as e:  # noqa: BLE001 — a bad file must not break detection
                logger.info("identify_pdf_suppliers: skipping unreadable file: %s", e)
                continue
            page_map.append(file_index)
        if not page_map:
            return None, []
        buf = io.BytesIO()
        merged.save(buf)
        return buf.getvalue(), page_map
    finally:
        for src in sources:
            src.close()
        merged.close()


class SourcingService:
    """Business logic for sourcing operations"""

    def __init__(self):
        self.repo = SourcingRepository()
        self.gsheets = GSheetsService()

    # ========================================================================
    # TABLE MANAGEMENT
    # ========================================================================

    def ensure_tables(self):
        """Ensure sourcing tables exist"""
        return self.repo.init_tables()

    def check_tables_status(self) -> Dict[str, bool]:
        """Check status of sourcing tables"""
        return self.repo.check_tables_status()

    # ========================================================================
    # FX RATES
    # ========================================================================

    def get_fx_rates(self) -> Dict[str, Any]:
        """
        Get combined FX rates (live + overrides)
        Returns rates relative to GBP (base currency)
        """
        try:
            # Get live rates from API
            live_rates = get_exchange_rates()
            
            # Get manual overrides
            overrides = self.repo.get_fx_overrides()
            
            # Merge (overrides take precedence)
            combined = {**live_rates, **overrides}
            
            # Ensure GBP is always 1.0
            combined['GBP'] = 1.0
            
            return {
                'base_currency': 'GBP',
                'rates': combined,
                'overrides': list(overrides.keys()),
                'last_updated': datetime.now().isoformat(),
                'source': 'api+overrides' if overrides else 'api'
            }
        except Exception as e:
            logger.error(f"Error getting FX rates: {e}")
            raise

    def set_fx_override(self, currency_code: str, rate: float, notes: str = None, user: str = None) -> Dict:
        """Set a manual FX rate override"""
        return self.repo.upsert_fx_override(currency_code, rate, notes, user)

    def remove_fx_override(self, currency_code: str) -> bool:
        """Remove FX override (revert to live rate)"""
        return self.repo.delete_fx_override(currency_code)

    def normalize_price_to_gbp(self, price: float, currency: str) -> float:
        """Convert a price to GBP using current rates.

        Single-shot convenience for one-off callers. Each call reads the FX
        overrides (a DB query) and may hit the live-rate API, so do NOT call it
        in a loop — use :meth:`_build_gbp_normalizer` for bulk work instead.
        """
        if not price or currency == 'GBP':
            return price

        # First check for overrides
        overrides = self.repo.get_fx_overrides()
        if currency in overrides:
            return round(price / overrides[currency], 2)

        # Fall back to live conversion
        return convert_to_gbp(price, currency)

    def _build_gbp_normalizer(self):
        """Return a ``price, currency -> GBP`` converter that reads FX data once.

        :meth:`normalize_price_to_gbp` re-queries ``sourcing_fx_overrides`` (and
        can call the live-rate API) on every invocation. The matrix and analysis
        builders normalize one price per supplier row, so calling it in the loop
        fired hundreds of separate DB round trips — negligible when the backend
        sits next to the DB, but the dominant cost when the DB is remote (e.g. a
        localhost dev server talking to the hosted database). Fetch the overrides
        and live rates a single time here and close over them so each row does
        pure in-memory arithmetic.
        """
        overrides = self.repo.get_fx_overrides()  # {CODE: rate} — one query
        try:
            live_rates = get_exchange_rates()  # cached ~1h; one API call at most
        except Exception as e:  # noqa: BLE001 — never let FX fetch break the view
            logger.warning(f"Could not load live FX rates, using overrides only: {e}")
            live_rates = {}

        def normalize(price, currency):
            if not price or not currency:
                return price
            code = currency.upper().strip()
            if code == 'GBP':
                return float(price) if isinstance(price, Decimal) else price
            # Overrides win over live rates (mirrors normalize_price_to_gbp).
            rate = overrides.get(code) or live_rates.get(code)
            if not rate:
                return float(price) if isinstance(price, Decimal) else price
            amount = price if isinstance(price, Decimal) else Decimal(str(price))
            return round(float(amount / Decimal(str(rate))), 2)

        return normalize

    # ========================================================================
    # SUPPLIERS
    # ========================================================================

    def get_suppliers(self, active_only: bool = True) -> List[Dict]:
        """Get all suppliers"""
        self.ensure_tables()
        return self.repo.get_suppliers(active_only)

    def get_supplier(self, supplier_id: int) -> Optional[Dict]:
        """Get supplier by ID"""
        return self.repo.get_supplier_by_id(supplier_id)

    def create_supplier(self, data: Dict) -> Dict:
        """Create new supplier"""
        self.ensure_tables()
        
        # Check for duplicate code
        existing = self.repo.get_supplier_by_code(data['code'])
        if existing:
            raise ValueError(f"Supplier with code '{data['code']}' already exists")
        
        return self.repo.create_supplier(data)

    def update_supplier(self, supplier_id: int, data: Dict) -> Dict:
        """Update existing supplier"""
        existing = self.repo.get_supplier_by_id(supplier_id)
        if not existing:
            raise ValueError(f"Supplier {supplier_id} not found")
        
        # Check for duplicate code if changing
        if 'code' in data and data['code'] != existing['code']:
            code_check = self.repo.get_supplier_by_code(data['code'])
            if code_check:
                raise ValueError(f"Supplier with code '{data['code']}' already exists")
        
        return self.repo.update_supplier(supplier_id, data)

    def delete_supplier(self, supplier_id: int) -> bool:
        """Delete supplier and all their pricing"""
        return self.repo.delete_supplier(supplier_id)

    # ========================================================================
    # SUPPLIER PRICING
    # ========================================================================

    def get_pricing_for_sku(self, sku: str, normalize: bool = True) -> List[Dict]:
        """Get all supplier pricing for a SKU with optional normalization"""
        pricing = self.repo.get_pricing_for_sku(sku)
        
        if normalize:
            for entry in pricing:
                entry['normalized_price_gbp'] = self.normalize_price_to_gbp(
                    entry['unit_price'], 
                    entry['currency']
                )
        
        return pricing

    def upsert_pricing(self, data: Dict) -> Dict:
        """Create or update supplier pricing"""
        self.ensure_tables()
        
        # Validate supplier exists
        supplier = self.repo.get_supplier_by_id(data['supplier_id'])
        if not supplier:
            raise ValueError(f"Supplier {data['supplier_id']} not found")
        
        # Apply supplier's default currency if not specified
        if not data.get('currency'):
            data['currency'] = supplier.get('default_currency', 'GBP')
        
        result = self.repo.upsert_pricing(data)
        
        # Add normalized price
        result['normalized_price_gbp'] = self.normalize_price_to_gbp(
            result['unit_price'],
            result['currency']
        )
        
        return result

    def delete_pricing(self, sku: str, supplier_id: int) -> bool:
        """Delete a pricing entry"""
        return self.repo.delete_pricing(sku, supplier_id)

    def bulk_upsert_pricing(self, entries: List[Dict]) -> Dict:
        """Bulk update pricing from matrix view"""
        self.ensure_tables()
        
        # Build supplier lookup for default currencies
        supplier_ids = set(e['supplier_id'] for e in entries)
        supplier_map = {}
        for sid in supplier_ids:
            supplier = self.repo.get_supplier_by_id(sid)
            if not supplier:
                raise ValueError(f"Supplier {sid} not found")
            supplier_map[sid] = supplier
        
        # Apply supplier's default currency if not specified
        for entry in entries:
            if not entry.get('currency'):
                supplier = supplier_map.get(entry['supplier_id'])
                entry['currency'] = supplier.get('default_currency', 'GBP') if supplier else 'GBP'
        
        count = self.repo.bulk_upsert_pricing(entries)
        return {'updated': count}

    # ========================================================================
    # SUPPLIER MATRIX
    # ========================================================================

    # Sort columns that live directly on inventory_metadata, so the paginated
    # fast path can order and slice the index without hydrating every price.
    # Anything else (magento_price, best_price, or a supplier-code column) needs
    # the fully-computed set to sort correctly and falls back to _get_matrix_full.
    _INDEX_SORTABLE = frozenset({None, '', 'sku', 'product_name', 'status', 'brand'})

    def get_supplier_matrix(
        self,
        skus: List[str] = None,
        include_magento: bool = True,
        status_filter: List[str] = None,
        search: str = None,
        page: int = 1,
        per_page: int = 100,
        sort_by: str = None,
        sort_order: str = "asc"
    ) -> Dict[str, Any]:
        """Get one page of the supplier matrix (products from inventory_metadata,
        supplier pricing overlaid).

        Dispatches between two implementations that return the identical shape:

        * ``_get_matrix_paginated`` (fast) — used for the default view, search and
          the SKU/product/status sorts. It searches, sorts and paginates a
          lightweight product index in the DB/memory, then hydrates Magento and
          supplier prices for only the current page's ~``per_page`` SKUs. This is
          what makes the page load quickly against a remote database.
        * ``_get_matrix_full`` (fallback) — used when sorting by a computed column
          (Magento price or a supplier's price), which can only be ordered once
          every row's prices are known. Same behaviour as before this change.

        ``skus`` still forces the full path (targeted lookups are already cheap).
        """
        self.ensure_tables()

        suppliers = self.repo.get_suppliers(active_only=True)
        supplier_codes = {s['code'] for s in suppliers}

        use_fast_path = (
            skus is None
            and sort_by in self._INDEX_SORTABLE
            and sort_by not in supplier_codes
        )

        if use_fast_path:
            return self._get_matrix_paginated(
                suppliers=suppliers,
                status_filter=status_filter,
                search=search,
                include_magento=include_magento,
                page=page,
                per_page=per_page,
                sort_by=sort_by,
                sort_order=sort_order,
            )

        return self._get_matrix_full(
            suppliers=suppliers,
            skus=skus,
            include_magento=include_magento,
            status_filter=status_filter,
            search=search,
            page=page,
            per_page=per_page,
            sort_by=sort_by,
            sort_order=sort_order,
        )

    def _matrix_supplier_cell(self, row: Dict, normalize) -> Dict[str, Any]:
        """Build one supplier cell for the matrix from a pricing row."""
        return {
            'supplier_id': row['supplier_id'],
            'supplier_code': row['supplier_code'],
            'supplier_name': row['supplier_name'],
            'unit_price': float(row['unit_price']) if row['unit_price'] else None,
            'currency': row['currency'],
            'normalized_price_gbp': normalize(row['unit_price'], row['currency']),
            'moq': row['moq'],
            'shipping_cost': float(row['shipping_cost']) if row['shipping_cost'] else None,
            'is_preferred': row['is_preferred'],
            'last_verified': row['last_verified'].isoformat() if row['last_verified'] else None,
            # When this supplier's price for this SKU was last set/changed
            # (UTC ISO; None for legacy rows with no recorded date → "N/A").
            'price_updated_at': row['price_updated_at'].isoformat() if row.get('price_updated_at') else None,
        }

    def _matrix_suppliers_payload(self, suppliers: List[Dict]) -> List[Dict]:
        """Supplier column headers returned alongside the matrix rows."""
        return [
            {'id': s['id'], 'code': s['code'], 'name': s['name'],
             'default_currency': s.get('default_currency', 'GBP')}
            for s in suppliers
        ]

    @staticmethod
    def _matrix_search_match(row: Dict, query: str) -> bool:
        """Match a matrix row against the search box (SKU, product name, item_id).

        Mirrors the previous client-side filter so moving search to the server
        doesn't change which rows appear.
        """
        return (
            query in (row.get('sku') or '').lower()
            or query in (row.get('product_name') or '').lower()
            or query in str(row.get('item_id') or '').lower()
        )

    def _get_matrix_paginated(
        self,
        suppliers: List[Dict],
        status_filter: List[str],
        search: str,
        include_magento: bool,
        page: int,
        per_page: int,
        sort_by: str,
        sort_order: str,
    ) -> Dict[str, Any]:
        """Fast matrix path: search/sort/paginate a lightweight index, then
        hydrate prices for only the current page. See get_supplier_matrix."""
        # STEP 1: Build the lightweight product index (no prices yet).
        index: Dict[str, Dict] = {}
        for product in self.repo.get_matrix_product_index(status_filter):
            sku = product['sku']
            index[sku] = {
                'sku': sku,
                'item_id': product.get('item_id'),
                'product_name': product.get('product_name'),
                'category': product.get('category'),
                'brand': product.get('brand'),
                'status': product.get('status'),
                'magento_price': None,
                'stock_level': None,
                'suppliers': {},
            }

        # Include "orphan" SKUs that have pricing but aren't in inventory_metadata,
        # matching the full path (which adds them while overlaying pricing).
        for sku in self.repo.get_active_pricing_skus():
            if sku not in index:
                index[sku] = {
                    'sku': sku,
                    'item_id': None,
                    'product_name': None,
                    'category': None,
                    'brand': self._extract_brand(sku),
                    'status': 'unknown',
                    'magento_price': None,
                    'stock_level': None,
                    'suppliers': {},
                }

        rows = list(index.values())

        # STEP 2: Search (server-side now, same fields as the old client filter).
        if search and search.strip():
            query = search.strip().lower()
            rows = [r for r in rows if self._matrix_search_match(r, query)]

        # STEP 3: Sort + paginate on the lightweight rows.
        rows = self._sort_rows(rows, sort_by or 'sku', sort_order or 'asc', suppliers)
        total = len(rows)
        start = (page - 1) * per_page
        page_rows = rows[start:start + per_page]
        page_skus = [r['sku'] for r in page_rows]

        # STEP 4: Hydrate prices for ONLY this page's SKUs.
        if page_skus:
            if include_magento:
                magento_prices = self.repo.get_magento_prices(page_skus, region="uk")
                for sku, price_data in magento_prices.items():
                    if sku in index:
                        index[sku]['magento_price'] = price_data.get('price')
                        index[sku]['price_source'] = price_data.get('source')

            normalize = self._build_gbp_normalizer()
            for row in self.repo.get_full_matrix(page_skus):
                sku = row['sku']
                # page_rows entries are the same dict objects as index[sku], so
                # mutating index[sku] updates the rows we return.
                if sku in index:
                    index[sku]['suppliers'][row['supplier_code']] = \
                        self._matrix_supplier_cell(row, normalize)

        return {
            'matrix': page_rows,
            'suppliers': self._matrix_suppliers_payload(suppliers),
            'total': total,
            'page': page,
            'per_page': per_page,
            'total_pages': (total + per_page - 1) // per_page,
        }

    def _get_matrix_full(
        self,
        suppliers: List[Dict],
        skus: List[str],
        include_magento: bool,
        status_filter: List[str],
        search: str,
        page: int,
        per_page: int,
        sort_by: str,
        sort_order: str,
    ) -> Dict[str, Any]:
        """Full matrix path: build every row (all products + all prices) so a
        computed-column sort can order correctly, then paginate. Used when
        sorting by Magento/supplier price or for targeted ``skus`` lookups."""
        # STEP 1: Get ALL products from inventory_metadata (like label generator)
        all_products = self.repo.get_all_products_from_inventory_metadata(status_filter)

        # Build SKU data from inventory_metadata first
        sku_data: Dict[str, Dict] = {}
        all_skus = []

        for product in all_products:
            sku = product['sku']
            all_skus.append(sku)
            sku_data[sku] = {
                'sku': sku,
                'item_id': product.get('item_id'),
                'product_name': product['product_name'],
                'category': product['category'],
                'brand': product['brand'],
                'status': product['status'],
                'magento_price': None,  # Will be populated below
                'stock_level': None,
                'suppliers': {}
            }

        # STEP 2: Get Magento prices (special_price > price > N/A like label generator)
        if include_magento and all_skus:
            magento_prices = self.repo.get_magento_prices(all_skus, region="uk")
            for sku, price_data in magento_prices.items():
                if sku in sku_data:
                    sku_data[sku]['magento_price'] = price_data.get('price')
                    sku_data[sku]['price_source'] = price_data.get('source')

        # STEP 3: Overlay supplier pricing data
        matrix_data = self.repo.get_full_matrix(skus if skus else None)

        # Build the GBP converter once (reads FX overrides + live rates a single
        # time) so the per-row normalize below is pure arithmetic — see
        # _build_gbp_normalizer for why this matters on a remote DB.
        normalize = self._build_gbp_normalizer()

        for row in matrix_data:
            sku = row['sku']

            # If SKU not in inventory_metadata, add it (orphan pricing entry)
            if sku not in sku_data:
                sku_data[sku] = {
                    'sku': sku,
                    'item_id': None,
                    'product_name': None,
                    'category': None,
                    'brand': self._extract_brand(sku),
                    'status': 'unknown',
                    'magento_price': None,
                    'stock_level': None,
                    'suppliers': {}
                }

            sku_data[sku]['suppliers'][row['supplier_code']] = \
                self._matrix_supplier_cell(row, normalize)

        rows = list(sku_data.values())

        # Search (kept identical to the fast path for consistent results).
        if search and search.strip():
            query = search.strip().lower()
            rows = [r for r in rows if self._matrix_search_match(r, query)]

        # Sort by specified column (default: SKU)
        rows = self._sort_rows(rows, sort_by or 'sku', sort_order or 'asc', suppliers)
        total = len(rows)

        # Paginate
        start = (page - 1) * per_page
        end = start + per_page
        paginated = rows[start:end]

        return {
            'matrix': paginated,
            'suppliers': self._matrix_suppliers_payload(suppliers),
            'total': total,
            'page': page,
            'per_page': per_page,
            'total_pages': (total + per_page - 1) // per_page
        }

    # ========================================================================
    # ANALYSIS DASHBOARD
    # ========================================================================

    def get_analysis_dashboard(
        self,
        search: str = None,
        category: str = None,
        margin_status: str = None,
        status_filter: List[str] = None,
        page: int = 1,
        per_page: int = 100,
        sort_by: str = None,
        sort_order: str = "asc"
    ) -> Dict[str, Any]:
        """
        Get the analysis dashboard with calculated best prices and margins.
        Products come from inventory_metadata (like label generator), with Magento
        prices using special_price > price > N/A logic.
        """
        self.ensure_tables()
        
        # Get suppliers
        suppliers = self.repo.get_suppliers(active_only=True)
        supplier_codes = [s['code'] for s in suppliers]
        
        # STEP 1: Get ALL products from inventory_metadata (like label generator)
        all_products = self.repo.get_all_products_from_inventory_metadata(status_filter)
        
        # Initialize analysis data from inventory_metadata
        sku_analysis: Dict[str, Dict] = {}
        all_skus = []
        
        for product in all_products:
            sku = product['sku']
            all_skus.append(sku)
            sku_analysis[sku] = {
                'sku': sku,
                'item_id': product.get('item_id'),
                'product_name': product['product_name'],
                'category': product['category'],
                'brand': product['brand'],
                'status': product['status'],
                'magento_price': None,  # Will be populated below
                'stock_level': None,
                'supplier_prices': {},
                'supplier_price_dates': {},  # supplier_code -> price_updated_at (datetime)
                'best_price': None,
                'winning_supplier': None,
                'best_price_updated_at': None,  # date of the winning supplier's price
                'margin_percentage': None,
                'margin_status': 'no_data',
                'supplier_count': 0,
                'last_price_update': None
            }

        # STEP 2: Get Magento prices (special_price > price > N/A like label generator)
        if all_skus:
            magento_prices = self.repo.get_magento_prices(all_skus, region="uk")
            for sku, price_data in magento_prices.items():
                if sku in sku_analysis:
                    sku_analysis[sku]['magento_price'] = price_data.get('price')
                    sku_analysis[sku]['price_source'] = price_data.get('source')
        
        # STEP 3: Overlay supplier pricing data
        matrix_data = self.repo.get_full_matrix()

        # Build the GBP converter once (see _build_gbp_normalizer) so each row
        # below normalizes in memory instead of re-querying FX data.
        normalize = self._build_gbp_normalizer()

        for row in matrix_data:
            sku = row['sku']

            # If SKU not in inventory_metadata, add it (orphan pricing entry)
            if sku not in sku_analysis:
                sku_analysis[sku] = {
                    'sku': sku,
                    'product_name': None,
                    'category': None,
                    'brand': self._extract_brand(sku),
                    'status': 'unknown',
                    'magento_price': None,
                    'stock_level': None,
                    'supplier_prices': {},
                    'supplier_price_dates': {},
                    'best_price': None,
                    'winning_supplier': None,
                    'best_price_updated_at': None,
                    'margin_percentage': None,
                    'margin_status': 'no_data',
                    'supplier_count': 0,
                    'last_price_update': None
                }

            # Normalize price
            normalized = normalize(row['unit_price'], row['currency'])

            if normalized:
                sku_analysis[sku]['supplier_prices'][row['supplier_code']] = normalized
                sku_analysis[sku]['supplier_count'] += 1

                # Remember when this supplier's price was last changed so the
                # winning supplier's date can be surfaced in the dashboard.
                price_date = row.get('price_updated_at')
                sku_analysis[sku]['supplier_price_dates'][row['supplier_code']] = price_date

                # Track last update across suppliers (price date preferred, falling
                # back to the generic row updated_at for legacy rows).
                effective = price_date or row.get('updated_at')
                if effective:
                    last = sku_analysis[sku]['last_price_update']
                    
                    # Ensure both are offset-naive for safe comparison
                    eff_cmp = effective.replace(tzinfo=None) if getattr(effective, 'tzinfo', None) else effective
                    last_cmp = last.replace(tzinfo=None) if last and getattr(last, 'tzinfo', None) else last

                    if not last_cmp or eff_cmp > last_cmp:
                        sku_analysis[sku]['last_price_update'] = effective
        
        # Calculate best prices and margins
        summary = {
            'total_products': 0,
            'products_with_pricing': 0,
            'products_with_magento_price': 0,
            'products_needing_review': 0,
            'healthy_count': 0,
            'warning_count': 0,
            'loss_count': 0,
            'no_data_count': 0,
            'average_margin': None,
            'supplier_wins': {code: 0 for code in supplier_codes}
        }
        
        margin_sum = 0
        margin_count = 0
        
        for sku, data in sku_analysis.items():
            summary['total_products'] += 1
            
            # Check if we have Magento price
            if data['magento_price']:
                summary['products_with_magento_price'] += 1
            
            if data['supplier_prices']:
                summary['products_with_pricing'] += 1
                
                # Find best price
                prices = data['supplier_prices']
                if prices:
                    best_supplier = min(prices, key=prices.get)
                    best_price = prices[best_supplier]
                    
                    data['best_price'] = round(best_price, 2)
                    data['winning_supplier'] = best_supplier
                    data['best_price_updated_at'] = data['supplier_price_dates'].get(best_supplier)
                    summary['supplier_wins'][best_supplier] = summary['supplier_wins'].get(best_supplier, 0) + 1
                    
                    # Calculate margin if we have Magento price
                    magento_price = data['magento_price']
                    if magento_price and best_price:
                        # Ensure types are compatible (float)
                        if hasattr(magento_price, 'real'): # Check if number-like
                            m_price = float(magento_price)
                            b_price = float(best_price)
                            
                            margin = ((m_price - b_price) / m_price) * 100
                            data['margin_percentage'] = round(margin, 1)
                            
                            margin_sum += margin
                            margin_count += 1
                            
                            if margin >= 20:
                                data['margin_status'] = 'healthy'
                                summary['healthy_count'] += 1
                            elif margin >= 0:
                                data['margin_status'] = 'warning'
                                summary['warning_count'] += 1
                                summary['products_needing_review'] += 1
                            else:
                                data['margin_status'] = 'loss'
                                summary['loss_count'] += 1
                                summary['products_needing_review'] += 1
                    else:
                        # Have supplier price but no Magento price
                        data['margin_status'] = 'no_magento_price'
            else:
                summary['no_data_count'] += 1
        
        if margin_count > 0:
            summary['average_margin'] = round(margin_sum / margin_count, 1)
        
        # Filter results (search is now done client-side)
        rows = list(sku_analysis.values())
        
        if category:
            rows = [r for r in rows if r['category'] == category]
        
        if margin_status:
            rows = [r for r in rows if r['margin_status'] == margin_status]
        
        # Sort by specified column (default: SKU)
        rows = self._sort_rows(rows, sort_by or 'sku', sort_order or 'asc', suppliers)
        
        total = len(rows)
        start = (page - 1) * per_page
        end = start + per_page
        paginated = rows[start:end]
        
        # Serialize datetime
        for row in paginated:
            if row['last_price_update']:
                row['last_price_update'] = row['last_price_update'].isoformat()
            if row.get('best_price_updated_at'):
                row['best_price_updated_at'] = row['best_price_updated_at'].isoformat()
            # Internal helper map of raw datetimes — not needed by the client.
            row.pop('supplier_price_dates', None)
        
        return {
            'products': paginated,
            'summary': summary,
            'suppliers': [{'id': s['id'], 'code': s['code'], 'name': s['name']} for s in suppliers],
            'filters_applied': {
                'search': search,
                'category': category,
                'margin_status': margin_status
            },
            'total': total,
            'page': page,
            'per_page': per_page,
            'total_pages': (total + per_page - 1) // per_page
        }

    def _sort_rows(self, rows: List[Dict], sort_by: str, sort_order: str, suppliers: List[Dict] = None) -> List[Dict]:
        """
        Sort rows by a specified column with proper handling of None values.
        Supports sorting by supplier price columns (supplier code as sort_by).
        """
        reverse = sort_order.lower() == 'desc'
        
        # Check if sorting by a supplier column
        supplier_codes = [s['code'] for s in suppliers] if suppliers else []
        
        def get_sort_key(row):
            # Handle supplier column sorting (e.g., sort_by = "SUP1")
            if sort_by in supplier_codes:
                # For matrix: check suppliers dict
                if 'suppliers' in row:
                    supplier_data = row['suppliers'].get(sort_by, {})
                    return supplier_data.get('normalized_price_gbp') or float('inf')
                # For analysis: check supplier_prices dict
                if 'supplier_prices' in row:
                    return row['supplier_prices'].get(sort_by) or float('inf')
                return float('inf')
            
            # Standard column sorting
            value = row.get(sort_by)
            
            # Handle None values - push to end
            if value is None:
                if sort_by in ['magento_price', 'best_price', 'margin_percentage']:
                    return float('inf') if not reverse else float('-inf')
                return '' if not reverse else chr(0x10FFFF)  # Max unicode char
            
            # Handle numeric fields
            if sort_by in ['magento_price', 'best_price', 'margin_percentage']:
                return float(value) if value else float('inf')
            
            # String comparison (case-insensitive)
            if isinstance(value, str):
                return value.lower()
            
            return value
        
        return sorted(rows, key=get_sort_key, reverse=reverse)

    def _extract_brand(self, sku: str) -> Optional[str]:
        """Extract brand prefix from SKU"""
        import re
        match = re.match(r'^([A-Za-z]+)', sku)
        return match.group(1) if match else None

    # ========================================================================
    # GOOGLE SHEETS SYNC
    # ========================================================================

    def _format_price_with_currency(self, price, currency: str, default_currency: str) -> str:
        """
        Format a price with its currency symbol for export.
        If currency is None or matches default, use the default currency.
        Returns a formatted string like '£10.50' or '$25.00'
        """
        if price is None:
            return ''
        
        # Use default currency if none specified or if it matches
        effective_currency = currency if currency else default_currency
        if not effective_currency:
            effective_currency = 'GBP'  # Fallback
        
        # Currency symbol mapping
        currency_symbols = {
            'GBP': '£',
            'USD': '$',
            'EUR': '€',
            'JPY': '¥',
            'PLN': 'zł',
            'SEK': 'kr',
            'NOK': 'kr',
            'DKK': 'kr',
        }
        
        symbol = currency_symbols.get(effective_currency.upper(), '')
        
        # Format price
        if isinstance(price, Decimal):
            price = float(price)
        
        return f"{symbol}{price:.2f}"

    @staticmethod
    def _format_date_for_export(value) -> str:
        """Format a price_updated_at timestamp as a plain YYYY-MM-DD date string
        for CSV / Google Sheet export. Returns '' for legacy rows with no date."""
        if not value:
            return ''
        try:
            return value.strftime('%Y-%m-%d')
        except AttributeError:
            # Already a string (or unexpected type) — pass through the date part.
            return str(value)[:10]

    def sync_matrix_to_gsheet(self, sheet_id: str) -> Dict[str, Any]:
        """
        Sync FULL matrix to Google Sheet.
        Prices are formatted with currency symbols.
        Currency column only shows value if different from supplier's default.
        """
        suppliers = self.repo.get_suppliers(active_only=True)
        matrix_data = self.repo.get_full_matrix()
        
        # Build supplier lookup for default currencies
        supplier_defaults = {s['code']: s.get('default_currency', 'GBP') for s in suppliers}
        
        # Get ALL products
        all_products = self.repo.get_all_products_from_inventory_metadata()
        
        # Initialize sku_data
        sku_data = {}
        for product in all_products:
            sku = product['sku']
            sku_data[sku] = {
                'sku': sku,
                'product_name': product.get('product_name', '')
            }
        
        # Add pricing - raw numeric values with currency codes in separate column
        for row in matrix_data:
            sku = row['sku']
            if sku not in sku_data:
                sku_data[sku] = {'sku': sku, 'product_name': ''}
            
            col_prefix = row['supplier_code']
            supplier_default = supplier_defaults.get(col_prefix, 'GBP')
            price = row['unit_price']
            currency = row['currency']
            
            # Store raw numeric price (no currency symbol)
            if price is not None:
                if isinstance(price, Decimal):
                    price = float(price)
                sku_data[sku][f'{col_prefix}_price'] = price
            else:
                sku_data[sku][f'{col_prefix}_price'] = ''
            
            # Currency column: show explicit currency if set, otherwise supplier default
            effective_currency = currency if currency else supplier_default
            
            sku_data[sku][f'{col_prefix}_currency'] = effective_currency
            sku_data[sku][f'{col_prefix}_updated'] = self._format_date_for_export(row.get('price_updated_at'))
        
        # For SKUs without pricing, pre-fill currency columns with supplier defaults
        for sku in sku_data:
            for s in suppliers:
                code = s['code']
                currency_key = f'{code}_currency'
                # Only set default currency if not already set (no pricing exists)
                if currency_key not in sku_data[sku]:
                    sku_data[sku][currency_key] = s.get('default_currency', 'GBP')
        
        # Sort by SKU
        sorted_data = [sku_data[sku] for sku in sorted(sku_data.keys())]
        
        return self.gsheets.export_matrix_to_sheet(sheet_id, sorted_data, suppliers)

    def _parse_price_with_currency(self, raw_value: str) -> tuple:
        """
        Parse a price string that may contain a currency symbol.
        Returns (price: float, currency: str or None)
        
        Examples:
          '£10.50' -> (10.50, 'GBP')
          '$25' -> (25.0, 'USD')
          '€15.00' -> (15.0, 'EUR')
          '10.50' -> (10.50, None)  # No currency detected
        """
        if not raw_value:
            return (None, None)
        
        raw_value = str(raw_value).strip()
        detected_currency = None
        
        # Currency symbol mapping
        currency_symbols = {
            '£': 'GBP',
            '$': 'USD', 
            '€': 'EUR',
            '¥': 'JPY',
            'zł': 'PLN',
            'kr': 'SEK',  # Could also be NOK, DKK
        }
        
        # Detect currency from symbol
        for symbol, currency in currency_symbols.items():
            if symbol in raw_value:
                detected_currency = currency
                raw_value = raw_value.replace(symbol, '')
                break
        
        raw_value = raw_value.strip()

        # Detect European vs US/UK number format based on which separator comes last.
        # European: "1.234,56" or "43,00"  → comma is decimal, period is thousands
        # US/UK:    "1,234.56" or "43.00"  → period is decimal, comma is thousands
        last_dot   = raw_value.rfind('.')
        last_comma = raw_value.rfind(',')

        if last_comma > last_dot:
            # European: remove spaces + periods (thousands), replace comma with period
            clean_price = raw_value.replace(' ', '').replace('.', '').replace(',', '.')
        else:
            # US/UK: remove spaces + commas (thousands), keep period
            clean_price = raw_value.replace(' ', '').replace(',', '')

        try:
            price = float(clean_price)
            return (price, detected_currency)
        except (ValueError, TypeError):
            return (None, None)

    def sync_matrix_from_gsheet(self, sheet_id: str) -> Dict[str, Any]:
        """
        Sync from Google Sheet (Update Only - only imports changed values)
        """
        records = self.gsheets.import_matrix_from_sheet(sheet_id)
        
        # Get supplier mappings
        suppliers = self.repo.get_suppliers(active_only=True)
        supplier_by_code = {s['code']: s for s in suppliers}
        
        # Get valid SKUs
        all_products = self.repo.get_all_products_from_inventory_metadata()
        valid_skus = {p['sku'] for p in all_products}
        
        # Get existing pricing to compare against
        existing_pricing = self.repo.get_full_matrix()
        existing_map = {}
        for row in existing_pricing:
            key = (row['sku'], row['supplier_id'])
            existing_map[key] = {
                'unit_price': float(row['unit_price']) if row['unit_price'] else None,
                'currency': row['currency']
            }
        
        skipped_skus = []
        errors = []
        debug_log = []
        entries_to_upsert = []
        entries_to_delete = []
        unchanged_count = 0
        
        if not records:
             return {'imported': 0, 'errors': 0, 'message': 'Sheet is empty'}

        # Debugging: Log headers of first record
        first_row_keys = list(records[0].keys())
        msg = f"[GSheet Import] Found headers: {first_row_keys}"
        logger.info(msg)
        debug_log.append(msg)
        
        # Create a mapping for case-insensitive header matching
        # Normalized key -> Actual Sheet Header
        header_map = {str(k).strip().lower(): k for k in first_row_keys}
        
        debug_log.append(f"DB Suppliers: {[s['code'] for s in suppliers]}")

        for row_idx, row in enumerate(records):
            sku = str(row.get('sku', '')).strip()
            if not sku:
                continue
            
            # For each supplier column
            for supplier_code, supplier in supplier_by_code.items():
                # Construct expected keys
                expected_price_key = f"{supplier_code}_price"
                expected_currency_key = f"{supplier_code}_currency"

                # Find actual keys in the row using the map
                price_key = header_map.get(expected_price_key.lower())
                currency_key = header_map.get(expected_currency_key.lower())

                if not price_key:
                    if row_idx == 0:
                        debug_log.append(f"Warning: Column '{expected_price_key}' not found in sheet for supplier '{supplier_code}'")
                    continue

                # Check if we have data for this supplier
                raw_price = row.get(price_key)
                
                # Handle gspread empty string vs None vs numbers
                raw_price_str = str(raw_price).strip() if raw_price not in (None, '') else ''

                # Resolve alternative supplier SKU/name if needed
                resolved_sku = sku
                if resolved_sku not in valid_skus:
                    mapped_sku = self.repo.resolve_supplier_sku(supplier['id'], resolved_sku)
                    if mapped_sku:
                        resolved_sku = mapped_sku
                    else:
                        # Try matching by product_name
                        product_name_key = header_map.get('product_name')
                        product_name = str(row.get(product_name_key, '')).strip() if product_name_key else ''
                        if product_name:
                            mapped_sku = self.repo.resolve_supplier_sku(supplier['id'], product_name)
                            if mapped_sku:
                                resolved_sku = mapped_sku

                if resolved_sku not in valid_skus:
                    if raw_price_str:
                        if sku not in skipped_skus:
                            skipped_skus.append(sku)
                    continue

                # Check if this entry exists in database
                key = (resolved_sku, supplier['id'])
                existing = existing_map.get(key)
                
                # If price is empty in sheet but exists in DB, mark for deletion
                if not raw_price_str:
                    if existing:
                        entries_to_delete.append({
                            'sku': resolved_sku,
                            'supplier_id': supplier['id']
                        })
                    continue
                
                try:
                    # Parse price with potential currency symbol
                    price, detected_currency = self._parse_price_with_currency(raw_price_str)
                    
                    if price is None:
                        errors.append(f"Row {row_idx+2}: Invalid price '{raw_price}' for SKU {resolved_sku}")
                        continue
                    
                    # Get supplier's default currency
                    supplier_default = supplier.get('default_currency', 'GBP')
                    
                    # Priority: detected currency (from symbol) > explicit column > supplier default
                    currency = None
                    if detected_currency:
                        currency = detected_currency
                    elif currency_key:
                        explicit_currency = str(row.get(currency_key, '')).strip().upper()
                        if explicit_currency:
                            currency = explicit_currency
                    
                    # If still no currency, use supplier's default
                    if not currency:
                        currency = supplier_default
                    
                    # Check if this entry has actually changed
                    key = (resolved_sku, supplier['id'])
                    existing = existing_map.get(key)

                    if existing:
                        # Compare values - only update if different
                        price_same = abs((existing['unit_price'] or 0) - price) < 0.001
                        currency_same = existing['currency'] == currency

                        if price_same and currency_same:
                            unchanged_count += 1
                            continue  # Skip - no change

                    # Add to batch (new or changed)
                    entries_to_upsert.append({
                        'sku': resolved_sku,
                        'supplier_id': supplier['id'],
                        'unit_price': price,
                        'currency': currency  # Can be None
                    })

                except Exception as e:
                    errors.append(f"Row {row_idx+2}: Error processing {resolved_sku}: {str(e)}")

        # Bulk upsert only changed entries
        updated_count = 0
        if entries_to_upsert:
            updated_count = self.repo.bulk_upsert_pricing(entries_to_upsert)

        # Delete entries that were cleared in the sheet
        deleted_count = 0
        if entries_to_delete:
            for entry in entries_to_delete:
                try:
                    self.repo.delete_pricing(entry['sku'], entry['supplier_id'])
                    deleted_count += 1
                except Exception as e:
                    errors.append(f"Error deleting {entry['sku']}: {str(e)}")

        # Return the changed entries so frontend can update DOM directly
        changed_entries = [
            {
                'sku': e['sku'],
                'supplier_id': e['supplier_id'],
                'unit_price': e['unit_price'],
                'currency': e['currency']
            }
            for e in entries_to_upsert
        ]
        
        # Also return deleted entries so frontend can clear those cells
        deleted_entries = [
            {
                'sku': e['sku'],
                'supplier_id': e['supplier_id'],
                'deleted': True
            }
            for e in entries_to_delete
        ]

        return {
            'imported': updated_count,
            'deleted': deleted_count,
            'unchanged': unchanged_count,
            'changed_entries': changed_entries,  # For frontend DOM updates
            'deleted_entries': deleted_entries,  # For frontend DOM deletions
            'skipped_invalid_skus': len(skipped_skus),
            'skipped_sku_list': skipped_skus[:20],
            'errors': len(errors),
            'error_details': errors[:10],
            'debug_info': debug_log
        }

    # ========================================================================
    # PRODUCT MAPPINGS
    # ========================================================================

    def get_supplier_mappings(self, supplier_id: Optional[int] = None) -> List[Dict]:
        """Get all supplier product mappings"""
        return self.repo.get_supplier_mappings(supplier_id)

    def create_supplier_mapping(self, data: Dict) -> Dict:
        """Create a new supplier product mapping"""
        supplier = self.repo.get_supplier_by_id(data['supplier_id'])
        if not supplier:
            raise ValueError(f"Supplier with ID {data['supplier_id']} not found")

        supplier_sku = (data.get('supplier_sku') or '').strip() or None
        supplier_product_name = (data.get('supplier_product_name') or '').strip() or None
        if not supplier_sku and not supplier_product_name:
            raise ValueError("At least one of supplier_sku or supplier_product_name must be provided")

        all_products = self.repo.get_all_products_from_inventory_metadata()
        valid_skus = {p['sku'] for p in all_products}
        if data['internal_sku'] not in valid_skus:
            raise ValueError(f"Internal SKU '{data['internal_sku']}' not found in catalog")

        return self.repo.create_supplier_mapping(data)

    def delete_supplier_mapping(self, mapping_id: int) -> bool:
        """Delete a supplier product mapping"""
        return self.repo.delete_supplier_mapping(mapping_id)

    def import_mappings_file(self, file_bytes: bytes, filename: str) -> Dict:
        """
        Import product mappings from a CSV or Excel file.
        Required columns: supplier_code, internal_sku
        At least one of: supplier_sku, supplier_name (or supplier_product_name)
        """
        import io
        import pandas as pd

        ext = filename.rsplit('.', 1)[-1].lower() if '.' in filename else ''
        if ext in ('xlsx', 'xls'):
            df = pd.read_excel(io.BytesIO(file_bytes), dtype=str)
        else:
            df = pd.read_csv(io.StringIO(file_bytes.decode('utf-8-sig')), dtype=str)

        df.columns = [c.strip().lower().replace(' ', '_') for c in df.columns]

        required = {'supplier_code', 'internal_sku'}
        missing = required - set(df.columns)
        if missing:
            raise ValueError(f"Missing required columns: {', '.join(sorted(missing))}")

        # Accept both 'supplier_name' and 'supplier_product_name' as the name column
        if 'supplier_name' in df.columns and 'supplier_product_name' not in df.columns:
            df = df.rename(columns={'supplier_name': 'supplier_product_name'})

        has_sku_col = 'supplier_sku' in df.columns
        has_name_col = 'supplier_product_name' in df.columns
        if not has_sku_col and not has_name_col:
            raise ValueError("File must contain at least one of: supplier_sku, supplier_name (or supplier_product_name)")

        suppliers = self.repo.get_suppliers(active_only=False)
        supplier_by_code = {s['code'].upper(): s for s in suppliers}

        all_products = self.repo.get_all_products_from_inventory_metadata()
        valid_skus = {p['sku'] for p in all_products}

        rows_to_insert = []
        errors = []

        def _normalize_cell(value) -> str:
            if value is None:
                return ''
            if pd.isna(value):
                return ''
            return str(value).strip()

        for i, row in df.iterrows():
            line = i + 2
            code = _normalize_cell(row.get('supplier_code', '')).upper()
            internal_sku = _normalize_cell(row.get('internal_sku', ''))
            supplier_sku = _normalize_cell(row.get('supplier_sku', '')) if has_sku_col else ''
            supplier_product_name = _normalize_cell(row.get('supplier_product_name', '')) if has_name_col else ''

            if not code and not internal_sku and not supplier_sku and not supplier_product_name:
                continue  # blank row

            if not code:
                errors.append(f"Row {line}: missing supplier_code")
                continue
            if not internal_sku:
                errors.append(f"Row {line}: missing internal_sku")
                continue
            if not supplier_sku and not supplier_product_name:
                errors.append(f"Row {line}: at least one of supplier_sku or supplier_name must be provided")
                continue

            supplier = supplier_by_code.get(code)
            if not supplier:
                errors.append(f"Row {line}: supplier '{code}' not found")
                continue

            if internal_sku not in valid_skus:
                errors.append(f"Row {line}: internal SKU '{internal_sku}' not in catalog")
                continue

            rows_to_insert.append({
                'supplier_id': supplier['id'],
                'supplier_sku': supplier_sku or None,
                'supplier_product_name': supplier_product_name or None,
                'internal_sku': internal_sku,
            })

        imported = self.repo.bulk_create_supplier_mappings(rows_to_insert) if rows_to_insert else 0

        return {
            'imported': imported,
            'skipped': len(errors),
            'errors': errors,
        }

    # ========================================================================
    # PDF IMPORT
    # ========================================================================

    def identify_pdf_supplier(self, pdf_bytes: bytes) -> Dict:
        """
        Best-effort AI guess of which supplier a PDF price list belongs to.

        Hands the first page to the AI's vision model (the supplier is usually a
        LOGO / letterhead image, not extractable text) and matches it to one of
        the existing suppliers. Shares one implementation with the multi-file
        detector so a file detects the same alone as it does inside a pack. Never
        raises for AI/parse problems — degrades to ``enabled=False`` / no match so
        the importer can fall back to manual supplier selection.

        Returns:
          {
            'enabled': bool,                    # AI tiers configured & switched on
            'detected_name': str | None,        # supplier name read off the PDF
            'matched_supplier_id': int | None,  # a known supplier it maps to
            'matched_supplier_name': str | None,
            'confidence': float,                # 0.0-1.0
          }
        """
        batch = self.identify_pdf_suppliers([(None, pdf_bytes)])
        results = batch.get('results') or []
        result = dict(results[0]) if results else dict(_IDENTIFY_EMPTY)
        result['enabled'] = batch.get('enabled', False)
        # Single-response shape carries no per-file position/name.
        result.pop('index', None)
        result.pop('filename', None)
        return result

    def identify_pdf_suppliers(self, pdf_files: List[Tuple[Optional[str], bytes]]) -> Dict:
        """
        Per-file supplier detection for a multi-PDF upload.

        ``pdf_files`` is ``[(filename, pdf_bytes), ...]`` in upload order. The
        supplier's identity on these documents is usually a LOGO / letterhead
        image rather than extractable text, so detection has to SEE each page.
        The first page of every file is bundled into one PDF and identified in a
        SINGLE multimodal (vision) call — the same "merge, then one AI call"
        approach the importer uses — so N files cost one request, not N. Larger
        uploads split into a few calls (see ``_IDENTIFY_PAGES_PER_CALL``). Sending
        only first pages keeps token cost low; one bundled request keeps it fast
        and dodges the per-minute rate-limit bursts that made one-call-per-file
        detection slow and different-every-time.

        Same graceful degradation as ``identify_pdf_supplier`` — a bad file or an
        AI failure yields a no-match entry for that file, never an exception.

        Returns ``{'enabled': bool, 'results': [{index, filename, **detection}]}``.
        """
        from . import pdf_ai

        # Seed one baseline (no-match) result per file, keyed by upload position.
        results_by_index: Dict[int, Dict] = {}
        for i, (filename, _blob) in enumerate(pdf_files):
            entry = dict(_IDENTIFY_EMPTY)
            entry['index'] = i
            entry['filename'] = filename
            results_by_index[i] = entry

        def _ordered() -> List[Dict]:
            return [results_by_index[i] for i in range(len(pdf_files))]

        enabled = pdf_ai.is_enabled()
        if not enabled:
            return {'enabled': False, 'results': _ordered()}

        for entry in results_by_index.values():
            entry['enabled'] = True

        suppliers = self.repo.get_suppliers(active_only=False)
        candidates = [{'code': s['code'], 'name': s['name']} for s in suppliers]
        supplier_by_code = {str(s['code']).strip().lower(): s for s in suppliers}

        # One vision call per chunk of files (usually a single call). Each chunk's
        # first pages are merged into one PDF; a failing chunk leaves its files as
        # no-match rather than aborting the whole batch.
        total = len(pdf_files)
        for start in range(0, total, _IDENTIFY_PAGES_PER_CALL):
            chunk = [(i, pdf_files[i][1]) for i in range(start, min(start + _IDENTIFY_PAGES_PER_CALL, total))]
            merged, page_map = _merge_first_pages(chunk)
            if not merged or not page_map:
                continue

            try:
                ai_results = pdf_ai.identify_suppliers_from_pages(merged, candidates, len(page_map))
            except pdf_ai.PdfAiUnavailable as e:
                logger.info(f"identify_pdf_suppliers: AI unavailable for a chunk: {e}")
                continue

            for r in ai_results:
                page = r.get('page')  # 1-based, into this chunk's merged PDF
                if not isinstance(page, int) or page < 1 or page > len(page_map):
                    continue
                entry = results_by_index[page_map[page - 1]]
                entry['detected_name'] = r.get('detected_name') or None
                entry['confidence'] = r.get('confidence', 0.0)
                code = (r.get('matched_code') or '').strip().lower()
                match = supplier_by_code.get(code) if code else None
                if match:
                    entry['matched_supplier_id'] = match['id']
                    entry['matched_supplier_name'] = match['name']

        return {'enabled': True, 'results': _ordered()}

    def import_matrix_pdf(self, pdf_bytes: bytes, supplier_id: int, progress_cb=None,
                          progress_floor: int = 0) -> Dict:
        """
        Parse a supplier PDF price list and return a preview of pricing changes.
        Uses product mappings to match line items to internal SKUs.
        Does NOT write to the database — caller must call bulk_upsert_pricing to apply.

        progress_cb: optional callable(percent: int, message: str) invoked as pages are
        parsed, so callers (e.g. the SSE streaming endpoint) can report live progress.
        progress_floor: lower bound (0-100) for reported percentages. When the caller
        merged several PDFs first, it passes the percent the merge phase ended on, so
        this phase's 0→100 maps into floor→100 and the bar never jumps backwards.
        """
        import pdfplumber
        import io

        floor = max(0, min(int(progress_floor), 99))
        span = 100 - floor

        def _report(percent: int, message: str) -> None:
            if progress_cb:
                scaled = floor + int(max(0, min(percent, 100)) * span / 100)
                try:
                    progress_cb(scaled, message)
                except PdfParseCancelled:
                    raise  # deliberate cancellation must abort parsing
                except Exception:
                    pass  # other progress errors must never break parsing

        _report(0, "Reading PDF…")

        suppliers = self.repo.get_suppliers(active_only=False)
        supplier = next((s for s in suppliers if s['id'] == supplier_id), None)
        if not supplier:
            raise ValueError(f"Supplier with ID {supplier_id} not found")

        default_currency = supplier.get('default_currency', 'GBP')

        # Build a dict of existing prices for this supplier: sku -> {unit_price, currency}
        existing_pricing: Dict = {}
        for row in self.repo.get_full_matrix():
            if row.get('supplier_id') == supplier_id and row.get('unit_price') is not None:
                existing_pricing[row['sku']] = {
                    'unit_price': row['unit_price'],
                    'currency': row.get('currency') or default_currency,
                }

        # Extract items from PDF using a layered strategy:
        #   1. Layout-aware extraction (PRIMARY) — reconstructs columns from word
        #      x/y positions, so it reads the *unit price* column specifically
        #      (not quantity/total) and works without explicit currency symbols.
        #      This is what makes the importer "universal" across invoice layouts.
        #   2. Table + text extraction (FALLBACK) — only used on pages where the
        #      layout pass found nothing (no detectable header). Preserves the
        #      original behaviour for any format that already worked.
        # Tiered (IDP) extraction, cheapest first. Each tier emits the SAME item
        # shape; the matching/preview code below consumes the winner unchanged.
        #   Tier 1  deterministic pdfplumber passes (free)
        #   Tier 2  AI layout profile → profile-driven layout pass (cheap, cached)
        #   Tier 3  AI direct extraction (last resort)
        # A tier's result is adopted ONLY if it scores higher than the previous
        # one, so AI can never make a good deterministic parse worse.
        from . import pdf_ai

        _CONF_OK = 0.80  # confidence at/above which a tier is accepted as final

        extracted_items: list = []
        extraction_method = 'deterministic'
        confidence = 0.0
        total_pages = 1
        # Page→date map harvested for free if/when the Tier 3 whole-PDF AI call runs.
        # None = that call never happened (so we may need the date-only pass); a dict
        # (even empty) = it ran and this is what it found, keyed by physical page so it
        # stays valid even if a deterministic tier's items ended up winning.
        ai_page_dates: Optional[Dict[int, str]] = None

        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            pages = pdf.pages
            total_pages = len(pages) or 1

            # ---- Tier 1: deterministic (free) ----
            extracted_items = self._extract_pages_deterministic(
                pages, default_currency, _report, total_pages
            )
            confidence = self._extraction_confidence(extracted_items, total_pages)

            # ---- Tier 2: AI layout profile (cheap, cached per supplier-format) ----
            # Runs only when Tier 1 looks weak AND AI is configured. The profile is
            # reused from cache when we've seen this format before (zero tokens).
            if confidence < _CONF_OK and pdf_ai.is_enabled():
                try:
                    fingerprint = self._layout_fingerprint(pages)
                    profile = self.repo.get_pdf_layout_profile(supplier_id, fingerprint)
                    from_cache = profile is not None
                    if profile is None:
                        _report(40, "Analysing layout with AI…")
                        profile = pdf_ai.request_layout_profile(self._first_page_text(pages))
                    profile_items = self._extract_pages_with_profile(
                        pages, profile, default_currency, _report, total_pages
                    )
                    profile_conf = self._extraction_confidence(profile_items, total_pages)
                    if profile_conf > confidence:
                        extracted_items = profile_items
                        confidence = profile_conf
                        extraction_method = 'ai_layout'
                    # Persist a freshly built profile only when it actually worked,
                    # so a profile that didn't help is never cached.
                    if not from_cache and profile_conf >= _CONF_OK and fingerprint:
                        self.repo.save_pdf_layout_profile(supplier_id, fingerprint, profile)
                except pdf_ai.PdfAiUnavailable as e:
                    logger.info(f"PDF AI layout tier unavailable, falling back: {e}")

        # ---- Tier 3: AI direct extraction (last resort; needs only the bytes) ----
        if confidence < _CONF_OK and pdf_ai.is_enabled():
            try:
                _report(55, "Extracting with AI…")
                ai_items, ai_page_dates = pdf_ai.extract_line_items(pdf_bytes)
                ai_conf = self._extraction_confidence(ai_items, total_pages)
                if ai_items and (ai_conf > confidence or not extracted_items):
                    extracted_items = ai_items
                    confidence = ai_conf
                    extraction_method = 'ai_direct'
            except pdf_ai.PdfAiUnavailable as e:
                logger.info(f"PDF AI direct tier unavailable, falling back: {e}")

        _report(97, "Matching products…")

        # Build a product name lookup for conflict display
        all_products = self.repo.get_all_products_from_inventory_metadata()
        sku_to_name: Dict = {p['sku']: p.get('product_name', '') for p in all_products}

        # Group extracted rows by product key (ref code preferred, else identifier).
        # The FIRST occurrence is the representative (used for ref / name / display),
        # but we record every DISTINCT (price, currency) seen for that product. This
        # lets us surface "same product appears more than once with different prices"
        # as a conflict for the user to resolve, instead of silently keeping the first
        # price and dropping the rest.
        grouped: Dict[str, Dict] = {}
        group_order: list = []
        for item in extracted_items:
            key = (item.get('ref', '').lower().strip() or item.get('identifier', '').lower().strip())
            price = item.get('price')
            if not key or price is None:
                continue
            currency = item.get('currency') or default_currency
            group = grouped.get(key)
            if group is None:
                group = {'rep': item, 'variants': []}
                grouped[key] = group
                group_order.append(key)
            seen_pc = {(round(float(v['price']), 2), v['currency']) for v in group['variants']}
            if (round(float(price), 2), currency) not in seen_pc:
                # Carry the page of this (first) occurrence so the price can be dated.
                group['variants'].append({'price': price, 'currency': currency,
                                          'page': item.get('page')})

        unique_items: list = [grouped[k]['rep'] for k in group_order]

        # Date each price option in a multi-price conflict by the page it appeared
        # on, carried forward from the nearest preceding dated page (a merged file can
        # hold several documents, each dated on its own page). Source the page→date map
        # without ever adding a redundant AI call: if the whole-PDF AI tier already ran,
        # reuse the dates it returned (valid even if its items didn't win — they're keyed
        # by physical page); otherwise hit the lightweight date-only pass, but only when
        # a multi-price conflict actually exists and AI is enabled.
        has_price_conflict = any(len(g['variants']) > 1 for g in grouped.values())
        if ai_page_dates is not None:
            page_dates = ai_page_dates
        elif has_price_conflict and pdf_ai.is_enabled():
            try:
                page_dates = pdf_ai.extract_page_dates(pdf_bytes)
            except pdf_ai.PdfAiUnavailable as e:
                logger.info(f"PDF AI date pass unavailable, prices will show N/A: {e}")
                page_dates = {}
        else:
            page_dates = {}
        effective_dates = self._effective_page_dates(page_dates, total_pages)

        preview: list = []
        conflicts: list = []
        unmatched: list = []
        # Rows counted in total_found but dropped before any other bucket (no usable
        # ref/name/price, or rejected as non-product noise). Recorded so the four
        # visible buckets always reconcile to total_found, and so a human can confirm
        # nothing real was discarded.
        skipped: list = []

        for key in group_order:
            group = grouped[key]
            item = group['rep']
            variants = group['variants']

            identifier = item.get('identifier', '').strip()
            ref = item.get('ref', '').strip()
            price = item.get('price')
            currency = item.get('currency') or default_currency

            if not (identifier or ref) or price is None:
                skipped.append({
                    'raw_text': ref or identifier or '(blank)',
                    'price': price,
                    'currency': currency,
                    'reason': 'Missing price' if (identifier or ref) else 'Missing product reference/name',
                })
                continue

            if not self._is_plausible_identifier(ref, identifier):
                skipped.append({
                    'raw_text': ref or identifier,
                    'price': price,
                    'currency': currency,
                    'reason': 'Skipped as non-product line (header, total, or noise)',
                })
                continue

            # Freight / insurance / handling rows are printed inside the item table
            # with a code and a price, so every extraction tier reports them as
            # products. Drop them here — after extraction, before matching — so they
            # never reach the matrix or turn up as something to map, but still show
            # in the skipped bucket for audit.
            if self._looks_like_service_charge(ref, identifier):
                skipped.append({
                    'raw_text': ref or identifier,
                    'price': price,
                    'currency': currency,
                    'reason': 'Skipped as a service charge (shipping, insurance, handling)',
                })
                continue

            # Resolve BOTH columns independently. For the name, try the base name
            # first, then the base + any wrapped continuation fragment — so a genuine
            # two-line product name still resolves, while a one-line name followed by
            # a packaging annotation (kept separate during extraction) still matches
            # on its base form.
            sku_from_ref  = self.repo.resolve_supplier_sku(supplier_id, ref) if ref else None
            sku_from_name = None
            if identifier:
                name_candidates = [identifier]
                cont = item.get('identifier_cont', '').strip()
                if cont:
                    name_candidates.append(f"{identifier} {cont}".strip())
                for cand in name_candidates:
                    sku_from_name = self.repo.resolve_supplier_sku(supplier_id, cand)
                    if sku_from_name:
                        break

            # Case 1: neither matched
            if not sku_from_ref and not sku_from_name:
                entry = {
                    'raw_text': ref or identifier,
                    'price': price,
                    'currency': currency,
                    'reason': 'No product mapping found',
                    'ref': ref,
                    'identifier': identifier,
                }
                # Carry any AI-captured extras (qty/uom/pack/line_total/batch/foc)
                # for human verification when mapping — not used by matching itself.
                for k in ('qty', 'uom', 'pack', 'line_total', 'batch', 'foc'):
                    if item.get(k) not in (None, ''):
                        entry[k] = item[k]
                unmatched.append(entry)
                continue

            # Case 2: both matched to DIFFERENT products → user must choose which SKU
            if sku_from_ref and sku_from_name and sku_from_ref != sku_from_name:
                conflicts.append({
                    'kind': 'sku',
                    'ref': ref,
                    'identifier': identifier,
                    'price': price,
                    'currency': currency,
                    'sku_from_ref': sku_from_ref,
                    'product_name_from_ref': sku_to_name.get(sku_from_ref, ''),
                    'sku_from_name': sku_from_name,
                    'product_name_from_name': sku_to_name.get(sku_from_name, ''),
                })
                continue

            # Case 3: one or both matched to the same SKU
            internal_sku = sku_from_ref or sku_from_name
            if sku_from_ref and sku_from_name:
                match_method = 'both'
                display_name = f"{ref} — {identifier}"
            elif sku_from_ref:
                match_method = 'reference_code'
                display_name = f"{ref} — {identifier}" if identifier else ref
            else:
                match_method = 'product_name'
                display_name = identifier

            current = existing_pricing.get(internal_sku, {})
            current_price = current.get('unit_price')
            current_currency = current.get('currency') or default_currency

            # Same product appeared more than once with DIFFERENT prices → don't
            # guess. Surface a price-choice conflict so the user decides which to apply.
            if len(variants) > 1:
                conflicts.append({
                    'kind': 'price',
                    'ref': ref,
                    'identifier': identifier,
                    'currency': currency,
                    'sku': internal_sku,
                    'product_name': sku_to_name.get(internal_sku, '') or display_name,
                    'current_price': current_price,
                    'current_currency': current_currency,
                    'price_options': [
                        {'price': v['price'], 'currency': v['currency'] or default_currency,
                         'date': effective_dates.get(v.get('page'))}
                        for v in variants
                    ],
                })
                continue

            preview.append({
                'sku': internal_sku,
                'supplier_product_name': display_name,
                # Raw supplier identifiers, carried so the mappings UI can re-upsert
                # a remap on the same supplier key (ref / name). Ignored by the
                # price-matrix flow.
                'ref': ref,
                'identifier': identifier,
                'current_price': current_price,
                'current_currency': current_currency,
                'new_price': price,
                'new_currency': currency,
                'match_method': match_method,
                # Changed if there's no current price, the amount differs, OR the
                # currency differs (a USD→GBP move at the same number is still a change).
                'has_change': (
                    current_price is None
                    or abs(float(current_price) - float(price)) > 0.001
                    or (current_currency or default_currency) != (currency or default_currency)
                ),
            })

        return {
            'supplier_id': supplier_id,
            'supplier_name': supplier['name'],
            'supplier_code': supplier['code'],
            'supplier_default_currency': default_currency,
            'preview': preview,
            'conflicts': conflicts,
            'unmatched': unmatched,
            'skipped': skipped,
            'total_found': len(unique_items),
            'total_matched': len(preview),
            'total_conflicts': len(conflicts),
            'total_unmatched': len(unmatched),
            'total_skipped': len(skipped),
            # Which extraction tier produced these items, and how confident it was.
            'extraction_method': extraction_method,
            'extraction_confidence': confidence,
        }

    # ------------------------------------------------------------------
    # IDP tiered extraction helpers (Tier 1 deterministic, Tier 2 AI layout)
    # ------------------------------------------------------------------

    @staticmethod
    def _item_score(item: dict) -> int:
        """Higher = more complete: 2 if both ref and identifier, 1 if one, 0 if neither."""
        return (1 if item.get('ref') else 0) + (1 if item.get('identifier') else 0)

    def _is_plausible_identifier(self, ref: str, identifier: str) -> bool:
        """False for clear non-product noise (addresses, headers, doubling artifacts)."""
        import re as _re
        full = ((ref or '') + ' ' + (identifier or '')).strip()
        if len(full) < 4:
            return False
        if not _re.search(r'[a-zA-ZÀ-ÿ]', full):
            return False
        # Invoice totals / payment / admin lines ("Net à payer", "IBAN", …) can slip
        # through the fallback parsers on summary-only pages where the layout pass
        # finds no header. Reject them centrally so they never surface as products.
        if self._looks_like_pdf_footer(full):
            return False
        # Adjacent identical LETTER pairs signal the bold/shadow doubled-char PDF
        # artifact (e.g. "SSttyyllaaggee"). Use the RATIO of doublings to letters so a
        # couple of natural double letters in a long name aren't wrongly rejected.
        letter_count = sum(1 for c in full if c.isalpha())
        letter_doublings = sum(
            1 for i in range(len(full) - 1)
            if full[i].isalpha() and full[i].lower() == full[i + 1].lower()
        )
        if letter_count >= 6 and letter_doublings / letter_count > 0.30:
            return False
        return True

    def _extraction_confidence(self, items: list, total_pages: int) -> float:
        """Heuristic 0..1 score of how complete/clean an extraction looks.

        Combines: share of rows carrying BOTH a positive price and a name/ref
        (completeness), share that aren't footer/implausible noise (cleanliness),
        and row volume vs page count (a dense table that yielded almost nothing
        scores low). Used only to decide whether to ESCALATE to an AI tier — never
        to drop rows.
        """
        if not items:
            return 0.0
        n = len(items)
        usable = 0
        noise = 0
        for it in items:
            ref = (it.get('ref') or '').strip()
            ident = (it.get('identifier') or '').strip()
            price = it.get('price')
            has_price = price is not None and price > 0
            if has_price and (ref or ident):
                usable += 1
            if price is None or not self._is_plausible_identifier(ref, ident):
                noise += 1
        completeness = usable / n
        cleanliness = 1.0 - (noise / n)
        # ~2 usable rows per page is "normal" for a price list; very sparse
        # extractions from dense pages score low and trigger escalation even when
        # the few rows found are individually clean (a likely parse miss).
        volume = min(1.0, usable / max(1, total_pages * 2))
        score = 0.4 * completeness + 0.3 * cleanliness + 0.3 * volume
        return round(score, 3)

    def _extract_pages_deterministic(self, pages, default_currency, report, total_pages) -> list:
        """Tier 1: original layout + table/text extraction, page by page."""
        extracted_items: list = []
        layout_anchors = None  # carried across continuation pages of multi-page invoices
        for page_index, page in enumerate(pages):
            page_items: dict = {}  # primary_key -> best item so far

            def _merge(item: dict) -> None:
                ref_key = item.get('ref', '').lower().strip()
                id_key  = item.get('identifier', '').lower().strip()
                primary = ref_key or id_key
                price = item.get('price')
                if not primary or price is None:
                    return
                # Key by (product, price) so the same physical row extracted by both
                # the table and text passes collapses (most complete wins), while two
                # lines for the same product at DIFFERENT prices are both kept — the
                # downstream grouping turns those into a price conflict.
                pkey = (primary, round(float(price), 2), item.get('currency') or default_currency)
                existing = page_items.get(pkey)
                if existing is None or self._item_score(item) > self._item_score(existing):
                    page_items[pkey] = item

            layout_items, layout_anchors = self._extract_pdf_layout(page, layout_anchors)
            for item in layout_items:
                _merge(item)

            # Fallback ONLY when layout produced nothing on this page.
            if not page_items:
                for table in (page.extract_tables() or []):
                    for item in self._parse_pdf_table(table):
                        _merge(item)
                text = page.extract_text() or ''
                if text:
                    for item in self._parse_pdf_text(text):
                        _merge(item)

            for item in page_items.values():
                item['page'] = page_index + 1  # 1-based, for dating the price later
                extracted_items.append(item)
            # Reserve the final 5% for the matching phase.
            report(int(((page_index + 1) / total_pages) * 95),
                   f"Parsing page {page_index + 1} of {total_pages}")
        return extracted_items

    @staticmethod
    def _first_page_text(pages) -> str:
        """Text of the first non-empty page (where the line-item header lives)."""
        for page in pages[:2]:
            try:
                t = page.extract_text() or ''
            except Exception:
                t = ''
            if t.strip():
                return t
        return ''

    @staticmethod
    def _norm_label(s: str) -> str:
        import re
        return re.sub(r'[^a-z0-9]+', '', (s or '').lower())

    def _detect_header_signature(self, page):
        """Return the de-doubled, lowercased header label texts if a line-item
        header row is present on the page, else None. Reused for fingerprinting."""
        try:
            words = page.extract_words(keep_blank_chars=False)
        except Exception:
            words = []
        if not words:
            return None
        rows = []
        for w in sorted(words, key=lambda w: (w['top'], w['x0'])):
            for r in rows:
                if abs(r['top'] - w['top']) <= 3.5:
                    r['words'].append(w)
                    break
            else:
                rows.append({'top': w['top'], 'words': [w]})
        for r in rows:
            r['words'].sort(key=lambda w: w['x0'])
        for r in rows:
            if self._detect_header_anchors(r['words']):
                return [self._dedouble(w['text']).lower() for w in r['words']]
        return None

    def _layout_fingerprint(self, pages) -> str:
        """Stable per-supplier-format key. Anchored on the line-item header labels
        (structural, identical across invoices of one template); falls back to the
        first page's digit-free boilerplate tokens when no header is detectable."""
        import hashlib, re
        if not pages:
            return ''
        header_sig = self._detect_header_signature(pages[0])
        if header_sig:
            basis = 'H:' + '|'.join(header_sig)
        else:
            text = self._first_page_text(pages).lower()
            toks = sorted({t for t in re.findall(r'[a-zà-ÿ]{3,}', text)})[:60]
            basis = 'B:' + '|'.join(toks)
        return hashlib.sha256(basis.encode('utf-8')).hexdigest()[:32]

    def _anchors_from_profile(self, page, profile):
        """Build deterministic column anchors [(center_x, kind), …] by locating the
        AI profile's header labels among the page's words. Returns None if the
        header row can't be placed or lacks a price + ref/name column."""
        labels = profile.get('header_labels') or []
        if not labels:
            return None
        try:
            words = page.extract_words(keep_blank_chars=False)
        except Exception:
            words = []
        if not words:
            return None
        rows = []
        for w in sorted(words, key=lambda w: (w['top'], w['x0'])):
            for r in rows:
                if abs(r['top'] - w['top']) <= 3.5:
                    r['words'].append(w)
                    break
            else:
                rows.append({'top': w['top'], 'words': [w]})
        for r in rows:
            r['words'].sort(key=lambda w: w['x0'])

        label_norms = [self._norm_label(l['text']) for l in labels]
        # Choose the row that contains the most profile labels.
        best, best_hits = None, 0
        for r in rows:
            joined = self._norm_label(''.join(self._dedouble(w['text']) for w in r['words']))
            hits = sum(1 for lt in label_norms if lt and lt in joined)
            if hits > best_hits:
                best_hits, best = hits, r
        if not best or best_hits < max(2, len(label_norms) // 2):
            return None

        role_to_kind = {'discount': 'disc', 'uom': 'other'}
        hw = best['words']
        used: set = set()
        anchors = []
        for lab in labels:
            lt = self._norm_label(lab['text'])
            if not lt:
                continue
            kind = role_to_kind.get(lab.get('role', 'other'), lab.get('role', 'other'))
            placed = False
            for i in range(len(hw)):
                if i in used:
                    continue
                for span in (1, 2, 3):
                    if i + span > len(hw):
                        break
                    seg_words = hw[i:i + span]
                    seg = self._norm_label(''.join(self._dedouble(x['text']) for x in seg_words))
                    if seg and (lt == seg or lt in seg or seg in lt):
                        cx = sum((x['x0'] + x['x1']) / 2 for x in seg_words) / span
                        anchors.append((cx, kind))
                        used.update(range(i, i + span))
                        placed = True
                        break
                if placed:
                    break

        kinds = {k for _, k in anchors}
        if 'unit_price' not in kinds or not ({'ref', 'name'} & kinds):
            return None
        anchors.sort(key=lambda a: a[0])
        return anchors

    def _extract_pages_with_profile(self, pages, profile, default_currency, report, total_pages) -> list:
        """Tier 2: re-run the layout extractor using AI-derived column anchors and
        the profile's drop patterns. Anchors are computed once from the first page
        that exposes the header, then carried across continuation pages."""
        import re
        drop_res = []
        for pat in (profile.get('drop_regexes') or []):
            try:
                drop_res.append(re.compile(pat, re.IGNORECASE))
            except re.error:
                pass

        anchors = None
        extracted_items: list = []
        for page_index, page in enumerate(pages):
            if anchors is None:
                anchors = self._anchors_from_profile(page, profile)
            if anchors is not None:
                items, _ = self._extract_pdf_layout(page, carry_anchors=anchors, force_anchors=True)
                for it in items:
                    full = ((it.get('ref') or '') + ' ' + (it.get('identifier') or '')).strip()
                    if drop_res and any(r.search(full) for r in drop_res):
                        continue
                    it['page'] = page_index + 1  # 1-based, for dating the price later
                    extracted_items.append(it)
            report(int(((page_index + 1) / total_pages) * 95),
                   f"Parsing page {page_index + 1} of {total_pages}")
        return extracted_items

    @staticmethod
    def _effective_page_dates(page_dates: Dict[int, str], total_pages: int) -> Dict[int, str]:
        """Carry page dates forward so every page maps to its effective date.

        ``page_dates`` holds only the pages that actually printed a date. A merged
        file can contain several documents, each dated on one of its pages, so a
        page without its own date inherits the nearest dated page *before* it.
        Pages before the first dated page have no effective date (omitted → N/A).
        """
        effective: Dict[int, str] = {}
        last: Optional[str] = None
        for page in range(1, (total_pages or 0) + 1):
            if page_dates.get(page):
                last = page_dates[page]
            if last is not None:
                effective[page] = last
        return effective

    # ------------------------------------------------------------------
    # Layout-aware (word-position) extraction — the universal parser
    # ------------------------------------------------------------------

    # Multilingual (EN / FR / IT) column-header keywords.
    _COL_REF_KW  = ['référence', 'reference', 'réf', 'ref', 'code', 'article', 'item',
                    'art.', 'sku', 'codice', 'articolo', 'artikel', 'referencia', 'cod.']
    _COL_NAME_KW = ['désignation', 'designation', 'description', 'libellé', 'libelle',
                    'produit', 'product', 'denominazione', 'descrizione', 'bezeichnung',
                    'wording', 'dénomination', 'denomination']
    _COL_UP_KW   = ['pu ht', 'pu htva', 'p.u', 'prix unitaire', 'prix unit', 'unit price',
                    'unitaire', 'prezzo', 'unit cost', 'net price', 'prix u', 'p/u', 'pu']
    _COL_QTY_KW  = ['quantit', 'qté', 'qte', 'qty', 'q.tà', 'quantità', 'menge',
                    'u.m', 'aantal', 'colis', 'nombre']
    _COL_TOT_KW  = ['total', 'montant', 'amount', 'importo', 'sous-total', 'subtotal',
                    'totale', 'netto', 'net amount']
    _COL_DISC_KW = ['discount', 'remise', 'sconto', 'rabatt']
    _COL_VAT_KW  = ['tva', 'vat', 'iva', 'tax', 'mwst', 'btw']

    @staticmethod
    def _dedouble(text: str) -> str:
        """Collapse adjacent duplicate letters from bold/shadow doubling (e.g. 'PPUU HHTT' -> 'PU HT')."""
        import re
        return re.sub(r'(.)\1', r'\1', text, flags=re.IGNORECASE)

    def _classify_header_word(self, phrase: str) -> str:
        """Map a header phrase to a column kind. Order matters: unit price must beat total/qty."""
        t = phrase.lower().strip()
        has = lambda kws: any(k in t for k in kws)
        is_up = has(self._COL_UP_KW) or t in ('price', 'prix', 'prezzo', 'tarif', 'pu', 'p.u.')
        if has(self._COL_QTY_KW) and not is_up:
            return 'qty'
        if has(self._COL_DISC_KW):
            return 'disc'
        if has(self._COL_TOT_KW) and 'unit' not in t:
            return 'total'
        if is_up:
            return 'unit_price'
        if has(self._COL_VAT_KW) or t == '%':
            return 'vat'
        if has(self._COL_NAME_KW):
            return 'name'
        if has(self._COL_REF_KW):
            return 'ref'
        return 'other'

    def _detect_header_anchors(self, row_words: list):
        """
        Given the words of a candidate header row, return column anchors
        [(center_x, kind), ...] if it looks like a line-item table header,
        else None. Handles bold-doubled headers (GHMC) and multi-word column
        labels split across words (e.g. 'UNIT' 'PRICE', 'PU' 'HT').
        """
        if len(row_words) < 3:
            return None

        joined = ''.join(w['text'] for w in row_words)
        doubled = False
        if len(joined) >= 6:
            pairs = sum(1 for i in range(len(joined) - 1)
                        if joined[i].isalpha() and joined[i].lower() == joined[i + 1].lower())
            doubled = (pairs / len(joined)) > 0.30

        texts = [self._dedouble(w['text']) if doubled else w['text'] for w in row_words]
        kinds = [None] * len(row_words)

        # Bigrams first: merge a label only when the two words are physically
        # adjacent (small x-gap), so neighbouring *columns* are not joined.
        for i in range(len(row_words) - 1):
            if row_words[i + 1]['x0'] - row_words[i]['x1'] <= 10:
                k = self._classify_header_word(texts[i] + ' ' + texts[i + 1])
                if k != 'other':
                    if kinds[i] is None:
                        kinds[i] = k
                    if kinds[i + 1] is None:
                        kinds[i + 1] = k
        for i in range(len(row_words)):
            if kinds[i] is None:
                kinds[i] = self._classify_header_word(texts[i])

        if 'unit_price' not in kinds or not ('ref' in kinds or 'name' in kinds):
            return None
        return [((w['x0'] + w['x1']) / 2, k) for w, k in zip(row_words, kinds)]

    # Markers that indicate the line-item table has ended and the invoice
    # totals / payment / address block has begun. Used to stop merging wrapped
    # continuation lines into product names. Matched case-insensitively against
    # de-doubled row text (so bold "FFaaccttuurree" still matches "facture").
    _PDF_FOOTER_RE = re.compile(
        r'(inco\s*terms|sous-?total|total\s+(hors|tva|ht)|frais\s+de\s+(port|transport)|'
        r'tva\s*\d|conditions?\s+de\s+paiement|mode\s+de\s+(r[èe]glement|paiement)|'
        r'date\s+(d.?[ée]mission|limite)|escompte\s+pour\s+r[èe]glement|'
        r'r[ée]capitulatif\s+des\s+[ée]ch[ée]ances|logiciels?\s+de\s+gestion|'
        r'(virement|pr[ée]l[èe]vement)\s+sepa|net\s+[àa]\s+payer|'
        r'en\s+cas\s+de\s+retard|bank\s*name|iban|bic|by\s+placing|'
        r'livraison\s+intra|adresse\s+de\s+livraison|siret\s*/?\s*siren)',
        re.IGNORECASE,
    )

    def _looks_like_pdf_footer(self, text: str) -> bool:
        """True when a row clearly belongs to the invoice footer/totals block."""
        cleaned = self._dedouble(text or '')
        return bool(self._PDF_FOOTER_RE.search(cleaned))

    # Charge lines that sit INSIDE the line-item table like a product — own code,
    # qty, unit price, line total — but are services, not goods (e.g. the
    # "INSURANCE Insurance 51,06" / "COURIER Courier 203,00" rows on a Nordic
    # Medical Solutions invoice). The footer regex can't catch them: they're above
    # the totals block and structurally identical to a real row.
    #
    # A row is rejected only when EVERY word of it is a known charge/filler word
    # AND at least one is a charge noun. That keeps real products whose names merely
    # contain one of these words ("Transport Kit", "Delivery Cannula") — "kit" and
    # "cannula" aren't in the vocabulary, so the row survives.
    _CHARGE_NOUNS = frozenset({
        # en
        'insurance', 'courier', 'shipping', 'shipment', 'freight', 'carriage',
        'postage', 'handling', 'delivery', 'transport', 'transportation',
        'logistics', 'packaging', 'packing', 'surcharge', 'surcharges', 'admin',
        'administration', 'customs', 'duty', 'duties', 'service', 'fuel',
        # fr
        'assurance', 'frais', 'livraison', 'emballage', 'manutention', 'expedition',
        'expédition',
        # de / nl / da
        'versicherung', 'versand', 'versandkosten', 'transportkosten', 'fracht',
        'verpackung', 'kosten', 'verzekering', 'verzending', 'vracht', 'verpakking',
        'forsikring', 'fragt', 'levering',
        # it / es
        'assicurazione', 'spedizione', 'trasporto', 'imballaggio', 'spese',
        'seguro', 'envio', 'envío', 'transporte', 'embalaje', 'gastos', 'franqueo',
    })
    # Words that may accompany a charge noun without making the row a product.
    # Deliberately excludes concrete nouns (box, kit, pack, …) so those keep a row.
    _CHARGE_FILLER = frozenset({
        'fee', 'fees', 'charge', 'charges', 'charged', 'cost', 'costs', 'price',
        'total', 'amount', 'each', 'per', 'and', 'plus', 'extra', 'additional',
        'standard', 'express', 'next', 'day', 'national', 'international',
        'uk', 'eu', 'port', 'ports',
        # connectors: "frais de port", "spese di spedizione", "gastos de envío"
        'de', 'des', 'du', 'la', 'le', 'les', 'di', 'del', 'della', 'da', 'van',
        'der', 'und', 'en', 'of', 'y', 'e',
    })
    _WORD_SPLIT_RE = re.compile(r'[^a-zà-ÿ]+', re.IGNORECASE)

    def _looks_like_service_charge(self, ref: str, identifier: str) -> bool:
        """True for freight/insurance/handling-style charge rows masquerading as products."""
        full = ((ref or '') + ' ' + (identifier or '')).strip()
        if not full:
            return False
        # Try the text as printed first, then de-doubled, so the bold/shadow
        # doubled-char PDF artifact ("CCoouurriieerr") is caught too.
        for candidate in (full, self._dedouble(full)):
            words = [w.lower() for w in self._WORD_SPLIT_RE.split(candidate) if w]
            if not words or len(words) > 6:
                continue
            if all(w in self._CHARGE_NOUNS or w in self._CHARGE_FILLER for w in words) \
                    and any(w in self._CHARGE_NOUNS for w in words):
                return True
        return False

    def _extract_pdf_layout(self, page, carry_anchors=None, force_anchors=False):
        """
        Universal line-item extractor based on word positions.

        Returns (items, anchors) where items is a list of
        {ref, identifier, price, currency} dicts and anchors are the column
        anchors to carry into the next page (for multi-page invoices whose
        continuation pages omit the header).

        force_anchors=True uses the supplied carry_anchors verbatim and skips
        header auto-detection — used by the AI layout tier (Tier 2), where the
        anchors are derived from an AI-described column profile.
        """
        import re
        from collections import defaultdict

        try:
            words = page.extract_words(keep_blank_chars=False)
        except Exception:
            words = []
        if not words:
            return [], carry_anchors

        # Cluster words into rows by their vertical position.
        rows = []
        for w in sorted(words, key=lambda w: (w['top'], w['x0'])):
            for r in rows:
                if abs(r['top'] - w['top']) <= 3.5:
                    r['words'].append(w)
                    break
            else:
                rows.append({'top': w['top'], 'words': [w]})
        for r in rows:
            r['words'].sort(key=lambda w: w['x0'])
        rows.sort(key=lambda r: r['top'])

        # Locate the header row on this page; otherwise reuse carried anchors.
        # When force_anchors is set, trust the supplied anchors (AI layout tier)
        # and scan all rows — the header row carries no parseable price so it is
        # skipped naturally below.
        anchors = carry_anchors
        start_idx = 0
        if not force_anchors:
            for ri, r in enumerate(rows):
                detected = self._detect_header_anchors(r['words'])
                if detected:
                    anchors = detected
                    start_idx = ri + 1
                    break
        if not anchors:
            return [], carry_anchors

        def _bucket(word):
            cx = (word['x0'] + word['x1']) / 2
            return min(anchors, key=lambda a: abs(a[0] - cx))[1]

        # Column x positions used to reclaim mis-bucketed product-name words.
        # The product description (Désignation) is wide and often runs right up
        # to the quantity column, so trailing size tokens like "1x1ml syringe"
        # land in the qty bucket by nearest-anchor. We reclaim everything sitting
        # between the description column and the unit-price column back into the
        # name (then strip just the quantity value) so name-based mappings match.
        desc_x = max((a[0] for a in anchors if a[1] in ('ref', 'name')), default=0)
        price_x = min((a[0] for a in anchors if a[1] == 'unit_price'), default=10 ** 9)

        # Some invoices (e.g. GDA) have NO dedicated description column — the SKU
        # code and the product name share one wide "ITEM" column, with the value
        # columns (U.M./qty/price) far to the right. We detect that case and rebuild
        # the name differently (see the per-row logic below).
        has_name_col = any(k == 'name' for _, k in anchors)
        # Leftmost value column. The product identity never extends past it; used
        # as a hard right-bound when reconstructing names from a combined column.
        value_x = min((a[0] for a in anchors
                       if a[1] in ('qty', 'unit_price', 'total', 'disc', 'vat')),
                      default=price_x)
        # A supplier reference/SKU token: alphanumeric (with - / .) containing a digit.
        _code_re = re.compile(r'^[A-Za-z0-9][A-Za-z0-9\-/.]+$')

        # The quantity VALUE is a right-aligned numeric cluster whose tokens sit
        # tightly together (thousands groups like "1 000,00" have ~2px gaps),
        # whereas description text that overflows toward the qty column is
        # separated from that value by a large gap (≥ ~30px). We use that gap to
        # peel only the qty value off the end of the reclaimed words, preserving
        # legitimate numbers inside names ("5 x 5 ml", "50 ml", "1 pack").
        _qty_value = re.compile(r'^\d{1,3}(?:[ \u00a0]\d{3})*[.,]\d{1,2}$')

        def _is_num_token(t):
            t = t.strip()
            return bool(_qty_value.match(t)) or t.isdigit()

        def _strip_qty_value(ws):
            """Remove the trailing right-aligned quantity value from sorted words."""
            if not ws:
                return ws
            k = len(ws) - 1
            if not _is_num_token(ws[k]['text']):
                return ws  # name doesn't end in a number → nothing to strip
            start = k
            while (start - 1 >= 0
                   and _is_num_token(ws[start - 1]['text'])
                   and (ws[start]['x0'] - ws[start - 1]['x1']) <= 8):
                start -= 1
            return ws[:start]

        sym_to_cur = {'€': 'EUR', '£': 'GBP', '$': 'USD', '¥': 'JPY'}
        items = []
        for r in rows[start_idx:]:
            buckets = defaultdict(list)        # kind -> [text, ...]
            word_buckets = defaultdict(list)   # kind -> [word dict, ...]
            for w in r['words']:
                k = _bucket(w)
                buckets[k].append(w['text'])
                word_buckets[k].append(w)

            row_text = ' '.join(w['text'] for w in r['words'])

            # The invoice's payment / totals / admin block (e.g. "Escompte pour
            # règlement…", "Virement SEPA", "Document créé par logiciels…") marks the
            # end of the line items. Stop here even if such a row carries a stray
            # amount, so those lines are never mistaken for products nor glued onto
            # the previous product's name.
            if self._looks_like_pdf_footer(row_text):
                break

            up_text = ' '.join(buckets.get('unit_price', [])).strip()
            price, currency = (None, None)
            if up_text:
                price, currency = self._parse_price_with_currency(up_text)

            # Rows without a usable unit price are either (a) wrapped continuation
            # lines of the previous item's description, or (b) footer/address text.
            # Merge genuine continuation fragments so multi-line product names are
            # not truncated (which would break exact name-mapping matches).
            if price is None or price <= 0:
                if self._looks_like_pdf_footer(row_text):
                    # Reached the totals/footer block — stop scanning this table.
                    break
                # Only merge wrapped fragments for layouts with a real description
                # column. Combined-column invoices (no name header, e.g. GDA) put
                # the full name on the product's own line and follow it with
                # batch/expiry/dimension sub-lines that must NOT be appended.
                if items and has_name_col:
                    cont_words = [
                        w for w in r['words']
                        if (w['x0'] + w['x1']) / 2 < price_x
                    ]
                    cont = ' '.join(w['text'] for w in _strip_qty_value(
                        sorted(cont_words, key=lambda w: w['x0']))).strip()
                    # Only merge short, descriptive fragments (avoid stray noise).
                    # IMPORTANT: keep the continuation SEPARATE from the base name
                    # rather than overwriting it. Many invoices print a packaging
                    # annotation ("CONDITIONNEMENT 50ml") or even the NEXT product's
                    # wrapped first line under an item; gluing those onto the name
                    # breaks an otherwise-exact mapping match. Matching later tries
                    # the base name first, then base+continuation, so genuine
                    # two-line names still resolve without corrupting one-line ones.
                    if cont and re.search(r'[A-Za-zÀ-ÿ]', cont) and len(cont) <= 60:
                        items[-1]['identifier_cont'] = (
                            (items[-1].get('identifier_cont', '') + ' ' + cont).strip()
                        )
                continue

            if has_name_col:
                # Supplier code = the LEFTMOST token in the ref column. Some suppliers
                # use purely-alphabetic codes (LIFTK, PLATY, GANTC, CRYOSTICKS) with no
                # digit, so we can't require one: instead we take the first ref-column
                # word when it is code-like — a single alphanumeric token that either
                # contains a digit OR is all-uppercase (codes are, descriptions are
                # mixed-case) — provided there is still other text left for the name.
                # This stops the code being prepended to the name (which would break
                # the name→mapping match, e.g. "LIFTK LIFTKISS…" vs "LIFTKISS…").
                ref = ''
                ref_word_list = sorted(word_buckets.get('ref', []), key=lambda w: w['x0'])
                leftover_words = list(ref_word_list)
                if ref_word_list:
                    first_txt = ref_word_list[0]['text']
                    is_code = (
                        bool(_code_re.match(first_txt)) and len(first_txt) >= 2
                        and (bool(re.search(r'\d', first_txt)) or first_txt.isupper())
                    )
                    has_other_name = len(ref_word_list) > 1 or bool(word_buckets.get('name'))
                    if is_code and has_other_name:
                        ref = first_txt
                        leftover_words = ref_word_list[1:]
                    else:
                        # Fall back to the first digit-bearing token anywhere in the
                        # ref column (covers codes that aren't physically leftmost).
                        for i, w in enumerate(ref_word_list):
                            if _code_re.match(w['text']) and re.search(r'\d', w['text']):
                                ref = w['text']
                                leftover_words = ref_word_list[:i] + ref_word_list[i + 1:]
                                break

                # Product name = the description column PLUS the descriptive words
                # that bled LEFT into the code column (a wide description whose left
                # edge nearest-anchors into 'ref'). Without re-attaching those, names
                # get truncated (e.g. "LIFT BUST 3D 100ML" → "3D 100ML") and stop
                # matching their mapping.
                name_words = list(word_buckets.get('name', [])) + leftover_words
                name_words.sort(key=lambda w: w['x0'])

                # Then extend RIGHTWARDS only over words that are physically
                # contiguous with the description (small gaps) — size/desc tokens
                # pushed into the qty bucket by nearest-anchor. Stop at the first
                # sizeable gap, which precedes the numeric value columns, so
                # qty/discount/VAT/LOT values are never glued onto the name.
                right_candidates = sorted(
                    (w for k, ws in word_buckets.items() if k not in ('ref', 'name')
                     for w in ws if (w['x0'] + w['x1']) / 2 > desc_x),
                    key=lambda w: w['x0'],
                )
                prev_x1 = name_words[-1]['x1'] if name_words else desc_x
                for w in right_candidates:
                    if w['x0'] - prev_x1 > 20:
                        break
                    name_words.append(w)
                    prev_x1 = w['x1']

                # NB: no qty-value stripping here — the gap-bounded extension above
                # already stops before the distant numeric columns, so a trailing
                # size number that is genuinely part of the name (e.g. "5 x 5ml")
                # is preserved.
                identifier = ' '.join(w['text'] for w in name_words).strip()
                if not identifier:
                    identifier = ' '.join(w['text'] for w in leftover_words).strip()
            else:
                # Combined identity column (no description header, e.g. GDA "ITEM"):
                # the row reads  [SKU] <wide gap> [name words, tightly packed]
                # <wide gap> [U.M.] <gap> [qty] … We pop the leading code token as
                # the ref, then take the tightly-packed run of words that follows as
                # the name, breaking at the first sizeable gap. That gap reliably
                # separates the description from the distant U.M./qty/price columns,
                # so values like the unit-of-measure ("PS") are never glued on — and
                # name-based mappings resolve correctly.
                identity = [w for w in sorted(r['words'], key=lambda w: w['x0'])
                            if (w['x0'] + w['x1']) / 2 < value_x]
                ref = ''
                if identity:
                    t0 = identity[0]['text']
                    if _code_re.match(t0) and re.search(r'\d', t0):
                        ref = t0
                        identity = identity[1:]
                name_words = []
                prev = None
                for w in identity:
                    if prev is not None and (w['x0'] - prev['x1']) > 30:
                        break
                    name_words.append(w)
                    prev = w
                identifier = ' '.join(w['text'] for w in name_words).strip()

            if not (ref or identifier):
                continue

            # Currency: explicit symbol anywhere on the row wins over column text.
            if not currency:
                for w in r['words']:
                    if w['text'] in sym_to_cur:
                        currency = sym_to_cur[w['text']]
                        break

            items.append({
                'ref': ref,
                'identifier': identifier,
                'price': price,
                'currency': currency,
            })

        return items, anchors

    def _parse_pdf_table(self, table: list) -> list:
        """
        Extract {ref, identifier, price, currency} items from a pdfplumber table.
        Supports English and French column headers.
        ref       = supplier reference/SKU code (e.g. Référence column)
        identifier = product description/name (e.g. Désignation column)
        """
        import re

        if not table or len(table) < 2:
            return []

        header = [str(cell or '').lower().strip() for cell in table[0]]

        ref_col = None    # Short supplier code / SKU
        name_col = None   # Product description / name
        price_col = None  # Unit price (we want PU HT, not Total HT)

        # Keywords that should NOT be used as price columns
        skip_price_kw = {'total', 'tva', 'tax', 'montant', 'amount', 'subtotal', 'sous-total'}

        # Ordered from most-specific to least so first match wins
        ref_kw   = ['référence', 'reference', 'réf.', 'réf', 'ref.', 'ref', 'code article', 'code produit', 'sku', 'article no', 'art no', 'art.']
        name_kw  = ['désignation', 'designation', 'libellé', 'libelle', 'description', 'produit', 'product', 'item', 'name']
        price_kw = ['pu ht', 'p.u. ht', 'prix unit', 'prix ht', 'prix unitaire', 'unit price', 'unit cost', 'net price', 'price', 'pu', 'prix', 'tarif ht', 'tarif', 'rate', 'cost', 'each', 'net', 'excl']

        for i, h in enumerate(header):
            if ref_col is None and any(kw in h for kw in ref_kw):
                ref_col = i
            elif name_col is None and any(kw in h for kw in name_kw):
                name_col = i
            elif price_col is None and any(kw in h for kw in price_kw):
                # Skip columns that are clearly totals/tax
                if not any(sk in h for sk in skip_price_kw):
                    price_col = i

        # Auto-detect if headers couldn't be resolved (handles unlabelled or foreign tables)
        if price_col is None or (name_col is None and ref_col is None):
            num_cols = max((len(row) for row in table[1:] if row), default=0)
            price_scores = [0] * num_cols
            text_scores  = [0] * num_cols
            for row in table[1:]:
                for ci, cell in enumerate(row or []):
                    val = str(cell or '').strip()
                    # Match both decimal formats: 43.00 and 43,00
                    if re.search(r'\d+[.,]\d{2}\b', val):
                        price_scores[ci] += 1
                    elif len(val) > 3 and not val.replace(',', '').replace('.', '').isdigit():
                        text_scores[ci] += 1
            if price_col is None and any(s > 0 for s in price_scores):
                # Prefer the FIRST high-scoring price column (unit price before total)
                threshold = max(price_scores) * 0.5
                price_col = next((i for i, s in enumerate(price_scores) if s >= threshold), None)
            if name_col is None and ref_col is None and any(s > 0 for s in text_scores):
                ranked = sorted(range(num_cols), key=lambda i: text_scores[i], reverse=True)
                name_col = next((i for i in ranked if i != price_col), None)

        if price_col is None or (name_col is None and ref_col is None):
            return []

        items = []
        for row in table[1:]:
            if not row:
                continue
            max_needed = max(filter(lambda x: x is not None, [ref_col, name_col, price_col]))
            if len(row) <= max_needed:
                continue

            ref        = str(row[ref_col]  or '').strip() if ref_col  is not None else ''
            identifier = str(row[name_col] or '').strip() if name_col is not None else ''
            price_text = str(row[price_col] or '').strip()

            if not (ref or identifier) or not price_text:
                continue

            price, currency = self._parse_price_with_currency(price_text)
            if price is not None and price > 0:
                items.append({'ref': ref, 'identifier': identifier, 'price': price, 'currency': currency})
        return items

    def _parse_pdf_text(self, text: str) -> list:
        """
        Extract {ref, identifier, price, currency} items from plain PDF text.

        Strategy for invoice-format lines (e.g. GHMC):
          "U332 Stylage BI SOFT - Hydromax -1x1ml  120,00  43,00 €  5 160,00 €  0,00"
          → Must have an explicit currency symbol (£/€/$) — no bare-number fallback.
          → Must start with a ref code that contains at least one digit (e.g. "U332").
            This distinguishes product rows from headers/footers/legal text which never
            start with a alphanumeric code containing a digit.
          → Everything before the first currency price, minus trailing bare numbers = name.
        """
        import re

        currency_map = {'£': 'GBP', '$': 'USD', '€': 'EUR', '¥': 'JPY'}

        # Only extract lines that have an explicit currency symbol — no bare-number fallback.
        # This eliminates legal text like "article 289 A du CGI" where 289 has no symbol.
        currency_price_re = re.compile(
            r'(?P<num1>[\d][\d\s]*(?:[.,]\d+)*)\s*(?P<sym1>[£$€¥])'   # "43,00 €"
            r'|(?P<sym2>[£$€¥])\s*(?P<num2>[\d][\d\s]*(?:[.,]\d+)*)'  # "£43.00"
        )

        # Ref code: short alphanumeric token at the start (e.g. "U332", "AMS-01").
        # After matching, we additionally require at least one digit — this separates
        # product references from ordinary words like "Frais", "fois", "Adresse".
        ref_code_re = re.compile(r'^([A-Z0-9][A-Z0-9\-]{1,7})\s+', re.IGNORECASE)

        items = []
        for line in text.split('\n'):
            line = line.strip()
            if not line or len(line) < 4:
                continue

            # Only process lines that contain an explicit currency symbol
            m = currency_price_re.search(line)
            if not m:
                continue

            if m.group('num1'):
                raw_num, sym = m.group('num1'), m.group('sym1')
            else:
                raw_num, sym = m.group('num2'), m.group('sym2')
            currency = currency_map.get(sym)
            price, _ = self._parse_price_with_currency(raw_num)
            price_start = m.start()

            if price is None or not (0.01 <= price <= 50000):
                continue

            # Raw text before the price
            prefix = line[:price_start].strip()
            # Strip trailing bare numbers (e.g. quantity column "120,00")
            prefix = re.sub(r'[\d][\d\s,\.]*$', '', prefix).strip()
            # Collapse repeated spaces / dot-leaders
            prefix = re.sub(r'[\s.]{3,}', ' ', prefix).strip()
            prefix = re.sub(r'\s{2,}', ' ', prefix).strip()

            if not prefix or len(prefix) < 2:
                continue

            # Require a ref code with at least one digit at the start of the line.
            # Product rows in invoices always start with a supplier reference (U332, ST024).
            # Footer text, addresses, legal lines, and headers never do.
            rm = ref_code_re.match(prefix)
            if not (rm and re.search(r'\d', rm.group(1))):
                continue

            ref        = rm.group(1)
            identifier = prefix[rm.end():].strip()
            full_text  = (ref + ' ' + identifier).strip()

            # Detect doubled-character artifacts from PDF bold/shadow rendering.
            # Count only adjacent LETTER pairs that are identical (spaces/punctuation
            # dilute the ratio so we count raw letter doublings instead).
            # e.g. "DDaattee" → 4 letter doublings → skip
            letter_doublings = sum(
                1 for i in range(len(full_text) - 1)
                if full_text[i].isalpha() and full_text[i].lower() == full_text[i + 1].lower()
            )
            if letter_doublings >= 3:
                continue

            items.append({'ref': ref, 'identifier': identifier, 'price': price, 'currency': currency})

        return items
