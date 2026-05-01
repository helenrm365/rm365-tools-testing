import os
import psycopg2
from psycopg2 import pool
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
    
    kwargs = {"connect_timeout": timeout, "sslmode": sslmode}
    
    # Support custom root certificate for IONOS/Cloud DBs
    if os.getenv("DB_SSLROOTCERT"):
        kwargs["sslrootcert"] = os.getenv("DB_SSLROOTCERT")
        
    return kwargs


def _get_attendance_pool():
    """Get or create attendance database connection pool"""
    global _attendance_pool
    if _attendance_pool is None:
        host = os.getenv("ATTENDANCE_DB_HOST")
        port = os.getenv("ATTENDANCE_DB_PORT", "5432")
        database = os.getenv("ATTENDANCE_DB_NAME", "rm365")
        user = os.getenv("ATTENDANCE_DB_USER", "postgres")
        password = os.getenv("ATTENDANCE_DB_PASSWORD", "")
        sslmode = os.getenv("DB_SSLMODE", "prefer")
        
        # When SSL is disabled, require password. When SSL is enabled, allow passwordless auth
        if not host:
            raise ValueError("Missing required database environment variable: ATTENDANCE_DB_HOST")
        if sslmode == "disable" and not password:
            raise ValueError("Missing required database environment variables: ATTENDANCE_DB_HOST and ATTENDANCE_DB_PASSWORD")
        
        try:
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
        except psycopg2.OperationalError as e:
            msg = str(e)
            if "certificate verify failed" in msg:
                print(f"❌ SSL Verification Failed: The database certificate could not be verified.")
                print(f"   SUGGESTION: Set DB_SSLMODE=disable in your .env file (if you trust this network)")
                print(f"   OR: Ensure you use the correct CA certificate.")
            elif "no password supplied" in msg:
                print(f"❌ Missing Password: The database requires a password but none was provided.")
                print(f"   SUGGESTION: Check ATTENDANCE_DB_PASSWORD in your .env file.")
            raise e
    
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
        database = os.getenv("INVENTORY_LOGS_NAME", "rm365")
        user = os.getenv("INVENTORY_LOGS_USER", "postgres")
        password = os.getenv("INVENTORY_LOGS_PASSWORD", "")
        sslmode = os.getenv("DB_SSLMODE", "prefer")
        
        # When SSL is disabled, require password. When SSL is enabled, allow passwordless auth
        if not host:
            raise ValueError("Missing required inventory database environment variable: INVENTORY_LOGS_HOST")
        if sslmode == "disable" and not password:
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
        database = os.getenv("PRODUCTS_DB_NAME", "rm365")
        user = os.getenv("PRODUCTS_DB_USER", "postgres")
        password = os.getenv("PRODUCTS_DB_PASSWORD", "")
        sslmode = os.getenv("DB_SSLMODE", "prefer")
        
        # When SSL is disabled, require password. When SSL is enabled, allow passwordless auth
        if not host:
            raise ValueError("Missing required products database environment variable: PRODUCTS_DB_HOST")
        if sslmode == "disable" and not password:
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
    """Get connection for products/magento database"""
    pool_obj = _get_products_pool()
    return pool_obj.getconn()


def return_products_connection(conn):
    """Return a connection to the products pool"""
    if _products_pool and conn:
        _products_pool.putconn(conn)


def initialize_database():
    """Test database connection and initialize tab presets table"""
    print("🔧 Testing database connection...")
    
    try:
        # Test database connection
        conn = get_psycopg_connection()
        return_attendance_connection(conn)
        print("✅ Database connection successful")
        
        try:
            from modules.tab_presets.service import TabPresetsService
            presets_svc = TabPresetsService()
            presets_svc.init_tab_presets_table()
            print("✅ Tab presets table initialized with system defaults")
        except Exception as e:
            print(f"⚠️  Could not initialize tab presets table: {e}")
        
        try:
            from modules.groups.service import GroupsService
            groups_svc = GroupsService()
            groups_svc.init_groups_table()
            print("✅ Groups table initialized")
        except Exception as e:
            print(f"⚠️  Could not initialize groups table: {e}")
        
        try:
            from modules.magentodata.repo import MagentoDataRepo
            magento_repo = MagentoDataRepo()
            magento_repo.init_tables()
            print("✅ Magento data tables initialized")
        except Exception as e:
            print(f"⚠️  Could not initialize magento data tables: {e}")

        # Locations must be initialized before login_users FK migration
        try:
            from modules.attendance.locations_repo import LocationsRepo
            LocationsRepo().init_table()
            print("✅ Locations table initialized")
        except Exception as e:
            print(f"⚠️  Could not initialize locations table: {e}")

        # Attendance tables (adds location_id column migration to attendance_logs)
        try:
            from modules.attendance.repo import AttendanceRepo
            AttendanceRepo().init_tables()
            print("✅ Attendance tables initialized")
        except Exception as e:
            print(f"⚠️  Could not initialize attendance tables: {e}")

        try:
            conn = get_psycopg_connection()
            with conn.cursor() as cur:
                cur.execute("ALTER TABLE login_users ADD COLUMN IF NOT EXISTS preferences JSONB")
                cur.execute("ALTER TABLE login_users ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id)")
            conn.commit()
            return_attendance_connection(conn)
            print("✅ User preferences & location columns initialized")
        except Exception as e:
            print(f"⚠️  Could not initialize user preferences/location columns: {e}")
        
        try:
            from modules.orders.order_fulfillment.db_repo import init_order_fulfillment_tables
            init_order_fulfillment_tables()
            print("✅ Order fulfillment tables initialized")
        except Exception as e:
            print(f"⚠️  Could not initialize order fulfillment tables: {e}")
        
        return True
    except Exception as e:
        print(f"❌ Database connection failed: {e}")
        print("⚠️  Check database configuration and environment variables")
        return False

def inventory_conn():
    return get_inventory_log_connection()