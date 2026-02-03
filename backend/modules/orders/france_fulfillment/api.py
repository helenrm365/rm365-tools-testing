"""
FastAPI routes for France Magento invoice pick/pack system
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status

from common.deps import get_current_user
from core.websocket import sio
from .service import FranceOrderFulfillmentService
from modules.orders.order_fulfillment.schemas import (
    InvoiceDetailSchema,
    ScanRequestSchema,
    ScanResultSchema,
    StartSessionSchema,
    SessionStatusSchema,
    CompleteSessionSchema,
    SessionOwnershipSchema,
    DashboardSessionSchema,
    ForceAssignSchema,
    ForceCancelSchema,
    OrderTrackingBoardSchema,
    MarkReadyToCheckSchema,
    ApproveOrderSchema,
    PendingMagentoOrderSchema
)


router = APIRouter(tags=["France Orders"])


def _service() -> FranceOrderFulfillmentService:
    """Dependency to get service instance"""
    return FranceOrderFulfillmentService()


@router.get("/health")
def magento_health():
    """Health check for Magento integration (no auth required)"""
    try:
        return {
            "status": "healthy",
            "message": "Magento integration module ready",
            "timestamp": "2024-01-01T00:00:00"
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Health check failed: {str(e)}"
        }


@router.get("/status")
def check_tables_status(user=Depends(get_current_user)):
    """
    Check which order fulfillment tables exist in the database.
    Used by frontend to determine if initialization is needed.
    """
    service = _service()
    return service.check_tables_status()


@router.get("/init")
def initialize_tables(user=Depends(get_current_user)):
    """
    Initialize order fulfillment tables if they don't exist.
    Creates order_fulfillment_sessions and order_fulfillment_takeover_requests tables.
    """
    try:
        from .db_repo import init_france_fulfillment_tables
        init_france_fulfillment_tables()
        return {
            "status": "success",
            "message": "Order fulfillment tables initialized successfully"
        }
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to initialize tables: {e}"
        )


@router.get("/invoice/lookup/{order_number}")
def lookup_invoice(
    order_number: str,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
) -> InvoiceDetailSchema:
    """
    Look up an invoice by order number or invoice number
    Returns full invoice details including all line items
    """
    try:
        invoice = service.lookup_invoice(order_number)
        
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No invoice found for order number: {order_number}"
            )
        
        return invoice
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to lookup invoice: {str(e)}"
        )


@router.get("/session/check/{order_number}")
def check_order_status(
    order_number: str,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Check if an order has any existing sessions and their status
    Use this before attempting to start a session to show appropriate prompts
    
    Returns:
    - status: "available", "completed", "in_progress", "draft", "cancelled"
    - message: User-friendly message
    - session_id: ID of existing session (if any)
    - user: User who owns/created the session (if applicable)
    """
    try:
        # Lookup the invoice
        invoice = service.lookup_invoice(order_number)
        
        if not invoice:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"No invoice found for order number: {order_number}"
            )
        
        # Check for existing session
        existing_session = service._get_any_session_for_invoice(invoice.invoice_number)
        
        if not existing_session:
            return {
                "status": "available",
                "message": f"Order #{invoice.order_number} is available to start",
                "order_number": invoice.order_number,
                "invoice_id": invoice.invoice_number
            }
        
        # Build response based on session status
        response = {
            "status": existing_session.status,
            "session_id": existing_session.session_id,
            "session_type": existing_session.session_type,
            "order_number": invoice.order_number,
            "invoice_id": invoice.invoice_number
        }
        
        if existing_session.status == "completed":
            user = existing_session.user_id or existing_session.created_by or "Unknown"
            response["message"] = f"Order #{invoice.order_number} is already completed by {user}"
            response["user"] = user
            response["can_start"] = False
            
        elif existing_session.status == "in_progress":
            user = existing_session.user_id or "Unknown"
            response["message"] = f"Order #{invoice.order_number} is currently in progress by {user}"
            response["user"] = user
            response["can_start"] = False
            
        elif existing_session.status == "draft":
            user = existing_session.created_by or existing_session.last_modified_by or "Unknown"
            response["message"] = f"Order #{invoice.order_number} has a draft session started by {user}"
            response["user"] = user
            response["can_start"] = False
            response["can_claim"] = True
            
        elif existing_session.status == "cancelled":
            user = existing_session.last_modified_by or existing_session.created_by or "Unknown"
            response["message"] = f"Order #{invoice.order_number} was cancelled by {user}. You can start a new session."
            response["user"] = user
            response["can_start"] = True
        
        return response
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to check order status: {str(e)}"
        )


