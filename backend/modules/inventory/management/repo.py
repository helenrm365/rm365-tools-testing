from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime
import psycopg2
import logging

from common.deps import pg_conn
from core.db import get_inventory_log_connection, get_products_connection

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
                       status, uk_fr_preorder, uk_6m_data, fr_6m_data
                FROM inventory_metadata
                ORDER BY item_id
            """)
            
            columns = ['item_id', 'location', 'date', 'shelf_lt1', 'shelf_lt1_qty',
                      'shelf_gt1', 'shelf_gt1_qty', 'top_floor_expiry', 'top_floor_total',
                      'status', 'uk_fr_preorder', 'uk_6m_data', 'fr_6m_data']
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

    def get_condensed_sales(self, region: str) -> Dict[str, int]:
        """Fetch {sku: total_qty} from condensed sales table for given region."""
        table_map = {
            "uk": "uk_condensed_sales",
            "fr": "fr_condensed_sales",
            "nl": "nl_condensed_sales"
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
            rows = cursor.fetchall()
            return {sku: int(qty or 0) for sku, qty in rows}
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
            
            # Create magento_product_list table for product filtering
            # Minimal schema - only what we need for filtering
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS magento_product_list (
                    sku VARCHAR(255) PRIMARY KEY,
                    item_id VARCHAR(255),
                    additional_attributes TEXT,
                    status VARCHAR(50),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Add additional_attributes column if it doesn't exist (migration for existing tables)
            try:
                cursor.execute("""
                    ALTER TABLE magento_product_list 
                    ADD COLUMN IF NOT EXISTS additional_attributes TEXT
                """)
            except Exception as e:
                logger.debug(f"Column addition skipped (may already exist): {e}")
            
            # Create label print job tables
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS label_print_jobs (
                    id SERIAL PRIMARY KEY,
                    created_by VARCHAR(255),
                    line_date DATE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS label_print_items (
                    id SERIAL PRIMARY KEY,
                    job_id INTEGER NOT NULL REFERENCES label_print_jobs(id) ON DELETE CASCADE,
                    item_id VARCHAR(255) NOT NULL,
                    sku VARCHAR(255),
                    product_name TEXT,
                    uk_6m_data INTEGER DEFAULT 0,
                    fr_6m_data INTEGER DEFAULT 0,
                    line_date DATE,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_label_print_items_job_id 
                ON label_print_items (job_id)
            """)
            
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_label_print_items_sku 
                ON label_print_items (sku)
            """)
            
            conn.commit()
            logger.info("Inventory management tables initialized successfully")
            
        except psycopg2.Error as e:
            logger.error(f"Database error in init_tables: {e}")
            raise
        finally:
            conn.close()

    def sync_zoho_to_magento_product_list(self, zoho_items: List[Dict[str, Any]]) -> Dict[str, int]:
        """
        Sync Zoho inventory items to magento_product_list table.
        Filters based on discontinued_status custom field.
        Returns stats about sync operation.
        """
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            stats = {
                "total_items": len(zoho_items),
                "inserted": 0,
                "updated": 0,
                "skipped": 0
            }
            
            for item in zoho_items:
                sku = item.get("sku", "").strip()
                if not sku:
                    stats["skipped"] += 1
                    continue
                
                item_id = item.get("item_id", "")
                status = item.get("status", "")
                
                # Upsert into magento_product_list (minimal data)
                # Note: additional_attributes should be populated by Magento CSV import, not Zoho
                cursor.execute("""
                    INSERT INTO magento_product_list (sku, item_id, status, updated_at)
                    VALUES (%s, %s, %s, NOW())
                    ON CONFLICT (sku) DO UPDATE SET
                        item_id = EXCLUDED.item_id,
                        status = EXCLUDED.status,
                        updated_at = NOW()
                    RETURNING (xmax = 0) AS inserted
                """, (sku, item_id, status))
                
                result = cursor.fetchone()
                if result and result[0]:
                    stats["inserted"] += 1
                else:
                    stats["updated"] += 1
            
            conn.commit()
            logger.info(f"✅ Synced magento_product_list: {stats['inserted']} inserted, {stats['updated']} updated")
            return stats
            
        except psycopg2.Error as e:
            if conn:
                conn.rollback()
            logger.error(f"Database error in sync_zoho_to_magento_product_list: {e}")
            raise
        finally:
            conn.close()

    @staticmethod
    def parse_discontinued_status_from_additional_attributes(additional_attributes: str) -> str:
        """
        Parse discontinued_status from additional_attributes field.
        Example: "discontinued_status=Active,other_field=value" -> "Active"
        Returns "Active" as default if not found.
        """
        if not additional_attributes:
            return "Active"
        
        # Look for discontinued_status= pattern
        import re
        match = re.search(r'discontinued_status=([^,]+)', additional_attributes)
        if match:
            return match.group(1).strip()
        
        return "Active"

    def update_discontinued_status_from_additional_attributes(self) -> Dict[str, int]:
        """
        Update discontinued_status column by parsing additional_attributes field.
        This should be run after importing data that has additional_attributes.
        """
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            # Fetch all rows with additional_attributes
            cursor.execute("""
                SELECT sku, additional_attributes
                FROM magento_product_list
                WHERE additional_attributes IS NOT NULL
            """)
            rows = cursor.fetchall()
            
            stats = {
                "total_processed": len(rows),
                "updated": 0
            }
            
            for sku, additional_attributes in rows:
                discontinued_status = self.parse_discontinued_status_from_additional_attributes(additional_attributes)
                
                cursor.execute("""
                    UPDATE magento_product_list
                    SET discontinued_status = %s, updated_at = NOW()
                    WHERE sku = %s AND (discontinued_status IS NULL OR discontinued_status != %s)
                """, (discontinued_status, sku, discontinued_status))
                
                if cursor.rowcount > 0:
                    stats["updated"] += 1
            
            conn.commit()
            logger.info(f"✅ Updated discontinued_status: {stats['updated']} of {stats['total_processed']} rows")
            return stats
            
        except psycopg2.Error as e:
            if conn:
                conn.rollback()
            logger.error(f"Database error in update_discontinued_status_from_additional_attributes: {e}")
            raise
        finally:
            conn.close()

    def get_magento_products(self, status_filters: str = None) -> List[Dict[str, Any]]:
        """
        Get products from magento_product_list, optionally filtered by discontinued_status.
        Parses discontinued_status from additional_attributes field.
        
        Args:
            status_filters: Comma-separated string like "Active,Temporarily OOS,Pre Order,Samples"
        
        Returns:
            List of product dictionaries with sku, product_name, item_id, discontinued_status, status
        """
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            if status_filters:
                # Parse comma-separated filters and build LIKE conditions
                filters = [f.strip() for f in status_filters.split(',') if f.strip()]
                like_conditions = ' OR '.join([
                    "additional_attributes LIKE %s" for _ in filters
                ])
                like_params = [f'%discontinued_status={f}%' for f in filters]
                
                cursor.execute(f"""
                    SELECT sku, additional_attributes
                    FROM magento_product_list
                    WHERE ({like_conditions})
                    ORDER BY sku
                """, tuple(like_params))
            else:
                # No filters - return all
                cursor.execute("""
                    SELECT sku, additional_attributes
                    FROM magento_product_list
                    ORDER BY sku
                """)
            
            columns = ['sku', 'additional_attributes']
            rows = cursor.fetchall()
            
            # Parse discontinued_status from additional_attributes for each row
            result = []
            for row in rows:
                row_dict = dict(zip(columns, row))
                row_dict['discontinued_status'] = self.parse_discontinued_status_from_additional_attributes(
                    row_dict.get('additional_attributes', '')
                )
                # Add empty fields for compatibility
                row_dict['product_name'] = ''
                row_dict['item_id'] = ''
                row_dict['status'] = ''
                result.append(row_dict)
            
            return result
            
        except psycopg2.Error as e:
            logger.error(f"Database error in get_magento_products: {e}")
            raise
        finally:
            conn.close()

