# modules/orders/api.py
"""
Orders module root API - provides dashboard stats and common endpoints.
The main order fulfillment functionality is in order_fulfillment/api.py
"""
from fastapi import APIRouter, Depends
from common.deps import get_current_user

router = APIRouter()


@router.get("/health")
def orders_health():
    """Health check for orders module"""
    return {
        "status": "healthy",
        "message": "Orders module ready"
    }


@router.get("/pending-count")
def get_pending_orders_count(user=Depends(get_current_user)):
    """
    Get count of pending orders for dashboard.
    Returns the number of active fulfillment sessions.
    """
    try:
        from .order_fulfillment.db_repo import MagentoDbRepo as OrderFulfillmentRepo
        repo = OrderFulfillmentRepo()
        
        # Count active sessions (sessions that are in progress)
        active_sessions = repo.get_all_sessions()
        pending_count = len([s for s in active_sessions if s.status in ('active', 'in_progress', 'pending')])
        
        return {"count": pending_count}
    except Exception as e:
        # Log but don't fail - return 0 for dashboard
        import logging
        logging.getLogger(__name__).warning(f"Failed to get pending orders count: {e}")
        return {"count": 0}
