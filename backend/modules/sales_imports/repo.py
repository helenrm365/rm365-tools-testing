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
            cursor.close()
            conn.close()
 
    def get_connection(self):
        """Get PostgreSQL connection to Products database"""
        return get_products_connection()
 
    def _ensure_table_exists(self) -> None:
        """Ensure the table exists before querying (only checks once per instance)"""
        if self._table_checked:
            return
           
        try:
            self.init_tables()
            self._table_checked = True
        except Exception as e:
            logger.warning(f"Could not ensure table exists: {e}")
            # Still mark as checked to avoid repeated attempts
            self._table_checked = True
 
    def init_tables(self) -> None:
        """Initialize sales_data tables (UK, FR, NL) and indexes in PostgreSQL"""
        conn = self.get_connection()
        try:
            cursor = conn.cursor()
           
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS uk_sales_data (
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
           
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_uk_sales_order_number
                ON uk_sales_data(order_number)
            """)
           
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_uk_sales_sku
                ON uk_sales_data(sku)
            """)
           
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_uk_sales_created_at
                ON uk_sales_data(created_at)
            """)
           
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_uk_sales_status
                ON uk_sales_data(status)
            """)
 
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS fr_sales_data (
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
 
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_fr_sales_order_number
                ON fr_sales_data(order_number)
            """)
           
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_fr_sales_sku
                ON fr_sales_data(sku)
            """)
           
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_fr_sales_created_at
                ON fr_sales_data(created_at)
            """)
           
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_fr_sales_status
                ON fr_sales_data(status)
            """)
 
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS nl_sales_data (
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
 
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_nl_sales_order_number
                ON nl_sales_data(order_number)
            """)
           
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_nl_sales_sku
                ON nl_sales_data(sku)
            """)
           
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_nl_sales_created_at
                ON nl_sales_data(created_at)
            """)
           
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_nl_sales_status
                ON nl_sales_data(status)
            """)
           
            conn.commit()
            logger.info(" The respective sales data table has initialized successfully")
           
        except psycopg2.Error as e:
            conn.rollback()
            logger.error(f"Database error in init_tables: {e}")
            raise
        finally:
            cursor.close()
            conn.close()
 
    def get_uk_sales_data(self, limit: int = 100, offset: int = 0, search: str = "") -> Tuple[List[Dict[str, Any]], int]:
        """Get UK sales data with pagination and search"""
        # Try to ensure table exists
        self._ensure_table_exists()
       
        conn = self.get_connection()
        try:
            cursor = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
           
            base_query = """
                SELECT id, order_number, created_at, sku, name, qty, price, status
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
                if item.get('price'):
                    item['price'] = float(item['price'])
                sales_data.append(item)
           
            return sales_data, total
           
        except psycopg2.Error as e:
            logger.error(f"Database error in get_uk_sales_data: {e}")
            raise
        finally:
            cursor.close()
            conn.close()
 
    def save_uk_sales_data(self, data: Dict[str, Any]) -> int:
        """Save UK sales data to the database"""
        # Ensure table exists before attempting to save
        self._ensure_table_exists()
       
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
            cursor.close()
            conn.close()
 
    def bulk_insert_uk_sales_data(self, data_list: List[Dict[str, Any]]) -> int:
        """Bulk insert UK sales data for better performance"""
        # Ensure table exists before attempting to save
        self._ensure_table_exists()
       
        conn = self.get_connection()
        try:
            # Deduplicate by order_number  
            new_orders = set(self.filter_existing_orders('uk', [i['order_number'] for i in data_list]))
            filtered = [i for i in data_list if i['order_number'] in new_orders]
            if not filtered:
                return 0
       
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
            cursor.close()
            conn.close()
   
    def bulk_insert_fr_sales_data(self, data_list: List[Dict[str, Any]]) -> int:
        """Bulk insert FR sales data for better performance"""
        # Ensure table exists before attempting to save
        self._ensure_table_exists()
       
        conn = self.get_connection()
        try:
              # Deduplicate by order_number  
            new_orders = set(self.filter_existing_orders('fr', [i['order_number'] for i in data_list]))
            filtered = [i for i in data_list if i['order_number'] in new_orders]
            if not filtered:
                return 0
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
            cursor.close()
            conn.close()
 
    def bulk_insert_nl_sales_data(self, data_list: List[Dict[str, Any]]) -> int:
        """Bulk insert NL sales data for better performance"""
        # Ensure table exists before attempting to save
        self._ensure_table_exists()
       
        conn = self.get_connection()
        try:
              # Deduplicate by order_number  
            new_orders = set(self.filter_existing_orders('nl', [i['order_number'] for i in data_list]))
            filtered = [i for i in data_list if i['order_number'] in new_orders]
            if not filtered:
                return 0
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
            cursor.close()
            conn.close()
 
    def delete_uk_sales_data(self, record_id: int) -> bool:
        """Delete a UK sales data record"""
        # Ensure table exists before attempting to delete
        self._ensure_table_exists()
       
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
            cursor.close()
            conn.close()
 
    def get_uk_sales_stats(self) -> Dict[str, Any]:
        """Get statistics for UK sales data"""
        # Ensure table exists before attempting to query
        self._ensure_table_exists()
       
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
            cursor.close()
            conn.close()
 
    def save_import_history(self, history_data: Dict[str, Any]) -> int:
        """Save import history record"""
        # For now, just log it - we can add a proper history table later
        logger.info(f"Import history: {history_data}")
        return 1  # Return a dummy ID
 
    def get_import_history(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Get import history - placeholder for now"""
        # This would query an import_history table if it existed
        # For now, return empty list
        return []