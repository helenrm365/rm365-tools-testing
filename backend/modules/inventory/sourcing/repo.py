"""
Repository layer for Product Sourcing module
Handles all database operations
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import date
import logging

from core.db import get_inventory_log_connection, return_inventory_connection
from modules.magentodata.db import get_magento_connection

logger = logging.getLogger(__name__)

# Track if tables have been initialized this session
_tables_initialized = False


def ensure_tables_exist():
    """
    Check if sourcing tables exist and create them if not.
    Called once per application session on first repo access.
    """
    global _tables_initialized
    if _tables_initialized:
        return
    
    conn = get_inventory_log_connection()
    try:
        cur = conn.cursor()
        
        # Check if main table exists
        cur.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_name = 'sourcing_suppliers'
            )
        """)
        tables_exist = cur.fetchone()[0]
        
        if not tables_exist:
            logger.info("[Sourcing] Creating sourcing tables...")
            _create_tables(cur)
            conn.commit()
            logger.info("[Sourcing] Tables created successfully")
        else:
            logger.debug("[Sourcing] Tables already exist")
        
        # Data migration: update NULL currency values to 'GBP'
        cur.execute("""
            UPDATE sourcing_prices 
            SET currency = 'GBP' 
            WHERE currency IS NULL
        """)
        rows_updated = cur.rowcount
        if rows_updated > 0:
            logger.info(f"[Sourcing] Updated {rows_updated} price records with NULL currency to 'GBP'")
            conn.commit()
        
        # Schema migration: add status column if it doesn't exist
        cur.execute("""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = 'sourcing_prices' AND column_name = 'status'
        """)
        if not cur.fetchone():
            logger.info("[Sourcing] Adding 'status' column to sourcing_prices table...")
            cur.execute("""
                ALTER TABLE sourcing_prices 
                ADD COLUMN status VARCHAR(20)
            """)
            conn.commit()
            logger.info("[Sourcing] Added 'status' column successfully")
        
        # Ensure effective_date index exists for temporal queries
        cur.execute("""
            CREATE INDEX IF NOT EXISTS idx_sourcing_prices_effective_date 
            ON sourcing_prices(effective_date DESC)
        """)
        conn.commit()
        
        _tables_initialized = True
        
    except Exception as e:
        logger.error(f"[Sourcing] Error ensuring tables exist: {e}")
        conn.rollback()
        raise
    finally:
        return_inventory_connection(conn)


def _create_tables(cur):
    """Create all sourcing-related tables"""
    
    # 1. Suppliers table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sourcing_suppliers (
            id SERIAL PRIMARY KEY,
            name VARCHAR(255) NOT NULL,
            code VARCHAR(50),
            contact_email VARCHAR(255),
            contact_phone VARCHAR(50),
            website VARCHAR(255),
            notes TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    
    # 2. Supplier Products (SKU mapping) table
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sourcing_supplier_products (
            id SERIAL PRIMARY KEY,
            supplier_id INTEGER NOT NULL REFERENCES sourcing_suppliers(id) ON DELETE CASCADE,
            supplier_sku VARCHAR(100) NOT NULL,
            supplier_product_name VARCHAR(500) NOT NULL,
            internal_sku VARCHAR(100),
            pack_size INTEGER DEFAULT 1,
            notes TEXT,
            is_active BOOLEAN DEFAULT TRUE,
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(supplier_id, supplier_sku)
        )
    """)
    
    # 3. Import batches table (for tracking imports)
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sourcing_import_batches (
            id SERIAL PRIMARY KEY,
            supplier_id INTEGER NOT NULL REFERENCES sourcing_suppliers(id) ON DELETE CASCADE,
            import_source VARCHAR(50) NOT NULL,
            filename VARCHAR(500),
            notes TEXT,
            status VARCHAR(50) DEFAULT 'pending',
            total_rows INTEGER DEFAULT 0,
            processed_rows INTEGER DEFAULT 0,
            error_rows INTEGER DEFAULT 0,
            created_by VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            completed_at TIMESTAMP
        )
    """)
    
    # 4. Supplier Prices table (price history)
    # Note: status column stores only 'cancelled' - other states (pending, active, superseded)
    # are calculated dynamically based on effective_date
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sourcing_prices (
            id SERIAL PRIMARY KEY,
            supplier_product_id INTEGER NOT NULL REFERENCES sourcing_supplier_products(id) ON DELETE CASCADE,
            buy_price DECIMAL(12, 4) NOT NULL,
            currency VARCHAR(3) DEFAULT 'GBP',
            effective_date DATE NOT NULL,
            status VARCHAR(20),
            notes TEXT,
            created_by VARCHAR(255),
            created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
            import_batch_id INTEGER REFERENCES sourcing_import_batches(id) ON DELETE SET NULL
        )
    """)
    
    # Create indexes for performance
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_sourcing_supplier_products_supplier_id 
        ON sourcing_supplier_products(supplier_id)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_sourcing_supplier_products_internal_sku 
        ON sourcing_supplier_products(internal_sku)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_sourcing_prices_supplier_product_id 
        ON sourcing_prices(supplier_product_id)
    """)
    cur.execute("""
        CREATE INDEX IF NOT EXISTS idx_sourcing_prices_effective_date 
        ON sourcing_prices(effective_date DESC)
    """)
    
    logger.info("[Sourcing] Created tables: sourcing_suppliers, sourcing_supplier_products, sourcing_import_batches, sourcing_prices")


