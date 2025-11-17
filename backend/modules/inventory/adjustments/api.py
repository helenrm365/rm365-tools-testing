from __future__ import annotations
from typing import List
from datetime import date, datetime

from fastapi import APIRouter, Depends, HTTPException

from common.deps import get_current_user
from common.dto import InventorySyncResult
from core.websocket import sio
from .schemas import AdjustmentLogIn, AdjustmentOut, AdjustmentHistoryResponse
from .service import AdjustmentsService

router = APIRouter()

def _svc() -> AdjustmentsService:
    return AdjustmentsService()

@router.get("/health")
def inventory_adjustments_health():
    """Health check for inventory adjustments module (no auth required)"""
    try:
        return {
            "status": "healthy",
            "message": "Inventory adjustments module ready",
            "auth_required": "Most endpoints require authentication",
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {
            "status": "error",
            "message": f"Health check failed: {str(e)}",
            "timestamp": datetime.now().isoformat()
        }

@router.post("/debug-metadata-update")
def debug_metadata_update(
    item_id: str = "772578000000491583",
    field: str = "shelf_lt1_qty", 
    delta: int = 1
):
    """Debug endpoint to test immediate metadata updates (no auth for debugging)"""
    try:
        service = _svc()
        
        from modules.inventory.management.repo import InventoryManagementRepo
        mgmt_repo = InventoryManagementRepo()
        
        metadata_before = mgmt_repo.load_inventory_metadata()
        current_item = next((item for item in metadata_before if item['item_id'] == item_id), None)
        current_value = current_item.get(field, 0) if current_item else 0
        
        # Test the immediate update
        service.repo.update_metadata_quantity(item_id, field, delta)
        
        metadata_after = mgmt_repo.load_inventory_metadata()
        updated_item = next((item for item in metadata_after if item['item_id'] == item_id), None)
        new_value = updated_item.get(field, 0) if updated_item else 0
        
        return {
            "status": "success",
            "test": "immediate_metadata_update",
            "item_id": item_id,
            "field": field,
            "delta": delta,
            "before": current_value,
            "after": new_value,
            "change_applied": new_value - current_value,
            "expected_change": delta,
            "working": (new_value - current_value) == delta,
            "timestamp": datetime.now().isoformat()
        }
        
    except Exception as e:
        return {
            "status": "error",
            "test": "immediate_metadata_update",
            "error": str(e),
            "error_type": type(e).__name__,
            "timestamp": datetime.now().isoformat()
        }

@router.get("/status-public")
def get_public_status():
    """Public status check (no auth required)"""
    try:
        return {
            "status": "online",
            "message": "Inventory adjustments API is running",
            "endpoints": {
                "health": "GET /health (public)",
                "pending-public": "GET /pending-public (public test)",
                "connection": "GET /connection-status (auth required)",
                "log": "POST /log (auth required)", 
                "sync": "POST /sync (auth required)",
                "pending": "GET /pending (auth required)"
            },
            "timestamp": datetime.now().isoformat()
        }
    except Exception as e:
        return {
            "status": "error", 
            "message": str(e),
            "timestamp": datetime.now().isoformat()
        }

@router.get("/pending-public")
def get_pending_adjustments_public():
    """
    Public test endpoint - returns mock data to verify routing works.
    REMOVE THIS AFTER DEBUGGING.
    """
    return {
        "adjustments": [],
        "count": 0,
        "message": "Test endpoint - routing is working! The /pending endpoint requires authentication.",
        "status": "success",
        "timestamp": datetime.now().isoformat()
    }

@router.post("/log", response_model=AdjustmentOut)
async def log_inventory_adjustment(body: AdjustmentLogIn, user=Depends(get_current_user)):
    """
    Log an inventory adjustment and update inventory_metadata immediately.
    
    The adjustment is applied to local inventory tracking in real-time.
    Smart shelf logic automatically allocates stock across shelf_lt1, shelf_gt1, and top_floor.
    """
    try:
        result = _svc().log_adjustment(
            barcode=body.barcode,
            quantity=body.quantity,
            reason=body.reason,
            field=body.field
        )
        
        # Broadcast the adjustment to all connected users via WebSocket
        try:
            metadata_updates = result.get('metadata_updated', [])
            for update in metadata_updates:
                await sio.emit('inventory_changed', {
                    'user_id': user.get('user_id'),
                    'username': user.get('username', 'System'),
                    'update_type': 'adjustment',
                    'sku': update['item_id'],
                    'field': update['field'],
                    'old_value': None,  # Not tracked for adjustments
                    'new_value': update['delta'],
                    'reason': body.reason,
                    'timestamp': datetime.utcnow().isoformat()
                }, room='inventory_management')
        except Exception as ws_error:
            # Don't fail the adjustment if WebSocket broadcast fails
            print(f"[Adjustments] WebSocket broadcast failed: {ws_error}")
        
        return AdjustmentOut(**result["adjustment"])
    
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/pending")
def get_pending_adjustments(user=Depends(get_current_user)):
    """
    Get all recent adjustments.
    """
    try:
        service = _svc()
        pending = service.get_pending_adjustments()
        
        return {
            "adjustments": pending,
            "count": len(pending),
            "message": f"Found {len(pending)} adjustments"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/status")
def get_adjustments_status(user=Depends(get_current_user)):
    """Get comprehensive status including pending and recent adjustments"""
    try:
        service = _svc()
        pending = service.get_pending_adjustments()
        
        return {
            "pending_count": len(pending),
            "message": f"{len(pending)} adjustments logged",
            "recent_items": pending[:10] if pending else []
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/history/{item_id}", response_model=AdjustmentHistoryResponse)
def get_adjustment_history(
    item_id: str, 
    limit: int = 50,
    user=Depends(get_current_user)
):
    """Get adjustment history for a specific item"""
    try:
        history = _svc().get_adjustment_history(item_id, limit)
        return AdjustmentHistoryResponse(**history)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/summary")
def get_adjustment_summary(
    start_date: date = None,
    end_date: date = None,
    user=Depends(get_current_user)
):
    """Get summary of adjustments within date range"""
    try:
        return _svc().get_adjustment_summary(start_date, end_date)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/cleanup-corrupted")
def cleanup_corrupted_adjustments(user=Depends(get_current_user)):
    """Clean up adjustments with corrupted barcode data (tabs, multiple IDs, etc.)"""
    try:
        result = _svc().clean_corrupted_adjustments()
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