@router.post("/session/start")
async def start_session(
    request: StartSessionSchema,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
) -> SessionStatusSchema:
    """
    Start a new pick/pack or return session for an order
    Creates a scanning session and returns initial status
    
    Returns HTTP 409 (Conflict) for scenarios requiring user confirmation:
    - Order is completed (blocked)
    - Order in progress by another user (blocked) 
    - Draft session exists (requires claim or cancel first)
    - Order was cancelled (warning, can proceed with new session)
    """
    try:
        user_id = current_user.get('user_id') or current_user.get('username')
        session = service.start_session(request, user_id=user_id)
        
        # Emit WebSocket event for real-time updates
        await sio.emit(
            'order_status_changed',
            {
                'session_id': session.session_id,
                'order_number': session.order_number,
                'status': 'in_progress',
                'user_id': user_id
            },
            room='france_orders'
        )
        
        return session
    
    except ValueError as e:
        # These are expected business logic errors that need special handling
        error_msg = str(e)
        
        # Determine the appropriate HTTP status code
        if "already completed" in error_msg:
            status_code = status.HTTP_409_CONFLICT
        elif "currently in progress" in error_msg:
            status_code = status.HTTP_409_CONFLICT
        elif "has a draft session" in error_msg:
            status_code = status.HTTP_409_CONFLICT
        elif "was cancelled" in error_msg:
            status_code = status.HTTP_409_CONFLICT
        else:
            status_code = status.HTTP_404_NOT_FOUND
        
        raise HTTPException(
            status_code=status_code,
            detail=error_msg
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to start session: {str(e)}"
        )


@router.post("/session/scan")
def scan_product(
    request: ScanRequestSchema,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
) -> ScanResultSchema:
    """
    Scan a product during a pick/pack session
    Validates the SKU against the invoice and tracks quantities
    """
    try:
        result = service.scan_product(request)
        return result
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Scan failed: {str(e)}"
        )


@router.get("/session/{session_id}/deduction-sources/{sku}")
def get_deduction_sources(
    session_id: str,
    sku: str,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Get deduction sources for a specific SKU in a session.
    Returns where items were taken from (shelf_lt1_qty, shelf_gt1_qty, top_floor_total)
    with remaining counts for returns.
    """
    try:
        sources = service.repo.get_deduction_sources(session_id, sku)
        
        field_names = {
            'shelf_lt1_qty': 'Shelf <1 Year',
            'shelf_gt1_qty': 'Shelf >1 Year', 
            'top_floor_total': 'Top Floor'
        }
        
        return {
            "sku": sku,
            "session_id": session_id,
            "deduction_sources": [
                {
                    "field": s['field'],
                    "display_name": field_names.get(s['field'], s['field']),
                    "quantity": s['quantity'],
                    "remaining": s.get('remaining', s['quantity'])
                }
                for s in sources
            ]
        }
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get deduction sources: {str(e)}"
        )


@router.get("/session/status/{session_id}")
def get_session_status(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
) -> SessionStatusSchema:
    """
    Get current status of a scanning session
    Returns all items with their scan progress
    """
    try:
        status_data = service.get_session_status(session_id)
        
        if not status_data:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}"
            )
        
        return status_data
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get session status: {str(e)}"
        )


@router.post("/session/complete")
async def complete_session(
    request: CompleteSessionSchema,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Complete a scanning session
    Validates all items are scanned unless force_complete is True
    """
    try:
        user_id = current_user.get('user_id') or current_user.get('username')
        success = service.complete_session(request, user_id=user_id)
        
        # Emit WebSocket event for real-time updates
        await sio.emit(
            'order_status_changed',
            {
                'session_id': request.session_id,
                'status': 'completed',
                'completed_by': user_id
            },
            room='france_orders'
        )
        
        return {
            "success": success,
            "message": "Session completed successfully",
            "session_id": request.session_id
        }
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to complete session: {str(e)}"
        )


