from __future__ import annotations
from typing import Any, Dict, List, Tuple
import logging
from psycopg2.extensions import connection as PGConn  # type: ignore
from modules.labels.repo import LabelsRepo

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
                    line_date DATE,
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
                    item_id VARCHAR(255) NOT NULL,
                    sku VARCHAR(255),
                    product_name TEXT,
                    uk_6m_data INTEGER DEFAULT 0,
                    fr_6m_data INTEGER DEFAULT 0,
                    price DECIMAL(10, 2) DEFAULT 0.00,
                    line_date DATE,
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
        return

    # Avoid re-running ALTER for every insert by checking information_schema first.
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
    if 'line_date' not in existing:
        alter_statements.append(
            "ALTER TABLE label_print_items ADD COLUMN IF NOT EXISTS line_date DATE"
        )
    if 'created_at' not in existing:
        alter_statements.append(
            "ALTER TABLE label_print_items ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        )

    if not alter_statements:
        return

    with conn.cursor() as cur:
        for stmt in alter_statements:
            logger.info("Applying label_print_items schema patch: %s", stmt)
            cur.execute(stmt)

# --- helpers ---------------------------------------------------------------

def _snapshot_rows(conn: PGConn, zoho_map: Dict[str, str], item_ids: List[str] = None) -> List[Dict[str, Any]]:
    """
    Pull current /to-print rows from your repo, optionally filtered by item_ids.
    Expected keys used below: sku, item_id, product_name, uk_6m_data, fr_6m_data
    """
    try:
        all_rows = LabelsRepo().get_labels_to_print_psycopg(conn, zoho_map)
        logger.info(f"Fetched {len(all_rows)} total rows from labels repo")
    except Exception as e:
        logger.error(f"Error fetching labels data: {e}")
        raise
    
    # Filter by selected item_ids if provided
    if item_ids:
        item_ids_set = set(item_ids)
        filtered_rows = [r for r in all_rows if r.get("item_id") in item_ids_set]
        logger.info(f"Filtered to {len(filtered_rows)} rows based on {len(item_ids)} item IDs")
        return filtered_rows
    
    return all_rows

# --- API-facing functions --------------------------------------------------

def start_label_job(conn: PGConn, zoho_map: Dict[str, str], payload: Dict[str, Any]) -> int:
    """
    Create job + bulk insert rows.
    payload: { 
        'line_date': 'YYYY-MM-DD' (optional), 
        'created_by': 'email' (optional),
        'item_ids': ['id1', 'id2', ...] (optional - if not provided, uses all products)
    }
    """
    line_date = payload.get("line_date")  # let SQL cast DATE if provided
    created_by = payload.get("created_by")
    item_ids = payload.get("item_ids")  # list of selected item IDs

    try:
        _ensure_label_print_schema(conn)
    except Exception as e:
        logger.error(f"Failed to ensure schema: {e}")
        raise

    with conn.cursor() as cur:
        try:
            # 1) insert job
            cur.execute(
                """
                INSERT INTO label_print_jobs (created_by, line_date)
                VALUES (%s, %s)
                RETURNING id
                """,
                (created_by, line_date),
            )
            job_id = cur.fetchone()[0]
            logger.info(f"Created label job {job_id}")
        except Exception as e:
            logger.error(f"Failed to create job record: {e}")
            raise

        # 2) snapshot current rows (filtered by item_ids if provided)
        try:
            rows = _snapshot_rows(conn, zoho_map, item_ids)
            logger.info(f"Fetched {len(rows)} rows for job {job_id}")
        except Exception as e:
            logger.error(f"Failed to snapshot rows: {e}")
            raise

        # 3) bulk insert items (map keys—adjust if your row keys differ)
        to_insert: List[Tuple[Any, ...]] = []
        for r in rows:
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
                None,  # per-row line_date (override) — keep None now
            ))

        if to_insert:
            try:
                cur.executemany(
                    """
                    INSERT INTO label_print_items
                        (job_id, item_id, sku, product_name, uk_6m_data, fr_6m_data, price, line_date)
                    VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
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
            SELECT id, job_id, item_id, sku, product_name, uk_6m_data, fr_6m_data, price, line_date
            FROM label_print_items
            WHERE job_id = %s
            ORDER BY sku
            """,
            (job_id,),
        )
        cols = [c[0] for c in cur.description]
        return [dict(zip(cols, row)) for row in cur.fetchall()]


def delete_label_job(conn: PGConn, job_id: int) -> None:
    with conn.cursor() as cur:
        cur.execute("DELETE FROM label_print_jobs WHERE id = %s", (job_id,))
    conn.commit()
