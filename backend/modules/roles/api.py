from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List
from common.deps import get_current_user
from .schemas import RoleCreate, RoleUpdate, RoleOut
from .service import RolesService

router = APIRouter()
svc = RolesService()

@router.get("", response_model=List[RoleOut])
def list_roles(user=Depends(get_current_user)):
    """Get all available roles"""
    try:
        return svc.list_all()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch roles: {str(e)}")

@router.get("/{role_name}", response_model=RoleOut)
def get_role(role_name: str, user=Depends(get_current_user)):
    """Get a specific role by name"""
    try:
        role = svc.get_by_name(role_name)
        if not role:
            raise HTTPException(status_code=404, detail="Role not found")
        return role
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch role: {str(e)}")

@router.post("", status_code=201)
def create_role(body: RoleCreate, user=Depends(get_current_user)):
    """Create a new role"""
    try:
        role_id = svc.create(body.role_name, body.allowed_tabs)
        return {"detail": "created", "id": role_id}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create role: {str(e)}")

@router.patch("")
def update_role(body: RoleUpdate, user=Depends(get_current_user)):
    """Update an existing role"""
    try:
        svc.update(
            body.role_name,
            new_role_name=body.new_role_name,
            allowed_tabs=body.allowed_tabs
        )
        return {"detail": "updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update role: {str(e)}")

@router.delete("")
def delete_role(role_name: str = Query(...), user=Depends(get_current_user)):
    """Delete a role"""
    try:
        svc.delete(role_name)
        return {"detail": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete role: {str(e)}")
