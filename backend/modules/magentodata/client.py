"""
Magento API Client for Magento Data Module

This client fetches orders from Magento and breaks them down into product-level rows,
similar to how eMagicOne Store Manager works.
"""
import requests
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime

from core.config import settings

logger = logging.getLogger(__name__)

# Magento customer group ID to code mapping
CUSTOMER_GROUP_MAP = {
    0: "NOT LOGGED IN",
    1: "General",
    2: "Wholesale",
    3: "Retailer"
}


class MagentoDataClient:
    """Client to interact with Magento REST API for sales data extraction"""
    
    def __init__(self, region: str = "uk"):
        """
        Initialize Magento client for a specific region.
        For now, all regions use UK connection until FR/NL are configured in .env
        """
        self.region = region.lower()
        
        # For now, use UK Magento connection for all regions
        # TODO: Add region-specific credentials when FR and NL are configured
        self.base_url = (settings.MAGENTO_BASE_URL or '').rstrip('/')
        self.access_token = settings.MAGENTO_ACCESS_TOKEN or ''
        
        if not self.base_url:
            raise ValueError("MAGENTO_BASE_URL environment variable not set")
        if not self.access_token:
            raise ValueError("MAGENTO_ACCESS_TOKEN environment variable not set")
        
        self.headers = {
            'Authorization': f'Bearer {self.access_token}',
            'Content-Type': 'application/json'
        }
    
    def _make_request(self, endpoint: str, method: str = 'GET', params: Optional[Dict] = None) -> Any:
        """Make a request to Magento API"""
        # Safety guard: Only allow GET requests
        if method.upper() != 'GET':
            raise ValueError(f"Only GET requests are allowed. Attempted method: {method}")
        
        url = f"{self.base_url}/rest/V1/{endpoint}"
        
        try:
            response = requests.request(
                method=method,
                url=url,
                headers=self.headers,
                params=params,
                timeout=30
            )
            response.raise_for_status()
            return response.json()
        except requests.exceptions.RequestException as e:
            logger.error(f"Magento API error: {str(e)}")
            raise Exception(f"Magento API error: {str(e)}")
    
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
        Fetch orders from Magento and break them down into product-level rows.
        
        Similar to eMagicOne Store Manager:
        - Each order is split into multiple rows, one per product
        - Each row contains: order number, SKU, product name, invoiced quantity, etc.
        - invoiced_qty is 0 for cancelled/unfulfilled orders
        
        Args:
            start_date: Start date filter (format: YYYY-MM-DD HH:MM:SS)
            end_date: End date filter (format: YYYY-MM-DD HH:MM:SS)
            page_size: Number of orders to fetch per page
            max_orders: Maximum number of orders to fetch (None for all)
            progress_callback: Optional callback function to report progress
            sort_desc: Sort by created_at DESC to get latest orders first (default False for ASC)
        
        Returns:
            List of product-level rows
        """
        product_rows = []
        current_page = 1
        total_orders_fetched = 0
        
        while True:
            # Build search criteria
            sort_direction = 'DESC' if sort_desc else 'ASC'
            params = {
                'searchCriteria[pageSize]': str(page_size),
                'searchCriteria[currentPage]': str(current_page),
                'searchCriteria[sortOrders][0][field]': 'created_at',
                'searchCriteria[sortOrders][0][direction]': sort_direction
            }
            
            filter_index = 0
            
            # Add date filters if provided
            if start_date:
                # Use 'gt' (greater than) to exclude already-synced orders
                params[f'searchCriteria[filterGroups][{filter_index}][filters][0][field]'] = 'created_at'
                params[f'searchCriteria[filterGroups][{filter_index}][filters][0][value]'] = start_date
                params[f'searchCriteria[filterGroups][{filter_index}][filters][0][conditionType]'] = 'gt'
                filter_index += 1
            
            if end_date:
                # Use 'lt' (less than) to get orders before the specified date
                params[f'searchCriteria[filterGroups][{filter_index}][filters][0][field]'] = 'created_at'
                params[f'searchCriteria[filterGroups][{filter_index}][filters][0][value]'] = end_date
                params[f'searchCriteria[filterGroups][{filter_index}][filters][0][conditionType]'] = 'lt'
                filter_index += 1
            
            # Fetch orders
            try:
                logger.info(f"Fetching page {current_page} of orders from Magento...")
                result = self._make_request('orders', params=params)
                orders = result.get('items', [])
                total_count = result.get('total_count', 0)
                
                if not orders:
                    logger.info(f"No more orders to fetch. Total fetched: {total_orders_fetched}")
                    break
                
                logger.info(f"Processing {len(orders)} orders from page {current_page}...")
                
                # Report progress if callback provided
                if progress_callback:
                    progress_msg = f"Processing page {current_page} ({total_orders_fetched}/{total_count} orders, {len(product_rows)} rows)"
                    progress_callback(progress_msg)
                
                # Process each order and break it down into product-level rows
                for order in orders:
                    rows = self._extract_product_rows(order)
                    product_rows.extend(rows)
                    total_orders_fetched += 1
                    
                    # Check if we've reached the max orders limit
                    if max_orders and total_orders_fetched >= max_orders:
                        logger.info(f"Reached max orders limit: {max_orders}")
                        if progress_callback:
                            progress_callback(f"Completed: {total_orders_fetched} orders, {len(product_rows)} rows")
                        return product_rows
                
                # Check if there are more pages
                if len(orders) < page_size or current_page * page_size >= total_count:
                    logger.info(f"Fetched all available orders. Total: {total_orders_fetched}")
                    if progress_callback:
                        progress_callback(f"Completed: {total_orders_fetched} orders, {len(product_rows)} rows")
                    break
                
                current_page += 1
                
            except Exception as e:
                logger.error(f"Error fetching orders on page {current_page}: {e}")
                break
        
        logger.info(f"Extracted {len(product_rows)} product-level rows from {total_orders_fetched} orders")
        return product_rows
    
    def _extract_product_rows(self, order: Dict[str, Any]) -> List[Dict[str, Any]]:
        """
        Extract product-level rows from a single order.
        
        Each order item becomes a separate row with:
        - order_number: Order increment ID
        - created_at: Order creation date
        - sku: Product SKU
        - name: Product name
        - qty: Invoiced quantity (0 if not invoiced/cancelled)
        - original_price: Original unit price
        - special_price: Special/discounted price (if applicable)
        - status: Order status
        - currency: Order currency
        - grand_total: Order grand total
        - customer_email: Customer email
        - customer_full_name: Customer name
        - billing_address: Formatted billing address
        - shipping_address: Formatted shipping address
        - customer_group_code: Customer group
        """
        rows = []
        
        order_number = order.get('increment_id', '')
        created_at = order.get('created_at', '')
        status = order.get('status', '')
        currency = order.get('order_currency_code', '')
        grand_total = float(order.get('grand_total', 0))
        
        # Customer information
        customer_email = order.get('customer_email', '')
        customer_firstname = order.get('customer_firstname', '')
        customer_lastname = order.get('customer_lastname', '')
        customer_full_name = f"{customer_firstname} {customer_lastname}".strip()
        
        # Get customer group - try multiple fields
        customer_group_code = None
        if 'extension_attributes' in order and 'customer_group_code' in order['extension_attributes']:
            customer_group_code = order['extension_attributes']['customer_group_code']
        elif 'customer_group_id' in order:
            # Map group ID to code using standard Magento mapping
            group_id = order.get('customer_group_id')
            if group_id is not None:
                try:
                    group_id_int = int(group_id)
                    customer_group_code = CUSTOMER_GROUP_MAP.get(group_id_int, f"Group {group_id_int}")
                except (ValueError, TypeError):
                    customer_group_code = str(group_id)
        
        # Billing address
        billing_address = self._format_address(order.get('billing_address'))
        
        # Shipping address (try extension_attributes first, then fallback)
        shipping_address = None
        ext_attrs = order.get('extension_attributes', {})
        if ext_attrs.get('shipping_assignments'):
            shipping_assignment = ext_attrs['shipping_assignments'][0]
            if shipping_assignment.get('shipping'):
                shipping_addr = shipping_assignment['shipping'].get('address', {})
                shipping_address = self._format_address(shipping_addr)
        
        # If no shipping address found, use billing as fallback
        if not shipping_address:
            shipping_address = billing_address
        
        # Get invoiced quantities for each product
        # Build a map of SKU -> invoiced quantity
        invoiced_qtys = {}
        
        # Check if order has invoices
        if 'extension_attributes' in order and 'invoices' in order['extension_attributes']:
            for invoice in order['extension_attributes']['invoices']:
                # Only count invoices that are in state 2 (paid) or 1 (pending)
                invoice_state = invoice.get('state', 0)
                if invoice_state in [1, 2]:  # 1=pending, 2=paid
                    for item in invoice.get('items', []):
                        sku = item.get('sku')
                        qty = float(item.get('qty', 0))
                        if sku:
                            invoiced_qtys[sku] = invoiced_qtys.get(sku, 0) + qty
        
        # Process order items
        for item in order.get('items', []):
            # Skip parent/configurable items, only process simple products
            if item.get('product_type') == 'configurable':
                continue
            
            sku = item.get('sku', '')
            name = item.get('name', '')
            
            # Extract price information
            original_price = float(item.get('original_price', 0)) if item.get('original_price') else None
            price = float(item.get('price', 0))
            
            # Determine special_price
            # If the actual price is different from original_price, use it as special_price
            special_price = None
            if original_price and price < original_price:
                special_price = price
            elif not original_price:
                # If no original_price, treat the current price as original
                original_price = price
            
            # Get invoiced quantity for this SKU
            # If order is cancelled or not invoiced, qty will be 0
            qty_invoiced = invoiced_qtys.get(sku, 0)
            
            # Only include items with a valid SKU
            if sku:
                row = {
                    'order_number': order_number,
                    'created_at': created_at,
                    'sku': sku,
                    'name': name,
                    'qty': int(qty_invoiced),  # invoiced quantity
                    'original_price': original_price,
                    'special_price': special_price,
                    'status': status,
                    'currency': currency,
                    'grand_total': grand_total,
                    'customer_email': customer_email,
                    'customer_full_name': customer_full_name,
                    'billing_address': billing_address,
                    'shipping_address': shipping_address,
                    'customer_group_code': customer_group_code
                }
                rows.append(row)
        
        return rows
    
    def _format_address(self, address: Optional[Dict[str, Any]]) -> Optional[str]:
        """Format an address dictionary into a single string"""
        if not address:
            return None
        
        parts = []
        
        # Street
        street = address.get('street', [])
        if isinstance(street, list):
            parts.extend([s for s in street if s])
        elif street:
            parts.append(street)
        
        # City
        if address.get('city'):
            parts.append(address.get('city'))
        
        # Region
        if address.get('region'):
            parts.append(address.get('region'))
        
        # Postcode
        if address.get('postcode'):
            parts.append(address.get('postcode'))
        
        # Country
        if address.get('country_id'):
            parts.append(address.get('country_id'))
        
        return ', '.join(parts) if parts else None
    
    def fetch_orders_product_breakdown_batched(
        self,
        table_name: str,
        region: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        page_size: int = 100,
        max_orders: Optional[int] = None,
        username: Optional[str] = None,
        repo = None,
        progress_callback: Optional[callable] = None,
        cancelled: Optional[callable] = None
    ) -> Dict[str, Any]:
        """
        Fetch orders from Magento and process them in batches, saving metadata after each batch.
        This enables incremental progress tracking and graceful cancellation.
        
        Args:
            table_name: Database table to save to
            region: Region being synced (for metadata)
            start_date: Start date filter (format: YYYY-MM-DD HH:MM:SS)
            end_date: End date filter (format: YYYY-MM-DD HH:MM:SS)
            page_size: Number of orders to fetch per page
            max_orders: Maximum number of orders to fetch (None for all)
            username: User performing the sync
            repo: Repository instance for saving data and metadata
            progress_callback: Optional callback function to report progress
            cancelled: Optional callable that returns True if sync should be cancelled
        
        Returns:
            Dict with rows_imported, orders_processed, and was_cancelled status
        """
        if not repo:
            raise ValueError("repo parameter is required for batched sync")
        
        total_rows_imported = 0
        total_orders_processed = 0
        current_page = 1
        was_cancelled = False
        
        while True:
            # Check if cancelled
            if cancelled and cancelled():
                logger.info(f"Sync cancelled by user after {total_orders_processed} orders")
                was_cancelled = True
                break
            
            # Build search criteria for this page
            params = {
                'searchCriteria[pageSize]': str(page_size),
                'searchCriteria[currentPage]': str(current_page),
                'searchCriteria[sortOrders][0][field]': 'created_at',
                'searchCriteria[sortOrders][0][direction]': 'ASC'  # Oldest first for resumability
            }
            
            filter_index = 0
            
            # Add date filters if provided
            if start_date:
                params[f'searchCriteria[filterGroups][{filter_index}][filters][0][field]'] = 'created_at'
                params[f'searchCriteria[filterGroups][{filter_index}][filters][0][value]'] = start_date
                params[f'searchCriteria[filterGroups][{filter_index}][filters][0][conditionType]'] = 'gt'
                filter_index += 1
            
            if end_date:
                params[f'searchCriteria[filterGroups][{filter_index}][filters][0][field]'] = 'created_at'
                params[f'searchCriteria[filterGroups][{filter_index}][filters][0][value]'] = end_date
                params[f'searchCriteria[filterGroups][{filter_index}][filters][0][conditionType]'] = 'lteq'
                filter_index += 1
            
            # Fetch orders for this page
            try:
                logger.info(f"Fetching page {current_page} of orders from Magento...")
                result = self._make_request('orders', params=params)
                orders = result.get('items', [])
                total_count = result.get('total_count', 0)
                
                if not orders:
                    logger.info(f"No more orders to fetch. Total fetched: {total_orders_processed}")
                    break
                
                logger.info(f"Processing {len(orders)} orders from page {current_page}...")
                
                if progress_callback:
                    progress_msg = f"Processing page {current_page} ({total_orders_processed}/{total_count} orders, {total_rows_imported} rows)"
                    progress_callback(progress_msg)
                
                # Process each order and extract product rows
                batch_product_rows = []
                batch_order_dates = []  # Track order dates even if no products
                for order in orders:
                    rows = self._extract_product_rows(order)
                    batch_product_rows.extend(rows)
                    # Track order creation date even if it has no products
                    created_at = order.get('created_at', '')
                    if created_at:  # Only add if created_at exists
                        batch_order_dates.append(created_at)
                    else:
                        logger.warning(f"Order {order.get('increment_id', 'unknown')} missing created_at field")
                    total_orders_processed += 1
                    
                    # Check max orders limit
                    if max_orders and total_orders_processed >= max_orders:
                        logger.info(f"Reached max orders limit: {max_orders}")
                        break
                
                # Import this batch of product rows (if any)
                batch_rows_imported = 0
                if batch_product_rows and batch_order_dates:
                    most_recent_order_date = max(batch_order_dates)
                    
                    # Use atomic import that saves product rows AND metadata in one transaction
                    try:
                        batch_result = repo.import_batch_with_metadata(
                            table_name=table_name,
                            product_rows=batch_product_rows,
                            region=region,
                            last_order_date=most_recent_order_date,
                            orders_count=len(orders),
                            username=username
                        )
                        batch_rows_imported = batch_result.get('rows_imported', 0)
                        total_rows_imported += batch_rows_imported
                        logger.info(
                            f"Batch committed atomically: {batch_rows_imported} rows, "
                            f"metadata saved with last order {most_recent_order_date}"
                        )
                    except Exception as e:
                        logger.error(f"Failed to import batch atomically: {e}")
                        # If atomic import fails, the entire batch is rolled back
                        # Break the loop and return partial progress - next sync will retry this batch
                        break
                elif batch_order_dates and not batch_product_rows:
                    # No products but we still processed orders (e.g., all cancelled)
                    # Update metadata separately since there's nothing to import
                    most_recent_order_date = max(batch_order_dates)
                    try:
                        repo.update_sync_metadata(
                            region=region,
                            last_order_date=most_recent_order_date,
                            orders_count=len(orders),
                            rows_count=0,
                            username=username
                        )
                        logger.info(f"Saved metadata for {len(orders)} orders with no products")
                    except Exception as e:
                        logger.warning(f"Could not save metadata for orders with no products: {e}")
                        # Continue anyway - this is not critical
                elif batch_product_rows and not batch_order_dates:
                    # This shouldn't happen - we have products but no order dates
                    logger.error(f"Batch has {len(batch_product_rows)} products but no order dates - skipping batch")
                    break
                
                # Check if we should stop
                if max_orders and total_orders_processed >= max_orders:
                    break
                
                if len(orders) < page_size or current_page * page_size >= total_count:
                    logger.info(f"Fetched all available orders. Total: {total_orders_processed}")
                    break
                
                # Check for cancellation again before next page
                if cancelled and cancelled():
                    logger.info(f"Sync cancelled by user after {total_orders_processed} orders")
                    was_cancelled = True
                    break
                
                current_page += 1
                
            except Exception as e:
                logger.error(f"Error fetching orders on page {current_page}: {e}")
                break
        
        logger.info(f"Batch sync complete: {total_rows_imported} rows from {total_orders_processed} orders")
        
        return {
            'rows_imported': total_rows_imported,
            'orders_processed': total_orders_processed,
            'was_cancelled': was_cancelled
        }
