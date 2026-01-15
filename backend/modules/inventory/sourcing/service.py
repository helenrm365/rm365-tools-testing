"""
Service layer for Product Sourcing module
Contains business logic for supplier pricing and margin analysis
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional
from decimal import Decimal
from datetime import date
import logging

from .repo import SourcingRepo
from common.currency import convert_to_gbp

logger = logging.getLogger(__name__)


class SourcingService:
    """Service layer for product sourcing operations"""
    
    def __init__(self, repo: SourcingRepo = None):
        self.repo = repo or SourcingRepo()
    
    # ====== Supplier Operations ======
    
    def get_suppliers(self, include_inactive: bool = False) -> List[Dict[str, Any]]:
        """Get all suppliers"""
        return self.repo.get_suppliers(include_inactive=include_inactive)
    
    def get_supplier(self, supplier_id: int) -> Optional[Dict[str, Any]]:
        """Get a single supplier by ID"""
        return self.repo.get_supplier_by_id(supplier_id)
    
    def create_supplier(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new supplier"""
        return self.repo.create_supplier(data)
    
    def update_supplier(self, supplier_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update an existing supplier"""
        return self.repo.update_supplier(supplier_id, data)
    
    # ====== Supplier Product Mapping Operations ======
    
    def get_supplier_products(
        self,
        supplier_id: Optional[int] = None,
        internal_sku: Optional[str] = None,
        include_inactive: bool = False
    ) -> List[Dict[str, Any]]:
        """Get supplier product mappings"""
        return self.repo.get_supplier_products(
            supplier_id=supplier_id,
            internal_sku=internal_sku,
            include_inactive=include_inactive
        )
    
    def create_supplier_product(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new supplier product mapping"""
        return self.repo.create_supplier_product(data)
    
    def update_supplier_product(self, product_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a supplier product mapping"""
        return self.repo.update_supplier_product(product_id, data)
    
    # ====== Price Operations ======
    
    def get_price_history(
        self,
        supplier_product_id: Optional[int] = None,
        internal_sku: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get price history"""
        return self.repo.get_price_history(
            supplier_product_id=supplier_product_id,
            internal_sku=internal_sku,
            limit=limit
        )
    
    def create_price(self, data: Dict[str, Any], created_by: Optional[str] = None) -> Dict[str, Any]:
        """Create a new price entry"""
        return self.repo.create_price(data, created_by=created_by)
    
    def get_active_price(self, supplier_product_id: int) -> Optional[Dict[str, Any]]:
        """
        Get the currently active price for a supplier product.
        
        Active price is determined by:
        - effective_date <= today
        - status != 'cancelled'
        - Most recent effective_date wins (with created_at as tiebreaker)
        """
        return self.repo.get_active_price(supplier_product_id)
    
    def get_pending_prices(
        self,
        supplier_product_id: Optional[int] = None,
        supplier_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Get pending (future) prices that haven't become active yet.
        """
        return self.repo.get_pending_prices(
            supplier_product_id=supplier_product_id,
            supplier_id=supplier_id
        )
    
    def cancel_pending_price(
        self, 
        price_id: int, 
        cancelled_by: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Cancel a pending price.
        Only pending prices (effective_date > today) can be cancelled.
        """
        return self.repo.cancel_pending_price(price_id, cancelled_by=cancelled_by)
    
    def update_pending_price(
        self,
        price_id: int,
        data: Dict[str, Any],
        updated_by: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Update a pending price.
        Only pending prices (effective_date > today) can be updated.
        """
        return self.repo.update_pending_price(price_id, data, updated_by=updated_by)
    
    def get_price_with_computed_status(self, price_id: int) -> Optional[Dict[str, Any]]:
        """
        Get a single price entry with its computed status.
        """
        return self.repo.get_price_with_computed_status(price_id)
    
    # ====== Supplier Comparison ======
    
    def get_supplier_comparison(
        self, 
        internal_sku: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Get supplier price comparison, highlighting cheapest suppliers.
        Groups by internal product and ranks suppliers by price.
        """
        raw_data = self.repo.get_supplier_comparison(internal_sku=internal_sku)
        
        # Group by internal_sku
        grouped = {}
        for row in raw_data:
            sku = row['internal_sku']
            if sku not in grouped:
                grouped[sku] = {
                    'internal_sku': sku,
                    'suppliers': []
                }
            grouped[sku]['suppliers'].append({
                'supplier_id': row['supplier_id'],
                'supplier_name': row['supplier_name'],
                'supplier_sku': row['supplier_sku'],
                'supplier_product_name': row['supplier_product_name'],
                'buy_price': row['buy_price'],
                'effective_date': row['effective_date']
            })
        
        # Process each group to add rankings and identify cheapest
        result = []
        for sku, data in grouped.items():
            # Sort suppliers by price (nulls last)
            suppliers_with_price = [s for s in data['suppliers'] if s['buy_price'] is not None]
            suppliers_without_price = [s for s in data['suppliers'] if s['buy_price'] is None]
            
            suppliers_with_price.sort(key=lambda x: x['buy_price'])
            
            # Add rankings
            for i, s in enumerate(suppliers_with_price):
                s['rank'] = i + 1
                s['is_cheapest'] = (i == 0)
            
            for s in suppliers_without_price:
                s['rank'] = None
                s['is_cheapest'] = False
            
            data['suppliers'] = suppliers_with_price + suppliers_without_price
            
            # Set cheapest info at product level
            if suppliers_with_price:
                cheapest = suppliers_with_price[0]
                data['cheapest_supplier_id'] = cheapest['supplier_id']
                data['cheapest_supplier_name'] = cheapest['supplier_name']
                data['cheapest_buy_price'] = cheapest['buy_price']
            else:
                data['cheapest_supplier_id'] = None
                data['cheapest_supplier_name'] = None
                data['cheapest_buy_price'] = None
            
            result.append(data)
        
        return result
    
    # ====== Margin Calculations ======
    
    def calculate_margin(
        self, 
        buy_price: Decimal, 
        sell_price: Decimal
    ) -> Dict[str, Any]:
        """Calculate margin from buy and sell prices"""
        if not buy_price or not sell_price or sell_price == 0:
            return {'margin': None, 'margin_percent': None}
        
        margin = sell_price - buy_price
        margin_percent = float((margin / sell_price) * 100)
        
        return {
            'margin': margin,
            'margin_percent': round(margin_percent, 2)
        }
    
    # ====== Import Operations ======
    
    def create_import_batch(self, data: Dict[str, Any], created_by: Optional[str] = None) -> Dict[str, Any]:
        """Create a new import batch"""
        return self.repo.create_import_batch(data, created_by=created_by)
    
    def update_import_batch(self, batch_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update import batch status"""
        return self.repo.update_import_batch(batch_id, data)
    
    def validate_csv_import(
        self,
        rows: List[Dict[str, Any]],
        supplier_id: int
    ) -> Dict[str, Any]:
        """
        Validate CSV import and detect all conflicts before importing.
        
        Conflict Types:
        - data_error: Missing required fields, invalid format
        - duplicate_exact: Row is identical to existing mapping (skip)
        - existing_mapping: Will update an existing mapping (update)
        - pending_change: Future effective date scheduled (overwrite/skip/amend)
        
        Returns:
        {
            'valid': bool,
            'total_rows': int,
            'conflicts': [
                {
                    'row_index': int,
                    'row_data': dict,
                    'conflict_type': str,
                    'message': str,
                    'current_data': dict | None,
                    'requires_resolution': bool
                }
            ],
            'clean_rows': int,  # Rows with no conflicts
            'can_proceed': bool  # True if no data_errors
        }
        """
        conflicts = []
        clean_count = 0
        has_data_errors = False
        today = date.today()
        
        # Get existing mappings for this supplier
        existing_mappings = self.repo.get_supplier_products(supplier_id=supplier_id)
        existing_by_sku = {m['supplier_sku']: m for m in existing_mappings}
        
        # Track SKUs seen in this CSV to detect duplicates within the file
        csv_skus_seen = {}  # supplier_sku -> first row_index
        
        for i, row in enumerate(rows):
            row_conflicts = []
            
            # === Data Validation ===
            supplier_sku = row.get('supplier_sku', '').strip()
            buy_price = row.get('buy_price', '').strip()
            currency = row.get('currency', '').strip()
            internal_sku = row.get('internal_sku', '').strip()
            product_name = row.get('product_name', '').strip()
            effective_date_str = row.get('effective_date', '').strip()
            
            # Check required fields
            missing_fields = []
            if not supplier_sku:
                missing_fields.append('supplier_sku')
            if not buy_price:
                missing_fields.append('buy_price')
            if not currency:
                missing_fields.append('currency')
            if not internal_sku:
                missing_fields.append('internal_sku')
            
            if missing_fields:
                conflicts.append({
                    'row_index': i,
                    'row_number': i + 2,  # +2 for 1-based + header row
                    'row_data': row,
                    'conflict_type': 'data_error',
                    'message': f"Missing required fields: {', '.join(missing_fields)}",
                    'current_data': None,
                    'requires_resolution': False  # Can't be resolved, must fix CSV
                })
                has_data_errors = True
                continue
            
            # Validate buy_price is a valid number
            try:
                # Clean common formatting issues for better error messages
                cleaned_price = buy_price.replace(',', '').strip()
                if cleaned_price.startswith('$') or cleaned_price.startswith('£') or cleaned_price.startswith('€'):
                    raise ValueError("currency_symbol")
                if ',' in buy_price:
                    raise ValueError("comma_separator")
                
                price_value = Decimal(str(buy_price))
                if price_value < 0:
                    raise ValueError("negative_price")
            except ValueError as ve:
                error_reason = str(ve)
                if error_reason == "currency_symbol":
                    message = f"Invalid buy_price: '{buy_price}' - remove currency symbol, numbers only"
                elif error_reason == "comma_separator":
                    message = f"Invalid buy_price: '{buy_price}' - use period as decimal separator, not comma"
                elif error_reason == "negative_price":
                    message = f"Invalid buy_price: '{buy_price}' - price cannot be negative"
                else:
                    message = f"Invalid buy_price: '{buy_price}' is not a valid number"
                
                conflicts.append({
                    'row_index': i,
                    'row_number': i + 2,
                    'row_data': row,
                    'conflict_type': 'data_error',
                    'message': message,
                    'current_data': None,
                    'requires_resolution': False
                })
                has_data_errors = True
                continue
            except:
                conflicts.append({
                    'row_index': i,
                    'row_number': i + 2,
                    'row_data': row,
                    'conflict_type': 'data_error',
                    'message': f"Invalid buy_price: '{buy_price}' is not a valid number",
                    'current_data': None,
                    'requires_resolution': False
                })
                has_data_errors = True
                continue
            
            # Validate currency code
            valid_currencies = {'GBP', 'EUR', 'USD', 'CAD', 'AUD', 'JPY', 'CHF', 'CNY', 'SEK', 'NOK', 'DKK', 'PLN'}
            if currency.upper() not in valid_currencies:
                conflicts.append({
                    'row_index': i,
                    'row_number': i + 2,
                    'row_data': row,
                    'conflict_type': 'data_error',
                    'message': f"Invalid currency: '{currency}'. Must be one of: {', '.join(sorted(valid_currencies))}",
                    'current_data': None,
                    'requires_resolution': False
                })
                has_data_errors = True
                continue
            
            # Validate effective_date format if provided
            effective_date = None
            if effective_date_str:
                try:
                    effective_date = date.fromisoformat(effective_date_str)
                except:
                    conflicts.append({
                        'row_index': i,
                        'row_number': i + 2,
                        'row_data': row,
                        'conflict_type': 'data_error',
                        'message': f"Invalid effective_date: '{effective_date_str}'. Use YYYY-MM-DD format",
                        'current_data': None,
                        'requires_resolution': False
                    })
                    has_data_errors = True
                    continue
            else:
                effective_date = today
            
            # === Check for duplicate SKU within CSV ===
            if supplier_sku in csv_skus_seen:
                first_row = csv_skus_seen[supplier_sku] + 2  # +2 for 1-based + header
                conflicts.append({
                    'row_index': i,
                    'row_number': i + 2,
                    'row_data': row,
                    'conflict_type': 'data_error',
                    'message': f"Duplicate supplier_sku '{supplier_sku}' - already appears in row {first_row}",
                    'current_data': None,
                    'requires_resolution': False
                })
                has_data_errors = True
                continue
            else:
                csv_skus_seen[supplier_sku] = i
            
            # === Conflict Detection ===
            existing_mapping = existing_by_sku.get(supplier_sku)
            
            if existing_mapping:
                # Get current price for this mapping
                current_prices = self.repo.get_price_history(
                    supplier_product_id=existing_mapping['id'],
                    limit=10
                )
                current_price = current_prices[0] if current_prices else None
                
                # Check for exact duplicate
                if current_price:
                    is_exact_duplicate = (
                        str(current_price.get('buy_price')) == str(price_value) and
                        current_price.get('currency') == currency.upper() and
                        existing_mapping.get('internal_sku') == internal_sku
                    )
                    
                    if is_exact_duplicate:
                        conflicts.append({
                            'row_index': i,
                            'row_number': i + 2,
                            'row_data': row,
                            'conflict_type': 'duplicate_exact',
                            'message': 'This row is identical to the existing mapping - will be skipped',
                            'current_data': {
                                'mapping': existing_mapping,
                                'price': current_price
                            },
                            'requires_resolution': False  # Auto-skip
                        })
                        continue
                
                # Check for future pending change
                future_prices = [p for p in current_prices if p.get('effective_date') and p['effective_date'] > today]
                if future_prices:
                    future_price = future_prices[0]
                    conflicts.append({
                        'row_index': i,
                        'row_number': i + 2,
                        'row_data': row,
                        'conflict_type': 'pending_change',
                        'message': f"A price change is scheduled for {future_price['effective_date']}. This import would override it.",
                        'current_data': {
                            'mapping': existing_mapping,
                            'current_price': current_price,
                            'pending_price': future_price
                        },
                        'requires_resolution': True  # User must choose
                    })
                    continue
                
                # Existing mapping will be updated
                conflicts.append({
                    'row_index': i,
                    'row_number': i + 2,
                    'row_data': row,
                    'conflict_type': 'existing_mapping',
                    'message': 'This supplier SKU already exists - importing will update the record',
                    'current_data': {
                        'mapping': existing_mapping,
                        'price': current_price
                    },
                    'requires_resolution': True  # User should confirm
                })
            else:
                # No conflict - new mapping
                clean_count += 1
        
        return {
            'valid': not has_data_errors,
            'total_rows': len(rows),
            'conflicts': conflicts,
            'clean_rows': clean_count,
            'can_proceed': not has_data_errors,
            'has_resolvable_conflicts': any(c['requires_resolution'] for c in conflicts)
        }
    
    def process_csv_import_with_resolutions(
        self,
        batch_id: int,
        rows: List[Dict[str, Any]],
        supplier_id: int,
        resolutions: Dict[int, str],  # row_index -> 'skip' | 'update' | 'overwrite'
        created_by: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Process CSV import with user-provided conflict resolutions.
        
        Args:
            resolutions: Dict mapping row_index to resolution action:
                - 'skip': Skip this row entirely
                - 'update': Update existing mapping with new data
                - 'overwrite': Overwrite pending changes
        """
        # Re-validate to get conflict info
        validation = self.validate_csv_import(rows, supplier_id)
        
        # Build skip set from resolutions and auto-skip duplicates
        skip_indices = set()
        for conflict in validation['conflicts']:
            idx = conflict['row_index']
            if conflict['conflict_type'] == 'duplicate_exact':
                skip_indices.add(idx)
            elif conflict['conflict_type'] == 'data_error':
                skip_indices.add(idx)
            elif resolutions.get(idx) == 'skip':
                skip_indices.add(idx)
        
        # Update batch to processing
        self.repo.update_import_batch(batch_id, {
            'status': 'processing',
            'total_rows': len(rows)
        })
        
        processed = 0
        skipped = 0
        errors = 0
        error_details = []
        
        for i, row in enumerate(rows):
            if i in skip_indices:
                skipped += 1
                continue
            
            try:
                supplier_sku = row.get('supplier_sku', '').strip()
                buy_price = row.get('buy_price', '').strip()
                currency = row.get('currency', '').strip().upper()
                internal_sku = row.get('internal_sku', '').strip()
                product_name = row.get('product_name', '').strip() or supplier_sku
                effective_date_str = row.get('effective_date', '').strip()
                
                effective_date = date.fromisoformat(effective_date_str) if effective_date_str else date.today()
                
                # Get or create supplier product mapping
                existing = self.repo.get_supplier_products(supplier_id=supplier_id)
                product_match = next(
                    (p for p in existing if p['supplier_sku'] == supplier_sku),
                    None
                )
                
                if not product_match:
                    product = self.repo.create_supplier_product({
                        'supplier_id': supplier_id,
                        'supplier_sku': supplier_sku,
                        'supplier_product_name': product_name,
                        'internal_sku': internal_sku,
                        'is_active': True
                    })
                    product_id = product['id']
                else:
                    product_id = product_match['id']
                    # Update mapping if internal_sku or product_name changed
                    updates = {}
                    if product_match.get('internal_sku') != internal_sku:
                        updates['internal_sku'] = internal_sku
                    if product_name and product_match.get('supplier_product_name') != product_name:
                        updates['supplier_product_name'] = product_name
                    if updates:
                        self.repo.update_supplier_product(product_id, updates)
                
                # Create price entry
                self.repo.create_price({
                    'supplier_product_id': product_id,
                    'buy_price': Decimal(str(buy_price)),
                    'currency': currency,
                    'effective_date': effective_date,
                    'import_batch_id': batch_id
                }, created_by=created_by)
                
                processed += 1
                
            except Exception as e:
                errors += 1
                error_details.append({
                    'row': i + 1,
                    'error': str(e),
                    'data': row
                })
                logger.warning(f"Import row {i+1} failed: {e}")
        
        # Update batch to completed
        from datetime import datetime
        status = 'completed'
        if errors > 0:
            status = 'completed_with_errors'
        elif skipped > 0:
            status = 'completed_with_skips'
        
        self.repo.update_import_batch(batch_id, {
            'status': status,
            'processed_rows': processed,
            'error_rows': errors,
            'completed_at': datetime.utcnow()
        })
        
        return {
            'batch_id': batch_id,
            'total_rows': len(rows),
            'processed_rows': processed,
            'skipped_rows': skipped,
            'error_rows': errors,
            'errors': error_details if errors > 0 else None
        }

    def process_csv_import(
        self,
        batch_id: int,
        rows: List[Dict[str, Any]],
        supplier_id: int,
        created_by: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Process CSV import rows.
        Required row format: {supplier_sku, buy_price, currency, internal_sku}
        Optional: {product_name, effective_date}
        """
        # Update batch to processing
        self.repo.update_import_batch(batch_id, {
            'status': 'processing',
            'total_rows': len(rows)
        })
        
        processed = 0
        errors = 0
        error_details = []
        
        for i, row in enumerate(rows):
            try:
                # Validate required fields have values
                supplier_sku = row.get('supplier_sku', '').strip()
                buy_price = row.get('buy_price', '').strip()
                currency = row.get('currency', '').strip()
                internal_sku = row.get('internal_sku', '').strip()
                
                if not supplier_sku:
                    raise ValueError("supplier_sku is required")
                if not buy_price:
                    raise ValueError("buy_price is required")
                if not currency:
                    raise ValueError("currency is required")
                if not internal_sku:
                    raise ValueError("internal_sku is required")
                
                # Get or create supplier product mapping
                existing = self.repo.get_supplier_products(
                    supplier_id=supplier_id
                )
                product_match = next(
                    (p for p in existing if p['supplier_sku'] == supplier_sku),
                    None
                )
                
                if not product_match:
                    # Create new supplier product
                    product = self.repo.create_supplier_product({
                        'supplier_id': supplier_id,
                        'supplier_sku': supplier_sku,
                        'supplier_product_name': row.get('product_name', '').strip() or supplier_sku,
                        'internal_sku': internal_sku,
                        'is_active': True
                    })
                    product_id = product['id']
                else:
                    product_id = product_match['id']
                    # Update internal_sku if changed
                    if product_match.get('internal_sku') != internal_sku:
                        self.repo.update_supplier_product(product_id, {'internal_sku': internal_sku})
                
                # Create price entry
                effective_date_str = row.get('effective_date', '').strip()
                if effective_date_str:
                    effective_date = date.fromisoformat(effective_date_str)
                else:
                    effective_date = date.today()
                
                self.repo.create_price({
                    'supplier_product_id': product_id,
                    'buy_price': Decimal(str(buy_price)),
                    'currency': currency,
                    'effective_date': effective_date,
                    'import_batch_id': batch_id
                }, created_by=created_by)
                
                processed += 1
                
            except Exception as e:
                errors += 1
                error_details.append({
                    'row': i + 1,
                    'error': str(e),
                    'data': row
                })
                logger.warning(f"Import row {i+1} failed: {e}")
        
        # Update batch to completed
        from datetime import datetime
        self.repo.update_import_batch(batch_id, {
            'status': 'completed' if errors == 0 else 'completed_with_errors',
            'processed_rows': processed,
            'error_rows': errors,
            'completed_at': datetime.utcnow()
        })
        
        return {
            'batch_id': batch_id,
            'total_rows': len(rows),
            'processed_rows': processed,
            'error_rows': errors,
            'errors': error_details if errors > 0 else None
        }
    
    # ====== Inventory Metadata Integration ======
    
    def get_available_skus(self, search: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        """Get available SKUs from inventory_metadata for mapping"""
        return self.repo.get_available_skus(search=search, limit=limit)
    
    def get_comparison_with_inventory(self, internal_sku: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get supplier price comparison WITH Magento inventory metadata.
        This shows supplier prices alongside actual Magento product details.
        """
        raw_data = self.repo.get_comparison_with_inventory(internal_sku=internal_sku)
        
        # Extract unique SKUs to fetch product names and prices
        unique_skus = list(set(row['internal_sku'] for row in raw_data if row['internal_sku']))
        
        # Fetch product names and sell prices from Magento catalog
        product_names = self.repo.get_product_names_from_magento(unique_skus, region='uk')
        sell_prices = self.repo.get_sell_prices_from_magento(unique_skus, region='uk')
        
        # Group by internal_sku
        grouped = {}
        for row in raw_data:
            sku = row['internal_sku']
            if sku not in grouped:
                grouped[sku] = {
                    'internal_sku': sku,
                    'product_name': product_names.get(sku, ''),  # Get name from Magento catalog
                    'sell_price': sell_prices.get(sku),  # Get sell price from Magento catalog
                    'quantity_available': row.get('quantity_available'),
                    'inventory_status': row.get('inventory_status'),
                    'uk_6m_data': row.get('uk_6m_data'),
                    'fr_6m_data': row.get('fr_6m_data'),
                    'suppliers': []
                }
            
            # Only add supplier if it has data
            if row['supplier_id']:
                original_currency = row.get('currency', 'GBP')
                buy_price = row['buy_price']
                buy_price_gbp = convert_to_gbp(buy_price, original_currency) if buy_price else None
                
                # Debug logging for conversion
                if buy_price and original_currency != 'GBP':
                    logger.info(f"Converting {buy_price} {original_currency} to GBP: {buy_price_gbp}")
                
                grouped[sku]['suppliers'].append({
                    'supplier_id': row['supplier_id'],
                    'supplier_name': row['supplier_name'],
                    'supplier_sku': row['supplier_sku'],
                    'supplier_product_name': row['supplier_product_name'],
                    'pack_size': row.get('pack_size', 1),
                    'buy_price': buy_price,
                    'buy_price_gbp': buy_price_gbp,
                    'currency': original_currency,
                    'effective_date': row['effective_date']
                })
        
        # Process each group to add rankings and identify cheapest
        result = []
        for sku, data in grouped.items():
            # Sort suppliers by GBP price (nulls last) for fair comparison
            suppliers_with_price = [s for s in data['suppliers'] if s['buy_price_gbp'] is not None]
            suppliers_without_price = [s for s in data['suppliers'] if s['buy_price_gbp'] is None]
            
            suppliers_with_price.sort(key=lambda x: float(x['buy_price_gbp']))
            
            # Find the lowest GBP price to mark all suppliers with that price as cheapest
            lowest_price = float(suppliers_with_price[0]['buy_price_gbp']) if suppliers_with_price else None
            
            # Add rankings and calculate margins
            for i, s in enumerate(suppliers_with_price):
                s['rank'] = i + 1
                # Mark as cheapest if GBP price equals the lowest price
                s['is_cheapest'] = (float(s['buy_price_gbp']) == lowest_price)
                
                # Calculate per-unit price if pack size > 1 (in GBP for fair comparison)
                if s.get('pack_size', 1) > 1:
                    s['price_per_unit'] = float(s['buy_price_gbp']) / s['pack_size']
                else:
                    s['price_per_unit'] = float(s['buy_price_gbp'])
                
                # Calculate margin if we have sell price (sell price assumed in GBP)
                if data.get('sell_price'):
                    margin_data = self.calculate_margin(
                        Decimal(str(s['price_per_unit'])),
                        Decimal(str(data['sell_price']))
                    )
                    s['margin'] = float(margin_data['margin']) if margin_data['margin'] else None
                    s['margin_percent'] = margin_data['margin_percent']
                else:
                    s['margin'] = None
                    s['margin_percent'] = None
            
            for s in suppliers_without_price:
                s['rank'] = None
                s['is_cheapest'] = False
                s['price_per_unit'] = None
                s['margin'] = None
                s['margin_percent'] = None
            
            data['suppliers'] = suppliers_with_price + suppliers_without_price
            
            # Set cheapest info at product level
            if suppliers_with_price:
                cheapest = suppliers_with_price[0]
                data['cheapest_supplier_id'] = cheapest['supplier_id']
                data['cheapest_supplier_name'] = cheapest['supplier_name']
                data['cheapest_buy_price'] = cheapest['buy_price']
                data['cheapest_price_per_unit'] = cheapest.get('price_per_unit')
                data['best_margin'] = cheapest.get('margin')
                data['best_margin_percent'] = cheapest.get('margin_percent')
            else:
                data['cheapest_supplier_id'] = None
                data['cheapest_supplier_name'] = None
                data['cheapest_buy_price'] = None
                data['cheapest_price_per_unit'] = None
                data['best_margin'] = None
                data['best_margin_percent'] = None
            
            result.append(data)
        
        return result

    # ====== Daily Price Activation & Sync Logging ======
    
    def activate_prices_for_today(self) -> Dict[str, Any]:
        """
        Daily activation job: Find all prices that became active today
        and log them to the price sync log for auditing.
        
        This runs daily at 00:01 to:
        1. Find prices where effective_date = today
        2. Log each activation to sourcing_price_sync_log
        3. Return summary of activations
        
        Note: The actual price activation is automatic via the temporal
        query system - this just creates audit logs for tracking.
        """
        try:
            # Get all prices becoming active today
            prices_today = self.repo.get_prices_becoming_active_today()
            
            if not prices_today:
                logger.info("[PriceSync] No prices becoming active today")
                return {
                    'status': 'success',
                    'prices_activated': 0,
                    'details': []
                }
            
            logger.info(f"[PriceSync] Found {len(prices_today)} prices becoming active today")
            
            activated = []
            errors = []
            
            for price in prices_today:
                try:
                    # Create sync log entry
                    log_entry = self.repo.create_price_sync_log({
                        'sync_type': 'daily_activation',
                        'internal_sku': price.get('internal_sku'),
                        'supplier_product_id': price.get('supplier_product_id'),
                        'price_id': price.get('id'),
                        'previous_buy_price': price.get('previous_buy_price'),
                        'new_buy_price': price.get('buy_price'),
                        'currency': price.get('currency', 'GBP'),
                        'supplier_name': price.get('supplier_name'),
                        'effective_date': price.get('effective_date'),
                        'sync_status': 'success'
                    })
                    
                    activated.append({
                        'internal_sku': price.get('internal_sku'),
                        'supplier_name': price.get('supplier_name'),
                        'supplier_sku': price.get('supplier_sku'),
                        'previous_price': float(price.get('previous_buy_price')) if price.get('previous_buy_price') else None,
                        'new_price': float(price.get('buy_price')),
                        'currency': price.get('currency', 'GBP'),
                        'log_id': log_entry.get('id')
                    })
                    
                    logger.info(f"[PriceSync] Activated: {price.get('internal_sku')} - "
                               f"{price.get('supplier_name')} - "
                               f"£{price.get('previous_buy_price')} → £{price.get('buy_price')}")
                    
                except Exception as e:
                    error_msg = str(e)
                    logger.error(f"[PriceSync] Error activating price {price.get('id')}: {error_msg}")
                    
                    # Log the error
                    try:
                        self.repo.create_price_sync_log({
                            'sync_type': 'daily_activation',
                            'internal_sku': price.get('internal_sku'),
                            'supplier_product_id': price.get('supplier_product_id'),
                            'price_id': price.get('id'),
                            'new_buy_price': price.get('buy_price'),
                            'currency': price.get('currency', 'GBP'),
                            'supplier_name': price.get('supplier_name'),
                            'effective_date': price.get('effective_date'),
                            'sync_status': 'error',
                            'error_message': error_msg
                        })
                    except:
                        pass
                    
                    errors.append({
                        'price_id': price.get('id'),
                        'internal_sku': price.get('internal_sku'),
                        'error': error_msg
                    })
            
            result = {
                'status': 'success' if not errors else 'completed_with_errors',
                'prices_activated': len(activated),
                'errors_count': len(errors),
                'details': activated,
                'errors': errors if errors else None
            }
            
            logger.info(f"[PriceSync] Daily activation complete: {len(activated)} activated, {len(errors)} errors")
            return result
            
        except Exception as e:
            logger.error(f"[PriceSync] Daily activation failed: {e}", exc_info=True)
            return {
                'status': 'error',
                'prices_activated': 0,
                'error': str(e)
            }
    
    def get_price_sync_logs(
        self,
        internal_sku: Optional[str] = None,
        sync_type: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get price sync log entries for auditing."""
        return self.repo.get_price_sync_logs(
            internal_sku=internal_sku,
            sync_type=sync_type,
            limit=limit
        )
    
    # ====== Supplier Comparison with Pending Prices ======
    
    def get_comparison_with_pending_prices(
        self, 
        internal_sku: Optional[str] = None
    ) -> List[Dict[str, Any]]:
        """
        Get supplier comparison WITH pending price indicators.
        
        For each product, shows:
        - Current active prices from all suppliers
        - Pending prices (if any) with visual indicators
        - Whether a cheaper price is coming (e.g., "Cheaper price starting tomorrow")
        
        This ensures the Comparison View uses only ACTIVE prices for ranking,
        while still showing pending price information as indicators.
        """
        raw_data = self.repo.get_comparison_with_pending_prices(internal_sku=internal_sku)
        
        # Fetch product names and sell prices from Magento
        unique_skus = list(set(row['internal_sku'] for row in raw_data if row['internal_sku']))
        product_names = self.repo.get_product_names_from_magento(unique_skus, region='uk')
        sell_prices = self.repo.get_sell_prices_from_magento(unique_skus, region='uk')
        
        # Group by internal_sku
        grouped = {}
        for row in raw_data:
            sku = row['internal_sku']
            if sku not in grouped:
                grouped[sku] = {
                    'internal_sku': sku,
                    'product_name': product_names.get(sku, ''),
                    'sell_price': sell_prices.get(sku),
                    'suppliers': []
                }
            
            # Only add supplier if it has data
            if row['supplier_id']:
                active_price = row.get('active_buy_price')
                active_currency = row.get('active_currency', 'GBP')
                pending_price = row.get('pending_buy_price')
                pending_currency = row.get('pending_currency', 'GBP')
                
                # Convert to GBP for comparison
                active_price_gbp = convert_to_gbp(active_price, active_currency) if active_price else None
                pending_price_gbp = convert_to_gbp(pending_price, pending_currency) if pending_price else None
                
                # Build pending price indicator
                pending_indicator = None
                if pending_price is not None:
                    days_until = row.get('days_until_pending', 0)
                    is_cheaper = row.get('pending_is_cheaper', False)
                    
                    if days_until == 1:
                        date_text = "tomorrow"
                    elif days_until <= 7:
                        date_text = f"in {days_until} days"
                    else:
                        pending_date = row.get('pending_effective_date')
                        date_text = f"on {pending_date}" if pending_date else f"in {days_until} days"
                    
                    pending_indicator = {
                        'pending_price': float(pending_price),
                        'pending_price_gbp': float(pending_price_gbp) if pending_price_gbp else None,
                        'pending_currency': pending_currency,
                        'pending_effective_date': row.get('pending_effective_date'),
                        'days_until': days_until,
                        'is_cheaper': is_cheaper,
                        'indicator_text': f"{'Cheaper' if is_cheaper else 'New'} price {date_text}"
                    }
                
                grouped[sku]['suppliers'].append({
                    'supplier_id': row['supplier_id'],
                    'supplier_name': row['supplier_name'],
                    'supplier_sku': row['supplier_sku'],
                    'supplier_product_name': row['supplier_product_name'],
                    'pack_size': row.get('pack_size', 1),
                    'buy_price': active_price,
                    'buy_price_gbp': float(active_price_gbp) if active_price_gbp else None,
                    'currency': active_currency,
                    'effective_date': row.get('active_effective_date'),
                    'pending_price_info': pending_indicator
                })
        
        # Process each group to add rankings (based on ACTIVE prices only)
        result = []
        for sku, data in grouped.items():
            suppliers_with_price = [s for s in data['suppliers'] if s['buy_price_gbp'] is not None]
            suppliers_without_price = [s for s in data['suppliers'] if s['buy_price_gbp'] is None]
            
            suppliers_with_price.sort(key=lambda x: float(x['buy_price_gbp']))
            
            lowest_price = float(suppliers_with_price[0]['buy_price_gbp']) if suppliers_with_price else None
            
            for i, s in enumerate(suppliers_with_price):
                s['rank'] = i + 1
                s['is_cheapest'] = (float(s['buy_price_gbp']) == lowest_price)
                
                # Calculate per-unit price and margin
                if s.get('pack_size', 1) > 1:
                    s['price_per_unit'] = float(s['buy_price_gbp']) / s['pack_size']
                else:
                    s['price_per_unit'] = float(s['buy_price_gbp'])
                
                if data.get('sell_price'):
                    margin_data = self.calculate_margin(
                        Decimal(str(s['price_per_unit'])),
                        Decimal(str(data['sell_price']))
                    )
                    s['margin'] = float(margin_data['margin']) if margin_data['margin'] else None
                    s['margin_percent'] = margin_data['margin_percent']
                else:
                    s['margin'] = None
                    s['margin_percent'] = None
            
            for s in suppliers_without_price:
                s['rank'] = None
                s['is_cheapest'] = False
                s['price_per_unit'] = None
                s['margin'] = None
                s['margin_percent'] = None
            
            data['suppliers'] = suppliers_with_price + suppliers_without_price
            
            # Set cheapest info at product level
            if suppliers_with_price:
                cheapest = suppliers_with_price[0]
                data['cheapest_supplier_id'] = cheapest['supplier_id']
                data['cheapest_supplier_name'] = cheapest['supplier_name']
                data['cheapest_buy_price'] = cheapest['buy_price']
                data['cheapest_price_per_unit'] = cheapest.get('price_per_unit')
                data['best_margin'] = cheapest.get('margin')
                data['best_margin_percent'] = cheapest.get('margin_percent')
                
                # Check if any supplier has a cheaper pending price
                pending_cheaper = [
                    s for s in data['suppliers'] 
                    if s.get('pending_price_info') and s['pending_price_info'].get('is_cheaper')
                ]
                data['has_cheaper_pending'] = len(pending_cheaper) > 0
                data['cheaper_pending_suppliers'] = [
                    {
                        'supplier_name': s['supplier_name'],
                        'current_price': s['buy_price'],
                        'pending_price': s['pending_price_info']['pending_price'],
                        'effective_date': s['pending_price_info']['pending_effective_date'],
                        'days_until': s['pending_price_info']['days_until']
                    }
                    for s in pending_cheaper
                ]
            else:
                data['cheapest_supplier_id'] = None
                data['cheapest_supplier_name'] = None
                data['cheapest_buy_price'] = None
                data['cheapest_price_per_unit'] = None
                data['best_margin'] = None
                data['best_margin_percent'] = None
                data['has_cheaper_pending'] = False
                data['cheaper_pending_suppliers'] = []
            
            result.append(data)
        
        return result
    
    # ====== Margin Reports ======
    
    def get_margin_report(
        self,
        report_type: str = 'all',
        min_margin: Optional[float] = None,
        max_margin: Optional[float] = None,
        limit: int = 100
    ) -> Dict[str, Any]:
        """
        Get margin report using ACTIVE prices.
        
        Always uses the get_active_price() logic:
        - effective_date <= today
        - status != 'cancelled'
        - Most recent effective_date wins
        
        report_type options:
        - 'all': All products
        - 'low_margin': < 20% margin
        - 'high_margin': > 50% margin
        - 'negative_margin': Loss-making products
        
        Returns products with calculated margins based on active buy prices
        and sell prices from Magento catalog.
        """
        # Get base margin data using active prices
        raw_data = self.repo.get_margin_report_data(report_type=report_type, limit=limit * 2)
        
        # Fetch sell prices from Magento
        unique_skus = list(set(row['internal_sku'] for row in raw_data if row['internal_sku']))
        product_names = self.repo.get_product_names_from_magento(unique_skus, region='uk')
        sell_prices = self.repo.get_sell_prices_from_magento(unique_skus, region='uk')
        
        # Calculate margins
        products = []
        total_margin = 0
        margin_count = 0
        low_margin_count = 0
        negative_margin_count = 0
        
        for row in raw_data:
            sku = row['internal_sku']
            buy_price = row.get('buy_price')
            sell_price = sell_prices.get(sku)
            
            if not buy_price:
                continue
            
            # Convert buy price to GBP
            currency = row.get('currency', 'GBP')
            buy_price_gbp = convert_to_gbp(buy_price, currency)
            
            # Account for pack size
            pack_size = row.get('pack_size', 1) or 1
            price_per_unit = float(buy_price_gbp) / pack_size if buy_price_gbp else None
            
            # Calculate margin if we have sell price
            margin = None
            margin_percent = None
            if sell_price and price_per_unit:
                margin_data = self.calculate_margin(
                    Decimal(str(price_per_unit)),
                    Decimal(str(sell_price))
                )
                margin = float(margin_data['margin']) if margin_data['margin'] else None
                margin_percent = margin_data['margin_percent']
            
            # Filter by report type
            if report_type == 'low_margin' and (margin_percent is None or margin_percent >= 20):
                continue
            elif report_type == 'high_margin' and (margin_percent is None or margin_percent <= 50):
                continue
            elif report_type == 'negative_margin' and (margin_percent is None or margin_percent >= 0):
                continue
            
            # Filter by custom margin range
            if min_margin is not None and (margin_percent is None or margin_percent < min_margin):
                continue
            if max_margin is not None and (margin_percent is None or margin_percent > max_margin):
                continue
            
            # Track statistics
            if margin_percent is not None:
                total_margin += margin_percent
                margin_count += 1
                if margin_percent < 20:
                    low_margin_count += 1
                if margin_percent < 0:
                    negative_margin_count += 1
            
            products.append({
                'internal_sku': sku,
                'product_name': product_names.get(sku, ''),
                'supplier_name': row.get('supplier_name'),
                'supplier_sku': row.get('supplier_sku'),
                'buy_price': float(buy_price),
                'buy_price_gbp': float(buy_price_gbp) if buy_price_gbp else None,
                'currency': currency,
                'price_per_unit': price_per_unit,
                'sell_price': sell_price,
                'margin': margin,
                'margin_percent': margin_percent,
                'pack_size': pack_size,
                'price_effective_date': row.get('price_effective_date'),
                'quantity_available': row.get('quantity_available'),
                'inventory_status': row.get('inventory_status')
            })
            
            if len(products) >= limit:
                break
        
        # Sort by margin (lowest first for visibility)
        products.sort(key=lambda x: x['margin_percent'] if x['margin_percent'] is not None else 999)
        
        avg_margin = (total_margin / margin_count) if margin_count > 0 else None
        
        return {
            'report_type': report_type,
            'products': products,
            'count': len(products),
            'summary': {
                'average_margin': round(avg_margin, 2) if avg_margin else None,
                'low_margin_count': low_margin_count,
                'negative_margin_count': negative_margin_count,
                'products_with_margin': margin_count
            }
        }
