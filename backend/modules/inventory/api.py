# modules/inventory/api.py
"""
Inventory module root API - provides dashboard stats and common endpoints.
The main inventory functionality is in management/api.py and other submodules.
"""
import logging
from typing import List, Optional
from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel, Field
from common.deps import get_current_user
from core.db import get_inventory_log_connection, return_inventory_connection

logger = logging.getLogger(__name__)
router = APIRouter()

# Whitelist of allowed branch table names (prevents SQL injection)
BRANCH_TABLES = {
    'uk-birmingham': 'uk_birmingham_inventory',
    'uk-london':     'uk_london_inventory',
    'fr-paris':      'fr_paris_inventory',
}


@router.get("/health")
def inventory_health():
    """Health check for inventory module"""
    return {
        "status": "healthy",
        "message": "Inventory module ready"
    }


@router.get("/low-stock-count")
def get_low_stock_count(user=Depends(get_current_user)):
    """
    Get count of low stock items for dashboard.
    """
    try:
        from .management.service import InventoryManagementService
        svc = InventoryManagementService()
        
        # Get items with low stock flag
        items = svc.list_items(limit=1000, low_stock_only=True)
        count = len(items) if items else 0
        
        return {"count": count}
    except Exception as e:
        # Log but don't fail - return 0 for dashboard
        import logging
        logging.getLogger(__name__).warning(f"Failed to get low stock count: {e}")
        return {"count": 0}


@router.get("/stock-level-counts")
def get_stock_level_counts(
    branches: str = Query(default="uk-birmingham,uk-london,fr-paris"),
    user=Depends(get_current_user),
):
    """
    Count products by stock level (low / over / stable) across selected branches.

    Stock classification (mirrors frontend calculateStockStatus):
      demand     = uk_6m_data + fr_6m_data
      totalStock = shelf_lt1_qty + shelf_gt1_qty + top_floor_total
      overstock  : totalStock >= demand * 3
      lowstock   : totalStock < demand
      stable     : everything else (demand > 0)
    """
    branch_list = [b.strip() for b in branches.split(",") if b.strip()]
    tables = [BRANCH_TABLES[b] for b in branch_list if b in BRANCH_TABLES]

    if not tables:
        return {"low_stock": 0, "over_stock": 0, "stable": 0}

    # Build a UNION ALL across all selected branch tables
    unions = " UNION ALL ".join(
        f"""
        SELECT
            COALESCE(shelf_lt1_qty, 0) + COALESCE(shelf_gt1_qty, 0)
                + COALESCE(top_floor_total, 0) AS total_stock,
            CASE WHEN uk_6m_data ~ '^\\d+$' THEN uk_6m_data::int ELSE 0 END
                + CASE WHEN fr_6m_data ~ '^\\d+$' THEN fr_6m_data::int ELSE 0 END AS demand
        FROM {t}
        """
        for t in tables
    )

    sql = f"""
    WITH stock_data AS ({unions})
    SELECT
        COUNT(*) FILTER (WHERE demand > 0 AND total_stock < demand)                       AS low_stock,
        COUNT(*) FILTER (WHERE demand > 0 AND total_stock >= demand * 3)                   AS over_stock,
        COUNT(*) FILTER (WHERE demand > 0 AND total_stock >= demand AND total_stock < demand * 3) AS stable
    FROM stock_data
    """

    conn = None
    try:
        conn = get_inventory_log_connection()
        cur = conn.cursor()
        cur.execute(sql)
        row = cur.fetchone()
        cur.close()
        return {
            "low_stock":  row[0] if row else 0,
            "over_stock": row[1] if row else 0,
            "stable":     row[2] if row else 0,
        }
    except Exception as e:
        logger.warning(f"Failed to get stock level counts: {e}")
        return {"low_stock": 0, "over_stock": 0, "stable": 0}
    finally:
        if conn:
            return_inventory_connection(conn)


# ─────────────────────────────────────────────────────────────────────────────
# Mobile / Zebra scanner endpoints
# ─────────────────────────────────────────────────────────────────────────────

