from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List
import jwt
from passlib.context import CryptContext
from fastapi import Header, HTTPException, status, Depends
from core.config import settings
from core.db import get_psycopg_connection, return_attendance_connection

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

def get_all_tabs() -> List[str]:
    """
    Centralized function to get all available tabs in the system.
    This ensures consistency across login, token validation, and other auth flows.
    
    IMPORTANT: When adding new tabs/sub-tabs to the application:
    1. Add them to this list to make them available to superadmin automatically
    2. Use dot notation for sub-tabs (e.g., "orders.order-tracking")
    3. Include both the parent tab and sub-tabs for proper permission inheritance
    
    The superadmin user (localhost) will always have access to ALL tabs listed here.
    Regular users will have their allowed_tabs filtered based on their role/permissions.
    """
    return [
        "attendance", "attendance.analytics", "attendance.staff", "attendance.timesheets", "attendance.clocking",
        "enrollment", "enrollment.management", "enrollment.nfc", "enrollment.card",
        "labels", "labels.generator", "labels.history",
        "magentodata", "magentodata.uk-magento", "magentodata.fr-magento", "magentodata.nl-magento", "magentodata.history",
        "inventory", "inventory.management",
        "orders", "orders.order-fulfillment", "orders.order-progress", "orders.order-tracking", "orders.order-approval",
        "birmingham-orders", "birmingham-orders.order-fulfillment", "birmingham-orders.order-progress",
        "birmingham-orders.order-tracking", "birmingham-orders.order-approval", "birmingham-orders.scanner",
        "birmingham-orders.scanning-logs",
        "france-orders", "france-orders.order-fulfillment", "france-orders.order-progress",
        "france-orders.order-tracking", "france-orders.order-approval", "france-orders.scanner",
        "france-orders.scanning-logs",
        "london-orders", "london-orders.order-fulfillment", "london-orders.order-progress",
        "london-orders.order-tracking", "london-orders.order-approval", "london-orders.scanner",
        "london-orders.scanning-logs",
        "usermanagement", "usermanagement.management"
    ]

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
    and returns a clean list[str].  Empty / NULL ➜ ['*'] (full access).
    """
    if value is None:
        return ['*']
    # If it's already a list/tuple (e.g., psycopg returns text[] as list)
    if isinstance(value, (list, tuple)):
        result = [str(v).strip() for v in value if str(v).strip()]
        return result if result else ['*']
    # Otherwise coerce to string and split by comma
    try:
        s = str(value)
    except Exception:
        return ['*']
    result = [t.strip() for t in s.split(',') if t and t.strip()]
    return result if result else ['*']

async def get_current_user(authorization: str = Header(None)):
    if not authorization:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authorization header required")
    token = authorization.split("Bearer ")[-1]
    if not token:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Bearer token required")
    payload = decode_token(token)
    username = payload.get("sub")
    if not username:
        raise HTTPException(status_code=401, detail="Invalid token payload")

    # Check if this is the built-in superadmin (bypasses database)
    if username == settings.SUPERADMIN_USERNAME:
        all_tabs = get_all_tabs()
        return {"username": username, "role": "superadmin", "allowed_tabs": all_tabs}

    # Regular database authentication
    try:
        conn = get_psycopg_connection()
        try:
            cur = conn.cursor()
            try:
                cur.execute("SELECT COALESCE(NULLIF(role, ''), 'user') as role, allowed_tabs, location_id FROM login_users WHERE username = %s", (username,))
                row = cur.fetchone()
            except Exception:
                # Fallback if location_id column doesn't exist yet (pre-migration)
                conn.rollback()
                cur.execute("SELECT COALESCE(NULLIF(role, ''), 'user') as role, allowed_tabs FROM login_users WHERE username = %s", (username,))
                raw = cur.fetchone()
                row = (raw[0], raw[1], None) if raw else None
        finally:
            return_attendance_connection(conn)

        if not row:
            raise HTTPException(status_code=404, detail="User not found")

        role = row[0] if row[0] else 'user'
        allowed_tabs = parse_allowed_tabs(row[1])
        location_id = row[2] if len(row) > 2 and row[2] else None
        return {"username": username, "role": role, "allowed_tabs": allowed_tabs, "location_id": location_id}
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except Exception as e:
        # Database not available - reject non-superadmin users
        print(f"[Auth] Database error for user {username}: {e}")
        raise HTTPException(status_code=503, detail="Database not available - authentication failed")
