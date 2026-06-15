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
                # Base query - exclude configurable products and FREE GIFT items
                # FREE GIFT (UK) and Cadeaux gratuits (FR) items are excluded to prevent duplicate conflicts
                base_query = """
                    FROM sales_order_item soi
                    JOIN sales_order so ON soi.order_id = so.entity_id
                    LEFT JOIN sales_order_address sab ON so.billing_address_id = sab.entity_id
                    LEFT JOIN sales_order_address sas ON so.shipping_address_id = sas.entity_id
                    WHERE soi.product_type != 'configurable'
                    AND LOWER(soi.name) NOT LIKE '%%free gift%%'
                    AND LOWER(soi.name) NOT LIKE '%%cadeaux gratuits%%'
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
                
                # Data query with GROUP BY to aggregate duplicate SKUs within same order
                # (can happen when customer adds same product to cart multiple times)
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
                        MAX(soi.name) as name,
                        SUM(soi.qty_invoiced) as qty_invoiced,
                        MAX(soi.original_price) as original_price,
                        MAX(soi.price) as price,
                        MAX(soi.product_type) as product_type,
                        
                        -- Billing Address
                        MAX(sab.street) as billing_street,
                        MAX(sab.city) as billing_city,
                        MAX(sab.region) as billing_region,
                        MAX(sab.postcode) as billing_postcode,
                        MAX(sab.country_id) as billing_country_id,
                        
                        -- Shipping Address
                        MAX(sas.street) as shipping_street,
                        MAX(sas.city) as shipping_city,
                        MAX(sas.region) as shipping_region,
                        MAX(sas.postcode) as shipping_postcode,
                        MAX(sas.country_id) as shipping_country_id,
                        
                        -- Shipping Method
                        so.shipping_description
                    {base_query}
                    GROUP BY so.increment_id, so.created_at, so.status, so.order_currency_code,
                             so.grand_total, so.customer_email, so.customer_firstname,
                             so.customer_lastname, so.customer_group_id, soi.sku,
                             so.shipping_description
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
                
                # Use GROUP BY to aggregate duplicate SKUs within the same order
                # (can happen when customer adds same product to cart multiple times)
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
                        MAX(soi.name) as name,
                        SUM(soi.qty_invoiced) as qty_invoiced,
                        MAX(soi.original_price) as original_price,
                        MAX(soi.price) as price,
                        MAX(soi.product_type) as product_type,
                        
                        -- Billing Address
                        MAX(sab.street) as billing_street,
                        MAX(sab.city) as billing_city,
                        MAX(sab.region) as billing_region,
                        MAX(sab.postcode) as billing_postcode,
                        MAX(sab.country_id) as billing_country_id,
                        
                        -- Shipping Address
                        MAX(sas.street) as shipping_street,
                        MAX(sas.city) as shipping_city,
                        MAX(sas.region) as shipping_region,
                        MAX(sas.postcode) as shipping_postcode,
                        MAX(sas.country_id) as shipping_country_id,
                        
                        -- Shipping Method
                        so.shipping_description
                        
                    FROM sales_order_item soi
                    JOIN sales_order so ON soi.order_id = so.entity_id
                    LEFT JOIN sales_order_address sab ON so.billing_address_id = sab.entity_id
                    LEFT JOIN sales_order_address sas ON so.shipping_address_id = sas.entity_id
                    WHERE soi.product_type != 'configurable'
                    AND LOWER(soi.name) NOT LIKE '%%free gift%%'
                    AND LOWER(soi.name) NOT LIKE '%%cadeaux gratuits%%'
                """
                
                params = []
                
                if start_date:
                    query += " AND so.created_at > %s"
                    params.append(start_date)
                
                if end_date:
                    query += " AND so.created_at < %s"
                    params.append(end_date)
                
                # GROUP BY to aggregate duplicate SKUs within the same order
                query += """ GROUP BY so.increment_id, so.created_at, so.status, so.order_currency_code,
                             so.grand_total, so.customer_email, so.customer_firstname,
                             so.customer_lastname, so.customer_group_id, soi.sku,
                             so.shipping_description"""
                
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

        # Shipping Method
        shipping_method = row.get('shipping_description') or ''

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
            'shipping_method': shipping_method,
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

    def fetch_shipping_methods_bulk(self, order_numbers: List[str], chunk_callback=None) -> Dict[str, str]:
        """
        Fetch shipping_description for a list of order numbers from Magento DB.
        Uses one connection and processes in chunks of 10,000.
        
        If chunk_callback is provided, it is called after each chunk as:
            chunk_callback(chunk_map, fetched_so_far, total)
        This enables pipelining (caller can update PG immediately per chunk).
        
        Returns the full combined dict mapping order_number -> shipping_description.
        """
        if not order_numbers:
            return {}
        
        conn = get_magento_connection(self.region)
        try:
            with conn.cursor() as cursor:
                result = {}
                total = len(order_numbers)
                chunk_size = 10000
                for i in range(0, total, chunk_size):
                    chunk = order_numbers[i:i + chunk_size]
                    placeholders = ', '.join(['%s'] * len(chunk))
                    cursor.execute(
                        f"SELECT increment_id, shipping_description FROM sales_order WHERE increment_id IN ({placeholders})",
                        chunk
                    )
                    chunk_map = {}
                    for row in cursor.fetchall():
                        desc = row.get('shipping_description') or ''
                        if desc:
                            chunk_map[row['increment_id']] = desc
                    result.update(chunk_map)
                    if chunk_callback:
                        chunk_callback(chunk_map, min(i + chunk_size, total), total)
                return result
        except Exception as e:
            logger.error(f"Error fetching shipping methods in bulk: {e}")
            raise
        finally:
            try:
                conn.close()
            except Exception:
                pass

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
        cancelled: Optional[callable] = None,
        dry_run: bool = False
    ) -> Dict[str, Any]:
        """
        Fetch orders from Magento DB and process them in batches.
        Uses keyset pagination for efficient large dataset processing.
        """
        if not repo:
            raise ValueError("repo parameter is required for batched sync")
            
        total_rows_imported = 0
        total_orders_processed = 0
        was_cancelled = False
        error_occurred = None
        
        # Dry-run accumulator variables
        total_sim_inserted = 0
        total_sim_updated = 0
        total_sim_skipped = 0
        
        # Use keyset pagination instead of OFFSET for much better performance
        # Track the last created_at and entity_id to paginate efficiently
        last_created_at = start_date
        last_entity_id = 0
        
        logger.info(f"[SYNC DEBUG] Starting batched fetch with start_date={start_date}, end_date={end_date} (dry_run: {dry_run})")
        
        while True:
            if cancelled and cancelled():
                logger.info(f"Sync cancelled by user")
                was_cancelled = True
                break
                
            try:
                conn = get_magento_connection(self.region)
                with conn.cursor() as cursor:
                    # Keyset pagination: use (created_at, entity_id) for stable ordering
                    # This is much faster than OFFSET for large datasets
                    order_query = """
                        SELECT entity_id, increment_id, created_at 
                        FROM sales_order 
                        WHERE 1=1
                    """
                    params = []
                    
                    # Keyset condition: get orders after the last one we processed
                    if last_created_at:
                        order_query += " AND (created_at > %s OR (created_at = %s AND entity_id > %s))"
                        params.extend([last_created_at, last_created_at, last_entity_id])
                    
                    if end_date:
                        order_query += " AND created_at <= %s"
                        params.append(end_date)
                        
                    order_query += " ORDER BY created_at ASC, entity_id ASC LIMIT %s"
                    params.append(page_size)
                    
                    logger.info(f"[SYNC DEBUG] Executing order query with params: {params}")
                    cursor.execute(order_query, params)
                    orders_batch = cursor.fetchall()
                    
                    if not orders_batch:
                        logger.info(f"[SYNC DEBUG] No more orders found, ending sync")
                        break
                    
                    # Log the date range of orders in this batch
                    first_order_date = orders_batch[0]['created_at']
                    last_order_date = orders_batch[-1]['created_at']
                    logger.info(f"[SYNC DEBUG] Batch has {len(orders_batch)} orders from {first_order_date} to {last_order_date}")
                        
                    order_ids = [o['entity_id'] for o in orders_batch]
                    if not order_ids:
                        break
                        
                    # Now fetch items for these orders
                    # Use GROUP BY to aggregate duplicate SKUs within the same order
                    # (can happen when customer adds same product to cart multiple times)
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
                            MAX(soi.name) as name,
                            SUM(soi.qty_invoiced) as qty_invoiced,
                            MAX(soi.original_price) as original_price,
                            MAX(soi.price) as price,
                            MAX(soi.product_type) as product_type,
                            MAX(sab.street) as billing_street,
                            MAX(sab.city) as billing_city,
                            MAX(sab.region) as billing_region,
                            MAX(sab.postcode) as billing_postcode,
                            MAX(sab.country_id) as billing_country_id,
                            MAX(sas.street) as shipping_street,
                            MAX(sas.city) as shipping_city,
                            MAX(sas.region) as shipping_region,
                            MAX(sas.postcode) as shipping_postcode,
                            MAX(sas.country_id) as shipping_country_id,
                            so.shipping_description
                        FROM sales_order_item soi
                        JOIN sales_order so ON soi.order_id = so.entity_id
                        LEFT JOIN sales_order_address sab ON so.billing_address_id = sab.entity_id
                        LEFT JOIN sales_order_address sas ON so.shipping_address_id = sas.entity_id
                        WHERE soi.product_type != 'configurable'
                        AND LOWER(soi.name) NOT LIKE '%%free gift%%'
                        AND LOWER(soi.name) NOT LIKE '%%cadeaux gratuits%%'
                        AND so.entity_id IN ({placeholders})
                        GROUP BY so.increment_id, so.created_at, so.status, so.order_currency_code,
                                 so.grand_total, so.customer_email, so.customer_firstname,
                                 so.customer_lastname, so.customer_group_id, soi.sku,
                                 so.shipping_description
                    """
                    
                    cursor.execute(items_query, order_ids)
                    items_rows = cursor.fetchall()
                    
                    # Check for duplicates that were grouped - run a detection query
                    # Show detailed info including product_type and individual quantities
                    duplicates_query = f"""
                        SELECT 
                            so.increment_id as order_number,
                            soi.sku,
                            soi.name,
                            soi.product_type,
                            soi.qty_invoiced,
                            soi.qty_ordered,
                            soi.item_id
                        FROM sales_order_item soi
                        JOIN sales_order so ON soi.order_id = so.entity_id
                        WHERE soi.product_type != 'configurable'
                        AND LOWER(soi.name) NOT LIKE '%%free gift%%'
                        AND LOWER(soi.name) NOT LIKE '%%cadeaux gratuits%%'
                        AND so.entity_id IN ({placeholders})
                        AND (so.increment_id, soi.sku) IN (
                            SELECT so2.increment_id, soi2.sku
                            FROM sales_order_item soi2
                            JOIN sales_order so2 ON soi2.order_id = so2.entity_id
                            WHERE soi2.product_type != 'configurable'
                            AND LOWER(soi2.name) NOT LIKE '%%free gift%%'
                            AND LOWER(soi2.name) NOT LIKE '%%cadeaux gratuits%%'
                            AND so2.entity_id IN ({placeholders})
                            GROUP BY so2.increment_id, soi2.sku
                            HAVING COUNT(*) > 1
                        )
                        ORDER BY so.increment_id, soi.sku
                    """
                    cursor.execute(duplicates_query, order_ids + order_ids)
                    duplicates = cursor.fetchall()
                    
                    if duplicates:
                        logger.warning(f"[GENUINE DUPLICATES] Found {len(duplicates)} duplicate (order_number, sku) rows that were GROUPED:")
                        for dup in duplicates:
                            logger.warning(f"  -> Order: {dup['order_number']}, SKU: {dup['sku']}, "
                                         f"product_type: {dup['product_type']}, "
                                         f"qty_invoiced: {dup['qty_invoiced']}, qty_ordered: {dup['qty_ordered']}, "
                                         f"item_id: {dup['item_id']}, name: {dup['name'][:50] if dup['name'] else 'N/A'}...")
                    
                    # Process rows
                    batch_product_rows = []
                    for row in items_rows:
                        processed = self._process_db_row(row)
                        if processed:
                            batch_product_rows.append(processed)
                            
                    # Determine last order date for metadata
                    last_order_date = orders_batch[-1]['created_at']
                    
                    # Update keyset pagination cursors for next iteration
                    last_created_at = orders_batch[-1]['created_at']
                    last_entity_id = orders_batch[-1]['entity_id']
                    
                    # Import batch
                    if batch_product_rows:
                        try:
                            if dry_run:
                                sim_result = repo.simulate_batch_import(
                                    table_name=table_name,
                                    product_rows=batch_product_rows
                                )
                                total_sim_inserted += sim_result.get('inserted', 0)
                                total_sim_updated += sim_result.get('updated', 0)
                                total_sim_skipped += sim_result.get('skipped', 0)
                                total_orders_processed += len(orders_batch)
                                
                                if progress_callback:
                                    progress_callback(f"[Dry Run] Checked {total_orders_processed} orders. Would insert {total_sim_inserted}, update {total_sim_updated}")
                            else:
                                import_result = repo.import_batch_with_metadata(
                                    table_name=table_name,
                                    product_rows=batch_product_rows,
                                    region=region,
                                    last_order_date=last_order_date,
                                    orders_count=len(orders_batch),
                                    username=username
                                )
                                total_rows_imported += import_result.get('rows_imported', 0)
                                total_orders_processed += len(orders_batch)
                                
                                if progress_callback:
                                    progress_callback(f"Processed {total_orders_processed} orders, {total_rows_imported} new/updated rows")
                                
                        except Exception as e:
                            error_occurred = f"Database error during import: {str(e)}"
                            logger.error(error_occurred)
                            break
                    else:
                        # No product rows (e.g. all configurable or cancelled with no invoice), but we advanced orders
                        if not dry_run:
                            repo.update_sync_metadata(
                                region=region,
                                last_order_date=last_order_date,
                                orders_count=len(orders_batch),
                                rows_count=0,
                                username=username
                            )
                        total_orders_processed += len(orders_batch)
                    
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
            'error': error_occurred,
            'dry_run': dry_run,
            'sim_inserted': total_sim_inserted,
            'sim_updated': total_sim_updated,
            'sim_skipped': total_sim_skipped
        }

    def search_customers(self, search_term: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Search for customers in live Magento DB"""
        try:
            conn = get_magento_connection(self.region)
            with conn.cursor() as cursor:
                # Search in sales_order table which definitely exists
                search_pattern = f"%{search_term}%"
                query = """
                    SELECT DISTINCT 
                        so.customer_email,
                        CONCAT(so.customer_firstname, ' ', so.customer_lastname) as customer_name
                    FROM sales_order so
                    WHERE (so.customer_email LIKE %s 
                        OR so.customer_firstname LIKE %s 
                        OR so.customer_lastname LIKE %s
                        OR CONCAT(so.customer_firstname, ' ', so.customer_lastname) LIKE %s)
                    AND so.customer_email IS NOT NULL
                    ORDER BY so.customer_email
                    LIMIT %s
                """
                cursor.execute(query, (search_pattern, search_pattern, search_pattern, search_pattern, limit))
                rows = cursor.fetchall()
                
                return [
                    {"email": row['customer_email'], "full_name": row['customer_name']}
                    for row in rows
                ]
            conn.close()
        except Exception as e:
            logger.error(f"Error searching customers in Magento: {e}")
            return []

    def get_customer_groups(self) -> List[str]:
        """Get customer groups from live Magento DB"""
        try:
            conn = get_magento_connection(self.region)
            with conn.cursor() as cursor:
                # Try new Magento 2 structure first (customer_group table)
                try:
                    query = "SELECT customer_group_code FROM customer_group ORDER BY customer_group_code"
                    cursor.execute(query)
                    rows = cursor.fetchall()
                    conn.close()
                    if rows:
                        return [row['customer_group_code'] for row in rows]
                except Exception:
                    # If that fails, try extracting from sales_order
                    cursor.execute("""
                        SELECT DISTINCT so.customer_group_id
                        FROM sales_order so
                        WHERE so.customer_group_id IS NOT NULL
                        ORDER BY so.customer_group_id
                    """)
                    rows = cursor.fetchall()
                    conn.close()
                    # Map IDs to names using CUSTOMER_GROUP_MAP
                    return [CUSTOMER_GROUP_MAP.get(row['customer_group_id'], f"Group {row['customer_group_id']}") 
                           for row in rows]
        except Exception as e:
            logger.error(f"Error getting customer groups from Magento: {e}")
            return []
