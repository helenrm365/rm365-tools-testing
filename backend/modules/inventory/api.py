# modules/inventory/api.py
"""
Inventory module root API - provides dashboard stats and common endpoints.
The main inventory functionality is in management/api.py and other submodules.
"""
from fastapi import APIRouter, Depends
from common.deps import get_current_user

router = APIRouter()


@router.get("/health")
def inventory_health():
    """Health check for inventory module"""
    return {
        "status": "healthy",
        "message": "Inventory module ready"
    }


@router.get("/low-stock-count")
def get_low_stock_count(user=Depends(get_current_user)):
    """
    Get count of low stock items for dashboard.
    """
    try:
        from .management.service import InventoryManagementService
        svc = InventoryManagementService()
        
        # Get items with low stock flag
        items = svc.list_items(limit=1000, low_stock_only=True)
        count = len(items) if items else 0
        
        return {"count": count}
    except Exception as e:
        # Log but don't fail - return 0 for dashboard
        import logging
        logging.getLogger(__name__).warning(f"Failed to get low stock count: {e}")
        return {"count": 0}
