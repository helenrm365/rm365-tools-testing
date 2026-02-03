"""
France Order Fulfillment Service - Business logic for order picking and checking operations

ARCHITECTURE OVERVIEW:
======================
This service manages the order fulfillment workflow for France region:
- Session management (start, pause/resume, complete, cancel)
- Inventory deduction and return during picking
- Order approval and tracking
- Integration with FR/NL Magento for READ-ONLY order data

Magento Integration (READ-ONLY):
- Fetch orders in 'processing' status from FR and NL databases
- Fetch invoice details and product information
- Never writes to Magento - all state is managed locally

Session Workflow:
- approved → in_progress → ready_to_check → completed
- Sessions can be cancelled at various stages
- Inventory is returned when pick-phase sessions are cancelled

Inventory Integration:
- Uses France branch inventory (fr_paris_inventory table)
- All stock deductions and returns go to/from France inventory
"""

# France branch inventory table name
FRANCE_INVENTORY_TABLE = 'fr_paris_inventory'

from typing import Optional, List
from datetime import datetime, timezone
import logging

from .db_client import get_france_magento_client
from .db_repo import FranceDbRepo
from modules.orders.order_fulfillment.models import MagentoInvoice
from modules.orders.order_fulfillment.schemas import (
    InvoiceDetailSchema,
    InvoiceItemSchema,
    ScanResultSchema,
    SessionStatusSchema,
    StartSessionSchema,
    ScanRequestSchema,
    CompleteSessionSchema
)

logger = logging.getLogger(__name__)