@router.delete("/session/{session_id}")
def cancel_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Cancel a scanning session and return any scanned items to inventory.
    
    During picking phase: Returns all scanned items to their original locations
    using deduction sources to know where each item came from.
    
    During checking phase: Simply resets the session (no inventory changes).
    """
    try:
        user_id = current_user.get('user_id') or current_user.get('username')
        result = service.cancel_session(session_id, user_id=user_id)
        
        if not result.get('success'):
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=result.get('message', f"Session not found: {session_id}")
            )
        
        return {
            "success": True,
            "message": result.get('message', "Session cancelled"),
            "session_id": session_id,
            "items_returned": result.get('items_returned', 0)
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to cancel session: {str(e)}"
        )


@router.get("/sessions/active")
def get_active_sessions(
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
) -> List[SessionStatusSchema]:
    """
    Get all active scanning sessions for the current user
    """
    try:
        user_id = current_user.get('user_id') or current_user.get('username')
        sessions = service.get_active_sessions(user_id=user_id)
        return sessions
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get active sessions: {str(e)}"
        )


@router.get("/sessions/drafts")
def get_draft_sessions(
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
) -> List[SessionStatusSchema]:
    """
    Get all draft sessions available to claim
    These are sessions that were saved as draft or abandoned by other users
    """
    try:
        sessions = service.get_draft_sessions()
        return sessions
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get draft sessions: {str(e)}"
        )


# Collaborative session management endpoints

@router.get("/sessions/{session_id}/ownership")
def check_session_ownership(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
) -> SessionOwnershipSchema:
    """
    Check session ownership and access permissions
    """
    try:
        user_id = current_user.get('user_id') or current_user.get('username')
        return service.check_session_access(session_id, user_id)
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to check session ownership: {str(e)}"
        )


@router.post("/sessions/{session_id}/claim")
def claim_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Claim a draft session and make it in_progress
    """
    try:
        user_id = current_user.get('user_id') or current_user.get('username')
        success = service.claim_session(session_id, user_id)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot claim this session. It may already be in progress or not in draft status."
            )
        
        return {
            "success": True,
            "message": "Session claimed successfully",
            "session_id": session_id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to claim session: {str(e)}"
        )


@router.post("/sessions/{session_id}/release")
def release_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Release a session back to draft status
    """
    try:
        user_id = current_user.get('user_id') or current_user.get('username')
        success = service.release_session(session_id, user_id=user_id)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Cannot release this session"
            )
        
        return {
            "success": True,
            "message": "Session released successfully",
            "session_id": session_id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to release session: {str(e)}"
        )


# Dashboard endpoints (admin/supervisor features)

@router.get("/dashboard/sessions")
def get_dashboard_sessions(
    include_completed: bool = False,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Get all sessions for dashboard monitoring
    Requires supervisor/admin permissions
    
    Query params:
    - include_completed: Include all completed/cancelled sessions (default: only last 24h)
    """
    try:
        sessions = service.get_all_sessions_for_dashboard(include_completed=include_completed)
        
        return {
            "sessions": [session.model_dump() for session in sessions],
            "total": len(sessions)
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get dashboard sessions: {str(e)}"
        )


