"""
Collaboration API endpoints for inventory management
Provides REST endpoints for collaboration features
"""
import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from common.deps import get_current_user
from core.websocket import presence_manager, sio

logger = logging.getLogger(__name__)
router = APIRouter()


class CursorUpdate(BaseModel):
    """Cursor position update"""
    row_id: Optional[str] = None
    position: Optional[Dict[str, Any]] = None


class InventoryChangeNotification(BaseModel):
    """Inventory change notification"""
    sku: str
    field: str
    old_value: Any
    new_value: Any
    update_type: str = "edit"


@router.get("/health")
def collaboration_health():
    """Health check for collaboration module"""
    return {"status": "Collaboration module ready"}


@router.get("/presence")
async def get_presence(user=Depends(get_current_user)):
    """Get current users in inventory management room"""
    room_id = "inventory_management"
    users = presence_manager.get_room_users(room_id)
    
    return {
        "room_id": room_id,
        "users": users,
        "total_users": len(users)
    }


@router.post("/broadcast-change")
async def broadcast_inventory_change(
    change: InventoryChangeNotification,
    user=Depends(get_current_user)
):
    """
    Broadcast inventory change to all connected users
    This is called from the API after a successful update
    """
    room_id = "inventory_management"
    
    # Broadcast via WebSocket
    await sio.emit('inventory_changed', {
        'user_id': user.get('user_id'),
        'username': user.get('username', 'Unknown'),
        'update_type': change.update_type,
        'sku': change.sku,
        'field': change.field,
        'old_value': change.old_value,
        'new_value': change.new_value
    }, room=room_id)
    
    return {"status": "broadcasted", "room": room_id}
