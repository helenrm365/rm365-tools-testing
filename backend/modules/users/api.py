from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel
from typing import List
from common.deps import get_current_user
from .schemas import UserCreate, UserUpdate, UserOut, UserPreferences
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
        svc.create(body.username, body.password, body.role, body.tab_preset, body.allowed_tabs, body.location_id, body.group_id, body.email)
        return {"detail": "created"}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to create user: {str(e)}")

@router.patch("")
def update_user(body: UserUpdate, user=Depends(get_current_user)):
    try:
        svc.update(
            body.username,
            new_username=body.new_username,
            new_password=body.new_password,
            role=body.role,
            clear_role=(body.role is None and 'role' in body.model_fields_set),
            tab_preset=body.tab_preset,
            clear_tab_preset=(body.tab_preset is None and 'tab_preset' in body.model_fields_set),
            allowed_tabs=body.allowed_tabs,
            location_id=body.location_id,
            clear_location=(body.location_id is None and 'location_id' in body.model_fields_set),
            group_id=body.group_id,
            clear_group=(body.group_id is None and 'group_id' in body.model_fields_set),
            email=body.email,
            clear_email=(body.email is None and 'email' in body.model_fields_set),
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

# ===== User Preferences Endpoints =====
@router.get("/preferences")
def get_preferences(user=Depends(get_current_user)):
    """Get current user's appearance preferences"""
    try:
        prefs = svc.get_preferences(user["username"])
        return prefs
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch preferences: {str(e)}")

@router.put("/preferences")
def save_preferences(body: UserPreferences, user=Depends(get_current_user)):
    """Save current user's appearance preferences"""
    try:
        prefs = svc.save_preferences(user["username"], body.dict())
        return {"detail": "saved", "preferences": prefs}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to save preferences: {str(e)}")


# ===== Email Verification Endpoints =====

class EmailVerifSendIn(BaseModel):
    username: str
    email: str

class EmailVerifResendIn(BaseModel):
    username: str

class EmailVerifConfirmIn(BaseModel):
    username: str
    code: str


@router.post("/email-verification/send", status_code=202)
async def send_email_verification(body: EmailVerifSendIn, user=Depends(get_current_user)):
    """Send a 6-digit verification code to the given email address for the user."""
    from core.email import create_email_verification_code, send_email_verification_email
    try:
        raw_code = create_email_verification_code(body.username, body.email)
        await send_email_verification_email(body.email, body.username, raw_code)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to send verification email: {str(e)}")
    return {"detail": "Verification code sent"}


@router.post("/email-verification/resend", status_code=202)
async def resend_email_verification(body: EmailVerifResendIn, user=Depends(get_current_user)):
    """Resend the verification code. Rate-limited to 3 resends per 15 minutes per user."""
    from core.email import resend_email_verification_code, send_email_verification_email
    try:
        raw_code, pending_email = resend_email_verification_code(body.username)
    except ValueError as e:
        raise HTTPException(status_code=429, detail=str(e))
    try:
        await send_email_verification_email(pending_email, body.username, raw_code)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to resend verification email: {str(e)}")
    return {"detail": "Verification code resent"}


@router.post("/email-verification/confirm")
def confirm_email_verification(body: EmailVerifConfirmIn, user=Depends(get_current_user)):
    """Verify the code. On success, saves the email to the user record."""
    from core.email import verify_email_code
    try:
        email = verify_email_code(body.username, body.code)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"detail": "Email verified and saved", "email": email}