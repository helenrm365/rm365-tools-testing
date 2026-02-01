"""
Branch-specific Inventory Management Repository
Handles database operations for branch-specific inventory tables.
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime
import psycopg2
import logging
import hashlib
import json

from core.db import (
    get_inventory_log_connection, 
    get_products_connection,
    return_inventory_connection,
    return_psycopg_connection,
    return_products_connection
)

logger = logging.getLogger(__name__)


class BranchInventoryRepo:
    """Repository for branch-specific inventory operations"""
    
    def __init__(self, branch_id: str, table_name: str):
        self.branch_id = branch_id
        self.table_name = table_name
        self._last_conn_type = None
    
    @staticmethod
    def generate_item_id(sku: str) -> str:
        """Generate a unique item ID in 18-digit format"""
        hash_obj = hashlib.sha256(sku.encode())
        hash_int = int(hash_obj.hexdigest(), 16)
        item_id = str(700000000000000000 + (hash_int % 100000000000000000))
        return item_id
    
    def get_metadata_connection(self):
        """Get connection for inventory metadata"""
        try:
            conn = get_inventory_log_connection()
            self._last_conn_type = 'inventory'
            return conn
        except (ValueError, Exception) as e:
            logger.warning(f"Inventory database not available ({e}), using main database")
            from core.db import get_psycopg_connection
            conn = get_psycopg_connection()
            self._last_conn_type = 'psycopg'
            return conn
    
    def return_connection(self, conn):
        """Return connection to the appropriate pool"""
        if not conn:
            return
        if self._last_conn_type == 'inventory':
            return_inventory_connection(conn)
        elif self._last_conn_type == 'psycopg':
            return_psycopg_connection(conn)
        else:
            return_inventory_connection(conn)
    
    def check_tables_exist(self) -> Dict[str, bool]:
        """Check if the branch inventory table exists"""
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            status = {}
            
            cursor.execute("""
                SELECT EXISTS (
                    SELECT FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_name = %s
                )
            """, (self.table_name,))
            
            status[self.table_name] = cursor.fetchone()[0]
            cursor.close()
            return status
            
        except Exception as e:
            logger.error(f"Error checking tables for {self.branch_id}: {e}")
            raise
        finally:
            self.return_connection(conn)
    
    def init_tables(self) -> None:
        """Initialize the branch inventory table"""
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            # Create branch-specific inventory table
            cursor.execute(f"""
                CREATE TABLE IF NOT EXISTS {self.table_name} (
                    sku VARCHAR(255) PRIMARY KEY,
                    item_id VARCHAR(255) UNIQUE,
                    product_name TEXT,
                    location VARCHAR(255),
                    date DATE,
                    qty_ordered_jason INTEGER DEFAULT 0,
                    uk_6m_data TEXT,
                    shelf_lt1 VARCHAR(255),
                    shelf_lt1_qty INTEGER DEFAULT 0,
                    shelf_gt1 VARCHAR(255),
                    shelf_gt1_qty INTEGER DEFAULT 0,
                    top_floor_expiry DATE,
                    top_floor_total INTEGER DEFAULT 0,
                    status VARCHAR(50),
                    uk_fr_preorder TEXT,
                    fr_6m_data TEXT,
                    variant_statuses JSONB,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            cursor.execute(f"""
                CREATE INDEX IF NOT EXISTS idx_{self.table_name}_updated_at 
                ON {self.table_name} (updated_at)
            """)
            
            conn.commit()
            logger.info(f"Branch inventory table {self.table_name} initialized successfully")
            
        except psycopg2.Error as e:
            logger.error(f"Database error in init_tables for {self.branch_id}: {e}")
            raise
        finally:
            self.return_connection(conn)
    
    def load_inventory_metadata(self) -> List[Dict[str, Any]]:
        """Load all inventory metadata from the branch table"""
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(f"""
                SELECT sku, item_id, location, date, qty_ordered_jason, shelf_lt1, shelf_lt1_qty,
                       shelf_gt1, shelf_gt1_qty, top_floor_expiry, top_floor_total,
                       status, uk_fr_preorder, uk_6m_data, fr_6m_data, variant_statuses
                FROM {self.table_name}
                ORDER BY sku
            """)
            
            columns = ['sku', 'item_id', 'location', 'date', 'qty_ordered_jason', 'shelf_lt1', 'shelf_lt1_qty',
                      'shelf_gt1', 'shelf_gt1_qty', 'top_floor_expiry', 'top_floor_total',
                      'status', 'uk_fr_preorder', 'uk_6m_data', 'fr_6m_data', 'variant_statuses']
            rows = cursor.fetchall()
            
            result = []
            for row in rows:
                row_dict = dict(zip(columns, row))
                if row_dict.get('variant_statuses'):
                    try:
                        row_dict['variant_statuses'] = json.loads(row_dict['variant_statuses']) if isinstance(row_dict['variant_statuses'], str) else row_dict['variant_statuses']
                    except:
                        row_dict['variant_statuses'] = []
                else:
                    row_dict['variant_statuses'] = []
                result.append(row_dict)
            
            return result
            
        except psycopg2.Error as e:
            logger.error(f"Database error in load_inventory_metadata for {self.branch_id}: {e}")
            return []
        finally:
            self.return_connection(conn)
    
    def save_inventory_metadata(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Save or update inventory metadata for the branch"""
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            sku = metadata.get('sku')
            if not sku:
                raise ValueError("SKU is required")
            
            item_id = metadata.get('item_id')
            if not item_id:
                item_id = self.generate_item_id(sku)
            
            cursor.execute(f"""
                INSERT INTO {self.table_name} (
                    sku, item_id, location, date, qty_ordered_jason, shelf_lt1, shelf_lt1_qty,
                    shelf_gt1, shelf_gt1_qty, top_floor_expiry, top_floor_total,
                    status, uk_fr_preorder
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (sku) DO UPDATE SET
                    item_id = COALESCE({self.table_name}.item_id, EXCLUDED.item_id),
                    location = EXCLUDED.location,
                    date = EXCLUDED.date,
                    qty_ordered_jason = EXCLUDED.qty_ordered_jason,
                    shelf_lt1 = EXCLUDED.shelf_lt1,
                    shelf_lt1_qty = EXCLUDED.shelf_lt1_qty,
                    shelf_gt1 = EXCLUDED.shelf_gt1,
                    shelf_gt1_qty = EXCLUDED.shelf_gt1_qty,
                    top_floor_expiry = EXCLUDED.top_floor_expiry,
                    top_floor_total = EXCLUDED.top_floor_total,
                    status = EXCLUDED.status,
                    uk_fr_preorder = EXCLUDED.uk_fr_preorder,
                    updated_at = CURRENT_TIMESTAMP
                RETURNING sku, item_id, location, date, qty_ordered_jason, shelf_lt1, shelf_lt1_qty,
                          shelf_gt1, shelf_gt1_qty, top_floor_expiry, top_floor_total,
                          status, uk_fr_preorder, uk_6m_data, fr_6m_data
            """, (
                sku,
                item_id,
                metadata.get('location'),
                metadata.get('date'),
                metadata.get('qty_ordered_jason', 0),
                metadata.get('shelf_lt1'),
                metadata.get('shelf_lt1_qty', 0),
                metadata.get('shelf_gt1'),
                metadata.get('shelf_gt1_qty', 0),
                metadata.get('top_floor_expiry'),
                metadata.get('top_floor_total', 0),
                metadata.get('status', 'Active'),
                metadata.get('uk_fr_preorder')
            ))
            
            row = cursor.fetchone()
            columns = ['sku', 'item_id', 'location', 'date', 'qty_ordered_jason', 'shelf_lt1', 'shelf_lt1_qty',
                      'shelf_gt1', 'shelf_gt1_qty', 'top_floor_expiry', 'top_floor_total',
                      'status', 'uk_fr_preorder', 'uk_6m_data', 'fr_6m_data']
            
            conn.commit()
            logger.info(f"Metadata saved for SKU: {sku} in {self.branch_id}, item_id: {item_id}")
            return dict(zip(columns, row)) if row else {}
            
        except Exception as e:
            logger.error(f"Error saving inventory metadata for {self.branch_id}: {e}")
            raise
        finally:
            self.return_connection(conn)
    
    def get_aggregated_data(self, region: str) -> Dict[str, int]:
        """Fetch {sku: total_qty} from aggregated magento table for given region."""
        table_map = {
            "uk": "uk_aggregated_orders",
            "fr": "fr_aggregated_orders",
            "nl": "nl_aggregated_orders"
        }
        if region not in table_map:
            raise ValueError(f"Invalid region: {region}")

        conn = get_products_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(f"""
                SELECT sku, total_qty
                FROM {table_map[region]}
                WHERE sku IS NOT NULL AND sku != ''
            """)
            
            result = {}
            for row in cursor.fetchall():
                if row[0]:
                    result[row[0]] = row[1] or 0
            return result
            
        except Exception as e:
            logger.error(f"Error fetching aggregated data for {region}: {e}")
            return {}
        finally:
            return_products_connection(conn)
    
    def get_inventory_count(self) -> int:
        """Get total count of items in the branch inventory table"""
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            cursor.execute(f"SELECT COUNT(*) FROM {self.table_name}")
            return cursor.fetchone()[0]
        except Exception as e:
            logger.error(f"Error getting inventory count for {self.branch_id}: {e}")
            return 0
        finally:
            self.return_connection(conn)


__all__ = ['BranchInventoryRepo']
