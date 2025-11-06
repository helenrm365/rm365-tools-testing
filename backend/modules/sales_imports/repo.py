from __future__ import annotations
from typing import List, Dict, Any, Tuple
from datetime import datetime
import psycopg2
import psycopg2.extras
import logging
 
from core.db import get_products_connection
 
logger = logging.getLogger(__name__)
 
region_tables = {
    'uk': 'uk_sales_data',
    'fr': 'fr_sales_data',
    'nl': 'nl_sales_data'
}
 
 
class SalesImportsRepo:
    def __init__(self):
        self._table_checked = False
        self._tables_checked = {'uk': False, 'fr': False, 'nl': False}  # Track per-region
        self._sku_aliases_cache = None  # Cache for SKU aliases

    def resolve_table(self, region: str) -> str:
        """Resolve the sales data table name based on region"""
        r = (region or '').lower()
        if r not in region_tables:
            raise ValueError(f"Invalid region: {region}. Use one of:{', '.join(region_tables.keys())}")
        return region_tables[r]
   
    def filter_existing_orders(self, region: str, order_numbers: list[str]) -> list[str]:
        """Return only new order numbers that don't already exist in the region table"""
        if not order_numbers:
            return []
 
        table = self.resolve_table(region)
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(
                f"SELECT order_number FROM {table} WHERE order_number = ANY(%s)",
                (order_numbers,)
            )
            existing = {row[0] for row in cursor.fetchall()}
            new_orders = [o for o in order_numbers if o not in existing]
            return new_orders
        except Exception as e:
            logger.warning(f"Duplicate check failed for {region}: {e}")
            return order_numbers
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
 
    def get_connection(self):
        """Get PostgreSQL connection to Products database"""
        return get_products_connection()
 
    def _ensure_table_exists(self) -> None:
        """Ensure shared tables exist (import_history, sku_aliases) - only checks once per instance"""
        if self._table_checked:
            return
           
        try:
            self._init_shared_tables()
            self._table_checked = True
        except Exception as e:
            logger.warning(f"Could not ensure shared tables exist: {e}")
            # Still mark as checked to avoid repeated attempts
            self._table_checked = True
    
    def _init_shared_tables(self) -> None:
        """Initialize only the shared tables (import_history, sku_aliases)"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            
            # Create import history table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sales_import_history (
                    id SERIAL PRIMARY KEY,
                    filename VARCHAR(500) NOT NULL,
                    region VARCHAR(10) NOT NULL,
                    uploaded_by VARCHAR(255) NOT NULL,
                    user_email VARCHAR(255),
                    total_rows INTEGER NOT NULL DEFAULT 0,
                    imported_rows INTEGER NOT NULL DEFAULT 0,
                    errors_count INTEGER NOT NULL DEFAULT 0,
                    status VARCHAR(50) NOT NULL DEFAULT 'pending',
                    error_details TEXT,
                    imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_import_history_region
                ON sales_import_history(region)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_import_history_uploaded_by
                ON sales_import_history(uploaded_by)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_import_history_imported_at
                ON sales_import_history(imported_at DESC)
            """)
            
            # Create SKU aliases table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sku_aliases (
                    id SERIAL PRIMARY KEY,
                    alias_sku VARCHAR(255) NOT NULL UNIQUE,
                    unified_sku VARCHAR(255) NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sku_aliases_alias
                ON sku_aliases(alias_sku)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sku_aliases_unified
                ON sku_aliases(unified_sku)
            """)
            
            conn.commit()
            logger.info("✅ Shared sales import tables initialized successfully")
           
        except psycopg2.Error as e:
            conn.rollback()
            logger.error(f"Database error in _init_shared_tables: {e}")
            raise
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    
    
    def _ensure_region_table_exists(self, region: str) -> None:
        """Ensure the table exists for a specific region (only checks once per region per instance)"""
        region = region.lower()
        if region not in self._tables_checked:
            raise ValueError(f"Invalid region: {region}")
            
        if self._tables_checked[region]:
            return
           
        try:
            # Use the new ensure_all_tables_exist method which checks all tables at once
            self.ensure_all_tables_exist()
            self._tables_checked[region] = True
        except Exception as e:
            logger.warning(f"Could not ensure {region} table exists: {e}")
            # Still mark as checked to avoid repeated attempts
            self._tables_checked[region] = True

    def ensure_all_tables_exist(self) -> Dict[str, Any]:
        """
        Check and create all 6 sales tables if they don't exist:
        - uk_sales_data, fr_sales_data, nl_sales_data
        - uk_condensed_sales, fr_condensed_sales, nl_condensed_sales
        Returns a status dictionary with information about created tables
        """
        conn = self.get_connection()
        created_tables = []
        existing_tables = []
        
        try:
            cursor = conn.cursor()
            
            # Define all tables with their schemas
            tables_to_check = [
                ('uk_sales_data', 'uk'),
                ('fr_sales_data', 'fr'),
                ('nl_sales_data', 'nl'),
                ('uk_condensed_sales', 'uk_condensed'),
                ('fr_condensed_sales', 'fr_condensed'),
                ('nl_condensed_sales', 'nl_condensed')
            ]
            
            for table_name, table_type in tables_to_check:
                # Check if table exists
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = %s
                    )
                """, (table_name,))
                
                table_exists = cursor.fetchone()[0]
                
                if table_exists:
                    existing_tables.append(table_name)
                    logger.info(f"✓ Table {table_name} already exists")
                else:
                    # Create the table
                    if 'condensed' in table_type:
                        # Create condensed sales table
                        cursor.execute(f"""
                            CREATE TABLE {table_name} (
                                id SERIAL PRIMARY KEY,
                                sku VARCHAR(255) NOT NULL,
                                product_name TEXT,
                                total_qty INTEGER NOT NULL DEFAULT 0,
                                start_date DATE,
                                end_date DATE,
                                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                            )
                        """)
                        
                        cursor.execute(f"""
                            CREATE INDEX idx_{table_name}_sku ON {table_name}(sku)
                        """)
                    else:
                        # Create sales data table
                        cursor.execute(f"""
                            CREATE TABLE {table_name} (
                                id SERIAL PRIMARY KEY,
                                order_number VARCHAR(255) NOT NULL,
                                created_at TIMESTAMP NOT NULL,
                                sku VARCHAR(255) NOT NULL,
                                name TEXT NOT NULL,
                                qty INTEGER NOT NULL DEFAULT 1,
                                price NUMERIC(10, 2) NOT NULL DEFAULT 0.0,
                                status VARCHAR(100),
                                imported_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                            )
                        """)
                        
                        # Create indexes
                        cursor.execute(f"""
                            CREATE INDEX idx_{table_name}_order_number ON {table_name}(order_number)
                        """)
                        cursor.execute(f"""
                            CREATE INDEX idx_{table_name}_sku ON {table_name}(sku)
                        """)
                        cursor.execute(f"""
                            CREATE INDEX idx_{table_name}_created_at ON {table_name}(created_at)
                        """)
                        cursor.execute(f"""
                            CREATE INDEX idx_{table_name}_status ON {table_name}(status)
                        """)
                    
                    created_tables.append(table_name)
                    logger.info(f"✓ Created table {table_name}")
            
            conn.commit()
            
            return {
                'status': 'success',
                'created_tables': created_tables,
                'existing_tables': existing_tables,
                'message': f'Tables initialized: {len(created_tables)} created, {len(existing_tables)} already existed'
            }
            
        except psycopg2.Error as e:
            conn.rollback()
            logger.error(f"Database error in ensure_all_tables_exist: {e}")
            return {
                'status': 'error',
                'message': f'Failed to initialize tables: {str(e)}'
            }
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
 
    def get_uk_sales_data(self, limit: int = 100, offset: int = 0, search: str = "") -> Tuple[List[Dict[str, Any]], int]:
        """Get UK sales data with pagination and search"""
        # Try to ensure table exists
        self._ensure_region_table_exists('uk')
       
        conn = self.get_connection()
        cursor = None
        count_cursor = None
        try:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
           
            base_query = """
                SELECT id, order_number, created_at, sku, name, qty, price, status, imported_at, updated_at
                FROM uk_sales_data
            """
            count_query = "SELECT COUNT(*) as count FROM uk_sales_data"
           
            params = []
            if search:
                search_condition = """
                    WHERE order_number ILIKE %s
                    OR sku ILIKE %s
                    OR name ILIKE %s
                    OR status ILIKE %s
                """
                base_query += search_condition
                count_query += search_condition.replace(" as count", "")
                search_param = f"%{search}%"
                params = [search_param, search_param, search_param, search_param]
           
            count_cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            count_cursor.execute(count_query, params)
            count_result = count_cursor.fetchone()
            total = count_result['count'] if count_result else 0
            count_cursor.close()
           
            base_query += " ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])
           
            cursor.execute(base_query, params)
            rows = cursor.fetchall()
           
            sales_data = []
            for row in rows:
                item = dict(row)
                if isinstance(item.get('created_at'), datetime):
                    item['created_at'] = item['created_at'].isoformat()
                if isinstance(item.get('imported_at'), datetime):
                    item['imported_at'] = item['imported_at'].isoformat()
                if isinstance(item.get('updated_at'), datetime):
                    item['updated_at'] = item['updated_at'].isoformat()
                if item.get('price'):
                    item['price'] = float(item['price'])
                sales_data.append(item)
           
            return sales_data, total
           
        except psycopg2.Error as e:
            logger.error(f"Database error in get_uk_sales_data: {e}")
            raise
        finally:
            if count_cursor:
                count_cursor.close()
            if cursor:
                cursor.close()
            if conn:
                conn.close()
 
    def save_uk_sales_data(self, data: Dict[str, Any]) -> int:
        """Save UK sales data to the database"""
        # Ensure table exists before attempting to save
        self._ensure_region_table_exists('uk')
       
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO uk_sales_data
                (order_number, created_at, sku, name, qty, price, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                data['order_number'],
                data['created_at'],
                data['sku'],
                data['name'],
                data['qty'],
                data['price'],
                data.get('status', '')
            ))
            row_id = cursor.fetchone()[0]
            conn.commit()
            return row_id
           
        except psycopg2.Error as e:
            conn.rollback()
            logger.error(f"Database error in save_uk_sales_data: {e}")
            raise
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
 
    def bulk_insert_uk_sales_data(self, data_list: List[Dict[str, Any]]) -> int:
        """Bulk insert UK sales data for better performance"""
        # Ensure table exists before attempting to save
        self._ensure_region_table_exists('uk')

         # Deduplicate by order_number  
        new_orders = set(self.filter_existing_orders('uk', [i['order_number'] for i in data_list]))
        filtered = [i for i in data_list if i['order_number'] in new_orders]
        if not filtered:
            return 0
       
        conn = None
        cursor = None
        
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            values = [
                (
                    item['order_number'],
                    item['created_at'],
                    item['sku'],
                    item['name'],
                    item['qty'],
                    item['price'],
                    item.get('status', '')
                )
                for item in filtered
            ]
           
            psycopg2.extras.execute_batch(
                cursor,
                """
                INSERT INTO uk_sales_data
                (order_number, created_at, sku, name, qty, price, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                values,
                page_size=100
            )
           
            conn.commit()
            return len(values)
           
        except psycopg2.Error as e:
            conn.rollback()
            logger.error(f"Database error in bulk_insert_uk_sales_data: {e}")
            raise
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
   
    def bulk_insert_fr_sales_data(self, data_list: List[Dict[str, Any]]) -> int:
        """Bulk insert FR sales data for better performance"""
        # Ensure table exists before attempting to save
        self._ensure_region_table_exists('fr')
        
         # Deduplicate by order_number  
        new_orders = set(self.filter_existing_orders('fr', [i['order_number'] for i in data_list]))
        filtered = [i for i in data_list if i['order_number'] in new_orders]
        if not filtered:
                return 0
       
        conn = None
        cursor = None
 
        try:
             
            conn = self.get_connection()
            cursor = conn.cursor()
           
            values = [
                (
                    item['order_number'],
                    item['created_at'],
                    item['sku'],
                    item['name'],
                    item['qty'],
                    item['price'],
                    item.get('status', '')
                )
                for item in filtered
            ]
           
            psycopg2.extras.execute_batch(
                cursor,
                """
                INSERT INTO fr_sales_data
                (order_number, created_at, sku, name, qty, price, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                values,
                page_size=100
            )
           
            conn.commit()
            return len(values)
           
        except psycopg2.Error as e:
            conn.rollback()
            logger.error(f"Database error in bulk_insert_fr_sales_data: {e}")
            raise
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
 
    def bulk_insert_nl_sales_data(self, data_list: List[Dict[str, Any]]) -> int:
        """Bulk insert NL sales data for better performance"""
        # Ensure table exists before attempting to save
        self._ensure_region_table_exists('nl')
        
        # Deduplicate by order_number  
        new_orders = set(self.filter_existing_orders('nl', [i['order_number'] for i in data_list]))
        filtered = [i for i in data_list if i['order_number'] in new_orders]
        if not filtered:
             return 0
        
        conn = None
        cursor = None
        
        try:
            
            conn = self.get_connection()
            cursor = conn.cursor()
           
            values = [
                (
                    item['order_number'],
                    item['created_at'],
                    item['sku'],
                    item['name'],
                    item['qty'],
                    item['price'],
                    item.get('status', '')
                )
                for item in filtered
            ]
           
            psycopg2.extras.execute_batch(
                cursor,
                """
                INSERT INTO nl_sales_data
                (order_number, created_at, sku, name, qty, price, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                """,
                values,
                page_size=100
            )
           
            conn.commit()
            return len(values)
           
        except psycopg2.Error as e:
            conn.rollback()
            logger.error(f"Database error in bulk_insert_nl_sales_data: {e}")
            raise
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
 
    def delete_uk_sales_data(self, record_id: int) -> bool:
        """Delete a UK sales data record"""
        # Ensure table exists before attempting to delete
        self._ensure_region_table_exists('uk')
       
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM uk_sales_data WHERE id = %s", (record_id,))
            deleted = cursor.rowcount > 0
            conn.commit()
            return deleted
           
        except psycopg2.Error as e:
            conn.rollback()
            logger.error(f"Database error in delete_uk_sales_data: {e}")
            raise
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
 
    def get_uk_sales_stats(self) -> Dict[str, Any]:
        """Get statistics for UK sales data"""
        # Ensure table exists before attempting to query
        self._ensure_region_table_exists('uk')
       
        conn = self.get_connection()
        try:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
           
            cursor.execute("""
                SELECT
                    COUNT(*) as total_records,
                    COALESCE(SUM(qty), 0) as total_quantity,
                    COALESCE(SUM(qty * price), 0) as total_value,
                    COUNT(DISTINCT order_number) as unique_orders,
                    COUNT(DISTINCT sku) as unique_products
                FROM uk_sales_data
            """)
           
            stats = dict(cursor.fetchone())
           
            if stats.get('total_value'):
                stats['total_value'] = float(stats['total_value'])
           
            return stats
           
        except psycopg2.Error as e:
            logger.error(f"Database error in get_uk_sales_stats: {e}")
            return {
                'total_records': 0,
                'total_quantity': 0,
                'total_value': 0.0,
                'unique_orders': 0,
                'unique_products': 0
            }
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()

    def get_condensed_sales_paginated(self, region: str, limit: int = 100, offset: int = 0, search: str = "") -> Tuple[List[Dict[str, Any]], int]:
        """Get condensed sales data with pagination and search"""
        condensed_tables = {
            'uk': 'uk_condensed_sales',
            'fr': 'fr_condensed_sales',
            'nl': 'nl_condensed_sales'
        }
        
        r = region.lower()
        if r not in condensed_tables:
            raise ValueError(f"Invalid region: {region}")
        
        table = condensed_tables[r]
        self._ensure_region_table_exists(r)
        
        conn = self.get_connection()
        try:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Build search condition
            search_condition = ""
            search_params = []
            if search:
                search_condition = "WHERE sku ILIKE %s OR product_name ILIKE %s"
                search_params = [f"%{search}%", f"%{search}%"]
            
            # Get total count
            count_query = f"SELECT COUNT(*) FROM {table} {search_condition}"
            cursor.execute(count_query, search_params)
            total = cursor.fetchone()['count']
            
            # Get paginated data
            query = f"""
                SELECT id, sku, product_name, total_qty, 
                       start_date, end_date, updated_at
                FROM {table}
                {search_condition}
                ORDER BY total_qty DESC, sku ASC
                LIMIT %s OFFSET %s
            """
            cursor.execute(query, search_params + [limit, offset])
            rows = cursor.fetchall()
            
            # Convert dates to ISO format strings
            results = []
            for row in rows:
                row_dict = dict(row)
                if row_dict.get('start_date'):
                    row_dict['start_date'] = row_dict['start_date'].isoformat()
                if row_dict.get('end_date'):
                    row_dict['end_date'] = row_dict['end_date'].isoformat()
                if row_dict.get('updated_at'):
                    row_dict['updated_at'] = row_dict['updated_at'].isoformat()
                results.append(row_dict)
            
            return results, total
            
        except psycopg2.Error as e:
            logger.error(f"Database error in get_condensed_sales_paginated: {e}")
            return [], 0
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()

    def update_condensed_sales(self,region: str):
        """Update condensed sales summary for the past 6 months for a given region"""
        condensed_tables = {
            'uk': 'uk_condensed_sales',
            'fr': 'fr_condensed_sales',
            'nl': 'nl_condensed_sales'
        }
        r = region.lower()
        if r not in region_tables or r not in condensed_tables:
            raise ValueError(f"Invalid region: {region}.  Must be one of {', '.join(region_tables)}")

        source_table = region_tables[r]
        target_table = condensed_tables[r]

        conn = None
        cursor = None
        try:
            conn = self.get_connection()
            cursor = conn.cursor()
            cursor.execute(f"TRUNCATE TABLE {target_table}")
            cursor.execute(f"""
                INSERT INTO {target_table} (sku, product_name, total_qty, start_date, end_date)
                SELECT
                    sku,
                    MIN(name) AS product_name,
                    SUM(qty) AS total_qty,
                    MIN(created_at)::DATE AS start_date,
                    MAX(created_at)::DATE AS end_date
                FROM {source_table}
                WHERE created_at >= CURRENT_DATE - INTERVAL '6 months'
                GROUP BY sku;
                """)
            conn.commit()
            logger.info(f"{r.upper()} condensed sales updated.")
        except psycopg2.Error as e:
            conn.rollback()
            logger.error(f"Error updating condensed sales for {r.upper()}: {e}")
            raise
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()

    def save_import_history(self, history_data: Dict[str, Any]) -> int:
        """Save import history record"""
        self._ensure_table_exists()
        
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO sales_import_history
                (filename, region, uploaded_by, user_email, total_rows, imported_rows, 
                 errors_count, status, error_details)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                history_data.get('filename', ''),
                history_data.get('region', 'uk'),
                history_data.get('uploaded_by', 'Unknown'),
                history_data.get('user_email', ''),
                history_data.get('total_rows', 0),
                history_data.get('imported_rows', 0),
                history_data.get('errors_count', 0),
                history_data.get('status', 'pending'),
                str(history_data.get('errors', []))[:1000] if history_data.get('errors') else None
            ))
            history_id = cursor.fetchone()[0]
            conn.commit()
            logger.info(f"Import history saved: ID={history_id}, file={history_data.get('filename')}")
            return history_id
        except psycopg2.Error as e:
            conn.rollback()
            logger.error(f"Database error in save_import_history: {e}")
            return 0  # Return 0 on error but don't fail the import
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
 
    def get_import_history(self, limit: int = 100, offset: int = 0, region: str = "") -> Tuple[List[Dict[str, Any]], int]:
        """Get import history with pagination and optional region filter"""
        self._ensure_table_exists()
        
        conn = self.get_connection()
        try:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            
            # Build query with optional region filter
            where_clause = ""
            params = []
            if region and region.lower() in ['uk', 'fr', 'nl']:
                where_clause = "WHERE region = %s"
                params.append(region.lower())
            
            # Get total count
            count_query = f"SELECT COUNT(*) FROM sales_import_history {where_clause}"
            cursor.execute(count_query, params)
            total = cursor.fetchone()['count']
            
            # Get paginated data
            query = f"""
                SELECT id, filename, region, uploaded_by, user_email,
                       total_rows, imported_rows, errors_count, status,
                       error_details, imported_at
                FROM sales_import_history
                {where_clause}
                ORDER BY imported_at DESC
                LIMIT %s OFFSET %s
            """
            cursor.execute(query, params + [limit, offset])
            rows = cursor.fetchall()
            
            # Convert timestamps to ISO format strings
            results = []
            for row in rows:
                row_dict = dict(row)
                if row_dict.get('imported_at'):
                    row_dict['imported_at'] = row_dict['imported_at'].isoformat()
                results.append(row_dict)
            
            return results, total
            
        except psycopg2.Error as e:
            logger.error(f"Database error in get_import_history: {e}")
            return [], 0
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    
    def get_sku_aliases(self) -> Dict[str, str]:
        """
        Get SKU aliases mapping: {alias_sku: unified_sku}
        Results are cached for the lifetime of the repo instance.
        """
        if self._sku_aliases_cache is not None:
            return self._sku_aliases_cache
        
        self._ensure_table_exists()
        conn = self.get_connection()
        
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT alias_sku, unified_sku
                FROM sku_aliases
                WHERE alias_sku IS NOT NULL 
                  AND unified_sku IS NOT NULL
                  AND alias_sku != ''
                  AND unified_sku != ''
            """)
            
            aliases = {}
            for row in cursor.fetchall():
                alias_sku = row[0].strip()
                unified_sku = row[1].strip()
                if alias_sku and unified_sku:
                    aliases[alias_sku] = unified_sku
            
            self._sku_aliases_cache = aliases
            logger.info(f"Loaded {len(aliases)} SKU aliases from database")
            return aliases
            
        except psycopg2.Error as e:
            logger.error(f"Database error loading SKU aliases: {e}")
            self._sku_aliases_cache = {}
            return {}
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()
    
    def convert_sku_if_alias(self, sku: str) -> str:
        """
        Convert a SKU to its unified version if it's an alias.
        Returns the unified SKU if found, otherwise returns the original SKU.
        """
        if not sku:
            return sku
        
        aliases = self.get_sku_aliases()
        sku_stripped = sku.strip()
        
        if sku_stripped in aliases:
            unified = aliases[sku_stripped]
            logger.debug(f"Converting alias SKU '{sku_stripped}' to unified SKU '{unified}'")
            return unified
        
        return sku_stripped
    
    def save_sales_data(self, data: Dict[str, Any], region: str = 'uk') -> int:
        """Save sales data to the specified region table with SKU alias conversion"""
        self._ensure_region_table_exists(region)
        table = self.resolve_table(region)
        
        # Convert SKU if it's an alias
        original_sku = data.get('sku', '')
        converted_sku = self.convert_sku_if_alias(original_sku)
        
        # Log conversion if SKU changed
        if original_sku != converted_sku:
            logger.info(f"SKU conversion: '{original_sku}' → '{converted_sku}' for order {data.get('order_number', 'unknown')}")
       
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(f"""
                INSERT INTO {table}
                (order_number, created_at, sku, name, qty, price, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id
            """, (
                data['order_number'],
                data['created_at'],
                converted_sku,  # Use converted SKU instead of original
                data['name'],
                data['qty'],
                data['price'],
                data.get('status', '')
            ))
            row_id = cursor.fetchone()[0]
            conn.commit()
            return row_id
           
        except psycopg2.Error as e:
            conn.rollback()
            logger.error(f"Database error in save_sales_data: {e}")
            raise
        finally:
            if cursor:
                cursor.close()
            if conn:
                conn.close()

    def get_fr_sales_data(self, limit: int = 100, offset: int = 0, search: str = "") -> Tuple[List[Dict[str, Any]], int]:
        """Get FR sales data with pagination and search"""
        self._ensure_region_table_exists('fr')
       
        conn = self.get_connection()
        cursor = None
        count_cursor = None
        try:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
           
            base_query = """
                SELECT id, order_number, created_at, sku, name, qty, price, status, imported_at, updated_at
                FROM fr_sales_data
            """
            count_query = "SELECT COUNT(*) as count FROM fr_sales_data"
           
            params = []
            if search:
                search_condition = """
                    WHERE order_number ILIKE %s
                    OR sku ILIKE %s
                    OR name ILIKE %s
                    OR status ILIKE %s
                """
                base_query += search_condition
                count_query += search_condition.replace(" as count", "")
                search_param = f"%{search}%"
                params = [search_param, search_param, search_param, search_param]
           
            count_cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            count_cursor.execute(count_query, params)
            count_result = count_cursor.fetchone()
            total = count_result['count'] if count_result else 0
            count_cursor.close()
           
            base_query += " ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])
           
            cursor.execute(base_query, params)
            rows = cursor.fetchall()
           
            sales_data = []
            for row in rows:
                item = dict(row)
                if isinstance(item.get('created_at'), datetime):
                    item['created_at'] = item['created_at'].isoformat()
                if isinstance(item.get('imported_at'), datetime):
                    item['imported_at'] = item['imported_at'].isoformat()
                if isinstance(item.get('updated_at'), datetime):
                    item['updated_at'] = item['updated_at'].isoformat()
                if item.get('price'):
                    item['price'] = float(item['price'])
                sales_data.append(item)
           
            return sales_data, total
           
        except psycopg2.Error as e:
            logger.error(f"Database error in get_fr_sales_data: {e}")
            raise
        finally:
            if count_cursor:
                count_cursor.close()
            if cursor:
                cursor.close()
            if conn:
                conn.close()

    def get_nl_sales_data(self, limit: int = 100, offset: int = 0, search: str = "") -> Tuple[List[Dict[str, Any]], int]:
        """Get NL sales data with pagination and search"""
        self._ensure_region_table_exists('nl')
       
        conn = self.get_connection()
        cursor = None
        count_cursor = None
        try:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
           
            base_query = """
                SELECT id, order_number, created_at, sku, name, qty, price, status, imported_at, updated_at
                FROM nl_sales_data
            """
            count_query = "SELECT COUNT(*) as count FROM nl_sales_data"
           
            params = []
            if search:
                search_condition = """
                    WHERE order_number ILIKE %s
                    OR sku ILIKE %s
                    OR name ILIKE %s
                    OR status ILIKE %s
                """
                base_query += search_condition
                count_query += search_condition.replace(" as count", "")
                search_param = f"%{search}%"
                params = [search_param, search_param, search_param, search_param]
           
            count_cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
            count_cursor.execute(count_query, params)
            count_result = count_cursor.fetchone()
            total = count_result['count'] if count_result else 0
            count_cursor.close()
           
            base_query += " ORDER BY created_at DESC, id DESC LIMIT %s OFFSET %s"
            params.extend([limit, offset])
           
            cursor.execute(base_query, params)
            rows = cursor.fetchall()
           
            sales_data = []
            for row in rows:
                item = dict(row)
                if isinstance(item.get('created_at'), datetime):
                    item['created_at'] = item['created_at'].isoformat()
                if isinstance(item.get('imported_at'), datetime):
                    item['imported_at'] = item['imported_at'].isoformat()
                if isinstance(item.get('updated_at'), datetime):
                    item['updated_at'] = item['updated_at'].isoformat()
                if item.get('price'):
                    item['price'] = float(item['price'])
                sales_data.append(item)
           
            return sales_data, total
           
        except psycopg2.Error as e:
            logger.error(f"Database error in get_nl_sales_data: {e}")
            raise
        finally:
            if count_cursor:
                count_cursor.close()
            if cursor:
                cursor.close()
            if conn:
                conn.close()
