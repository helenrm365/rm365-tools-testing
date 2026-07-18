# backend/core/auth.py
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from core.security import verify_password, create_access_token, get_current_user, parse_allowed_tabs, get_all_tabs, register_device, revoke_device
from core.db import get_psycopg_connection, return_attendance_connection
from core.config import settings

router = APIRouter()

class LoginIn(BaseModel):
    username: str
    password: str
    device_id: str | None = None  # Optional: handheld scanner identifier for tracking/revocation

@router.post("/login")
def login(body: LoginIn):
    # Check for built-in superadmin first (bypasses database)
    if body.username == settings.SUPERADMIN_USERNAME:
        if body.password == settings.SUPERADMIN_PASSWORD:
            token = create_access_token(sub=body.username, device_id=body.device_id)
            if body.device_id:
                register_device(body.username, body.device_id)
            # Grant full access to all tabs (dynamically retrieved)
            all_tabs = get_all_tabs()
            return {
                "access_token": token,
                "role": "superadmin",
                "tab_preset": "admin",
                "allowed_tabs": all_tabs,
            }
        else:
            raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Regular database authentication
    try:
        conn = get_psycopg_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT password_hash,
                       COALESCE(NULLIF(role, ''), 'Staff') as role,
                       NULLIF(tab_preset, '') as tab_preset,
                       allowed_tabs
                FROM login_users WHERE username=%s
            """, (body.username,))
            row = cur.fetchone()
        finally:
            return_attendance_connection(conn)

        if not row or not verify_password(body.password, row[0]):
            raise HTTPException(status_code=401, detail="Invalid credentials")

        token = create_access_token(sub=body.username, device_id=body.device_id)
        if body.device_id:
            register_device(body.username, body.device_id)
        role = row[1] if row[1] else 'Staff'
        tab_preset = row[2]
        allowed_tabs = parse_allowed_tabs(row[3])
        return {
            "access_token": token,
            "role": role,
            "tab_preset": tab_preset,
            "allowed_tabs": allowed_tabs,
        }
    except HTTPException:
        # Re-raise HTTP exceptions (like 401 Invalid credentials)
        raise
    except ValueError as e:
        # Database not configured
        raise HTTPException(status_code=503, detail="Database not available - only superadmin login is supported")
    except Exception as e:
        # Database connection failed
        raise HTTPException(status_code=503, detail="Database connection failed - only superadmin login is supported")

@router.get("/me")
def me(user=Depends(get_current_user)):
    return {
        "username": user["username"],
        "role": user.get("role", "Staff"),
        "tab_preset": user.get("tab_preset"),
        "allowed_tabs": user["allowed_tabs"],
        "location_id": user.get("location_id"),
    }


@router.post("/devices/{device_id}/revoke")
def revoke_scanner(device_id: str, user=Depends(get_current_user)):
    """
    Lock out a lost/stolen handheld scanner.

    Only admins, managers and superadmins may call this. Sets the `revoked` flag
    on the device in `mobile_devices`; any token carrying that device id is then
    rejected by `get_current_user` on its next request.
    """
    # Authorization: restrict to elevated roles (mirrors magentodata pattern).
    user_role = (user.get("role") or "").lower()
    if user_role not in ["admin", "manager", "superadmin"]:
        raise HTTPException(status_code=403, detail="Only admins and managers can revoke devices")

    device_id = (device_id or "").strip()
    if not device_id:
        raise HTTPException(status_code=400, detail="device_id is required")

    try:
        found = revoke_device(device_id)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to revoke device: {e}")

    if not found:
        raise HTTPException(status_code=404, detail=f"Device not found: {device_id}")

    return {
        "status": "success",
        "device_id": device_id,
        "revoked": True,
        "message": f"Device '{device_id}' has been revoked and can no longer access the API.",
        "revoked_by": user.get("username", "unknown"),
    }
