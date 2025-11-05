import os
import psycopg2
from sqlalchemy import create_engine
from contextlib import contextmanager
from pathlib import Path

def get_psycopg_connection():
    """Get a raw psycopg2 connection for attendance/enrollment modules"""
    # Use individual environment variables as set in Railway
    host = os.getenv("ATTENDANCE_DB_HOST")
    port = os.getenv("ATTENDANCE_DB_PORT", "5432")
    database = os.getenv("ATTENDANCE_DB_NAME", "railway")
    user = os.getenv("ATTENDANCE_DB_USER", "postgres")
    password = os.getenv("ATTENDANCE_DB_PASSWORD")
    
    if not all([host, password]):
        raise ValueError("Missing required database environment variables: ATTENDANCE_DB_HOST and ATTENDANCE_DB_PASSWORD")
    
    return psycopg2.connect(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password
    )

def get_inventory_log_connection():
    """Get connection for inventory logs"""
    host = os.getenv("INVENTORY_LOGS_HOST")
    port = os.getenv("INVENTORY_LOGS_PORT", "5432")
    database = os.getenv("INVENTORY_LOGS_NAME", "railway")
    user = os.getenv("INVENTORY_LOGS_USER", "postgres")
    password = os.getenv("INVENTORY_LOGS_PASSWORD")
    
    if not all([host, password]):
        raise ValueError("Missing required inventory database environment variables")
    
    return psycopg2.connect(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password
    )

def get_products_connection():
    """Get connection for products/sales database"""
    host = os.getenv("PRODUCTS_DB_HOST")
    port = os.getenv("PRODUCTS_DB_PORT", "5432")
    database = os.getenv("PRODUCTS_DB_NAME", "railway")
    user = os.getenv("PRODUCTS_DB_USER", "postgres")
    password = os.getenv("PRODUCTS_DB_PASSWORD")
    
    if not all([host, password]):
        raise ValueError("Missing required products database environment variables")
    
    return psycopg2.connect(
        host=host,
        port=port,
        database=database,
        user=user,
        password=password
    )

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
        conn.close()
        print("✅ Database connection successful - Railway database is ready")
        
        try:
            from modules.roles.service import RolesService
            roles_svc = RolesService()
            roles_svc.init_roles_table()
            print("✅ Roles table initialized with default roles")
        except Exception as e:
            print(f"⚠️  Could not initialize roles table: {e}")
        
        return True
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        print("⚠️  Check Railway database configuration and environment variables")
        return False

def inventory_conn():
    return get_inventory_log_connection()