import os
import psycopg2
from psycopg2 import pool
from sqlalchemy import create_engine
from contextlib import contextmanager
from pathlib import Path

# Connection pools for better performance
_attendance_pool = None
_inventory_pool = None
_products_pool = None

def _conn_common_kwargs():
    """Common connection kwargs with sane defaults for cloud envs."""
    # Keep startup snappy; let app boot even if DB is slow/unreachable
    timeout = int(os.getenv("DB_CONNECT_TIMEOUT", "5"))
    # Allow overriding SSL mode, default to 'prefer' or 'disable' for local
    sslmode = os.getenv("DB_SSLMODE", "prefer")
    return {"connect_timeout": timeout, "sslmode": sslmode}


def _get_attendance_pool():
    """Get or create attendance database connection pool"""
    global _attendance_pool
    if _attendance_pool is None:
        host = os.getenv("ATTENDANCE_DB_HOST")
        port = os.getenv("ATTENDANCE_DB_PORT", "5432")
        database = os.getenv("ATTENDANCE_DB_NAME", "railway")
        user = os.getenv("ATTENDANCE_DB_USER", "postgres")
        password = os.getenv("ATTENDANCE_DB_PASSWORD")
        
        if not all([host, password]):
            raise ValueError("Missing required database environment variables: ATTENDANCE_DB_HOST and ATTENDANCE_DB_PASSWORD")
        
        _attendance_pool = pool.SimpleConnectionPool(
            minconn=2,
            maxconn=20,
            host=host,
            port=port,
            database=database,
            user=user,
            password=password,
            **_conn_common_kwargs(),
        )
        print("✅ Attendance database connection pool created (2-20 connections)")
    
    return _attendance_pool


def get_psycopg_connection():
    """Get a raw psycopg2 connection for attendance/enrollment modules"""
    pool_obj = _get_attendance_pool()
    return pool_obj.getconn()


def return_psycopg_connection(conn):
    """Return a connection to the attendance pool"""
    if _attendance_pool and conn:
        _attendance_pool.putconn(conn)


# Alias for clarity
return_attendance_connection = return_psycopg_connection


def _get_inventory_pool():
    """Get or create inventory database connection pool"""
    global _inventory_pool
    if _inventory_pool is None:
        host = os.getenv("INVENTORY_LOGS_HOST")
        port = os.getenv("INVENTORY_LOGS_PORT", "5432")
        database = os.getenv("INVENTORY_LOGS_NAME", "railway")
        user = os.getenv("INVENTORY_LOGS_USER", "postgres")
        password = os.getenv("INVENTORY_LOGS_PASSWORD")
        
        if not all([host, password]):
            raise ValueError("Missing required inventory database environment variables")
        
        _inventory_pool = pool.SimpleConnectionPool(
            minconn=2,
            maxconn=20,
            host=host,
            port=port,
            database=database,
            user=user,
            password=password,
            **_conn_common_kwargs(),
        )
        print("✅ Inventory database connection pool created (2-20 connections)")
    
    return _inventory_pool


def get_inventory_log_connection():
    """Get connection for inventory logs"""
    pool_obj = _get_inventory_pool()
    return pool_obj.getconn()


def return_inventory_connection(conn):
    """Return a connection to the inventory pool"""
    if _inventory_pool and conn:
        _inventory_pool.putconn(conn)


def _get_products_pool():
    """Get or create products database connection pool"""
    global _products_pool
    if _products_pool is None:
        host = os.getenv("PRODUCTS_DB_HOST")
        port = os.getenv("PRODUCTS_DB_PORT", "5432")
        database = os.getenv("PRODUCTS_DB_NAME", "railway")
        user = os.getenv("PRODUCTS_DB_USER", "postgres")
        password = os.getenv("PRODUCTS_DB_PASSWORD")
        
        if not all([host, password]):
            raise ValueError("Missing required products database environment variables")
        
        _products_pool = pool.SimpleConnectionPool(
            minconn=2,
            maxconn=20,
            host=host,
            port=port,
            database=database,
            user=user,
            password=password,
            **_conn_common_kwargs(),
        )
        print("✅ Products database connection pool created (2-20 connections)")
    
    return _products_pool


def get_products_connection():
    """Get connection for products/sales database"""
    pool_obj = _get_products_pool()
    return pool_obj.getconn()


def return_products_connection(conn):
    """Return a connection to the products pool"""
    if _products_pool and conn:
        _products_pool.putconn(conn)

def get_sqlalchemy_engine():
    """Get SQLAlchemy engine for labels module"""
    labels_db_uri = os.getenv("LABELS_DB_URI")
    if not labels_db_uri:
        raise ValueError("LABELS_DB_URI environment variable not set")
    return create_engine(labels_db_uri)

def initialize_database():
    """Test database connection and initialize roles table"""
    print("🔧 Testing database connection...")
    
    try:
        # Test database connection
        conn = get_psycopg_connection()
        return_attendance_connection(conn)
        print("✅ Database connection successful")
        
        try:
            from modules.roles.service import RolesService
            roles_svc = RolesService()
            roles_svc.init_roles_table()
            print("✅ Roles table initialized with default roles")
        except Exception as e:
            print(f"⚠️  Could not initialize roles table: {e}")
        
        try:
            from modules.salesdata.repo import SalesDataRepo
            sales_repo = SalesDataRepo()
            sales_repo.init_tables()
            print("✅ Sales data tables initialized (UK, FR, NL sales data and condensed tables)")
        except Exception as e:
            print(f"⚠️  Could not initialize sales data tables: {e}")
        
        return True
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        print("⚠️  Check Railway database configuration and environment variables")
        return False

def inventory_conn():
    return get_inventory_log_connection()