class SourcingRepo:
    """Repository for product sourcing database operations"""
    
    def __init__(self):
        """Initialize repo and ensure tables exist"""
        ensure_tables_exist()
    
    # ====== Supplier Operations ======
    
    def get_suppliers(self, include_inactive: bool = False) -> List[Dict[str, Any]]:
        """Get all suppliers"""
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            query = """
                SELECT s.id, s.name, s.code, s.contact_email, s.contact_phone, 
                       s.website, s.notes, s.is_active, s.created_at, s.updated_at,
                       COUNT(sp.id) as product_count
                FROM sourcing_suppliers s
                LEFT JOIN sourcing_supplier_products sp ON sp.supplier_id = s.id AND sp.is_active = TRUE
                WHERE 1=1
            """
            if not include_inactive:
                query += " AND s.is_active = TRUE"
            query += " GROUP BY s.id, s.name, s.code, s.contact_email, s.contact_phone, s.website, s.notes, s.is_active, s.created_at, s.updated_at"
            query += " ORDER BY s.name"
            
            cur.execute(query)
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Error in get_suppliers: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    def get_supplier_by_id(self, supplier_id: int) -> Optional[Dict[str, Any]]:
        """Get a single supplier by ID"""
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT id, name, code, contact_email, contact_phone,
                       website, notes, is_active, created_at, updated_at
                FROM sourcing_suppliers
                WHERE id = %s
            """, (supplier_id,))
            row = cur.fetchone()
            if row:
                columns = [desc[0] for desc in cur.description]
                return dict(zip(columns, row))
            return None
        except Exception as e:
            logger.error(f"Error in get_supplier_by_id: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    def create_supplier(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new supplier"""
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO sourcing_suppliers 
                    (name, code, contact_email, contact_phone, website, notes, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, name, code, contact_email, contact_phone, 
                          website, notes, is_active, created_at, updated_at
            """, (
                data['name'], data.get('code'), data.get('contact_email'),
                data.get('contact_phone'), data.get('website'), 
                data.get('notes'), data.get('is_active', True)
            ))
            row = cur.fetchone()
            conn.commit()
            columns = [desc[0] for desc in cur.description]
            return dict(zip(columns, row))
        except Exception as e:
            conn.rollback()
            logger.error(f"Error in create_supplier: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    def update_supplier(self, supplier_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update an existing supplier"""
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            # Build dynamic update query
            fields = []
            values = []
            for key, value in data.items():
                if value is not None:
                    fields.append(f"{key} = %s")
                    values.append(value)
            
            if not fields:
                return self.get_supplier_by_id(supplier_id)
            
            values.append(supplier_id)
            query = f"""
                UPDATE sourcing_suppliers 
                SET {', '.join(fields)}, updated_at = NOW()
                WHERE id = %s
                RETURNING id, name, code, contact_email, contact_phone,
                          website, notes, is_active, created_at, updated_at
            """
            cur.execute(query, values)
            row = cur.fetchone()
            conn.commit()
            if row:
                columns = [desc[0] for desc in cur.description]
                return dict(zip(columns, row))
            return None
        except Exception as e:
            conn.rollback()
            logger.error(f"Error in update_supplier: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    # ====== Supplier Product Mapping Operations ======
    
    def get_supplier_products(
        self, 
        supplier_id: Optional[int] = None,
        internal_sku: Optional[str] = None,
        include_inactive: bool = False
    ) -> List[Dict[str, Any]]:
        """
        Get supplier product mappings with optional filters.
        Returns ACTIVE prices only (effective_date <= CURRENT_DATE, not cancelled).
        """
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            query = """
                WITH active_price AS (
                    -- Get the currently active price for each supplier_product
                    SELECT DISTINCT ON (supplier_product_id) 
                        supplier_product_id, buy_price, COALESCE(currency, 'GBP') as currency, effective_date
                    FROM sourcing_prices
                    WHERE effective_date <= CURRENT_DATE
                      AND (status IS NULL OR status != 'cancelled')
                    ORDER BY supplier_product_id, effective_date DESC, created_at DESC
                )
                SELECT sp.id, sp.supplier_id, sp.supplier_sku, sp.supplier_product_name,
                       sp.internal_sku, sp.pack_size, sp.notes, sp.is_active,
                       sp.created_at, sp.updated_at,
                       s.name as supplier_name,
                       ap.buy_price as current_buy_price,
                       ap.currency as currency,
                       ap.effective_date as current_price_date
                FROM sourcing_supplier_products sp
                JOIN sourcing_suppliers s ON s.id = sp.supplier_id
                LEFT JOIN active_price ap ON ap.supplier_product_id = sp.id
                WHERE 1=1
            """
            params = []
            
            if supplier_id:
                query += " AND sp.supplier_id = %s"
                params.append(supplier_id)
            
            if internal_sku:
                query += " AND sp.internal_sku = %s"
                params.append(internal_sku)
            
            if not include_inactive:
                query += " AND sp.is_active = TRUE"
            
            query += " ORDER BY s.name, sp.supplier_product_name"
            
            cur.execute(query, params)
            columns = [desc[0] for desc in cur.description]
            results = [dict(zip(columns, row)) for row in cur.fetchall()]
            
            # Debug logging for currency
            if results:
                logger.info(f"get_supplier_products: Returning {len(results)} products")
                first_product = results[0]
                logger.info(f"First product: id={first_product.get('id')}, "
                          f"supplier_sku={first_product.get('supplier_sku')}, "
                          f"currency='{first_product.get('currency')}', "
                          f"currency_type={type(first_product.get('currency'))}, "
                          f"current_buy_price={first_product.get('current_buy_price')}")
            
            return results
        except Exception as e:
            logger.error(f"Error in get_supplier_products: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    def create_supplier_product(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Create a new supplier product mapping"""
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO sourcing_supplier_products 
                    (supplier_id, supplier_sku, supplier_product_name, internal_sku, 
                     pack_size, notes, is_active)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, supplier_id, supplier_sku, supplier_product_name,
                          internal_sku, pack_size, notes, is_active, created_at, updated_at
            """, (
                data['supplier_id'], data['supplier_sku'], data['supplier_product_name'],
                data.get('internal_sku'), data.get('pack_size', 1),
                data.get('notes'), data.get('is_active', True)
            ))
            row = cur.fetchone()
            conn.commit()
            columns = [desc[0] for desc in cur.description]
            return dict(zip(columns, row))
        except Exception as e:
            conn.rollback()
            logger.error(f"Error in create_supplier_product: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    def update_supplier_product(self, product_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update a supplier product mapping"""
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            fields = []
            values = []
            for key, value in data.items():
                if value is not None:
                    fields.append(f"{key} = %s")
                    values.append(value)
            
            if not fields:
                return None
            
            values.append(product_id)
            query = f"""
                UPDATE sourcing_supplier_products 
                SET {', '.join(fields)}, updated_at = NOW()
                WHERE id = %s
                RETURNING id, supplier_id, supplier_sku, supplier_product_name,
                          internal_sku, pack_size, notes, is_active, created_at, updated_at
            """
            cur.execute(query, values)
            row = cur.fetchone()
            conn.commit()
            if row:
                columns = [desc[0] for desc in cur.description]
                return dict(zip(columns, row))
            return None
        except Exception as e:
            conn.rollback()
            logger.error(f"Error in update_supplier_product: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    # ====== Price Operations ======
    
    def get_price_history(
        self, 
        supplier_product_id: Optional[int] = None,
        internal_sku: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """
        Get price history with optional filters.
        Returns ALL prices (active, pending, superseded, cancelled) with computed_status.
        This is used for the History tab to show the complete timeline.
        """
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            # Get active price ID for each supplier_product to determine computed_status
            query = """
                WITH active_prices AS (
                    -- Find the active price ID for each supplier_product_id
                    SELECT DISTINCT ON (supplier_product_id) id as active_id, supplier_product_id
                    FROM sourcing_prices
                    WHERE effective_date <= CURRENT_DATE
                      AND (status IS NULL OR status != 'cancelled')
                    ORDER BY supplier_product_id, effective_date DESC, created_at DESC
                )
                SELECT p.id, p.supplier_product_id, p.buy_price, p.currency,
                       p.effective_date, p.status, p.notes, p.created_by, p.created_at,
                       p.import_batch_id,
                       sp.supplier_sku, sp.supplier_product_name, sp.internal_sku,
                       s.name as supplier_name,
                       CASE 
                           WHEN p.status = 'cancelled' THEN 'cancelled'
                           WHEN p.effective_date > CURRENT_DATE THEN 'pending'
                           WHEN p.id = ap.active_id THEN 'active'
                           ELSE 'superseded'
                       END as computed_status
                FROM sourcing_prices p
                JOIN sourcing_supplier_products sp ON sp.id = p.supplier_product_id
                JOIN sourcing_suppliers s ON s.id = sp.supplier_id
                LEFT JOIN active_prices ap ON ap.supplier_product_id = p.supplier_product_id
                WHERE 1=1
            """
            params = []
            
            if supplier_product_id:
                query += " AND p.supplier_product_id = %s"
                params.append(supplier_product_id)
            
            if internal_sku:
                query += " AND sp.internal_sku = %s"
                params.append(internal_sku)
            
            query += f" ORDER BY p.effective_date DESC, p.created_at DESC LIMIT %s"
            params.append(limit)
            
            cur.execute(query, params)
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Error in get_price_history: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    def create_price(self, data: Dict[str, Any], created_by: Optional[str] = None) -> Dict[str, Any]:
        """Create a new price entry"""
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO sourcing_prices 
                    (supplier_product_id, buy_price, currency, effective_date, notes, 
                     created_by, import_batch_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
                RETURNING id, supplier_product_id, buy_price, currency, effective_date,
                          notes, created_by, created_at, import_batch_id
            """, (
                data['supplier_product_id'], data['buy_price'], 
                data.get('currency', 'GBP'), data['effective_date'],
                data.get('notes'), created_by, data.get('import_batch_id')
            ))
            row = cur.fetchone()
            conn.commit()
            columns = [desc[0] for desc in cur.description]
            return dict(zip(columns, row))
        except Exception as e:
            conn.rollback()
            logger.error(f"Error in create_price: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    def get_active_price(self, supplier_product_id: int) -> Optional[Dict[str, Any]]:
        """
        Get the currently active price for a supplier product.
        
        Active price is determined by:
        1. effective_date <= CURRENT_DATE (not pending/future)
        2. status IS NULL OR status != 'cancelled' (not explicitly cancelled)
        3. ORDER BY effective_date DESC, created_at DESC (most recent wins)
        
        The tiebreaker (created_at DESC) handles cases where multiple prices
        have the same effective_date - the most recently created one wins.
        """
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                SELECT 
                    p.id, p.supplier_product_id, p.buy_price, p.currency,
                    p.effective_date, p.status, p.notes, p.created_by, 
                    p.created_at, p.import_batch_id,
                    sp.supplier_sku, sp.supplier_product_name, sp.internal_sku,
                    s.name as supplier_name
                FROM sourcing_prices p
                JOIN sourcing_supplier_products sp ON sp.id = p.supplier_product_id
                JOIN sourcing_suppliers s ON s.id = sp.supplier_id
                WHERE p.supplier_product_id = %s
                  AND p.effective_date <= CURRENT_DATE
                  AND (p.status IS NULL OR p.status != 'cancelled')
                ORDER BY p.effective_date DESC, p.created_at DESC
                LIMIT 1
            """, (supplier_product_id,))
            row = cur.fetchone()
            if row:
                columns = [desc[0] for desc in cur.description]
                result = dict(zip(columns, row))
                # Add computed status: since effective_date <= today, this is 'active'
                result['computed_status'] = 'active'
                return result
            return None
        except Exception as e:
            logger.error(f"Error in get_active_price: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    def get_pending_prices(
        self, 
        supplier_product_id: Optional[int] = None,
        supplier_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Get pending (future) prices that haven't become active yet.
        
        Pending prices have effective_date > CURRENT_DATE and are not cancelled.
        """
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            query = """
                SELECT 
                    p.id, p.supplier_product_id, p.buy_price, p.currency,
                    p.effective_date, p.status, p.notes, p.created_by, 
                    p.created_at, p.import_batch_id,
                    sp.supplier_sku, sp.supplier_product_name, sp.internal_sku,
                    sp.supplier_id,
                    s.name as supplier_name,
                    'pending' as computed_status
                FROM sourcing_prices p
                JOIN sourcing_supplier_products sp ON sp.id = p.supplier_product_id
                JOIN sourcing_suppliers s ON s.id = sp.supplier_id
                WHERE p.effective_date > CURRENT_DATE
                  AND (p.status IS NULL OR p.status != 'cancelled')
            """
            params = []
            
            if supplier_product_id:
                query += " AND p.supplier_product_id = %s"
                params.append(supplier_product_id)
            
            if supplier_id:
                query += " AND sp.supplier_id = %s"
                params.append(supplier_id)
            
            query += " ORDER BY p.effective_date ASC, p.created_at DESC"
            
            cur.execute(query, params)
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Error in get_pending_prices: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    def cancel_pending_price(self, price_id: int, cancelled_by: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Cancel a pending price by setting status='cancelled'.
        
        Only allows cancelling prices with effective_date > CURRENT_DATE.
        Active or superseded prices cannot be cancelled - they're historical records.
        """
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            # First check if the price is actually pending
            cur.execute("""
                SELECT id, effective_date 
                FROM sourcing_prices 
                WHERE id = %s
            """, (price_id,))
            price = cur.fetchone()
            
            if not price:
                logger.warning(f"Price {price_id} not found for cancellation")
                return None
            
            # Check if effective_date is in the future
            cur.execute("""
                SELECT CASE WHEN effective_date > CURRENT_DATE THEN TRUE ELSE FALSE END
                FROM sourcing_prices
                WHERE id = %s
            """, (price_id,))
            is_pending = cur.fetchone()[0]
            
            if not is_pending:
                logger.warning(f"Price {price_id} cannot be cancelled - not a pending price (effective_date <= today)")
                return None
            
            # Cancel the price
            cur.execute("""
                UPDATE sourcing_prices 
                SET status = 'cancelled', notes = COALESCE(notes || ' | ', '') || 'Cancelled by ' || COALESCE(%s, 'system') || ' on ' || CURRENT_DATE::text
                WHERE id = %s
                RETURNING id, supplier_product_id, buy_price, currency, effective_date,
                          status, notes, created_by, created_at, import_batch_id
            """, (cancelled_by, price_id))
            row = cur.fetchone()
            conn.commit()
            
            if row:
                columns = [desc[0] for desc in cur.description]
                result = dict(zip(columns, row))
                logger.info(f"Price {price_id} cancelled by {cancelled_by}")
                return result
            return None
        except Exception as e:
            conn.rollback()
            logger.error(f"Error in cancel_pending_price: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    def update_pending_price(
        self, 
        price_id: int, 
        data: Dict[str, Any],
        updated_by: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """
        Update a pending price entry.
        
        Only allows updating prices with effective_date > CURRENT_DATE.
        Once a price becomes active, it cannot be modified.
        """
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            # Check if the price is actually pending
            cur.execute("""
                SELECT CASE WHEN effective_date > CURRENT_DATE THEN TRUE ELSE FALSE END
                FROM sourcing_prices
                WHERE id = %s AND (status IS NULL OR status != 'cancelled')
            """, (price_id,))
            result = cur.fetchone()
            
            if not result or not result[0]:
                logger.warning(f"Price {price_id} cannot be updated - not a pending price")
                return None
            
            # Build dynamic update
            fields = []
            values = []
            
            if 'buy_price' in data:
                fields.append("buy_price = %s")
                values.append(data['buy_price'])
            
            if 'currency' in data:
                fields.append("currency = %s")
                values.append(data['currency'])
            
            if 'effective_date' in data:
                # Validate new effective_date is also in the future
                from datetime import date as date_type
                new_date = data['effective_date']
                if isinstance(new_date, str):
                    new_date = date_type.fromisoformat(new_date)
                if new_date <= date_type.today():
                    logger.warning(f"Cannot set effective_date to today or earlier")
                    return None
                fields.append("effective_date = %s")
                values.append(data['effective_date'])
            
            if 'notes' in data:
                fields.append("notes = %s")
                values.append(data['notes'])
            
            if not fields:
                logger.warning("No fields to update")
                return None
            
            values.append(price_id)
            query = f"""
                UPDATE sourcing_prices 
                SET {', '.join(fields)}
                WHERE id = %s
                RETURNING id, supplier_product_id, buy_price, currency, effective_date,
                          status, notes, created_by, created_at, import_batch_id
            """
            cur.execute(query, values)
            row = cur.fetchone()
            conn.commit()
            
            if row:
                columns = [desc[0] for desc in cur.description]
                result = dict(zip(columns, row))
                logger.info(f"Pending price {price_id} updated by {updated_by}")
                return result
            return None
        except Exception as e:
            conn.rollback()
            logger.error(f"Error in update_pending_price: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    def get_price_with_computed_status(self, price_id: int) -> Optional[Dict[str, Any]]:
        """
        Get a single price entry with its computed status.
        
        Computed status is calculated based on:
        - 'cancelled': status = 'cancelled' in DB
        - 'pending': effective_date > CURRENT_DATE
        - 'active': is the most recent price with effective_date <= CURRENT_DATE
        - 'superseded': effective_date <= CURRENT_DATE but not the most recent
        """
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                WITH price_data AS (
                    SELECT 
                        p.id, p.supplier_product_id, p.buy_price, p.currency,
                        p.effective_date, p.status, p.notes, p.created_by, 
                        p.created_at, p.import_batch_id,
                        sp.supplier_sku, sp.supplier_product_name, sp.internal_sku,
                        s.name as supplier_name
                    FROM sourcing_prices p
                    JOIN sourcing_supplier_products sp ON sp.id = p.supplier_product_id
                    JOIN sourcing_suppliers s ON s.id = sp.supplier_id
                    WHERE p.id = %s
                ),
                active_price AS (
                    -- Find the active price for the same supplier_product_id
                    SELECT p.id as active_id
                    FROM sourcing_prices p
                    JOIN price_data pd ON pd.supplier_product_id = p.supplier_product_id
                    WHERE p.effective_date <= CURRENT_DATE
                      AND (p.status IS NULL OR p.status != 'cancelled')
                    ORDER BY p.effective_date DESC, p.created_at DESC
                    LIMIT 1
                )
                SELECT 
                    pd.*,
                    CASE 
                        WHEN pd.status = 'cancelled' THEN 'cancelled'
                        WHEN pd.effective_date > CURRENT_DATE THEN 'pending'
                        WHEN pd.id = ap.active_id THEN 'active'
                        ELSE 'superseded'
                    END as computed_status
                FROM price_data pd
                LEFT JOIN active_price ap ON TRUE
            """, (price_id,))
            row = cur.fetchone()
            if row:
                columns = [desc[0] for desc in cur.description]
                return dict(zip(columns, row))
            return None
        except Exception as e:
            logger.error(f"Error in get_price_with_computed_status: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    # ====== Comparison / Reporting Queries ======
    
    def get_supplier_comparison(self, internal_sku: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get supplier price comparison for internal products.
        Returns all suppliers' ACTIVE prices for each internal product.
        
        Active prices are determined by:
        - effective_date <= CURRENT_DATE (not pending/future)
        - status IS NULL OR status != 'cancelled' (not cancelled)
        - Most recent effective_date wins (with created_at as tiebreaker)
        """
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            query = """
                WITH active_prices AS (
                    SELECT DISTINCT ON (supplier_product_id)
                        supplier_product_id, buy_price, effective_date
                    FROM sourcing_prices
                    WHERE effective_date <= CURRENT_DATE
                      AND (status IS NULL OR status != 'cancelled')
                    ORDER BY supplier_product_id, effective_date DESC, created_at DESC
                )
                SELECT 
                    sp.internal_sku,
                    sp.supplier_id,
                    s.name as supplier_name,
                    sp.supplier_sku,
                    sp.supplier_product_name,
                    ap.buy_price,
                    ap.effective_date
                FROM sourcing_supplier_products sp
                JOIN sourcing_suppliers s ON s.id = sp.supplier_id
                LEFT JOIN active_prices ap ON ap.supplier_product_id = sp.id
                WHERE sp.internal_sku IS NOT NULL
                  AND sp.is_active = TRUE
                  AND s.is_active = TRUE
            """
            params = []
            
            if internal_sku:
                query += " AND sp.internal_sku = %s"
                params.append(internal_sku)
            
            query += " ORDER BY sp.internal_sku, ap.buy_price NULLS LAST"
            
            cur.execute(query, params)
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Error in get_supplier_comparison: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    # ====== Import Batch Operations ======
    
    def create_import_batch(self, data: Dict[str, Any], created_by: Optional[str] = None) -> Dict[str, Any]:
        """Create a new import batch record"""
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            cur.execute("""
                INSERT INTO sourcing_import_batches 
                    (supplier_id, import_source, filename, notes, status, created_by)
                VALUES (%s, %s, %s, %s, 'pending', %s)
                RETURNING id, supplier_id, import_source, filename, notes, status,
                          total_rows, processed_rows, error_rows, created_by, 
                          created_at, completed_at
            """, (
                data['supplier_id'], data['import_source'], 
                data.get('filename'), data.get('notes'), created_by
            ))
            row = cur.fetchone()
            conn.commit()
            columns = [desc[0] for desc in cur.description]
            return dict(zip(columns, row))
        except Exception as e:
            conn.rollback()
            logger.error(f"Error in create_import_batch: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    def update_import_batch(self, batch_id: int, data: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Update an import batch status"""
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            fields = []
            values = []
            for key, value in data.items():
                fields.append(f"{key} = %s")
                values.append(value)
            
            values.append(batch_id)
            query = f"""
                UPDATE sourcing_import_batches 
                SET {', '.join(fields)}
                WHERE id = %s
                RETURNING id, supplier_id, import_source, filename, notes, status,
                          total_rows, processed_rows, error_rows, created_by,
                          created_at, completed_at
            """
            cur.execute(query, values)
            row = cur.fetchone()
            conn.commit()
            if row:
                columns = [desc[0] for desc in cur.description]
                return dict(zip(columns, row))
            return None
        except Exception as e:
            conn.rollback()
            logger.error(f"Error in update_import_batch: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    # ====== Inventory Metadata Integration ======
    
    def get_available_skus(self, search: Optional[str] = None, limit: int = 100) -> List[Dict[str, Any]]:
        """
        Get available SKUs from inventory_metadata.
        This helps users map supplier products to actual inventory SKUs.
        Note: Product names would need to be fetched from Magento catalog if needed.
        """
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            query = """
                SELECT DISTINCT 
                    sku,
                    top_floor_total as quantity_available,
                    uk_6m_data,
                    fr_6m_data,
                    status
                FROM inventory_metadata
                WHERE sku IS NOT NULL
            """
            params = []
            
            if search:
                query += " AND sku ILIKE %s"
                search_pattern = f"%{search}%"
                params.append(search_pattern)
            
            query += " ORDER BY sku LIMIT %s"
            params.append(limit)
            
            cur.execute(query, params)
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Error in get_available_skus: {e}")
            raise
        finally:
            return_inventory_connection(conn)
    
    def get_product_names_from_magento(self, skus: List[str], region: str = "uk") -> Dict[str, str]:
        """
        Get product names from Magento catalog for given SKUs.
        Returns dict mapping SKU to product name.
        """
        if not skus:
            return {}
        
        conn = None
        try:
            conn = get_magento_connection(region)
            with conn.cursor() as cur:
                # Build IN clause with proper parameterization for MySQL
                placeholders = ', '.join(['%s'] * len(skus))
                query = f"""
                    SELECT DISTINCT
                        cpe.sku,
                        cpev_name.value as name
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
                    WHERE cpe.sku IN ({placeholders})
                        AND cpev_name.value IS NOT NULL
                """
                cur.execute(query, skus)
                rows = cur.fetchall()
                
                # DictCursor returns dicts, so access by key
                return {row['sku']: row['name'] for row in rows}
        except Exception as e:
            logger.error(f"Error fetching product names from Magento: {e}", exc_info=True)
            return {}
        finally:
            if conn:
                conn.close()
    
    def get_sell_prices_from_magento(self, skus: List[str], region: str = "uk") -> Dict[str, float]:
        """
        Get sell prices from Magento catalog for given SKUs.
        Returns dict mapping SKU to price EXCLUDING VAT (like label generator).
        UK/NL prices are divided by 1.2 to get excluding-tax price.
        FR prices are already excluding tax.
        """
        if not skus:
            return {}
        
        # VAT rate (20% for UK and NL)
        VAT_RATE = 0.20
        VAT_MULTIPLIER = 1 + VAT_RATE  # 1.20
        
        # UK and NL: prices are entered including tax, need to divide
        # FR: prices are entered excluding tax, use directly
        needs_vat_calculation = region.lower() in ['uk', 'nl']
        
        conn = None
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
                
                # Build IN clause for SKUs
                placeholders = ', '.join(['%s'] * len(skus))
                
                # Query prices for all SKUs
                query = f"""
                    SELECT DISTINCT
                        cpe.sku,
                        price.value as price,
                        special_price.value as special_price
                    FROM catalog_product_entity cpe
                    LEFT JOIN catalog_product_entity_decimal price
                        ON cpe.entity_id = price.entity_id
                        AND price.attribute_id = %s
                        AND price.store_id = 0
                    LEFT JOIN catalog_product_entity_decimal special_price
                        ON cpe.entity_id = special_price.entity_id
                        AND special_price.attribute_id = %s
                        AND special_price.store_id = 0
                    WHERE cpe.sku IN ({placeholders})
                """
                
                params = [price_attr_id, special_price_attr_id] + skus
                cur.execute(query, params)
                rows = cur.fetchall()
                
                # Process prices - use special_price if available, otherwise use price
                # Apply VAT calculation for UK/NL to get excluding-tax price
                result = {}
                for row in rows:
                    sku = row['sku']
                    price = float(row['price']) if row['price'] else None
                    special = float(row['special_price']) if row['special_price'] else None
                    
                    # Priority: special_price > price
                    final_price = None
                    if special and special > 0:
                        final_price = special
                    elif price and price > 0:
                        final_price = price
                    
                    # Apply VAT calculation if needed (UK/NL divide by 1.2 to get excl. VAT)
                    if final_price:
                        if needs_vat_calculation:
                            result[sku] = final_price / VAT_MULTIPLIER
                        else:
                            result[sku] = final_price
                
                vat_note = "(excl. VAT)" if needs_vat_calculation else "(already excl. VAT)"
                logger.info(f"Loaded {len(result)} sell prices {vat_note} from {region.upper()} Magento catalog")
                
                return result
        except Exception as e:
            logger.error(f"Error fetching sell prices from Magento: {e}", exc_info=True)
            return {}
        finally:
            if conn:
                conn.close()
    
    def get_comparison_with_inventory(self, internal_sku: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get supplier price comparison WITH inventory metadata details.
        Shows Magento product info alongside supplier ACTIVE prices.
        
        Active prices are determined by:
        - effective_date <= CURRENT_DATE (not pending/future)
        - status IS NULL OR status != 'cancelled' (not cancelled)
        - Most recent effective_date wins (with created_at as tiebreaker)
        """
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            query = """
                WITH active_prices AS (
                    SELECT DISTINCT ON (supplier_product_id)
                        supplier_product_id, buy_price, effective_date, COALESCE(currency, 'GBP') as currency
                    FROM sourcing_prices
                    WHERE effective_date <= CURRENT_DATE
                      AND (status IS NULL OR status != 'cancelled')
                    ORDER BY supplier_product_id, effective_date DESC, created_at DESC
                )
                SELECT 
                    sp.internal_sku,
                    sp.supplier_id,
                    s.name as supplier_name,
                    sp.supplier_sku,
                    sp.supplier_product_name,
                    sp.pack_size,
                    ap.buy_price,
                    COALESCE(ap.currency, 'GBP') as currency,
                    ap.effective_date,
                    -- Inventory metadata details (stock and status)
                    -- Calculate total stock: shelf_lt1_qty + shelf_gt1_qty + top_floor_total
                    (COALESCE(im.shelf_lt1_qty, 0) + COALESCE(im.shelf_gt1_qty, 0) + COALESCE(im.top_floor_total, 0)) as quantity_available,
                    im.uk_6m_data,
                    im.fr_6m_data,
                    COALESCE(im.status, 'Unknown') as inventory_status
                FROM sourcing_supplier_products sp
                JOIN sourcing_suppliers s ON s.id = sp.supplier_id
                LEFT JOIN active_prices ap ON ap.supplier_product_id = sp.id
                LEFT JOIN inventory_metadata im ON im.sku = sp.internal_sku
                WHERE sp.internal_sku IS NOT NULL
                  AND sp.is_active = TRUE
                  AND s.is_active = TRUE
            """
            params = []
            
            if internal_sku:
                query += " AND sp.internal_sku = %s"
                params.append(internal_sku)
            
            query += " ORDER BY sp.internal_sku, ap.buy_price NULLS LAST"
            
            cur.execute(query, params)
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        except Exception as e:
            logger.error(f"Error in get_comparison_with_inventory: {e}")
            raise
        finally:
            return_inventory_connection(conn)
