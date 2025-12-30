"""
Magento Data Client for Magento Data Module

This client fetches orders from Magento Database directly and breaks them down into product-level rows,
similar to how eMagicOne Store Manager works.
"""
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime
import pymysql

from core.config import settings
from .db import get_magento_connection

logger = logging.getLogger(__name__)

# Magento customer group ID to code mapping
CUSTOMER_GROUP_MAP = {
    0: "NOT LOGGED IN",
    1: "General",
    2: "Wholesale",
    3: "Retailer"
}


class MagentoDataClient:
    """Client to interact with Magento Database for magento data extraction"""
    
    def __init__(self, region: str = "uk"):
        """
        Initialize Magento client for a specific region.
        """
        self.region = region.lower()
        
    def get_data_direct(
        self,
        limit: int = 100,
        offset: int = 0,
        search: str = ""
    ) -> Dict[str, Any]:
        """
        Fetch data directly from Magento DB with pagination and search.
        """
        try:
            conn = get_magento_connection(self.region)
            with conn.cursor() as cursor:
                # Base query
                base_query = """
                    FROM sales_order_item soi
                    JOIN sales_order so ON soi.order_id = so.entity_id
                    LEFT JOIN sales_order_address sab ON so.billing_address_id = sab.entity_id
                    LEFT JOIN sales_order_address sas ON so.shipping_address_id = sas.entity_id
                    WHERE soi.product_type != 'configurable'
                """
                
                params = []
                
                if search:
                    search_term = f"%{search}%"
                    base_query += """
                        AND (
                            so.increment_id LIKE %s OR
                            soi.sku LIKE %s OR
                            so.customer_email LIKE %s OR
                            CONCAT(so.customer_firstname, ' ', so.customer_lastname) LIKE %s
                        )
                    """
                    params.extend([search_term, search_term, search_term, search_term])
                
                # Count query
                count_query = f"SELECT COUNT(*) as count {base_query}"
                cursor.execute(count_query, params)
                total_count = cursor.fetchone()['count']
                
                # Data query
                data_query = f"""
                    SELECT 
                        so.increment_id as order_number,
                        so.created_at,
                        so.status,
                        so.order_currency_code as currency,
                        so.grand_total,
                        so.customer_email,
                        so.customer_firstname,
                        so.customer_lastname,
                        so.customer_group_id,
                        soi.sku,
                        soi.name,
                        soi.qty_invoiced,
                        soi.original_price,
                        soi.price,
                        soi.product_type,
                        
                        -- Billing Address
                        sab.street as billing_street,
                        sab.city as billing_city,
                        sab.region as billing_region,
                        sab.postcode as billing_postcode,
                        sab.country_id as billing_country_id,
                        
                        -- Shipping Address
                        sas.street as shipping_street,
                        sas.city as shipping_city,
                        sas.region as shipping_region,
                        sas.postcode as shipping_postcode,
                        sas.country_id as shipping_country_id
                    {base_query}
                    ORDER BY so.created_at DESC 
                    LIMIT %s OFFSET %s
                """
                
                # Add limit and offset to params for data query
                data_params = params + [limit, offset]
                
                cursor.execute(data_query, data_params)
                rows = cursor.fetchall()
                
                data = []
                for row in rows:
                    processed = self._process_db_row(row)
                    if processed:
                        data.append(processed)
                        
                return {
                    "data": data,
                    "total_count": total_count
                }
                
        except Exception as e:
            logger.error(f"Error fetching direct data from Magento DB: {e}")
            raise
        finally:
            if 'conn' in locals() and conn.open:
                conn.close()

    def fetch_orders_product_breakdown(
        self,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        page_size: int = 100,
        max_orders: Optional[int] = None,
        progress_callback: Optional[callable] = None,
        sort_desc: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Fetch orders from Magento DB and break them down into product-level rows.
        
        Similar to eMagicOne Store Manager:
        - Each order is split into multiple rows, one per product
        - Each row contains: order number, SKU, product name, invoiced quantity, etc.
        - invoiced_qty is 0 for cancelled/unfulfilled orders
        
        Args:
            start_date: Start date filter (format: YYYY-MM-DD HH:MM:SS)
            end_date: End date filter (format: YYYY-MM-DD HH:MM:SS)
            page_size: Number of orders to fetch per page (Not used in DB implementation but kept for compatibility)
            max_orders: Maximum number of orders to fetch (None for all)
            progress_callback: Optional callback function to report progress
            sort_desc: Sort by created_at DESC to get latest orders first (default False for ASC)
        
        Returns:
            List of product-level rows
        """
        product_rows = []
        
        try:
            conn = get_magento_connection(self.region)
            with conn.cursor() as cursor:
                # Base query to fetch order items with order details
                # We join sales_order_item with sales_order to get order details
                # We also join with other tables if needed for customer group, addresses etc.
                
                # Note: This is a simplified query. You might need to adjust table names 
                # and joins based on your specific Magento version and schema.
                # Assuming standard Magento 2 tables: sales_order, sales_order_item, sales_order_address
                
                query = """
                    SELECT 
                        so.increment_id as order_number,
                        so.created_at,
                        so.status,
                        so.order_currency_code as currency,
                        so.grand_total,
                        so.customer_email,
                        so.customer_firstname,
                        so.customer_lastname,
                        so.customer_group_id,
                        soi.sku,
                        soi.name,
                        soi.qty_invoiced,
                        soi.original_price,
                        soi.price,
                        soi.product_type,
                        
                        -- Billing Address
                        sab.street as billing_street,
                        sab.city as billing_city,
                        sab.region as billing_region,
                        sab.postcode as billing_postcode,
                        sab.country_id as billing_country_id,
                        
                        -- Shipping Address
                        sas.street as shipping_street,
                        sas.city as shipping_city,
                        sas.region as shipping_region,
                        sas.postcode as shipping_postcode,
                        sas.country_id as shipping_country_id
                        
                    FROM sales_order_item soi
                    JOIN sales_order so ON soi.order_id = so.entity_id
                    LEFT JOIN sales_order_address sab ON so.billing_address_id = sab.entity_id
                    LEFT JOIN sales_order_address sas ON so.shipping_address_id = sas.entity_id
                    WHERE soi.product_type != 'configurable'
                """
                
                params = []
                
                if start_date:
                    query += " AND so.created_at > %s"
                    params.append(start_date)
                
                if end_date:
                    query += " AND so.created_at < %s"
                    params.append(end_date)
                
                # Sort order
                sort_direction = 'DESC' if sort_desc else 'ASC'
                query += f" ORDER BY so.created_at {sort_direction}"
                
                if max_orders:
                    query += " LIMIT %s"
                    params.append(max_orders)
                
                logger.info(f"Executing Magento DB query for {self.region}...")
                cursor.execute(query, params)
                
                rows = cursor.fetchall()
                total_count = len(rows)
                logger.info(f"Fetched {total_count} rows from Magento DB")
                
                if progress_callback:
                    progress_callback(f"Processing {total_count} rows from database...")
                
                for row in rows:
                    processed_row = self._process_db_row(row)
                    if processed_row:
                        product_rows.append(processed_row)
                        
        except Exception as e:
            logger.error(f"Error fetching data from Magento DB: {e}")
            raise
        finally:
            if 'conn' in locals() and conn.open:
                conn.close()
        
        return product_rows

    def _process_db_row(self, row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Process a raw database row into the expected format"""
        
        # Customer Name
        customer_firstname = row.get('customer_firstname') or ''
        customer_lastname = row.get('customer_lastname') or ''
        customer_full_name = f"{customer_firstname} {customer_lastname}".strip()
        
        # Customer Group
        group_id = row.get('customer_group_id')
        customer_group_code = None
        if group_id is not None:
             customer_group_code = CUSTOMER_GROUP_MAP.get(group_id, f"Group {group_id}")

        # Addresses
        billing_address = self._format_db_address(
            row.get('billing_street'),
            row.get('billing_city'),
            row.get('billing_region'),
            row.get('billing_postcode'),
            row.get('billing_country_id')
        )
        
        shipping_address = self._format_db_address(
            row.get('shipping_street'),
            row.get('shipping_city'),
            row.get('shipping_region'),
            row.get('shipping_postcode'),
            row.get('shipping_country_id')
        )
        
        if not shipping_address:
            shipping_address = billing_address

        # Price Logic
        original_price = float(row.get('original_price') or 0)
        price = float(row.get('price') or 0)
        
        special_price = None
        if original_price and price < original_price:
            special_price = price
        elif not original_price:
            original_price = price
            
        qty_invoiced = float(row.get('qty_invoiced') or 0)
        
        return {
            'order_number': row.get('order_number'),
            'created_at': str(row.get('created_at')),
            'sku': row.get('sku'),
            'name': row.get('name'),
            'qty': int(qty_invoiced),
            'original_price': original_price,
            'special_price': special_price,
            'status': row.get('status'),
            'currency': row.get('currency'),
            'grand_total': float(row.get('grand_total') or 0),
            'customer_email': row.get('customer_email'),
            'customer_full_name': customer_full_name,
            'billing_address': billing_address,
            'shipping_address': shipping_address,
            'customer_group_code': customer_group_code
        }

    def _format_db_address(self, street, city, region, postcode, country_id) -> Optional[str]:
        """Format address parts into a string"""
        parts = []
        if street:
            parts.append(street.replace('\n', ', '))
        if city:
            parts.append(city)
        if region:
            parts.append(region)
        if postcode:
            parts.append(postcode)
        if country_id:
            parts.append(country_id)
            
        return ', '.join(parts) if parts else None

    def fetch_orders_product_breakdown_batched(
        self,
        table_name: str,
        region: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        page_size: int = 1000, # Increased default page size for DB
        max_orders: Optional[int] = None,
        username: Optional[str] = None,
        repo = None,
        progress_callback: Optional[callable] = None,
        cancelled: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Fetch orders from Magento DB and process them in batches.
        """
        if not repo:
            raise ValueError("repo parameter is required for batched sync")
            
        total_rows_imported = 0
        total_orders_processed = 0
        was_cancelled = False
        error_occurred = None
        
        # For DB implementation, we can fetch in larger chunks or stream
        # But to keep logic similar to API version (resumable, batched commits),
        # we will implement pagination using LIMIT/OFFSET or keyset pagination on created_at
        
        current_offset = 0
        
        while True:
            if cancelled and cancelled():
                logger.info(f"Sync cancelled by user")
                was_cancelled = True
                break
                
            try:
                conn = get_magento_connection(self.region)
                with conn.cursor() as cursor:
                    # Query to get a batch of orders first to handle "orders processed" count correctly
                    # and to group items by order for atomic commits per batch of orders
                    
                    order_query = """
                        SELECT entity_id, increment_id, created_at 
                        FROM sales_order 
                        WHERE 1=1
                    """
                    params = []
                    
                    if start_date:
                        order_query += " AND created_at > %s"
                        params.append(start_date)
                    if end_date:
                        order_query += " AND created_at <= %s"
                        params.append(end_date)
                        
                    order_query += " ORDER BY created_at ASC LIMIT %s OFFSET %s"
                    params.append(page_size)
                    params.append(current_offset)
                    
                    cursor.execute(order_query, params)
                    orders_batch = cursor.fetchall()
                    
                    if not orders_batch:
                        break
                        
                    order_ids = [o['entity_id'] for o in orders_batch]
                    if not order_ids:
                        break
                        
                    # Now fetch items for these orders
                    placeholders = ','.join(['%s'] * len(order_ids))
                    items_query = f"""
                        SELECT 
                            so.increment_id as order_number,
                            so.created_at,
                            so.status,
                            so.order_currency_code as currency,
                            so.grand_total,
                            so.customer_email,
                            so.customer_firstname,
                            so.customer_lastname,
                            so.customer_group_id,
                            soi.sku,
                            soi.name,
                            soi.qty_invoiced,
                            soi.original_price,
                            soi.price,
                            soi.product_type,
                            sab.street as billing_street,
                            sab.city as billing_city,
                            sab.region as billing_region,
                            sab.postcode as billing_postcode,
                            sab.country_id as billing_country_id,
                            sas.street as shipping_street,
                            sas.city as shipping_city,
                            sas.region as shipping_region,
                            sas.postcode as shipping_postcode,
                            sas.country_id as shipping_country_id
                        FROM sales_order_item soi
                        JOIN sales_order so ON soi.order_id = so.entity_id
                        LEFT JOIN sales_order_address sab ON so.billing_address_id = sab.entity_id
                        LEFT JOIN sales_order_address sas ON so.shipping_address_id = sas.entity_id
                        WHERE soi.product_type != 'configurable'
                        AND so.entity_id IN ({placeholders})
                    """
                    
                    cursor.execute(items_query, order_ids)
                    items_rows = cursor.fetchall()
                    
                    # Process rows
                    batch_product_rows = []
                    for row in items_rows:
                        processed = self._process_db_row(row)
                        if processed:
                            batch_product_rows.append(processed)
                            
                    # Determine last order date for metadata
                    last_order_date = orders_batch[-1]['created_at']
                    
                    # Import batch
                    if batch_product_rows:
                        try:
                            repo.import_batch_with_metadata(
                                table_name=table_name,
                                product_rows=batch_product_rows,
                                region=region,
                                last_order_date=last_order_date,
                                orders_count=len(orders_batch),
                                username=username
                            )
                            total_rows_imported += len(batch_product_rows)
                            total_orders_processed += len(orders_batch)
                            
                            if progress_callback:
                                progress_callback(f"Processed {total_orders_processed} orders, {total_rows_imported} rows imported")
                                
                        except Exception as e:
                            error_occurred = f"Database error during import: {str(e)}"
                            logger.error(error_occurred)
                            break
                    else:
                        # No product rows (e.g. all configurable or cancelled with no invoice), but we advanced orders
                        repo.update_sync_metadata(
                            region=region,
                            last_order_date=last_order_date,
                            orders_count=len(orders_batch),
                            rows_count=0,
                            username=username
                        )
                        total_orders_processed += len(orders_batch)

                    current_offset += len(orders_batch)
                    
                    if max_orders and total_orders_processed >= max_orders:
                        break
                        
            except Exception as e:
                error_occurred = f"Error fetching from Magento DB: {str(e)}"
                logger.error(error_occurred)
                break
            finally:
                if 'conn' in locals() and conn.open:
                    conn.close()
                    
        return {
            'rows_imported': total_rows_imported,
            'orders_processed': total_orders_processed,
            'was_cancelled': was_cancelled,
            'error': error_occurred
        }
