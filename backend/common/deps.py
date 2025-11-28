# common/deps.py
from contextlib import contextmanager
from typing import Generator, Optional, Dict

from fastapi import Depends, HTTPException, UploadFile, Header
from core.db import (
    get_psycopg_connection,
    get_inventory_log_connection,
    get_products_connection,
    get_sqlalchemy_engine,
    return_attendance_connection,
    return_inventory_connection,
    return_products_connection,
)
from core.security import get_current_user as _get_current_user
from core.pagination import get_page_params, PageParams  # re-export

from sqlalchemy.orm import sessionmaker, Session


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
    Automatically commits on successful exit, rolls back on exception.
    Usage:
        with pg_conn() as conn:
            with conn.cursor() as cur: ...
    """
    conn = get_psycopg_connection()
    try:
        yield conn
        conn.commit()  # Auto-commit on success (including read operations)
    except Exception:
        conn.rollback()  # Auto-rollback on error
        raise
    finally:
        return_attendance_connection(conn)


@contextmanager
def inventory_conn():
    """
    Context manager for the inventory_logs DB (metadata + logs).
    Automatically commits on successful exit, rolls back on exception.
    """
    conn = get_inventory_log_connection()
    try:
        yield conn
        conn.commit()  # Auto-commit on success (including read operations)
    except Exception:
        conn.rollback()  # Auto-rollback on error
        raise
    finally:
        return_inventory_connection(conn)


@contextmanager
def products_conn():
    """
    Context manager for the products DB (sales data, condensed_sales, etc.).
    Automatically commits on successful exit, rolls back on exception.
    """
    conn = get_products_connection()
    try:
        yield conn
        conn.commit()  # Auto-commit on success (including read operations)
    except Exception:
        conn.rollback()  # Auto-rollback on error
        raise
    finally:
        return_products_connection(conn)


def labels_engine():
    """
    SQLAlchemy Engine for labels DB (if/when needed).
    Example:
        engine = labels_engine()
        with engine.begin() as conn: ...
    """
    return get_sqlalchemy_engine()


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