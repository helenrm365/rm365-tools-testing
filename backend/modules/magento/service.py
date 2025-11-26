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
        First checks if there's an existing session for this order and returns appropriate response
        """
        # Lookup the invoice first
        invoice = self.lookup_invoice(request.order_number)
        
        if not invoice:
            raise ValueError(f"No invoice found for order number: {request.order_number}")
        
        print(f"[MagentoService] Checking for existing sessions for invoice {invoice.invoice_number}")
        
        # Check for any existing session for this invoice (any status)
        existing_session = self._get_any_session_for_invoice(invoice.invoice_number)
        
        if existing_session:
            print(f"  Found existing session: {existing_session.session_id} (status: {existing_session.status})")
            
            if existing_session.status == "completed":
                # Block completely - order already completed
                raise ValueError(
                    f"Order #{invoice.order_increment_id} is already completed by {existing_session.user_id or existing_session.created_by}. "
                    "Cannot start a new session."
                )
            
            elif existing_session.status == "in_progress":
                # In progress by another user - cannot start
                owner = existing_session.user_id or "Unknown"
                raise ValueError(
                    f"Order #{invoice.order_increment_id} is currently in progress by {owner}. "
                    "You cannot start a new session while it's being processed."
                )
            
            elif existing_session.status == "draft":
                # Draft exists - warn user but they can take over by claiming
                created_by = existing_session.created_by or existing_session.last_modified_by or "Unknown"
                raise ValueError(
                    f"Order #{invoice.order_increment_id} has a draft session started by {created_by}. "
                    "Use the claim endpoint to take over this draft session, or cancel it first to start fresh."
                )
            
            elif existing_session.status == "cancelled":
                # Cancelled - warn user but allow to continue
                cancelled_by = existing_session.last_modified_by or existing_session.created_by or "Unknown"
                print(f"  Warning: Previous session was cancelled by {cancelled_by}, allowing new session")
                # Continue to create new session
        
        print(f"[MagentoService] Starting new session for invoice:")
        print(f"  Invoice number: {invoice.invoice_number}")
        print(f"  Order number: {invoice.order_increment_id}")
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
        
        # Create session - starts in_progress and locked to user
        session = self.repo.create_session(
            invoice_id=invoice.invoice_number,
            order_number=invoice.order_increment_id,
            session_type=request.session_type,
            items_expected=items_expected,
            user_id=user_id
        )
        
        # Immediately claim it for the user
        if user_id:
            self.repo.claim_session(session.session_id, user_id)
        
        print(f"  Session created: {session.session_id} (status: in_progress, owner: {user_id})")
        
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
                print(f"[MagentoService] Item {item_id} not found in inventory_metadata")
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
                print(f"[MagentoService] Updated {update_field} by {delta} for item_id {item_id}")
            
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
    
    def release_session(self, session_id: str) -> bool:
        """Release a session back to draft"""
        return self.repo.release_session(session_id)
    
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
            print(f"[MagentoService] Failed to send WebSocket notification: {e}")
            # Don't fail the operation if WebSocket fails
    
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
                from core.websocket import sio
                import asyncio
                
                message = f"Your session was cancelled by administrator {admin_user_id}"
                if reason:
                    message += f": {reason}"
                
                asyncio.create_task(
                    sio.emit('session_forced_cancel', {
                        'session_id': session_id,
                        'cancelled_by': admin_user_id,
                        'reason': reason,
                        'message': message
                    }, room=previous_owner)
                )
            except Exception as e:
                print(f"[MagentoService] Failed to send WebSocket notification: {e}")
        
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
                from core.websocket import sio
                import asyncio
                
                # Notify previous owner (if any)
                if previous_owner and previous_owner != target_user_id:
                    asyncio.create_task(
                        sio.emit('session_forced_takeover', {
                            'session_id': session_id,
                            'transferred_to': target_user_id,
                            'transferred_by': admin_user_id,
                            'message': f"Administrator {admin_user_id} transferred your session to {target_user_id}. Please check with them."
                        }, room=previous_owner)
                    )
                
                # Notify new owner
                asyncio.create_task(
                    sio.emit('session_assigned', {
                        'session_id': session_id,
                        'order_number': session.order_number,
                        'assigned_by': admin_user_id,
                        'message': f"Administrator {admin_user_id} assigned order {session.order_number} to you"
                    }, room=target_user_id)
                )
            except Exception as e:
                print(f"[MagentoService] Failed to send WebSocket notification: {e}")
        
        return success
    
    def admin_takeover_session(self, session_id: str, admin_user_id: str) -> bool:
        """Admin forcefully takes over a session themselves"""
        return self.force_assign_session(session_id, admin_user_id, admin_user_id)


