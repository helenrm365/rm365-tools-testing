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
        
        # Clean remaining characters
        clean_price = raw_value.replace(',', '').strip()
        
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
        # Validate supplier exists
        supplier = self.repo.get_supplier_by_id(data['supplier_id'])
        if not supplier:
            raise ValueError(f"Supplier with ID {data['supplier_id']} not found")
        
        # Check internal SKU exists in inventory_metadata
        # We can fetch all products to verify valid SKU
        all_products = self.repo.get_all_products_from_inventory_metadata()
        valid_skus = {p['sku'] for p in all_products}
        if data['internal_sku'] not in valid_skus:
            raise ValueError(f"Internal SKU '{data['internal_sku']}' not found in catalog")
            
        return self.repo.create_supplier_mapping(data)

    def delete_supplier_mapping(self, mapping_id: int) -> bool:
        """Delete a supplier product mapping"""
        return self.repo.delete_supplier_mapping(mapping_id)