class FranceOrderFulfillmentService:
    """Business logic for France order fulfillment - picking, checking, and session management"""
    
    def __init__(self):
        self.client = get_france_magento_client()
        self.repo = FranceDbRepo()
    
    def check_tables_status(self) -> dict:
        """Check the status of France order fulfillment tables"""
        try:
            from .db_repo import check_france_fulfillment_tables_exist
            status = check_france_fulfillment_tables_exist()
            all_exist = all(status.values())
            
            return {
                "status": "success",
                "tables_status": status,
                "all_tables_exist": all_exist
            }
        except Exception as e:
            logger.error(f"Error checking tables: {e}")
            return {
                "status": "error",
                "message": f"Failed to check tables: {str(e)}"
            }
    
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
            
            elif existing_session.status == "approved":
                # Approved but not yet started - user can claim it
                approved_by = existing_session.last_modified_by or existing_session.created_by or "Unknown"
                raise ValueError(
                    f"Order #{invoice.order_number} is already approved by {approved_by}. "
                    "Use the claim endpoint to start picking this order."
                )
            
            elif existing_session.status == "ready_to_check":
                # Ready to check - if session_type is 'check', allow resuming for verification
                if request.session_type == "check":
                    # Resume the session for checking
                    session = self.repo.start_checking_session(
                        session_id=existing_session.session_id,
                        user_id=user_id
                    )
                    return self._session_to_status(session, invoice)
                else:
                    # Not a check session - cannot start picking
                    raise ValueError(
                        f"Order #{invoice.order_number} is ready for checking. "
                        "Cannot start a new picking session."
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
        return self.repo.get_any_session_for_invoice(invoice_id)

    
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
            # This is an item_id - look up the SKU from database
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
        # Handle both qty_expected and qty_invoiced for backwards compatibility
        expected_qty = expected_item.get('qty_expected') or expected_item.get('qty_invoiced') or 1
        
        # Handle negative quantities (returns/undos)
        if request.quantity < 0:
            return self._handle_return_scan(
                request=request,
                lookup_sku=lookup_sku,
                expected_item=expected_item,
                session=session,
                current_qty=current_qty,
                expected_qty=expected_qty
            )
        
        # Check for overpicking BEFORE allowing the scan
        if new_qty > expected_qty:
            return ScanResultSchema(
                success=False,
                message=f"❌ Cannot scan: Would exceed expected quantity. Expected {int(expected_qty)}, already scanned {int(current_qty)}. Use 'Remove Scan' to correct.",
                sku=lookup_sku,
                item_name=expected_item['name'],
                qty_expected=expected_qty,
                qty_scanned=current_qty,
                qty_remaining=max(0, expected_qty - current_qty),
                is_complete=False,
                is_overpicked=True,
                all_items_complete=False
            )
        
        # Check inventory availability BEFORE allowing the scan
        try:
            item_id = self._get_item_id_by_sku(lookup_sku)
            if item_id:
                # Check if there's enough stock
                available_stock = self._check_inventory_availability(item_id, request.quantity, request.field)
                if not available_stock['has_stock']:
                    return ScanResultSchema(
                        success=False,
                        message=f"❌ INSUFFICIENT STOCK: Cannot scan this item.\n\n{available_stock['detail']}\n\n⚠️ If you believe stock exists, there may be a count discrepancy. Please cancel this order and investigate the inventory.",
                        sku=lookup_sku,
                        item_name=expected_item['name'],
                        qty_expected=expected_qty,
                        qty_scanned=current_qty,
                        qty_remaining=max(0, expected_qty - current_qty),
                        is_complete=False,
                        is_overpicked=False,
                        all_items_complete=False,
                        warning="Insufficient inventory - order should be cancelled"
                    )
                # Deduct the stock and get deduction records
                deduction_records = self._deduct_inventory_stock(item_id, request.quantity, request.field)
            else:
                # No item_id found - block the scan
                return ScanResultSchema(
                    success=False,
                    message=f"❌ Cannot scan: SKU {lookup_sku} not found in inventory database. Please verify this product exists in the system.",
                    sku=lookup_sku,
                    item_name=expected_item['name'],
                    qty_expected=expected_qty,
                    qty_scanned=current_qty,
                    qty_remaining=max(0, expected_qty - current_qty),
                    is_complete=False,
                    is_overpicked=False,
                    all_items_complete=False
                )
        except Exception as e:
            print(f"[FranceOrderFulfillmentService] Error checking/deducting inventory: {e}")
            return ScanResultSchema(
                success=False,
                message=f"❌ Inventory error: {str(e)}\n\nPlease investigate before continuing.",
                sku=lookup_sku,
                item_name=expected_item['name'],
                qty_expected=expected_qty,
                qty_scanned=current_qty,
                qty_remaining=max(0, expected_qty - current_qty),
                is_complete=False,
                is_overpicked=False,
                all_items_complete=False
            )
        
        # Stock is available - now add the scanned item with deduction tracking
        self.repo.add_scanned_item(request.session_id, lookup_sku, request.quantity, deduction_records)
        
        # Determine result
        is_complete = new_qty >= expected_qty
        qty_remaining = max(0, expected_qty - new_qty)
        
        # Check if all items are complete
        all_complete = self._check_all_items_complete(session)
        
        if is_complete:
            message = f"✅ Complete! {expected_item['name']} ({lookup_sku})"
        else:
            message = f"✓ Scanned {lookup_sku}. {int(qty_remaining)} remaining"
        
        return ScanResultSchema(
            success=True,
            message=message,
            sku=lookup_sku,
            item_name=expected_item['name'],
            qty_expected=expected_qty,
            qty_scanned=new_qty,
            qty_remaining=qty_remaining,
            is_complete=is_complete,
            is_overpicked=False,
            all_items_complete=all_complete
        )

    def _handle_return_scan(self, request: ScanRequestSchema, lookup_sku: str, 
                           expected_item: dict, session, current_qty: float, 
                           expected_qty: float) -> ScanResultSchema:
        """
        Handle negative quantity scans (returning items to inventory).
        
        If field is 'auto': Returns items in REVERSE order of how they were taken:
        - Taking order:   shelf_lt1_qty → shelf_gt1_qty → top_floor_total
        - Return order:   top_floor_total → shelf_gt1_qty → shelf_lt1_qty
        
        If field is specific (e.g. 'shelf_lt1_qty'): Returns directly to that location.
        
        Uses deduction sources to track what's available to return from each location.
        """
        return_qty = abs(request.quantity)  # Make positive for calculations
        
        # Validate: can't return more than scanned
        if return_qty > current_qty:
            return ScanResultSchema(
                success=False,
                message=f"❌ Cannot return {int(return_qty)}: Only {int(current_qty)} have been scanned.",
                sku=lookup_sku,
                item_name=expected_item['name'],
                qty_expected=expected_qty,
                qty_scanned=current_qty,
                qty_remaining=max(0, expected_qty - current_qty),
                is_complete=False,
                is_overpicked=False,
                all_items_complete=False
            )
        
        # Get item_id for inventory updates
        item_id = self._get_item_id_by_sku(lookup_sku)
        if not item_id:
            return ScanResultSchema(
                success=False,
                message=f"❌ Cannot return: SKU {lookup_sku} not found in inventory.",
                sku=lookup_sku,
                item_name=expected_item['name'],
                qty_expected=expected_qty,
                qty_scanned=current_qty,
                qty_remaining=max(0, expected_qty - current_qty),
                is_complete=False,
                is_overpicked=False,
                all_items_complete=False
            )
        
        field_names = {
            'shelf_lt1_qty': 'Shelf <1 Year',
            'shelf_gt1_qty': 'Shelf >1 Year', 
            'top_floor_total': 'Top Floor'
        }
        
        # Get deduction sources to know total remaining to return
        deduction_sources = self.repo.get_deduction_sources(request.session_id, lookup_sku)
        
        # Case 1: Specific field selected (not 'auto') - return directly to that location
        # User can return items to ANY location, we just track total remaining to return
        if request.field != 'auto':
            try:
                # Return to the specified inventory location
                self._return_inventory_stock(item_id, return_qty, request.field)
                
                # Update tracked quantities
                self.repo.reduce_scanned_quantity(request.session_id, lookup_sku, return_qty)
                
                # Reduce remaining from deduction sources (any sources, in reverse order)
                # This just tracks "how many still need to be returned" - not per location
                remaining_to_deduct = return_qty
                for field in ['top_floor_total', 'shelf_gt1_qty', 'shelf_lt1_qty']:
                    if remaining_to_deduct <= 0:
                        break
                    for source in deduction_sources:
                        if source['field'] == field:
                            available = source.get('remaining', source['quantity'])
                            if available > 0:
                                deduct_from_here = min(remaining_to_deduct, available)
                                self.repo.update_deduction_source_remaining(
                                    request.session_id, lookup_sku, field, deduct_from_here
                                )
                                remaining_to_deduct -= deduct_from_here
                            break
                
                new_qty = current_qty - return_qty
                location_name = field_names.get(request.field, request.field)
                
                return ScanResultSchema(
                    success=True,
                    message=f"↩️ Returned {int(return_qty)} to {location_name}. {expected_item['name']} ({lookup_sku})",
                    sku=lookup_sku,
                    item_name=expected_item['name'],
                    qty_expected=expected_qty,
                    qty_scanned=new_qty,
                    qty_remaining=max(0, expected_qty - new_qty),
                    is_complete=new_qty >= expected_qty,
                    is_overpicked=False,
                    all_items_complete=self._check_all_items_complete(session)
                )
            except Exception as e:
                return ScanResultSchema(
                    success=False,
                    message=f"❌ Error returning to inventory: {str(e)}",
                    sku=lookup_sku,
                    item_name=expected_item['name'],
                    qty_expected=expected_qty,
                    qty_scanned=current_qty,
                    qty_remaining=max(0, expected_qty - current_qty),
                    is_complete=False,
                    is_overpicked=False,
                    all_items_complete=False
                )
        
        # Case 2: Auto mode - use reverse order based on deduction sources
        # Build a map of remaining by field (deduction_sources already fetched above)
        remaining_by_field = {}
        for source in deduction_sources:
            remaining_by_field[source['field']] = source.get('remaining', source['quantity'])
        
        # REVERSE order for returns: top_floor_total → shelf_gt1_qty → shelf_lt1_qty
        return_priority = ['top_floor_total', 'shelf_gt1_qty', 'shelf_lt1_qty']
        
        try:
            remaining_to_return = return_qty
            returned_locations = []
            
            for field in return_priority:
                if remaining_to_return <= 0:
                    break
                
                available = remaining_by_field.get(field, 0)
                if available <= 0:
                    continue
                
                # Return as many as possible to this location
                qty_to_return_here = min(remaining_to_return, available)
                
                # Return to inventory
                self._return_inventory_stock(item_id, qty_to_return_here, field)
                
                # Update deduction source remaining
                self.repo.update_deduction_source_remaining(request.session_id, lookup_sku, field, qty_to_return_here)
                
                returned_locations.append(f"{field_names.get(field, field)}: {int(qty_to_return_here)}")
                remaining_to_return -= qty_to_return_here
            
            # Update scanned quantity
            self.repo.reduce_scanned_quantity(request.session_id, lookup_sku, return_qty)
            new_qty = current_qty - return_qty
            
            # Build message
            if len(returned_locations) == 1:
                location_msg = returned_locations[0].split(':')[0]  # Just the location name
                message = f"↩️ Returned {int(return_qty)} to {location_msg}. {expected_item['name']} ({lookup_sku})"
            else:
                message = f"↩️ Returned {int(return_qty)} to stock ({', '.join(returned_locations)}). {expected_item['name']} ({lookup_sku})"
            
            return ScanResultSchema(
                success=True,
                message=message,
                sku=lookup_sku,
                item_name=expected_item['name'],
                qty_expected=expected_qty,
                qty_scanned=new_qty,
                qty_remaining=max(0, expected_qty - new_qty),
                is_complete=new_qty >= expected_qty,
                is_overpicked=False,
                all_items_complete=self._check_all_items_complete(session)
            )
            
        except Exception as e:
            return ScanResultSchema(
                success=False,
                message=f"❌ Error returning to inventory: {str(e)}",
                sku=lookup_sku,
                item_name=expected_item['name'],
                qty_expected=expected_qty,
                qty_scanned=current_qty,
                qty_remaining=max(0, expected_qty - current_qty),
                is_complete=False,
                is_overpicked=False,
                all_items_complete=False
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
    
    def cancel_session(self, session_id: str, user_id: Optional[str] = None) -> dict:
        """
        Cancel a session and return scanned items to inventory (for pick-phase only).
        
        BEHAVIOR BY STATUS:
        - draft: Returns inventory, marks as cancelled
        - in_progress: Returns inventory, marks as cancelled
        - ready_to_check: Just clears items_counted (checker's count), stays in ready_to_check
                          Does NOT return inventory - use "send back for picking" then cancel there
        - approved: Nothing to return, marks as cancelled
        - completed: Cannot be cancelled
        
        Returns dict with success status, message, and items_returned count.
        """
        session = self.repo.get_session(session_id)
        
        if not session:
            return {"success": False, "message": "Session not found", "items_returned": 0}
        
        # Don't allow cancelling completed sessions
        if session.status == 'completed':
            return {"success": False, "message": "Cannot cancel a completed session", "items_returned": 0}
        
        # Special handling for ready_to_check: just reset the checker's count
        if session.status == 'ready_to_check':
            # Clear items_counted but keep the session in ready_to_check
            success = self.repo.clear_items_counted(session_id, user_id)
            if success:
                return {
                    "success": True, 
                    "message": "Checker's count cleared. Order remains ready to check.", 
                    "items_returned": 0,
                    "action": "count_cleared"
                }
            else:
                return {"success": False, "message": "Failed to clear count", "items_returned": 0}
        
        items_returned = 0
        return_details = []
        
        # Return items for pick-phase sessions only (draft, in_progress)
        # Does NOT include: approved (nothing scanned), ready_to_check (handled above), completed
        pick_phase_with_scans = session.status in ('draft', 'in_progress')
        
        if pick_phase_with_scans and session.items_scanned:
            for scanned_item in session.items_scanned:
                sku = scanned_item.get('sku')
                qty_scanned = scanned_item.get('qty_scanned', 0)
                deduction_sources = scanned_item.get('deduction_sources', [])
                
                if qty_scanned > 0 and deduction_sources:
                    # Get item_id from France inventory for this SKU
                    item_id = self._get_item_id_from_sku(sku)
                    if not item_id:
                        print(f"[FranceOrdersService] Warning: Could not find item_id for SKU {sku}")
                        continue
                    
                    # Return each item to its original location based on deduction sources
                    for source in deduction_sources:
                        field = source.get('field')
                        remaining = source.get('remaining', 0)  # Items still held from this location
                        
                        if remaining > 0 and field:
                            try:
                                self._return_inventory_stock(item_id, remaining, field)
                                items_returned += remaining
                                
                                field_names = {
                                    'shelf_lt1_qty': 'Shelf <1 Year',
                                    'shelf_gt1_qty': 'Shelf >1 Year',
                                    'top_floor_total': 'Top Floor'
                                }
                                return_details.append(f"{sku}: {int(remaining)} → {field_names.get(field, field)}")
                                print(f"[FranceOrderFulfillmentService] Cancel return: {remaining} of {sku} to {field}")
                            except Exception as e:
                                print(f"[FranceOrderFulfillmentService] Error returning {sku} to {field}: {e}")
        
        # Now actually cancel the session in the database
        success = self.repo.cancel_session(session_id, user_id=user_id)
        
        if success:
            if items_returned > 0:
                message = f"Session cancelled. {int(items_returned)} item(s) returned to inventory."
            else:
                message = "Session cancelled."
            return {"success": True, "message": message, "items_returned": int(items_returned), "details": return_details}
        else:
            return {"success": False, "message": "Failed to cancel session", "items_returned": 0}
    
    def _get_item_id_from_sku(self, sku: str) -> Optional[str]:
        """Get item_id from France inventory table for a given SKU"""
        conn = None
        try:
            try:
                from core.db import get_inventory_log_connection
                conn = get_inventory_log_connection()
            except (ValueError, Exception):
                from core.db import get_psycopg_connection
                conn = get_psycopg_connection()
            
            cursor = conn.cursor()
            cursor.execute(f"SELECT item_id FROM {FRANCE_INVENTORY_TABLE} WHERE sku = %s", (sku,))
            row = cursor.fetchone()
            cursor.close()
            
            if conn:
                try:
                    from core.db import return_inventory_connection
                    return_inventory_connection(conn)
                except:
                    from core.db import return_psycopg_connection
                    return_psycopg_connection(conn)
            
            return row[0] if row else None
        except Exception as e:
            print(f"[FranceOrdersService] Error getting item_id for SKU {sku}: {e}")
            return None
    
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
        # Build a lookup for items_counted (sku -> qty_counted)
        counted_lookup = {}
        if session.items_counted:
            for counted_item in session.items_counted:
                sku = counted_item.get('sku')
                qty = counted_item.get('qty_counted', 0)
                if sku:
                    counted_lookup[sku] = qty
        
        # Merge invoice items with scanned quantities
        items = []
        for inv_item in invoice.items:
            qty_scanned = self.repo.get_scanned_quantity(session.session_id, inv_item.sku)
            qty_counted = counted_lookup.get(inv_item.sku)  # Will be None if not counted
            item = InvoiceItemSchema(
                sku=inv_item.sku,
                name=inv_item.name,
                qty_ordered=inv_item.qty_ordered,
                qty_invoiced=inv_item.qty_invoiced,
                qty_scanned=qty_scanned,
                qty_counted=qty_counted,
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
            # Handle both qty_expected and qty_invoiced for backwards compatibility
            qty_expected = expected_item.get('qty_expected') or expected_item.get('qty_invoiced') or 1
            qty_scanned = self.repo.get_scanned_quantity(session.session_id, sku)
            
            if qty_scanned < qty_expected:
                return False
        
        return True


    def _get_item_id_by_sku(self, sku: str) -> Optional[str]:
        """Get item_id for a SKU from France inventory table"""
        conn = None
        conn_type = None
        try:
            # Try inventory database first, fallback to main database
            try:
                from core.db import get_inventory_log_connection, return_inventory_connection
                conn = get_inventory_log_connection()
                conn_type = 'inventory'
            except (ValueError, Exception) as e:
                print(f"[FranceOrdersService] Inventory database not available ({e}), using main database")
                from core.db import get_psycopg_connection, return_psycopg_connection
                conn = get_psycopg_connection()
                conn_type = 'psycopg'
            
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT item_id FROM {FRANCE_INVENTORY_TABLE} WHERE sku = %s",
                (sku,)
            )
            result = cursor.fetchone()
            cursor.close()
            
            # Return connection to appropriate pool
            if conn_type == 'inventory':
                from core.db import return_inventory_connection
                return_inventory_connection(conn)
            else:
                from core.db import return_psycopg_connection
                return_psycopg_connection(conn)
            
            return result[0] if result else None
        except Exception as e:
            print(f"[FranceOrdersService] Error looking up item_id: {e}")
            return None
    
    def _check_inventory_availability(self, item_id: str, quantity: int, field: str = "auto") -> dict:
        """
        Check if there's sufficient inventory available for scanning.
        Returns dict with 'has_stock' (bool) and 'detail' (str) with availability info.
        """
        conn = None
        conn_type = None
        
        def return_conn():
            if conn:
                if conn_type == 'inventory':
                    from core.db import return_inventory_connection
                    return_inventory_connection(conn)
                else:
                    from core.db import return_psycopg_connection
                    return_psycopg_connection(conn)
        
        try:
            # Try inventory database first, fallback to main database
            try:
                from core.db import get_inventory_log_connection
                conn = get_inventory_log_connection()
                conn_type = 'inventory'
            except (ValueError, Exception) as e:
                print(f"[FranceOrderFulfillmentService] Inventory database not available ({e}), using main database")
                from core.db import get_psycopg_connection
                conn = get_psycopg_connection()
                conn_type = 'psycopg'
            
            cursor = conn.cursor()
            
            # Get current inventory levels from France branch
            cursor.execute(
                f"""
                SELECT shelf_lt1_qty, shelf_gt1_qty, top_floor_total
                FROM {FRANCE_INVENTORY_TABLE}
                WHERE item_id = %s
                """,
                (item_id,)
            )
            result = cursor.fetchone()
            cursor.close()
            return_conn()
            
            if not result:
                return {
                    'has_stock': False,
                    'detail': f"Item {item_id} not found in France inventory."
                }
            
            shelf_lt1, shelf_gt1, top_floor = result
            shelf_lt1 = shelf_lt1 or 0
            shelf_gt1 = shelf_gt1 or 0
            top_floor = top_floor or 0
            total_available = shelf_lt1 + shelf_gt1 + top_floor
            
            detail = f"Requested: {quantity}, Available: {int(total_available)} (Shelf <1: {int(shelf_lt1)}, Shelf >1: {int(shelf_gt1)}, Top Floor: {int(top_floor)})"
            
            # If specific field selected, check only that field
            if field != "auto":
                field_values = {
                    'shelf_lt1_qty': shelf_lt1,
                    'shelf_gt1_qty': shelf_gt1,
                    'top_floor_total': top_floor
                }
                available_in_field = field_values.get(field, 0)
                if available_in_field < quantity:
                    return {
                        'has_stock': False,
                        'detail': f"Requested: {quantity} from {field}, Available: {int(available_in_field)}"
                    }
                return {'has_stock': True, 'detail': detail}
            
            # Auto mode - check total availability
            if total_available < quantity:
                return {
                    'has_stock': False,
                    'detail': detail
                }
            
            return {'has_stock': True, 'detail': detail}
            
        except Exception as e:
            print(f"[FranceOrderFulfillmentService] Error checking inventory availability: {e}")
            return {
                'has_stock': False,
                'detail': f"Error checking inventory: {str(e)}"
            }
    
    def _deduct_inventory_stock(self, item_id: str, quantity: int, field: str = "auto") -> list:
        """
        Deduct stock from France inventory (fr_paris_inventory table)
        field: 'auto' (smart shelf logic), 'shelf_lt1_qty', 'shelf_gt1_qty', or 'top_floor_total'
        
        Returns: List of deduction records [{'field': str, 'quantity': int}, ...]
        """
        conn = None
        conn_type = None
        deduction_records = []
        
        def return_conn():
            if conn:
                if conn_type == 'inventory':
                    from core.db import return_inventory_connection
                    return_inventory_connection(conn)
                else:
                    from core.db import return_psycopg_connection
                    return_psycopg_connection(conn)
        
        try:
            # Try inventory database first, fallback to main database
            try:
                from core.db import get_inventory_log_connection
                conn = get_inventory_log_connection()
                conn_type = 'inventory'
            except (ValueError, Exception) as e:
                print(f"[FranceOrderFulfillmentService] Inventory database not available ({e}), using main database")
                from core.db import get_psycopg_connection
                conn = get_psycopg_connection()
                conn_type = 'psycopg'
            
            cursor = conn.cursor()
            
            # Get current inventory levels from France branch
            cursor.execute(
                f"""
                SELECT shelf_lt1_qty, shelf_gt1_qty, top_floor_total
                FROM {FRANCE_INVENTORY_TABLE}
                WHERE item_id = %s
                """,
                (item_id,)
            )
            result = cursor.fetchone()
            
            if not result:
                cursor.close()
                return_conn()
                return deduction_records
            
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
                    return_conn()
                    raise ValueError(
                        f"Insufficient stock in {field} for item {item_id}. "
                        f"Requested: {quantity}, Available: {current_value}"
                    )
                
                updates.append((field, -needed))
                deduction_records.append({'field': field, 'quantity': needed})
            else:
                # Auto mode: Use smart shelf priority
                # Priority 1: Take from shelf_lt1_qty first
                if shelf_lt1 > 0:
                    take_from_lt1 = min(needed, shelf_lt1)
                    updates.append(('shelf_lt1_qty', -take_from_lt1))
                    deduction_records.append({'field': 'shelf_lt1_qty', 'quantity': take_from_lt1})
                    needed -= take_from_lt1
                
                # Priority 2: Take from shelf_gt1_qty if needed
                if needed > 0 and shelf_gt1 > 0:
                    take_from_gt1 = min(needed, shelf_gt1)
                    updates.append(('shelf_gt1_qty', -take_from_gt1))
                    deduction_records.append({'field': 'shelf_gt1_qty', 'quantity': take_from_gt1})
                    needed -= take_from_gt1
                
                # Priority 3: Take from top_floor_total if still needed
                if needed > 0 and top_floor > 0:
                    take_from_top = min(needed, top_floor)
                    updates.append(('top_floor_total', -take_from_top))
                    deduction_records.append({'field': 'top_floor_total', 'quantity': take_from_top})
                    needed -= take_from_top
                
                # If we couldn't fulfill the entire request, raise an error
                if needed > 0:
                    cursor.close()
                    return_conn()
                    total_available = shelf_lt1 + shelf_gt1 + top_floor
                    raise ValueError(
                        f"Insufficient stock for item {item_id}. "
                        f"Requested: {quantity}, Available: {total_available} "
                        f"(Shelf <1: {shelf_lt1}, Shelf >1: {shelf_gt1}, Top Floor: {top_floor})"
                    )
            
            # Apply the updates to France inventory
            for update_field, delta in updates:
                cursor.execute(
                    f"""
                    UPDATE {FRANCE_INVENTORY_TABLE}
                    SET {update_field} = {update_field} + %s
                    WHERE item_id = %s
                    """,
                    (delta, item_id)
                )
            
            conn.commit()
            cursor.close()
            return_conn()
            
            return deduction_records
            
        except Exception as e:
            print(f"[FranceOrderFulfillmentService] Error deducting inventory: {e}")
            raise

    def _return_inventory_stock(self, item_id: str, quantity: int, field: str):
        """
        Return stock to a specific location in France inventory
        field: 'shelf_lt1_qty', 'shelf_gt1_qty', or 'top_floor_total'
        """
        conn = None
        conn_type = None
        
        def return_conn():
            if conn:
                if conn_type == 'inventory':
                    from core.db import return_inventory_connection
                    return_inventory_connection(conn)
                else:
                    from core.db import return_psycopg_connection
                    return_psycopg_connection(conn)
        
        try:
            # Try inventory database first, fallback to main database
            try:
                from core.db import get_inventory_log_connection
                conn = get_inventory_log_connection()
                conn_type = 'inventory'
            except (ValueError, Exception) as e:
                print(f"[FranceOrderFulfillmentService] Inventory database not available ({e}), using main database")
                from core.db import get_psycopg_connection
                conn = get_psycopg_connection()
                conn_type = 'psycopg'
            
            cursor = conn.cursor()
            
            # Add stock back to France inventory
            cursor.execute(
                f"""
                UPDATE {FRANCE_INVENTORY_TABLE}
                SET {field} = COALESCE({field}, 0) + %s
                WHERE item_id = %s
                """,
                (quantity, item_id)
            )
            
            conn.commit()
            cursor.close()
            return_conn()
            
            print(f"[FranceOrdersService] Returned {quantity} to {field} for item {item_id}")
            
        except Exception as e:
            print(f"[FranceOrderFulfillmentService] Error returning inventory: {e}")
            raise
    
    # Collaborative session management methods
    
    def check_session_access(self, session_id: str, user_id: str):
        """Check if user can access a session and return ownership info"""
        from modules.orders.order_fulfillment.schemas import SessionOwnershipSchema
        
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
    
    # Dashboard methods
    
    def get_all_sessions_for_dashboard(self, include_completed: bool = False) -> List:
        """Get all sessions for dashboard view with full details"""
        from modules.orders.order_fulfillment.schemas import DashboardSessionSchema, SessionAuditLogSchema
        
        sessions = []
        
        # Get all sessions from database
        all_sessions = self.repo.get_all_sessions()
        
        for session in all_sessions:
            # Skip completed/cancelled unless explicitly requested
            if not include_completed and session.status in ["completed", "cancelled"]:
                # Only include recently completed/cancelled (last 24 hours)
                if session.completed_at:
                    # Use timezone-aware datetime for comparison
                    completed_at = session.completed_at
                    if completed_at.tzinfo is None:
                        completed_at = completed_at.replace(tzinfo=timezone.utc)
                    hours_ago = (datetime.now(timezone.utc) - completed_at).total_seconds() / 3600
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
                }, room='france_orders')
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
        from modules.orders.order_fulfillment.schemas import OrderTrackingBoardSchema, OrderTrackingColumnSchema
        
        # Get sessions for each column
        # Ready to Pick: cancelled, draft, approved, in-progress (only for pick/return session types)
        ready_to_pick_sessions = self.repo.get_sessions_by_status(
            ["cancelled", "draft", "approved", "in_progress"]
        )
        # Filter to only include picking sessions (not checking sessions)
        ready_to_pick_sessions = [s for s in ready_to_pick_sessions if s.session_type != 'check']
        
        # Ready to Check: includes ready_to_check status AND in-progress/draft check sessions
        ready_to_check_sessions = self.repo.get_sessions_by_status(["ready_to_check"])
        
        # Also add checking sessions that are in_progress or draft
        checking_sessions = self.repo.get_sessions_by_status(["in_progress", "draft"])
        checking_sessions = [s for s in checking_sessions if s.session_type == 'check']
        ready_to_check_sessions.extend(checking_sessions)
        
        # Completed
        completed_sessions = self.repo.get_sessions_by_status(["completed"])
        
        # Deduplicate: keep only the latest session per order number
        def dedupe_sessions(sessions):
            """Keep only the most recent session per order number"""
            order_map = {}
            for session in sessions:
                order_num = session.order_number
                if order_num not in order_map:
                    order_map[order_num] = session
                else:
                    # Keep the one with the more recent last_modified_at
                    existing = order_map[order_num]
                    existing_time = existing.last_modified_at or existing.started_at
                    new_time = session.last_modified_at or session.started_at
                    if new_time and existing_time and new_time > existing_time:
                        order_map[order_num] = session
            return list(order_map.values())
        
        ready_to_pick_sessions = dedupe_sessions(ready_to_pick_sessions)
        ready_to_check_sessions = dedupe_sessions(ready_to_check_sessions)
        completed_sessions = dedupe_sessions(completed_sessions)
        
        # Exclude from Ready to Pick any orders that are already in Ready to Check or Completed
        # This prevents an order from showing in multiple columns
        ready_to_check_order_nums = {s.order_number for s in ready_to_check_sessions}
        completed_order_nums = {s.order_number for s in completed_sessions}
        excluded_order_nums = ready_to_check_order_nums | completed_order_nums
        
        ready_to_pick_sessions = [s for s in ready_to_pick_sessions if s.order_number not in excluded_order_nums]
        
        # Also exclude from Ready to Check any orders that are already Completed
        ready_to_check_sessions = [s for s in ready_to_check_sessions if s.order_number not in completed_order_nums]
        
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
        from modules.orders.order_fulfillment.schemas import OrderTrackingColumnSchema
        
        # Calculate progress by comparing items_expected with items_scanned
        total_items = len(session.items_expected)
        
        # Build a map of scanned quantities by SKU
        scanned_map = {}
        for item in (session.items_scanned or []):
            sku = item.get('sku')
            if sku:
                scanned_map[sku] = item.get('qty_scanned', 0)
        
        # Count how many items are complete (scanned >= expected)
        completed_items = 0
        for item in session.items_expected:
            sku = item.get('sku')
            qty_expected = item.get('qty_expected') or item.get('qty_invoiced') or 1
            qty_scanned = scanned_map.get(sku, 0)
            if qty_scanned >= qty_expected:
                completed_items += 1
        
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
    
    def send_back_for_picking(self, session_id: str, user_id: Optional[str] = None, items_counted: Optional[list] = None) -> bool:
        """Send an order back for picking from the checking phase
        
        Args:
            session_id: The session ID
            user_id: The user sending the order back
            items_counted: List of {sku, qty_counted} from the checker's count
        """
        return self.repo.send_back_for_picking(session_id, user_id, items_counted)
    
    def approve_order_for_picking(self, order_number: str, user_id: str):
        """
        Approve a Magento order for picking by creating or reactivating a session.
        
        IMPORTANT: This does NOT modify Magento. The order remains in 'processing' status
        in Magento. We only track the approval state locally in our database.
        
        Logic:
        1. If an active session exists (draft, approved, in_progress, etc.) - approve it
        2. If an archived session exists - reactivate it (preserves audit history)
        3. Otherwise create a new session
        
        Args:
            order_number: The Magento order number
            user_id: The user approving the order
            
        Returns:
            session_id: The ID of the created/reactivated/approved session
        """
        # Lookup the invoice
        invoice = self.lookup_invoice(order_number)
        if not invoice:
            raise ValueError(f"No invoice found for order number: {order_number}")
        
        # Check if an ACTIVE session already exists
        existing_session = self._get_any_session_for_invoice(invoice.invoice_number)
        if existing_session:
            # Just approve the existing session
            self.repo.approve_session(existing_session.session_id, user_id)
            logger.info(f"Approved existing active session {existing_session.session_id} for order {order_number}")
            return existing_session.session_id
        
        # Check if an ARCHIVED session exists - reactivate instead of creating new
        archived_session = self.repo.get_archived_session_for_invoice(invoice.invoice_number)
        if archived_session:
            # Reactivate the archived session - preserves audit history!
            success = self.repo.reactivate_session(archived_session.session_id, user_id)
            if success:
                logger.info(f"Reactivated archived session {archived_session.session_id} for order {order_number}")
                return archived_session.session_id
            else:
                logger.warning(f"Failed to reactivate session {archived_session.session_id}, creating new one")
        
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
        logger.info(f"Created and approved new session {session.session_id} for order {order_number}")
        
        return session.session_id
    
    def get_pending_magento_orders(self):
        """Get all pending Magento orders that need approval"""
        from modules.orders.order_fulfillment.schemas import PendingMagentoOrderSchema
        
        try:
            logger.info("Starting to fetch pending Magento orders")
            
            # Get processing orders from Magento
            processing_orders = self.client.get_processing_orders()
            logger.info(f"Retrieved {len(processing_orders)} orders from Magento with 'processing' status")
            
            # Get all order numbers that already have ACTIVE sessions
            # Excludes: archived, cancelled - those orders should reappear for re-approval
            existing_sessions = self.repo.get_sessions_by_status(['draft', 'approved', 'in_progress', 'ready_to_check', 'completed'])
            existing_order_numbers = {session.order_number for session in existing_sessions}
            logger.info(f"Found {len(existing_order_numbers)} orders that already have active sessions: {existing_order_numbers}")
            
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
    
    def reset_daily_sessions(self) -> dict:
        """
        Archive all order sessions at end of day.
        
        This runs at configured time and:
        1. Returns scanned items to inventory for INCOMPLETE sessions only
           (draft, in_progress, ready_to_check, approved)
        2. Archives ALL sessions (including completed/cancelled) so they don't show next day
        3. Adds audit log entry preserving the original status before archiving
        4. Clears all pending takeover requests
        
        The next day:
        - Completed orders won't appear (they're done)
        - Incomplete orders still 'processing' on Magento will reappear in pending approvals
        """
        try:
            logger.info("🔄 Starting daily order session archive with inventory returns...")
            
            # Get all incomplete sessions that have scanned items
            incomplete_statuses = ['draft', 'in_progress', 'ready_to_check', 'approved']
            sessions_with_items = []
            
            for status in incomplete_statuses:
                sessions = self.repo.get_sessions_by_status([status])
                for session in sessions:
                    if session.items_scanned:
                        sessions_with_items.append(session)
            
            # Return inventory for each session with scanned items
            total_items_returned = 0
            sessions_with_returns = 0
            return_errors = []
            
            for session in sessions_with_items:
                session_items_returned = 0
                
                for scanned_item in session.items_scanned:
                    sku = scanned_item.get('sku')
                    qty_scanned = scanned_item.get('qty_scanned', 0)
                    deduction_sources = scanned_item.get('deduction_sources', [])
                    
                    if qty_scanned > 0 and deduction_sources:
                        item_id = self._get_item_id_from_sku(sku)
                        if not item_id:
                            logger.warning(f"Could not find item_id for SKU {sku} during reset")
                            continue
                        
                        for source in deduction_sources:
                            field = source.get('field')
                            remaining = source.get('remaining', 0)
                            
                            if remaining > 0 and field:
                                try:
                                    self._return_inventory_stock(item_id, remaining, field)
                                    session_items_returned += remaining
                                    logger.info(f"  Reset return: {remaining} of {sku} to {field}")
                                except Exception as e:
                                    error_msg = f"Error returning {sku} to {field}: {e}"
                                    logger.error(error_msg)
                                    return_errors.append(error_msg)
                
                if session_items_returned > 0:
                    sessions_with_returns += 1
                    total_items_returned += session_items_returned
                    logger.info(f"  Session {session.session_id} ({session.order_number}): returned {session_items_returned} items")
            
            # Now archive all sessions in the database (including completed/cancelled)
            result = self.repo.reset_daily_sessions()
            
            # Add inventory return info to result
            result['items_returned_to_inventory'] = int(total_items_returned)
            result['sessions_with_inventory_returns'] = sessions_with_returns
            
            if return_errors:
                result['return_errors'] = return_errors
            
            logger.info(f"✅ Daily archive completed:")
            logger.info(f"   - Archived {result.get('sessions_archived', 0)} total sessions")
            logger.info(f"   - By original status: {result.get('sessions_before', {})}")
            logger.info(f"   - Returned {total_items_returned} items to inventory from {sessions_with_returns} incomplete sessions")
            logger.info(f"   - Cleared {result.get('takeover_requests_cleared', 0)} takeover requests")
            
            return result
            
        except Exception as e:
            logger.error(f"❌ Error during daily reset: {e}", exc_info=True)
            return {
                'success': False,
                'error': str(e),
                'items_returned_to_inventory': 0
            }



