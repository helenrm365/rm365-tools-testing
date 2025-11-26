from datetime import datetime, timedelta, timezone
from typing import Any, Dict
import jwt
from passlib.context import CryptContext
from fastapi import Header, HTTPException, status, Depends
from core.config import settings
from core.db import get_psycopg_connection, return_attendance_connection

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def hash_password(raw: str) -> str:
    return pwd_context.hash(raw)

def verify_password(raw: str, hashed: str) -> bool:
    return pwd_context.verify(raw, hashed)

def create_access_token(sub: str) -> str:
    payload: Dict[str, Any] = {
        "sub": sub,
        "exp": datetime.now(timezone.utc) + timedelta(days=settings.AUTH_ACCESS_TTL_DAYS),
    }
    return jwt.encode(payload, settings.AUTH_SECRET_KEY, algorithm=settings.AUTH_ALGORITHM)

def decode_token(token: str) -> Dict[str, Any]:
    try:
        return jwt.decode(token, settings.AUTH_SECRET_KEY, algorithms=[settings.AUTH_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")


def parse_allowed_tabs(value) -> list[str]:
    """
    Accepts either a CSV string ("a,b,c") or a Postgres text[] (list/tuple)
    and returns a clean list[str].
    """
    if value is None:
        return []
    # If it's already a list/tuple (e.g., psycopg returns text[] as list)
    if isinstance(value, (list, tuple)):
        return [str(v).strip() for v in value if str(v).strip()]
    # Otherwise coerce to string and split by comma
    try:
        s = str(value)
    except Exception:
        return []
    return [t.strip() for t in s.split(',') if t and t.strip()]

async def get_current_user(authorization: str = Header(...)):
    token = authorization.split("Bearer ")[-1]
    payload = decode_token(token)
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # Check if this is the built-in superadmin (bypasses database)
    if username == settings.SUPERADMIN_USERNAME:
        all_tabs = [
            "attendance", "attendance.overview", "attendance.logs", "attendance.manual", "attendance.automatic",
            "enrollment", "enrollment.management", "enrollment.card", "enrollment.fingerprint",
            "labels", "labels.generator", "labels.history",
            "salesdata", "salesdata.uk-sales", "salesdata.fr-sales", "salesdata.nl-sales", "salesdata.upload", "salesdata.history",
            "inventory", "inventory.management", "inventory.order-fulfillment", "inventory.order-progress",
            "usermanagement", "usermanagement.management"
        ]
        return {"username": username, "role": "superadmin", "allowed_tabs": all_tabs}

    conn = get_psycopg_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT COALESCE(NULLIF(role, ''), 'user') as role, allowed_tabs FROM login_users WHERE username = %s", (username,))
        row = cur.fetchone()
    finally:
        return_attendance_connection(conn)

    if not row:
        raise HTTPException(status_code=404, detail="User not found")

    role = row[0] if row[0] else 'user'
    allowed_tabs = parse_allowed_tabs(row[1])
    return {"username": username, "role": role, "allowed_tabs": allowed_tabs}
