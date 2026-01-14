"""
Repository layer for Product Sourcing module
Handles all database operations
"""
from __future__ import annotations
from typing import List, Dict, Any, Optional
from datetime import date
import logging

from core.db import get_inventory_log_connection

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
        
        _tables_initialized = True
        
    except Exception as e:
        logger.error(f"[Sourcing] Error ensuring tables exist: {e}")
        conn.rollback()
        raise
    finally:
        conn.close()


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
    cur.execute("""
        CREATE TABLE IF NOT EXISTS sourcing_prices (
            id SERIAL PRIMARY KEY,
            supplier_product_id INTEGER NOT NULL REFERENCES sourcing_supplier_products(id) ON DELETE CASCADE,
            buy_price DECIMAL(12, 4) NOT NULL,
            currency VARCHAR(3) DEFAULT 'GBP',
            effective_date DATE NOT NULL,
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
                SELECT id, name, code, contact_email, contact_phone, 
                       website, notes, is_active, created_at, updated_at
                FROM sourcing_suppliers
                WHERE 1=1
            """
            if not include_inactive:
                query += " AND is_active = TRUE"
            query += " ORDER BY name"
            
            cur.execute(query)
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        finally:
            conn.close()
    
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
        finally:
            conn.close()
    
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
        finally:
            conn.close()
    
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
        finally:
            conn.close()
    
    # ====== Supplier Product Mapping Operations ======
    
    def get_supplier_products(
        self, 
        supplier_id: Optional[int] = None,
        internal_sku: Optional[str] = None,
        include_inactive: bool = False
    ) -> List[Dict[str, Any]]:
        """Get supplier product mappings with optional filters"""
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            query = """
                SELECT sp.id, sp.supplier_id, sp.supplier_sku, sp.supplier_product_name,
                       sp.internal_sku, sp.pack_size, sp.notes, sp.is_active,
                       sp.created_at, sp.updated_at,
                       s.name as supplier_name,
                       (SELECT buy_price FROM sourcing_prices 
                        WHERE supplier_product_id = sp.id 
                        ORDER BY effective_date DESC LIMIT 1) as current_buy_price,
                       (SELECT effective_date FROM sourcing_prices 
                        WHERE supplier_product_id = sp.id 
                        ORDER BY effective_date DESC LIMIT 1) as current_price_date
                FROM sourcing_supplier_products sp
                JOIN sourcing_suppliers s ON s.id = sp.supplier_id
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
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        finally:
            conn.close()
    
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
        finally:
            conn.close()
    
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
        finally:
            conn.close()
    
    # ====== Price Operations ======
    
    def get_price_history(
        self, 
        supplier_product_id: Optional[int] = None,
        internal_sku: Optional[str] = None,
        limit: int = 100
    ) -> List[Dict[str, Any]]:
        """Get price history with optional filters"""
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            query = """
                SELECT p.id, p.supplier_product_id, p.buy_price, p.currency,
                       p.effective_date, p.notes, p.created_by, p.created_at,
                       p.import_batch_id,
                       sp.supplier_sku, sp.supplier_product_name, sp.internal_sku,
                       s.name as supplier_name
                FROM sourcing_prices p
                JOIN sourcing_supplier_products sp ON sp.id = p.supplier_product_id
                JOIN sourcing_suppliers s ON s.id = sp.supplier_id
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
        finally:
            conn.close()
    
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
        finally:
            conn.close()
    
    # ====== Comparison / Reporting Queries ======
    
    def get_supplier_comparison(self, internal_sku: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get supplier price comparison for internal products.
        Returns all suppliers' current prices for each internal product.
        """
        conn = get_inventory_log_connection()
        try:
            cur = conn.cursor()
            query = """
                WITH latest_prices AS (
                    SELECT DISTINCT ON (supplier_product_id)
                        supplier_product_id, buy_price, effective_date
                    FROM sourcing_prices
                    ORDER BY supplier_product_id, effective_date DESC
                )
                SELECT 
                    sp.internal_sku,
                    sp.supplier_id,
                    s.name as supplier_name,
                    sp.supplier_sku,
                    sp.supplier_product_name,
                    lp.buy_price,
                    lp.effective_date
                FROM sourcing_supplier_products sp
                JOIN sourcing_suppliers s ON s.id = sp.supplier_id
                LEFT JOIN latest_prices lp ON lp.supplier_product_id = sp.id
                WHERE sp.internal_sku IS NOT NULL
                  AND sp.is_active = TRUE
                  AND s.is_active = TRUE
            """
            params = []
            
            if internal_sku:
                query += " AND sp.internal_sku = %s"
                params.append(internal_sku)
            
            query += " ORDER BY sp.internal_sku, lp.buy_price NULLS LAST"
            
            cur.execute(query, params)
            columns = [desc[0] for desc in cur.description]
            return [dict(zip(columns, row)) for row in cur.fetchall()]
        finally:
            conn.close()
    
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
        finally:
            conn.close()
    
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
        finally:
            conn.close()
