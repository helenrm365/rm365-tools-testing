# modules/inventory/api.py
"""
Inventory module root API - provides dashboard stats and common endpoints.
The main inventory functionality is in management/api.py and other submodules.
"""
import logging
from fastapi import APIRouter, Depends, Query
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
