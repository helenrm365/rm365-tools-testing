from typing import List, Dict, Any, Optional
import logging
import json
from datetime import datetime, timezone
from psycopg2.extras import execute_values
from core.db import get_products_connection, return_products_connection

logger = logging.getLogger(__name__)


class MagentoDataRepo:
    """Repository for magento data operations"""
    
    def __init__(self):
        pass
    
    def init_tables(self):
        """Initialize magento data tables and aggregated tables if they don't exist"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Define the main magento data tables to create
            tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache']
            aggregated_tables = ['uk_aggregated_orders', 'fr_aggregated_orders', 'nl_aggregated_orders']
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
            
            # Create unified magento_region_filters table for all filter types
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'magento_region_filters'
                )
            """)
            
            if not cursor.fetchone()[0]:
                cursor.execute("""
                    CREATE TABLE magento_region_filters (
                        id SERIAL PRIMARY KEY,
                        region VARCHAR(10) NOT NULL,
                        filter_type VARCHAR(50) NOT NULL,
                        
                        -- For customer exclusions
                        customer_email VARCHAR(255),
                        customer_full_name VARCHAR(255),
                        
                        -- For group exclusions
                        customer_group VARCHAR(255),
                        
                        -- For thresholds
                        threshold_value DECIMAL(10, 2),
                        qty_threshold_value INTEGER,
                        
                        -- For smart quantity rules
                        smart_qty_threshold INTEGER,
                        smart_qty_action VARCHAR(20),
                        smart_qty_divisor DECIMAL(10, 2),
                        smart_qty_rule_order INTEGER DEFAULT 1,
                        
                        -- For status exclusions
                        order_status VARCHAR(50),
                        
                        -- For smart date rules
                        date_rule_start DATE,
                        date_rule_end DATE,
                        date_rule_action VARCHAR(20),
                        date_rule_value DECIMAL(10, 2),
                        
                        -- Metadata
                        added_by VARCHAR(100),
                        updated_by VARCHAR(100),
                        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        
                        -- Unique constraints (note: excluded_customer uses partial indexes instead)
                        CONSTRAINT unique_excluded_group UNIQUE(region, filter_type, customer_group),
                        CONSTRAINT unique_excluded_status UNIQUE(region, filter_type, order_status)
                    )
                """)
                
                # Create partial unique indexes for excluded_customer to allow multiple product rules
                # One constraint for exclude_all and divide_all (only one per customer)
                cursor.execute("""
                    CREATE UNIQUE INDEX unique_excluded_customer_base 
                    ON magento_region_filters(region, filter_type, customer_email) 
                    WHERE filter_type = 'excluded_customer' 
                    AND (exclusion_rule_type IS NULL OR exclusion_rule_type IN ('exclude_all', 'divide_all'))
                """)
                
                # Another constraint for divide_product (one per customer+product combination)
                cursor.execute("""
                    CREATE UNIQUE INDEX unique_excluded_customer_product 
                    ON magento_region_filters(region, filter_type, customer_email, exclusion_product_sku) 
                    WHERE filter_type = 'excluded_customer' 
                    AND exclusion_rule_type = 'divide_product'
                """)
                
                # Create partial unique index for thresholds
                cursor.execute("""
                    CREATE UNIQUE INDEX unique_threshold_filter 
                    ON magento_region_filters(region, filter_type) 
                    WHERE filter_type IN ('threshold', 'qty_threshold')
                """)
                
                # Create partial unique constraint for smart qty rules
                cursor.execute("""
                    CREATE UNIQUE INDEX unique_smart_qty_rule 
                    ON magento_region_filters(region, filter_type, smart_qty_rule_order) 
                    WHERE filter_type = 'smart_qty_rule'
                """)
                
                # Create indexes for common queries
                cursor.execute("CREATE INDEX idx_filters_region_type ON magento_region_filters(region, filter_type)")
                cursor.execute("CREATE INDEX idx_filters_customer_email ON magento_region_filters(customer_email) WHERE customer_email IS NOT NULL")
                
                logger.info(f"✅ Created table: magento_region_filters")
            else:
                logger.info(f"ℹ️  Table already exists: magento_region_filters")
                
                # Ensure the new constraint exists and old one is fixed
                # Check if smart_qty_rule_order column exists
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'magento_region_filters' 
                        AND column_name = 'smart_qty_rule_order'
                    )
                """)

                if not cursor.fetchone()[0]:
                    # Add the column if it doesn't exist
                    cursor.execute("""
                        ALTER TABLE magento_region_filters 
                        ADD COLUMN smart_qty_rule_order INTEGER DEFAULT 1
                    """)
                    logger.info(f"✅ Added column: smart_qty_rule_order")
                
                # Check for order_status column
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'magento_region_filters' 
                        AND column_name = 'order_status'
                    )
                """)
                
                if not cursor.fetchone()[0]:
                    cursor.execute("ALTER TABLE magento_region_filters ADD COLUMN order_status VARCHAR(50)")
                    logger.info("✅ Added column: order_status")
                
                # Drop the old unique_threshold constraint if it exists
                cursor.execute("""
                    SELECT conname 
                    FROM pg_constraint 
                    WHERE conname = 'unique_threshold' 
                    AND conrelid = 'magento_region_filters'::regclass
                """)
                
                if cursor.fetchone():
                    cursor.execute("""
                        ALTER TABLE magento_region_filters 
                        DROP CONSTRAINT unique_threshold
                    """)
                    logger.info(f"✅ Dropped old constraint: unique_threshold")
                
                # Add new partial unique index for thresholds (excluding smart_qty_rule)
                cursor.execute("""
                    SELECT indexname 
                    FROM pg_indexes 
                    WHERE indexname = 'unique_threshold_filter' 
                    AND tablename = 'magento_region_filters'
                """)
                
                if not cursor.fetchone():
                    cursor.execute("""
                        CREATE UNIQUE INDEX unique_threshold_filter 
                        ON magento_region_filters(region, filter_type) 
                        WHERE filter_type IN ('threshold', 'qty_threshold')
                    """)
                    logger.info(f"✅ Added new partial unique index: unique_threshold_filter")
                
                # Drop the old unique_smart_qty_rule constraint if it exists (needs to be replaced with partial index)
                cursor.execute("""
                    SELECT conname 
                    FROM pg_constraint 
                    WHERE conname = 'unique_smart_qty_rule' 
                    AND conrelid = 'magento_region_filters'::regclass
                """)
                
                if cursor.fetchone():
                    cursor.execute("""
                        ALTER TABLE magento_region_filters 
                        DROP CONSTRAINT unique_smart_qty_rule
                    """)
                    logger.info(f"✅ Dropped old constraint: unique_smart_qty_rule (will be replaced with partial index)")
                
                # Ensure smart_qty_rule partial unique index exists (only for smart_qty_rule filter_type)
                cursor.execute("""
                    SELECT indexname 
                    FROM pg_indexes 
                    WHERE indexname = 'unique_smart_qty_rule' 
                    AND tablename = 'magento_region_filters'
                """)
                
                if not cursor.fetchone():
                    cursor.execute("""
                        CREATE UNIQUE INDEX unique_smart_qty_rule 
                        ON magento_region_filters(region, filter_type, smart_qty_rule_order) 
                        WHERE filter_type = 'smart_qty_rule'
                    """)
                    logger.info(f"✅ Added partial unique index: unique_smart_qty_rule (only applies to smart_qty_rule rows)")

                # Ensure order_status constraint exists
                cursor.execute("""
                    SELECT conname 
                    FROM pg_constraint 
                    WHERE conname = 'unique_excluded_status' 
                    AND conrelid = 'magento_region_filters'::regclass
                """)
                
                if not cursor.fetchone():
                    cursor.execute("""
                        ALTER TABLE magento_region_filters 
                        ADD CONSTRAINT unique_excluded_status 
                        UNIQUE(region, filter_type, order_status)
                    """)
                    logger.info(f"✅ Added constraint: unique_excluded_status")

                # Check for date_rule columns
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'magento_region_filters' 
                        AND column_name = 'date_rule_start'
                    )
                """)
                
                if not cursor.fetchone()[0]:
                    cursor.execute("""
                        ALTER TABLE magento_region_filters 
                        ADD COLUMN date_rule_start DATE,
                        ADD COLUMN date_rule_end DATE,
                        ADD COLUMN date_rule_action VARCHAR(20),
                        ADD COLUMN date_rule_value DECIMAL(10, 2)
                    """)
                    logger.info("✅ Added columns: date_rule_*")

                    # Add constraint for date rules
                    cursor.execute("""
                        ALTER TABLE magento_region_filters 
                        ADD CONSTRAINT unique_date_rule 
                        UNIQUE(region, filter_type, date_rule_start, date_rule_end)
                    """)
                    logger.info("✅ Added constraint: unique_date_rule")

                # Check for customer exclusion rule columns
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.columns 
                        WHERE table_name = 'magento_region_filters' 
                        AND column_name = 'exclusion_rule_type'
                    )
                """)
                
                if not cursor.fetchone()[0]:
                    cursor.execute("""
                        ALTER TABLE magento_region_filters 
                        ADD COLUMN exclusion_rule_type VARCHAR(50) DEFAULT 'exclude_all',
                        ADD COLUMN exclusion_divisor DECIMAL(10, 2) DEFAULT 2,
                        ADD COLUMN exclusion_product_sku VARCHAR(255),
                        ADD COLUMN exclusion_product_name TEXT
                    """)
                    logger.info("✅ Added columns: exclusion_rule_type, exclusion_divisor, exclusion_product_sku, exclusion_product_name")

                # Check if old unique_excluded_customer constraint exists and replace with partial indexes
                cursor.execute("""
                    SELECT conname 
                    FROM pg_constraint 
                    WHERE conname = 'unique_excluded_customer' 
                    AND conrelid = 'magento_region_filters'::regclass
                """)
                
                if cursor.fetchone():
                    # Drop the old constraint that prevents multiple rules per customer
                    cursor.execute("""
                        ALTER TABLE magento_region_filters 
                        DROP CONSTRAINT unique_excluded_customer
                    """)
                    logger.info("✅ Dropped old constraint: unique_excluded_customer")
                    
                    # Create new partial indexes to allow multiple product rules per customer
                    cursor.execute("""
                        CREATE UNIQUE INDEX IF NOT EXISTS unique_excluded_customer_base 
                        ON magento_region_filters(region, filter_type, customer_email) 
                        WHERE filter_type = 'excluded_customer' 
                        AND (exclusion_rule_type IS NULL OR exclusion_rule_type IN ('exclude_all', 'divide_all'))
                    """)
                    logger.info("✅ Created partial index: unique_excluded_customer_base")
                    
                    cursor.execute("""
                        CREATE UNIQUE INDEX IF NOT EXISTS unique_excluded_customer_product 
                        ON magento_region_filters(region, filter_type, customer_email, exclusion_product_sku) 
                        WHERE filter_type = 'excluded_customer' 
                        AND exclusion_rule_type = 'divide_product'
                    """)
                    logger.info("✅ Created partial index: unique_excluded_customer_product")
            
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
                            shipping_method VARCHAR(500),
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
                    
                    # Add shipping_method column if it doesn't exist
                    cursor.execute(f"""
                        SELECT column_name FROM information_schema.columns
                        WHERE table_name = %s AND column_name = 'shipping_method'
                    """, (table_name,))
                    if not cursor.fetchone():
                        try:
                            cursor.execute(f"ALTER TABLE {table_name} ADD COLUMN shipping_method VARCHAR(500)")
                            logger.info(f"✅ Added shipping_method column to {table_name}")
                        except Exception as e:
                            logger.warning(f"Could not add shipping_method column to {table_name}: {e}")
                    
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
            
            # Create aggregated magento tables (6-month aggregated data)
            for table_name in aggregated_tables:
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
                    # Create the aggregated table
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
                    logger.info(f"✅ Created aggregated table: {table_name}")
                else:
                    logger.info(f"ℹ️  Aggregated table already exists: {table_name}")
                
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
                        shipping_method VARCHAR(500),
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
                
                # Add shipping_method column if it doesn't exist
                cursor.execute("""
                    SELECT column_name FROM information_schema.columns
                    WHERE table_name = 'test_magento_data' AND column_name = 'shipping_method'
                """)
                if not cursor.fetchone():
                    try:
                        cursor.execute("ALTER TABLE test_magento_data ADD COLUMN shipping_method VARCHAR(500)")
                        logger.info(f"✅ Added shipping_method column to test_magento_data")
                    except Exception as e:
                        logger.warning(f"Could not add shipping_method column to test_magento_data: {e}")
                
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
    
    def get_all_sync_metadata(self) -> List[Dict[str, Any]]:
        """Get sync metadata for all regions (UK, FR, NL)"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT region, last_synced_order_date, last_sync_time, 
                       total_orders_synced, total_rows_synced, last_synced_by,
                       created_at, updated_at
                FROM magento_sync_metadata
                ORDER BY region
            """)
            
            rows = cursor.fetchall()
            result = []
            
            for row in rows:
                result.append({
                    'region': row[0],
                    'last_synced_order_date': row[1].isoformat() if row[1] else None,
                    'last_sync_time': row[2].isoformat() if row[2] else None,
                    'total_orders_synced': row[3],
                    'total_rows_synced': row[4],
                    'last_synced_by': row[5],
                    'created_at': row[6].isoformat() if row[6] else None,
                    'updated_at': row[7].isoformat() if row[7] else None
                })
            
            return result
            
        except Exception as e:
            logger.error(f"Error getting all sync metadata: {e}")
            return []
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
            table_name: The table to check (uk_magento_orders_cache, fr_magento_orders_cache, nl_magento_orders_cache, test_magento_data)
            last_synced_date: The created_at date of the last synced order
            region: Region code (uk, fr, nl, test) - needed to initialize Magento client
        
        Returns:
            Dict with is_complete (bool), message (str), and optionally suggested_start_date
        """
        # Validate table name
        valid_tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache', 'test_magento_data']
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
                    if hasattr(prev_date, 'strftime'):
                        suggested_date = prev_date.strftime('%Y-%m-%d %H:%M:%S')
                    else:
                        suggested_date = str(prev_date)
                    
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
                        region = table_name.replace('_orders_cache', '')
                
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
                if prev_date:
                    if hasattr(prev_date, 'strftime'):
                        suggested_date = prev_date.strftime('%Y-%m-%d %H:%M:%S')
                    else:
                        suggested_date = str(prev_date)
                else:
                    suggested_date = None
                
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
            
            tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache']
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
    
    @staticmethod
    def _build_full_data_filters(search: str = "", statuses: list = None,
                                 date_from: str = None, date_to: str = None,
                                 prefix: str = "") -> tuple:
        """Build the WHERE clause and params shared by the full-data queries.

        created_at is stored as text in ISO form ('YYYY-MM-DD HH:MI:SS'), so the
        date bounds are plain string comparisons (upper bound is exclusive of the
        day after date_to, which keeps the whole of date_to included).

        Returns (where_clause, params) - where_clause is '' when nothing to filter.
        """
        clauses = []
        params = []

        if search:
            search_pattern = f"%{search}%"
            clauses.append(
                f"({prefix}order_number ILIKE %s OR {prefix}sku ILIKE %s OR {prefix}name ILIKE %s "
                f"OR {prefix}status ILIKE %s OR {prefix}customer_email ILIKE %s "
                f"OR {prefix}customer_full_name ILIKE %s)"
            )
            params.extend([search_pattern] * 6)

        if statuses:
            cleaned = [s.strip() for s in statuses if s and s.strip()]
            if cleaned:
                clauses.append(f"LOWER({prefix}status) = ANY(%s)")
                params.append([s.lower() for s in cleaned])

        if date_from:
            clauses.append(f"{prefix}created_at >= %s")
            params.append(date_from)

        if date_to:
            # Exclusive upper bound on the day after date_to so timestamps within
            # date_to itself are kept.
            clauses.append(f"{prefix}created_at < to_char((%s)::date + 1, 'YYYY-MM-DD')")
            params.append(date_to)

        where_clause = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        return where_clause, params

    def get_magento_data(self, table_name: str, limit: int = 100, offset: int = 0, search: str = "", fields: list = None, sort_by: str = None, sort_order: str = "desc", statuses: list = None, date_from: str = None, date_to: str = None) -> Dict[str, Any]:
        """Get magento data from a specific table with pagination, search, sorting, status/date filters and optional field selection"""
        # Validate table name to prevent SQL injection
        valid_tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache', 'test_magento_data']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")
        
        # Define all available columns
        all_columns = ['id', 'order_number', 'created_at', 'sku', 'name', 'qty', 'original_price', 'special_price', 'status', 
                      'currency', 'grand_total', 'customer_email', 'customer_full_name', 
                      'billing_address', 'shipping_address', 'shipping_method', 'customer_group_code',
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
        
        # Validate and build ORDER BY clause
        order_column = 'imported_at'  # Default sort column
        if sort_by and sort_by in all_columns:
            order_column = sort_by
        order_direction = 'DESC' if (sort_order or 'desc').upper() == 'DESC' else 'ASC'
        order_clause = f"ORDER BY {order_column} {order_direction}"
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Build the query with optional search / status / date filters
            where_clause, filter_params = self._build_full_data_filters(search, statuses, date_from, date_to)

            count_query = f"SELECT COUNT(*) FROM {table_name} {where_clause}"
            data_query = f"""
                SELECT {select_clause}
                FROM {table_name}
                {where_clause}
                {order_clause}
                LIMIT %s OFFSET %s
            """
            cursor.execute(count_query, tuple(filter_params))
            total_count = cursor.fetchone()[0]

            cursor.execute(data_query, tuple(filter_params) + (limit, offset))

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
    
    def import_magento_product_rows(self, table_name: str, product_rows: List[Dict[str, Any]], username: str = None) -> Dict[str, Any]:
        """
        Import product-level rows from Magento API into a specific magento table.
        
        This replaces the CSV import functionality with live Magento data.
        Each row represents a product from an order, with invoiced quantities.
        
        Args:
            table_name: The table to import into (uk_magento_orders_cache, fr_magento_orders_cache, nl_magento_orders_cache, test_magento_data)
            product_rows: List of product-level dictionaries from Magento API
            username: User performing the sync
        
        Returns:
            Dict with rows_imported, errors, and success status
        """
        # Validate table name to prevent SQL injection
        valid_tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache', 'test_magento_data']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")
        
        # Extract region from table name (or use TEST for test table)
        if table_name == 'test_magento_data':
            region = 'TEST'
        else:
            region = table_name.replace('_orders_cache', '').upper()
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            rows_imported = 0
            errors = []
            
            # Pre-process all rows into a list of tuples for bulk insert
            now = datetime.now(timezone.utc)
            valid_rows = []
            
            for idx, row in enumerate(product_rows, start=1):
                try:
                    order_number = (row.get('order_number') or '').strip()
                    created_at = (row.get('created_at') or '').strip()
                    sku = (row.get('sku') or '').strip()
                    name = (row.get('name') or '').strip()
                    qty = int(row.get('qty', 0))
                    original_price = row.get('original_price')
                    special_price = row.get('special_price')
                    status = (row.get('status') or '').strip()
                    currency = row.get('currency')
                    grand_total = row.get('grand_total')
                    customer_email = row.get('customer_email')
                    customer_full_name = row.get('customer_full_name')
                    billing_address = row.get('billing_address')
                    shipping_address = row.get('shipping_address')
                    shipping_method = row.get('shipping_method')
                    customer_group_code = row.get('customer_group_code')
                    
                    # Validate required fields
                    if not order_number or not sku:
                        errors.append(f"Row {idx}: Missing order_number or SKU")
                        continue
                    
                    valid_rows.append((
                        order_number, created_at, sku, name, qty, original_price, special_price, 
                        status, currency, grand_total, customer_email, customer_full_name, 
                        billing_address, shipping_address, shipping_method, customer_group_code, now, now
                    ))
                    
                except Exception as e:
                    errors.append(f"Row {idx}: {str(e)}")
                    logger.error(f"Error processing product row {idx}: {e}")
            
            # Bulk upsert using execute_values (much faster than individual inserts)
            # ON CONFLICT handles duplicates between Magento and PostgreSQL
            # The WHERE clause ensures we only update rows where qty or status actually changed
            # We use RETURNING to count only actually inserted/updated rows
            if valid_rows:
                insert_query = f"""
                    INSERT INTO {table_name} 
                    (order_number, created_at, sku, name, qty, original_price, special_price, status, currency, 
                     grand_total, customer_email, customer_full_name, billing_address, 
                     shipping_address, shipping_method, customer_group_code, imported_at, updated_at)
                    VALUES %s
                    ON CONFLICT (order_number, sku) DO UPDATE SET
                        qty = EXCLUDED.qty,
                        status = EXCLUDED.status,
                        shipping_method = EXCLUDED.shipping_method,
                        updated_at = EXCLUDED.updated_at
                    WHERE {table_name}.qty IS DISTINCT FROM EXCLUDED.qty
                       OR {table_name}.status IS DISTINCT FROM EXCLUDED.status
                       OR {table_name}.shipping_method IS DISTINCT FROM EXCLUDED.shipping_method
                    RETURNING 1
                """
                # Use execute_values with fetch=True to get RETURNING results
                result = execute_values(cursor, insert_query, valid_rows, page_size=1000, fetch=True)
                rows_imported = len(result) if result else 0
            
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
        valid_tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache', 'test_magento_data']
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
                region = table_name.replace('_orders_cache', '')
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            rows_imported = 0
            errors = []
            
            # Pre-process all rows into a list of tuples for bulk insert
            now = datetime.now(timezone.utc)
            valid_rows = []
            
            for idx, row in enumerate(product_rows, start=1):
                try:
                    order_number = (row.get('order_number') or '').strip()
                    created_at = (row.get('created_at') or '').strip()
                    sku = (row.get('sku') or '').strip()
                    name = (row.get('name') or '').strip()
                    qty = int(row.get('qty', 0))
                    original_price = row.get('original_price')
                    special_price = row.get('special_price')
                    status = (row.get('status') or '').strip()
                    currency = row.get('currency')
                    grand_total = row.get('grand_total')
                    customer_email = row.get('customer_email')
                    customer_full_name = row.get('customer_full_name')
                    billing_address = row.get('billing_address')
                    shipping_address = row.get('shipping_address')
                    shipping_method = row.get('shipping_method')
                    customer_group_code = row.get('customer_group_code')
                    
                    if not order_number or not sku:
                        errors.append(f"Row {idx}: Missing order_number or SKU")
                        continue
                    
                    valid_rows.append((
                        order_number, created_at, sku, name, qty, original_price, special_price, 
                        status, currency, grand_total, customer_email, customer_full_name, 
                        billing_address, shipping_address, shipping_method, customer_group_code, now, now
                    ))
                    
                except Exception as e:
                    errors.append(f"Row {idx}: {str(e)}")
                    logger.error(f"Error processing product row {idx}: {e}")
            
            # Bulk upsert using execute_values (much faster than individual inserts)
            # ON CONFLICT handles duplicates between Magento and PostgreSQL
            # The WHERE clause ensures we only update rows where qty or status actually changed
            # We use RETURNING to count only actually inserted/updated rows
            if valid_rows:
                insert_query = f"""
                    INSERT INTO {table_name} 
                    (order_number, created_at, sku, name, qty, original_price, special_price, status, currency, 
                     grand_total, customer_email, customer_full_name, billing_address, 
                     shipping_address, shipping_method, customer_group_code, imported_at, updated_at)
                    VALUES %s
                    ON CONFLICT (order_number, sku) DO UPDATE SET
                        qty = EXCLUDED.qty,
                        status = EXCLUDED.status,
                        shipping_method = EXCLUDED.shipping_method,
                        updated_at = EXCLUDED.updated_at
                    WHERE {table_name}.qty IS DISTINCT FROM EXCLUDED.qty
                       OR {table_name}.status IS DISTINCT FROM EXCLUDED.status
                       OR {table_name}.shipping_method IS DISTINCT FROM EXCLUDED.shipping_method
                    RETURNING 1
                """
                # Use execute_values with fetch=True to get RETURNING results
                result = execute_values(cursor, insert_query, valid_rows, page_size=1000, fetch=True)
                rows_imported = len(result) if result else 0
            
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
                history_region = table_name.replace('_orders_cache', '').upper()
            
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
    
    def simulate_batch_import(
        self,
        table_name: str,
        product_rows: List[Dict[str, Any]]
    ) -> Dict[str, int]:
        """
        Simulate batch import of product rows. Checks existing records in table_name
        to determine how many rows would be inserted, updated, or skipped.
        Does NOT write to the database.
        """
        # Validate table name
        valid_tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache', 'test_magento_data']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")

        inserted = 0
        updated = 0
        skipped = 0

        if not product_rows:
            return {"inserted": 0, "updated": 0, "skipped": 0}

        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()

            # Batch query existing records for (order_number, sku) combinations in chunks
            chunk_size = 500
            existing_map = {}
            
            pairs = []
            for row in product_rows:
                order_number = (row.get('order_number') or '').strip()
                sku = (row.get('sku') or '').strip()
                if order_number and sku:
                    pairs.append((order_number, sku))
            
            unique_pairs = list(set(pairs))
            
            for i in range(0, len(unique_pairs), chunk_size):
                chunk = unique_pairs[i:i+chunk_size]
                placeholders = ", ".join(["(%s, %s)"] * len(chunk))
                flat_params = []
                for p in chunk:
                    flat_params.extend([p[0], p[1]])
                
                query = f"""
                    SELECT order_number, sku, qty, status, shipping_method
                    FROM {table_name}
                    WHERE (order_number, sku) IN ({placeholders})
                """
                cursor.execute(query, flat_params)
                for r in cursor.fetchall():
                    existing_map[(r[0], r[1])] = {
                        'qty': r[2],
                        'status': r[3],
                        'shipping_method': r[4]
                    }

            for row in product_rows:
                order_number = (row.get('order_number') or '').strip()
                sku = (row.get('sku') or '').strip()
                if not order_number or not sku:
                    continue
                
                qty = int(row.get('qty', 0))
                status = (row.get('status') or '').strip()
                shipping_method = (row.get('shipping_method') or '').strip()
                
                key = (order_number, sku)
                if key not in existing_map:
                    inserted += 1
                else:
                    existing = existing_map[key]
                    if (existing['qty'] != qty or 
                        existing['status'] != status or 
                        existing['shipping_method'] != shipping_method):
                        updated += 1
                    else:
                        skipped += 1
                        
            return {"inserted": inserted, "updated": updated, "skipped": skipped}
            
        except Exception as e:
            logger.error(f"Error in simulate_batch_import for {table_name}: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)

    def refresh_aggregated_data(self, region: str) -> Dict[str, Any]:
        """
        Refresh aggregated magento data for a region.
        Aggregates last 6 months of data by SKU, summing quantities.
        Uses sku_aliases table to combine related SKUs under their unified_sku.
        Applies currency conversion when filtering by grand_total threshold.
        """
        from common.currency import convert_to_gbp, convert_to_eur
        
        # Map region to table names and base currency
        region_mapping = {
            'uk': ('uk_orders_cache', 'uk_aggregated_orders', 'GBP', convert_to_gbp),
            'fr': ('fr_orders_cache', 'fr_aggregated_orders', 'EUR', convert_to_eur),
            'nl': ('nl_orders_cache', 'nl_aggregated_orders', 'EUR', convert_to_eur)
        }
        
        if region not in region_mapping:
            raise ValueError(f"Invalid region: {region}")
        
        magento_table, aggregated_table, base_currency, converter_func = region_mapping[region]
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Clear existing aggregated data
            cursor.execute(f"DELETE FROM {aggregated_table}")
            
            # Get the thresholds for this region (if set)
            cursor.execute("""
                SELECT threshold_value FROM magento_region_filters 
                WHERE region = %s AND filter_type = 'threshold'
            """, (region,))
            threshold_row = cursor.fetchone()
            grand_total_threshold = threshold_row[0] if threshold_row else None
            
            cursor.execute("""
                SELECT qty_threshold_value FROM magento_region_filters 
                WHERE region = %s AND filter_type = 'qty_threshold'
            """, (region,))
            qty_row = cursor.fetchone()
            qty_threshold = qty_row[0] if qty_row else None
            
            logger.info(f"Refreshing {region} aggregated data with threshold: {grand_total_threshold} {base_currency}, qty_threshold: {qty_threshold}")
            
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
                    s.created_at,
                    s.status
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
            
            # Get excluded customers with their rules (now supports multiple rules per customer)
            cursor.execute("""
                SELECT customer_email, 
                       COALESCE(exclusion_rule_type, 'exclude_all') as rule_type,
                       COALESCE(exclusion_divisor, 2) as divisor,
                       exclusion_product_sku
                FROM magento_region_filters
                WHERE region = %s AND filter_type = 'excluded_customer'
            """, (region,))
            
            # Structure: { email: { 'base_rule': {...} or None, 'product_rules': { sku: {...} } } }
            excluded_customer_rules = {}
            for row in cursor.fetchall():
                email = row[0]
                rule_type = row[1]
                divisor = float(row[2]) if row[2] else 2.0
                product_sku = row[3]
                
                if email not in excluded_customer_rules:
                    excluded_customer_rules[email] = {'base_rule': None, 'product_rules': {}}
                
                if rule_type in ('exclude_all', 'divide_all'):
                    excluded_customer_rules[email]['base_rule'] = {
                        'rule_type': rule_type,
                        'divisor': divisor
                    }
                elif rule_type == 'divide_product' and product_sku:
                    excluded_customer_rules[email]['product_rules'][product_sku] = {
                        'divisor': divisor
                    }
            
            # Get excluded customer groups
            cursor.execute("""
                SELECT customer_group FROM magento_region_filters
                WHERE region = %s AND filter_type = 'excluded_group'
            """, (region,))
            excluded_groups = {row[0] for row in cursor.fetchall()}

            # Get excluded order statuses
            cursor.execute("""
                SELECT order_status FROM magento_region_filters
                WHERE region = %s AND filter_type = 'excluded_status'
            """, (region,))
            excluded_statuses = {row[0] for row in cursor.fetchall()}

            # Get smart date rules
            date_rules = self.get_smart_date_rules(region)
            
            # Get smart qty rules (multiple rules possible)
            smart_rules = self.get_smart_qty_rules(region)
            # Sort by threshold descending (highest first) for cutoff behavior
            if smart_rules:
                smart_rules = sorted(smart_rules, key=lambda r: r['threshold'], reverse=True)
            
            # Filter and aggregate in Python with currency conversion
            sku_aggregates = {}
            filtered_count = 0
            
            for row in all_rows:
                sku, name, qty, grand_total, currency, customer_email, customer_group, created_at, status = row
                
                # Exclude FREE GIFT items from aggregated data (case-insensitive)
                # UK: "FREE GIFT", FR: "Cadeaux gratuits"
                name_lower = (name or '').lower()
                if 'free gift' in name_lower or 'cadeaux gratuits' in name_lower:
                    continue
                
                # Initialize qty_to_use for customer exclusion rule processing
                qty_to_use = qty or 0
                customer_rule_applied = False
                
                # Apply customer exclusion rules with dominance logic:
                # - exclude_all + divide_product(s): Exclude all EXCEPT specific products which get divided
                # - divide_all + divide_product(s): Divide all EXCEPT specific products with their own divisor
                # - Product-specific rules take precedence over base rules
                if customer_email in excluded_customer_rules:
                    rules = excluded_customer_rules[customer_email]
                    base_rule = rules.get('base_rule')
                    product_rules = rules.get('product_rules', {})
                    
                    # Check if this product has a specific rule (takes precedence)
                    if sku in product_rules:
                        # Product-specific rule overrides base rule
                        divisor = product_rules[sku]['divisor']
                        if divisor and divisor > 0:
                            qty_to_use = qty_to_use / divisor
                        customer_rule_applied = True
                    elif base_rule:
                        # Apply base rule (no product-specific override)
                        if base_rule['rule_type'] == 'exclude_all':
                            # Skip this product (not in product_rules, so excluded)
                            continue
                        elif base_rule['rule_type'] == 'divide_all':
                            # Divide by base divisor (no product-specific override)
                            divisor = base_rule['divisor']
                            if divisor and divisor > 0:
                                qty_to_use = qty_to_use / divisor
                            customer_rule_applied = True
                    # If no base rule and not in product_rules, use original qty
                
                # Skip excluded customer groups
                if customer_group in excluded_groups:
                    continue

                # Skip excluded statuses
                if status in excluded_statuses:
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

                # Parse created_at for date rules
                order_date = None
                if created_at:
                    try:
                        if '-' in created_at: # YYYY-MM-DD
                            order_date = datetime.strptime(created_at.split(' ')[0], '%Y-%m-%d').date()
                            if order_date.year < 2000: # Handle MM-DD-YYYY or other formats incorrectly parsed as YYYY-MM-DD
                                # Try alternate parsing if needed
                                pass
                        elif '/' in created_at: # DD/MM/YYYY or MM/DD/YYYY
                             parts = created_at.split(' ')[0].split('/')
                             if len(parts) == 3:
                                 # Try DD/MM/YYYY first (common in UK/Europe)
                                 try:
                                     order_date = datetime.strptime(created_at.split(' ')[0], '%d/%m/%Y').date()
                                 except ValueError:
                                     # Fallback to MM/DD/YYYY
                                     try:
                                         order_date = datetime.strptime(created_at.split(' ')[0], '%m/%d/%Y').date()
                                     except ValueError:
                                         pass
                    except Exception:
                        pass # Cannot parse date, skip date rules

                # Apply date rules (note: qty_to_use may already be modified by customer exclusion rules)
                date_rule_applied = False
                should_skip_row = False
                # Don't reset qty_to_use if customer rule already modified it
                if not customer_rule_applied:
                    qty_to_use = qty or 0
                
                if order_date and date_rules:
                    for rule in date_rules:
                        # Parse rule constraints
                        try:
                            rule_start = datetime.strptime(rule['start_date'], '%Y-%m-%d').date() if rule['start_date'] else None
                            rule_end = datetime.strptime(rule['end_date'], '%Y-%m-%d').date() if rule['end_date'] else None
                            
                            # Check if order falls in range
                            in_range = True
                            if rule_start and order_date < rule_start:
                                in_range = False
                            if rule_end and order_date > rule_end:
                                in_range = False
                            
                            if in_range:
                                action = rule['action']
                                value = rule['value']
                                
                                if action == 'exclude':
                                    filtered_count += 1
                                    qty_to_use = 0
                                    should_skip_row = True
                                    date_rule_applied = True
                                    break 
                                
                                elif action == 'divide' and value:
                                    qty_to_use = qty_to_use / value
                                elif action == 'multiply' and value:
                                    qty_to_use = qty_to_use * value
                                elif action == 'set_to' and value is not None:
                                    qty_to_use = value
                                
                                date_rule_applied = True
                                break # Apply only first matching date rule
                        except Exception as e:
                            logger.error(f"Error checking date rule: {e}")

                if should_skip_row:
                    continue
                
                if not date_rule_applied:
                    # Apply smart qty rules (only first matching rule - cutoff behavior)
                    # Check from highest threshold to lowest
                    if smart_rules and qty is not None:
                        for rule in smart_rules:
                            if qty >= rule['threshold']:
                                threshold = rule['threshold']
                                action = rule['action']
                                divisor = rule['divisor']
                                
                                if action == 'divide' and divisor:
                                    qty_to_use = qty / divisor
                                elif action == 'multiply' and divisor:
                                    qty_to_use = qty * divisor
                                elif action == 'subtract' and divisor:
                                    qty_to_use = max(0, qty - divisor)
                                elif action == 'set_to' and divisor:
                                    qty_to_use = divisor
                                # Break after applying first matching rule (cutoff point)
                                break
                
                # Aggregate by SKU
                if sku not in sku_aggregates:
                    sku_aggregates[sku] = {'name': name, 'total_qty': 0}
                sku_aggregates[sku]['total_qty'] += qty_to_use
                sku_aggregates[sku]['name'] = name  # Keep the latest name
            
            # Insert aggregated data using batch insert (much faster than executemany)
            if sku_aggregates:
                insert_query = f"""
                    INSERT INTO {aggregated_table} (sku, name, total_qty, last_updated)
                    VALUES %s
                """
                
                insert_data = [
                    (sku, data['name'], data['total_qty'], datetime.now())
                    for sku, data in sku_aggregates.items()
                ]
                
                execute_values(cursor, insert_query, insert_data, page_size=1000)
            
            rows_affected = len(sku_aggregates)
            
            conn.commit()
            
            logger.info(f"✅ Refreshed {aggregated_table}: {rows_affected} SKUs aggregated (filtered {filtered_count} orders with thresholds)")
            
            return {
                "success": True,
                "rows_aggregated": rows_affected,
                "table": aggregated_table
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error refreshing aggregated data for {region}: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_aggregated_data(self, region: str, limit: int = 100, offset: int = 0, search: str = "", sort_by: str = "", sort_order: str = "desc") -> Dict[str, Any]:
        """Get aggregated magento data for a specific region"""
        # Map region to aggregated table
        region_mapping = {
            'uk': 'uk_aggregated_orders',
            'fr': 'fr_aggregated_orders',
            'nl': 'nl_aggregated_orders'
        }
        
        if region not in region_mapping:
            raise ValueError(f"Invalid region: {region}")
        
        aggregated_table = region_mapping[region]
        
        # Validate and build ORDER BY clause
        allowed_columns = ['sku', 'name', 'total_qty', 'last_updated']
        order_column = 'total_qty'  # Default sort column
        order_direction = 'DESC'  # Default direction
        
        if sort_by and sort_by in allowed_columns:
            order_column = sort_by
        if sort_order and sort_order.lower() in ['asc', 'desc']:
            order_direction = sort_order.upper()
        
        order_clause = f"ORDER BY {order_column} {order_direction}"
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Build query with optional search
            if search:
                search_pattern = f"%{search}%"
                count_query = f"""
                    SELECT COUNT(*) FROM {aggregated_table}
                    WHERE sku ILIKE %s OR name ILIKE %s
                """
                data_query = f"""
                    SELECT id, sku, name, total_qty, last_updated
                    FROM {aggregated_table}
                    WHERE sku ILIKE %s OR name ILIKE %s
                    {order_clause}
                    LIMIT %s OFFSET %s
                """
                cursor.execute(count_query, (search_pattern, search_pattern))
                total_count = cursor.fetchone()[0]
                
                cursor.execute(data_query, (search_pattern, search_pattern, limit, offset))
            else:
                count_query = f"SELECT COUNT(*) FROM {aggregated_table}"
                data_query = f"""
                    SELECT id, sku, name, total_qty, last_updated
                    FROM {aggregated_table}
                    {order_clause}
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
            logger.error(f"Error fetching aggregated data from {aggregated_table}: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def backfill_shipping_methods(self, table_name: str, shipping_map: Dict[str, str]) -> int:
        """
        Backfill shipping_method for existing orders using a mapping of order_number -> shipping_method.
        Uses a single batch UPDATE via execute_values for maximum performance.
        Expects ≤10k items per call (service handles chunking).
        Returns the number of rows updated.
        """
        valid_tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")
        
        if not shipping_map:
            return 0
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            values = [(method, order_num) for order_num, method in shipping_map.items()]
            execute_values(
                cursor,
                f"""UPDATE {table_name} AS t
                    SET shipping_method = v.method
                    FROM (VALUES %s) AS v(method, order_number)
                    WHERE t.order_number = v.order_number
                    AND (t.shipping_method IS NULL OR t.shipping_method = '')""",
                values,
                template="(%s, %s)"
            )
            updated = cursor.rowcount
            conn.commit()
            logger.info(f"Backfilled shipping_method for {updated} rows in {table_name}")
            return updated
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error backfilling shipping methods in {table_name}: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_orders_missing_shipping_method(self, table_name: str) -> List[str]:
        """Get distinct order numbers that have NULL or empty shipping_method."""
        valid_tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT DISTINCT order_number FROM {table_name} WHERE shipping_method IS NULL OR shipping_method = ''"
            )
            return [row[0] for row in cursor.fetchall()]
        except Exception as e:
            logger.error(f"Error getting orders missing shipping method from {table_name}: {e}")
            return []
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_shipping_methods(self, region: str) -> List[str]:
        """
        Get distinct shipping methods for a region (or all regions).
        Returns a sorted list of non-empty shipping method strings.
        """
        region_mapping = {
            'uk': ['uk_orders_cache'],
            'fr': ['fr_orders_cache'],
            'nl': ['nl_orders_cache'],
            'all': ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache']
        }
        
        tables = region_mapping.get(region)
        if not tables:
            raise ValueError(f"Invalid region: {region}")
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            methods = set()
            for table in tables:
                cursor.execute(f"""
                    SELECT DISTINCT shipping_method 
                    FROM {table} 
                    WHERE shipping_method IS NOT NULL 
                      AND shipping_method != ''
                """)
                for row in cursor.fetchall():
                    methods.add(row[0])
            
            return sorted(methods)
            
        except Exception as e:
            logger.error(f"Error fetching shipping methods for {region}: {e}")
            return []
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_aggregated_data_custom_range(self, region: str, range_type: str, range_value: str, 
                                       use_exclusions: bool, limit: int = 100, offset: int = 0, 
                                       search: str = "", shipping_method: str = "") -> Dict[str, Any]:
        """
        Get aggregated magento data with custom date range.
        Aggregates data on-the-fly based on the specified date range.
        
        Args:
            region: 'uk', 'fr', or 'nl'
            range_type: 'days', 'months', or 'since'
            range_value: Number of days/months, or date string (YYYY-MM-DD)
            use_exclusions: Whether to apply customer/group exclusions
            limit: Max results to return
            offset: Pagination offset
            search: Optional SKU/name search filter
            shipping_method: Optional shipping method filter
        """
        from common.currency import convert_to_gbp, convert_to_eur
        from datetime import datetime, timedelta
        
        # Map region to table names and base currency
        region_mapping = {
            'uk': ('uk_orders_cache', 'GBP', convert_to_gbp),
            'fr': ('fr_orders_cache', 'EUR', convert_to_eur),
            'nl': ('nl_orders_cache', 'EUR', convert_to_eur)
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
                from dateutil.relativedelta import relativedelta
                date_threshold = datetime.now().date() - relativedelta(months=months)
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
            
            # Get exclusions if requested (now supports multiple rules per customer)
            excluded_customer_rules = {}
            excluded_groups = set()
            if use_exclusions:
                cursor.execute("""
                    SELECT customer_email, 
                           COALESCE(exclusion_rule_type, 'exclude_all') as rule_type,
                           COALESCE(exclusion_divisor, 2) as divisor,
                           exclusion_product_sku
                    FROM magento_region_filters
                    WHERE region = %s AND filter_type = 'excluded_customer'
                """, (region,))
                
                # Structure: { email: { 'base_rule': {...} or None, 'product_rules': { sku: {...} } } }
                for row in cursor.fetchall():
                    email = row[0]
                    rule_type = row[1]
                    divisor = float(row[2]) if row[2] else 2.0
                    product_sku = row[3]
                    
                    if email not in excluded_customer_rules:
                        excluded_customer_rules[email] = {'base_rule': None, 'product_rules': {}}
                    
                    if rule_type in ('exclude_all', 'divide_all'):
                        excluded_customer_rules[email]['base_rule'] = {
                            'rule_type': rule_type,
                            'divisor': divisor
                        }
                    elif rule_type == 'divide_product' and product_sku:
                        excluded_customer_rules[email]['product_rules'][product_sku] = {
                            'divisor': divisor
                        }
                
                cursor.execute("""
                    SELECT customer_group FROM magento_region_filters
                    WHERE region = %s AND filter_type = 'excluded_group'
                """, (region,))
                excluded_groups = {row[0] for row in cursor.fetchall()}
            
            # Get the thresholds for this region (if set)
            cursor.execute("""
                SELECT threshold_value FROM magento_region_filters 
                WHERE region = %s AND filter_type = 'threshold'
            """, (region,))
            threshold_row = cursor.fetchone()
            grand_total_threshold = threshold_row[0] if threshold_row else None
            
            cursor.execute("""
                SELECT qty_threshold_value FROM magento_region_filters 
                WHERE region = %s AND filter_type = 'qty_threshold'
            """, (region,))
            qty_row = cursor.fetchone()
            qty_threshold = qty_row[0] if qty_row else None
            
            # Get excluded order statuses
            excluded_statuses = set()
            if use_exclusions:
                cursor.execute("""
                    SELECT order_status FROM magento_region_filters
                    WHERE region = %s AND filter_type = 'excluded_status'
                """, (region,))
                excluded_statuses = {row[0] for row in cursor.fetchall()}
            
            # Get smart date rules
            date_rules = self.get_smart_date_rules(region) if use_exclusions else []
            
            # Get smart qty rules (multiple rules possible)
            smart_rules = self.get_smart_qty_rules(region)
            # Sort by threshold descending (highest first) for cutoff behavior
            if smart_rules:
                smart_rules = sorted(smart_rules, key=lambda r: r['threshold'], reverse=True)
            
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
                    s.created_at,
                    s.status
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
                        OR
                        -- If can't parse, include it (better to include than exclude)
                        NOT (s.created_at ~ '^[0-9]')
                    )
            """
            
            query_params = [date_threshold, date_threshold, date_threshold, date_threshold]
            
            # Add shipping method filter if specified
            if shipping_method:
                fetch_query += " AND s.shipping_method = %s"
                query_params.append(shipping_method)
            
            cursor.execute(fetch_query, query_params)
            all_rows = cursor.fetchall()
            
            # Filter and aggregate in Python with currency conversion
            sku_aggregates = {}
            
            for row in all_rows:
                sku, name, qty, grand_total, currency, customer_email, customer_group, created_at, status = row
                
                # Exclude FREE GIFT items from aggregated data (case-insensitive)
                # UK: "FREE GIFT", FR: "Cadeaux gratuits"
                name_lower = (name or '').lower()
                if 'free gift' in name_lower or 'cadeaux gratuits' in name_lower:
                    continue
                
                # Initialize qty_to_use for customer exclusion rule processing
                qty_to_use = qty or 0
                customer_rule_applied = False
                
                # Apply customer exclusion rules with dominance logic:
                # - exclude_all + divide_product(s): Exclude all EXCEPT specific products which get divided
                # - divide_all + divide_product(s): Divide all EXCEPT specific products with their own divisor
                # - Product-specific rules take precedence over base rules
                if use_exclusions and customer_email in excluded_customer_rules:
                    rules = excluded_customer_rules[customer_email]
                    base_rule = rules.get('base_rule')
                    product_rules = rules.get('product_rules', {})
                    
                    # Check if this product has a specific rule (takes precedence)
                    if sku in product_rules:
                        # Product-specific rule overrides base rule
                        divisor = product_rules[sku]['divisor']
                        if divisor and divisor > 0:
                            qty_to_use = qty_to_use / divisor
                        customer_rule_applied = True
                    elif base_rule:
                        # Apply base rule (no product-specific override)
                        if base_rule['rule_type'] == 'exclude_all':
                            # Skip this product (not in product_rules, so excluded)
                            continue
                        elif base_rule['rule_type'] == 'divide_all':
                            # Divide by base divisor (no product-specific override)
                            divisor = base_rule['divisor']
                            if divisor and divisor > 0:
                                qty_to_use = qty_to_use / divisor
                            customer_rule_applied = True
                    # If no base rule and not in product_rules, use original qty
                
                # Skip excluded customer groups
                if use_exclusions and customer_group in excluded_groups:
                    continue
                
                # Skip excluded statuses
                if use_exclusions and status in excluded_statuses:
                    continue
                
                # Apply quantity threshold filter
                if qty_threshold is not None and qty is not None and qty > qty_threshold:
                    continue
                
                # Apply grand total threshold filter with currency conversion
                if grand_total_threshold is not None and grand_total is not None:
                    converted_total = converter_func(float(grand_total), currency or base_currency)
                    if converted_total > float(grand_total_threshold):
                        continue
                
                # Parse created_at for date rules
                order_date = None
                if created_at:
                    try:
                        if '-' in created_at: # YYYY-MM-DD
                            order_date = datetime.strptime(created_at.split(' ')[0], '%Y-%m-%d').date()
                        elif '/' in created_at: # DD/MM/YYYY or MM/DD/YYYY
                            parts = created_at.split(' ')[0].split('/')
                            if len(parts) == 3:
                                try:
                                    order_date = datetime.strptime(created_at.split(' ')[0], '%d/%m/%Y').date()
                                except ValueError:
                                    try:
                                        order_date = datetime.strptime(created_at.split(' ')[0], '%m/%d/%Y').date()
                                    except ValueError:
                                        pass
                    except Exception:
                        pass
                
                # Apply smart date rules
                date_rule_applied = False
                should_skip_row = False
                if not customer_rule_applied:
                    qty_to_use = qty or 0
                
                if order_date and date_rules:
                    for rule in date_rules:
                        try:
                            rule_start = datetime.strptime(rule['start_date'], '%Y-%m-%d').date() if rule['start_date'] else None
                            rule_end = datetime.strptime(rule['end_date'], '%Y-%m-%d').date() if rule['end_date'] else None
                            
                            in_range = True
                            if rule_start and order_date < rule_start:
                                in_range = False
                            if rule_end and order_date > rule_end:
                                in_range = False
                            
                            if in_range:
                                action = rule['action']
                                value = rule['value']
                                
                                if action == 'exclude':
                                    qty_to_use = 0
                                    should_skip_row = True
                                    date_rule_applied = True
                                    break
                                elif action == 'divide' and value:
                                    qty_to_use = qty_to_use / value
                                elif action == 'multiply' and value:
                                    qty_to_use = qty_to_use * value
                                elif action == 'set_to' and value is not None:
                                    qty_to_use = value
                                
                                date_rule_applied = True
                                break
                        except Exception as e:
                            logger.error(f"Error checking date rule: {e}")
                
                if should_skip_row:
                    continue
                
                # Apply smart qty rules (only first matching rule - cutoff behavior)
                # Check from highest threshold to lowest
                if not date_rule_applied:
                    # Don't reset qty_to_use if customer rule already modified it
                    if not customer_rule_applied:
                        qty_to_use = qty or 0
                    if smart_rules and qty is not None:
                        for rule in smart_rules:
                            if qty >= rule['threshold']:
                                action = rule['action']
                                divisor = rule['divisor']
                                
                                if action == 'divide' and divisor:
                                    qty_to_use = (qty if not customer_rule_applied else qty_to_use) / divisor
                                elif action == 'multiply' and divisor:
                                    qty_to_use = (qty if not customer_rule_applied else qty_to_use) * divisor
                                elif action == 'subtract' and divisor:
                                    qty_to_use = max(0, (qty if not customer_rule_applied else qty_to_use) - divisor)
                                elif action == 'set_to' and divisor:
                                    qty_to_use = divisor
                                # Break after applying first matching rule (cutoff point)
                                break
                
                # Aggregate by SKU
                if sku not in sku_aggregates:
                    sku_aggregates[sku] = {'name': name, 'total_qty': 0}
                sku_aggregates[sku]['total_qty'] += qty_to_use
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
            
            # Add IDs for consistency with regular aggregated data
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
            tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache']
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

    # ===== AGGREGATED MAGENTO FILTER METHODS =====
    
    def search_customers(self, region: str, search_term: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Search for customers by email or name in magento data"""
        region_mapping = {
            'uk': 'uk_orders_cache',
            'fr': 'fr_orders_cache',
            'nl': 'nl_orders_cache'
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
        """Get list of excluded customers for a region with their exclusion rules"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            query = """
                SELECT 
                    id, customer_email, customer_full_name, 
                    added_by, added_at,
                    COALESCE(exclusion_rule_type, 'exclude_all') as exclusion_rule_type,
                    COALESCE(exclusion_divisor, 2) as exclusion_divisor,
                    exclusion_product_sku,
                    exclusion_product_name
                FROM magento_region_filters
                WHERE region = %s AND filter_type = 'excluded_customer'
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
                    "added_at": row[4].isoformat() if row[4] else None,
                    "rule_type": row[5] or "exclude_all",
                    "divisor": float(row[6]) if row[6] else 2.0,
                    "product_sku": row[7],
                    "product_name": row[8]
                })
            
            return customers
            
        except Exception as e:
            logger.error(f"Error getting excluded customers: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def add_excluded_customer(self, region: str, email: str, full_name: str, username: str,
                               rule_type: str = 'exclude_all', divisor: float = 2.0,
                               product_sku: str = None, product_name: str = None) -> Dict[str, Any]:
        """Add a customer to the exclusion list with rule configuration.
        
        Rule Dominance Logic:
        - exclude_all + divide_product(s): Exclude all EXCEPT specific products which get divided
        - divide_all + divide_product(s): Divide all by base divisor EXCEPT specific products with own divisor
        - exclude_all + divide_all: NOT ALLOWED (conflict - returns error)
        
        For base rules (exclude_all/divide_all): 
          - Can only have ONE base rule per customer (no duplicates)
          - Replaces existing base rule of SAME type (update divisor)
          - REJECTS if different base type exists (must delete first)
        For divide_product: Adds alongside existing base rule or other product rules
        """
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            if rule_type in ('exclude_all', 'divide_all'):
                # Check for existing base rule
                cursor.execute("""
                    SELECT id, exclusion_rule_type FROM magento_region_filters 
                    WHERE region = %s AND filter_type = 'excluded_customer' 
                    AND customer_email = %s AND exclusion_rule_type IN ('exclude_all', 'divide_all')
                """, (region, email))
                
                existing_base = cursor.fetchone()
                if existing_base:
                    existing_type = existing_base[1]
                    if existing_type != rule_type:
                        # Conflict: trying to add different base rule type
                        return {
                            "success": False,
                            "error": f"Cannot add '{rule_type}' - customer already has '{existing_type}' rule. Delete the existing rule first.",
                            "conflict": True
                        }
                    # Same type - update the existing rule
                    cursor.execute("""
                        UPDATE magento_region_filters 
                        SET exclusion_divisor = %s, updated_by = %s, updated_at = CURRENT_TIMESTAMP
                        WHERE id = %s
                        RETURNING id
                    """, (divisor, username, existing_base[0]))
                    result = cursor.fetchone()
                    conn.commit()
                    return {
                        "success": True,
                        "message": f"Updated {rule_type} rule for {email}",
                        "id": result[0]
                    }
                
                # No existing base rule - insert new one
                cursor.execute("""
                    INSERT INTO magento_region_filters 
                    (region, filter_type, customer_email, customer_full_name, added_by,
                     exclusion_rule_type, exclusion_divisor, exclusion_product_sku, exclusion_product_name)
                    VALUES (%s, 'excluded_customer', %s, %s, %s, %s, %s, NULL, NULL)
                    RETURNING id
                """, (region, email, full_name, username, rule_type, divisor))
            else:
                # For divide_product - can coexist with base rules
                # Insert or update the product-specific rule
                cursor.execute("""
                    INSERT INTO magento_region_filters 
                    (region, filter_type, customer_email, customer_full_name, added_by,
                     exclusion_rule_type, exclusion_divisor, exclusion_product_sku, exclusion_product_name)
                    VALUES (%s, 'excluded_customer', %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (region, filter_type, customer_email, exclusion_product_sku) 
                    WHERE filter_type = 'excluded_customer' AND exclusion_rule_type = 'divide_product'
                    DO UPDATE SET
                        exclusion_divisor = EXCLUDED.exclusion_divisor,
                        exclusion_product_name = EXCLUDED.exclusion_product_name,
                        updated_by = EXCLUDED.added_by,
                        updated_at = CURRENT_TIMESTAMP
                    RETURNING id
                """, (region, email, full_name, username, rule_type, divisor, product_sku, product_name))
            
            result = cursor.fetchone()
            conn.commit()
            
            if result:
                return {
                    "success": True,
                    "message": f"Customer {email} added/updated in exclusion list",
                    "id": result[0]
                }
            else:
                return {
                    "success": False,
                    "message": f"Failed to add customer {email}"
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
    
    def update_excluded_customer_rule(self, customer_id: int, rule_type: str, divisor: float = 2.0,
                                       product_sku: str = None, product_name: str = None,
                                       username: str = None) -> Dict[str, Any]:
        """Update the exclusion rule for an existing excluded customer"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                UPDATE magento_region_filters 
                SET exclusion_rule_type = %s,
                    exclusion_divisor = %s,
                    exclusion_product_sku = %s,
                    exclusion_product_name = %s,
                    updated_by = %s,
                    updated_at = CURRENT_TIMESTAMP
                WHERE id = %s AND filter_type = 'excluded_customer'
                RETURNING customer_email
            """, (rule_type, divisor, product_sku, product_name, username, customer_id))
            
            result = cursor.fetchone()
            conn.commit()
            
            if result:
                return {
                    "success": True,
                    "message": f"Exclusion rule updated for {result[0]}"
                }
            else:
                return {
                    "success": False,
                    "message": "Customer not found"
                }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error updating excluded customer rule: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def get_customer_products(self, region: str, customer_email: str, search: str = "") -> List[Dict[str, Any]]:
        """Get products that a customer has ordered in the past (for exclusion rule product selection)"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            table_name = f"{region}_orders_cache"
            
            # Search for products ordered by this customer
            query = f"""
                SELECT DISTINCT sku, name, SUM(qty) as total_qty
                FROM {table_name}
                WHERE customer_email = %s
            """
            params = [customer_email]
            
            if search:
                query += " AND (LOWER(sku) LIKE %s OR LOWER(name) LIKE %s)"
                search_pattern = f"%{search.lower()}%"
                params.extend([search_pattern, search_pattern])
            
            query += " GROUP BY sku, name ORDER BY total_qty DESC LIMIT 50"
            
            cursor.execute(query, params)
            rows = cursor.fetchall()
            
            products = []
            for row in rows:
                products.append({
                    "sku": row[0],
                    "name": row[1],
                    "total_qty": row[2]
                })
            
            return products
            
        except Exception as e:
            logger.error(f"Error getting customer products: {e}")
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
                DELETE FROM magento_region_filters 
                WHERE id = %s AND filter_type = 'excluded_customer'
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
                SELECT threshold_value FROM magento_region_filters
                WHERE region = %s AND filter_type = 'threshold'
            """, (region,))
            
            result = cursor.fetchone()
            return float(result[0]) if result and result[0] is not None else None
            
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
                INSERT INTO magento_region_filters 
                (region, filter_type, threshold_value, updated_by, updated_at)
                VALUES (%s, 'threshold', %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (region, filter_type) WHERE filter_type = 'threshold'
                DO UPDATE SET 
                    threshold_value = EXCLUDED.threshold_value,
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
                SELECT qty_threshold_value FROM magento_region_filters
                WHERE region = %s AND filter_type = 'qty_threshold'
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
                INSERT INTO magento_region_filters 
                (region, filter_type, qty_threshold_value, updated_by, updated_at)
                VALUES (%s, 'qty_threshold', %s, %s, CURRENT_TIMESTAMP)
                ON CONFLICT (region, filter_type) WHERE filter_type = 'qty_threshold'
                DO UPDATE SET 
                    qty_threshold_value = EXCLUDED.qty_threshold_value,
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
    
    def get_smart_qty_rules(self, region: str) -> List[Dict[str, Any]]:
        """Get all smart quantity rules for a region"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT id, smart_qty_threshold, smart_qty_action, smart_qty_divisor, smart_qty_rule_order
                FROM magento_region_filters
                WHERE region = %s AND filter_type = 'smart_qty_rule'
                ORDER BY smart_qty_rule_order
            """, (region,))
            
            rows = cursor.fetchall()
            rules = []
            for row in rows:
                if row[1] is not None:
                    rules.append({
                        'id': row[0],
                        'threshold': int(row[1]),
                        'action': row[2],
                        'divisor': float(row[3]) if row[3] else None,
                        'order': row[4]
                    })
            return rules
            
        except Exception as e:
            logger.error(f"Error getting smart qty rule: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def add_smart_qty_rule(self, region: str, threshold: int, action: str, divisor: float, username: str) -> Dict[str, Any]:
        """Add a smart quantity rule for a region"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Validate action
            valid_actions = ['divide', 'multiply', 'subtract', 'set_to']
            if action not in valid_actions:
                raise ValueError(f"Invalid action: {action}. Must be one of {valid_actions}")
            
            # Get next order number
            cursor.execute("""
                SELECT COALESCE(MAX(smart_qty_rule_order), 0) + 1
                FROM magento_region_filters
                WHERE region = %s AND filter_type = 'smart_qty_rule'
            """, (region,))
            next_order = cursor.fetchone()[0]
            
            cursor.execute("""
                INSERT INTO magento_region_filters 
                (region, filter_type, smart_qty_threshold, smart_qty_action, smart_qty_divisor, smart_qty_rule_order, added_by, added_at)
                VALUES (%s, 'smart_qty_rule', %s, %s, %s, %s, %s, CURRENT_TIMESTAMP)
                RETURNING id
            """, (region, threshold, action, divisor, next_order, username))
            
            result = cursor.fetchone()
            conn.commit()
            
            action_desc = f"{action} by {divisor}" if action != 'set_to' else f"set to {divisor}"
            return {
                "success": True,
                "message": f"Smart qty rule added: if qty >= {threshold}, {action_desc} for {region.upper()}",
                "id": result[0]
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error setting smart qty rule: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def remove_smart_qty_rule(self, rule_id: int) -> Dict[str, Any]:
        """Remove a specific smart quantity rule"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                DELETE FROM magento_region_filters 
                WHERE id = %s AND filter_type = 'smart_qty_rule'
                RETURNING smart_qty_threshold, smart_qty_action
            """, (rule_id,))
            
            result = cursor.fetchone()
            conn.commit()
            
            if result:
                return {
                    "success": True,
                    "message": f"Smart qty rule removed"
                }
            else:
                return {
                    "success": False,
                    "message": "No smart qty rule found to remove"
                }
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error removing smart qty rule: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)
    
    def clear_all_smart_qty_rules(self, region: str) -> Dict[str, Any]:
        """Clear all smart quantity rules for a region"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                DELETE FROM magento_region_filters 
                WHERE region = %s AND filter_type = 'smart_qty_rule'
            """, (region,))
            
            deleted_count = cursor.rowcount
            conn.commit()
            
            return {
                "success": True,
                "message": f"Cleared {deleted_count} smart qty rule(s) for {region.upper()}"
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error clearing smart qty rule: {e}")
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
            
            table_name = f"{region.lower()}_orders_cache"
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
                FROM magento_region_filters
                WHERE region = %s AND filter_type = 'excluded_group'
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
                INSERT INTO magento_region_filters 
                (region, filter_type, customer_group, added_by)
                VALUES (%s, 'excluded_group', %s, %s)
                ON CONFLICT (region, filter_type, customer_group) DO NOTHING
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
                DELETE FROM magento_region_filters 
                WHERE id = %s AND filter_type = 'excluded_group'
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


    def get_available_statuses(self, region: str) -> List[str]:
        """Get distinct order statuses from the region's cache table"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Map region to table name
            table_map = {
                'uk': 'uk_orders_cache',
                'fr': 'fr_orders_cache',
                'nl': 'nl_orders_cache',
                'test': 'test_magento_data'
            }
            
            if region.lower() == 'all':
                table_names = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache']
            else:
                table_name = table_map.get(region.lower())
                if not table_name:
                    return []
                table_names = [table_name]

            statuses = set()
            for table_name in table_names:
                # Check if table exists first to avoid errors during init
                cursor.execute(f"SELECT to_regclass('public.{table_name}')")
                if not cursor.fetchone()[0]:
                    continue

                cursor.execute(f"SELECT DISTINCT status FROM {table_name} WHERE status IS NOT NULL AND status != ''")
                statuses.update(row[0] for row in cursor.fetchall())

            return sorted(statuses)
            
        except Exception as e:
            logger.error(f"Error getting available statuses for {region}: {e}")
            return []
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)

    def get_excluded_statuses(self, region: str) -> List[Dict[str, Any]]:
        """Get list of excluded statuses for a region"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT id, order_status 
                FROM magento_region_filters 
                WHERE region = %s AND filter_type = 'excluded_status'
            """, (region,))
            
            results = []
            for row in cursor.fetchall():
                results.append({
                    "id": row[0],
                    "status": row[1]
                })
            
            return results
            
        except Exception as e:
            logger.error(f"Error getting excluded statuses: {e}")
            return []
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)

    def add_excluded_status(self, region: str, status: str) -> Dict[str, Any]:
        """Add a status to the exclusion list"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Check if already excluded
            cursor.execute("""
                SELECT id FROM magento_region_filters 
                WHERE region = %s AND filter_type = 'excluded_status' AND order_status = %s
            """, (region, status))
            
            if cursor.fetchone():
                return {
                    "success": False,
                    "message": "Status already excluded"
                }
            
            cursor.execute("""
                INSERT INTO magento_region_filters (region, filter_type, order_status)
                VALUES (%s, 'excluded_status', %s)
                RETURNING id
            """, (region, status))
            
            new_id = cursor.fetchone()[0]
            conn.commit()
            
            return {
                "success": True,
                "message": "Status added to exclusion list",
                "id": new_id,
                "order_status": status
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error adding excluded status: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)

    def remove_excluded_status(self, id: int) -> Dict[str, Any]:
        """Remove a status from the exclusion list"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                DELETE FROM magento_region_filters 
                WHERE id = %s
                RETURNING order_status
            """, (id,))
            
            result = cursor.fetchone()
            conn.commit()
            
            if result:
                return {
                    "success": True,
                    "message": f"Status '{result[0]}' removed from exclusion list"
                }
            else:
                return {
                    "success": False,
                    "message": "Status not found"
                }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error removing excluded status: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)

    def get_smart_date_rules(self, region: str) -> List[Dict[str, Any]]:
        """Get list of smart date rules for a region"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                SELECT id, date_rule_start, date_rule_end, date_rule_action, date_rule_value
                FROM magento_region_filters 
                WHERE region = %s AND filter_type = 'smart_date_rule'
                ORDER BY date_rule_start DESC
            """, (region,))
            
            results = []
            for row in cursor.fetchall():
                results.append({
                    "id": row[0],
                    "start_date": row[1].isoformat() if row[1] else None,
                    "end_date": row[2].isoformat() if row[2] else None,
                    "action": row[3],
                    "value": float(row[4]) if row[4] is not None else None
                })
            
            return results
            
        except Exception as e:
            logger.error(f"Error getting smart date rules for {region}: {e}")
            return []
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)

    def add_smart_date_rule(
        self, 
        region: str, 
        start_date: str, 
        end_date: str, 
        action: str, 
        value: Optional[float] = None
    ) -> Dict[str, Any]:
        """Add a smart date rule"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Check existing rules to avoid duplicates? Unique constraint handles it.
            
            cursor.execute("""
                INSERT INTO magento_region_filters 
                (region, filter_type, date_rule_start, date_rule_end, date_rule_action, date_rule_value)
                VALUES (%s, 'smart_date_rule', %s, %s, %s, %s)
                RETURNING id
            """, (region, start_date, end_date, action, value))
            
            new_id = cursor.fetchone()[0]
            conn.commit()
            
            return {
                "success": True,
                "message": "Date rule added successfully",
                "id": new_id
            }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error adding smart date rule: {e}")
            if "unique_date_rule" in str(e):
                return {"success": False, "message": "A rule for these dates already exists"}
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)

    def remove_smart_date_rule(self, rule_id: int) -> Dict[str, Any]:
        """Remove a smart date rule"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                DELETE FROM magento_region_filters 
                WHERE id = %s AND filter_type = 'smart_date_rule'
                RETURNING id
            """, (rule_id,))
            
            result = cursor.fetchone()
            conn.commit()
            
            if result:
                return {
                    "success": True,
                    "message": "Date rule removed successfully"
                }
            else:
                return {
                    "success": False,
                    "message": "Rule not found"
                }
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error removing smart date rule: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)

    # ===== ALL REGIONS (combined) METHODS =====

    def get_all_regions_data(self, limit: int = 100, offset: int = 0, search: str = "",
                             sort_by: str = None, sort_order: str = "desc",
                             statuses: list = None, date_from: str = None,
                             date_to: str = None) -> Dict[str, Any]:
        """Get combined full data from all regions with a region column."""
        all_columns = ['id', 'order_number', 'created_at', 'sku', 'name', 'qty',
                       'original_price', 'special_price', 'status', 'currency',
                       'grand_total', 'customer_email', 'customer_full_name',
                       'billing_address', 'shipping_address', 'shipping_method', 'customer_group_code',
                       'imported_at', 'updated_at']

        select_cols = ', '.join(all_columns)

        # Validate sort column
        allowed_sort = set(all_columns) | {'region'}
        order_column = 'imported_at'
        if sort_by and sort_by in allowed_sort:
            order_column = sort_by
        order_direction = 'DESC' if (sort_order or 'desc').upper() == 'DESC' else 'ASC'

        union_query = " UNION ALL ".join(
            f"SELECT {select_cols}, '{r.upper()}' AS region FROM {t}"
            for r, t in [('uk', 'uk_orders_cache'), ('fr', 'fr_orders_cache'), ('nl', 'nl_orders_cache')]
        )

        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()

            where, filter_params = self._build_full_data_filters(search, statuses, date_from, date_to)
            filter_params = tuple(filter_params)

            count_sql = f"SELECT COUNT(*) FROM ({union_query}) sub {where}"
            cursor.execute(count_sql, filter_params)
            total_count = cursor.fetchone()[0]

            data_sql = (f"SELECT * FROM ({union_query}) sub {where} "
                        f"ORDER BY {order_column} {order_direction} LIMIT %s OFFSET %s")
            cursor.execute(data_sql, filter_params + (limit, offset))

            rows = cursor.fetchall()
            result_columns = all_columns + ['region']
            data = []
            for row in rows:
                row_dict = {}
                for i, col in enumerate(result_columns):
                    value = row[i]
                    if col in ('imported_at', 'updated_at') and value:
                        row_dict[col] = value.isoformat() if hasattr(value, 'isoformat') else str(value)
                    else:
                        row_dict[col] = value
                data.append(row_dict)

            return {"data": data, "total_count": total_count, "limit": limit, "offset": offset}
        except Exception as e:
            logger.error(f"Error fetching all-regions data: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)

    def get_all_regions_aggregated_data(self, limit: int = 100, offset: int = 0, search: str = "",
                                         sort_by: str = "", sort_order: str = "desc") -> Dict[str, Any]:
        """
        Get 6-month aggregated data: UK 6M, FR 6M (FR+NL combined), and Total 6M.
        Returns three separate datasets.
        """
        allowed_columns = ['sku', 'name', 'total_qty', 'last_updated']
        order_column = sort_by if sort_by in allowed_columns else 'total_qty'
        order_direction = sort_order.upper() if sort_order and sort_order.upper() in ('ASC', 'DESC') else 'DESC'

        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()

            def fetch_aggregated(query_from, params_extra=()):
                if search:
                    sp = f"%{search}%"
                    where = "WHERE sku ILIKE %s OR name ILIKE %s"
                    count_q = f"SELECT COUNT(*) FROM ({query_from}) agg {where}"
                    cursor.execute(count_q, params_extra + (sp, sp))
                    total = cursor.fetchone()[0]
                    data_q = (f"SELECT sku, name, total_qty, last_updated FROM ({query_from}) agg "
                              f"{where} ORDER BY {order_column} {order_direction} LIMIT %s OFFSET %s")
                    cursor.execute(data_q, params_extra + (sp, sp, limit, offset))
                else:
                    count_q = f"SELECT COUNT(*) FROM ({query_from}) agg"
                    cursor.execute(count_q, params_extra)
                    total = cursor.fetchone()[0]
                    data_q = (f"SELECT sku, name, total_qty, last_updated FROM ({query_from}) agg "
                              f"ORDER BY {order_column} {order_direction} LIMIT %s OFFSET %s")
                    cursor.execute(data_q, params_extra + (limit, offset))
                rows = cursor.fetchall()
                data = []
                for row in rows:
                    data.append({
                        'sku': row[0],
                        'name': row[1],
                        'total_qty': row[2],
                        'last_updated': row[3].isoformat() if hasattr(row[3], 'isoformat') else str(row[3]) if row[3] else None
                    })
                return data, total

            # UK 6M - straight from uk_aggregated_orders
            uk_from = "SELECT sku, name, total_qty, last_updated FROM uk_aggregated_orders"
            uk_data, uk_total = fetch_aggregated(uk_from)

            # FR 6M - FR + NL combined: sum total_qty, pick latest last_updated, coalesce names
            fr_from = """
                SELECT sku,
                       COALESCE(MAX(name), '') AS name,
                       SUM(total_qty) AS total_qty,
                       MAX(last_updated) AS last_updated
                FROM (
                    SELECT sku, name, total_qty, last_updated FROM fr_aggregated_orders
                    UNION ALL
                    SELECT sku, name, total_qty, last_updated FROM nl_aggregated_orders
                ) combined
                GROUP BY sku
            """
            fr_data, fr_total = fetch_aggregated(fr_from)

            # Total 6M - all three combined
            total_from = """
                SELECT sku,
                       COALESCE(MAX(name), '') AS name,
                       SUM(total_qty) AS total_qty,
                       MAX(last_updated) AS last_updated
                FROM (
                    SELECT sku, name, total_qty, last_updated FROM uk_aggregated_orders
                    UNION ALL
                    SELECT sku, name, total_qty, last_updated FROM fr_aggregated_orders
                    UNION ALL
                    SELECT sku, name, total_qty, last_updated FROM nl_aggregated_orders
                ) combined
                GROUP BY sku
            """
            total_data, total_total = fetch_aggregated(total_from)

            return {
                "uk_data": uk_data, "uk_total_count": uk_total,
                "fr_data": fr_data, "fr_total_count": fr_total,
                "total_data": total_data, "total_total_count": total_total,
                "limit": limit, "offset": offset
            }
        except Exception as e:
            logger.error(f"Error fetching all-regions aggregated data: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)

    def get_all_regions_custom_range_data(self, range_type: str, range_value: str,
                                           use_exclusions: bool, limit: int = 100, offset: int = 0,
                                           search: str = "", shipping_method: str = "") -> Dict[str, Any]:
        """
        Get custom range aggregated data for all regions.
        Returns UK, FR (FR+NL combined), and Total datasets.
        """
        # Fetch each region's custom range data (these return dicts with 'data' and 'total_count')
        uk_result = self.get_aggregated_data_custom_range('uk', range_type, range_value, use_exclusions, 10000, 0, search, shipping_method)
        fr_result = self.get_aggregated_data_custom_range('fr', range_type, range_value, use_exclusions, 10000, 0, search, shipping_method)
        nl_result = self.get_aggregated_data_custom_range('nl', range_type, range_value, use_exclusions, 10000, 0, search, shipping_method)

        uk_all = uk_result.get('data', [])
        fr_all = fr_result.get('data', [])
        nl_all = nl_result.get('data', [])

        def combine_datasets(*datasets):
            """Combine multiple aggregated datasets by SKU, summing total_qty."""
            combined = {}
            for ds in datasets:
                for item in ds:
                    sku = item.get('sku', '')
                    if sku in combined:
                        combined[sku]['total_qty'] = (combined[sku].get('total_qty') or 0) + (item.get('total_qty') or 0)
                        if item.get('last_updated') and (not combined[sku].get('last_updated') or item['last_updated'] > combined[sku]['last_updated']):
                            combined[sku]['last_updated'] = item['last_updated']
                        if not combined[sku].get('name') and item.get('name'):
                            combined[sku]['name'] = item['name']
                    else:
                        combined[sku] = {
                            'sku': sku,
                            'name': item.get('name', ''),
                            'total_qty': item.get('total_qty') or 0,
                            'last_updated': item.get('last_updated')
                        }
            return sorted(combined.values(), key=lambda x: x.get('total_qty') or 0, reverse=True)

        # FR combined = FR + NL
        fr_combined = combine_datasets(fr_all, nl_all)
        # Total = UK + FR + NL
        total_combined = combine_datasets(uk_all, fr_all, nl_all)

        # Apply pagination
        def paginate(data):
            total = len(data)
            page = data[offset:offset + limit]
            return page, total

        uk_page, uk_total = paginate(uk_all)
        fr_page, fr_total = paginate(fr_combined)
        total_page, total_total = paginate(total_combined)

        return {
            "uk_data": uk_page, "uk_total_count": uk_total,
            "fr_data": fr_page, "fr_total_count": fr_total,
            "total_data": total_page, "total_total_count": total_total,
            "limit": limit, "offset": offset
        }

    def get_all_regions_aggregated_merged(self, limit: int = 100, offset: int = 0, search: str = "",
                                           sort_by: str = "", sort_order: str = "desc") -> Dict[str, Any]:
        """
        Get 6-month aggregated data as a single merged table.
        Each row: sku, name, uk_qty, fr_qty, total_qty, last_updated.
        FR qty = FR + NL combined.
        """
        allowed_columns = ['sku', 'name', 'uk_qty', 'fr_qty', 'total_qty', 'last_updated']
        order_column = sort_by if sort_by in allowed_columns else 'total_qty'
        order_direction = sort_order.upper() if sort_order and sort_order.upper() in ('ASC', 'DESC') else 'DESC'

        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()

            base_query = """
                SELECT
                    COALESCE(t.sku, f.sku, u.sku) AS sku,
                    COALESCE(t.name, f.name, u.name) AS name,
                    COALESCE(u.total_qty, 0) AS uk_qty,
                    COALESCE(f.total_qty, 0) AS fr_qty,
                    COALESCE(u.total_qty, 0) + COALESCE(f.total_qty, 0) AS total_qty,
                    GREATEST(u.last_updated, f.last_updated) AS last_updated
                FROM (
                    SELECT sku, COALESCE(MAX(name), '') AS name,
                           SUM(total_qty) AS total_qty, MAX(last_updated) AS last_updated
                    FROM (
                        SELECT sku, name, total_qty, last_updated FROM uk_aggregated_orders
                        UNION ALL
                        SELECT sku, name, total_qty, last_updated FROM fr_aggregated_orders
                        UNION ALL
                        SELECT sku, name, total_qty, last_updated FROM nl_aggregated_orders
                    ) all_regions GROUP BY sku
                ) t
                LEFT JOIN (
                    SELECT sku, name, total_qty, last_updated FROM uk_aggregated_orders
                ) u ON u.sku = t.sku
                LEFT JOIN (
                    SELECT sku, COALESCE(MAX(name), '') AS name,
                           SUM(total_qty) AS total_qty, MAX(last_updated) AS last_updated
                    FROM (
                        SELECT sku, name, total_qty, last_updated FROM fr_aggregated_orders
                        UNION ALL
                        SELECT sku, name, total_qty, last_updated FROM nl_aggregated_orders
                    ) fr_nl GROUP BY sku
                ) f ON f.sku = t.sku
            """

            if search:
                sp = f"%{search}%"
                count_q = f"SELECT COUNT(*) FROM ({base_query}) merged WHERE sku ILIKE %s OR name ILIKE %s"
                cursor.execute(count_q, (sp, sp))
                total = cursor.fetchone()[0]
                data_q = (f"SELECT sku, name, uk_qty, fr_qty, total_qty, last_updated "
                          f"FROM ({base_query}) merged WHERE sku ILIKE %s OR name ILIKE %s "
                          f"ORDER BY {order_column} {order_direction} LIMIT %s OFFSET %s")
                cursor.execute(data_q, (sp, sp, limit, offset))
            else:
                count_q = f"SELECT COUNT(*) FROM ({base_query}) merged"
                cursor.execute(count_q)
                total = cursor.fetchone()[0]
                data_q = (f"SELECT sku, name, uk_qty, fr_qty, total_qty, last_updated "
                          f"FROM ({base_query}) merged "
                          f"ORDER BY {order_column} {order_direction} LIMIT %s OFFSET %s")
                cursor.execute(data_q, (limit, offset))

            rows = cursor.fetchall()
            data = []
            for row in rows:
                data.append({
                    'sku': row[0],
                    'name': row[1],
                    'uk_qty': row[2] or 0,
                    'fr_qty': row[3] or 0,
                    'total_qty': row[4] or 0,
                    'last_updated': row[5].isoformat() if hasattr(row[5], 'isoformat') else str(row[5]) if row[5] else None
                })

            return {"data": data, "total_count": total, "limit": limit, "offset": offset}
        except Exception as e:
            logger.error(f"Error fetching all-regions aggregated merged data: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                return_products_connection(conn)

    def get_all_regions_custom_range_merged(self, range_type: str, range_value: str,
                                             use_exclusions: bool, limit: int = 100, offset: int = 0,
                                             search: str = "", sort_by: str = "", sort_order: str = "desc",
                                             shipping_method: str = "") -> Dict[str, Any]:
        """
        Get custom range aggregated data as a single merged table.
        Each row: sku, name, uk_qty, fr_qty, total_qty, last_updated.
        """
        uk_result = self.get_aggregated_data_custom_range('uk', range_type, range_value, use_exclusions, 10000, 0, '', shipping_method)
        fr_result = self.get_aggregated_data_custom_range('fr', range_type, range_value, use_exclusions, 10000, 0, '', shipping_method)
        nl_result = self.get_aggregated_data_custom_range('nl', range_type, range_value, use_exclusions, 10000, 0, '', shipping_method)

        uk_map = {item['sku']: item for item in uk_result.get('data', [])}
        fr_map = {}
        for item in fr_result.get('data', []) + nl_result.get('data', []):
            sku = item.get('sku', '')
            if sku in fr_map:
                fr_map[sku]['total_qty'] = (fr_map[sku].get('total_qty') or 0) + (item.get('total_qty') or 0)
                if item.get('last_updated') and (not fr_map[sku].get('last_updated') or item['last_updated'] > fr_map[sku]['last_updated']):
                    fr_map[sku]['last_updated'] = item['last_updated']
                if not fr_map[sku].get('name') and item.get('name'):
                    fr_map[sku]['name'] = item['name']
            else:
                fr_map[sku] = {**item}

        # Build merged list from all unique SKUs
        all_skus = set(list(uk_map.keys()) + list(fr_map.keys()))
        merged = []
        for sku in all_skus:
            uk_item = uk_map.get(sku, {})
            fr_item = fr_map.get(sku, {})
            uk_qty = uk_item.get('total_qty') or 0
            fr_qty = fr_item.get('total_qty') or 0
            name = uk_item.get('name') or fr_item.get('name') or ''
            lu_uk = uk_item.get('last_updated')
            lu_fr = fr_item.get('last_updated')
            last_updated = max(filter(None, [lu_uk, lu_fr]), default=None)
            merged.append({
                'sku': sku, 'name': name,
                'uk_qty': uk_qty, 'fr_qty': fr_qty,
                'total_qty': uk_qty + fr_qty,
                'last_updated': last_updated
            })

        # Filter by search
        if search:
            sl = search.lower()
            merged = [r for r in merged if sl in (r['sku'] or '').lower() or sl in (r['name'] or '').lower()]

        # Sort
        allowed_columns = ['sku', 'name', 'uk_qty', 'fr_qty', 'total_qty', 'last_updated']
        sort_key = sort_by if sort_by in allowed_columns else 'total_qty'
        reverse = sort_order.upper() != 'ASC'
        merged.sort(key=lambda x: x.get(sort_key) or 0 if sort_key in ('uk_qty', 'fr_qty', 'total_qty') else (x.get(sort_key) or ''), reverse=reverse)

        total_count = len(merged)
        page = merged[offset:offset + limit]

        return {"data": page, "total_count": total_count, "limit": limit, "offset": offset}