@router.post("/dashboard/sessions/{session_id}/force-cancel")
def force_cancel_session(
    session_id: str,
    request: "ForceCancelSchema",
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Force cancel a session (admin action)
    Requires supervisor/admin permissions
    """
    try:
        admin_user_id = current_user.get('user_id') or current_user.get('username')
        success = service.force_cancel_session(session_id, admin_user_id, reason=request.reason)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}"
            )
        
        return {
            "success": True,
            "message": f"Session {session_id} cancelled by administrator",
            "cancelled_by": admin_user_id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to force cancel session: {str(e)}"
        )


@router.post("/dashboard/sessions/{session_id}/force-assign")
def force_assign_session(
    session_id: str,
    request: "ForceAssignSchema",
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Force assign/transfer a session to another user (admin action)
    Requires supervisor/admin permissions
    """
    try:
        admin_user_id = current_user.get('user_id') or current_user.get('username')
        success = service.force_assign_session(
            session_id, 
            request.target_user_id, 
            admin_user_id
        )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}"
            )
        
        return {
            "success": True,
            "message": f"Session assigned to {request.target_user_id}",
            "assigned_by": admin_user_id,
            "assigned_to": request.target_user_id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to force assign session: {str(e)}"
        )


@router.post("/dashboard/sessions/{session_id}/takeover")
def admin_takeover_session(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Admin takes over a session themselves (admin action)
    Requires supervisor/admin permissions
    """
    try:
        admin_user_id = current_user.get('user_id') or current_user.get('username')
        success = service.admin_takeover_session(session_id, admin_user_id)
        
        if success is None:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="You cannot take over your own session"
            )
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}"
            )
        # Include order and invoice to enable frontend redirect into the active session
        session_status = service.get_session_status(session_id)
        return {
            "success": True,
            "message": f"You have taken over session {session_id}",
            "session_id": session_id,
            "order_number": session_status.order_number if session_status else None,
            "invoice_number": session_status.invoice_number if session_status else None
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to take over session: {str(e)}"
        )


# Order Tracking Endpoints

@router.get("/tracking/board")
def get_order_tracking_board(
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Get the full order tracking board with all columns
    Returns orders organized by status: ready_to_pick, ready_to_check, completed
    """
    try:
        board = service.get_order_tracking_board()
        return board
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get order tracking board: {str(e)}"
        )


@router.post("/tracking/mark-ready-to-check")
async def mark_order_ready_to_check(
    request: dict,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Mark an order as ready to check instead of completing it
    Used during order fulfillment when items need verification
    """
    try:
        session_id = request.get('session_id')
        user_id = current_user.get('user_id') or current_user.get('username')
        
        if not session_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="session_id is required"
            )
        
        success = service.mark_ready_to_check(session_id, user_id)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}"
            )
        
        # Emit WebSocket event for real-time updates
        await sio.emit(
            'order_status_changed',
            {
                'session_id': session_id,
                'status': 'ready_to_check',
                'changed_by': user_id
            },
            room='france_orders'
        )
        
        return {
            "success": True,
            "message": "Order marked as ready to check",
            "session_id": session_id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to mark order as ready to check: {str(e)}"
        )


@router.post("/tracking/send-back-for-picking")
async def send_back_for_picking(
    request: dict,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Send an order back for picking from the checking phase.
    This creates a draft in the Ready to Pick column so the picker
    can continue where they left off.
    
    Request body:
    - session_id: The session ID (required)
    - items_counted: List of {sku, qty_counted} from the checker's count (optional)
    """
    try:
        session_id = request.get('session_id')
        items_counted = request.get('items_counted')  # List of {sku, qty_counted}
        user_id = current_user.get('user_id') or current_user.get('username')
        
        if not session_id:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="session_id is required"
            )
        
        success = service.send_back_for_picking(session_id, user_id, items_counted)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}"
            )
        
        # Emit WebSocket event for real-time updates
        await sio.emit(
            'order_status_changed',
            {
                'session_id': session_id,
                'status': 'draft',
                'changed_by': user_id
            },
            room='france_orders'
        )
        
        return {
            "success": True,
            "message": "Order sent back for picking",
            "session_id": session_id
        }
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to send back for picking: {str(e)}"
        )