@router.get("/lookup", tags=["mobile"])
def lookup_by_barcode(
    barcode: str = Query(..., min_length=1, description="Scanned item_id (18-digit) or SKU"),
    branch: str = Query("uk-birmingham", description="Branch: uk-birmingham, uk-london, fr-paris"),
    user=Depends(get_current_user),
):
    """
    Fast single-row product lookup for handheld scanners.

    Queries the branch inventory table directly on the indexed `item_id` (UNIQUE)
    and `sku` (PRIMARY KEY) columns, returning sub-second results. This deliberately
    bypasses `load_inventory_metadata()`, which loads and filters the entire table
    in Python and is unsuitable for high-frequency scanning.
    """
    table = BRANCH_TABLES.get(branch)
    if not table:
        raise HTTPException(status_code=400, detail=f"Invalid branch: {branch}")

    scanned = barcode.strip()
    if not scanned:
        raise HTTPException(status_code=400, detail="barcode is required")

    conn = None
    try:
        conn = get_inventory_log_connection()
        cur = conn.cursor()
        # Both item_id and sku are indexed → index scan, no full-table read.
        cur.execute(
            f"""
            SELECT sku, item_id, product_name, location, status,
                   COALESCE(shelf_lt1_qty, 0)  AS shelf_lt1_qty,
                   COALESCE(shelf_gt1_qty, 0)  AS shelf_gt1_qty,
                   COALESCE(top_floor_total, 0) AS top_floor_total,
                   (COALESCE(shelf_lt1_qty, 0)
                    + COALESCE(shelf_gt1_qty, 0)
                    + COALESCE(top_floor_total, 0)) AS total_stock
            FROM {table}
            WHERE item_id = %s OR sku = %s
            LIMIT 1
            """,
            (scanned, scanned),
        )
        row = cur.fetchone()
        cur.close()
        if not row:
            raise HTTPException(status_code=404, detail=f"Barcode not found: {scanned}")

        cols = [
            "sku", "item_id", "product_name", "location", "status",
            "shelf_lt1_qty", "shelf_gt1_qty", "top_floor_total", "total_stock",
        ]
        result = dict(zip(cols, row))
        result["branch"] = branch
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Barcode lookup failed for '{scanned}' on {branch}: {e}")
        raise HTTPException(status_code=500, detail="Lookup failed")
    finally:
        if conn:
            return_inventory_connection(conn)


class ScanIn(BaseModel):
    idempotency_key: str = Field(..., description="Client-generated unique id for this scan (e.g. UUID)")
    barcode: str = Field(..., description="Scanned item_id")
    delta: int = Field(..., description="Quantity change (positive add, negative remove)")
    field: str = Field("auto", description="auto, shelf_lt1_qty, shelf_gt1_qty, or top_floor_total")
    branch: str = Field("uk-birmingham", description="Branch: uk-birmingham, uk-london, fr-paris")
    reason: str = Field("Scan", description="Reason for the adjustment")


class BatchUpdateIn(BaseModel):
    scans: List[ScanIn] = Field(..., description="Offline queue of scans to replay")


@router.post("/update/batch", tags=["mobile"])
def update_inventory_batch(body: BatchUpdateIn, user=Depends(get_current_user)):
    """
    Replay an offline queue of scans from the Kotlin app when Wi-Fi reconnects.

    Each scan carries a client-generated `idempotency_key`. The key is atomically
    claimed (INSERT ... ON CONFLICT DO NOTHING) before the stock change is applied,
    so re-uploading the same queue can never double-apply an adjustment.
    Results are returned per-scan so the client can clear its local queue safely.
    """
    from .adjustments.service import AdjustmentsService

    if not body.scans:
        return {"processed": 0, "applied": 0, "duplicates": 0, "errors": 0, "results": []}

    username = user.get("username") or user.get("email") or "Unknown"
    svc = AdjustmentsService()
    svc.repo.init_idempotency_table()

    results = []
    applied = duplicates = errors = 0

    for scan in body.scans:
        # Atomically claim the key. If already present, this is a replay → skip.
        claimed = svc.repo.try_claim_idempotency_key(
            key=scan.idempotency_key,
            barcode=scan.barcode,
            field=scan.field,
            delta=scan.delta,
            branch_id=scan.branch,
        )
        if not claimed:
            duplicates += 1
            results.append({
                "idempotency_key": scan.idempotency_key,
                "status": "duplicate",
            })
            continue

        try:
            svc.log_adjustment(
                barcode=scan.barcode,
                quantity=scan.delta,
                reason=scan.reason,
                field=scan.field,
                adjusted_by=username,
                branch_id=scan.branch,
            )
            svc.repo.mark_idempotency_result(scan.idempotency_key, "applied", "ok")
            applied += 1
            results.append({
                "idempotency_key": scan.idempotency_key,
                "status": "applied",
            })
        except Exception as e:
            errors += 1
            svc.repo.mark_idempotency_result(scan.idempotency_key, "error", str(e)[:500])
            results.append({
                "idempotency_key": scan.idempotency_key,
                "status": "error",
                "error": str(e),
            })

    return {
        "processed": len(body.scans),
        "applied": applied,
        "duplicates": duplicates,
        "errors": errors,
        "results": results,
    }
