from typing import List, Dict, Any, Optional
import logging
import csv
import io
import json
from datetime import datetime
from core.db import get_products_connection, return_products_connection

logger = logging.getLogger(__name__)


class SalesDataRepo:
    """Repository for sales data operations"""
    
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
            
            # Create excluded customers table for 6M condensed sales filters
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'condensed_sales_excluded_customers'
                )
            """)
            
            if not cursor.fetchone()[0]:
                cursor.execute("""
                    CREATE TABLE condensed_sales_excluded_customers (
                        id SERIAL PRIMARY KEY,
                        region VARCHAR(10) NOT NULL,
                        customer_email VARCHAR(255) NOT NULL,
                        customer_full_name VARCHAR(255),
                        added_by VARCHAR(100),
                        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(region, customer_email)
                    )
                """)
                logger.info(f"✅ Created table: condensed_sales_excluded_customers")
            else:
                logger.info(f"ℹ️  Table already exists: condensed_sales_excluded_customers")
            
            # Create excluded customer groups table for 6M condensed sales filters
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'condensed_sales_excluded_customer_groups'
                )
            """)
            
            if not cursor.fetchone()[0]:
                cursor.execute("""
                    CREATE TABLE condensed_sales_excluded_customer_groups (
                        id SERIAL PRIMARY KEY,
                        region VARCHAR(10) NOT NULL,
                        customer_group VARCHAR(255) NOT NULL,
                        added_by VARCHAR(100),
                        added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        UNIQUE(region, customer_group)
                    )
                """)
                logger.info(f"✅ Created table: condensed_sales_excluded_customer_groups")
            else:
                logger.info(f"ℹ️  Table already exists: condensed_sales_excluded_customer_groups")
            
            # Create grand total threshold table for 6M condensed sales filters
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = 'condensed_sales_grand_total_threshold'
                )
            """)
            
            if not cursor.fetchone()[0]:
                cursor.execute("""
                    CREATE TABLE condensed_sales_grand_total_threshold (
                        id SERIAL PRIMARY KEY,
                        region VARCHAR(10) NOT NULL UNIQUE,
                        threshold DECIMAL(10, 2),
                        qty_threshold INTEGER,
                        updated_by VARCHAR(100),
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                """)
                logger.info(f"✅ Created table: condensed_sales_grand_total_threshold")
            else:
                logger.info(f"ℹ️  Table already exists: condensed_sales_grand_total_threshold")
                # Add qty_threshold column if it doesn't exist
                cursor.execute("""
                    SELECT column_name 
                    FROM information_schema.columns 
                    WHERE table_name = 'condensed_sales_grand_total_threshold' 
                    AND column_name = 'qty_threshold'
                """)
                if not cursor.fetchone():
                    cursor.execute("""
                        ALTER TABLE condensed_sales_grand_total_threshold 
                        ADD COLUMN qty_threshold INTEGER
                    """)
                    logger.info(f"✅ Added qty_threshold column to condensed_sales_grand_total_threshold")
            
            # Make threshold column nullable if it isn't already
            cursor.execute("""
                ALTER TABLE condensed_sales_grand_total_threshold 
                ALTER COLUMN threshold DROP NOT NULL
            """)

            
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
                return_products_connection(conn)
    
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
                return_products_connection(conn)
    
    def get_sales_data(self, table_name: str, limit: int = 100, offset: int = 0, search: str = "", fields: list = None) -> Dict[str, Any]:
        """Get sales data from a specific table with pagination, search, and optional field selection"""
        # Validate table name to prevent SQL injection
        valid_tables = ['uk_sales_data', 'fr_sales_data', 'nl_sales_data']
        if table_name not in valid_tables:
            raise ValueError(f"Invalid table name: {table_name}")
        
        # Define all available columns
        all_columns = ['id', 'order_number', 'created_at', 'sku', 'name', 'qty', 'price', 'status', 
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
                    # Expected column positions (0-indexed):
                    # 0: order_number
                    # 1: created_at
                    # 2: sku (Product SKU)
                    # 3: name (Product Name)
                    # 4: qty (Product Qty)
                    # 5: price (Product Price)
                    # 6: status
                    # 7: currency
                    # 8: grand_total
                    # 9: customer_email
                    # 10: customer_full_name
                    # 11: billing_address
                    # 12: shipping_address
                    # 13: customer_group_code
                    
                    if len(row) < 14:
                        errors.append(f"Row {row_num}: Not enough columns (expected 14, got {len(row)})")
                        continue
                    
                    order_number = row[0].strip() if len(row) > 0 else ''
                    created_at = row[1].strip() if len(row) > 1 else ''
                    sku = row[2].strip() if len(row) > 2 else ''
                    name = row[3].strip() if len(row) > 3 else ''
                    qty_str = row[4].strip() if len(row) > 4 else '0'
                    price_str = row[5].strip() if len(row) > 5 else '0'
                    status = row[6].strip() if len(row) > 6 else ''
                    currency = row[7].strip() if len(row) > 7 and row[7].strip() else None
                    grand_total_str = row[8].strip() if len(row) > 8 and row[8].strip() else ''
                    customer_email = row[9].strip() if len(row) > 9 and row[9].strip() else None
                    customer_full_name = row[10].strip() if len(row) > 10 and row[10].strip() else None
                    billing_address = row[11].strip() if len(row) > 11 and row[11].strip() else None
                    shipping_address = row[12].strip() if len(row) > 12 and row[12].strip() else None
                    customer_group_code = row[13].strip() if len(row) > 13 and row[13].strip() else None
                    
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
                        (order_number, created_at, sku, name, qty, price, status, currency, 
                         grand_total, customer_email, customer_full_name, billing_address, 
                         shipping_address, customer_group_code, imported_at, updated_at)
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """
                    now = datetime.utcnow()
                    cursor.execute(insert_query, (
                        order_number, created_at, sku, name, qty, price, status, currency, 
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
    
    def refresh_condensed_data(self, region: str) -> Dict[str, Any]:
        """
        Refresh condensed sales data for a region.
        Aggregates last 6 months of data by SKU, summing quantities.
        Uses sku_aliases table to combine related SKUs under their unified_sku.
        Applies currency conversion when filtering by grand_total threshold.
        """
        from common.currency import convert_to_gbp, convert_to_eur
        
        # Map region to table names and base currency
        region_mapping = {
            'uk': ('uk_sales_data', 'uk_condensed_sales', 'GBP', convert_to_gbp),
            'fr': ('fr_sales_data', 'fr_condensed_sales', 'EUR', convert_to_eur),
            'nl': ('nl_sales_data', 'nl_condensed_sales', 'EUR', convert_to_eur)
        }
        
        if region not in region_mapping:
            raise ValueError(f"Invalid region: {region}")
        
        sales_table, condensed_table, base_currency, converter_func = region_mapping[region]
        
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Clear existing condensed data
            cursor.execute(f"DELETE FROM {condensed_table}")
            
            # Get the thresholds for this region (if set)
            cursor.execute("""
                SELECT threshold, qty_threshold FROM condensed_sales_grand_total_threshold 
                WHERE region = %s
            """, (region,))
            threshold_row = cursor.fetchone()
            grand_total_threshold = threshold_row[0] if threshold_row else None
            qty_threshold = threshold_row[1] if threshold_row and len(threshold_row) > 1 else None
            
            logger.info(f"Refreshing {region} condensed data with threshold: {grand_total_threshold} {base_currency}, qty_threshold: {qty_threshold}")
            
            # Fetch all sales data from last 6 months with SKU aliases
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
            """
            
            cursor.execute(fetch_query)
            all_rows = cursor.fetchall()
            
            # Get excluded customers
            cursor.execute("""
                SELECT customer_email FROM condensed_sales_excluded_customers
                WHERE region = %s
            """, (region,))
            excluded_emails = {row[0] for row in cursor.fetchall()}
            
            # Get excluded customer groups
            cursor.execute("""
                SELECT customer_group FROM condensed_sales_excluded_customer_groups
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
                return_products_connection(conn)

    def auto_create_md_variant_aliases(self) -> Dict[str, Any]:
        """
        Automatically create SKU aliases for MD variants to merge with their base SKUs.
        For example: PROD123-MD -> PROD123, PROD123-MD-1225 -> PROD123, so sales data gets combined.
        """
        import re
        conn = None
        try:
            conn = get_products_connection()
            cursor = conn.cursor()
            
            # Get all unique SKUs from all sales tables that have -MD or -MD-xxxx patterns
            tables = ['uk_sales_data', 'fr_sales_data', 'nl_sales_data']
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

    # ===== CONDENSED SALES FILTER METHODS =====
    
    def search_customers(self, region: str, search_term: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Search for customers by email or name in sales data"""
        region_mapping = {
            'uk': 'uk_sales_data',
            'fr': 'fr_sales_data',
            'nl': 'nl_sales_data'
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
                FROM condensed_sales_excluded_customers
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
                INSERT INTO condensed_sales_excluded_customers 
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
                DELETE FROM condensed_sales_excluded_customers 
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
                SELECT threshold FROM condensed_sales_grand_total_threshold
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
                INSERT INTO condensed_sales_grand_total_threshold 
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
                SELECT qty_threshold FROM condensed_sales_grand_total_threshold
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
                INSERT INTO condensed_sales_grand_total_threshold 
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
            
            table_name = f"{region.lower()}_sales_data"
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
                FROM condensed_sales_excluded_customer_groups
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
                INSERT INTO condensed_sales_excluded_customer_groups 
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
                DELETE FROM condensed_sales_excluded_customer_groups 
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
