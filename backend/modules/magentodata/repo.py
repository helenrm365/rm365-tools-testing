from typing import List, Dict, Any, Optional
import logging
import csv
import io
import json
from datetime import datetime, timezone
from core.db import get_products_connection, return_products_connection

logger = logging.getLogger(__name__)


class MagentoDataRepo:
    """Repository for magento data operations"""
    
    def __init__(self):
        pass
    
    def init_tables(self):
        """Initialize magento data tables and condensed tables if they don't exist"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Define the main magento data tables to create
            tables = ['uk_magento_data', 'fr_magento_data', 'nl_magento_data']
            condensed_tables = ['uk_condensed_magento', 'fr_condensed_magento', 'nl_condensed_magento']
            all_tables = []
            
            # Create SKU aliases table first if it doesn't exist
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'sku_aliases'
                )
            """)
            
            if not cursor.fetchone()[0]:
                cursor.execute("""
                    CREATE TABLE sku_aliases (
                        id SERIAL PRIMARY KEY,
                        alias_sku VARCHAR(255) NOT NULL UNIQUE,
                        unified_sku VARCHAR(255) NOT NULL,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                logger.info(f"✅ Created table: sku_aliases")
            else:
                logger.info(f"ℹ️  Table already exists: sku_aliases")
            
            # Create import history table if it doesn't exist
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'import_history'
                )
            """)
            
            if not cursor.fetchone()[0]:
                cursor.execute("""
                    CREATE TABLE import_history (
                        id SERIAL PRIMARY KEY,
                        region VARCHAR(10) NOT NULL,
                        filename VARCHAR(255),
                        rows_imported INTEGER NOT NULL DEFAULT 0,
                        rows_failed INTEGER NOT NULL DEFAULT 0,
                        errors TEXT,
                        imported_by VARCHAR(100),
                        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        status VARCHAR(50) NOT NULL
                    )
                """)
                logger.info(f"✅ Created table: import_history")
            else:
                logger.info(f"ℹ️  Table already exists: import_history")
            
            # Create excluded customers table for 6M condensed magento filters
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'condensed_magento_excluded_customers'
                )
            """)
            
            if not cursor.fetchone()[0]:
                cursor.execute("""
                    CREATE TABLE condensed_magento_excluded_customers (
                        id SERIAL PRIMARY KEY,
                        region VARCHAR(10) NOT NULL,
                        customer_email VARCHAR(255) NOT NULL,
                        customer_full_name VARCHAR(255),
                        added_by VARCHAR(100),
                        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(region, customer_email)
                    )
                """)
                logger.info(f"✅ Created table: condensed_magento_excluded_customers")
            else:
                logger.info(f"ℹ️  Table already exists: condensed_magento_excluded_customers")
            
            # Create excluded customer groups table for 6M condensed magento filters
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'condensed_magento_excluded_customer_groups'
                )
            """)
            
            if not cursor.fetchone()[0]:
                cursor.execute("""
                    CREATE TABLE condensed_magento_excluded_customer_groups (
                        id SERIAL PRIMARY KEY,
                        region VARCHAR(10) NOT NULL,
                        customer_group VARCHAR(255) NOT NULL,
                        added_by VARCHAR(100),
                        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(region, customer_group)
                    )
                """)
                logger.info(f"✅ Created table: condensed_magento_excluded_customer_groups")
            else:
                logger.info(f"ℹ️  Table already exists: condensed_magento_excluded_customer_groups")
            
            # Create sync metadata table to track resumable syncs
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'magento_sync_metadata'
                )
            """)
            
            if not cursor.fetchone()[0]:
                cursor.execute("""
                    CREATE TABLE magento_sync_metadata (
                        id SERIAL PRIMARY KEY,
                        region VARCHAR(10) NOT NULL UNIQUE,
                        last_synced_order_date TIMESTAMP,
                        last_sync_time TIMESTAMP,
                        total_orders_synced INTEGER DEFAULT 0,
                        total_rows_synced INTEGER DEFAULT 0,
                        last_synced_by VARCHAR(100),
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                logger.info(f"✅ Created table: magento_sync_metadata")
            else:
                logger.info(f"ℹ️  Table already exists: magento_sync_metadata")
            
            # Create grand total threshold table for 6M condensed magento filters
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'condensed_magento_grand_total_threshold'
                )
            """)
            
            if not cursor.fetchone()[0]:
                cursor.execute("""
                    CREATE TABLE condensed_magento_grand_total_threshold (
                        id SERIAL PRIMARY KEY,
                        region VARCHAR(10) NOT NULL UNIQUE,
                        threshold DECIMAL(10, 2),
                        qty_threshold INTEGER,
                        updated_by VARCHAR(100),
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                logger.info(f"✅ Created table: condensed_magento_grand_total_threshold")
            else:
                logger.info(f"ℹ️  Table already exists: condensed_magento_grand_total_threshold")
                # Add qty_threshold column if it doesn't exist
                cursor.execute("""
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'condensed_magento_grand_total_threshold' 
                    AND column_name = 'qty_threshold'
                """)
                if not cursor.fetchone():
                    cursor.execute("""
                        ALTER TABLE condensed_magento_grand_total_threshold 
                        ADD COLUMN qty_threshold INTEGER
                    """)
                    logger.info(f"✅ Added qty_threshold column to condensed_magento_grand_total_threshold")
            
            # Make threshold column nullable if it isn't already
            cursor.execute("""
                ALTER TABLE condensed_magento_grand_total_threshold 
                ALTER COLUMN threshold DROP NOT NULL
            """)

            
            # Create main magento data tables
            for table_name in tables:
                # Check if table exists
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = %s
                    )
                """, (table_name,))
                
                exists = cursor.fetchone()[0]
                
                if not exists:
                    # Create the table with the required columns
                    create_table_sql = f"""
                        CREATE TABLE {table_name} (
                            id SERIAL PRIMARY KEY,
                            order_number VARCHAR(255) NOT NULL,
                            created_at VARCHAR(255) NOT NULL,
                            sku VARCHAR(255) NOT NULL,
                            name TEXT NOT NULL,
                            qty INTEGER NOT NULL,
                            original_price DECIMAL(10, 2),
                            special_price DECIMAL(10, 2),
                            status VARCHAR(100) NOT NULL,
                            currency VARCHAR(10),
                            grand_total DECIMAL(10, 2),
                            customer_email VARCHAR(255),
                            customer_full_name VARCHAR(255),
                            billing_address TEXT,
                            shipping_address TEXT,
                            customer_group_code VARCHAR(255),
                            imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    """
                    cursor.execute(create_table_sql)
                    logger.info(f"✅ Created table: {table_name}")
                    
                    # Create unique constraint to prevent duplicate order+SKU combinations
                    cursor.execute(f"""
                        ALTER TABLE {table_name} 
                        ADD CONSTRAINT unique_{table_name}_order_sku 
                        UNIQUE (order_number, sku)
                    """)
                    logger.info(f"✅ Created unique constraint on {table_name}(order_number, sku)")
                    
                    # Create indexes for performance
                    cursor.execute(f"CREATE INDEX idx_{table_name}_sku ON {table_name}(sku)")
                    cursor.execute(f"CREATE INDEX idx_{table_name}_order_number ON {table_name}(order_number)")
                    cursor.execute(f"CREATE INDEX idx_{table_name}_created_at ON {table_name}(created_at)")
                    cursor.execute(f"CREATE INDEX idx_{table_name}_customer_email ON {table_name}(customer_email)")
                    logger.info(f"✅ Created indexes for {table_name}")
                else:
                    logger.info(f"ℹ️  Table already exists: {table_name}")
                    
                    # Add unique constraint if it doesn't exist
                    cursor.execute(f"""
                        SELECT constraint_name 
                        FROM information_schema.table_constraints 
                        WHERE table_name = %s 
                        AND constraint_type = 'UNIQUE'
                        AND constraint_name = %s
                    """, (table_name, f'unique_{table_name}_order_sku'))
                    
                    if not cursor.fetchone():
                        try:
                            cursor.execute(f"""
                                ALTER TABLE {table_name} 
                                ADD CONSTRAINT unique_{table_name}_order_sku 
                                UNIQUE (order_number, sku)
                            """)
                            logger.info(f"✅ Added unique constraint to existing table {table_name}")
                        except Exception as e:
                            logger.warning(f"Could not add unique constraint to {table_name}: {e}")
                            # This might fail if there are existing duplicates
                
                all_tables.append(table_name)
            
            # Create condensed magento tables (6-month aggregated data)
            for table_name in condensed_tables:
                # Check if table exists
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = %s
                    )
                """, (table_name,))
                
                exists = cursor.fetchone()[0]
                
                if not exists:
                    # Create the condensed table
                    # This table aggregates magento by SKU over the last 6 months
                    create_table_sql = f"""
                        CREATE TABLE {table_name} (
                            id SERIAL PRIMARY KEY,
                            sku VARCHAR(255) NOT NULL UNIQUE,
                            name TEXT,
                            total_qty INTEGER NOT NULL DEFAULT 0,
                            last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    """
                    cursor.execute(create_table_sql)
                    logger.info(f"✅ Created condensed table: {table_name}")
                else:
                    logger.info(f"ℹ️  Condensed table already exists: {table_name}")
                
                all_tables.append(table_name)
            
            conn.commit()
            return all_tables
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error initializing magento tables: {e}")
            raise
        finally:
            if conn:
                if 'cursor' in locals() and cursor:
                    cursor.close()
                return_products_connection(conn)
    
    def init_test_table(self):
        """Initialize test_magento_data table for testing Magento sync"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Check if test table exists
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'test_magento_data'
                )
            """)
            
            exists = cursor.fetchone()[0]
            
            if not exists:
                # Create the test table with same structure as main tables
                create_table_sql = """
                    CREATE TABLE test_magento_data (
                        id SERIAL PRIMARY KEY,
                        order_number VARCHAR(255) NOT NULL,
                        created_at VARCHAR(255) NOT NULL,
                        sku VARCHAR(255) NOT NULL,
                        name TEXT NOT NULL,
                        qty INTEGER NOT NULL,
                        original_price DECIMAL(10, 2),
                        special_price DECIMAL(10, 2),
                        status VARCHAR(100) NOT NULL,
                        currency VARCHAR(10),
                        grand_total DECIMAL(10, 2),
                        customer_email VARCHAR(255),
                        customer_full_name VARCHAR(255),
                        billing_address TEXT,
                        shipping_address TEXT,
                        customer_group_code VARCHAR(255),
                        imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """
                cursor.execute(create_table_sql)
                logger.info(f"✅ Created table: test_magento_data")
                
                # Create unique constraint to prevent duplicate order+SKU combinations
                cursor.execute("""
                    ALTER TABLE test_magento_data 
                    ADD CONSTRAINT unique_test_magento_data_order_sku 
                    UNIQUE (order_number, sku)
                """)
                logger.info(f"✅ Created unique constraint on test_magento_data(order_number, sku)")
                
                # Create indexes for performance
                cursor.execute(f"CREATE INDEX idx_test_magento_data_sku ON test_magento_data(sku)")
                cursor.execute(f"CREATE INDEX idx_test_magento_data_order_number ON test_magento_data(order_number)")
                cursor.execute(f"CREATE INDEX idx_test_magento_data_created_at ON test_magento_data(created_at)")
                cursor.execute(f"CREATE INDEX idx_test_magento_data_customer_email ON test_magento_data(customer_email)")
                logger.info(f"✅ Created indexes for test_magento_data")
            else:
                logger.info(f"ℹ️  Table already exists: test_magento_data")
                
                # Add unique constraint if it doesn't exist
                cursor.execute("""
                    SELECT constraint_name 
                    FROM information_schema.table_constraints 
                    WHERE table_name = 'test_magento_data' 
                    AND constraint_type = 'UNIQUE'
                    AND constraint_name = 'unique_test_magento_data_order_sku'
                """)
                
                if not cursor.fetchone():
                    try:
                        cursor.execute("""
                            ALTER TABLE test_magento_data 
                            ADD CONSTRAINT unique_test_magento_data_order_sku 
                            UNIQUE (order_number, sku)
                        """)
                        logger.info(f"✅ Added unique constraint to existing test_magento_data")
                    except Exception as e:
                        logger.warning(f"Could not add unique constraint to test_magento_data: {e}")
            
            conn.commit()
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error initializing test table: {e}")
            raise
        finally:
            if conn:
                if 'cursor' in locals() and cursor:
                    cursor.close()
                return_products_connection(conn)
    
    def get_sync_metadata(self, region: str) -> Optional[Dict[str, Any]]:
        """
        Get sync metadata for a region to enable resumable syncs.
        
        Args:
            region: Region code (uk, fr, nl)
        
        Returns:
            Dict with last_synced_order_date and sync stats, or None if no metadata exists
        """
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT last_synced_order_date, last_sync_time, total_orders_synced, 
                       total_rows_synced, last_synced_by
                FROM magento_sync_metadata
                WHERE region = %s
            """, (region.lower(),))
            
            row = cursor.fetchone()
            if not row:
                return None
            
            return {
                'last_synced_order_date': row[0],
                'last_sync_time': row[1],
                'total_orders_synced': row[2],
                'total_rows_synced': row[3],
                'last_synced_by': row[4]
            }
            
        except Exception as e:
            logger.error(f"Error getting sync metadata for {region}: {e}")
            return None
        finally:
            if conn:
                if 'cursor' in locals() and cursor:
                    cursor.close()
                return_products_connection(conn)
    
    def update_sync_metadata(
        self, 
        region: str, 
        last_order_date: str,
        orders_count: int,
        rows_count: int,
        username: str = None
    ):
        """
        Update sync metadata after a successful sync.
        
        Args:
            region: Region code (uk, fr, nl)
            last_order_date: The created_at timestamp of the most recent order synced
            orders_count: Number of orders processed in this sync
            rows_count: Number of product rows inserted in this sync
            username: User who performed the sync
        """
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Convert string to timestamp if needed
            from datetime import datetime
            if isinstance(last_order_date, str):
                # Magento dates are in format: 2024-12-01 15:30:00
                last_order_timestamp = datetime.fromisoformat(last_order_date.replace(' ', 'T'))
            else:
                last_order_timestamp = last_order_date
            
            # Upsert the metadata
            cursor.execute("""
                INSERT INTO magento_sync_metadata 
                (region, last_synced_order_date, last_sync_time, total_orders_synced, 
                 total_rows_synced, last_synced_by, updated_at)
                VALUES (%s, %s, NOW(), %s, %s, %s, NOW())
                ON CONFLICT (region) 
                DO UPDATE SET
                    last_synced_order_date = EXCLUDED.last_synced_order_date,
                    last_sync_time = NOW(),
                    total_orders_synced = magento_sync_metadata.total_orders_synced + EXCLUDED.total_orders_synced,
                    total_rows_synced = magento_sync_metadata.total_rows_synced + EXCLUDED.total_rows_synced,
                    last_synced_by = EXCLUDED.last_synced_by,
                    updated_at = NOW()
            """, (region.lower(), last_order_timestamp, orders_count, rows_count, username))
            
            conn.commit()
            logger.info(f"Updated sync metadata for {region}: {orders_count} orders, {rows_count} rows")
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error updating sync metadata for {region}: {e}")
            raise
        finally:
            if conn:
                if 'cursor' in locals() and cursor:
                    cursor.close()
                return_products_connection(conn)
    
    def verify_order_completeness(self, table_name: str, last_synced_date: str, region: str = None) -> Dict[str, Any]:
        """
        Verify that the last synced order was completely saved (all products present).
        
        This checks if the order at last_synced_date has all its products saved by:
        1. Fetching the actual order from Magento API
        2. Comparing the number of products in the database against the actual count
        
        Args:
            table_name: The table to check (uk_magento_data, fr_magento_data, nl_magento_data, test_magento_data)
            last_synced_date: The created_at date of the last synced order
            region: Region code (uk, fr, nl, test) - needed to initialize Magento client
        
        Returns:
            Dict with is_complete (bool), message (str), and optionally suggested_start_date
        """
        # Validate table name
        valid_tables = ['uk_magento_data', 'fr_magento_data', 'nl_magento_data', 'test_magento_data']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Find the order(s) with the exact last_synced_date
            cursor.execute(f"""
                SELECT order_number, COUNT(*) as product_count
                FROM {table_name}
                WHERE created_at = %s
                GROUP BY order_number
            """, (last_synced_date,))
            
            orders_at_date = cursor.fetchall()
            
            if not orders_at_date:
                # No orders found at this date - this could mean:
                # 1. The sync was cancelled before saving anything
                # 2. The metadata date is wrong
                # Try to find the previous order date to resume from
                cursor.execute(f"""
                    SELECT MAX(created_at)
                    FROM {table_name}
                    WHERE created_at < %s
                """, (last_synced_date,))
                
                prev_date = cursor.fetchone()[0]
                
                if prev_date:
                    # Found previous orders, suggest starting from there
                    suggested_date = prev_date.strftime('%Y-%m-%d %H:%M:%S')
                    return {
                        'is_complete': False,
                        'message': f'No orders found at last synced date {last_synced_date}',
                        'suggested_start_date': suggested_date
                    }
                else:
                    # No previous orders at all - this is the first sync
                    # Let it proceed with the metadata date (might be stale but won't loop)
                    return {
                        'is_complete': True,
                        'message': 'No previous orders found - proceeding with first sync',
                        'suggested_start_date': None
                    }
            
            # Verify each order against Magento API to ensure all products are saved
            incomplete_orders = []
            
            # Initialize Magento client to fetch actual order data
            try:
                from .client import MagentoDataClient
                # Determine region from table name if not provided
                if not region:
                    if table_name == 'test_magento_data':
                        region = 'uk'  # Test uses UK connection
                    else:
                        region = table_name.replace('_magento_data', '')
                
                client = MagentoDataClient(region=region)
                
                for order_number, db_product_count in orders_at_date:
                    try:
                        # Fetch the order from Magento API using increment_id search
                        # Note: Cannot use /orders/{id} endpoint as we only have increment_id, not entity_id
                        search_params = {
                            'searchCriteria[filterGroups][0][filters][0][field]': 'increment_id',
                            'searchCriteria[filterGroups][0][filters][0][value]': order_number,
                            'searchCriteria[filterGroups][0][filters][0][conditionType]': 'eq'
                        }
                        search_result = client._make_request('orders', params=search_params)
                        orders = search_result.get('items', [])
                        
                        if not orders:
                            logger.warning(f"Order {order_number} not found in Magento API")
                            # Can't verify, assume complete to avoid blocking
                            continue
                        
                        # Should only be one order with this increment_id
                        order_data = orders[0]
                        
                        # Extract product rows to get actual count
                        actual_products = client._extract_product_rows(order_data)
                        actual_product_count = len(actual_products)
                        
                        # Compare database count with actual count
                        if db_product_count < actual_product_count:
                            logger.warning(
                                f"Order {order_number} incomplete: {db_product_count}/{actual_product_count} products saved"
                            )
                            incomplete_orders.append((order_number, db_product_count, actual_product_count))
                        elif db_product_count > actual_product_count:
                            # This shouldn't happen but log it
                            logger.warning(
                                f"Order {order_number} has MORE products in DB ({db_product_count}) than Magento ({actual_product_count})"
                            )
                    except Exception as e:
                        logger.warning(f"Could not verify order {order_number} against Magento API: {e}")
                        # If we can't verify via API, assume it's complete to avoid blocking
                        # The duplicate protection will handle any issues on re-sync
                        continue
                        
            except Exception as e:
                logger.warning(f"Could not initialize Magento client for verification: {e}")
                # Fall back to basic heuristic if API check fails
                for order_number, product_count in orders_at_date:
                    if product_count < 1:
                        incomplete_orders.append((order_number, product_count, 0))
            
            if incomplete_orders:
                # Found incomplete orders - suggest re-syncing from before this date
                cursor.execute(f"""
                    SELECT MAX(created_at)
                    FROM {table_name}
                    WHERE created_at < %s
                """, (last_synced_date,))
                
                prev_date = cursor.fetchone()[0]
                suggested_date = prev_date.strftime('%Y-%m-%d %H:%M:%S') if prev_date else None
                
                incomplete_details = ', '.join([
                    f"{order}({saved}/{total})" 
                    for order, saved, total in incomplete_orders
                ])
                
                return {
                    'is_complete': False,
                    'message': f'Found {len(incomplete_orders)} incomplete orders: {incomplete_details}',
                    'suggested_start_date': suggested_date
                }
            
            # All orders at this date are complete
            return {
                'is_complete': True,
                'message': f'Last sync verified: {len(orders_at_date)} orders with all products saved',
                'orders_checked': len(orders_at_date)
            }
            
        except Exception as e:
            logger.error(f"Error verifying order completeness: {e}")
            # On error, assume complete to avoid blocking sync
            return {
                'is_complete': True,
                'message': f'Could not verify completeness: {str(e)}'
            }
        finally:
            if conn:
                if 'cursor' in locals() and cursor:
                    cursor.close()
                return_products_connection(conn)
    
    def check_tables_exist(self) -> dict:
        """Check which tables exist"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            tables = ['uk_magento_data', 'fr_magento_data', 'nl_magento_data']
            status = {}
            
            for table_name in tables:
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = %s
                    )
                """, (table_name,))
                
                status[table_name] = cursor.fetchone()[0]
            
            return status
            
        except Exception as e:
            logger.error(f"Error checking tables: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_magento_data(self, table_name: str, limit: int = 100, offset: int = 0, search: str = "", fields: list = None) -> Dict[str, Any]:
        """Get magento data from a specific table with pagination, search, and optional field selection"""
        # Validate table name to prevent SQL injection
        valid_tables = ['uk_magento_data', 'fr_magento_data', 'nl_magento_data', 'test_magento_data']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")
        
        # Define all available columns
        all_columns = ['id', 'order_number', 'created_at', 'sku', 'name', 'qty', 'original_price', 'special_price', 'status', 
                      'currency', 'grand_total', 'customer_email', 'customer_full_name', 
                      'billing_address', 'shipping_address', 'customer_group_code',
                      'imported_at', 'updated_at']
        
        # Use specified fields or all columns
        if fields:
            # Validate and sanitize field names
            fields = [f.strip() for f in fields if f.strip() in all_columns]
            if not fields:
                fields = all_columns  # Fallback if no valid fields
            columns = fields
        else:
            columns = all_columns
        
        # Build SELECT clause with validated columns
        select_clause = ', '.join(columns)
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Build the query with optional search
            if search:
                search_pattern = f"%{search}%"
                count_query = f"""
                    SELECT COUNT(*) FROM {table_name}
                    WHERE order_number ILIKE %s 
                       OR sku ILIKE %s 
                       OR name ILIKE %s
                       OR status ILIKE %s
                       OR customer_email ILIKE %s
                       OR customer_full_name ILIKE %s
                """
                data_query = f"""
                    SELECT {select_clause}
                    FROM {table_name}
                    WHERE order_number ILIKE %s 
                       OR sku ILIKE %s 
                       OR name ILIKE %s
                       OR status ILIKE %s
                       OR customer_email ILIKE %s
                       OR customer_full_name ILIKE %s
                    ORDER BY imported_at DESC
                    LIMIT %s OFFSET %s
                """
                cursor.execute(count_query, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern))
                total_count = cursor.fetchone()[0]
                
                cursor.execute(data_query, (search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, search_pattern, limit, offset))
            else:
                count_query = f"SELECT COUNT(*) FROM {table_name}"
                data_query = f"""
                    SELECT {select_clause}
                    FROM {table_name}
                    ORDER BY imported_at DESC
                    LIMIT %s OFFSET %s
                """
                cursor.execute(count_query)
                total_count = cursor.fetchone()[0]
                
                cursor.execute(data_query, (limit, offset))
            
            # Fetch all rows
            rows = cursor.fetchall()
            
            data = []
            for row in rows:
                row_dict = {}
                for i, col in enumerate(columns):
                    value = row[i]
                    # Convert datetime to string for JSON serialization
                    if col in ['imported_at', 'updated_at'] and value:
                        row_dict[col] = value.isoformat() if hasattr(value, 'isoformat') else str(value)
                    else:
                        row_dict[col] = value
                data.append(row_dict)
            
            return {
                "data": data,
                "total_count": total_count,
                "limit": limit,
                "offset": offset
            }
            
        except Exception as e:
            logger.error(f"Error fetching data from {table_name}: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def import_csv_data(self, table_name: str, csv_content: str, filename: str = None, username: str = None) -> Dict[str, Any]:
        """
        Import CSV data into a specific magento table using column positions.
        NOTE: This method is deprecated. Use import_magento_product_rows() for live Magento data.
        """
        # Validate table name to prevent SQL injection
        valid_tables = ['uk_magento_data', 'fr_magento_data', 'nl_magento_data', 'test_magento_data']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")
        
        # Extract region from table name
        region = table_name.replace('_magento_data', '').upper()
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Parse CSV - read as list of rows instead of DictReader
            csv_file = io.StringIO(csv_content)
            reader = csv.reader(csv_file)
            
            rows_imported = 0
            errors = []
            
            # Skip header row
            try:
                next(reader)
            except StopIteration:
                return {
                    "rows_imported": 0,
                    "errors": ["CSV file is empty"],
                    "success": False
                }
            
            for row_num, row in enumerate(reader, start=2):  # Start at 2 because row 1 is header
                try:
                    # Expected column positions (0-indexed):
                    # 0: order_number
                    # 1: created_at
                    # 2: sku (Product SKU)
                    # 3: name (Product Name)
                    # 4: qty (Product Qty)
                    # 5: original_price (Original Product Price)
                    # 6: special_price (Special/Discounted Price)
                    # 7: status
                    # 8: currency
                    # 9: grand_total
                    # 10: customer_email
                    # 11: customer_full_name
                    # 12: billing_address
                    # 13: shipping_address
                    # 14: customer_group_code
                    
                    if len(row) < 15:
                        errors.append(f"Row {row_num}: Not enough columns (expected 15, got {len(row)})")
                        continue
                    
                    order_number = row[0].strip() if len(row) > 0 else ''
                    created_at = row[1].strip() if len(row) > 1 else ''
                    sku = row[2].strip() if len(row) > 2 else ''
                    name = row[3].strip() if len(row) > 3 else ''
                    qty_str = row[4].strip() if len(row) > 4 else '0'
                    original_price_str = row[5].strip() if len(row) > 5 else ''
                    special_price_str = row[6].strip() if len(row) > 6 else ''
                    status = row[7].strip() if len(row) > 7 else ''
                    currency = row[8].strip() if len(row) > 8 and row[8].strip() else None
                    grand_total_str = row[9].strip() if len(row) > 9 and row[9].strip() else ''
                    customer_email = row[10].strip() if len(row) > 10 and row[10].strip() else None
                    customer_full_name = row[11].strip() if len(row) > 11 and row[11].strip() else None
                    billing_address = row[12].strip() if len(row) > 12 and row[12].strip() else None
                    shipping_address = row[13].strip() if len(row) > 13 and row[13].strip() else None
                    customer_group_code = row[14].strip() if len(row) > 14 and row[14].strip() else None
                    
                    # Validate required fields
                    if not order_number or not sku:
                        errors.append(f"Row {row_num}: Missing order_number or SKU")
                        continue
                    
                    # Convert qty and prices to appropriate types
                    try:
                        qty = int(float(qty_str))
                    except (ValueError, TypeError):
                        qty = 0
                    
                    # Convert original_price - allow it to be None if empty
                    original_price = None
                    if original_price_str:
                        try:
                            original_price = float(original_price_str)
                        except (ValueError, TypeError):
                            pass
                    
                    # Convert special_price - allow it to be None if empty
                    special_price = None
                    if special_price_str:
                        try:
                            special_price = float(special_price_str)
                        except (ValueError, TypeError):
                            pass
                    
                    # Convert grand_total - allow it to be None if empty
                    grand_total = None
                    if grand_total_str:
                        try:
                            grand_total = float(grand_total_str)
                        except (ValueError, TypeError):
                            # If conversion fails, leave as None but don't fail the import
                            pass
                    
                    # Insert into database
                    insert_query = f"""
                        INSERT INTO {table_name} 
                        (order_number, created_at, sku, name, qty, original_price, special_price, status, currency, 
                         grand_total, customer_email, customer_full_name, billing_address, 
                         shipping_address, customer_group_code, imported_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                    now = datetime.now(timezone.utc)
                    cursor.execute(insert_query, (
                        order_number, created_at, sku, name, qty, original_price, special_price, status, currency, 
                        grand_total, customer_email, customer_full_name, billing_address, 
                        shipping_address, customer_group_code, now, now
                    ))
                    rows_imported += 1
                    
                except Exception as e:
                    errors.append(f"Row {row_num}: {str(e)}")
                    logger.error(f"Error importing row {row_num}: {e}")
            
            conn.commit()
            
            # Log to import_history
            import_status = "success" if rows_imported > 0 else "failed"
            errors_json = json.dumps(errors) if errors else None
            
            history_query = """
                INSERT INTO import_history 
                (region, filename, rows_imported, rows_failed, errors, imported_by, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(history_query, (
                region, 
                filename, 
                rows_imported, 
                len(errors), 
                errors_json, 
                username, 
                import_status
            ))
            conn.commit()
            
            return {
                "rows_imported": rows_imported,
                "errors": errors,
                "success": rows_imported > 0
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error importing CSV to {table_name}: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def import_magento_product_rows(self, table_name: str, product_rows: List[Dict[str, Any]], username: str = None) -> Dict[str, Any]:
        """
        Import product-level rows from Magento API into a specific magento table.
        
        This replaces the CSV import functionality with live Magento data.
        Each row represents a product from an order, with invoiced quantities.
        
        Args:
            table_name: The table to import into (uk_magento_data, fr_magento_data, nl_magento_data, test_magento_data)
            product_rows: List of product-level dictionaries from Magento API
            username: User performing the sync
        
        Returns:
            Dict with rows_imported, errors, and success status
        """
        # Validate table name to prevent SQL injection
        valid_tables = ['uk_magento_data', 'fr_magento_data', 'nl_magento_data', 'test_magento_data']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")
        
        # Extract region from table name (or use TEST for test table)
        if table_name == 'test_magento_data':
            region = 'TEST'
        else:
            region = table_name.replace('_magento_data', '').upper()
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            rows_imported = 0
            errors = []
            
            for idx, row in enumerate(product_rows, start=1):
                try:
                    order_number = row.get('order_number', '').strip()
                    created_at = row.get('created_at', '').strip()
                    sku = row.get('sku', '').strip()
                    name = row.get('name', '').strip()
                    qty = int(row.get('qty', 0))
                    original_price = row.get('original_price')
                    special_price = row.get('special_price')
                    status = row.get('status', '').strip()
                    currency = row.get('currency')
                    grand_total = row.get('grand_total')
                    customer_email = row.get('customer_email')
                    customer_full_name = row.get('customer_full_name')
                    billing_address = row.get('billing_address')
                    shipping_address = row.get('shipping_address')
                    customer_group_code = row.get('customer_group_code')
                    
                    # Validate required fields
                    if not order_number or not sku:
                        errors.append(f"Row {idx}: Missing order_number or SKU")
                        continue
                    
                    # Insert or update on conflict to handle status/qty changes
                    insert_query = f"""
                        INSERT INTO {table_name} 
                        (order_number, created_at, sku, name, qty, original_price, special_price, status, currency, 
                         grand_total, customer_email, customer_full_name, billing_address, 
                         shipping_address, customer_group_code, imported_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (order_number, sku) DO UPDATE SET
                            qty = EXCLUDED.qty,
                            status = EXCLUDED.status,
                            updated_at = EXCLUDED.updated_at
                    """
                    now = datetime.now(timezone.utc)
                    cursor.execute(insert_query, (
                        order_number, created_at, sku, name, qty, original_price, special_price, status, currency, 
                        grand_total, customer_email, customer_full_name, billing_address, 
                        shipping_address, customer_group_code, now, now
                    ))
                    # Count as imported if a row was inserted or updated
                    if cursor.rowcount > 0:
                        rows_imported += 1
                    
                except Exception as e:
                    errors.append(f"Row {idx}: {str(e)}")
                    logger.error(f"Error importing product row {idx}: {e}")
            
            conn.commit()
            
            # Log to import_history
            # Consider it a success if we processed rows without errors, even if all were duplicates
            import_status = "success" if len(errors) == 0 else "failed"
            errors_json = json.dumps(errors) if errors else None
            
            history_query = """
                INSERT INTO import_history 
                (region, filename, rows_imported, rows_failed, errors, imported_by, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(history_query, (
                region, 
                "Magento API Sync",  # Use this as filename for API syncs
                rows_imported, 
                len(errors), 
                errors_json, 
                username, 
                import_status
            ))
            conn.commit()
            
            return {
                "rows_imported": rows_imported,
                "rows_processed": len(product_rows),
                "rows_skipped": len(product_rows) - rows_imported - len(errors),
                "errors": errors,
                "success": True  # Always true if no exceptions - duplicates are OK
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error importing Magento product rows to {table_name}: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def import_batch_with_metadata(
        self, 
        table_name: str, 
        product_rows: List[Dict[str, Any]], 
        region: str,
        last_order_date: str,
        orders_count: int,
        username: str = None
    ) -> Dict[str, Any]:
        """
        Atomically import product rows AND update sync metadata in a single transaction.
        
        This ensures that if the import succeeds, the metadata is always updated,
        preventing infinite loops where data commits but metadata doesn't.
        
        Args:
            table_name: The table to import into
            product_rows: List of product dictionaries
            region: Region code for metadata (uk, fr, nl, test)
            last_order_date: The created_at timestamp of the most recent order in this batch
            orders_count: Number of orders in this batch
            username: User performing the sync
        
        Returns:
            Dict with rows_imported, errors, and success status
        """
        # Validate table name
        valid_tables = ['uk_magento_data', 'fr_magento_data', 'nl_magento_data', 'test_magento_data']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")
        
        # Validate required parameters
        if not last_order_date:
            raise ValueError("last_order_date is required")
        
        if not isinstance(product_rows, list):
            raise ValueError("product_rows must be a list")
        
        # Extract region from table name if not provided
        if not region:
            if table_name == 'test_magento_data':
                region = 'test'
            else:
                region = table_name.replace('_magento_data', '')
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            rows_imported = 0
            errors = []
            
            # Import all product rows
            for idx, row in enumerate(product_rows, start=1):
                try:
                    order_number = row.get('order_number', '').strip()
                    created_at = row.get('created_at', '').strip()
                    sku = row.get('sku', '').strip()
                    name = row.get('name', '').strip()
                    qty = int(row.get('qty', 0))
                    original_price = row.get('original_price')
                    special_price = row.get('special_price')
                    status = row.get('status', '').strip()
                    currency = row.get('currency')
                    grand_total = row.get('grand_total')
                    customer_email = row.get('customer_email')
                    customer_full_name = row.get('customer_full_name')
                    billing_address = row.get('billing_address')
                    shipping_address = row.get('shipping_address')
                    customer_group_code = row.get('customer_group_code')
                    
                    if not order_number or not sku:
                        errors.append(f"Row {idx}: Missing order_number or SKU")
                        continue
                    
                    insert_query = f"""
                        INSERT INTO {table_name} 
                        (order_number, created_at, sku, name, qty, original_price, special_price, status, currency, 
                         grand_total, customer_email, customer_full_name, billing_address, 
                         shipping_address, customer_group_code, imported_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (order_number, sku) DO UPDATE SET
                            qty = EXCLUDED.qty,
                            status = EXCLUDED.status,
                            updated_at = EXCLUDED.updated_at
                    """
                    now = datetime.now(timezone.utc)
                    cursor.execute(insert_query, (
                        order_number, created_at, sku, name, qty, original_price, special_price, status, currency, 
                        grand_total, customer_email, customer_full_name, billing_address, 
                        shipping_address, customer_group_code, now, now
                    ))
                    if cursor.rowcount > 0:
                        rows_imported += 1
                    
                except Exception as e:
                    errors.append(f"Row {idx}: {str(e)}")
                    logger.error(f"Error importing product row {idx}: {e}")
            
            # Update sync metadata in the SAME transaction
            if isinstance(last_order_date, str):
                last_order_timestamp = datetime.fromisoformat(last_order_date.replace(' ', 'T'))
            else:
                last_order_timestamp = last_order_date
            
            cursor.execute("""
                INSERT INTO magento_sync_metadata 
                (region, last_synced_order_date, last_sync_time, total_orders_synced, 
                 total_rows_synced, last_synced_by, updated_at)
                VALUES (%s, %s, NOW(), %s, %s, %s, NOW())
                ON CONFLICT (region) 
                DO UPDATE SET
                    last_synced_order_date = EXCLUDED.last_synced_order_date,
                    last_sync_time = NOW(),
                    total_orders_synced = magento_sync_metadata.total_orders_synced + EXCLUDED.total_orders_synced,
                    total_rows_synced = magento_sync_metadata.total_rows_synced + EXCLUDED.total_rows_synced,
                    last_synced_by = EXCLUDED.last_synced_by,
                    updated_at = NOW()
            """, (region.lower(), last_order_timestamp, orders_count, rows_imported, username))
            
            # Log to import_history
            import_status = "success" if len(errors) == 0 else "failed"
            errors_json = json.dumps(errors) if errors else None
            
            if table_name == 'test_magento_data':
                history_region = 'TEST'
            else:
                history_region = table_name.replace('_magento_data', '').upper()
            
            history_query = """
                INSERT INTO import_history 
                (region, filename, rows_imported, rows_failed, errors, imported_by, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """
            cursor.execute(history_query, (
                history_region,
                "Magento API Sync",
                rows_imported, 
                len(errors), 
                errors_json, 
                username, 
                import_status
            ))
            
            # SINGLE COMMIT - atomically commits product rows, metadata, and history
            conn.commit()
            
            logger.info(
                f"Atomically committed {rows_imported} rows and metadata for {region}: "
                f"last order {last_order_date}"
            )
            
            return {
                "rows_imported": rows_imported,
                "rows_processed": len(product_rows),
                "rows_skipped": len(product_rows) - rows_imported - len(errors),
                "errors": errors,
                "success": True
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error in atomic batch import for {table_name}: {e}")
            raise
        finally:
            if conn:
                if 'cursor' in locals() and cursor:
                    cursor.close()
                return_products_connection(conn)
    
    def refresh_condensed_data(self, region: str) -> Dict[str, Any]:
        """
        Refresh condensed magento data for a region.
        Aggregates last 6 months of data by SKU, summing quantities.
        Uses sku_aliases table to combine related SKUs under their unified_sku.
        Applies currency conversion when filtering by grand_total threshold.
        """
        from common.currency import convert_to_gbp, convert_to_eur
        
        # Map region to table names and base currency
        region_mapping = {
            'uk': ('uk_magento_data', 'uk_condensed_magento', 'GBP', convert_to_gbp),
            'fr': ('fr_magento_data', 'fr_condensed_magento', 'EUR', convert_to_eur),
            'nl': ('nl_magento_data', 'nl_condensed_magento', 'EUR', convert_to_eur)
        }
        
        if region not in region_mapping:
            raise ValueError(f"Invalid region: {region}")
        
        magento_table, condensed_table, base_currency, converter_func = region_mapping[region]
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Clear existing condensed data
            cursor.execute(f"DELETE FROM {condensed_table}")
            
            # Get the thresholds for this region (if set)
            cursor.execute("""
                SELECT threshold, qty_threshold FROM condensed_magento_grand_total_threshold 
                WHERE region = %s
            """, (region,))
            threshold_row = cursor.fetchone()
            grand_total_threshold = threshold_row[0] if threshold_row else None
            qty_threshold = threshold_row[1] if threshold_row and len(threshold_row) > 1 else None
            
            logger.info(f"Refreshing {region} condensed data with threshold: {grand_total_threshold} {base_currency}, qty_threshold: {qty_threshold}")
            
            # Fetch all magento data from last 6 months with SKU aliases
            # We'll filter in Python to apply currency conversion
            fetch_query = f"""
                SELECT 
                    COALESCE(
                        sa.unified_sku,
                        CASE 
                            WHEN s.sku ~* '-MD(-|$)' THEN REGEXP_REPLACE(s.sku, '-MD(-.*)?$', '', 'i')
                            ELSE s.sku
                        END
                    ) as sku,
                    s.name,
                    s.qty,
                    s.grand_total,
                    s.currency,
                    s.customer_email,
                    s.customer_group_code,
                    s.created_at
                FROM {magento_table} s
                LEFT JOIN sku_aliases sa ON s.sku = sa.alias_sku
                WHERE 
                    -- Try to parse created_at as various date formats and check if within 6 months
                    (
                        -- Try ISO format: YYYY-MM-DD or YYYY-MM-DD HH:MI:SS
                        (s.created_at ~ '^[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}' AND 
                         TO_TIMESTAMP(s.created_at, 'YYYY-MM-DD HH24:MI:SS') >= CURRENT_DATE - INTERVAL '6 months')
                        OR
                        -- Try DD/MM/YYYY format
                        (s.created_at ~ '^[0-9]{{2}}/[0-9]{{2}}/[0-9]{{4}}' AND 
                         TO_DATE(s.created_at, 'DD/MM/YYYY') >= CURRENT_DATE - INTERVAL '6 months')
                        OR
                        -- Try MM/DD/YYYY format
                        (s.created_at ~ '^[0-9]{{2}}/[0-9]{{2}}/[0-9]{{4}}' AND 
                         TO_DATE(s.created_at, 'MM/DD/YYYY') >= CURRENT_DATE - INTERVAL '6 months')
                        OR
                        -- If can't parse, include it (better to include than exclude)
                        NOT (s.created_at ~ '^[0-9]')
                    )
            """
            
            cursor.execute(fetch_query)
            all_rows = cursor.fetchall()
            
            # Get excluded customers
            cursor.execute("""
                SELECT customer_email FROM condensed_magento_excluded_customers
                WHERE region = %s
            """, (region,))
            excluded_emails = {row[0] for row in cursor.fetchall()}
            
            # Get excluded customer groups
            cursor.execute("""
                SELECT customer_group FROM condensed_magento_excluded_customer_groups
                WHERE region = %s
            """, (region,))
            excluded_groups = {row[0] for row in cursor.fetchall()}
            
            # Filter and aggregate in Python with currency conversion
            sku_aggregates = {}
            filtered_count = 0
            
            for row in all_rows:
                sku, name, qty, grand_total, currency, customer_email, customer_group, created_at = row
                
                # Skip excluded customers
                if customer_email in excluded_emails:
                    continue
                
                # Skip excluded customer groups
                if customer_group in excluded_groups:
                    continue
                
                # Apply quantity threshold filter
                if qty_threshold is not None and qty is not None and qty > qty_threshold:
                    filtered_count += 1
                    continue
                
                # Apply grand total threshold filter with currency conversion
                if grand_total_threshold is not None and grand_total is not None:
                    # Convert grand_total to base currency for comparison
                    converted_total = converter_func(float(grand_total), currency or base_currency)
                    if converted_total > float(grand_total_threshold):
                        filtered_count += 1
                        continue
                
                # Aggregate by SKU
                if sku not in sku_aggregates:
                    sku_aggregates[sku] = {'name': name, 'total_qty': 0}
                sku_aggregates[sku]['total_qty'] += (qty or 0)
                sku_aggregates[sku]['name'] = name  # Keep the latest name
            
            # Insert aggregated data
            if sku_aggregates:
                insert_query = f"""
                    INSERT INTO {condensed_table} (sku, name, total_qty, last_updated)
                    VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                """
                
                insert_data = [
                    (sku, data['name'], data['total_qty'])
                    for sku, data in sku_aggregates.items()
                ]
                
                cursor.executemany(insert_query, insert_data)
            
            rows_affected = len(sku_aggregates)
            
            conn.commit()
            
            logger.info(f"✅ Refreshed {condensed_table}: {rows_affected} SKUs aggregated (filtered {filtered_count} orders with thresholds)")
            
            return {
                "success": True,
                "rows_aggregated": rows_affected,
                "table": condensed_table
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error refreshing condensed data for {region}: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_condensed_data(self, region: str, limit: int = 100, offset: int = 0, search: str = "") -> Dict[str, Any]:
        """Get condensed magento data for a specific region"""
        # Map region to condensed table
        region_mapping = {
            'uk': 'uk_condensed_magento',
            'fr': 'fr_condensed_magento',
            'nl': 'nl_condensed_magento'
        }
        
        if region not in region_mapping:
            raise ValueError(f"Invalid region: {region}")
        
        condensed_table = region_mapping[region]
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Build query with optional search
            if search:
                search_pattern = f"%{search}%"
                count_query = f"""
                    SELECT COUNT(*) FROM {condensed_table}
                    WHERE sku ILIKE %s OR name ILIKE %s
                """
                data_query = f"""
                    SELECT id, sku, name, total_qty, last_updated
                    FROM {condensed_table}
                    WHERE sku ILIKE %s OR name ILIKE %s
                    ORDER BY total_qty DESC
                    LIMIT %s OFFSET %s
                """
                cursor.execute(count_query, (search_pattern, search_pattern))
                total_count = cursor.fetchone()[0]
                
                cursor.execute(data_query, (search_pattern, search_pattern, limit, offset))
            else:
                count_query = f"SELECT COUNT(*) FROM {condensed_table}"
                data_query = f"""
                    SELECT id, sku, name, total_qty, last_updated
                    FROM {condensed_table}
                    ORDER BY total_qty DESC
                    LIMIT %s OFFSET %s
                """
                cursor.execute(count_query)
                total_count = cursor.fetchone()[0]
                
                cursor.execute(data_query, (limit, offset))
            
            # Fetch all rows
            columns = ['id', 'sku', 'name', 'total_qty', 'last_updated']
            rows = cursor.fetchall()
            
            data = []
            for row in rows:
                row_dict = {}
                for i, col in enumerate(columns):
                    value = row[i]
                    # Convert datetime to string for JSON serialization
                    if col == 'last_updated' and value:
                        row_dict[col] = value.isoformat() if hasattr(value, 'isoformat') else str(value)
                    else:
                        row_dict[col] = value
                data.append(row_dict)
            
            return {
                "data": data,
                "total_count": total_count,
                "limit": limit,
                "offset": offset
            }
            
        except Exception as e:
            logger.error(f"Error fetching condensed data from {condensed_table}: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_condensed_data_custom_range(self, region: str, range_type: str, range_value: str, 
                                       use_exclusions: bool, limit: int = 100, offset: int = 0, 
                                       search: str = "") -> Dict[str, Any]:
        """
        Get condensed magento data with custom date range.
        Aggregates data on-the-fly based on the specified date range.
        
        Args:
            region: 'uk', 'fr', or 'nl'
            range_type: 'days', 'months', or 'since'
            range_value: Number of days/months, or date string (YYYY-MM-DD)
            use_exclusions: Whether to apply customer/group exclusions
            limit: Max results to return
            offset: Pagination offset
            search: Optional SKU/name search filter
        """
        from common.currency import convert_to_gbp, convert_to_eur
        from datetime import datetime, timedelta
        
        # Map region to table names and base currency
        region_mapping = {
            'uk': ('uk_magento_data', 'GBP', convert_to_gbp),
            'fr': ('fr_magento_data', 'EUR', convert_to_eur),
            'nl': ('nl_magento_data', 'EUR', convert_to_eur)
        }
        
        if region not in region_mapping:
            raise ValueError(f"Invalid region: {region}")
        
        magento_table, base_currency, converter_func = region_mapping[region]
        
        # Calculate the date threshold based on range_type
        if range_type == 'days':
            try:
                days = int(range_value)
                date_threshold = datetime.now().date() - timedelta(days=days)
            except ValueError:
                raise ValueError(f"Invalid days value: {range_value}")
        elif range_type == 'months':
            try:
                months = int(range_value)
                date_threshold = datetime.now().date() - timedelta(days=months * 30)  # Approximate
            except ValueError:
                raise ValueError(f"Invalid months value: {range_value}")
        elif range_type == 'since':
            try:
                date_threshold = datetime.strptime(range_value, '%Y-%m-%d').date()
            except ValueError:
                raise ValueError(f"Invalid date format: {range_value}. Expected YYYY-MM-DD")
        else:
            raise ValueError(f"Invalid range_type: {range_type}")
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Get exclusions if requested
            excluded_emails = set()
            excluded_groups = set()
            if use_exclusions:
                cursor.execute("""
                    SELECT customer_email FROM condensed_magento_excluded_customers
                    WHERE region = %s
                """, (region,))
                excluded_emails = {row[0] for row in cursor.fetchall()}
                
                cursor.execute("""
                    SELECT customer_group FROM condensed_magento_excluded_customer_groups
                    WHERE region = %s
                """, (region,))
                excluded_groups = {row[0] for row in cursor.fetchall()}
            
            # Get the thresholds for this region (if set)
            cursor.execute("""
                SELECT threshold, qty_threshold FROM condensed_magento_grand_total_threshold 
                WHERE region = %s
            """, (region,))
            threshold_row = cursor.fetchone()
            grand_total_threshold = threshold_row[0] if threshold_row else None
            qty_threshold = threshold_row[1] if threshold_row and len(threshold_row) > 1 else None
            
            # Fetch magento data with SKU aliases for the custom date range
            fetch_query = f"""
                SELECT 
                    COALESCE(
                        sa.unified_sku,
                        CASE 
                            WHEN s.sku ~* '-MD(-|$)' THEN REGEXP_REPLACE(s.sku, '-MD(-.*)?$', '', 'i')
                            ELSE s.sku
                        END
                    ) as sku,
                    s.name,
                    s.qty,
                    s.grand_total,
                    s.currency,
                    s.customer_email,
                    s.customer_group_code,
                    s.created_at
                FROM {magento_table} s
                LEFT JOIN sku_aliases sa ON s.sku = sa.alias_sku
                WHERE 
                    (
                        -- Try ISO format: YYYY-MM-DD or YYYY-MM-DD HH:MI:SS
                        (s.created_at ~ '^[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}}' AND 
                         CASE 
                            WHEN s.created_at ~ '^[0-9]{{4}}-[0-9]{{2}}-[0-9]{{2}} ' 
                            THEN TO_TIMESTAMP(s.created_at, 'YYYY-MM-DD HH24:MI:SS')::date >= %s
                            ELSE TO_DATE(s.created_at, 'YYYY-MM-DD') >= %s
                         END)
                        OR
                        -- Try DD/MM/YYYY format
                        (s.created_at ~ '^[0-9]{{2}}/[0-9]{{2}}/[0-9]{{4}}' AND 
                         TO_DATE(s.created_at, 'DD/MM/YYYY') >= %s)
                        OR
                        -- Try MM/DD/YYYY format (fallback for ambiguous dates)
                        (s.created_at ~ '^[0-9]{{2}}/[0-9]{{2}}/[0-9]{{4}}' AND 
                         TO_DATE(s.created_at, 'MM/DD/YYYY') >= %s)
                    )
            """
            
            cursor.execute(fetch_query, (date_threshold, date_threshold, date_threshold, date_threshold))
            all_rows = cursor.fetchall()
            
            # Filter and aggregate in Python with currency conversion
            sku_aggregates = {}
            
            for row in all_rows:
                sku, name, qty, grand_total, currency, customer_email, customer_group, created_at = row
                
                # Skip excluded customers
                if use_exclusions and customer_email in excluded_emails:
                    continue
                
                # Skip excluded customer groups
                if use_exclusions and customer_group in excluded_groups:
                    continue
                
                # Apply quantity threshold filter
                if qty_threshold is not None and qty is not None and qty > qty_threshold:
                    continue
                
                # Apply grand total threshold filter with currency conversion
                if grand_total_threshold is not None and grand_total is not None:
                    converted_total = converter_func(float(grand_total), currency or base_currency)
                    if converted_total > float(grand_total_threshold):
                        continue
                
                # Aggregate by SKU
                if sku not in sku_aggregates:
                    sku_aggregates[sku] = {'name': name, 'total_qty': 0}
                sku_aggregates[sku]['total_qty'] += (qty or 0)
                sku_aggregates[sku]['name'] = name  # Keep the latest name
            
            # Convert to list and sort by total_qty
            aggregated_list = [
                {'sku': sku, 'name': data['name'], 'total_qty': data['total_qty']}
                for sku, data in sku_aggregates.items()
            ]
            aggregated_list.sort(key=lambda x: x['total_qty'], reverse=True)
            
            # Apply search filter if provided
            if search:
                search_lower = search.lower()
                aggregated_list = [
                    item for item in aggregated_list
                    if search_lower in item['sku'].lower() or search_lower in item['name'].lower()
                ]
            
            total_count = len(aggregated_list)
            
            # Apply pagination
            paginated_data = aggregated_list[offset:offset + limit]
            
            # Add IDs for consistency with regular condensed data
            for i, item in enumerate(paginated_data):
                item['id'] = offset + i + 1
                item['last_updated'] = datetime.now().isoformat()
            
            return {
                "data": paginated_data,
                "total_count": total_count,
                "limit": limit,
                "offset": offset
            }
            
        except Exception as e:
            logger.error(f"Error fetching custom range data for {region}: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_sku_aliases(self) -> List[Dict[str, Any]]:
        """Get all SKU aliases"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT id, alias_sku, unified_sku, created_at
                FROM sku_aliases
                ORDER BY unified_sku, alias_sku
            """)
            
            columns = ['id', 'alias_sku', 'unified_sku', 'created_at']
            rows = cursor.fetchall()
            
            data = []
            for row in rows:
                row_dict = {}
                for i, col in enumerate(columns):
                    value = row[i]
                    if col == 'created_at' and value:
                        row_dict[col] = value.isoformat() if hasattr(value, 'isoformat') else str(value)
                    else:
                        row_dict[col] = value
                data.append(row_dict)
            
            return data
            
        except Exception as e:
            logger.error(f"Error fetching SKU aliases: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def add_sku_alias(self, alias_sku: str, unified_sku: str) -> Dict[str, Any]:
        """Add a new SKU alias mapping"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Check if alias already exists
            cursor.execute("SELECT id FROM sku_aliases WHERE alias_sku = %s", (alias_sku,))
            if cursor.fetchone():
                raise ValueError(f"Alias SKU '{alias_sku}' already exists")
            
            # Insert new alias
            cursor.execute("""
                INSERT INTO sku_aliases (alias_sku, unified_sku)
                VALUES (%s, %s)
                RETURNING id
            """, (alias_sku, unified_sku))
            
            alias_id = cursor.fetchone()[0]
            conn.commit()
            
            logger.info(f"✅ Added SKU alias: {alias_sku} → {unified_sku}")
            
            return {
                "success": True,
                "id": alias_id,
                "alias_sku": alias_sku,
                "unified_sku": unified_sku
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error adding SKU alias: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def delete_sku_alias(self, alias_id: int) -> Dict[str, Any]:
        """Delete a SKU alias mapping"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("DELETE FROM sku_aliases WHERE id = %s", (alias_id,))
            
            if cursor.rowcount == 0:
                raise ValueError(f"SKU alias with id {alias_id} not found")
            
            conn.commit()
            
            logger.info(f"✅ Deleted SKU alias with id: {alias_id}")
            
            return {
                "success": True,
                "deleted_id": alias_id
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error deleting SKU alias: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_import_history(self, limit: int = 100, offset: int = 0, region: str = None) -> Dict[str, Any]:
        """Get import history with pagination and optional region filter"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Build query with optional region filter
            where_clause = "WHERE region = %s" if region else ""
            params = [region] if region else []
            
            # Get total count
            count_query = f"SELECT COUNT(*) FROM import_history {where_clause}"
            cursor.execute(count_query, params)
            total_count = cursor.fetchone()[0]
            
            # Get paginated data
            query = f"""
                SELECT id, region, filename, rows_imported, rows_failed, errors, 
                       imported_by, imported_at, status
                FROM import_history
                {where_clause}
                ORDER BY imported_at DESC
                LIMIT %s OFFSET %s
            """
            params.extend([limit, offset])
            cursor.execute(query, params)
            
            columns = [desc[0] for desc in cursor.description]
            data = []
            for row in cursor.fetchall():
                row_dict = dict(zip(columns, row))
                # Convert datetime to string
                if row_dict.get('imported_at'):
                    row_dict['imported_at'] = row_dict['imported_at'].isoformat() if hasattr(row_dict['imported_at'], 'isoformat') else str(row_dict['imported_at'])
                # Parse errors JSON if present
                if row_dict.get('errors'):
                    try:
                        row_dict['errors'] = json.loads(row_dict['errors'])
                    except (json.JSONDecodeError, TypeError):
                        # Keep as string if JSON parsing fails
                        pass
                data.append(row_dict)
            
            return {
                "data": data,
                "total_count": total_count,
                "limit": limit,
                "offset": offset
            }
            
        except Exception as e:
            logger.error(f"Error fetching import history: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)

    def auto_create_md_variant_aliases(self) -> Dict[str, Any]:
        """
        Automatically create SKU aliases for MD variants to merge with their base SKUs.
        For example: PROD123-MD -> PROD123, PROD123-MD-1225 -> PROD123, so magento data gets combined.
        """
        import re
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Get all unique SKUs from all magento tables that have -MD or -MD-xxxx patterns
            tables = ['uk_magento_data', 'fr_magento_data', 'nl_magento_data']
            md_skus = set()
            base_skus = set()
            
            # Regex pattern to match -MD or -MD-xxxx (case-insensitive)
            md_pattern = re.compile(r'-MD(-.*)?$', re.IGNORECASE)
            
            for table in tables:
                # Check if table exists first
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = %s
                    )
                """, (table,))
                
                if not cursor.fetchone()[0]:
                    continue
                
                # Get SKUs from this table
                cursor.execute(f"SELECT DISTINCT sku FROM {table} WHERE sku IS NOT NULL AND sku != ''")
                for row in cursor.fetchall():
                    sku = str(row[0]).strip()
                    if md_pattern.search(sku):
                        md_skus.add(sku)
                        # Calculate the base SKU by removing -MD or -MD-xxxx suffix
                        base_sku = md_pattern.sub('', sku)
                        base_skus.add(base_sku)
                    else:
                        base_skus.add(sku)
            
            if not md_skus:
                logger.info("No MD variant SKUs found to create aliases for")
                return {
                    "success": True,
                    "message": "No MD variants found",
                    "aliases_created": 0,
                    "aliases_skipped": 0
                }
            
            logger.info(f"Found {len(md_skus)} MD variant SKUs: {list(md_skus)[:5]}...")  # Show first 5
            
            aliases_created = 0
            aliases_skipped = 0
            
            for md_sku in md_skus:
                # Remove -MD or -MD-xxxx suffix to get base SKU
                base_sku = md_pattern.sub('', md_sku)
                
                logger.debug(f"Processing MD SKU: {md_sku} -> base: {base_sku}, base exists: {base_sku in base_skus}")
                
                # Only create alias if base SKU also exists in the data
                if base_sku in base_skus:
                    # Check if MD variant alias already exists
                    cursor.execute("SELECT 1 FROM sku_aliases WHERE alias_sku = %s", (md_sku,))
                    if cursor.fetchone():
                        aliases_skipped += 1
                        continue
                    
                    # Check if the base SKU already has an alias mapping (is already an alias_sku)
                    cursor.execute("SELECT unified_sku FROM sku_aliases WHERE alias_sku = %s", (base_sku,))
                    base_alias_result = cursor.fetchone()
                    
                    if base_alias_result:
                        # Base SKU is already aliased to something else, use that unified SKU
                        unified_sku = base_alias_result[0]
                        logger.info(f"Base SKU {base_sku} already aliases to {unified_sku}, using that for MD variant")
                    else:
                        # Check if the base SKU is already used as a unified_sku by other aliases
                        cursor.execute("SELECT COUNT(*) FROM sku_aliases WHERE unified_sku = %s", (base_sku,))
                        base_as_unified_count = cursor.fetchone()[0]
                        
                        if base_as_unified_count > 0:
                            # Base SKU is already a unified target, use it
                            unified_sku = base_sku
                        else:
                            # Neither scenario applies, use base SKU as the unified target
                            unified_sku = base_sku
                    
                    # Create the alias: MD variant -> unified SKU
                    cursor.execute("""
                        INSERT INTO sku_aliases (alias_sku, unified_sku)
                        VALUES (%s, %s)
                    """, (md_sku, unified_sku))
                    
                    aliases_created += 1
                    logger.info(f"Created alias: {md_sku} → {unified_sku}")
                else:
                    # MD variant exists but no base SKU found
                    aliases_skipped += 1
                    logger.debug(f"Skipped {md_sku} - no base SKU {base_sku} found")
            
            conn.commit()
            
            logger.info(f"✅ Auto-created {aliases_created} MD variant aliases, skipped {aliases_skipped}")
            
            return {
                "success": True,
                "message": f"Created {aliases_created} MD variant aliases",
                "aliases_created": aliases_created,
                "aliases_skipped": aliases_skipped
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error auto-creating MD variant aliases: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)

    # ===== CONDENSED MAGENTO FILTER METHODS =====
    
    def search_customers(self, region: str, search_term: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Search for customers by email or name in magento data"""
        region_mapping = {
            'uk': 'uk_magento_data',
            'fr': 'fr_magento_data',
            'nl': 'nl_magento_data'
        }
        
        if region not in region_mapping:
            raise ValueError(f"Invalid region: {region}")
        
        table_name = region_mapping[region]
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            search_pattern = f"%{search_term}%"
            
            query = f"""
                SELECT DISTINCT 
                    customer_email,
                    customer_full_name
                FROM {table_name}
                WHERE 
                    (customer_email ILIKE %s OR customer_full_name ILIKE %s)
                    AND customer_email IS NOT NULL
                    AND customer_email != ''
                ORDER BY customer_email
                LIMIT %s
            """
            
            cursor.execute(query, (search_pattern, search_pattern, limit))
            rows = cursor.fetchall()
            
            customers = []
            for row in rows:
                customers.append({
                    "email": row[0],
                    "full_name": row[1] or ""
                })
            
            return customers
            
        except Exception as e:
            logger.error(f"Error searching customers: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_excluded_customers(self, region: str) -> List[Dict[str, Any]]:
        """Get list of excluded customers for a region"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            query = """
                SELECT 
                    id, customer_email, customer_full_name, 
                    added_by, added_at
                FROM condensed_magento_excluded_customers
                WHERE region = %s
                ORDER BY customer_email
            """
            
            cursor.execute(query, (region,))
            rows = cursor.fetchall()
            
            customers = []
            for row in rows:
                customers.append({
                    "id": row[0],
                    "email": row[1],
                    "full_name": row[2] or "",
                    "added_by": row[3],
                    "added_at": row[4].isoformat() if row[4] else None
                })
            
            return customers
            
        except Exception as e:
            logger.error(f"Error getting excluded customers: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def add_excluded_customer(self, region: str, email: str, full_name: str, username: str) -> Dict[str, Any]:
        """Add a customer to the exclusion list"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO condensed_magento_excluded_customers 
                (region, customer_email, customer_full_name, added_by)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (region, customer_email) DO NOTHING
                RETURNING id
            """, (region, email, full_name, username))
            
            result = cursor.fetchone()
            conn.commit()
            
            if result:
                return {
                    "success": True,
                    "message": f"Customer {email} added to exclusion list",
                    "id": result[0]
                }
            else:
                return {
                    "success": False,
                    "message": f"Customer {email} already in exclusion list"
                }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error adding excluded customer: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def remove_excluded_customer(self, customer_id: int) -> Dict[str, Any]:
        """Remove a customer from the exclusion list"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                DELETE FROM condensed_magento_excluded_customers 
                WHERE id = %s
                RETURNING customer_email
            """, (customer_id,))
            
            result = cursor.fetchone()
            conn.commit()
            
            if result:
                return {
                    "success": True,
                    "message": f"Customer {result[0]} removed from exclusion list"
                }
            else:
                return {
                    "success": False,
                    "message": "Customer not found"
                }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error removing excluded customer: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_grand_total_threshold(self, region: str) -> Optional[float]:
        """Get the grand total threshold for a region"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT threshold FROM condensed_magento_grand_total_threshold
                WHERE region = %s
            """, (region,))
            
            result = cursor.fetchone()
            return float(result[0]) if result else None
            
        except Exception as e:
            logger.error(f"Error getting grand total threshold: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def set_grand_total_threshold(self, region: str, threshold: float, username: str) -> Dict[str, Any]:
        """Set the grand total threshold for a region"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO condensed_magento_grand_total_threshold 
                (region, threshold, updated_by, updated_at)
                VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (region) 
                DO UPDATE SET 
                    threshold = EXCLUDED.threshold,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id
            """, (region, threshold, username))
            
            conn.commit()
            
            return {
                "success": True,
                "message": f"Grand total threshold set to {threshold} for {region.upper()}"
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error setting grand total threshold: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_qty_threshold(self, region: str) -> Optional[int]:
        """Get the quantity threshold for a region"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT qty_threshold FROM condensed_magento_grand_total_threshold
                WHERE region = %s
            """, (region,))
            
            result = cursor.fetchone()
            return int(result[0]) if result and result[0] is not None else None
            
        except Exception as e:
            logger.error(f"Error getting qty threshold: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def set_qty_threshold(self, region: str, qty_threshold: int, username: str) -> Dict[str, Any]:
        """Set the quantity threshold for a region"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO condensed_magento_grand_total_threshold 
                (region, qty_threshold, updated_by, updated_at)
                VALUES (%s, %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (region) 
                DO UPDATE SET 
                    qty_threshold = EXCLUDED.qty_threshold,
                    updated_by = EXCLUDED.updated_by,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING id
            """, (region, qty_threshold, username))
            
            conn.commit()
            
            return {
                "success": True,
                "message": f"Quantity threshold set to {qty_threshold} for {region.upper()}"
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error setting qty threshold: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_customer_groups(self, region: str) -> List[str]:
        """Get all distinct customer groups for a region"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            table_name = f"{region.lower()}_magento_data"
            query = f"""
                SELECT DISTINCT customer_group_code 
                FROM {table_name}
                WHERE customer_group_code IS NOT NULL 
                AND customer_group_code != ''
                ORDER BY customer_group_code
            """
            
            cursor.execute(query)
            rows = cursor.fetchall()
            
            return [row[0] for row in rows]
            
        except Exception as e:
            logger.error(f"Error getting customer groups: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_excluded_customer_groups(self, region: str) -> List[Dict[str, Any]]:
        """Get list of excluded customer groups for a region"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            query = """
                SELECT 
                    id, customer_group, 
                    added_by, added_at
                FROM condensed_magento_excluded_customer_groups
                WHERE region = %s
                ORDER BY customer_group
            """
            
            cursor.execute(query, (region,))
            rows = cursor.fetchall()
            
            groups = []
            for row in rows:
                groups.append({
                    "id": row[0],
                    "customer_group": row[1],
                    "added_by": row[2],
                    "added_at": row[3].isoformat() if row[3] else None
                })
            
            return groups
            
        except Exception as e:
            logger.error(f"Error getting excluded customer groups: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def add_excluded_customer_group(self, region: str, customer_group: str, username: str) -> Dict[str, Any]:
        """Add a customer group to the exclusion list"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO condensed_magento_excluded_customer_groups 
                (region, customer_group, added_by)
                VALUES (%s, %s, %s)
                ON CONFLICT (region, customer_group) DO NOTHING
                RETURNING id
            """, (region, customer_group, username))
            
            result = cursor.fetchone()
            conn.commit()
            
            if result:
                return {
                    "success": True,
                    "message": f"Customer group '{customer_group}' added to exclusion list",
                    "id": result[0]
                }
            else:
                return {
                    "success": False,
                    "message": f"Customer group '{customer_group}' already in exclusion list"
                }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error adding excluded customer group: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def remove_excluded_customer_group(self, group_id: int) -> Dict[str, Any]:
        """Remove a customer group from the exclusion list"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                DELETE FROM condensed_magento_excluded_customer_groups 
                WHERE id = %s
                RETURNING customer_group
            """, (group_id,))
            
            result = cursor.fetchone()
            conn.commit()
            
            if result:
                return {
                    "success": True,
                    "message": f"Customer group '{result[0]}' removed from exclusion list"
                }
            else:
                return {
                    "success": False,
                    "message": "Customer group not found"
                }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error removing excluded customer group: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
