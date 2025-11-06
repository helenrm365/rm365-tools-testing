from __future__ import annotations
from typing import Any, Dict, List, Tuple
from psycopg2.extensions import connection as PGConn  # type: ignore
from modules.labels.repo import LabelsRepo

# --- helpers ---------------------------------------------------------------

def _snapshot_rows(conn: PGConn, zoho_map: Dict[str, str], item_ids: List[str] = None) -> List[Dict[str, Any]]:
    """
    Pull current /to-print rows from your repo, optionally filtered by item_ids.
    Expected keys used below: sku, item_id, product_name, uk_6m_data, fr_6m_data
    """
    all_rows = LabelsRepo().get_labels_to_print_psycopg(conn, zoho_map)
    
    # Filter by selected item_ids if provided
    if item_ids:
        item_ids_set = set(item_ids)
        return [r for r in all_rows if r.get("item_id") in item_ids_set]
    
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

    with conn.cursor() as cur:
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

        # 2) snapshot current rows (filtered by item_ids if provided)
        rows = _snapshot_rows(conn, zoho_map, item_ids)

        # 3) bulk insert items (map keys—adjust if your row keys differ)
        to_insert: List[Tuple[Any, ...]] = []
        for r in rows:
            to_insert.append((
                job_id,
                r.get("item_id"),
                r.get("sku"),
                r.get("product_name", ""),
                int(r.get("uk_6m_data", 0)),
                int(r.get("fr_6m_data", 0)),
                float(r.get("price", 0.00)),  # Include price from sales data
                None,  # per-row line_date (override) — keep None now
            ))

        if to_insert:
            cur.executemany(
                """
                INSERT INTO label_print_items
                    (job_id, item_id, sku, product_name, uk_6m_data, fr_6m_data, price, line_date)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
                """,
                to_insert,
            )

    conn.commit()
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
