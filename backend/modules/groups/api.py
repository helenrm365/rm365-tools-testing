from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List
from common.deps import get_current_user
from .schemas import GroupCreate, GroupUpdate, GroupOut
from .service import GroupsService

router = APIRouter()
svc = GroupsService()


@router.get("", response_model=List[GroupOut])
def list_groups(user=Depends(get_current_user)):
    """Get all groups"""
    try:
        return svc.list_all()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch groups: {str(e)}")


@router.post("", status_code=201)
def create_group(body: GroupCreate, user=Depends(get_current_user)):
    """Create a new group"""
    try:
        group_id = svc.create(body.group_name)
        return {"detail": "created", "id": group_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create group: {str(e)}")


@router.patch("")
def update_group(body: GroupUpdate, user=Depends(get_current_user)):
    """Update a group's name"""
    try:
        svc.update(body.id, body.new_name)
        return {"detail": "updated"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update group: {str(e)}")


@router.delete("")
def delete_group(id: int = Query(...), user=Depends(get_current_user)):
    """Delete a group"""
    try:
        svc.delete(id)
        return {"detail": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete group: {str(e)}")
