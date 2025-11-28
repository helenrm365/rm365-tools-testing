# backend/core/auth.py
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from core.security import verify_password, create_access_token, get_current_user, parse_allowed_tabs
from core.db import get_psycopg_connection, return_attendance_connection
from core.config import settings

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
            # Grant full access to all tabs (using dot notation for sub-tabs)
            all_tabs = [
                "attendance", "attendance.overview", "attendance.logs", "attendance.manual", "attendance.automatic",
                "enrollment", "enrollment.management", "enrollment.card", "enrollment.fingerprint",
                "labels", "labels.generator", "labels.history",
                "salesdata", "salesdata.uk-sales", "salesdata.fr-sales", "salesdata.nl-sales", "salesdata.upload", "salesdata.history",
                "inventory", "inventory.management", "inventory.order-fulfillment", "inventory.order-progress",
                "usermanagement", "usermanagement.management"
            ]
            return {"access_token": token, "role": "superadmin", "allowed_tabs": all_tabs}
        else:
            raise HTTPException(status_code=401, detail="Invalid credentials")
    
    # Regular database authentication
    conn = get_psycopg_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT password_hash, COALESCE(NULLIF(role, ''), 'user') as role, allowed_tabs FROM login_users WHERE username=%s", (body.username,))
        row = cur.fetchone()
    finally:
        return_attendance_connection(conn)

    if not row or not verify_password(body.password, row[0]):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = create_access_token(sub=body.username)
    role = row[1] if row[1] else 'user'
    allowed_tabs = parse_allowed_tabs(row[2])
    return {"access_token": token, "role": role, "allowed_tabs": allowed_tabs}

@router.get("/me")
def me(user=Depends(get_current_user)):
    return {"username": user["username"], "role": user.get("role", "user"), "allowed_tabs": user["allowed_tabs"]}
