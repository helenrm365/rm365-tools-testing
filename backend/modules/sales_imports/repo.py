from typing import List, Dict, Any, Optional
import logging
import csv
import io
from datetime import datetime
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
    
    def get_sales_data(self, table_name: str, limit: int = 100, offset: int = 0, search: str = "") -> Dict[str, Any]:
        """Get sales data from a specific table with pagination and search"""
        # Validate table name to prevent SQL injection
        valid_tables = ['uk_sales_data', 'fr_sales_data', 'nl_sales_data']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")
        
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
                """
                data_query = f"""
                    SELECT id, order_number, created_at, sku, name, qty, price, status, 
                           imported_at, updated_at
                    FROM {table_name}
                    WHERE order_number ILIKE %s 
                       OR sku ILIKE %s 
                       OR name ILIKE %s
                       OR status ILIKE %s
                    ORDER BY imported_at DESC
                    LIMIT %s OFFSET %s
                """
                cursor.execute(count_query, (search_pattern, search_pattern, search_pattern, search_pattern))
                total_count = cursor.fetchone()[0]
                
                cursor.execute(data_query, (search_pattern, search_pattern, search_pattern, search_pattern, limit, offset))
            else:
                count_query = f"SELECT COUNT(*) FROM {table_name}"
                data_query = f"""
                    SELECT id, order_number, created_at, sku, name, qty, price, status, 
                           imported_at, updated_at
                    FROM {table_name}
                    ORDER BY imported_at DESC
                    LIMIT %s OFFSET %s
                """
                cursor.execute(count_query)
                total_count = cursor.fetchone()[0]
                
                cursor.execute(data_query, (limit, offset))
            
            # Fetch all rows
            columns = ['id', 'order_number', 'created_at', 'sku', 'name', 'qty', 'price', 'status', 'imported_at', 'updated_at']
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
                conn.close()
    
    def import_csv_data(self, table_name: str, csv_content: str) -> Dict[str, Any]:
        """Import CSV data into a specific sales table"""
        # Validate table name to prevent SQL injection
        valid_tables = ['uk_sales_data', 'fr_sales_data', 'nl_sales_data']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Parse CSV
            csv_file = io.StringIO(csv_content)
            reader = csv.DictReader(csv_file)
            
            rows_imported = 0
            errors = []
            
            for row_num, row in enumerate(reader, start=2):  # Start at 2 because row 1 is header
                try:
                    # Map CSV columns to database columns (case-insensitive)
                    # Expected columns: order_number, created_at, sku, name, qty, price, status
                    row_lower = {k.lower().strip(): v for k, v in row.items()}
                    
                    # Extract required fields
                    order_number = row_lower.get('order_number') or row_lower.get('order number') or ''
                    created_at = row_lower.get('created_at') or row_lower.get('created at') or ''
                    sku = row_lower.get('sku') or ''
                    name = row_lower.get('name') or row_lower.get('product name') or ''
                    qty = row_lower.get('qty') or row_lower.get('quantity') or '0'
                    price = row_lower.get('price') or '0'
                    status = row_lower.get('status') or ''
                    
                    # Validate required fields
                    if not order_number or not sku:
                        errors.append(f"Row {row_num}: Missing order_number or SKU")
                        continue
                    
                    # Convert qty and price to appropriate types
                    try:
                        qty = int(float(qty))
                    except (ValueError, TypeError):
                        qty = 0
                    
                    try:
                        price = float(price)
                    except (ValueError, TypeError):
                        price = 0.0
                    
                    # Insert into database
                    insert_query = f"""
                        INSERT INTO {table_name} 
                        (order_number, created_at, sku, name, qty, price, status, imported_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                    now = datetime.utcnow()
                    cursor.execute(insert_query, (
                        order_number, created_at, sku, name, qty, price, status, now, now
                    ))
                    rows_imported += 1
                    
                except Exception as e:
                    errors.append(f"Row {row_num}: {str(e)}")
                    logger.error(f"Error importing row {row_num}: {e}")
            
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
                conn.close()
