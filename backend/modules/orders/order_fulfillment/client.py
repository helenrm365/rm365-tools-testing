"""
Magento API Client for fetching invoices and order data

⚠️ READ-ONLY CLIENT ⚠️
This client ONLY reads data from Magento. It never modifies Magento data.
All order management (approvals, status changes, picking, packing) happens
in the local database only. Orders remain in their original Magento status.
"""
import requests
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime

from core.config import settings
from .models import MagentoInvoice, MagentoProduct

logger = logging.getLogger(__name__)


class MagentoClient:
    """Client to interact with Magento REST API"""
    
    def __init__(self):
        self.base_url = (settings.MAGENTO_BASE_URL or '').rstrip('/')
        self.access_token = settings.MAGENTO_ACCESS_TOKEN or ''
        
        # Debug logging
        
        if not self.base_url:
            raise ValueError("MAGENTO_BASE_URL environment variable not set")
        if not self.access_token:
            raise ValueError("MAGENTO_ACCESS_TOKEN environment variable not set")
        
        self.headers = {
            'Authorization': f'Bearer {self.access_token}',
            'Content-Type': 'application/json'
        }
    
    def _make_request(self, endpoint: str, method: str = 'GET', params: Optional[Dict] = None) -> Any:
        """
        Make a request to Magento API
        
        IMPORTANT: This client is READ-ONLY. All order management (approvals, status changes, etc.)
        happens in the local database only. We never modify Magento data.
        """
        # Safety guard: Only allow GET requests to Magento
        if method.upper() != 'GET':
            raise ValueError(
                f"Write operations to Magento are not allowed. "
                f"Attempted method: {method}. "
                f"All order state changes must be tracked locally only."
            )
        
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
            raise Exception(f"Magento API error: {str(e)}")
    
    def get_invoice_by_order_number(self, order_number: str) -> Optional[MagentoInvoice]:
        """
        Fetch invoice by order increment ID (order number)
        First searches for the order, then gets its invoices
        """
        # Step 1: Search for the order by increment_id
        order_params = {
            'searchCriteria[filterGroups][0][filters][0][field]': 'increment_id',
            'searchCriteria[filterGroups][0][filters][0][value]': order_number,
            'searchCriteria[filterGroups][0][filters][0][conditionType]': 'eq'
        }
        
        order_result = self._make_request('orders', params=order_params)
        
        if not order_result.get('items') or len(order_result['items']) == 0:
            return None
        
        order = order_result['items'][0]
        order_id = order['entity_id']
        order_increment_id = order.get('increment_id', order_number)
        
        # Step 2: Get invoices for this order using order_id
        invoice_params = {
            'searchCriteria[filterGroups][0][filters][0][field]': 'order_id',
            'searchCriteria[filterGroups][0][filters][0][value]': str(order_id),
            'searchCriteria[filterGroups][0][filters][0][conditionType]': 'eq'
        }
        
        invoice_result = self._make_request('invoices', params=invoice_params)
        
        if not invoice_result.get('items') or len(invoice_result['items']) == 0:
            return None
        
        # Get the first invoice (most recent)
        invoice_data = invoice_result['items'][0]
        
        # Fetch full invoice details including items
        invoice_id = invoice_data['entity_id']
        full_invoice = self._make_request(f'invoices/{invoice_id}')
        
        # Pass the order data for address extraction and order_increment_id
        return self._parse_invoice(full_invoice, order_increment_id=order_increment_id, order_data=order)
    
    def get_invoice_by_invoice_number(self, invoice_number: str) -> Optional[MagentoInvoice]:
        """
        Fetch invoice by invoice increment ID (invoice number)
        """
        params = {
            'searchCriteria[filterGroups][0][filters][0][field]': 'increment_id',
            'searchCriteria[filterGroups][0][filters][0][value]': invoice_number,
            'searchCriteria[filterGroups][0][filters][0][conditionType]': 'eq'
        }
        
        result = self._make_request('invoices', params=params)
        
        if not result.get('items') or len(result['items']) == 0:
            return None
        
        invoice_data = result['items'][0]
        invoice_id = invoice_data['entity_id']
        order_id = invoice_data.get('order_id')
        
        # Fetch full invoice details
        full_invoice = self._make_request(f'invoices/{invoice_id}')
        
        # Fetch order details to get order_increment_id and addresses
        order_increment_id = None
        order_data = None
        if order_id:
            try:
                order_data = self._make_request(f'orders/{order_id}')
                order_increment_id = order_data.get('increment_id')
            except Exception as e:
                logger.warning(f"Failed to fetch order data: {e}")
        
        return self._parse_invoice(full_invoice, order_increment_id=order_increment_id, order_data=order_data)
    
    def _parse_invoice(self, invoice_data: Dict[str, Any], order_increment_id: Optional[str] = None, order_data: Optional[Dict[str, Any]] = None) -> MagentoInvoice:
        """Parse raw Magento invoice data into our model"""
        
        
        # Parse invoice items
        items = []
        for item in invoice_data.get('items', []):
            # Get quantity - try multiple fields as Magento API might use different names
            qty = item.get('qty') or item.get('qty_invoiced') or item.get('qty_ordered', 0)
            
            
            # Skip if no quantity or SKU is missing
            if qty > 0 and item.get('sku'):
                product = MagentoProduct(
                    sku=item.get('sku', ''),
                    name=item.get('name', ''),
                    qty_ordered=float(item.get('qty_ordered') or qty),
                    qty_invoiced=float(qty),
                    price=float(item.get('price', 0)),
                    row_total=float(item.get('row_total') or item.get('base_row_total', 0)),
                    product_id=item.get('product_id')
                )
                items.append(product)
            else:
                logger.debug(f"Skipping item with qty={qty}, sku={item.get('sku')}")
        
        # Parse billing and shipping addresses from order data (more reliable than invoice)
        billing_name = None
        billing_street = None
        billing_city = None
        billing_postcode = None
        billing_country = None
        billing_phone = None
        shipping_name = None
        shipping_street = None
        shipping_city = None
        shipping_postcode = None
        shipping_country = None
        shipping_phone = None
        payment_method = None
        shipping_method = None
        
        if order_data:
            # Get payment method - try multiple Magento fields
            payment_info = order_data.get('payment', {})
            payment_method = None
            
            # Credit card type mapping
            cc_type_map = {
                'VI': 'Visa',
                'MC': 'Mastercard',
                'AE': 'American Express',
                'DI': 'Discover',
                'JCB': 'JCB',
                'DN': 'Diners Club',
                'MI': 'Maestro',
                'SM': 'Switch/Maestro',
                'SO': 'Solo'
            }
            
            # Try cc_type and map it to readable name
            cc_type = payment_info.get('cc_type')
            if cc_type:
                payment_method = cc_type_map.get(cc_type, cc_type)
            
            # If not found, try additional_information array
            if not payment_method:
                additional_info = payment_info.get('additional_information')
                if isinstance(additional_info, list) and len(additional_info) > 0:
                    for i, item in enumerate(additional_info):
                        if isinstance(item, str) and 'method_title' in item.lower():
                            if i + 1 < len(additional_info):
                                payment_method = additional_info[i + 1]
                                break
            
            # Try extension_attributes
            if not payment_method and 'extension_attributes' in payment_info:
                ext = payment_info.get('extension_attributes', {})
                payment_method = ext.get('payment_method_title')
            
            # Fallback to method code
            if not payment_method:
                payment_method = payment_info.get('method')
            
            
            ext_attrs = order_data.get('extension_attributes', {})
            shipping_method = None
            if ext_attrs.get('shipping_assignments'):
                shipping_assignment = ext_attrs['shipping_assignments'][0]
                if shipping_assignment.get('shipping'):
                    # Get shipping description - try multiple fields
                    shipping_info = shipping_assignment['shipping']
                    shipping_method = (
                        shipping_info.get('shipping_description') or
                        order_data.get('shipping_description') or
                        shipping_info.get('method')
                    )
            
            # Get billing address from order
            billing = order_data.get('billing_address', {})
            if billing:
                billing_name = f"{billing.get('firstname', '')} {billing.get('lastname', '')}".strip()
                billing_street = ', '.join(billing.get('street', [])) if billing.get('street') else None
                billing_city = billing.get('city')
                billing_postcode = billing.get('postcode')
                billing_country = billing.get('country_id')
                billing_phone = billing.get('telephone')
            
            # Get shipping address from order extension_attributes
            ext_attrs = order_data.get('extension_attributes', {})
            if ext_attrs.get('shipping_assignments'):
                shipping_assignment = ext_attrs['shipping_assignments'][0]
                if shipping_assignment.get('shipping'):
                    shipping_addr = shipping_assignment['shipping'].get('address', {})
                    if shipping_addr:
                        shipping_name = f"{shipping_addr.get('firstname', '')} {shipping_addr.get('lastname', '')}".strip()
                        shipping_street = ', '.join(shipping_addr.get('street', [])) if shipping_addr.get('street') else None
                        shipping_city = shipping_addr.get('city')
                        shipping_postcode = shipping_addr.get('postcode')
                        shipping_country = shipping_addr.get('country_id')
                        shipping_phone = shipping_addr.get('telephone')
        
        # Fallback to invoice billing_address if order_data not available
        if not billing_name:
            billing = invoice_data.get('billing_address', {})
            if billing:
                billing_name = f"{billing.get('firstname', '')} {billing.get('lastname', '')}".strip()
                billing_street = ', '.join(billing.get('street', [])) if billing.get('street') else None
                billing_city = billing.get('city')
                billing_postcode = billing.get('postcode')
                billing_country = billing.get('country_id')
                billing_phone = billing.get('telephone')
        
        # Use provided order_increment_id or fall back to what's in invoice_data
        final_order_increment_id = order_increment_id or invoice_data.get('order_increment_id', '')
        
        # Extract currency code
        order_currency_code = None
        if order_data:
            order_currency_code = order_data.get('order_currency_code') or order_data.get('base_currency_code')
        if not order_currency_code:
            order_currency_code = invoice_data.get('order_currency_code') or invoice_data.get('base_currency_code')
        
        
        return MagentoInvoice(
            entity_id=invoice_data['entity_id'],
            increment_id=invoice_data.get('increment_id', ''),
            order_id=invoice_data.get('order_id', 0),
            order_increment_id=final_order_increment_id,
            state=invoice_data.get('state', ''),
            grand_total=float(invoice_data.get('grand_total', 0)),
            subtotal=float(invoice_data.get('subtotal', 0)),
            tax_amount=float(invoice_data.get('tax_amount', 0)),
            order_currency_code=order_currency_code,
            created_at=invoice_data.get('created_at', ''),
            order_date=invoice_data.get('created_at', ''),
            items=items,
            billing_name=billing_name,
            billing_street=billing_street,
            billing_city=billing_city,
            billing_postcode=billing_postcode,
            billing_country=billing_country,
            billing_phone=billing_phone,
            shipping_name=shipping_name,
            shipping_street=shipping_street,
            shipping_city=shipping_city,
            shipping_postcode=shipping_postcode,
            shipping_country=shipping_country,
            shipping_phone=shipping_phone,
            payment_method=payment_method,
            shipping_method=shipping_method
        )
    
    def search_invoices(self, 
                       start_date: Optional[str] = None,
                       end_date: Optional[str] = None,
                       page: int = 1,
                       page_size: int = 20) -> List[MagentoInvoice]:
        """
        Search invoices with optional date filters
        """
        params = {
            'searchCriteria[pageSize]': page_size,
            'searchCriteria[currentPage]': page
        }
        
        filter_index = 0
        if start_date:
            params[f'searchCriteria[filterGroups][{filter_index}][filters][0][field]'] = 'created_at'
            params[f'searchCriteria[filterGroups][{filter_index}][filters][0][value]'] = start_date
            params[f'searchCriteria[filterGroups][{filter_index}][filters][0][conditionType]'] = 'gteq'
            filter_index += 1
        
        if end_date:
            params[f'searchCriteria[filterGroups][{filter_index}][filters][0][field]'] = 'created_at'
            params[f'searchCriteria[filterGroups][{filter_index}][filters][0][value]'] = end_date
            params[f'searchCriteria[filterGroups][{filter_index}][filters][0][conditionType]'] = 'lteq'
        
        result = self._make_request('invoices', params=params)
        
        invoices = []
        for invoice_data in result.get('items', []):
            invoice_id = invoice_data['entity_id']
            full_invoice = self._make_request(f'invoices/{invoice_id}')
            invoices.append(self._parse_invoice(full_invoice))
        
        return invoices
    
    def get_processing_orders(self, limit: int = 50, status: str = 'processing') -> List[Dict[str, Any]]:
        """
        Get orders by status from Magento
        Default is 'processing' status which needs approval before picking
        
        Args:
            limit: Maximum number of orders to retrieve
            status: Order status to filter by (default: 'processing')
        """
        try:
            params = {
                'searchCriteria[filterGroups][0][filters][0][field]': 'status',
                'searchCriteria[filterGroups][0][filters][0][value]': status,
                'searchCriteria[filterGroups][0][filters][0][conditionType]': 'eq',
                'searchCriteria[pageSize]': str(limit),
                'searchCriteria[currentPage]': '1',
                'searchCriteria[sortOrders][0][field]': 'created_at',
                'searchCriteria[sortOrders][0][direction]': 'DESC'
            }
            
            logger.info(f"Fetching Magento orders with status='{status}', limit={limit}")
            result = self._make_request('orders', params=params)
            items = result.get('items', [])
            logger.info(f"Retrieved {len(items)} orders with status '{status}' from Magento")
            
            # Log order numbers for debugging
            if items:
                order_numbers = [order.get('increment_id') for order in items]
                logger.debug(f"Order numbers retrieved: {order_numbers}")
            
            return items
        except Exception as e:
            logger.error(f"Failed to get orders with status '{status}': {e}")
            return []


# Singleton instance
_client: Optional[MagentoClient] = None


def get_magento_client() -> MagentoClient:
    """Get or create Magento client instance"""
    global _client
    if _client is None:
        _client = MagentoClient()
    return _client

