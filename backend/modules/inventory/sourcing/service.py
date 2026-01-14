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
    
    def process_csv_import(
        self,
        batch_id: int,
        rows: List[Dict[str, Any]],
        supplier_id: int,
        created_by: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        Process CSV import rows.
        Expected row format: {supplier_sku, product_name, buy_price, effective_date?}
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
                # Get or create supplier product mapping
                existing = self.repo.get_supplier_products(
                    supplier_id=supplier_id
                )
                product_match = next(
                    (p for p in existing if p['supplier_sku'] == row.get('supplier_sku')),
                    None
                )
                
                if not product_match:
                    # Create new supplier product
                    product = self.repo.create_supplier_product({
                        'supplier_id': supplier_id,
                        'supplier_sku': row['supplier_sku'],
                        'supplier_product_name': row.get('product_name', row['supplier_sku']),
                        'internal_sku': row.get('internal_sku'),
                        'is_active': True
                    })
                    product_id = product['id']
                else:
                    product_id = product_match['id']
                
                # Create price entry
                effective_date = row.get('effective_date', date.today())
                if isinstance(effective_date, str):
                    effective_date = date.fromisoformat(effective_date)
                
                self.repo.create_price({
                    'supplier_product_id': product_id,
                    'buy_price': Decimal(str(row['buy_price'])),
                    'currency': row.get('currency', 'GBP'),
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
