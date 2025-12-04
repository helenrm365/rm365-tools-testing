"""
FastAPI routes for Magento invoice pick/pack system
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status

from common.deps import get_current_user
from core.websocket import sio
from .service import MagentoService
from .schemas import (
    InvoiceDetailSchema,
    ScanRequestSchema,
    ScanResultSchema,
    StartSessionSchema,
    SessionStatusSchema,
    CompleteSessionSchema,
    SessionOwnershipSchema,
    TakeoverRequestSchema,
    TakeoverResponseSchema,
    DashboardSessionSchema,
    ForceAssignSchema,
    ForceCancelSchema,
    OrderTrackingBoardSchema,
    MarkReadyToCheckSchema,
    ApproveOrderSchema,
    PendingMagentoOrderSchema
)


router = APIRouter()


def _service() -> MagentoService:
    """Dependency to get service instance"""
    return MagentoService()


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


@router.get("/invoice/lookup/{order_number}")
def lookup_invoice(
    order_number: str,
    current_user: dict = Depends(get_current_user),
    service: MagentoService = Depends(_service)
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
    service: MagentoService = Depends(_service)
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
    service: MagentoService = Depends(_service)
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
            room='order-tracking'
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
    service: MagentoService = Depends(_service)
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


@router.get("/session/status/{session_id}")
def get_session_status(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    service: MagentoService = Depends(_service)
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
    service: MagentoService = Depends(_service)
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
            room='order-tracking'
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
    service: MagentoService = Depends(_service)
):
    """
    Cancel a scanning session
    """
    try:
        user_id = current_user.get('user_id') or current_user.get('username')
        success = service.cancel_session(session_id, user_id=user_id)
        
        if not success:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Session not found: {session_id}"
            )
        
        return {
            "success": success,
            "message": "Session cancelled",
            "session_id": session_id
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
    service: MagentoService = Depends(_service)
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
    service: MagentoService = Depends(_service)
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
    service: MagentoService = Depends(_service)
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
    service: MagentoService = Depends(_service)
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
    service: MagentoService = Depends(_service)
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


@router.post("/sessions/{session_id}/request-takeover")
def request_session_takeover(
    session_id: str,
    current_user: dict = Depends(get_current_user),
    service: MagentoService = Depends(_service)
):
    """
    Request to take over an in-progress session from another user
    """
    try:
        user_id = current_user.get('user_id') or current_user.get('username')
        request = service.request_takeover(session_id, user_id)
        
        return {
            "success": True,
            "message": f"Takeover request sent to {request.current_owner}",
            "request_id": request.request_id,
            "session_id": session_id
        }
    
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to request takeover: {str(e)}"
        )


@router.post("/takeover-requests/{request_id}/respond")
def respond_to_takeover_request(
    request_id: str,
    response: TakeoverResponseSchema,
    current_user: dict = Depends(get_current_user),
    service: MagentoService = Depends(_service)
):
    """
    Accept or decline a takeover request
    """
    try:
        user_id = current_user.get('user_id') or current_user.get('username')
        updated_request = service.respond_to_takeover(request_id, response.accept, user_id)
        
        return {
            "success": True,
            "message": f"Takeover request {'accepted' if response.accept else 'declined'}",
            "request_id": request_id,
            "session_id": updated_request.session_id,
            "transferred": response.accept
        }
    
    except HTTPException:
        raise
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e)
        )
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to respond to takeover request: {str(e)}"
        )


@router.get("/takeover-requests/pending")
def get_pending_takeover_requests(
    current_user: dict = Depends(get_current_user),
    service: MagentoService = Depends(_service)
):
    """
    Get all pending takeover requests for the current user's sessions
    """
    try:
        user_id = current_user.get('user_id') or current_user.get('username')
        requests = service.get_pending_requests(user_id)
        
        return {
            "requests": [
                {
                    "request_id": req.request_id,
                    "session_id": req.session_id,
                    "requested_by": req.requested_by,
                    "requested_at": req.requested_at.isoformat(),
                }
                for req in requests
            ]
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get pending requests: {str(e)}"
        )


# Dashboard endpoints (admin/supervisor features)

@router.get("/dashboard/sessions")
def get_dashboard_sessions(
    include_completed: bool = False,
    current_user: dict = Depends(get_current_user),
    service: MagentoService = Depends(_service)
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
    service: MagentoService = Depends(_service)
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
    service: MagentoService = Depends(_service)
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
    service: MagentoService = Depends(_service)
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
    service: MagentoService = Depends(_service)
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
    service: MagentoService = Depends(_service)
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
            room='order-tracking'
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


@router.get("/tracking/pending-orders")
def get_pending_magento_orders(
    current_user: dict = Depends(get_current_user),
    service: MagentoService = Depends(_service)
):
    """
    Get all pending Magento orders that are in 'processing' status
    These orders need approval before they can be picked
    """
    try:
        orders = service.get_pending_magento_orders()
        return {
            "orders": orders,
            "count": len(orders)
        }
    
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to get pending orders: {str(e)}"
        )


@router.get("/tracking/pending-orders/debug")
def debug_pending_orders(
    current_user: dict = Depends(get_current_user),
    service: MagentoService = Depends(_service)
):
    """
    Debug endpoint to see what's happening with pending orders
    Shows all processing orders and which ones are filtered out
    """
    try:
        # Get raw processing orders from Magento
        processing_orders = service.client.get_processing_orders()
        
        # Get existing sessions
        existing_sessions = service.repo.get_sessions_by_status(['approved', 'in_progress', 'ready_to_check', 'completed'])
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
    service: MagentoService = Depends(_service)
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
            room='order-tracking'
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


