from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime
import sqlite3
import logging

from core.db import get_db_connection

logger = logging.getLogger(__name__)


class LabelsRepo:
    def __init__(self):
        self.db_path = None  # Will use get_db_connection()

    def get_sales_data(self, start_date: str, end_date: str, search: str = "") -> List[Dict[str, Any]]:
        """Get sales data for label generation"""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            
            query = """
                SELECT 
                    id,
                    order_number,
                    customer_name,
                    customer_address,
                    product_sku,
                    product_name,
                    quantity,
                    order_date,
                    shipping_method
                FROM sales_orders 
                WHERE order_date BETWEEN ? AND ?
            """
            params = [start_date, end_date]
            
            if search:
                query += " AND (order_number LIKE ? OR customer_name LIKE ? OR product_sku LIKE ?)"
                search_param = f"%{search}%"
                params.extend([search_param, search_param, search_param])
                
            query += " ORDER BY order_date DESC"
            
            cursor.execute(query, params)
            columns = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            
            return [dict(zip(columns, row)) for row in rows]
            
        except sqlite3.Error as e:
            logger.error(f"Database error in get_sales_data: {e}")
            return []
        finally:
            conn.close()

    def get_recent_runs(self, limit: int = 10) -> List[Dict[str, Any]]:
        """Get recent label generation runs"""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT 
                    id,
                    run_date,
                    start_date,
                    end_date,
                    search_term,
                    labels_count,
                    status
                FROM label_runs 
                ORDER BY run_date DESC 
                LIMIT ?
            """, (limit,))
            
            columns = [desc[0] for desc in cursor.description]
            rows = cursor.fetchall()
            
            return [dict(zip(columns, row)) for row in rows]
            
        except sqlite3.Error as e:
            logger.error(f"Database error in get_recent_runs: {e}")
            return []
        finally:
            conn.close()

    def save_run_history(self, run_data: Dict[str, Any]) -> None:
        """Save label generation run to history"""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO label_runs 
                (run_date, start_date, end_date, search_term, labels_count, status)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (
                datetime.now().isoformat(),
                run_data.get('start_date'),
                run_data.get('end_date'),
                run_data.get('search_term', ''),
                run_data.get('labels_count', 0),
                run_data.get('status', 'completed')
            ))
            conn.commit()
            
        except sqlite3.Error as e:
            logger.error(f"Database error in save_run_history: {e}")
            raise
        finally:
            conn.close()

    def init_tables(self) -> None:
        """Initialize label-related database tables"""
        conn = get_db_connection()
        try:
            cursor = conn.cursor()
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sales_orders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    order_number TEXT NOT NULL,
                    customer_name TEXT NOT NULL,
                    customer_address TEXT,
                    product_sku TEXT NOT NULL,
                    product_name TEXT NOT NULL,
                    quantity INTEGER NOT NULL DEFAULT 1,
                    order_date TEXT NOT NULL,
                    shipping_method TEXT,
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS label_runs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    run_date TEXT NOT NULL,
                    start_date TEXT NOT NULL,
                    end_date TEXT NOT NULL,
                    search_term TEXT,
                    labels_count INTEGER NOT NULL DEFAULT 0,
                    status TEXT NOT NULL DEFAULT 'completed',
                    created_at TEXT DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            conn.commit()
            
        except sqlite3.Error as e:
            logger.error(f"Database error in init_tables: {e}")
            raise
        finally:
            conn.close()