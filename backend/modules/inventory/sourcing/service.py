# backend/modules/inventory/sourcing/service.py
"""
Service layer for Product Sourcing - Business logic and calculations
"""
import logging
from typing import List, Dict, Optional, Any
from datetime import datetime
from decimal import Decimal

from common.currency import get_exchange_rates, convert_to_gbp
from .repository import SourcingRepository
from .gsheets_service import GSheetsService

logger = logging.getLogger(__name__)


class PdfParseCancelled(Exception):
    """Raised to cooperatively abort PDF parsing when the client disconnects."""


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
        """Convert a price to GBP using current rates"""
        if not price or currency == 'GBP':
            return price
        
        # First check for overrides
        overrides = self.repo.get_fx_overrides()
        if currency in overrides:
            return round(price / overrides[currency], 2)
        
        # Fall back to live conversion
        return convert_to_gbp(price, currency)

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
        """
        Get the full supplier matrix view with ALL products from inventory_metadata.
        Products come from inventory_metadata (like label generator), then supplier
        pricing is overlaid on top.
        """
        self.ensure_tables()
        
        # Get all suppliers for column headers
        suppliers = self.repo.get_suppliers(active_only=True)
        
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
        
        for row in matrix_data:
            sku = row['sku']
            
            # If SKU not in inventory_metadata, add it (orphan pricing entry)
            if sku not in sku_data:
                sku_data[sku] = {
                    'sku': sku,
                    'product_name': None,
                    'category': None,
                    'brand': self._extract_brand(sku),
                    'status': 'unknown',
                    'magento_price': None,
                    'stock_level': None,
                    'suppliers': {}
                }
            
            # Normalize price
            normalized = self.normalize_price_to_gbp(row['unit_price'], row['currency'])
            
            sku_data[sku]['suppliers'][row['supplier_code']] = {
                'supplier_id': row['supplier_id'],
                'supplier_code': row['supplier_code'],
                'supplier_name': row['supplier_name'],
                'unit_price': float(row['unit_price']) if row['unit_price'] else None,
                'currency': row['currency'],
                'normalized_price_gbp': normalized,
                'moq': row['moq'],
                'shipping_cost': float(row['shipping_cost']) if row['shipping_cost'] else None,
                'notes': row['notes'],
                'is_preferred': row['is_preferred'],
                'last_verified': row['last_verified'].isoformat() if row['last_verified'] else None
            }
        
        # Convert to list (search is now done client-side)
        rows = list(sku_data.values())
        
        # Sort by specified column (default: SKU)
        rows = self._sort_rows(rows, sort_by or 'sku', sort_order or 'asc', suppliers)
        total = len(rows)
        
        # Paginate
        start = (page - 1) * per_page
        end = start + per_page
        paginated = rows[start:end]
        
        return {
            'matrix': paginated,
            'suppliers': [{'id': s['id'], 'code': s['code'], 'name': s['name']} for s in suppliers],
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
                'best_price': None,
                'winning_supplier': None,
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
                    'best_price': None,
                    'winning_supplier': None,
                    'margin_percentage': None,
                    'margin_status': 'no_data',
                    'supplier_count': 0,
                    'last_price_update': None
                }
            
            # Normalize price
            normalized = self.normalize_price_to_gbp(row['unit_price'], row['currency'])
            
            if normalized:
                sku_analysis[sku]['supplier_prices'][row['supplier_code']] = normalized
                sku_analysis[sku]['supplier_count'] += 1
                
                # Track last update
                if row['updated_at']:
                    last = sku_analysis[sku]['last_price_update']
                    if not last or row['updated_at'] > last:
                        sku_analysis[sku]['last_price_update'] = row['updated_at']
        
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
    # IMPORT/EXPORT
    # ========================================================================

    def export_matrix_csv(self) -> str:
        """
        Export supplier matrix as CSV including ALL products from inventory_metadata.
        Products without pricing will have empty supplier columns.
        """
        import csv
        import io
        
        suppliers = self.repo.get_suppliers(active_only=True)
        matrix_data = self.repo.get_full_matrix()
        
        # Get ALL products from inventory_metadata (same source as label generator)
        all_products = self.repo.get_all_products_from_inventory_metadata()
        
        # Initialize sku_data with all products (including those without pricing)
        sku_data: Dict[str, Dict] = {}
        for product in all_products:
            sku = product['sku']
            sku_data[sku] = {
                'sku': sku,
                'product_name': product.get('product_name', '')
            }
        
        # Add supplier pricing data
        for row in matrix_data:
            sku = row['sku']
            if sku not in sku_data:
                # SKU exists in pricing but not in inventory_metadata (shouldn't happen, but handle it)
                sku_data[sku] = {'sku': sku, 'product_name': ''}
            
            col_prefix = row['supplier_code']
            sku_data[sku][f'{col_prefix}_price'] = row['unit_price']
            sku_data[sku][f'{col_prefix}_currency'] = row['currency']
            sku_data[sku][f'{col_prefix}_notes'] = row['notes'] or ''
        
        # Build CSV
        output = io.StringIO()
        
        # Build headers: sku, product_name, then supplier columns
        headers = ['sku', 'product_name']
        for s in suppliers:
            headers.extend([
                f"{s['code']}_price",
                f"{s['code']}_currency",
                f"{s['code']}_notes"
            ])
        
        writer = csv.DictWriter(output, fieldnames=headers, extrasaction='ignore')
        writer.writeheader()
        
        for row in sorted(sku_data.values(), key=lambda x: x['sku']):
            writer.writerow(row)
        
        return output.getvalue()

    def import_matrix_csv(self, csv_content: str) -> Dict[str, int]:
        """
        Import supplier matrix from CSV with UPDATE-ONLY behavior.
        
        Rules:
        - Only updates values that are provided (non-empty cells)
        - Empty cells preserve existing database values
        - SKUs must exist in inventory_metadata (cannot add new products)
        - If a SKU has no pricing and user adds values, creates them
        - If a SKU has pricing and user updates values, updates them
        
        Similar to Magento's Add/Update import, but update-only.
        """
        import csv
        import io
        
        reader = csv.DictReader(io.StringIO(csv_content))
        
        # Get supplier mappings
        suppliers = self.repo.get_suppliers(active_only=True)
        supplier_by_code = {s['code']: s for s in suppliers}
        
        # Get valid SKUs from inventory_metadata
        all_products = self.repo.get_all_products_from_inventory_metadata()
        valid_skus = {p['sku'] for p in all_products}
        
        # Get existing pricing to check what needs updating vs creating
        existing_pricing = self.repo.get_full_matrix()
        existing_keys = {(row['sku'], row['supplier_id']) for row in existing_pricing}
        
        entries = []
        skipped_skus = []
        errors = []
        
        for row_num, row in enumerate(reader, start=2):
            sku = row.get('sku', '').strip()
            if not sku:
                continue
            
            # Process each supplier column
            for code, supplier in supplier_by_code.items():
                price_col = f'{code}_price'
                currency_col = f'{code}_currency'
                notes_col = f'{code}_notes'
                
                # Only process if price column exists and has a value
                # Empty cells are skipped to preserve existing values
                price_value = row.get(price_col, '').strip() if price_col in row else ''
                
                if price_value:
                    # Resolve alternative supplier SKU/name if needed
                    resolved_sku = sku
                    if resolved_sku not in valid_skus:
                        mapped_sku = self.repo.resolve_supplier_sku(supplier['id'], resolved_sku)
                        if mapped_sku:
                            resolved_sku = mapped_sku
                        else:
                            # Try to match by product_name
                            product_name_val = row.get('product_name', '').strip()
                            if product_name_val:
                                mapped_sku = self.repo.resolve_supplier_sku(supplier['id'], product_name_val)
                                if mapped_sku:
                                    resolved_sku = mapped_sku
                    
                    # Validate resolved SKU exists in inventory_metadata
                    if resolved_sku not in valid_skus:
                        if sku not in skipped_skus:
                            skipped_skus.append(sku)
                        continue
                        
                    try:
                        # Parse price with potential currency symbol
                        price, detected_currency = self._parse_price_with_currency(price_value)
                        
                        if price is None:
                            errors.append(f"Row {row_num}, {code}: Invalid price '{price_value}'")
                            continue
                        
                        # Priority: detected currency > explicit column > None (placeholder)
                        currency = None
                        if detected_currency:
                            currency = detected_currency
                        else:
                            explicit_currency = row.get(currency_col, '').strip().upper()
                            if explicit_currency:
                                currency = explicit_currency
                        
                        notes = row.get(notes_col, '').strip()
                        
                        entries.append({
                            'sku': resolved_sku,
                            'supplier_id': supplier['id'],
                            'unit_price': price,
                            'currency': currency,  # Can be None
                            'notes': notes if notes else None
                        })
                    except (ValueError, TypeError) as e:
                        errors.append(f"Row {row_num}, {code}: Invalid price '{price_value}'")
        
        # Bulk upsert (only entries with values)
        updated_count = 0
        if entries:
            updated_count = self.repo.bulk_upsert_pricing(entries)
        
        return {
            'imported': updated_count,
            'skipped_invalid_skus': len(skipped_skus),
            'skipped_sku_list': skipped_skus[:20],  # Show first 20
            'errors': len(errors),
            'error_details': errors[:10]  # Limit error details
        }

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
            sku_data[sku][f'{col_prefix}_notes'] = row['notes'] or ''
        
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
                'currency': row['currency'],
                'notes': row['notes']
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
                expected_notes_key = f"{supplier_code}_notes"
                
                # Find actual keys in the row using the map
                price_key = header_map.get(expected_price_key.lower())
                currency_key = header_map.get(expected_currency_key.lower())
                notes_key = header_map.get(expected_notes_key.lower())

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
                    
                    notes = ''
                    if notes_key:
                        notes = str(row.get(notes_key, '')).strip()
                    
                    # Check if this entry has actually changed
                    key = (resolved_sku, supplier['id'])
                    existing = existing_map.get(key)
                    
                    new_notes = notes if notes else None
                    
                    if existing:
                        # Compare values - only update if different
                        price_same = abs((existing['unit_price'] or 0) - price) < 0.001
                        currency_same = existing['currency'] == currency
                        notes_same = (existing['notes'] or '') == (new_notes or '')
                        
                        if price_same and currency_same and notes_same:
                            unchanged_count += 1
                            continue  # Skip - no change
                    
                    # Add to batch (new or changed)
                    entries_to_upsert.append({
                        'sku': resolved_sku,
                        'supplier_id': supplier['id'],
                        'unit_price': price,
                        'currency': currency,  # Can be None
                        'notes': new_notes
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
                'currency': e['currency'],
                'notes': e.get('notes')
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

    def import_matrix_pdf(self, pdf_bytes: bytes, supplier_id: int, progress_cb=None) -> Dict:
        """
        Parse a supplier PDF price list and return a preview of pricing changes.
        Uses product mappings to match line items to internal SKUs.
        Does NOT write to the database — caller must call bulk_upsert_pricing to apply.

        progress_cb: optional callable(percent: int, message: str) invoked as pages are
        parsed, so callers (e.g. the SSE streaming endpoint) can report live progress.
        """
        import pdfplumber
        import io

        def _report(percent: int, message: str) -> None:
            if progress_cb:
                try:
                    progress_cb(percent, message)
                except PdfParseCancelled:
                    raise  # deliberate cancellation must abort parsing
                except Exception:
                    pass  # other progress errors must never break parsing

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
        def _item_score(item: dict) -> int:
            """Higher = more complete: 2 if both ref and identifier, 1 if one, 0 if neither."""
            return (1 if item.get('ref') else 0) + (1 if item.get('identifier') else 0)

        extracted_items: list = []
        layout_anchors = None  # carried across continuation pages of multi-page invoices
        with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
            total_pages = len(pdf.pages) or 1
            for page_index, page in enumerate(pdf.pages):
                page_items: dict = {}  # primary_key -> best item so far

                def _merge(item: dict) -> None:
                    ref_key = item.get('ref', '').lower().strip()
                    id_key  = item.get('identifier', '').lower().strip()
                    primary = ref_key or id_key
                    price = item.get('price')
                    if not primary or price is None:
                        return
                    # Key by (product, price) so the SAME physical row extracted by both
                    # the table and text passes still collapses (same price → most complete
                    # wins), while two lines for the same product at DIFFERENT prices are
                    # both kept — the downstream grouping turns those into a price conflict.
                    pkey = (primary, round(float(price), 2), item.get('currency') or default_currency)
                    existing = page_items.get(pkey)
                    if existing is None or _item_score(item) > _item_score(existing):
                        page_items[pkey] = item

                # 1. Layout-aware extraction (primary, universal)
                layout_items, layout_anchors = self._extract_pdf_layout(page, layout_anchors)
                for item in layout_items:
                    _merge(item)

                # 2. Fallback ONLY when layout produced nothing on this page
                if not page_items:
                    for table in (page.extract_tables() or []):
                        for item in self._parse_pdf_table(table):
                            _merge(item)
                    text = page.extract_text() or ''
                    if text:
                        for item in self._parse_pdf_text(text):
                            _merge(item)

                extracted_items.extend(page_items.values())

                # Reserve the final 5% for the matching phase below.
                pct = int(((page_index + 1) / total_pages) * 95)
                _report(pct, f"Parsing page {page_index + 1} of {total_pages}")

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
                group['variants'].append({'price': price, 'currency': currency})

        unique_items: list = [grouped[k]['rep'] for k in group_order]

        preview: list = []
        conflicts: list = []
        unmatched: list = []

        import re as _re

        def _is_plausible(ref: str, identifier: str) -> bool:
            """Return False for clear non-product noise (addresses, headers, artifacts)."""
            full = (ref + ' ' + identifier).strip()
            if len(full) < 4:
                return False
            if not _re.search(r'[a-zA-ZÀ-ÿ]', full):
                return False
            # Count adjacent LETTER pairs that are identical — doubled-char PDF artifact.
            # Using raw count (not ratio) avoids dilution by spaces/punctuation.
            letter_doublings = sum(
                1 for i in range(len(full) - 1)
                if full[i].isalpha() and full[i].lower() == full[i + 1].lower()
            )
            if letter_doublings >= 3:
                return False
            return True

        for key in group_order:
            group = grouped[key]
            item = group['rep']
            variants = group['variants']

            identifier = item.get('identifier', '').strip()
            ref = item.get('ref', '').strip()
            price = item.get('price')
            currency = item.get('currency') or default_currency

            if not (identifier or ref) or price is None:
                continue

            if not _is_plausible(ref, identifier):
                continue

            # Resolve BOTH columns independently
            sku_from_ref  = self.repo.resolve_supplier_sku(supplier_id, ref)  if ref        else None
            sku_from_name = self.repo.resolve_supplier_sku(supplier_id, identifier) if identifier else None

            # Case 1: neither matched
            if not sku_from_ref and not sku_from_name:
                unmatched.append({
                    'raw_text': ref or identifier,
                    'price': price,
                    'currency': currency,
                    'reason': 'No product mapping found',
                    'ref': ref,
                    'identifier': identifier,
                })
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
                        {'price': v['price'], 'currency': v['currency'] or default_currency}
                        for v in variants
                    ],
                })
                continue

            preview.append({
                'sku': internal_sku,
                'supplier_product_name': display_name,
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
            'total_found': len(unique_items),
            'total_matched': len(preview),
            'total_conflicts': len(conflicts),
            'total_unmatched': len(unmatched),
        }

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

    def _extract_pdf_layout(self, page, carry_anchors=None):
        """
        Universal line-item extractor based on word positions.

        Returns (items, anchors) where items is a list of
        {ref, identifier, price, currency} dicts and anchors are the column
        anchors to carry into the next page (for multi-page invoices whose
        continuation pages omit the header).
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
        anchors = carry_anchors
        start_idx = 0
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

        sym_to_cur = {'€': 'EUR', '£': 'GBP', '$': 'USD', '¥': 'JPY'}
        items = []
        for r in rows[start_idx:]:
            buckets = defaultdict(list)
            for w in r['words']:
                buckets[_bucket(w)].append(w['text'])

            up_text = ' '.join(buckets.get('unit_price', [])).strip()
            if not up_text:
                continue
            price, currency = self._parse_price_with_currency(up_text)
            if price is None or price <= 0:
                continue

            # Reference code: first token in the ref column that contains a digit.
            ref = ''
            ref_tokens = buckets.get('ref', [])
            leftover = []
            for i, tok in enumerate(ref_tokens):
                if re.match(r'^[A-Za-z0-9][A-Za-z0-9\-/.]+$', tok) and re.search(r'\d', tok):
                    ref = tok
                    leftover = ref_tokens[:i] + ref_tokens[i + 1:]
                    break
            identifier = ' '.join(buckets.get('name', [])).strip() or ' '.join(leftover).strip()

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
