# backend/core/auth.py
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from core.security import verify_password, hash_password, create_access_token, get_current_user, parse_allowed_tabs, get_all_tabs
from core.db import get_psycopg_connection, return_attendance_connection
from core.config import settings
from core.email import create_password_reset_token, verify_and_consume_reset_token, send_password_reset_email

router = APIRouter()

class LoginIn(BaseModel):
    username: str
    password: str

@router.post("/login")
def login(body: LoginIn):
    # Check for built-in superadmin first (bypasses database)
    if body.username == settings.SUPERADMIN_USERNAME:
        if body.password == settings.SUPERADMIN_PASSWORD:
            token = create_access_token(sub=body.username)
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

        token = create_access_token(sub=body.username)
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


# ---------------------------------------------------------------------------
# Password reset (requires email column on login_users — run migration first)
# ---------------------------------------------------------------------------

class PasswordResetRequestIn(BaseModel):
    username: str


class PasswordResetConfirmIn(BaseModel):
    token: str
    new_password: str


@router.post("/request-password-reset", status_code=202)
async def request_password_reset(body: PasswordResetRequestIn):
    """
    Look up the user's email and send a Brevo reset email.
    Always returns 202 so callers cannot enumerate valid usernames.
    """
    try:
        conn = get_psycopg_connection()
        try:
            cur = conn.cursor()
            cur.execute("SELECT email FROM login_users WHERE username = %s", (body.username,))
            row = cur.fetchone()
        finally:
            return_attendance_connection(conn)

        if not row or not row[0]:
            # Return early — don't reveal whether the user exists or has an email
            return {"detail": "If that account has an email on file, a reset link has been sent."}

        email = row[0]
        raw_token = create_password_reset_token(body.username)
        await send_password_reset_email(email, body.username, raw_token)

    except Exception:
        # Swallow errors so we don't leak info; log in production
        pass

    return {"detail": "If that account has an email on file, a reset link has been sent."}


@router.post("/reset-password")
def reset_password(body: PasswordResetConfirmIn):
    """Validate the reset token and set the new password."""
    if len(body.new_password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")

    try:
        username = verify_and_consume_reset_token(body.token)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    new_hash = hash_password(body.new_password)

    conn = get_psycopg_connection()
    try:
        cur = conn.cursor()
        cur.execute("UPDATE login_users SET password_hash = %s WHERE username = %s", (new_hash, username))
        conn.commit()
    finally:
        return_attendance_connection(conn)

    return {"detail": "Password updated successfully"}
