# backend/modules/inventory/sourcing/repository.py
"""
Repository layer for Product Sourcing - Database operations
"""
import logging
import re
from typing import List, Dict, Optional, Any, Tuple
from datetime import datetime

from core.db import get_inventory_log_connection, return_inventory_connection

logger = logging.getLogger(__name__)

# Pattern to match identifier suffixes (MD, SD, DP, NP, MV)
IDENTIFIER_PATTERN = re.compile(r'-(?:MD|SD|DP|NP|MV)(?:-.*)?$', re.IGNORECASE)

# Module-level flag so all SourcingRepository instances (one per request) share it
_tables_initialized = False


class SourcingRepository:
    """Database repository for sourcing data"""

    def __init__(self):
        pass

    def _get_conn(self):
        return get_inventory_log_connection()

    def _return_conn(self, conn):
        return_inventory_connection(conn)

    # ========================================================================
    # TABLE MANAGEMENT
    # ========================================================================

    def init_tables(self) -> bool:
        """Initialize all sourcing tables if they don't exist"""
        global _tables_initialized
        if _tables_initialized:
            return True

        conn = self._get_conn()
        try:
            cursor = conn.cursor()

            # Suppliers table
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sourcing_suppliers (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(100) NOT NULL,
                    code VARCHAR(20) NOT NULL UNIQUE,
                    default_currency VARCHAR(3) DEFAULT 'GBP',
                    contact_email VARCHAR(255),
                    contact_phone VARCHAR(50),
                    website VARCHAR(255),
                    notes TEXT,
                    is_active BOOLEAN DEFAULT TRUE,
                    lead_time_days INTEGER,
                    min_order_value DECIMAL(10,2),
                    payment_terms VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP
                )
            """)

            # Supplier pricing table (the matrix data)
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sourcing_supplier_pricing (
                    id SERIAL PRIMARY KEY,
                    sku VARCHAR(100) NOT NULL,
                    supplier_id INTEGER NOT NULL REFERENCES sourcing_suppliers(id) ON DELETE CASCADE,
                    unit_price DECIMAL(10,2) NOT NULL,
                    currency VARCHAR(3) DEFAULT 'GBP',
                    moq INTEGER,
                    shipping_cost DECIMAL(10,2),
                    notes TEXT,
                    is_preferred BOOLEAN DEFAULT FALSE,
                    last_verified TIMESTAMP,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP,
                    -- When the price (amount/currency) was last set or changed.
                    -- Stored as TIMESTAMPTZ (UTC) so it renders in each user's
                    -- local time client-side, like the attendance log_time column.
                    price_updated_at TIMESTAMPTZ,
                    UNIQUE(sku, supplier_id)
                )
            """)

            # Manual FX rate overrides
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sourcing_fx_overrides (
                    id SERIAL PRIMARY KEY,
                    currency_code VARCHAR(3) NOT NULL UNIQUE,
                    rate DECIMAL(12,6) NOT NULL,
                    notes TEXT,
                    created_by VARCHAR(100),
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP
                )
            """)

            # Supplier SKU mappings
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sourcing_supplier_product_mappings (
                    id SERIAL PRIMARY KEY,
                    supplier_id INTEGER NOT NULL REFERENCES sourcing_suppliers(id) ON DELETE CASCADE,
                    supplier_sku VARCHAR(255),
                    supplier_product_name VARCHAR(255),
                    internal_sku VARCHAR(100) NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    CONSTRAINT chk_mapping_at_least_one CHECK (
                        (supplier_sku IS NOT NULL AND TRIM(supplier_sku) != '') OR
                        (supplier_product_name IS NOT NULL AND TRIM(supplier_product_name) != '')
                    ),
                    UNIQUE(supplier_id, supplier_sku),
                    UNIQUE(supplier_id, supplier_product_name)
                )
            """)

            # AI-derived PDF layout profiles (IDP Tier 2 cache). One row per
            # supplier + layout fingerprint, so the AI structure call happens at
            # most once per supplier-format; later imports reuse it for free.
            cursor.execute("""
                CREATE TABLE IF NOT EXISTS sourcing_pdf_layout_profiles (
                    id SERIAL PRIMARY KEY,
                    supplier_id INTEGER NOT NULL REFERENCES sourcing_suppliers(id) ON DELETE CASCADE,
                    fingerprint VARCHAR(64) NOT NULL,
                    profile_json TEXT NOT NULL,
                    created_at TIMESTAMP DEFAULT NOW(),
                    updated_at TIMESTAMP DEFAULT NOW(),
                    UNIQUE(supplier_id, fingerprint)
                )
            """)

            # Create indexes
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sourcing_pricing_sku
                ON sourcing_supplier_pricing(sku)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sourcing_pricing_supplier 
                ON sourcing_supplier_pricing(supplier_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sourcing_suppliers_active 
                ON sourcing_suppliers(is_active)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sourcing_mappings_supplier
                ON sourcing_supplier_product_mappings(supplier_id)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sourcing_mappings_sku
                ON sourcing_supplier_product_mappings(supplier_sku)
            """)
            cursor.execute("""
                CREATE INDEX IF NOT EXISTS idx_sourcing_mappings_name
                ON sourcing_supplier_product_mappings(supplier_product_name)
            """)

            # Migration: Add missing columns to existing tables
            # These are safe to run multiple times - they check if column exists first
            migration_columns = [
                ("sourcing_suppliers", "default_currency", "VARCHAR(3) DEFAULT 'GBP'"),
                ("sourcing_suppliers", "contact_email", "VARCHAR(255)"),
                ("sourcing_suppliers", "contact_phone", "VARCHAR(50)"),
                ("sourcing_suppliers", "website", "VARCHAR(255)"),
                ("sourcing_suppliers", "notes", "TEXT"),
                ("sourcing_suppliers", "lead_time_days", "INTEGER"),
                ("sourcing_suppliers", "min_order_value", "DECIMAL(10,2)"),
                ("sourcing_suppliers", "payment_terms", "VARCHAR(100)"),
                # "Price last updated" timestamp for existing pricing tables.
                # Left NULL for all pre-existing rows (they render as N/A) and is
                # only populated going forward when a price is actually changed.
                ("sourcing_supplier_pricing", "price_updated_at", "TIMESTAMPTZ"),
            ]

            for table, column, col_type in migration_columns:
                cursor.execute(f"""
                    DO $$
                    BEGIN
                        IF NOT EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_name = '{table}' AND column_name = '{column}'
                        ) THEN
                            ALTER TABLE {table} ADD COLUMN {column} {col_type};
                        END IF;
                    END $$;
                """)

            # Migration: rename supplier_identifier → supplier_product_name and add supplier_sku
            cursor.execute("""
                DO $$
                BEGIN
                    -- Rename old column if it exists and the new name doesn't
                    IF EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'sourcing_supplier_product_mappings' AND column_name = 'supplier_identifier'
                    ) AND NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'sourcing_supplier_product_mappings' AND column_name = 'supplier_product_name'
                    ) THEN
                        ALTER TABLE sourcing_supplier_product_mappings RENAME COLUMN supplier_identifier TO supplier_product_name;
                    END IF;

                    -- Allow supplier_product_name to be nullable now (it was NOT NULL before)
                    IF EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'sourcing_supplier_product_mappings'
                          AND column_name = 'supplier_product_name'
                          AND is_nullable = 'NO'
                    ) THEN
                        ALTER TABLE sourcing_supplier_product_mappings ALTER COLUMN supplier_product_name DROP NOT NULL;
                    END IF;

                    -- Add supplier_sku column if missing
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'sourcing_supplier_product_mappings' AND column_name = 'supplier_sku'
                    ) THEN
                        ALTER TABLE sourcing_supplier_product_mappings ADD COLUMN supplier_sku VARCHAR(255);
                    END IF;

                    -- Add unique constraint on (supplier_id, supplier_sku) if missing
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'sourcing_supplier_product_mappings_supplier_id_supplier_sku_key'
                    ) THEN
                        ALTER TABLE sourcing_supplier_product_mappings
                            ADD CONSTRAINT sourcing_supplier_product_mappings_supplier_id_supplier_sku_key
                            UNIQUE (supplier_id, supplier_sku);
                    END IF;

                    -- Add check constraint if missing
                    IF NOT EXISTS (
                        SELECT 1 FROM pg_constraint
                        WHERE conname = 'chk_mapping_at_least_one'
                    ) THEN
                        ALTER TABLE sourcing_supplier_product_mappings
                            ADD CONSTRAINT chk_mapping_at_least_one CHECK (
                                (supplier_sku IS NOT NULL AND TRIM(supplier_sku) != '') OR
                                (supplier_product_name IS NOT NULL AND TRIM(supplier_product_name) != '')
                            );
                    END IF;
                END $$;
            """)

            conn.commit()
            _tables_initialized = True
            logger.info("✅ Sourcing tables initialized")
            return True

        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to init sourcing tables: {e}")
            raise
        finally:
            self._return_conn(conn)

    def check_tables_status(self) -> Dict[str, bool]:
        """Check if sourcing tables exist"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            tables = ['sourcing_suppliers', 'sourcing_supplier_pricing', 'sourcing_fx_overrides', 'sourcing_supplier_product_mappings', 'sourcing_pdf_layout_profiles']
            status = {}
            
            for table in tables:
                cursor.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_name = %s
                    )
                """, (table,))
                status[table] = cursor.fetchone()[0]
            
            status['all_tables_exist'] = all(status.values())
            return status
        finally:
            self._return_conn(conn)

    # ========================================================================
    # SUPPLIER CRUD
    # ========================================================================

    def get_suppliers(self, active_only: bool = True) -> List[Dict]:
        """Get all suppliers"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            query = "SELECT * FROM sourcing_suppliers"
            if active_only:
                query += " WHERE is_active = TRUE"
            query += " ORDER BY name"
            
            cursor.execute(query)
            columns = [desc[0] for desc in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
        finally:
            self._return_conn(conn)

    def get_supplier_by_id(self, supplier_id: int) -> Optional[Dict]:
        """Get supplier by ID"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM sourcing_suppliers WHERE id = %s", (supplier_id,))
            row = cursor.fetchone()
            if row:
                columns = [desc[0] for desc in cursor.description]
                return dict(zip(columns, row))
            return None
        finally:
            self._return_conn(conn)

    def get_supplier_by_code(self, code: str) -> Optional[Dict]:
        """Get supplier by code"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT * FROM sourcing_suppliers WHERE code = %s", (code.upper(),))
            row = cursor.fetchone()
            if row:
                columns = [desc[0] for desc in cursor.description]
                return dict(zip(columns, row))
            return None
        finally:
            self._return_conn(conn)

    def create_supplier(self, data: Dict) -> Dict:
        """Create a new supplier"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            
            # Ensure code is uppercase
            data['code'] = data['code'].upper()
            
            cursor.execute("""
                INSERT INTO sourcing_suppliers 
                (name, code, default_currency, contact_email, contact_phone, 
                 website, notes, is_active, lead_time_days, min_order_value, payment_terms)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                RETURNING *
            """, (
                data['name'],
                data['code'],
                data.get('default_currency', 'GBP'),
                data.get('contact_email'),
                data.get('contact_phone'),
                data.get('website'),
                data.get('notes'),
                data.get('is_active', True),
                data.get('lead_time_days'),
                data.get('min_order_value'),
                data.get('payment_terms')
            ))
            
            row = cursor.fetchone()
            conn.commit()
            columns = [desc[0] for desc in cursor.description]
            return dict(zip(columns, row))
        except Exception as e:
            conn.rollback()
            raise
        finally:
            self._return_conn(conn)

    def update_supplier(self, supplier_id: int, data: Dict) -> Optional[Dict]:
        """Update an existing supplier"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            
            # Build dynamic update query
            update_fields = []
            values = []
            for key, value in data.items():
                if value is not None and key not in ('id', 'created_at'):
                    if key == 'code':
                        value = value.upper()
                    update_fields.append(f"{key} = %s")
                    values.append(value)
            
            if not update_fields:
                return self.get_supplier_by_id(supplier_id)
            
            update_fields.append("updated_at = NOW()")
            values.append(supplier_id)
            
            query = f"""
                UPDATE sourcing_suppliers 
                SET {', '.join(update_fields)}
                WHERE id = %s
                RETURNING *
            """
            
            cursor.execute(query, values)
            row = cursor.fetchone()
            conn.commit()
            
            if row:
                columns = [desc[0] for desc in cursor.description]
                return dict(zip(columns, row))
            return None
        except Exception as e:
            conn.rollback()
            raise
        finally:
            self._return_conn(conn)

    def delete_supplier(self, supplier_id: int) -> bool:
        """Delete a supplier (cascades to pricing)"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sourcing_suppliers WHERE id = %s", (supplier_id,))
            deleted = cursor.rowcount > 0
            conn.commit()
            return deleted
        except Exception as e:
            conn.rollback()
            raise
        finally:
            self._return_conn(conn)

    # ========================================================================
    # SUPPLIER PRICING CRUD
    # ========================================================================

    def get_pricing_for_sku(self, sku: str) -> List[Dict]:
        """Get all supplier pricing for a SKU"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT p.*, s.name as supplier_name, s.code as supplier_code
                FROM sourcing_supplier_pricing p
                JOIN sourcing_suppliers s ON p.supplier_id = s.id
                WHERE p.sku = %s
                ORDER BY s.name
            """, (sku,))
            columns = [desc[0] for desc in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
        finally:
            self._return_conn(conn)

    def get_pricing_for_supplier(self, supplier_id: int) -> List[Dict]:
        """Get all pricing entries for a supplier"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT * FROM sourcing_supplier_pricing
                WHERE supplier_id = %s
                ORDER BY sku
            """, (supplier_id,))
            columns = [desc[0] for desc in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
        finally:
            self._return_conn(conn)

    def upsert_pricing(self, data: Dict) -> Dict:
        """Create or update supplier pricing"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO sourcing_supplier_pricing
                (sku, supplier_id, unit_price, currency, moq, shipping_cost, notes, is_preferred, last_verified, price_updated_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (sku, supplier_id) DO UPDATE SET
                    unit_price = EXCLUDED.unit_price,
                    currency = EXCLUDED.currency,
                    moq = EXCLUDED.moq,
                    shipping_cost = EXCLUDED.shipping_cost,
                    notes = EXCLUDED.notes,
                    is_preferred = EXCLUDED.is_preferred,
                    last_verified = EXCLUDED.last_verified,
                    price_updated_at = NOW(),
                    updated_at = NOW()
                RETURNING *
            """, (
                data['sku'],
                data['supplier_id'],
                data['unit_price'],
                data.get('currency', 'GBP'),
                data.get('moq'),
                data.get('shipping_cost'),
                data.get('notes'),
                data.get('is_preferred', False),
                data.get('last_verified', datetime.now())
            ))
            
            row = cursor.fetchone()
            conn.commit()
            columns = [desc[0] for desc in cursor.description]
            return dict(zip(columns, row))
        except Exception as e:
            conn.rollback()
            raise
        finally:
            self._return_conn(conn)

    def delete_pricing(self, sku: str, supplier_id: int) -> bool:
        """Delete a specific pricing entry"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                DELETE FROM sourcing_supplier_pricing 
                WHERE sku = %s AND supplier_id = %s
            """, (sku, supplier_id))
            deleted = cursor.rowcount > 0
            conn.commit()
            return deleted
        except Exception as e:
            conn.rollback()
            raise
        finally:
            self._return_conn(conn)

    def bulk_upsert_pricing(self, entries: List[Dict]) -> int:
        """Bulk upsert pricing entries. Currency can be None for placeholder prices."""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            count = 0

            for entry in entries:
                cursor.execute("""
                    INSERT INTO sourcing_supplier_pricing
                    (sku, supplier_id, unit_price, currency, moq, shipping_cost, notes, is_preferred, price_updated_at)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, NOW())
                    ON CONFLICT (sku, supplier_id) DO UPDATE SET
                        unit_price = EXCLUDED.unit_price,
                        currency = EXCLUDED.currency,
                        moq = EXCLUDED.moq,
                        shipping_cost = EXCLUDED.shipping_cost,
                        notes = EXCLUDED.notes,
                        is_preferred = EXCLUDED.is_preferred,
                        price_updated_at = NOW(),
                        updated_at = NOW()
                """, (
                    entry['sku'],
                    entry['supplier_id'],
                    entry['unit_price'],
                    entry.get('currency'),  # Allow None for placeholder prices
                    entry.get('moq'),
                    entry.get('shipping_cost'),
                    entry.get('notes'),
                    entry.get('is_preferred', False)
                ))
                count += 1

            conn.commit()
            return count
        except Exception as e:
            conn.rollback()
            raise
        finally:
            self._return_conn(conn)

    # ========================================================================
    # FX RATE OVERRIDES
    # ========================================================================

    def get_fx_overrides(self) -> Dict[str, float]:
        """Get all manual FX rate overrides"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute("SELECT currency_code, rate FROM sourcing_fx_overrides")
            return {row[0]: float(row[1]) for row in cursor.fetchall()}
        finally:
            self._return_conn(conn)

    def upsert_fx_override(self, currency_code: str, rate: float, notes: str = None, user: str = None) -> Dict:
        """Create or update FX rate override"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO sourcing_fx_overrides (currency_code, rate, notes, created_by)
                VALUES (%s, %s, %s, %s)
                ON CONFLICT (currency_code) DO UPDATE SET
                    rate = EXCLUDED.rate,
                    notes = EXCLUDED.notes,
                    updated_at = NOW()
                RETURNING *
            """, (currency_code.upper(), rate, notes, user))
            
            row = cursor.fetchone()
            conn.commit()
            columns = [desc[0] for desc in cursor.description]
            return dict(zip(columns, row))
        except Exception as e:
            conn.rollback()
            raise
        finally:
            self._return_conn(conn)

    def delete_fx_override(self, currency_code: str) -> bool:
        """Delete FX rate override (revert to live rate)"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sourcing_fx_overrides WHERE currency_code = %s", (currency_code.upper(),))
            deleted = cursor.rowcount > 0
            conn.commit()
            return deleted
        except Exception as e:
            conn.rollback()
            raise
        finally:
            self._return_conn(conn)

    # ========================================================================
    # MATRIX VIEW QUERIES
    # ========================================================================

    def get_all_skus_with_pricing(self) -> List[str]:
        """Get all SKUs that have any supplier pricing"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT DISTINCT sku FROM sourcing_supplier_pricing ORDER BY sku
            """)
            return [row[0] for row in cursor.fetchall()]
        finally:
            self._return_conn(conn)

    def get_full_matrix(self, skus: List[str] = None) -> List[Dict]:
        """Get full supplier matrix for analysis"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            
            query = """
                SELECT 
                    p.sku,
                    p.supplier_id,
                    s.code as supplier_code,
                    s.name as supplier_name,
                    p.unit_price,
                    p.currency,
                    p.moq,
                    p.shipping_cost,
                    p.notes,
                    p.is_preferred,
                    p.last_verified,
                    p.updated_at,
                    p.price_updated_at
                FROM sourcing_supplier_pricing p
                JOIN sourcing_suppliers s ON p.supplier_id = s.id
                WHERE s.is_active = TRUE
            """
            
            params = []
            if skus:
                query += " AND p.sku = ANY(%s)"
                params.append(skus)
            
            query += " ORDER BY p.sku, s.name"
            
            cursor.execute(query, params)
            columns = [desc[0] for desc in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
        finally:
            self._return_conn(conn)

    # ========================================================================
    # MAGENTO PRODUCT DATA (Same as Label Generator)
    # ========================================================================

    def get_all_products_from_inventory_metadata(self, status_filter: List[str] = None) -> List[Dict]:
        """
        Get all products from inventory_metadata (synced from Magento).
        Same approach as label generator.
        
        Args:
            status_filter: List of variant statuses to filter by (e.g., ['Active', 'Temporarily OOS'])
                          If None, returns all products
        
        Returns:
            List of products with: sku, product_name, uk_6m_data, fr_6m_data, status
        """
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            
            # Note: inventory_metadata table has these columns:
            # sku, item_id, product_name, location, date, qty_ordered_jason, uk_6m_data,
            # shelf_lt1, shelf_lt1_qty, shelf_gt1, shelf_gt1_qty, top_floor_expiry,
            # top_floor_total, status, uk_fr_preorder, fr_6m_data, variant_statuses
            # (No category or brand columns - extract brand from SKU prefix instead)
            
            if status_filter:
                # Filter by variant_statuses JSONB array
                cursor.execute("""
                    SELECT 
                        sku,
                        item_id,
                        product_name,
                        uk_6m_data,
                        fr_6m_data,
                        status,
                        variant_statuses
                    FROM inventory_metadata 
                    WHERE EXISTS (
                        SELECT 1 
                        FROM jsonb_array_elements_text(variant_statuses) AS s 
                        WHERE s = ANY(%s)
                    )
                    ORDER BY sku
                """, (status_filter,))
            else:
                cursor.execute("""
                    SELECT 
                        sku,
                        item_id,
                        product_name,
                        uk_6m_data,
                        fr_6m_data,
                        status,
                        variant_statuses
                    FROM inventory_metadata 
                    ORDER BY sku
                """)
            
            columns = [desc[0] for desc in cursor.description]
            results = []
            for row in cursor.fetchall():
                product = dict(zip(columns, row))
                # Extract brand from SKU prefix (e.g., "ABC123" -> "ABC")
                product['brand'] = self._extract_brand_from_sku(product['sku'])
                product['category'] = None  # Not available in inventory_metadata
                results.append(product)
            return results
        except Exception as e:
            logger.error(f"Error fetching products from inventory_metadata: {e}")
            return []
        finally:
            self._return_conn(conn)

    def _extract_brand_from_sku(self, sku: str) -> Optional[str]:
        """Extract brand prefix from SKU (e.g., 'ABC123' -> 'ABC')"""
        if not sku:
            return None
        match = re.match(r'^([A-Za-z]+)', sku)
        return match.group(1) if match else None

    def get_magento_prices(self, skus: List[str], region: str = "uk") -> Dict[str, Dict]:
        """
        Get prices from Magento live catalog.
        Priority: special_price > price > N/A (same logic as label generator)
        
        Args:
            skus: List of SKUs to get prices for
            region: Region to query (uk/fr/nl)
            
        Returns:
            Dict mapping SKU to {price: float, currency: str, formatted: str}
        """
        if not skus:
            return {}
        
        from modules.magentodata.db import get_magento_connection
        
        prices = {}
        conn = None
        
        # VAT handling (UK/NL include VAT, FR excludes)
        VAT_MULTIPLIER = 1.20
        needs_vat_calculation = region.lower() in ['uk', 'nl']
        currency_symbol = "£" if region.lower() == 'uk' else "€"
        currency_code = "GBP" if region.lower() == 'uk' else "EUR"
        
        try:
            conn = get_magento_connection(region)
            with conn.cursor() as cur:
                # Get attribute IDs for price and special_price
                cur.execute("""
                    SELECT attribute_id, attribute_code
                    FROM eav_attribute
                    WHERE attribute_code IN ('price', 'special_price')
                      AND entity_type_id = (
                          SELECT entity_type_id 
                          FROM eav_entity_type 
                          WHERE entity_type_code = 'catalog_product'
                      )
                """)
                
                attribute_map = {}
                for row in cur.fetchall():
                    attribute_map[row['attribute_code']] = row['attribute_id']
                
                if not attribute_map:
                    logger.warning("Could not find price attribute IDs in Magento")
                    return {}
                
                price_attr_id = attribute_map.get('price')
                special_price_attr_id = attribute_map.get('special_price')
                
                # Build query for all SKUs and their variants
                like_conditions = []
                like_params = []
                
                for sku in skus:
                    like_conditions.append("cpe.sku = %s")
                    like_params.append(sku)
                    like_conditions.append("cpe.sku LIKE %s")
                    like_params.append(f"{sku}-%")
                
                like_clause = " OR ".join(like_conditions)
                
                cur.execute(f"""
                    SELECT 
                        cpe.sku,
                        MAX(CASE WHEN cped.attribute_id = %s THEN cped.value END) as price,
                        MAX(CASE WHEN cped.attribute_id = %s THEN cped.value END) as special_price
                    FROM catalog_product_entity cpe
                    LEFT JOIN catalog_product_entity_decimal cped 
                        ON cpe.entity_id = cped.entity_id
                        AND cped.attribute_id IN (%s, %s)
                        AND cped.store_id = 0
                    WHERE ({like_clause})
                    GROUP BY cpe.sku
                """, (price_attr_id, special_price_attr_id, price_attr_id, special_price_attr_id, *like_params))
                
                for row in cur.fetchall():
                    variant_sku = str(row['sku']).strip() if row.get('sku') else ""
                    price_val = float(row['price']) if row.get('price') else None
                    special_price_val = float(row['special_price']) if row.get('special_price') else None
                    
                    # Normalize to base SKU
                    base_sku = IDENTIFIER_PATTERN.sub('', variant_sku) if IDENTIFIER_PATTERN.search(variant_sku) else variant_sku
                    
                    # Only set if we haven't found this base SKU yet
                    if base_sku and base_sku not in prices:
                        # Priority: special_price > price > N/A
                        final_price = None
                        if special_price_val and special_price_val > 0:
                            final_price = special_price_val
                        elif price_val and price_val > 0:
                            final_price = price_val
                        
                        if final_price:
                            if needs_vat_calculation:
                                # Ensure final_price is float for division with float VAT_MULTIPLIER
                                price_excl_vat = float(final_price) / VAT_MULTIPLIER
                            else:
                                price_excl_vat = float(final_price)
                            
                            prices[base_sku] = {
                                'price': round(price_excl_vat, 2),
                                'currency': currency_code,
                                'formatted': f"{currency_symbol}{price_excl_vat:.2f}"
                            }
                        else:
                            prices[base_sku] = {
                                'price': None,
                                'currency': currency_code,
                                'formatted': "N/A"
                            }
                
                logger.info(f"Loaded Magento prices for {len(prices)}/{len(skus)} SKUs from {region.upper()}")
                
        except Exception as e:
            logger.error(f"Failed to load prices from {region.upper()} Magento catalog: {e}")
        finally:
            if conn:
                conn.close()
        
        return prices

    # ========================================================================
    # PRODUCT MAPPINGS CRUD
    # ========================================================================

    def get_supplier_mappings(self, supplier_id: Optional[int] = None) -> List[Dict]:
        """Get all supplier product mappings with supplier and internal names"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            query = """
                SELECT
                    m.id,
                    m.supplier_id,
                    s.code as supplier_code,
                    s.name as supplier_name,
                    m.supplier_sku,
                    m.supplier_product_name,
                    m.internal_sku,
                    p.product_name as internal_product_name,
                    m.created_at,
                    m.updated_at
                FROM sourcing_supplier_product_mappings m
                JOIN sourcing_suppliers s ON m.supplier_id = s.id
                LEFT JOIN inventory_metadata p ON m.internal_sku = p.sku
            """
            params = []
            if supplier_id is not None:
                query += " WHERE m.supplier_id = %s"
                params.append(supplier_id)
            query += " ORDER BY s.name, COALESCE(m.supplier_sku, m.supplier_product_name)"

            cursor.execute(query, params)
            columns = [desc[0] for desc in cursor.description]
            return [dict(zip(columns, row)) for row in cursor.fetchall()]
        finally:
            self._return_conn(conn)

    def create_supplier_mapping(self, data: Dict) -> Dict:
        """Create or update a supplier product mapping"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            supplier_sku = (data.get('supplier_sku') or '').strip() or None
            supplier_product_name = (data.get('supplier_product_name') or '').strip() or None

            # Upsert: prefer matching on SKU if provided, otherwise on name
            if supplier_sku:
                cursor.execute("""
                    INSERT INTO sourcing_supplier_product_mappings
                    (supplier_id, supplier_sku, supplier_product_name, internal_sku, updated_at)
                    VALUES (%s, %s, %s, TRIM(%s), NOW())
                    ON CONFLICT (supplier_id, supplier_sku) DO UPDATE SET
                        supplier_product_name = EXCLUDED.supplier_product_name,
                        internal_sku = EXCLUDED.internal_sku,
                        updated_at = NOW()
                    RETURNING id
                """, (data['supplier_id'], supplier_sku, supplier_product_name, data['internal_sku']))
            else:
                cursor.execute("""
                    INSERT INTO sourcing_supplier_product_mappings
                    (supplier_id, supplier_sku, supplier_product_name, internal_sku, updated_at)
                    VALUES (%s, %s, %s, TRIM(%s), NOW())
                    ON CONFLICT (supplier_id, supplier_product_name) DO UPDATE SET
                        supplier_sku = EXCLUDED.supplier_sku,
                        internal_sku = EXCLUDED.internal_sku,
                        updated_at = NOW()
                    RETURNING id
                """, (data['supplier_id'], supplier_sku, supplier_product_name, data['internal_sku']))

            mapping_id = cursor.fetchone()[0]
            conn.commit()

            cursor.execute("""
                SELECT
                    m.id,
                    m.supplier_id,
                    s.code as supplier_code,
                    s.name as supplier_name,
                    m.supplier_sku,
                    m.supplier_product_name,
                    m.internal_sku,
                    p.product_name as internal_product_name,
                    m.created_at,
                    m.updated_at
                FROM sourcing_supplier_product_mappings m
                JOIN sourcing_suppliers s ON m.supplier_id = s.id
                LEFT JOIN inventory_metadata p ON m.internal_sku = p.sku
                WHERE m.id = %s
            """, (mapping_id,))
            columns = [desc[0] for desc in cursor.description]
            return dict(zip(columns, cursor.fetchone()))
        except Exception:
            conn.rollback()
            raise
        finally:
            self._return_conn(conn)

    def delete_supplier_mapping(self, mapping_id: int) -> bool:
        """Delete a specific supplier product mapping"""
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute("DELETE FROM sourcing_supplier_product_mappings WHERE id = %s", (mapping_id,))
            deleted = cursor.rowcount > 0
            conn.commit()
            return deleted
        except Exception as e:
            conn.rollback()
            raise
        finally:
            self._return_conn(conn)

    def bulk_create_supplier_mappings(self, rows: List[Dict]) -> int:
        """Upsert multiple supplier product mappings, returns count inserted/updated"""
        if not rows:
            return 0
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            count = 0
            for row in rows:
                supplier_sku = (row.get('supplier_sku') or '').strip() or None
                supplier_product_name = (row.get('supplier_product_name') or '').strip() or None
                if supplier_sku:
                    cursor.execute("""
                        INSERT INTO sourcing_supplier_product_mappings
                        (supplier_id, supplier_sku, supplier_product_name, internal_sku, updated_at)
                        VALUES (%s, %s, %s, TRIM(%s), NOW())
                        ON CONFLICT (supplier_id, supplier_sku) DO UPDATE SET
                            supplier_product_name = EXCLUDED.supplier_product_name,
                            internal_sku = EXCLUDED.internal_sku,
                            updated_at = NOW()
                    """, (row['supplier_id'], supplier_sku, supplier_product_name, row['internal_sku']))
                else:
                    cursor.execute("""
                        INSERT INTO sourcing_supplier_product_mappings
                        (supplier_id, supplier_sku, supplier_product_name, internal_sku, updated_at)
                        VALUES (%s, %s, %s, TRIM(%s), NOW())
                        ON CONFLICT (supplier_id, supplier_product_name) DO UPDATE SET
                            supplier_sku = EXCLUDED.supplier_sku,
                            internal_sku = EXCLUDED.internal_sku,
                            updated_at = NOW()
                    """, (row['supplier_id'], supplier_sku, supplier_product_name, row['internal_sku']))
                count += cursor.rowcount
            conn.commit()
            return count
        except Exception:
            conn.rollback()
            raise
        finally:
            self._return_conn(conn)

    def resolve_supplier_sku(self, supplier_id: int, identifier: str) -> Optional[str]:
        """Resolve an alternative supplier sku/name into the internal canonical SKU.

        Matching is performed in two tiers (strict first, so an exact mapping is
        never overridden by a looser one):

          1. STRICT  — case-insensitive, end-trimmed, internal-whitespace
             collapsed. Tolerates the minor spacing differences PDF text
             extraction introduces when reconstructing a product description.

          2. LOOSE   — alphanumeric-only (lowercased, every non-alphanumeric
             character removed). This bridges the cosmetic naming differences
             between an invoice line and the stored mapping that humans read as
             "obviously the same" product, e.g.:
                 "Mesopeel MD Salicylic 20% 50ml"  (invoice)
                 "Mesopeel MD Salicylic 20% - 50ml" (mapping)   → punctuation
                 "ha densimatrix Lips- 1 X 15ml" vs "...Lips - 1x15ml" → spacing
             The loose tier only ADDS matches; it is provably unambiguous for the
             current data (no two mappings for a supplier collapse to the same
             alphanumeric form), and it still requires the *entire* normalised
             strings to be equal, so it will not match a substring/prefix of a
             different product.
        """
        if not identifier or not identifier.strip():
            return None

        conn = self._get_conn()
        try:
            cursor = conn.cursor()

            # Tier 1: strict (whitespace-collapsed) match.
            cursor.execute("""
                SELECT internal_sku
                FROM sourcing_supplier_product_mappings
                WHERE supplier_id = %s AND (
                    REGEXP_REPLACE(TRIM(LOWER(supplier_sku)), '\\s+', ' ', 'g')
                        = REGEXP_REPLACE(TRIM(LOWER(%s)), '\\s+', ' ', 'g') OR
                    REGEXP_REPLACE(TRIM(LOWER(supplier_product_name)), '\\s+', ' ', 'g')
                        = REGEXP_REPLACE(TRIM(LOWER(%s)), '\\s+', ' ', 'g')
                )
                LIMIT 1
            """, (supplier_id, identifier, identifier))
            row = cursor.fetchone()
            if row:
                return row[0]

            # Tier 2: loose (alphanumeric-only) fallback. Skip very short keys to
            # avoid accidental matches on near-empty normalised strings.
            loose = re.sub(r'[^a-z0-9]+', '', identifier.lower())
            if len(loose) < 3:
                return None
            cursor.execute("""
                SELECT internal_sku
                FROM sourcing_supplier_product_mappings
                WHERE supplier_id = %s AND (
                    REGEXP_REPLACE(LOWER(supplier_sku), '[^a-z0-9]+', '', 'g') = %s OR
                    REGEXP_REPLACE(LOWER(supplier_product_name), '[^a-z0-9]+', '', 'g') = %s
                )
                LIMIT 1
            """, (supplier_id, loose, loose))
            row = cursor.fetchone()
            return row[0] if row else None
        finally:
            self._return_conn(conn)

    # ========================================================================
    # PDF LAYOUT PROFILE CACHE (IDP Tier 2)
    # ========================================================================

    def get_pdf_layout_profile(self, supplier_id: int, fingerprint: str) -> Optional[Dict]:
        """Return a cached AI layout profile for (supplier, fingerprint), or None."""
        import json
        if not fingerprint:
            return None
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                SELECT profile_json FROM sourcing_pdf_layout_profiles
                WHERE supplier_id = %s AND fingerprint = %s
                LIMIT 1
            """, (supplier_id, fingerprint))
            row = cursor.fetchone()
            if not row:
                return None
            try:
                return json.loads(row[0])
            except (ValueError, TypeError):
                return None
        finally:
            self._return_conn(conn)

    def save_pdf_layout_profile(self, supplier_id: int, fingerprint: str, profile: Dict) -> None:
        """Upsert an AI layout profile so future imports of this format are free."""
        import json
        if not fingerprint or not profile:
            return
        conn = self._get_conn()
        try:
            cursor = conn.cursor()
            cursor.execute("""
                INSERT INTO sourcing_pdf_layout_profiles (supplier_id, fingerprint, profile_json)
                VALUES (%s, %s, %s)
                ON CONFLICT (supplier_id, fingerprint)
                DO UPDATE SET profile_json = EXCLUDED.profile_json, updated_at = NOW()
            """, (supplier_id, fingerprint, json.dumps(profile)))
            conn.commit()
        except Exception as e:
            conn.rollback()
            logger.error(f"Failed to cache PDF layout profile: {e}")
        finally:
            self._return_conn(conn)


