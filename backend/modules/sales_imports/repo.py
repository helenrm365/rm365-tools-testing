from typing import List
import logging
from core.db import get_products_connection

logger = logging.getLogger(__name__)


class SalesImportsRepo:
    """Repository for sales imports data operations"""
    
    def __init__(self):
        pass
    
    def init_tables(self):
        """Initialize sales data tables if they don't exist"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Define the three tables to create
            tables = ['uk_sales_data', 'fr_sales_data', 'nl_sales_data']
            
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
                            price DECIMAL(10, 2) NOT NULL,
                            status VARCHAR(100) NOT NULL,
                            imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                        )
                    """
                    cursor.execute(create_table_sql)
                    logger.info(f"✅ Created table: {table_name}")
                else:
                    logger.info(f"ℹ️  Table already exists: {table_name}")
            
            conn.commit()
            return tables
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error initializing sales tables: {e}")
            raise
        finally:
            if conn:
                cursor.close()
                conn.close()
    
    def check_tables_exist(self) -> dict:
        """Check which tables exist"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            tables = ['uk_sales_data', 'fr_sales_data', 'nl_sales_data']
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
                conn.close()
