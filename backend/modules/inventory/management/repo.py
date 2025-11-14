from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime
import psycopg2
import logging
import hashlib

from common.deps import pg_conn
from core.db import get_inventory_log_connection, get_products_connection

logger = logging.getLogger(__name__)


class InventoryManagementRepo:
    def __init__(self):
        pass

    @staticmethod
    def generate_item_id(sku: str) -> str:
        """
        Generate a unique item ID in 18-digit format (e.g., 772578000000491823)
        Uses hash of SKU to create a consistent ID.
        Format mimics legacy system for compatibility.
        """
        # Create a hash of the SKU
        hash_obj = hashlib.sha256(sku.encode())
        hash_int = int(hash_obj.hexdigest(), 16)
        
        # Take first 18 digits and ensure it starts with 7 (for format consistency)
        item_id = str(700000000000000000 + (hash_int % 100000000000000000))
        
        return item_id

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
                SELECT sku, item_id, location, date, qty_ordered_jason, shelf_lt1, shelf_lt1_qty,
                       shelf_gt1, shelf_gt1_qty, top_floor_expiry, top_floor_total,
                       status, uk_fr_preorder, uk_6m_data, fr_6m_data
                FROM inventory_metadata
                ORDER BY sku
            """)
            
            columns = ['sku', 'item_id', 'location', 'date', 'qty_ordered_jason', 'shelf_lt1', 'shelf_lt1_qty',
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
        """Save or update inventory metadata
        
        Note: uk_6m_data and fr_6m_data are NOT updated by this method.
        They are populated by the sales sync process and preserved during updates.
        """
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            # Generate item_id if not provided
            sku = metadata.get('sku')
            if not sku:
                raise ValueError("SKU is required")
            
            item_id = metadata.get('item_id')
            if not item_id:
                item_id = self.generate_item_id(sku)
            
            # PostgreSQL upsert with ON CONFLICT - using SKU as primary key
            # Note: uk_6m_data and fr_6m_data are NOT included here - they're populated by sales_sync
            cursor.execute("""
                INSERT INTO inventory_metadata (
                    sku, item_id, location, date, qty_ordered_jason, shelf_lt1, shelf_lt1_qty,
                    shelf_gt1, shelf_gt1_qty, top_floor_expiry, top_floor_total,
                    status, uk_fr_preorder
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                ON CONFLICT (sku) DO UPDATE SET
                    item_id = COALESCE(inventory_metadata.item_id, EXCLUDED.item_id),
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
                    uk_fr_preorder = EXCLUDED.uk_fr_preorder
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
            logger.info(f"Metadata saved for SKU: {sku}, item_id: {item_id}")
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
                    sku VARCHAR(255) PRIMARY KEY,
                    item_id VARCHAR(255) UNIQUE,
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
            
            # Create magento_product_list table - simple product catalog
            # This is the source of truth for products (imported from Magento)
            # Note: discontinued_status is parsed from additional_attributes and stored in a separate indexed column
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS magento_product_list (
                    sku VARCHAR(255) PRIMARY KEY,
                    name TEXT,
                    categories TEXT,
                    additional_attributes TEXT,
                    discontinued_status VARCHAR(100) DEFAULT 'Active',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Add columns if they don't exist (migration for existing tables)
            try:
                cursor.execute("""
                    ALTER TABLE magento_product_list 
                    ADD COLUMN IF NOT EXISTS additional_attributes TEXT
                """)
                cursor.execute("""
                    ALTER TABLE magento_product_list 
                    ADD COLUMN IF NOT EXISTS name TEXT
                """)
                cursor.execute("""
                    ALTER TABLE magento_product_list 
                    ADD COLUMN IF NOT EXISTS categories TEXT
                """)
                # Cleanup: Remove columns that shouldn't be in magento_product_list
                cursor.execute("""
                    ALTER TABLE magento_product_list 
                    DROP COLUMN IF EXISTS item_id
                """)
                cursor.execute("""
                    ALTER TABLE magento_product_list 
                    DROP COLUMN IF EXISTS status
                """)
                cursor.execute("""
                    ALTER TABLE magento_product_list 
                    DROP COLUMN IF EXISTS product_name
                """)
            except Exception as e:
                logger.debug(f"Column migration skipped: {e}")
            
            # Add product_name column if it doesn't exist (migration for existing tables)
            try:
                cursor.execute("""
                    ALTER TABLE magento_product_list 
                    ADD COLUMN IF NOT EXISTS product_name TEXT
                """)
            except Exception as e:
                logger.debug(f"Column product_name addition skipped (may already exist): {e}")
            
            # Add discontinued_status column if it doesn't exist (migration for existing tables)
            try:
                cursor.execute("""
                    ALTER TABLE magento_product_list 
                    ADD COLUMN IF NOT EXISTS discontinued_status VARCHAR(100) DEFAULT 'Active'
                """)
            except Exception as e:
                logger.debug(f"Column discontinued_status addition skipped (may already exist): {e}")
            
            # Add qty_ordered_jason column if it doesn't exist (migration for existing tables)
            try:
                cursor.execute("""
                    ALTER TABLE inventory_metadata 
                    ADD COLUMN IF NOT EXISTS qty_ordered_jason INTEGER DEFAULT 0
                """)
            except Exception as e:
                logger.debug(f"Column qty_ordered_jason addition skipped (may already exist): {e}")
            
            # Create index on discontinued_status for fast filtering
            try:
                cursor.execute("""
                    CREATE INDEX IF NOT EXISTS idx_magento_product_list_discontinued_status
                    ON magento_product_list (discontinued_status)
                """)
            except Exception as e:
                logger.debug(f"Index creation on discontinued_status skipped: {e}")
            
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
                    price DECIMAL(10, 2) DEFAULT 0.00,
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

    def sync_items_to_magento_product_list(self, items: List[Dict[str, Any]]) -> Dict[str, int]:
        """
        Sync inventory items to magento_product_list table.
        Can be used to import items from any source (Zoho, CSV, etc.)
        Returns stats about sync operation.
        """
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            stats = {
                "total_items": len(items),
                "inserted": 0,
                "updated": 0,
                "skipped": 0
            }
            
            for item in items:
                sku = item.get("sku", "").strip()
                if not sku:
                    stats["skipped"] += 1
                    continue
                
                product_name = item.get("product_name", "") or item.get("name", "")
                item_id = self.generate_item_id(sku)
                status = item.get("status", "")
                
                # Upsert into magento_product_list
                cursor.execute("""
                    INSERT INTO magento_product_list (sku, product_name, item_id, status, updated_at)
                    VALUES (%s, %s, %s, %s, NOW())
                    ON CONFLICT (sku) DO UPDATE SET
                        product_name = EXCLUDED.product_name,
                        item_id = COALESCE(magento_product_list.item_id, EXCLUDED.item_id),
                        status = EXCLUDED.status,
                        updated_at = NOW()
                    RETURNING (xmax = 0) AS inserted
                """, (sku, product_name, item_id, status))
                
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
            logger.error(f"Database error in sync_items_to_magento_product_list: {e}")
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

    def sync_magento_products_to_inventory_metadata(self) -> Dict[str, int]:
        """
        Sync products from magento_product_list to inventory_metadata.
        
        Behavior:
        - NEW products (SKU not in inventory_metadata): Creates new record with just SKU
        - EXISTING products (SKU already in inventory_metadata): Preserved completely
          * Keeps item_id, location, shelf quantities, sales data, etc.
          * No updates or overwrites
        - FILTERED OUT: Products with "AW365" in categories column are completely ignored
        
        This allows you to:
        1. Delete all data from magento_product_list
        2. Re-import fresh product catalog
        3. New products get added to inventory_metadata
        4. Existing products retain ALL their warehouse data
        
        Returns stats about the operation.
        """
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            stats = {
                "total_products": 0,
                "new_records": 0,
                "existing_records": 0,
                "filtered_aw365": 0
            }
            
            # Get all products from magento_product_list
            cursor.execute("""
                SELECT sku, name, categories FROM magento_product_list
                ORDER BY sku
            """)
            
            products = cursor.fetchall()
            
            # Process each product, filtering out AW365
            for sku, name, categories in products:
                stats["total_products"] += 1
                
                # Filter: Skip if categories contains "AW365" (case-insensitive)
                if categories and "AW365" in categories.upper():
                    stats["filtered_aw365"] += 1
                    logger.debug(f"Filtered out {sku} (contains AW365 in categories)")
                    continue
                
                # Insert into inventory_metadata (only if SKU doesn't exist)
                cursor.execute("""
                    INSERT INTO inventory_metadata (sku)
                    VALUES (%s)
                    ON CONFLICT (sku) DO NOTHING
                    RETURNING sku
                """, (sku,))
                
                if cursor.fetchone():
                    stats["new_records"] += 1
                else:
                    stats["existing_records"] += 1
            
            conn.commit()
            
            if stats["new_records"] > 0:
                logger.info(f"✅ Synced {stats['new_records']} new products to inventory_metadata")
            if stats["filtered_aw365"] > 0:
                logger.info(f"🚫 Filtered out {stats['filtered_aw365']} AW365 products")
            
            return stats
            
        except psycopg2.Error as e:
            if conn:
                conn.rollback()
            logger.error(f"Database error in sync_magento_products_to_inventory_metadata: {e}")
            raise
        finally:
            conn.close()

    def merge_identifier_products(self) -> Dict[str, int]:
        """
        Merge products with identifier suffixes (-SD, -DP, -NP, -MV, -MD) into their base SKU products.
        Also handles extended variants like -SD-xxxx, -DP-xxxx, -NP-xxxx, -MV-xxxx, -MD-xxxx.
        This operates on inventory_metadata table (not magento_product_list).
        This should be called BEFORE ensure_all_products_have_item_ids() so that item IDs are generated
        after merging is complete.
        
        Process:
        1. Find all products with identifier suffixes in inventory_metadata
        2. For each, check if base SKU product exists
        3. If base exists: delete the identifier variant (data merged conceptually via sales aggregation)
        4. If base doesn't exist: rename the identifier SKU to base SKU
        
        Returns stats about the operation.
        """
        import re
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            # Identifiers to merge (both exact and with -xxxx extensions)
            identifiers = ["-SD", "-DP", "-NP", "-MV", "-MD"]
            
            # Regex pattern to match any identifier with optional -xxxx suffix
            identifier_pattern_regex = re.compile(r'-(?:SD|DP|NP|MV|MD)(?:-.*)?$', re.IGNORECASE)
            
            stats = {
                "total_checked": 0,
                "deleted": 0,
                "renamed": 0,
                "base_existed": 0,
                "base_created": 0
            }
            
            # Find all products with identifier suffixes (including -xxxx variants)
            identifier_pattern = " OR ".join([f"sku LIKE '%{suffix}%'" for suffix in identifiers])
            cursor.execute(f"""
                SELECT sku FROM inventory_metadata
                WHERE {identifier_pattern}
                ORDER BY sku
            """)
            
            # Filter to only SKUs that actually match the pattern (avoid false positives)
            all_skus = [row[0] for row in cursor.fetchall()]
            identifier_skus = [sku for sku in all_skus if identifier_pattern_regex.search(sku)]
            stats["total_checked"] = len(identifier_skus)
            
            logger.info(f"Found {len(identifier_skus)} products with identifier suffixes in inventory_metadata")
            
            # Process each identifier SKU
            for sku in identifier_skus:
                # Determine base SKU by removing identifier suffix (and any -xxxx extension)
                base_sku = identifier_pattern_regex.sub('', sku)
                
                # Check if base SKU already exists
                cursor.execute("""
                    SELECT sku FROM inventory_metadata
                    WHERE sku = %s
                """, (base_sku,))
                
                base_exists = cursor.fetchone()
                
                if base_exists:
                    # Base exists - delete the identifier variant
                    # (sales data will be aggregated via the sales aggregation logic)
                    cursor.execute("""
                        DELETE FROM inventory_metadata
                        WHERE sku = %s
                    """, (sku,))
                    stats["deleted"] += 1
                    stats["base_existed"] += 1
                    logger.debug(f"Deleted {sku} (base {base_sku} exists)")
                else:
                    # Base doesn't exist - rename identifier SKU to base SKU
                    cursor.execute("""
                        UPDATE inventory_metadata
                        SET sku = %s, updated_at = NOW()
                        WHERE sku = %s
                    """, (base_sku, sku))
                    stats["renamed"] += 1
                    stats["base_created"] += 1
                    logger.debug(f"Renamed {sku} to {base_sku}")
            
            conn.commit()
            
            logger.info(f"✅ Merge complete: {stats['deleted']} deleted, {stats['renamed']} renamed")
            
            return stats
            
        except psycopg2.Error as e:
            if conn:
                conn.rollback()
            logger.error(f"Database error in merge_identifier_products: {e}")
            raise
        finally:
            conn.close()

    def ensure_all_products_have_item_ids(self) -> Dict[str, int]:
        """
        Ensure all products in inventory_metadata have generated item IDs.
        This should be called when loading the inventory management page.
        Returns stats about the operation.
        """
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            # Find all products without item_ids
            cursor.execute("""
                SELECT sku FROM inventory_metadata
                WHERE item_id IS NULL OR item_id = ''
            """)
            
            skus_without_ids = [row[0] for row in cursor.fetchall()]
            stats = {
                "total_checked": 0,
                "ids_generated": 0
            }
            
            # Count total products
            cursor.execute("SELECT COUNT(*) FROM inventory_metadata")
            stats["total_checked"] = cursor.fetchone()[0]
            
            # Generate and update item IDs
            for sku in skus_without_ids:
                item_id = self.generate_item_id(sku)
                cursor.execute("""
                    UPDATE inventory_metadata
                    SET item_id = %s, updated_at = NOW()
                    WHERE sku = %s
                """, (item_id, sku))
                stats["ids_generated"] += 1
            
            conn.commit()
            
            if stats["ids_generated"] > 0:
                logger.info(f"✅ Generated {stats['ids_generated']} item IDs for products")
            
            return stats
            
        except psycopg2.Error as e:
            if conn:
                conn.rollback()
            logger.error(f"Database error in ensure_all_products_have_item_ids: {e}")
            raise
        finally:
            conn.close()

    def update_discontinued_status_from_additional_attributes(self) -> Dict[str, int]:
        """
        Update discontinued_status column by parsing additional_attributes field.
        This should be run after importing data that has additional_attributes.
        Only updates rows where discontinued_status is NULL or needs to be changed.
        """
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            # Fetch rows where discontinued_status is NULL or additional_attributes is not NULL
            # (meaning they might need parsing/updating)
            cursor.execute("""
                SELECT sku, additional_attributes, discontinued_status
                FROM magento_product_list
                WHERE additional_attributes IS NOT NULL
            """)
            rows = cursor.fetchall()
            
            stats = {
                "total_processed": len(rows),
                "updated": 0,
                "skipped": 0
            }
            
            for sku, additional_attributes, current_status in rows:
                # Parse the discontinued_status from additional_attributes
                new_status = self.parse_discontinued_status_from_additional_attributes(additional_attributes)
                
                # Only update if status is NULL or different from current
                if current_status is None or current_status != new_status:
                    cursor.execute("""
                        UPDATE magento_product_list
                        SET discontinued_status = %s, updated_at = NOW()
                        WHERE sku = %s
                    """, (new_status, sku))
                    stats["updated"] += 1
                else:
                    stats["skipped"] += 1
            
            conn.commit()
            
            if stats["updated"] > 0:
                logger.info(f"✅ Updated discontinued_status: {stats['updated']} of {stats['total_processed']} rows")
            if stats["skipped"] > 0:
                logger.debug(f"⏩ Skipped {stats['skipped']} rows (already up-to-date)")
            
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
                # Parse comma-separated filters and use efficient WHERE IN query
                filters = [f.strip() for f in status_filters.split(',') if f.strip()]
                placeholders = ','.join(['%s'] * len(filters))
                
                cursor.execute(f"""
                    SELECT sku, name, categories, additional_attributes, discontinued_status
                    FROM magento_product_list
                    WHERE discontinued_status IN ({placeholders})
                    ORDER BY sku
                """, tuple(filters))
            else:
                # No filters - return all
                cursor.execute("""
                    SELECT sku, name, categories, additional_attributes, discontinued_status
                    FROM magento_product_list
                    ORDER BY sku
                """)
            
            columns = ['sku', 'name', 'categories', 'additional_attributes', 'discontinued_status']
            rows = cursor.fetchall()
            
            # Convert rows to dictionaries - discontinued_status is now in the result set
            result = []
            for row in rows:
                row_dict = dict(zip(columns, row))
                # Note: item_id is now stored in inventory_metadata, not magento_product_list
                # magento_product_list is just the product catalog
                result.append(row_dict)
            
            return result
            
        except psycopg2.Error as e:
            logger.error(f"Database error in get_magento_products: {e}")
            raise
        finally:
            conn.close()

