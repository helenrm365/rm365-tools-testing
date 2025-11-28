from fastapi import APIRouter, Depends, HTTPException, Query
from typing import List
from common.deps import get_current_user
from .schemas import UserCreate, UserUpdate, UserOut
from .service import UsersService

router = APIRouter()
svc = UsersService()

@router.get("", response_model=List[str])
def list_users(user=Depends(get_current_user)):
    return svc.list_usernames()

@router.get("/detailed", response_model=List[UserOut])
def list_users_detailed(user=Depends(get_current_user)):
    try:
        users = svc.list_all()
        return [UserOut(**u) for u in users]
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch users: {str(e)}")

@router.post("", status_code=201)
def create_user(body: UserCreate, user=Depends(get_current_user)):
    try:
        svc.create(body.username, body.password, body.role, body.allowed_tabs)
        return {"detail": "created"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.patch("")
def update_user(body: UserUpdate, user=Depends(get_current_user)):
    try:
        svc.update(
            body.username,
            new_username=body.new_username,
            new_password=body.new_password,
            role=body.role,
            allowed_tabs=body.allowed_tabs,
        )
        return {"detail": "updated"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to update user: {str(e)}")

@router.delete("")
def delete_user(username: str = Query(...), user=Depends(get_current_user)):
    try:
        svc.delete(username)
        return {"detail": "deleted"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to delete user: {str(e)}")
