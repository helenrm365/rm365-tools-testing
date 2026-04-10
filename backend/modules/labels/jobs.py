from __future__ import annotations
from typing import Any, Dict, List, Tuple
import logging
from psycopg2.extensions import connection as PGConn  # type: ignore
from modules.labels.repo import LabelsRepo
from core.db import get_inventory_log_connection, return_inventory_connection

logger = logging.getLogger(__name__)


def _ensure_label_print_schema(conn: PGConn) -> None:
    """Make sure new columns exist for legacy deployments."""
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.label_print_jobs')")
        jobs_exists = cur.fetchone()[0] is not None
    if not jobs_exists:
        with conn.cursor() as cur:
            logger.info("Creating missing label_print_jobs table")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS label_print_jobs (
                    id SERIAL PRIMARY KEY,
                    created_by VARCHAR(255),
                    line VARCHAR(255),
                    region VARCHAR(10) DEFAULT 'uk',
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )

    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.label_print_items')")
        items_exists = cur.fetchone()[0] is not None
    if not items_exists:
        with conn.cursor() as cur:
            logger.info("Creating missing label_print_items table")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS label_print_items (
                    id SERIAL PRIMARY KEY,
                    job_id INTEGER NOT NULL REFERENCES label_print_jobs(id) ON DELETE CASCADE,
                    item_id VARCHAR(255),
                    sku VARCHAR(255),
                    product_name TEXT,
                    uk_6m_data INTEGER DEFAULT 0,
                    fr_6m_data INTEGER DEFAULT 0,
                    price DECIMAL(10, 2) DEFAULT 0.00,
                    line VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_label_print_items_job_id ON label_print_items (job_id)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_label_print_items_sku ON label_print_items (sku)
                """
            )

    # Create label printing presets table if not exists
    with conn.cursor() as cur:
        cur.execute("SELECT to_regclass('public.label_printing_presets')")
        presets_exists = cur.fetchone()[0] is not None
    if not presets_exists:
        with conn.cursor() as cur:
            logger.info("Creating missing label_printing_presets table")
            cur.execute(
                """
                CREATE TABLE IF NOT EXISTS label_printing_presets (
                    id SERIAL PRIMARY KEY,
                    name VARCHAR(255) NOT NULL,
                    description TEXT,
                    status_filters JSONB DEFAULT '[]'::jsonb,
                    region VARCHAR(10) DEFAULT 'uk',
                    product_skus JSONB DEFAULT '[]'::jsonb,
                    created_by VARCHAR(255),
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_label_presets_name ON label_printing_presets (name)
                """
            )
            cur.execute(
                """
                CREATE INDEX IF NOT EXISTS idx_label_presets_created_by ON label_printing_presets (created_by)
                """
            )
        return

    # Avoid re-running ALTER for every insert by checking information_schema first.
    
    # Check and migrate label_print_jobs columns
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'label_print_jobs'
            """
        )
        existing_jobs = {row[0] for row in cur.fetchall()}

    jobs_alter_statements = []
    if 'line' not in existing_jobs:
        jobs_alter_statements.append(
            "ALTER TABLE label_print_jobs ADD COLUMN IF NOT EXISTS line VARCHAR(255)"
        )
    if 'region' not in existing_jobs:
        jobs_alter_statements.append(
            "ALTER TABLE label_print_jobs ADD COLUMN IF NOT EXISTS region VARCHAR(10) DEFAULT 'uk'"
        )

    if jobs_alter_statements:
        with conn.cursor() as cur:
            for stmt in jobs_alter_statements:
                logger.info("Applying label_print_jobs schema patch: %s", stmt)
                cur.execute(stmt)
    
    # Check and migrate label_print_items columns
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = 'label_print_items'
            """
        )
        existing = {row[0] for row in cur.fetchall()}

    alter_statements = []
    if 'price' not in existing:
        alter_statements.append(
            "ALTER TABLE label_print_items ADD COLUMN IF NOT EXISTS price DECIMAL(10, 2) DEFAULT 0.00"
        )
    if 'line' not in existing:
        alter_statements.append(
            "ALTER TABLE label_print_items ADD COLUMN IF NOT EXISTS line VARCHAR(255)"
        )
    if 'created_at' not in existing:
        alter_statements.append(
            "ALTER TABLE label_print_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        )
    if 'sort_order' not in existing:
        alter_statements.append(
            "ALTER TABLE label_print_items ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0"
        )

    # Drop NOT NULL constraint on item_id if it exists (products may not have item_ids yet)
    with conn.cursor() as cur:
        cur.execute("""
            SELECT is_nullable FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'label_print_items' AND column_name = 'item_id'
        """)
        row = cur.fetchone()
        if row and row[0] == 'NO':
            alter_statements.append(
                "ALTER TABLE label_print_items ALTER COLUMN item_id DROP NOT NULL"
            )

    if alter_statements:
        with conn.cursor() as cur:
            for stmt in alter_statements:
                logger.info("Applying label_print_items schema patch: %s", stmt)
                cur.execute(stmt)

# --- helpers ---------------------------------------------------------------

def _snapshot_rows(item_ids: List[str] = None, discontinued_statuses: List[str] = None, region: str = "uk") -> List[Dict[str, Any]]:
    """
    Pull current /to-print rows from your repo, optionally filtered by item_ids.
    Expected keys used below: sku, item_id, product_name, uk_6m_data, fr_6m_data
    Uses inventory_logs database connection to query magento, inventory_metadata, and sales data.
    
    Args:
        item_ids: Optional list of item IDs to filter by
        discontinued_statuses: Optional list of statuses to filter by (e.g., ['Active', 'Discontinued (Supplier)'])
        region: Region for price/name preference (default 'uk')
    """
    inventory_conn = None
    try:
        # Use inventory_logs database connection (same as /to-print endpoint)
        inventory_conn = get_inventory_log_connection()
        all_rows = LabelsRepo().get_labels_to_print_psycopg(inventory_conn, product_statuses=discontinued_statuses, preferred_region=region)
    except Exception as e:
        logger.error(f"Error fetching labels data: {e}")
        raise
    finally:
        if inventory_conn:
            return_inventory_connection(inventory_conn)
    
    # Filter by selected item_ids if provided, preserving the order from item_ids
    # item_ids from the frontend are actually SKUs (used as stable unique identifiers)
    if item_ids:
        # Create a lookup dict by SKU for O(1) access
        rows_by_sku = {r.get("sku"): r for r in all_rows}
        # Return rows in the same order as item_ids (preserves frontend sort order)
        filtered_rows = [rows_by_sku[sku] for sku in item_ids if sku in rows_by_sku]
        return filtered_rows
    
    return all_rows

# --- API-facing functions --------------------------------------------------

def start_label_job(conn: PGConn, payload: Dict[str, Any]) -> int:
    """
    Create job + bulk insert rows.
    payload: { 
        'line': 'optional text' (optional - for future use), 
        'created_by': 'email' (optional),
        'item_ids': ['id1', 'id2', ...] (optional - if not provided, uses all products),
        'discontinued_statuses': ['Active', ...] (optional - status filters),
        'region': 'uk'|'fr'|'nl' (optional - region preference)
    }
    """
    line = payload.get("line")  # optional text field for future use
    created_by = payload.get("created_by")
    item_ids = payload.get("item_ids")  # list of selected item IDs
    discontinued_statuses = payload.get("discontinued_statuses")  # status filters
    region = payload.get("region", "uk")  # region preference, default to UK

    try:
        _ensure_label_print_schema(conn)
    except Exception as e:
        logger.error(f"Failed to ensure schema: {e}")
        raise

    # 2) snapshot current rows (filtered by item_ids if provided) - do this BEFORE starting transaction
    # This uses a SEPARATE connection to the inventory database
    try:
        rows = _snapshot_rows(item_ids, discontinued_statuses, region)
        logger.info(f"Fetched {len(rows)} rows for new job")
    except Exception as e:
        logger.error(f"Failed to snapshot rows: {e}")
        raise

    with conn.cursor() as cur:
        try:
            # 1) insert job with region
            cur.execute(
                """
                INSERT INTO label_print_jobs (created_by, line, region)
                VALUES (%s, %s, %s)
                RETURNING id
                """,
                (created_by, line, region),
            )
            job_id = cur.fetchone()[0]
            logger.info(f"Created label job {job_id} for region {region}")
        except Exception as e:
            logger.error(f"Failed to create job record: {e}")
            raise

        # 3) bulk insert items (map keys—adjust if your row keys differ)
        to_insert: List[Tuple[Any, ...]] = []
        for idx, r in enumerate(rows):
            # Parse price, removing currency symbols
            price_str = str(r.get("price", "0.00"))
            # Remove common currency symbols and whitespace
            price_clean = price_str.replace("£", "").replace("€", "").replace("$", "").strip()
            try:
                price_float = float(price_clean) if price_clean else 0.00
            except ValueError:
                logger.warning(f"Could not parse price '{price_str}' for SKU {r.get('sku')}, using 0.00")
                price_float = 0.00
            
            # Parse 6M data, handling string values
            try:
                uk_6m = int(str(r.get("uk_6m_data", 0)).replace(",", ""))
            except (ValueError, AttributeError):
                logger.warning(f"Could not parse UK 6M data '{r.get('uk_6m_data')}' for SKU {r.get('sku')}, using 0")
                uk_6m = 0
            
            try:
                fr_6m = int(str(r.get("fr_6m_data", 0)).replace(",", ""))
            except (ValueError, AttributeError):
                logger.warning(f"Could not parse FR 6M data '{r.get('fr_6m_data')}' for SKU {r.get('sku')}, using 0")
                fr_6m = 0
            
            to_insert.append((
                job_id,
                r.get("item_id"),
                r.get("sku"),
                r.get("product_name", ""),
                uk_6m,
                fr_6m,
                price_float,  # Use cleaned price
                None,  # per-row line (override) — keep None now
                idx,   # sort_order - preserves frontend table sort order
            ))

        if to_insert:
            try:
                cur.executemany(
                    """
                    INSERT INTO label_print_items
                        (job_id, item_id, sku, product_name, uk_6m_data, fr_6m_data, price, line, sort_order)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    """,
                    to_insert,
                )
                logger.info(f"Inserted {len(to_insert)} items for job {job_id}")
            except Exception as e:
                logger.error(f"Failed to insert items: {e}")
                logger.error(f"Sample data causing error: {to_insert[0] if to_insert else 'None'}")
                raise
        
        logger.info(f"Created label job {job_id} with {len(to_insert)} items")

    # Don't commit here - let the context manager handle it
    return job_id


def get_label_job_rows(conn: PGConn, job_id: int) -> List[Dict[str, Any]]:
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT id, job_id, item_id, sku, product_name, uk_6m_data, fr_6m_data, price, line, sort_order
            FROM label_print_items
            WHERE job_id = %s
            ORDER BY sort_order, id
            """,
            (job_id,),
        )
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def delete_label_job(conn: PGConn, job_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM label_print_jobs WHERE id = %s", (job_id,))
    conn.commit()


def delete_label_jobs(conn: PGConn, job_ids: List[int] = None, delete_all: bool = False) -> int:
    """
    Delete multiple label print jobs or all jobs.
    
    Args:
        conn: PostgreSQL connection
        job_ids: List of job IDs to delete (if provided)
        delete_all: If True, deletes all jobs regardless of job_ids
        
    Returns:
        Number of jobs deleted
    """
    with conn.cursor() as cur:
        if delete_all:
            # Delete all jobs
            cur.execute("DELETE FROM label_print_jobs")
            deleted_count = cur.rowcount
            logger.info(f"Deleted all {deleted_count} label print jobs")
        elif job_ids:
            # Delete specific jobs
            cur.execute(
                "DELETE FROM label_print_jobs WHERE id = ANY(%s)",
                (job_ids,)
            )
            deleted_count = cur.rowcount
            logger.info(f"Deleted {deleted_count} label print jobs: {job_ids}")
        else:
            deleted_count = 0
            logger.warning("No job_ids provided and delete_all is False")
    
    conn.commit()
    return deleted_count
