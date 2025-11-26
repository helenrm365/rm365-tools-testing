"""
Service layer for Magento invoice pick/pack operations
"""
from typing import Optional, List
from datetime import datetime

from .client import get_magento_client
from .repo import MagentoRepo
from .models import MagentoInvoice
from .schemas import (
    InvoiceDetailSchema,
    InvoiceItemSchema,
    ScanResultSchema,
    SessionStatusSchema,
    StartSessionSchema,
    ScanRequestSchema,
    CompleteSessionSchema
)


class MagentoService:
    """Business logic for invoice scanning and pick/pack operations"""
    
    def __init__(self):
        self.client = get_magento_client()
        self.repo = MagentoRepo()
    
    def lookup_invoice(self, order_number: str) -> Optional[InvoiceDetailSchema]:
        """
        Look up an invoice by order number
        Returns invoice details with all line items
        """
        try:
            # Try to find invoice by order number
            invoice = self.client.get_invoice_by_order_number(order_number)
            
            if not invoice:
                # Maybe they entered an invoice number instead
                invoice = self.client.get_invoice_by_invoice_number(order_number)
            
            if not invoice:
                return None
            
            return self._convert_to_schema(invoice)
        
        except Exception as e:
            raise Exception(f"Failed to lookup invoice: {str(e)}")
    
    def start_session(self, request: StartSessionSchema, user_id: Optional[str] = None) -> SessionStatusSchema:
        """
        Start a new pick/pack or return session
        """
        # Lookup the invoice
        invoice = self.lookup_invoice(request.order_number)
        
        if not invoice:
            raise ValueError(f"No invoice found for order number: {request.order_number}")
        
        print(f"[MagentoService] Starting session with invoice:")
        print(f"  Invoice number: {invoice.invoice_number}")
        print(f"  Order number: {invoice.order_number}")
        print(f"  Items: {len(invoice.items)}")
        
        # Prepare expected items
        items_expected = [
            {
                'sku': item.sku,
                'name': item.name,
                'qty_expected': item.qty_invoiced,
                'price': item.price
            }
            for item in invoice.items
        ]
        
        print(f"  Expected items prepared: {len(items_expected)}")
        
        # Create session
        session = self.repo.create_session(
            invoice_id=invoice.invoice_number,
            order_number=invoice.order_number,
            session_type=request.session_type,
            items_expected=items_expected,
            user_id=user_id
        )
        
        print(f"  Session created: {session.session_id}")
        
        # Convert to status schema
        return self._session_to_status(session, invoice)
    
    def scan_product(self, request: ScanRequestSchema) -> ScanResultSchema:
        """
        Scan a product and validate against the invoice
        Supports scanning by SKU or item_id (18-digit barcode)
        Returns validation result with appropriate feedback
        """
        session = self.repo.get_session(request.session_id)
        
        if not session:
            return ScanResultSchema(
                success=False,
                message="Session not found",
                sku=request.sku
            )
        
        if session.status != "in_progress":
            return ScanResultSchema(
                success=False,
                message=f"Session is {session.status}",
                sku=request.sku
            )
        
        # Determine if this is an item_id (18-digit barcode) or SKU
        scanned_value = request.sku.strip()
        lookup_sku = scanned_value
        
        # Check if it's an item_id (numeric, 15+ digits, starts with 7)
        if scanned_value.isdigit() and len(scanned_value) >= 15 and scanned_value.startswith('7'):
            # This is an item_id - look up the SKU
            lookup_sku = self.repo.get_sku_by_item_id(scanned_value)
            if not lookup_sku:
                return ScanResultSchema(
                    success=False,
                    message=f"Item ID {scanned_value} not found in inventory",
                    sku=scanned_value
                )
            print(f"[MagentoService] Scanned item_id {scanned_value}, resolved to SKU {lookup_sku}")
        
        # Find the expected item by SKU
        expected_item = None
        for item in session.items_expected:
            if item['sku'].upper() == lookup_sku.upper():
                expected_item = item
                break
        
        if not expected_item:
            return ScanResultSchema(
                success=False,
                message=f"SKU {lookup_sku} is not on this invoice",
                sku=lookup_sku
            )
        
        # Get current scanned quantity (use the actual SKU, not the item_id)
        current_qty = self.repo.get_scanned_quantity(request.session_id, lookup_sku)
        new_qty = current_qty + request.quantity
        expected_qty = expected_item['qty_expected']
        
        # Add the scanned item (use the actual SKU)
        self.repo.add_scanned_item(request.session_id, lookup_sku, request.quantity)
        
        # Determine result
        is_complete = new_qty >= expected_qty
        is_overpicked = new_qty > expected_qty
        qty_remaining = max(0, expected_qty - new_qty)
        
        # Check if all items are complete
        all_complete = self._check_all_items_complete(session)
        
        if is_overpicked:
            message = f"⚠️ WARNING: Overpicked! Expected {expected_qty}, scanned {new_qty}"
        elif is_complete:
            message = f"✅ Complete! {expected_item['name']} ({lookup_sku})"
        else:
            message = f"✓ Scanned {lookup_sku}. {qty_remaining} remaining"
        
        return ScanResultSchema(
            success=True,
            message=message,
            sku=lookup_sku,  # Return the actual SKU, not the item_id
            item_name=expected_item['name'],
            qty_expected=expected_qty,
            qty_scanned=new_qty,
            qty_remaining=qty_remaining,
            is_complete=is_complete,
            is_overpicked=is_overpicked,
            all_items_complete=all_complete
        )
    
    def get_session_status(self, session_id: str) -> Optional[SessionStatusSchema]:
        """Get current status of a scanning session"""
        session = self.repo.get_session(session_id)
        
        if not session:
            return None
        
        # Lookup invoice to get full item details
        invoice = self.lookup_invoice(session.order_number)
        
        if not invoice:
            return None
        
        return self._session_to_status(session, invoice)
    
    def complete_session(self, request: CompleteSessionSchema) -> bool:
        """
        Complete a scanning session
        Validates all items are scanned unless force_complete is True
        """
        session = self.repo.get_session(request.session_id)
        
        if not session:
            raise ValueError("Session not found")
        
        if not request.force_complete:
            # Check if all items are complete
            if not self._check_all_items_complete(session):
                raise ValueError("Not all items have been scanned. Use force_complete=true to override")
        
        return self.repo.complete_session(request.session_id)
    
    def cancel_session(self, session_id: str) -> bool:
        """Cancel a session"""
        return self.repo.cancel_session(session_id)
    
    def get_active_sessions(self, user_id: Optional[str] = None) -> List[SessionStatusSchema]:
        """Get all active sessions"""
        sessions = self.repo.get_active_sessions(user_id)
        
        result = []
        for session in sessions:
            try:
                invoice = self.lookup_invoice(session.order_number)
                if invoice:
                    result.append(self._session_to_status(session, invoice))
            except:
                pass  # Skip sessions we can't look up
        
        return result
    
    def _convert_to_schema(self, invoice: MagentoInvoice) -> InvoiceDetailSchema:
        """Convert Magento invoice model to schema"""
        print(f"[MagentoService] Converting invoice to schema:")
        print(f"  Invoice ID: {invoice.increment_id}")
        print(f"  Order Number: {invoice.order_increment_id}")
        print(f"  Items count: {len(invoice.items)}")
        
        items = [
            InvoiceItemSchema(
                sku=item.sku,
                name=item.name,
                qty_ordered=item.qty_ordered,
                qty_invoiced=item.qty_invoiced,
                price=item.price,
                row_total=item.row_total,
                product_id=item.product_id
            )
            for item in invoice.items
        ]
        
        print(f"  Converted items: {[item.sku for item in items]}")
        
        billing_address = None
        if invoice.billing_street:
            parts = [invoice.billing_street, invoice.billing_city, 
                    invoice.billing_postcode, invoice.billing_country]
            billing_address = ', '.join([p for p in parts if p])
        
        schema = InvoiceDetailSchema(
            invoice_number=invoice.increment_id,
            order_number=invoice.order_increment_id,
            invoice_id=invoice.entity_id,
            order_id=invoice.order_id,
            state=invoice.state,
            grand_total=invoice.grand_total,
            created_at=invoice.created_at,
            items=items,
            billing_name=invoice.billing_name,
            billing_address=billing_address
        )
        
        print(f"  Schema created with order_number: {schema.order_number}, items: {len(schema.items)}")
        return schema
    
    def _session_to_status(self, session, invoice: InvoiceDetailSchema) -> SessionStatusSchema:
        """Convert session and invoice to status schema"""
        # Merge invoice items with scanned quantities
        items = []
        for inv_item in invoice.items:
            qty_scanned = self.repo.get_scanned_quantity(session.session_id, inv_item.sku)
            item = InvoiceItemSchema(
                sku=inv_item.sku,
                name=inv_item.name,
                qty_ordered=inv_item.qty_ordered,
                qty_invoiced=inv_item.qty_invoiced,
                qty_scanned=qty_scanned,
                price=inv_item.price,
                row_total=inv_item.row_total,
                product_id=inv_item.product_id,
                is_complete=qty_scanned >= inv_item.qty_invoiced
            )
            items.append(item)
        
        total_items = len(items)
        completed_items = sum(1 for item in items if item.is_complete)
        progress = (completed_items / total_items * 100) if total_items > 0 else 0
        
        return SessionStatusSchema(
            session_id=session.session_id,
            order_number=session.order_number,
            invoice_number=invoice.invoice_number,
            session_type=session.session_type,
            status=session.status,
            started_at=session.started_at,
            items=items,
            total_items=total_items,
            completed_items=completed_items,
            progress_percentage=round(progress, 1)
        )
    
    def _check_all_items_complete(self, session) -> bool:
        """Check if all expected items have been scanned"""
        for expected_item in session.items_expected:
            sku = expected_item['sku']
            qty_expected = expected_item['qty_expected']
            qty_scanned = self.repo.get_scanned_quantity(session.session_id, sku)
            
            if qty_scanned < qty_expected:
                return False
        
        return True
