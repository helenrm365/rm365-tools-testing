"""
Service layer for Magento invoice pick/pack operations

ARCHITECTURE OVERVIEW:
======================
This system integrates with Magento in a READ-ONLY manner:

1. READ from Magento:
   - Fetch orders in 'processing' status
   - Fetch invoice details
   - Fetch product information
   
2. NEVER WRITE to Magento:
   - Order approvals are tracked locally only
   - Order status changes are tracked locally only
   - Picking/packing progress is tracked locally only
   - Orders remain in their original Magento status (typically 'processing')

3. Local State Management:
   - Sessions are created locally when orders are approved
   - Session status tracks: approved → in_progress → ready_to_check → completed
   - All state changes are persisted in local JSON files (could be database)
   - Magento is queried only to fetch initial order/invoice data

This architecture ensures:
- Magento remains the source of truth for order data
- We don't interfere with Magento's order management
- We can track our fulfillment process independently
- No risk of corrupting Magento data
"""
from typing import Optional, List
from datetime import datetime
import logging

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

logger = logging.getLogger(__name__)


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
        First checks if there's an existing session for this order and returns appropriate response
        """
        # Lookup the invoice first
        invoice = self.lookup_invoice(request.order_number)
        
        if not invoice:
            raise ValueError(f"No invoice found for order number: {request.order_number}")
        
        
        # Check for any existing session for this invoice (any status)
        existing_session = self._get_any_session_for_invoice(invoice.invoice_number)
        
        if existing_session:
            
            if existing_session.status == "completed":
                # Block completely - order already completed
                raise ValueError(
                    f"Order #{invoice.order_number} is already completed by {existing_session.user_id or existing_session.created_by}. "
                    "Cannot start a new session."
                )
            
            elif existing_session.status == "in_progress":
                # In progress by another user - cannot start
                owner = existing_session.user_id or "Unknown"
                raise ValueError(
                    f"Order #{invoice.order_number} is currently in progress by {owner}. "
                    "You cannot start a new session while it's being processed."
                )
            
            elif existing_session.status == "draft":
                # Draft exists - warn user but they can take over by claiming
                created_by = existing_session.created_by or existing_session.last_modified_by or "Unknown"
                raise ValueError(
                    f"Order #{invoice.order_number} has a draft session started by {created_by}. "
                    "Use the claim endpoint to take over this draft session, or cancel it first to start fresh."
                )
            
            elif existing_session.status == "cancelled":
                # Cancelled - reuse the existing session instead of creating new
                cancelled_by = existing_session.last_modified_by or existing_session.created_by or "Unknown"
                
                # Reset the session to in_progress
                session = self.repo.restart_cancelled_session(
                    session_id=existing_session.session_id,
                    user_id=user_id
                )
                
                
                # Convert to status schema and return
                return self._session_to_status(session, invoice)
        
        
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
        
        
        # Create session - starts in_progress and locked to user
        session = self.repo.create_session(
            invoice_id=invoice.invoice_number,
            order_number=invoice.order_number,
            session_type=request.session_type,
            items_expected=items_expected,
            user_id=user_id
        )
        
        # Immediately claim it for the user
        if user_id:
            self.repo.claim_session(session.session_id, user_id)
        
        
        # Convert to status schema
        return self._session_to_status(session, invoice)
    
    def _get_any_session_for_invoice(self, invoice_id: str) -> Optional:
        """Get the most recent session for an invoice, regardless of status"""
        from .models import ScanSession
        sessions = [
            s for s in self.repo._sessions.values()
            if s.invoice_id == invoice_id
        ]
        
        if not sessions:
            return None
        
        # Sort by started_at descending to get most recent
        sessions.sort(key=lambda s: s.started_at, reverse=True)
        return sessions[0]

    
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
        
        # Update inventory_metadata to deduct stock (like inventory adjustments)
        try:
            # Look up item_id for this SKU
            item_id = self._get_item_id_by_sku(lookup_sku)
            if item_id:
                # Apply shelf logic to deduct stock (auto or specific field)
                self._deduct_inventory_stock(item_id, request.quantity, request.field)
            else:
                print(f"[MagentoService] Warning: No item_id found for SKU {lookup_sku}, skipping inventory deduction")
        except ValueError as e:
            # Insufficient stock - but allow the scan to succeed with a warning
            print(f"[MagentoService] Warning: {e}")
        except Exception as e:
            print(f"[MagentoService] Error deducting inventory: {e}")
        
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
    
    def complete_session(self, request: CompleteSessionSchema, user_id: Optional[str] = None) -> bool:
        """
        Complete a scanning session
        Validates all items are scanned unless force_complete is True
        """
        session = self.repo.get_session(request.session_id)
        
        if not session:
            raise ValueError("Session not found")
        
        if session.status != "in_progress":
            raise ValueError(f"Cannot complete a session that is {session.status}")
        
        if not request.force_complete:
            # Check if all items are complete
            if not self._check_all_items_complete(session):
                raise ValueError("Not all items have been scanned. Use force_complete=true to override")
        
        return self.repo.complete_session(request.session_id, user_id=user_id)
    
    def cancel_session(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Cancel a session"""
        return self.repo.cancel_session(session_id, user_id=user_id)
    
    def get_active_sessions(self, user_id: Optional[str] = None) -> List[SessionStatusSchema]:
        """Get all active (in_progress) sessions"""
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
    
    def get_draft_sessions(self) -> List[SessionStatusSchema]:
        """Get all draft sessions available to claim"""
        sessions = self.repo.get_draft_sessions()
        
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
        
        
        billing_address = None
        if invoice.billing_street:
            parts = [invoice.billing_street, invoice.billing_city, 
                    invoice.billing_postcode, invoice.billing_country]
            billing_address = ', '.join([p for p in parts if p])
        
        shipping_address = None
        if invoice.shipping_street:
            parts = [invoice.shipping_street, invoice.shipping_city, 
                    invoice.shipping_postcode, invoice.shipping_country]
            shipping_address = ', '.join([p for p in parts if p])
        
        schema = InvoiceDetailSchema(
            invoice_number=invoice.increment_id,
            order_number=invoice.order_increment_id,
            invoice_id=invoice.entity_id,
            order_id=invoice.order_id,
            state=invoice.state,
            grand_total=invoice.grand_total,
            subtotal=invoice.subtotal,
            tax_amount=invoice.tax_amount,
            order_currency_code=invoice.order_currency_code,
            created_at=invoice.created_at,
            order_date=invoice.order_date,
            items=items,
            billing_name=invoice.billing_name,
            billing_address=billing_address,
            billing_postcode=invoice.billing_postcode,
            billing_phone=invoice.billing_phone,
            shipping_name=invoice.shipping_name,
            shipping_address=shipping_address,
            shipping_postcode=invoice.shipping_postcode,
            shipping_phone=invoice.shipping_phone,
            payment_method=invoice.payment_method,
            shipping_method=invoice.shipping_method
        )
        
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
        
        
        status_schema = SessionStatusSchema(
            session_id=session.session_id,
            order_number=session.order_number,
            invoice_number=invoice.invoice_number,
            session_type=session.session_type,
            status=session.status,
            started_at=session.started_at,
            items=items,
            total_items=total_items,
            completed_items=completed_items,
            progress_percentage=round(progress, 1),
            grand_total=invoice.grand_total,
            subtotal=invoice.subtotal,
            tax_amount=invoice.tax_amount,
            order_currency_code=invoice.order_currency_code,
            order_date=invoice.order_date,
            billing_name=invoice.billing_name,
            billing_postcode=invoice.billing_postcode,
            billing_phone=invoice.billing_phone,
            shipping_name=invoice.shipping_name,
            shipping_postcode=invoice.shipping_postcode,
            shipping_phone=invoice.shipping_phone,
            payment_method=invoice.payment_method,
            shipping_method=invoice.shipping_method
        )
        
        return status_schema
    
    def _check_all_items_complete(self, session) -> bool:
        """Check if all expected items have been scanned"""
        for expected_item in session.items_expected:
            sku = expected_item['sku']
            qty_expected = expected_item['qty_expected']
            qty_scanned = self.repo.get_scanned_quantity(session.session_id, sku)
            
            if qty_scanned < qty_expected:
                return False
        
        return True


    def _get_item_id_by_sku(self, sku: str) -> Optional[str]:
        """Get item_id for a SKU from inventory_metadata"""
        try:
            from core.db import get_psycopg_connection
            conn = get_psycopg_connection()
            cursor = conn.cursor()
            
            cursor.execute(
                "SELECT item_id FROM inventory_metadata WHERE sku = %s",
                (sku,)
            )
            result = cursor.fetchone()
            cursor.close()
            conn.close()
            
            return result[0] if result else None
        except Exception as e:
            print(f"[MagentoService] Error looking up item_id: {e}")
            return None
    
    def _deduct_inventory_stock(self, item_id: str, quantity: int, field: str = "auto"):
        """
        Deduct stock from inventory_metadata
        field: 'auto' (smart shelf logic), 'shelf_lt1_qty', 'shelf_gt1_qty', or 'top_floor_total'
        """
        try:
            from core.db import get_psycopg_connection
            conn = get_psycopg_connection()
            cursor = conn.cursor()
            
            # Get current inventory levels
            cursor.execute(
                """
                SELECT shelf_lt1_qty, shelf_gt1_qty, top_floor_total
                FROM inventory_metadata
                WHERE item_id = %s
                """,
                (item_id,)
            )
            result = cursor.fetchone()
            
            if not result:
                cursor.close()
                conn.close()
                return
            
            shelf_lt1, shelf_gt1, top_floor = result
            shelf_lt1 = shelf_lt1 or 0
            shelf_gt1 = shelf_gt1 or 0
            top_floor = top_floor or 0
            
            needed = quantity
            updates = []
            
            # If specific field selected, only deduct from that field
            if field != "auto":
                current_value = {
                    'shelf_lt1_qty': shelf_lt1,
                    'shelf_gt1_qty': shelf_gt1,
                    'top_floor_total': top_floor
                }.get(field, 0)
                
                if current_value < needed:
                    cursor.close()
                    conn.close()
                    raise ValueError(
                        f"Insufficient stock in {field} for item {item_id}. "
                        f"Requested: {quantity}, Available: {current_value}"
                    )
                
                updates.append((field, -needed))
            else:
                # Auto mode: Use smart shelf priority
                # Priority 1: Take from shelf_lt1_qty first
                if shelf_lt1 > 0:
                    take_from_lt1 = min(needed, shelf_lt1)
                    updates.append(('shelf_lt1_qty', -take_from_lt1))
                    needed -= take_from_lt1
                
                # Priority 2: Take from shelf_gt1_qty if needed
                if needed > 0 and shelf_gt1 > 0:
                    take_from_gt1 = min(needed, shelf_gt1)
                    updates.append(('shelf_gt1_qty', -take_from_gt1))
                    needed -= take_from_gt1
                
                # Priority 3: Take from top_floor_total if still needed
                if needed > 0 and top_floor > 0:
                    take_from_top = min(needed, top_floor)
                    updates.append(('top_floor_total', -take_from_top))
                    needed -= take_from_top
                
                # If we couldn't fulfill the entire request, raise an error
                if needed > 0:
                    cursor.close()
                    conn.close()
                    total_available = shelf_lt1 + shelf_gt1 + top_floor
                    raise ValueError(
                        f"Insufficient stock for item {item_id}. "
                        f"Requested: {quantity}, Available: {total_available} "
                        f"(Shelf <1: {shelf_lt1}, Shelf >1: {shelf_gt1}, Top Floor: {top_floor})"
                    )
            
            # Apply the updates
            for update_field, delta in updates:
                cursor.execute(
                    f"""
                    UPDATE inventory_metadata
                    SET {update_field} = {update_field} + %s
                    WHERE item_id = %s
                    """,
                    (delta, item_id)
                )
            
            conn.commit()
            cursor.close()
            conn.close()
            
        except Exception as e:
            print(f"[MagentoService] Error deducting inventory: {e}")
            raise
    
    # Collaborative session management methods
    
    def check_session_access(self, session_id: str, user_id: str):
        """Check if user can access a session and return ownership info"""
        from .schemas import SessionOwnershipSchema
        
        session = self.repo.get_session(session_id)
        if not session:
            return SessionOwnershipSchema(
                session_id=session_id,
                status="not_found",
                can_access=False,
                can_take_over=False,
                message="Session not found"
            )
        
        can_access, message = self.repo.can_access_session(session_id, user_id)
        
        return SessionOwnershipSchema(
            session_id=session_id,
            current_owner=session.user_id,
            created_by=session.created_by,
            status=session.status,
            can_access=can_access,
            can_take_over=(session.status == "in_progress" and session.user_id != user_id),
            message=message
        )
    
    def claim_session(self, session_id: str, user_id: str) -> bool:
        """Claim a draft session"""
        return self.repo.claim_session(session_id, user_id)
    
    def release_session(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Release a session back to draft"""
        return self.repo.release_session(session_id, user_id=user_id)
    
    def request_takeover(self, session_id: str, user_id: str):
        """Request to take over an in-progress session"""
        request = self.repo.create_takeover_request(session_id, user_id)
        if not request:
            raise ValueError("Cannot create takeover request for this session")
        
        # Send WebSocket notification to current owner
        self._send_takeover_notification(request, 'requested')
        return request
    
    def respond_to_takeover(self, request_id: str, accept: bool, user_id: str):
        """Respond to a takeover request"""
        request = self.repo.get_takeover_request(request_id)
        if not request:
            raise ValueError("Takeover request not found")
        
        if request.current_owner != user_id:
            raise ValueError("You are not the owner of this session")
        
        updated_request = self.repo.respond_to_takeover_request(request_id, accept)
        
        # Send WebSocket notification to requester
        self._send_takeover_notification(updated_request, 'accepted' if accept else 'declined')
        return updated_request
    
    def get_pending_requests(self, user_id: str):
        """Get all pending takeover requests for user's sessions"""
        return self.repo.get_pending_takeover_requests(user_id)
    
    def _send_takeover_notification(self, request, action: str):
        """Send WebSocket notification for takeover request"""
        try:
            from core.websocket import sio
            import asyncio
            
            if action == 'requested':
                # Notify current owner
                asyncio.create_task(
                    sio.emit('takeover_request', {
                        'request_id': request.request_id,
                        'session_id': request.session_id,
                        'requested_by': request.requested_by,
                        'message': f"{request.requested_by} wants to take over your session"
                    }, room=request.current_owner)
                )
            elif action in ['accepted', 'declined']:
                # Notify requester
                asyncio.create_task(
                    sio.emit('takeover_response', {
                        'request_id': request.request_id,
                        'session_id': request.session_id,
                        'status': action,
                        'message': f"Your takeover request was {action}"
                    }, room=request.requested_by)
                )
                
                if action == 'accepted':
                    # Also notify old owner they've been transferred out
                    asyncio.create_task(
                        sio.emit('session_transferred', {
                            'session_id': request.session_id,
                            'transferred_to': request.requested_by,
                            'message': f"Session transferred to {request.requested_by}"
                        }, room=request.current_owner)
                    )
        except Exception as e:
            # Don't fail the operation if WebSocket fails
            pass
    
    # Dashboard methods
    
    def get_all_sessions_for_dashboard(self, include_completed: bool = False) -> List:
        """Get all sessions for dashboard view with full details"""
        from .schemas import DashboardSessionSchema, SessionAuditLogSchema
        
        sessions = []
        
        # Get all sessions based on filters
        for session in self.repo._sessions.values():
            # Skip completed/cancelled unless explicitly requested
            if not include_completed and session.status in ["completed", "cancelled"]:
                # Only include recently completed/cancelled (last 24 hours)
                if session.completed_at:
                    hours_ago = (datetime.now() - session.completed_at).total_seconds() / 3600
                    if hours_ago > 24:
                        continue
            
            # Calculate progress
            items_expected = len(session.items_expected)
            items_scanned = len([item for item in session.items_scanned if item.get('qty_scanned', 0) > 0])
            progress = (items_scanned / items_expected * 100) if items_expected > 0 else 0
            
            # Convert audit logs
            audit_logs = []
            for log_entry in session.audit_logs:
                if isinstance(log_entry, dict):
                    audit_logs.append(SessionAuditLogSchema(
                        timestamp=datetime.fromisoformat(log_entry['timestamp']) if isinstance(log_entry['timestamp'], str) else log_entry['timestamp'],
                        action=log_entry['action'],
                        user=log_entry['user'],
                        details=log_entry.get('details')
                    ))
            
            dashboard_session = DashboardSessionSchema(
                session_id=session.session_id,
                order_number=session.order_number,
                invoice_number=session.invoice_id,
                status=session.status,
                session_type=session.session_type,
                current_owner=session.user_id,
                created_by=session.created_by or "Unknown",
                created_at=session.started_at,
                last_modified_by=session.last_modified_by,
                last_modified_at=session.last_modified_at,
                progress_percentage=round(progress, 1),
                items_expected=items_expected,
                items_scanned=items_scanned,
                audit_logs=audit_logs
            )
            
            sessions.append(dashboard_session)
        
        # Sort by last modified (most recent first)
        sessions.sort(key=lambda s: s.last_modified_at or s.created_at, reverse=True)
        
        return sessions
    
    def force_cancel_session(self, session_id: str, admin_user_id: str, reason: Optional[str] = None) -> bool:
        """Admin force cancel a session"""
        session = self.repo.get_session(session_id)
        if not session:
            return False
        
        previous_owner = session.user_id
        
        # Cancel the session
        success = self.repo.cancel_session(session_id, user_id=admin_user_id)
        
        if success and previous_owner:
            # Send WebSocket notification to the user who was working on it
            try:
                from core.websocket import emit_background
                
                message = f"Your session was cancelled by administrator {admin_user_id}"
                if reason:
                    message += f": {reason}"
                
                emit_background('session_forced_cancel', {
                    'session_id': session_id,
                    'cancelled_by': admin_user_id,
                    'reason': reason,
                    'message': message
                }, room=previous_owner)
                # Also broadcast to the inventory room so dashboards refresh immediately
                emit_background('session_forced_cancel', {
                    'session_id': session_id,
                    'cancelled_by': admin_user_id,
                    'reason': reason,
                    'message': message
                }, room='inventory_management')
            except Exception as e:
                pass
        
        return success
    
    def force_assign_session(self, session_id: str, target_user_id: str, admin_user_id: str) -> bool:
        """Admin force assign/transfer session to another user"""
        session = self.repo.get_session(session_id)
        if not session:
            return False
        
        previous_owner = session.user_id
        
        # Transfer with forced flag
        success = self.repo.transfer_session(
            session_id, 
            new_owner=target_user_id,
            transferred_by=admin_user_id,
            forced=True
        )
        
        if success:
            # Send WebSocket notifications
            try:
                from core.websocket import emit_background
                
                # Notify previous owner (if any)
                if previous_owner and previous_owner != target_user_id:
                    emit_background('session_forced_takeover', {
                        'session_id': session_id,
                        'transferred_to': target_user_id,
                        'transferred_by': admin_user_id,
                        'message': f"Administrator {admin_user_id} transferred your session to {target_user_id}. Please check with them."
                    }, room=previous_owner)
                
                # Notify new owner
                emit_background('session_assigned', {
                    'session_id': session_id,
                    'order_number': session.order_number,
                    'assigned_by': admin_user_id,
                    'message': f"Administrator {admin_user_id} assigned order {session.order_number} to you"
                }, room=target_user_id)
            except Exception as e:
                logger.warning(f"Failed to send WebSocket notification: {e}")
        
        return success
    
    def admin_takeover_session(self, session_id: str, admin_user_id: str) -> bool:
        """Admin forcefully takes over a session themselves"""
        session = self.repo.get_session(session_id)
        if not session:
            return False
        
        previous_owner = session.user_id
        
        # Prevent users from taking over their own session
        if previous_owner == admin_user_id:
            return None  # Special return value to indicate self-takeover attempt
        
        # Use force_assign to transfer ownership
        success = self.force_assign_session(session_id, admin_user_id, admin_user_id)
        
        # Additionally emit forced_takeover to the previous owner so they get kicked
        if success and previous_owner and previous_owner != admin_user_id:
            try:
                from core.websocket import emit_background
                emit_background('session_forced_takeover', {
                    'session_id': session_id,
                    'new_owner': admin_user_id,
                    'transferred_by': admin_user_id,
                    'message': f'{admin_user_id} has taken over your session'
                }, room=previous_owner)
            except Exception as e:
                logger.warning(f"Failed to send WebSocket notification: {e}")
        
        return success
    
    # Order Tracking methods
    
    def get_order_tracking_board(self):
        """Get all orders organized by status for the order tracking board"""
        from .schemas import OrderTrackingBoardSchema, OrderTrackingColumnSchema
        
        # Get sessions for each column
        # Ready to Pick: cancelled, drafted, approved, in-progress
        ready_to_pick_sessions = self.repo.get_sessions_by_status(
            ["cancelled", "draft", "approved", "in_progress"]
        )
        
        # Ready to Check
        ready_to_check_sessions = self.repo.get_sessions_by_status(["ready_to_check"])
        
        # Completed
        completed_sessions = self.repo.get_sessions_by_status(["completed"])
        
        # Convert to column schemas
        ready_to_pick = [self._session_to_column_schema(s) for s in ready_to_pick_sessions]
        ready_to_check = [self._session_to_column_schema(s) for s in ready_to_check_sessions]
        completed = [self._session_to_column_schema(s) for s in completed_sessions]
        
        return OrderTrackingBoardSchema(
            ready_to_pick=ready_to_pick,
            ready_to_check=ready_to_check,
            completed=completed
        )
    
    def _session_to_column_schema(self, session):
        """Convert a session to column schema for order tracking"""
        from .schemas import OrderTrackingColumnSchema
        
        # Calculate progress
        total_items = len(session.items_expected)
        completed_items = sum(1 for item in session.items_expected if item.get('is_complete', False))
        progress_percentage = (completed_items / total_items * 100) if total_items > 0 else 0
        
        # Get invoice details for customer name, total, and shipping method
        invoice = self.lookup_invoice(session.order_number)
        customer_name = invoice.billing_name if invoice else None
        grand_total = invoice.grand_total if invoice else None
        shipping_method = invoice.shipping_method if invoice else None
        
        return OrderTrackingColumnSchema(
            session_id=session.session_id,
            order_number=session.order_number,
            invoice_number=session.invoice_id,
            status=session.status,
            session_type=session.session_type,
            created_by=session.created_by or "Unknown",
            created_at=session.started_at,
            last_modified_at=session.last_modified_at,
            progress_percentage=progress_percentage,
            total_items=total_items,
            completed_items=completed_items,
            grand_total=grand_total,
            customer_name=customer_name,
            shipping_method=shipping_method
        )
    
    def mark_ready_to_check(self, session_id: str, user_id: Optional[str] = None) -> bool:
        """Mark a session as ready to check instead of completing it"""
        return self.repo.mark_session_ready_to_check(session_id, user_id)
    
    def approve_order_for_picking(self, order_number: str, user_id: str):
        """
        Approve a Magento order for picking by creating an approved session.
        
        IMPORTANT: This does NOT modify Magento. The order remains in 'processing' status
        in Magento. We only track the approval state locally in our database.
        
        Args:
            order_number: The Magento order number
            user_id: The user approving the order
            
        Returns:
            session_id: The ID of the created/approved session
        """
        # Lookup the invoice
        invoice = self.lookup_invoice(order_number)
        if not invoice:
            raise ValueError(f"No invoice found for order number: {order_number}")
        
        # Check if session already exists
        existing_session = self._get_any_session_for_invoice(invoice.invoice_number)
        if existing_session:
            # Just approve the existing session
            self.repo.approve_session(existing_session.session_id, user_id)
            return existing_session.session_id
        
        # Create new session in approved status
        session = self.repo.create_session(
            invoice_id=invoice.invoice_number,
            order_number=invoice.order_number,
            session_type="pick",
            items_expected=[item.model_dump() for item in invoice.items],
            user_id=None  # No user assigned yet
        )
        
        # Set status to approved
        self.repo.approve_session(session.session_id, user_id)
        
        return session.session_id
    
    def get_pending_magento_orders(self):
        """Get all pending Magento orders that need approval"""
        from .schemas import PendingMagentoOrderSchema
        
        try:
            logger.info("Starting to fetch pending Magento orders")
            
            # Get processing orders from Magento
            processing_orders = self.client.get_processing_orders()
            logger.info(f"Retrieved {len(processing_orders)} orders from Magento with 'processing' status")
            
            # Get all order numbers that already have sessions (approved or in progress)
            existing_sessions = self.repo.get_sessions_by_status(['approved', 'in_progress', 'ready_to_check', 'completed'])
            existing_order_numbers = {session.order_number for session in existing_sessions}
            logger.info(f"Found {len(existing_order_numbers)} orders that already have sessions: {existing_order_numbers}")
            
            # Filter out orders that already have sessions
            pending_orders = []
            filtered_count = 0
            for order in processing_orders:
                order_number = order.get('increment_id')
                
                # Skip if this order already has a session
                if order_number in existing_order_numbers:
                    logger.debug(f"Skipping order {order_number} - already has a session")
                    filtered_count += 1
                    continue
                
                # Build customer name
                customer_firstname = order.get('customer_firstname', '')
                customer_lastname = order.get('customer_lastname', '')
                customer_name = f"{customer_firstname} {customer_lastname}".strip() if customer_firstname or customer_lastname else None
                
                # Get customer email
                customer_email = order.get('customer_email')
                
                # Get total quantity ordered
                total_qty = order.get('total_qty_ordered', 0)
                
                # Get payment method if available
                payment = order.get('payment', {})
                payment_method = payment.get('method') if isinstance(payment, dict) else None
                
                # Get shipping method from order
                shipping_method = None
                ext_attrs = order.get('extension_attributes', {})
                if ext_attrs.get('shipping_assignments'):
                    shipping_assignment = ext_attrs['shipping_assignments'][0]
                    if shipping_assignment.get('shipping'):
                        shipping_info = shipping_assignment['shipping']
                        shipping_method = (
                            shipping_info.get('shipping_description') or
                            order.get('shipping_description') or
                            shipping_info.get('method')
                        )
                
                pending_orders.append(
                    PendingMagentoOrderSchema(
                        order_id=order.get('entity_id'),
                        order_number=order_number,
                        created_at=order.get('created_at'),
                        grand_total=float(order.get('grand_total', 0)),
                        status=order.get('status'),
                        customer_name=customer_name,
                        customer_email=customer_email,
                        total_qty_ordered=total_qty,
                        payment_method=payment_method,
                        shipping_method=shipping_method,
                        items=order.get('items', [])
                    )
                )
            
            logger.info(f"Returning {len(pending_orders)} pending orders (filtered out {filtered_count} with existing sessions)")
            if pending_orders:
                pending_order_numbers = [o.order_number for o in pending_orders]
                logger.info(f"Pending order numbers: {pending_order_numbers}")
            else:
                logger.warning("No pending orders found - check if Magento has orders in 'processing' status")
            
            return pending_orders
            
        except Exception as e:
            logger.error(f"Failed to get pending Magento orders: {e}", exc_info=True)
            return []



