"""
London Magento Database Client

Fetches invoices and order data directly from UK Magento database.
Filters for London Office Collection shipping method only.
Maintains READ-ONLY philosophy - all writes are to local session tables.
"""
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime
import pymysql.cursors

from modules.magentodata.db import get_magento_connection
from modules.orders.order_fulfillment.models import MagentoInvoice, MagentoProduct

logger = logging.getLogger(__name__)


class LondonMagentoDBClient:
    """
    Client to interact with UK Magento Database directly for London orders
    
    For order approvals: Fetches from UK database, filters for London shipping method
    For invoice lookup: Only returns if shipping method contains "London Office Collection"
    
    COMPATIBILITY NOTE:
    This client performs ONLY SELECT operations and does not write to Magento.
    All state changes (approvals, sessions) are handled in local PostgreSQL.
    """
    
    LONDON_SHIPPING_FILTER = 'london office collection'
    
    def __init__(self):
        # We don't hold a persistent connection, we get one per request
        pass
    
    def _get_connection(self):
        """Get connection to UK Magento database"""
        conn = get_magento_connection(region="uk")
        
        # Enforce read-only session
        try:
            with conn.cursor() as cursor:
                cursor.execute("SET SESSION TRANSACTION READ ONLY")
        except Exception as e:
            logger.warning(f"Failed to set read-only mode for UK: {e}")
            
        return conn

    def _is_london_order(self, shipping_description: str) -> bool:
        """Check if shipping description indicates London Office Collection"""
        if not shipping_description:
            return False
        return self.LONDON_SHIPPING_FILTER in shipping_description.lower()

    def get_invoice_by_order_number(self, order_number: str) -> Optional[MagentoInvoice]:
        """
        Fetch invoice by order increment ID (order number)
        Only returns if the order has London Office Collection shipping
        """
        conn = self._get_connection()
        try:
            with conn.cursor() as cursor:
                # 1. Find order
                sql_order = "SELECT entity_id, increment_id, created_at, base_currency_code, order_currency_code, shipping_description FROM sales_order WHERE increment_id = %s"
                cursor.execute(sql_order, (order_number,))
                order = cursor.fetchone()
                
                if not order:
                    return None
                
                # Check if this is a London order
                if not self._is_london_order(order.get('shipping_description', '')):
                    logger.info(f"Order {order_number} is not a London Office Collection order")
                    return None
                
                order_id = order['entity_id']
                
                # 2. Find invoice
                sql_invoice = "SELECT * FROM sales_invoice WHERE order_id = %s ORDER BY created_at DESC LIMIT 1"
                cursor.execute(sql_invoice, (order_id,))
                invoice = cursor.fetchone()
                
                if not invoice:
                    return None
                
                return self._build_invoice_model(conn, invoice, order)
        finally:
            conn.close()

    def get_invoice_by_invoice_number(self, invoice_number: str) -> Optional[MagentoInvoice]:
        """
        Fetch invoice by invoice increment ID
        Only returns if the order has London Office Collection shipping
        """
        conn = self._get_connection()
        try:
            with conn.cursor() as cursor:
                # 1. Find invoice
                sql_invoice = "SELECT * FROM sales_invoice WHERE increment_id = %s"
                cursor.execute(sql_invoice, (invoice_number,))
                invoice = cursor.fetchone()
                
                if not invoice:
                    return None
                
                order_id = invoice['order_id']
                
                # 2. Find order
                sql_order = "SELECT entity_id, increment_id, created_at, base_currency_code, order_currency_code, shipping_description FROM sales_order WHERE entity_id = %s"
                cursor.execute(sql_order, (order_id,))
                order = cursor.fetchone()
                
                # Check if this is a London order
                if not self._is_london_order(order.get('shipping_description', '') if order else ''):
                    logger.info(f"Invoice {invoice_number} is not for a London Office Collection order")
                    return None
                
                return self._build_invoice_model(conn, invoice, order)
        finally:
            conn.close()

    def _build_invoice_model(self, conn, invoice: Dict, order: Optional[Dict]) -> MagentoInvoice:
        """Construct MagentoInvoice model from DB rows"""
        invoice_id = invoice['entity_id']
        order_id = invoice['order_id']
        
        with conn.cursor() as cursor:
            # Get Items
            sql_items = "SELECT sku, name, qty, price, row_total, base_row_total, product_id FROM sales_invoice_item WHERE parent_id = %s"
            cursor.execute(sql_items, (invoice_id,))
            items_data = cursor.fetchall()
            
            items = []
            for item in items_data:
                qty = item.get('qty', 0)
                if qty > 0:
                    items.append(MagentoProduct(
                        sku=item.get('sku', ''),
                        name=item.get('name', ''),
                        qty_ordered=float(qty),
                        qty_invoiced=float(qty),
                        price=float(item.get('price', 0)),
                        row_total=float(item.get('row_total') or item.get('base_row_total', 0)),
                        product_id=item.get('product_id')
                    ))
            
            # Get Addresses
            sql_address = "SELECT * FROM sales_order_address WHERE parent_id = %s"
            cursor.execute(sql_address, (order_id,))
            addresses = cursor.fetchall()
            
            billing = next((a for a in addresses if a['address_type'] == 'billing'), {})
            shipping = next((a for a in addresses if a['address_type'] == 'shipping'), {})
            
            # Get Payment
            sql_payment = "SELECT method, cc_type, additional_information FROM sales_order_payment WHERE parent_id = %s"
            cursor.execute(sql_payment, (order_id,))
            payment = cursor.fetchone() or {}
            
            # Map Payment Method
            payment_method = self._map_payment_method(payment)
            
            # Shipping Method
            shipping_method = order.get('shipping_description') if order else None

            # Prepare fields
            billing_street = billing.get('street', '').replace('\n', ', ') if billing.get('street') else None
            shipping_street = shipping.get('street', '').replace('\n', ', ') if shipping.get('street') else None
            
            order_currency_code = order.get('order_currency_code') or order.get('base_currency_code') if order else invoice.get('order_currency_code')

            return MagentoInvoice(
                entity_id=invoice['entity_id'],
                increment_id=invoice.get('increment_id', ''),
                order_id=invoice.get('order_id', 0),
                order_increment_id=order.get('increment_id', '') if order else '',
                state=str(invoice.get('state', '')),
                grand_total=float(invoice.get('grand_total', 0)),
                subtotal=float(invoice.get('subtotal', 0)),
                tax_amount=float(invoice.get('tax_amount', 0)),
                order_currency_code=order_currency_code,
                created_at=str(invoice.get('created_at', '')),
                order_date=str(order.get('created_at', '')) if order else None,
                items=items,
                billing_name=f"{billing.get('firstname', '')} {billing.get('lastname', '')}".strip(),
                billing_street=billing_street,
                billing_city=billing.get('city'),
                billing_postcode=billing.get('postcode'),
                billing_country=billing.get('country_id'),
                billing_phone=billing.get('telephone'),
                shipping_name=f"{shipping.get('firstname', '')} {shipping.get('lastname', '')}".strip(),
                shipping_street=shipping_street,
                shipping_city=shipping.get('city'),
                shipping_postcode=shipping.get('postcode'),
                shipping_country=shipping.get('country_id'),
                shipping_phone=shipping.get('telephone'),
                payment_method=payment_method,
                shipping_method=shipping_method,
                source_region='uk'  # Track that this is from UK
            )

    def _map_payment_method(self, payment: Dict) -> str:
        method = payment.get('method')
        cc_type = payment.get('cc_type')
        
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
        
        if cc_type and cc_type in cc_type_map:
            return cc_type_map[cc_type]
            
        additional_info = payment.get('additional_information')
        if isinstance(additional_info, str):
            try:
                import json
                info = json.loads(additional_info)
                if isinstance(info, dict):
                    method_title = info.get('method_title')
                    if method_title:
                        return method_title
            except:
                pass
        
        return method

    def get_processing_orders(self, limit: int = 50, status: str = 'processing') -> List[Dict[str, Any]]:
        """
        Get orders in processing status from UK Magento database.
        ONLY returns orders with London Office Collection shipping method.
        """
        conn = self._get_connection()
        try:
            with conn.cursor() as cursor:
                # Query orders with London shipping method filter in SQL for efficiency
                query = """
                    SELECT * FROM sales_order 
                    WHERE status = %s 
                    AND LOWER(shipping_description) LIKE %s
                    ORDER BY created_at DESC 
                    LIMIT %s
                """
                cursor.execute(query, (status, f'%{self.LONDON_SHIPPING_FILTER}%', limit))
                orders = cursor.fetchall()
                
                result_orders = []
                for order in orders:
                    order_id = order['entity_id']
                    
                    # Fetch Payment
                    sql_payment = "SELECT method, cc_type, additional_information FROM sales_order_payment WHERE parent_id = %s"
                    cursor.execute(sql_payment, (order_id,))
                    payment = cursor.fetchone() or {}
                    
                    # Fetch Items
                    sql_items = "SELECT * FROM sales_order_item WHERE order_id = %s"
                    cursor.execute(sql_items, (order_id,))
                    items = cursor.fetchall()
                    
                    # Construct Payment Data
                    payment_data = {
                        'method': payment.get('method'),
                        'cc_type': payment.get('cc_type'),
                        'additional_information': payment.get('additional_information')
                    }
                    
                    # Construct Extension Attributes for Shipping
                    shipping_desc = order.get('shipping_description')
                    shipping_method = order.get('shipping_method')
                    
                    extension_attributes = {
                        'shipping_assignments': [
                            {
                                'shipping': {
                                    'shipping_description': shipping_desc,
                                    'method': shipping_method
                                }
                            }
                        ]
                    }
                    
                    order['items'] = items
                    order['payment'] = payment_data
                    order['extension_attributes'] = extension_attributes
                    order['source_region'] = 'uk'
                    
                    result_orders.append(order)
                
                return result_orders
        finally:
            conn.close()


# Singleton instance
_client: Optional[LondonMagentoDBClient] = None


def get_london_magento_client() -> LondonMagentoDBClient:
    """Get or create London Magento client instance"""
    global _client
    if _client is None:
        _client = LondonMagentoDBClient()
    return _client
