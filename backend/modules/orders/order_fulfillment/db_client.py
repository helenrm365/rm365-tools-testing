"""
Magento Database Client for fetching invoices and order data directly from DB

This client replaces the API client to read data directly from the Magento database.
It maintains the same READ-ONLY philosophy.
"""
import logging
from typing import Optional, List, Dict, Any
from datetime import datetime
import pymysql.cursors

from modules.magentodata.db import get_magento_connection
from .models import MagentoInvoice, MagentoProduct

logger = logging.getLogger(__name__)

class MagentoDBClient:
    """
    Client to interact with Magento Database directly
    
    COMPATIBILITY NOTE:
    This client is fully compatible with the Read-Only UK Magento Database.
    It performs ONLY SELECT operations and does not attempt to write to the Magento DB.
    All state changes (approvals, sessions) are handled locally.
    """
    
    def __init__(self):
        # We don't hold a persistent connection, we get one per request or batch
        pass
        
    def _get_connection(self):
        # Explicitly use UK region for the live read-only DB
        conn = get_magento_connection(region="uk")
        
        # Enforce read-only session to ensure we never write to Magento
        try:
            with conn.cursor() as cursor:
                cursor.execute("SET SESSION TRANSACTION READ ONLY")
        except Exception as e:
            logger.warning(f"Failed to set read-only mode: {e}")
            
        return conn

    def get_invoice_by_order_number(self, order_number: str) -> Optional[MagentoInvoice]:
        """
        Fetch invoice by order increment ID (order number)
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
        Fetch invoice by invoice increment ID (invoice number)
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
                
                return self._build_invoice_model(conn, invoice, order)
        finally:
            conn.close()

    def _build_invoice_model(self, conn, invoice: Dict, order: Optional[Dict]) -> MagentoInvoice:
        """
        Construct MagentoInvoice model from DB rows
        """
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
                        qty_ordered=float(qty), # In invoice item, qty is what was invoiced
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
                shipping_method=shipping_method
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
            
        # Try to parse additional_information
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

    def search_invoices(self, 
                       start_date: Optional[str] = None,
                       end_date: Optional[str] = None,
                       page: int = 1,
                       page_size: int = 20) -> List[MagentoInvoice]:
        """
        Search invoices with optional date filters
        """
        conn = self._get_connection()
        try:
            with conn.cursor() as cursor:
                query = "SELECT * FROM sales_invoice WHERE 1=1"
                params = []
                
                if start_date:
                    query += " AND created_at >= %s"
                    params.append(start_date)
                
                if end_date:
                    query += " AND created_at <= %s"
                    params.append(end_date)
                
                query += " ORDER BY created_at DESC LIMIT %s OFFSET %s"
                offset = (page - 1) * page_size
                params.extend([page_size, offset])
                
                cursor.execute(query, tuple(params))
                invoices_data = cursor.fetchall()
                
                results = []
                for invoice in invoices_data:
                    # For list view, we might not need full details, but let's fetch them to be consistent
                    # We need order info for each
                    order_id = invoice['order_id']
                    sql_order = "SELECT entity_id, increment_id, created_at, base_currency_code, order_currency_code, shipping_description FROM sales_order WHERE entity_id = %s"
                    cursor.execute(sql_order, (order_id,))
                    order = cursor.fetchone()
                    
                    results.append(self._build_invoice_model(conn, invoice, order))
                
                return results
        finally:
            conn.close()

    def get_processing_orders(self, limit: int = 50, status: str = 'processing') -> List[Dict[str, Any]]:
        """
        Get orders by status from Magento
        """
        conn = self._get_connection()
        try:
            with conn.cursor() as cursor:
                query = "SELECT * FROM sales_order WHERE status = %s ORDER BY created_at DESC LIMIT %s"
                cursor.execute(query, (status, limit))
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
                    
                    # Add to order dict
                    order['items'] = items
                    order['payment'] = payment_data
                    order['extension_attributes'] = extension_attributes
                    
                    result_orders.append(order)
                
                return result_orders
        finally:
            conn.close()
