from __future__ import annotations
import io, csv
from typing import Any, Iterable
from psycopg2.extensions import connection as PGConn  # type: ignore
from fastapi.responses import StreamingResponse


def stream_csv_labels(conn: PGConn, job_id: int) -> StreamingResponse:
    """
    Stream a CSV of all rows in a print job.
    Columns: row_id, job_id, line_date, sku, item_id, product_name, uk_6m_data, fr_6m_data, job_created_at
    """
    with conn.cursor() as cur:
        cur.execute(
            """
            SELECT
              r.id AS row_id,
              r.job_id,
              COALESCE(r.line_date, j.line_date) AS line_date,
              r.sku,
              r.item_id,
              r.product_name,
              r.uk_6m_data,
              r.fr_6m_data,
              j.created_at AS job_created_at
            FROM label_print_items r
            JOIN label_print_jobs  j ON j.id = r.job_id
            WHERE r.job_id = %s
            ORDER BY r.sku
            """,
            (job_id,),
        )
        rows = cur.fetchall()
        headers = [c[0] for c in cur.description]

    # build CSV once (simple + fine for typical job sizes)
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(headers)
    w.writerows(rows)

    filename = f"labels_job_{job_id}.csv"
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