@router.get("/tracking/pending-orders")
def get_pending_magento_orders(
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Get all pending Magento orders that are in 'processing' status
    These orders need approval before they can be picked.
    Also returns orders approved today for the approval dashboard.
    """
    try:
        from datetime import datetime, timezone
        from modules.orders.order_fulfillment.schemas import PendingMagentoOrderSchema
        import logging
        logger = logging.getLogger(__name__)
        
        # Get all processing orders from Magento (ONE query)
        processing_orders = service.client.get_processing_orders()
        logger.info(f"[Pending Orders API] Retrieved {len(processing_orders)} orders from Magento")
        
        # Build a lookup dict by order number
        order_lookup = {order.get('increment_id'): order for order in processing_orders}
        
        # Get all sessions (ONE query)
        # Include ALL active statuses to properly exclude them from pending approvals
        today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        all_sessions = service.repo.get_sessions_by_status(['draft', 'approved', 'in_progress', 'ready_to_check', 'completed'])
        
        # Build sets for filtering
        existing_order_numbers = {session.order_number for session in all_sessions}
        
        # Build approved today orders list
        approved_today_orders = []
        for session in all_sessions:
            session_date = session.started_at if hasattr(session, 'started_at') else None
            
            # Handle timezone-aware comparison
            if session_date:
                if session_date.tzinfo is None:
                    session_date = session_date.replace(tzinfo=timezone.utc)
                if session_date >= today_start:
                    order_details = order_lookup.get(session.order_number)
                    
                    customer_firstname = order_details.get('customer_firstname', '') if order_details else ''
                    customer_lastname = order_details.get('customer_lastname', '') if order_details else ''
                    customer_name = f"{customer_firstname} {customer_lastname}".strip() if customer_firstname or customer_lastname else None
                    
                    approved_today_orders.append({
                        "order_id": order_details.get('entity_id') if order_details else session.session_id,
                        "order_number": session.order_number,
                        "created_at": session.started_at.isoformat() if session.started_at else None,
                        "grand_total": float(order_details.get('grand_total', 0)) if order_details else 0,
                        "status": "approved",
                        "customer_name": customer_name,
                        "customer_email": order_details.get('customer_email') if order_details else None,
                        "total_qty_ordered": int(order_details.get('total_qty_ordered', 0)) if order_details else len(session.items_expected),
                        "shipping_method": order_details.get('shipping_description') if order_details else None,
                        "session_status": session.status,
                        "is_approved": True
                    })
        
        # Build pending orders list (orders without sessions)
        pending_orders = []
        for order in processing_orders:
            order_number = order.get('increment_id')
            
            # Skip if this order already has a session
            if order_number in existing_order_numbers:
                continue
            
            customer_firstname = order.get('customer_firstname', '')
            customer_lastname = order.get('customer_lastname', '')
            customer_name = f"{customer_firstname} {customer_lastname}".strip() if customer_firstname or customer_lastname else None
            
            # Get shipping method
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
            
            payment = order.get('payment', {})
            payment_method = payment.get('method') if isinstance(payment, dict) else None
            
            pending_orders.append(
                PendingMagentoOrderSchema(
                    order_id=order.get('entity_id'),
                    order_number=order_number,
                    created_at=order.get('created_at'),
                    grand_total=float(order.get('grand_total', 0)),
                    status=order.get('status'),
                    customer_name=customer_name,
                    customer_email=order.get('customer_email'),
                    total_qty_ordered=order.get('total_qty_ordered', 0),
                    payment_method=payment_method,
                    shipping_method=shipping_method,
                    items=order.get('items', [])
                )
            )
        
        logger.info(f"[Pending Orders API] Returning {len(pending_orders)} pending, {len(approved_today_orders)} approved today")
        
        return {
            "orders": pending_orders,
            "count": len(pending_orders),
            "approved_today": len(approved_today_orders),
            "approved_today_orders": approved_today_orders
        }
    
    except Exception as e:
        import traceback
        traceback.print_exc()
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get pending orders: {str(e)}"
        )


@router.get("/tracking/pending-orders/debug")
def debug_pending_orders(
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Debug endpoint to see what's happening with pending orders
    Shows all processing orders and which ones are filtered out
    """
    try:
        # Get raw processing orders from Magento
        processing_orders = service.client.get_processing_orders()
        
        # Get existing sessions - include ALL active statuses
        existing_sessions = service.repo.get_sessions_by_status(['draft', 'approved', 'in_progress', 'ready_to_check', 'completed'])
        existing_order_numbers = {session.order_number for session in existing_sessions}
        
        # Categorize orders
        pending_orders = []
        filtered_orders = []
        
        for order in processing_orders:
            order_number = order.get('increment_id')
            order_info = {
                'order_number': order_number,
                'order_id': order.get('entity_id'),
                'status': order.get('status'),
                'created_at': order.get('created_at'),
                'grand_total': order.get('grand_total')
            }
            
            if order_number in existing_order_numbers:
                filtered_orders.append(order_info)
            else:
                pending_orders.append(order_info)
        
        return {
            "summary": {
                "total_processing_orders": len(processing_orders),
                "pending_orders_count": len(pending_orders),
                "filtered_orders_count": len(filtered_orders)
            },
            "pending_orders": pending_orders,
            "filtered_orders": filtered_orders,
            "existing_session_order_numbers": list(existing_order_numbers)
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to debug pending orders: {str(e)}"
        )


@router.post("/tracking/approve-order")
async def approve_order_for_picking(
    request: dict,
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Approve a Magento order for picking.
    Creates a session in 'approved' status ready for a picker to claim.
    
    IMPORTANT: This does NOT modify the order in Magento. The order remains in
    'processing' status in Magento. We only track the approval locally.
    """
    try:
        order_number = request.get('order_number')
        user_id = current_user.get('user_id') or current_user.get('username')
        
        if not order_number:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="order_number is required"
            )
        
        session_id = service.approve_order_for_picking(order_number, user_id)
        
        # Emit WebSocket event for real-time updates
        await sio.emit(
            'order_status_changed',
            {
                'session_id': session_id,
                'order_number': order_number,
                'status': 'approved',
                'approved_by': user_id
            },
            room='france_orders'
        )
        
        return {
            "success": True,
            "message": f"Order {order_number} approved for picking",
            "session_id": session_id,
            "order_number": order_number
        }
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to approve order: {str(e)}"
        )


@router.post("/admin/reset-sessions")
def reset_order_sessions_manually(
    current_user: dict = Depends(get_current_user),
    service: FranceOrderFulfillmentService = Depends(_service)
):
    """
    Manually trigger the daily order session reset.
    
    This is normally run automatically at midnight, but can be triggered
    manually by admins for testing or maintenance purposes.
    
    WARNING: This will clear ALL session data (approved, in_progress, completed, etc.)
    and archive it. Orders still in 'processing' status on Magento will reappear
    in the pending orders list.
    
    Requires admin authentication.
    """
    try:
        # Optional: Add admin role check here
        # if not current_user.get('is_admin'):
        #     raise HTTPException(status_code=403, detail="Admin access required")
        
        result = service.repo.reset_daily_sessions()
        
        if result.get('success'):
            return {
                "success": True,
                "message": "Order sessions reset successfully",
                "details": result
            }
        else:
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Reset failed: {result.get('error', 'Unknown error')}"
            )
    
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to reset sessions: {str(e)}"
        )


