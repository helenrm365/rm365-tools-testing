"""
FastAPI routes for Magento invoice pick/pack system
"""
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status

from common.deps import get_current_user
from .service import MagentoService
from .schemas import (
    InvoiceDetailSchema,
    ScanRequestSchema,
    ScanResultSchema,
    StartSessionSchema,
    SessionStatusSchema,
    CompleteSessionSchema
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


@router.get("/invoice/lookup")
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


@router.post("/session/start")
def start_session(
    request: StartSessionSchema,
    current_user: dict = Depends(get_current_user),
    service: MagentoService = Depends(_service)
) -> SessionStatusSchema:
    """
    Start a new pick/pack or return session for an order
    Creates a scanning session and returns initial status
    """
    try:
        user_id = current_user.get('user_id') or current_user.get('username')
        session = service.start_session(request, user_id=user_id)
        return session
    
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(e)
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
def complete_session(
    request: CompleteSessionSchema,
    current_user: dict = Depends(get_current_user),
    service: MagentoService = Depends(_service)
):
    """
    Complete a scanning session
    Validates all items are scanned unless force_complete is True
    """
    try:
        success = service.complete_session(request)
        
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
        success = service.cancel_session(session_id)
        
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
