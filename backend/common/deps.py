# common/deps.py
from contextlib import contextmanager
from typing import Generator, Optional, Dict

from fastapi import Depends, HTTPException, UploadFile, Header
from core.db import (
    get_psycopg_connection,
    get_inventory_log_connection,
    get_sqlalchemy_engine,
)
from core.security import get_current_user as _get_current_user
from core.pagination import get_page_params, PageParams  # re-export

from sqlalchemy.orm import sessionmaker, Session


# If you adopted the inline Zoho client (recommended)
try:
    from modules._integrations.zoho.client import (
        get_cached_inventory_token as _get_zoho_token,
        zoho_auth_header as _zoho_auth_header,
    )
except Exception:
    _get_zoho_token = None
    _zoho_auth_header = None


# ---------------------------
# Auth
# ---------------------------
async def get_current_user(authorization: str = Header(...)):
    """Auth dependency used by protected routes."""
    return await _get_current_user(authorization=authorization)


# ---------------------------
# Database connections
# ---------------------------
@contextmanager
def pg_conn():
    """
    Context manager for your main psycopg2 DB (used by attendance/enrollment).
    Usage:
        with pg_conn() as conn:
            with conn.cursor() as cur: ...
    """
    conn = get_psycopg_connection()
    try:
        yield conn
    finally:
        conn.close()


@contextmanager
def inventory_conn():
    """
    Context manager for the inventory_logs DB (metadata + logs).
    Automatically commits on successful exit, rolls back on exception.
    """
    conn = get_inventory_log_connection()
    try:
        yield conn
        conn.commit()  # Auto-commit on success
    except Exception:
        conn.rollback()  # Auto-rollback on error
        raise
    finally:
        conn.close()


def labels_engine():
    """
    SQLAlchemy Engine for labels DB (if/when needed).
    Example:
        engine = labels_engine()
        with engine.begin() as conn: ...
    """
    return get_sqlalchemy_engine()


# ---------------------------
# Zoho auth helpers
# ---------------------------
def get_zoho_token() -> str:
    """
    Returns a Zoho Inventory/Creator OAuth token (Authorization value).
    Your routes currently pass this straight to headers. 
    """
    if not _get_zoho_token:
        raise HTTPException(status_code=500, detail="Zoho token helper isn't configured")
    return _get_zoho_token()


def zoho_auth_header() -> Dict[str, str]:
    """
    Convenience header dict for Zoho calls: {"Authorization": "Zoho-oauthtoken ..."}
    """
    if not _zoho_auth_header:
        raise HTTPException(status_code=500, detail="Zoho header helper isn't configured")
    return _zoho_auth_header()


# ---------------------------
# Upload validation
# ---------------------------
def ensure_csv(file: UploadFile):
    """
    Simple CSV guard used by the FR upload route.
    """
    name = (file.filename or "").lower()
    if not name.endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only CSV files are allowed")


# ---------------------------
# Pagination (re-exports)
# ---------------------------
# Routers can: params: PageParams = Depends(get_page_params)
PageParamsDep = PageParams
GetPageParamsDep = get_page_params

# ---------------------------
# SQLAlchemy Session (for routers)
# ---------------------------
# Factory bound to LABELS_DB_URI (via core.db.get_sqlalchemy_engine)
SessionLocal = sessionmaker(bind=get_sqlalchemy_engine(), autoflush=False, autocommit=False)

def get_db() -> Generator[Session, None, None]:
    """
    FastAPI dependency that yields a SQLAlchemy Session.
    Used by endpoints that query Postgres (e.g., /inventory/management/to-print).
    """
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()