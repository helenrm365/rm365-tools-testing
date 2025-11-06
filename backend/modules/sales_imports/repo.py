from typing import List, Dict, Any, Optional
import logging
import csv
import io
import json
from datetime import datetime
from core.db import get_products_connection

logger = logging.getLogger(__name__)


class SalesImportsRepo:
    """Repository for sales imports data operations"""
    
    def __init__(self):
        pass
    
    def init_tables(self):
        """Initialize sales data tables and condensed tables if they don't exist"""
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Define the main sales data tables to create
            tables = ['uk_sales_data', 'fr_sales_data', 'nl_sales_data']
            condensed_tables = ['uk_condensed_sales', 'fr_condensed_sales', 'nl_condensed_sales']
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
            
            # Create main sales data tables
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
                
                all_tables.append(table_name)
            
            # Create condensed sales tables (6-month aggregated data)
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
                    # This table aggregates sales by SKU over the last 6 months
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
    
    def import_csv_data(self, table_name: str, csv_content: str, filename: str = None, username: str = None) -> Dict[str, Any]:
        """Import CSV data into a specific sales table using column positions"""
        # Validate table name to prevent SQL injection
        valid_tables = ['uk_sales_data', 'fr_sales_data', 'nl_sales_data']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")
        
        # Extract region from table name
        region = table_name.replace('_sales_data', '').upper()
        
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
                    # Expected column positions (1-indexed in description, 0-indexed in code):
                    # Column 1 (index 0): order_number
                    # Column 2 (index 1): created_at
                    # Column 3 (index 2): sku
                    # Column 4 (index 3): name
                    # Column 5 (index 4): qty
                    # Column 6 (index 5): price
                    # Column 7 (index 6): status
                    
                    if len(row) < 7:
                        errors.append(f"Row {row_num}: Not enough columns (expected 7, got {len(row)})")
                        continue
                    
                    order_number = row[0].strip() if len(row) > 0 else ''
                    created_at = row[1].strip() if len(row) > 1 else ''
                    sku = row[2].strip() if len(row) > 2 else ''
                    name = row[3].strip() if len(row) > 3 else ''
                    qty_str = row[4].strip() if len(row) > 4 else '0'
                    price_str = row[5].strip() if len(row) > 5 else '0'
                    status = row[6].strip() if len(row) > 6 else ''
                    
                    # Validate required fields
                    if not order_number or not sku:
                        errors.append(f"Row {row_num}: Missing order_number or SKU")
                        continue
                    
                    # Convert qty and price to appropriate types
                    try:
                        qty = int(float(qty_str))
                    except (ValueError, TypeError):
                        qty = 0
                    
                    try:
                        price = float(price_str)
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
                conn.close()
    
    def refresh_condensed_data(self, region: str) -> Dict[str, Any]:
        """
        Refresh condensed sales data for a region.
        Aggregates last 6 months of data by SKU, summing quantities.
        Uses sku_aliases table to combine related SKUs under their unified_sku.
        """
        # Map region to table names
        region_mapping = {
            'uk': ('uk_sales_data', 'uk_condensed_sales'),
            'fr': ('fr_sales_data', 'fr_condensed_sales'),
            'nl': ('nl_sales_data', 'nl_condensed_sales')
        }
        
        if region not in region_mapping:
            raise ValueError(f"Invalid region: {region}")
        
        sales_table, condensed_table = region_mapping[region]
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Clear existing condensed data
            cursor.execute(f"DELETE FROM {condensed_table}")
            
            # Aggregate data from last 6 months, using SKU aliases to unify related SKUs
            # The created_at field is a string, so we need to try to parse various date formats
            aggregate_query = f"""
                INSERT INTO {condensed_table} (sku, name, total_qty, last_updated)
                SELECT 
                    COALESCE(sa.unified_sku, s.sku) as sku,
                    MAX(s.name) as name,
                    SUM(s.qty) as total_qty,
                    CURRENT_TIMESTAMP as last_updated
                FROM {sales_table} s
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
                GROUP BY COALESCE(sa.unified_sku, s.sku)
                ORDER BY total_qty DESC
            """
            
            cursor.execute(aggregate_query)
            rows_affected = cursor.rowcount
            
            conn.commit()
            
            logger.info(f"✅ Refreshed {condensed_table}: {rows_affected} SKUs aggregated (with alias mapping)")
            
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
                conn.close()
    
    def get_condensed_data(self, region: str, limit: int = 100, offset: int = 0, search: str = "") -> Dict[str, Any]:
        """Get condensed sales data for a specific region"""
        # Map region to condensed table
        region_mapping = {
            'uk': 'uk_condensed_sales',
            'fr': 'fr_condensed_sales',
            'nl': 'nl_condensed_sales'
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
                conn.close()
    
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
                conn.close()
    
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
                conn.close()
    
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
                conn.close()
    
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
                    except:
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
                conn.close()
