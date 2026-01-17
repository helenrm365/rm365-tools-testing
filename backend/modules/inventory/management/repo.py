from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import datetime
import psycopg2
import logging
import hashlib
import json

from common.deps import pg_conn
from core.db import (
    get_inventory_log_connection, 
    get_products_connection,
    return_inventory_connection,
    return_psycopg_connection,
    return_products_connection
)
from modules.magentodata.db import get_magento_connection

logger = logging.getLogger(__name__)


class InventoryManagementRepo:
    def __init__(self):
        self._last_conn_type = None  # Track which pool connection came from

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
            conn = get_inventory_log_connection()
            self._last_conn_type = 'inventory'
            return conn
        except (ValueError, Exception) as e:
            logger.warning(f"Inventory database not available ({e}), using main database")
            # Fallback to main database
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
            # Fallback to inventory (most common)
            return_inventory_connection(conn)

    def load_inventory_metadata(self) -> List[Dict[str, Any]]:
        """Load all inventory metadata from PostgreSQL"""
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT sku, item_id, location, date, qty_ordered_jason, shelf_lt1, shelf_lt1_qty,
                       shelf_gt1, shelf_gt1_qty, top_floor_expiry, top_floor_total,
                       status, uk_fr_preorder, uk_6m_data, fr_6m_data, variant_statuses
                FROM inventory_metadata
                ORDER BY sku
            """)
            
            columns = ['sku', 'item_id', 'location', 'date', 'qty_ordered_jason', 'shelf_lt1', 'shelf_lt1_qty',
                      'shelf_gt1', 'shelf_gt1_qty', 'top_floor_expiry', 'top_floor_total',
                      'status', 'uk_fr_preorder', 'uk_6m_data', 'fr_6m_data', 'variant_statuses']
            rows = cursor.fetchall()
            
            # Parse variant_statuses JSON if present
            result = []
            for row in rows:
                row_dict = dict(zip(columns, row))
                # Parse variant_statuses from JSON string to list
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
            logger.error(f"Database error in load_inventory_metadata: {e}")
            return []
        finally:
            self.return_connection(conn)

    def save_inventory_metadata(self, metadata: Dict[str, Any]) -> Dict[str, Any]:
        """Save or update inventory metadata
        
        Note: uk_6m_data and fr_6m_data are NOT updated by this method.
        They are populated by the magento sync process and preserved during updates.
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
            rows = cursor.fetchall()
            return {sku: int(qty or 0) for sku, qty in rows}
        finally:
            return_products_connection(conn)

    def check_tables_exist(self) -> dict:
        """Check which inventory management tables exist"""
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            # Inventory management module requires these tables
            tables = [
                'inventory_metadata',
                'magento_product_list'
            ]
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
            
            cursor.close()
            return status
            
        except Exception as e:
            logger.error(f"Error checking tables: {e}")
            raise
        finally:
            self.return_connection(conn)

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
                    variant_statuses JSONB,
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
            
            # Add variant_statuses column to inventory_metadata (migration for existing tables)
            try:
                cursor.execute("""
                    ALTER TABLE inventory_metadata 
                    ADD COLUMN IF NOT EXISTS variant_statuses JSONB
                """)
            except Exception as e:
                logger.debug(f"Column variant_statuses addition skipped (may already exist): {e}")
            
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
                    line VARCHAR(255),
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
                    line VARCHAR(255),
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
            self.return_connection(conn)

    def sync_items_to_magento_product_list(self, items: List[Dict[str, Any]]) -> Dict[str, int]:
        """
        Sync inventory items to magento_product_list table.
        Can be used to import items from any source (CSV, etc.)
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
            self.return_connection(conn)

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
        Sync ALL products (regardless of enabled/disabled status) from UK Magento catalog to inventory_metadata.
        Uses BATCH operations for performance (similar to magento data module).
        
        Behavior:
        - Fetches ALL products from UK Magento catalog_product_entity table
        - NEW products (SKU not in inventory_metadata): Creates new record with just SKU
        - EXISTING products (SKU already in inventory_metadata): Updates status only
        - FILTERED OUT: Products with "AW365" in their name are completely ignored
        - Note: We do NOT filter by Magento's enabled/disabled status - all products are synced
        
        Returns stats about the operation.
        """
        from psycopg2.extras import execute_values
        
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            stats = {
                "total_products": 0,
                "synced_records": 0,
                "filtered_aw365": 0
            }
            
            # Get ALL products from UK Magento catalog (no status filtering)
            magento_conn = get_magento_connection("uk")
            try:
                with magento_conn.cursor() as magento_cursor:
                    # Query catalog tables for ALL products with categories and website info
                    # Filter out: 1) Categories containing "AW365", 2) Products with no website assignment
                    # Note: discontinued_status is stored as option_id, so we join with eav_attribute_option_value to get text
                    magento_cursor.execute("""
                        SELECT DISTINCT
                            cpe.sku,
                            cpev_name.value as name,
                            COALESCE(eaov_status.value, 'Active') as discontinued_status,
                            GROUP_CONCAT(DISTINCT ccev.value ORDER BY ccev.value SEPARATOR ',') as categories,
                            (SELECT COUNT(*) FROM catalog_product_website cpw WHERE cpw.product_id = cpe.entity_id) as website_count
                        FROM catalog_product_entity cpe
                        LEFT JOIN catalog_product_entity_varchar cpev_name 
                            ON cpe.entity_id = cpev_name.entity_id
                            AND cpev_name.attribute_id = (
                                SELECT attribute_id 
                                FROM eav_attribute 
                                WHERE attribute_code = 'name' 
                                AND entity_type_id = (
                                    SELECT entity_type_id 
                                    FROM eav_entity_type 
                                    WHERE entity_type_code = 'catalog_product'
                                )
                            )
                            AND cpev_name.store_id = 0
                        LEFT JOIN catalog_product_entity_int cpei_status
                            ON cpe.entity_id = cpei_status.entity_id
                            AND cpei_status.attribute_id = (
                                SELECT attribute_id 
                                FROM eav_attribute 
                                WHERE attribute_code = 'discontinued_status' 
                                AND entity_type_id = (
                                    SELECT entity_type_id 
                                    FROM eav_entity_type 
                                    WHERE entity_type_code = 'catalog_product'
                                )
                            )
                            AND cpei_status.store_id = 0
                        LEFT JOIN eav_attribute_option eao_status
                            ON cpei_status.value = eao_status.option_id
                            AND eao_status.attribute_id = cpei_status.attribute_id
                        LEFT JOIN eav_attribute_option_value eaov_status
                            ON eao_status.option_id = eaov_status.option_id
                            AND eaov_status.store_id = 0
                        LEFT JOIN catalog_category_product ccp ON cpe.entity_id = ccp.product_id
                        LEFT JOIN catalog_category_entity cce ON ccp.category_id = cce.entity_id
                        LEFT JOIN catalog_category_entity_varchar ccev 
                            ON cce.entity_id = ccev.entity_id
                            AND ccev.attribute_id = (
                                SELECT attribute_id 
                                FROM eav_attribute 
                                WHERE attribute_code = 'name' 
                                AND entity_type_id = (
                                    SELECT entity_type_id 
                                    FROM eav_entity_type 
                                    WHERE entity_type_code = 'catalog_category'
                                )
                            )
                            AND ccev.store_id = 0
                        WHERE cpe.sku IS NOT NULL 
                            AND cpe.sku != ''
                        GROUP BY cpe.entity_id, cpe.sku, cpev_name.value, eaov_status.value
                        HAVING website_count > 0
                        ORDER BY cpe.sku
                    """)
                    
                    products = magento_cursor.fetchall()
                    logger.info(f"Fetched {len(products)} products from UK Magento catalog (with categories and websites)")
            finally:
                if magento_conn.open:
                    magento_conn.close()
            
            # Filter products and collect valid ones for batch insert
            valid_products = []
            for product in products:
                sku = product['sku']
                categories = product.get('categories') or ""
                status = product.get('discontinued_status') or "Active"
                stats["total_products"] += 1
                
                # Filter: Skip if no categories assigned
                if not categories or categories.strip() == "":
                    stats["filtered_aw365"] += 1
                    continue
                
                # Filter: Skip if categories contain "AW365" (case-insensitive)
                if categories and "AW365" in categories.upper():
                    stats["filtered_aw365"] += 1
                    continue
                
                valid_products.append((sku, status))
            
            # BATCH upsert using execute_values (much faster than individual inserts)
            if valid_products:
                # Use ON CONFLICT to upsert
                upsert_query = """
                    INSERT INTO inventory_metadata (sku, status, updated_at)
                    VALUES %s
                    ON CONFLICT (sku) DO UPDATE SET
                        status = EXCLUDED.status,
                        updated_at = NOW()
                """
                
                # Prepare data with current timestamp
                from datetime import datetime
                upsert_data = [(sku, status, datetime.now()) for sku, status in valid_products]
                
                execute_values(cursor, upsert_query, upsert_data, page_size=500)
                stats["synced_records"] = len(valid_products)
            
            conn.commit()
            
            if stats["synced_records"] > 0:
                logger.info(f"✅ Synced {stats['synced_records']} products to inventory_metadata from Magento catalog (batch mode)")
            if stats["filtered_aw365"] > 0:
                logger.info(f"🚫 Filtered out {stats['filtered_aw365']} AW365 products")
            
            return stats
            
        except Exception as e:
            if conn:
                conn.rollback()
            logger.error(f"Error in sync_magento_products_to_inventory_metadata: {e}")
            raise
        finally:
            self.return_connection(conn)

    def update_variant_statuses(self) -> None:
        """
        Fetch all products from Magento, group by base SKU, and update variant_statuses in inventory_metadata.
        Uses batch operations for performance.
        This ensures that inventory_metadata has the complete list of statuses for all variants of a product.
        """
        import re
        from psycopg2.extras import execute_batch
        
        # Get all products from Magento (raw list)
        all_products = self.get_magento_products(status_filters=None)
        
        # Pattern to match identifier suffixes
        identifier_pattern = re.compile(r'-(?:MD|SD|DP|NP|MV)(?:-.*)?$', re.IGNORECASE)
        
        # Group products by base SKU and collect all statuses
        base_sku_data = {}  # {base_sku: {'statuses': set()}}
        
        for product in all_products:
            sku = product.get('sku', '')
            discontinued_status = product.get('discontinued_status') or 'Active'
            
            # Determine base SKU
            if identifier_pattern.search(sku):
                base_sku = identifier_pattern.sub('', sku)
            else:
                base_sku = sku
            
            # Initialize or update base SKU data
            if base_sku not in base_sku_data:
                base_sku_data[base_sku] = {
                    'statuses': set()
                }
            
            # Add this variant's status to the collection
            base_sku_data[base_sku]['statuses'].add(discontinued_status)
        
        # Update inventory_metadata with variant_statuses for each base SKU
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            # Prepare batch updates
            updates = []
            for base_sku, data in base_sku_data.items():
                statuses_list = sorted(list(data['statuses']))
                updates.append((json.dumps(statuses_list), base_sku))
            
            # Execute batch update using execute_batch (faster than executemany)
            execute_batch(cursor, """
                UPDATE inventory_metadata
                SET variant_statuses = %s, updated_at = NOW()
                WHERE sku = %s
            """, updates, page_size=500)
            
            conn.commit()
            logger.info(f"✅ Updated variant_statuses for {len(updates)} products in inventory_metadata")
            
        except Exception as e:
            logger.error(f"Error updating variant_statuses: {e}")
            if conn:
                conn.rollback()
        finally:
            self.return_connection(conn)

    def merge_identifier_products(self) -> Dict[str, int]:
        """
        Normalize all products to use their base SKU - removes all identifier suffixes (-MD, -SD, -DP, -NP, -MV).
        Also handles extended variants like -MD-xxxx.
        Uses BATCH operations for performance.
        
        Logic:
        - If base SKU exists: delete the variant (merge into base)
        - If base SKU doesn't exist: rename variant to base SKU
        - Result: ALL products use base SKU form, no suffixes remain
        
        This operates on inventory_metadata table (not magento_product_list).
        This should be called BEFORE ensure_all_products_have_item_ids() so that item IDs are generated
        after merging is complete.
        
        Returns stats about the operation.
        """
        import re
        conn = self.get_metadata_connection()
        try:
            cursor = conn.cursor()
            
            # Pattern to match all identifier suffixes: -MD, -SD, -DP, -NP, -MV (with optional -xxxx extension)
            identifier_pattern_regex = re.compile(r'-(?:MD|SD|DP|NP|MV)(?:-.*)?$', re.IGNORECASE)
            
            stats = {
                "total_checked": 0,
                "deleted": 0,
                "renamed": 0
            }
            
            # Find all products with identifier suffixes
            cursor.execute("""
                SELECT sku FROM inventory_metadata
                WHERE sku ~* '-(MD|SD|DP|NP|MV)'
                ORDER BY sku
            """)
            
            # Filter to only SKUs that actually match the pattern
            all_skus = [row[0] for row in cursor.fetchall()]
            identifier_skus = [sku for sku in all_skus if identifier_pattern_regex.search(sku)]
            stats["total_checked"] = len(identifier_skus)
            
            if not identifier_skus:
                logger.info("No products with identifier suffixes found")
                return stats
            
            logger.info(f"Found {len(identifier_skus)} products with identifier suffixes in inventory_metadata")
            
            # Get all existing base SKUs in one query
            cursor.execute("SELECT sku FROM inventory_metadata")
            existing_skus = {row[0] for row in cursor.fetchall()}
            
            # Categorize SKUs for batch operations
            skus_to_delete = []
            skus_to_rename = []  # list of (new_sku, old_sku) tuples
            
            for sku in identifier_skus:
                base_sku = identifier_pattern_regex.sub('', sku)
                
                if base_sku in existing_skus:
                    # Base exists - mark variant for deletion
                    skus_to_delete.append(sku)
                else:
                    # Base doesn't exist - mark for rename and add to existing set
                    skus_to_rename.append((base_sku, sku))
                    existing_skus.add(base_sku)  # Prevent duplicates in same batch
            
            # Batch delete variants that have base SKUs
            if skus_to_delete:
                cursor.execute("""
                    DELETE FROM inventory_metadata
                    WHERE sku = ANY(%s)
                """, (skus_to_delete,))
                stats["deleted"] = len(skus_to_delete)
            
            # Batch rename variants to base SKUs (one at a time due to unique constraint)
            if skus_to_rename:
                from psycopg2.extras import execute_batch
                execute_batch(cursor, """
                    UPDATE inventory_metadata
                    SET sku = %s, updated_at = NOW()
                    WHERE sku = %s
                """, skus_to_rename, page_size=100)
                stats["renamed"] = len(skus_to_rename)
            
            conn.commit()
            
            logger.info(f"✅ Identifier normalization complete: {stats['deleted']} merged, {stats['renamed']} renamed to base SKU")
            
            return stats
            
        except psycopg2.Error as e:
            if conn:
                conn.rollback()
            logger.error(f"Database error in merge_identifier_products: {e}")
            raise
        finally:
            self.return_connection(conn)

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
            self.return_connection(conn)

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
            self.return_connection(conn)

    def get_magento_products(self, status_filters: str = None) -> List[Dict[str, Any]]:
        """
        Get ALL products (regardless of enabled/disabled status) from UK Magento catalog database.
        Queries catalog_product_entity and related tables for complete product list.
        Filters out: 1) Products with no categories, 2) Categories containing "AW365", 3) Products with no website assignment
        
        Args:
            status_filters: Comma-separated list of discontinued_status values to filter by
                          (e.g., "Active,Temporarily OOS,Pre Order,Samples")
                          If None, returns all products
        
        Returns:
            List of product dictionaries with sku, name, and product_status
        """
        try:
            conn = get_magento_connection("uk")  # Always use UK Magento as source
            with conn.cursor() as cursor:
                # Fetch ALL products from catalog_product_entity
                # Join with attribute tables to get product name, product_status, and categories
                # Magento 2 stores attributes in Entity-Attribute-Value (EAV) structure
                # discontinued_status is stored as option_id (int), so we join with eav_attribute_option_value to get text
                # Filter out: products without categories, AW365 categories, products without websites
                cursor.execute("""
                    SELECT DISTINCT
                        cpe.sku,
                        cpev_name.value as name,
                        COALESCE(eaov_discontinued_status.value, 'Active') as discontinued_status,
                        GROUP_CONCAT(DISTINCT ccev.value ORDER BY ccev.value SEPARATOR ',') as categories
                    FROM catalog_product_entity cpe
                    LEFT JOIN catalog_product_entity_varchar cpev_name 
                        ON cpe.entity_id = cpev_name.entity_id
                        AND cpev_name.attribute_id = (
                            SELECT attribute_id 
                            FROM eav_attribute 
                            WHERE attribute_code = 'name' 
                            AND entity_type_id = (
                                SELECT entity_type_id 
                                FROM eav_entity_type 
                                WHERE entity_type_code = 'catalog_product'
                            )
                        )
                        AND cpev_name.store_id = 0
                    LEFT JOIN catalog_product_entity_int cpei_discontinued_status
                        ON cpe.entity_id = cpei_discontinued_status.entity_id
                        AND cpei_discontinued_status.attribute_id = (
                            SELECT attribute_id 
                            FROM eav_attribute 
                            WHERE attribute_code = 'discontinued_status' 
                            AND entity_type_id = (
                                SELECT entity_type_id 
                                FROM eav_entity_type 
                                WHERE entity_type_code = 'catalog_product'
                            )
                        )
                        AND cpei_discontinued_status.store_id = 0
                    LEFT JOIN eav_attribute_option eao_discontinued_status
                        ON cpei_discontinued_status.value = eao_discontinued_status.option_id
                        AND eao_discontinued_status.attribute_id = cpei_discontinued_status.attribute_id
                    LEFT JOIN eav_attribute_option_value eaov_discontinued_status
                        ON eao_discontinued_status.option_id = eaov_discontinued_status.option_id
                        AND eaov_discontinued_status.store_id = 0
                    LEFT JOIN catalog_category_product ccp ON cpe.entity_id = ccp.product_id
                    LEFT JOIN catalog_category_entity cce ON ccp.category_id = cce.entity_id
                    LEFT JOIN catalog_category_entity_varchar ccev 
                        ON cce.entity_id = ccev.entity_id
                        AND ccev.attribute_id = (
                            SELECT attribute_id 
                            FROM eav_attribute 
                            WHERE attribute_code = 'name' 
                            AND entity_type_id = (
                                SELECT entity_type_id 
                                FROM eav_entity_type 
                                WHERE entity_type_code = 'catalog_category'
                            )
                        )
                        AND ccev.store_id = 0
                    WHERE cpe.sku IS NOT NULL 
                        AND cpe.sku != ''
                        AND EXISTS (
                            SELECT 1 FROM catalog_product_website cpw 
                            WHERE cpw.product_id = cpe.entity_id
                        )
                    GROUP BY cpe.entity_id, cpe.sku, cpev_name.value, eaov_discontinued_status.value
                    HAVING categories IS NOT NULL
                        AND categories != ''
                        AND categories NOT LIKE '%AW365%'
                    ORDER BY cpe.sku
                """)
                
                rows = cursor.fetchall()
                
                print(f"========== MAGENTO QUERY RESULT: {len(rows)} rows ==========")
                logger.info(f"[INVENTORY DEBUG] Fetched {len(rows)} raw rows from Magento catalog query")
                
                # Parse status_filters if provided
                allowed_statuses = None
                if status_filters:
                    allowed_statuses = [s.strip() for s in status_filters.split(",") if s.strip()]
                
                # Convert to list of dictionaries and apply filtering
                result = []
                for row in rows:
                    discontinued_status = row.get('discontinued_status') or 'Active'  # Default to Active if not set
                    
                    # Apply status filter if provided
                    if allowed_statuses and discontinued_status not in allowed_statuses:
                        continue
                    
                    result.append({
                        'sku': row['sku'],
                        'name': row.get('name') or row['sku'],  # Fallback to SKU if name not found
                        'categories': row.get('categories'),
                        'additional_attributes': None,  # Not fetched
                        'discontinued_status': discontinued_status  # Use discontinued_status from Magento
                    })
                
                if status_filters:
                    logger.info(f"Fetched {len(result)} products from UK Magento catalog (filtered by discontinued_status: {status_filters}, excluding AW365 and products without categories/websites)")
                else:
                    logger.info(f"Fetched {len(result)} products from UK Magento catalog (all products, excluding AW365 and products without categories/websites)")
                return result
                
        except Exception as e:
            logger.error(f"Error fetching products from Magento database: {e}")
            # Fallback to empty list if Magento DB unavailable
            logger.warning("Falling back to empty product list")
            return []
        finally:
            if 'conn' in locals() and conn.open:
                conn.close()

    def get_names_from_orders_cache(self, skus: List[str]) -> Dict[str, str]:
        """
        Load product names from orders_cache tables.
        Useful for products deleted from Magento but present in historical orders.
        Checks uk_orders_cache, fr_orders_cache, and nl_orders_cache.
        """
        if not skus:
            return {}
        
        names = {}
        # Check tables in order of preference
        tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache']
        
        conn = get_products_connection()
        try:
            with conn.cursor() as cur:
                for table in tables:
                    try:
                        cur.execute(f"""
                            SELECT DISTINCT ON (sku) sku, name 
                            FROM {table}
                            WHERE sku = ANY(%s) AND name IS NOT NULL AND name != ''
                            ORDER BY sku, created_at DESC
                        """, (skus,))
                        
                        for row in cur.fetchall():
                            sku = str(row[0]).strip()
                            name = str(row[1]).strip()
                            if sku not in names:
                                names[sku] = name
                    except Exception as e:
                        logger.warning(f"Failed to query {table} for names: {e}")
                        continue
                        
            logger.info(f"Loaded {len(names)} names from orders_cache for {len(skus)} requested SKUs")
        except Exception as e:
            logger.error(f"Error fetching names from orders_cache: {e}")
        finally:
            return_products_connection(conn)
            
        return names

    def get_magento_catalog_names(self, skus: List[str]) -> Dict[str, str]:
        """
        Load product names directly from UK Magento catalog for SKUs.
        Used as fallback when products don't have names in magento_product_list
        (e.g., products that were never ordered but exist in catalog).
        
        Args:
            skus: List of SKUs to get names for
            
        Returns:
            Dict mapping SKU to product name
        """
        if not skus:
            return {}
        
        names = {}
        try:
            conn = get_magento_connection("uk")
            with conn.cursor() as cur:
                # First try exact SKU matches
                cur.execute("""
                    SELECT 
                        cpe.sku,
                        cpev_name.value as name
                    FROM catalog_product_entity cpe
                    INNER JOIN catalog_product_entity_varchar cpev_name 
                        ON cpe.entity_id = cpev_name.entity_id
                        AND cpev_name.attribute_id = (
                            SELECT attribute_id 
                            FROM eav_attribute 
                            WHERE attribute_code = 'name' 
                            AND entity_type_id = (
                                SELECT entity_type_id 
                                FROM eav_entity_type 
                                WHERE entity_type_code = 'catalog_product'
                            )
                        )
                        AND cpev_name.store_id = 0
                    WHERE cpe.sku IN %s
                        AND cpev_name.value IS NOT NULL
                        AND cpev_name.value != ''
                """, (tuple(skus),))
                
                for row in cur.fetchall():
                    sku = str(row['sku']).strip() if row.get('sku') else ""
                    name = str(row['name']).strip() if row.get('name') else ""
                    if sku and name:
                        # Clean the name - trim " - Special Offer" from the end
                        if name.endswith(" - Special Offer"):
                            name = name[:-len(" - Special Offer")].strip()
                        names[sku] = name
                
                logger.info(f"Found {len(names)} exact SKU matches in Magento catalog")
                
                # For base SKUs not found, search for variants
                still_missing = [sku for sku in skus if sku not in names]
                if still_missing:
                    logger.info(f"Searching for variants for {len(still_missing)} remaining SKUs")
                    import re
                    identifier_pattern = re.compile(r'-(?:MD|SD|DP|NP|MV)(?:-.*)?$', re.IGNORECASE)
                    
                    # Build LIKE patterns for variants
                    like_conditions = []
                    like_params = []
                    for base_sku in still_missing:
                        like_conditions.append("cpe.sku LIKE %s")
                        like_params.append(f"{base_sku}-%")
                    
                    like_clause = " OR ".join(like_conditions)
                    
                    variant_query = f"""
                        SELECT 
                            cpe.sku,
                            cpev_name.value as name
                        FROM catalog_product_entity cpe
                        INNER JOIN catalog_product_entity_varchar cpev_name 
                            ON cpe.entity_id = cpev_name.entity_id
                            AND cpev_name.attribute_id = (
                                SELECT attribute_id 
                                FROM eav_attribute 
                                WHERE attribute_code = 'name' 
                                AND entity_type_id = (
                                    SELECT entity_type_id 
                                    FROM eav_entity_type 
                                    WHERE entity_type_code = 'catalog_product'
                                )
                            )
                            AND cpev_name.store_id = 0
                        WHERE ({like_clause})
                            AND cpev_name.value IS NOT NULL
                            AND cpev_name.value != ''
                    """
                    
                    cur.execute(variant_query, tuple(like_params))
                    
                    for row in cur.fetchall():
                        variant_sku = str(row['sku']).strip() if row.get('sku') else ""
                        name = str(row['name']).strip() if row.get('name') else ""
                        if name and variant_sku:
                            # Clean the name
                            if name.endswith(" - Special Offer"):
                                name = name[:-len(" - Special Offer")].strip()
                            
                            # Map the base SKU to this variant's cleaned name
                            base = identifier_pattern.sub('', variant_sku) if identifier_pattern.search(variant_sku) else variant_sku
                            if base not in names:
                                names[base] = name
                                logger.debug(f"Found variant {variant_sku} -> base {base}: {name}")
                    
                    logger.info(f"Found {len([s for s in still_missing if s in names])} names from variants")
            
            logger.info(f"Total: Loaded {len(names)}/{len(skus)} product names from Magento catalog")
        except Exception as e:
            logger.error(f"Failed to load names from Magento catalog: {e}", exc_info=True)
        finally:
            if 'conn' in locals() and conn.open:
                conn.close()
        
        return names
