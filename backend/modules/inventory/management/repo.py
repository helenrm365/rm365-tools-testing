from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime
import psycopg2
import logging

from common.deps import pg_conn
from core.db import get_inventory_log_connection

logger = logging.getLogger(__name__)


class InventoryManagementRepo:
    def __init__(self):
        pass

    def get_metadata_connection(self):
        """Get connection for inventory metadata - try inventory DB first, fallback to main DB"""
        try:
            # Try dedicated inventory database first
            return get_inventory_log_connection()
        except (ValueError, Exception) as e:
            logger.warning(f"Inventory database not available ({e}), using main database")
            # Fallback to main database
            from core.db import get_psycopg_connection
            return get_psycopg_connection()

    def load_inventory_metadata(self) -> List[Dict[str, Any]]:
        """Load all inventory metadata from PostgreSQL"""
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT item_id, location, date, shelf_lt1, shelf_lt1_qty,
                       shelf_gt1, shelf_gt1_qty, top_floor_expiry, top_floor_total,
                       status, uk_fr_preorder
                FROM inventory_metadata
                ORDER BY item_id
            """)
            
            columns = ['item_id', 'location', 'date', 'shelf_lt1', 'shelf_lt1_qty',
                      'shelf_gt1', 'shelf_gt1_qty', 'top_floor_expiry', 'top_floor_total',
                      'status', 'uk_fr_preorder']
            rows = cursor.fetchall()
            
            return [dict(zip(columns, row)) for row in rows]
            
        except psycopg2.Error as e:
            logger.error(f"Database error in load_inventory_metadata: {e}")
            return []
        finally:
            conn.close()

    def save_inventory_metadata(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Save or update inventory metadata"""
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            # PostgreSQL upsert with ON CONFLICT - using actual table schema
            cursor.execute("""
                INSERT INTO inventory_metadata (
                    item_id, location, date, shelf_lt1, shelf_lt1_qty,
                    shelf_gt1, shelf_gt1_qty, top_floor_expiry, top_floor_total,
                    status, uk_fr_preorder
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (item_id) DO UPDATE SET
                    location = EXCLUDED.location,
                    date = EXCLUDED.date,
                    shelf_lt1 = EXCLUDED.shelf_lt1,
                    shelf_lt1_qty = EXCLUDED.shelf_lt1_qty,
                    shelf_gt1 = EXCLUDED.shelf_gt1,
                    shelf_gt1_qty = EXCLUDED.shelf_gt1_qty,
                    top_floor_expiry = EXCLUDED.top_floor_expiry,
                    top_floor_total = EXCLUDED.top_floor_total,
                    status = EXCLUDED.status,
                    uk_fr_preorder = EXCLUDED.uk_fr_preorder
                RETURNING item_id, location, date, shelf_lt1, shelf_lt1_qty,
                          shelf_gt1, shelf_gt1_qty, top_floor_expiry, top_floor_total,
                          status, uk_fr_preorder
            """, (
                metadata['item_id'],
                metadata.get('location'),
                metadata.get('date'),
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
            columns = ['item_id', 'location', 'date', 'shelf_lt1', 'shelf_lt1_qty',
                      'shelf_gt1', 'shelf_gt1_qty', 'top_floor_expiry', 'top_floor_total',
                      'status', 'uk_fr_preorder']
            
            conn.commit()
            logger.info(f"Metadata saved for item_id: {metadata['item_id']}")
            return dict(zip(columns, row)) if row else {}
            
        except Exception as e:
            logger.error(f"Error saving inventory metadata: {e}")
            raise
        finally:
            conn.close()

    def init_tables(self) -> None:
        """Initialize inventory metadata tables"""
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS inventory_metadata (
                    item_id VARCHAR(255) PRIMARY KEY,
                    location VARCHAR(255),
                    date DATE,
                    uk_6m_data TEXT,
                    shelf_lt1 VARCHAR(255),
                    shelf_lt1_qty INTEGER DEFAULT 0,
                    shelf_gt1 VARCHAR(255),
                    shelf_gt1_qty INTEGER DEFAULT 0,
                    top_floor_expiry DATE,
                    top_floor_total INTEGER DEFAULT 0,
                    status VARCHAR(50) DEFAULT 'Active',
                    uk_fr_preorder TEXT,
                    fr_6m_data TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_inventory_metadata_updated_at 
                ON inventory_metadata (updated_at)
            """)
            
            conn.commit()
            logger.info("Inventory management tables initialized successfully")
            
        except psycopg2.Error as e:
            logger.error(f"Database error in init_tables: {e}")
            raise
        finally:
            conn.close()
