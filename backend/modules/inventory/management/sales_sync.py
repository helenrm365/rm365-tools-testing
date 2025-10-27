from __future__ import annotations

import logging
from typing import Dict, Tuple
from collections import defaultdict

import requests

from core.config import settings
from core.db import get_products_connection, get_inventory_log_connection
from modules._integrations.zoho.client import zoho_auth_header

logger = logging.getLogger(__name__)

ZOHO_INVENTORY_BASE = "https://www.zohoapis.eu/inventory/v1"
ZOHO_ORG_ID = settings.ZC_ORG_ID


def get_zoho_items_with_skus() -> Dict[str, str]:
    sku_to_item_id = {}
    page = 1

    while True:
        logger.info(f"Fetching Zoho items page {page}...")

        url = f"{ZOHO_INVENTORY_BASE}/items"
        headers = zoho_auth_header()
        params = {"organization_id": ZOHO_ORG_ID, "page": page, "per_page": 200}

        resp = requests.get(url, headers=headers, params=params, timeout=30)
        resp.raise_for_status()
        data = resp.json()

        items = data.get("items", [])
        if not items:
            break

        for item in items:
            sku = item.get("sku", "").strip()
            item_id = item.get("item_id", "").strip()

            if sku and item_id:
                sku_to_item_id[sku] = item_id

        if not data.get("page_context", {}).get("has_more_page", False):
            break

        page += 1

    logger.info(f"Fetched {len(sku_to_item_id)} items from Zoho")
    return sku_to_item_id


def get_regional_sales() -> Tuple[Dict[str, int], Dict[str, int], Dict[str, int]]:
    conn = get_products_connection()

    try:
        cursor = conn.cursor()

        cursor.execute(
            "SELECT sku, total_qty FROM uk_condensed_sales WHERE sku IS NOT NULL AND sku != ''"
        )
        uk_sales = {row[0]: int(row[1] or 0) for row in cursor.fetchall()}

        cursor.execute(
            "SELECT sku, total_qty FROM fr_condensed_sales WHERE sku IS NOT NULL AND sku != ''"
        )
        fr_sales = {row[0]: int(row[1] or 0) for row in cursor.fetchall()}

        cursor.execute(
            "SELECT sku, total_qty FROM nl_condensed_sales WHERE sku IS NOT NULL AND sku != ''"
        )
        nl_sales = {row[0]: int(row[1] or 0) for row in cursor.fetchall()}

        logger.info(f"Loaded: UK={len(uk_sales)}, FR={len(fr_sales)}, NL={len(nl_sales)} SKUs")
        return uk_sales, fr_sales, nl_sales

    finally:
        conn.close()


def merge_fr_nl_sales(fr_sales: Dict[str, int], nl_sales: Dict[str, int]) -> Dict[str, int]:
    combined = defaultdict(int)

    for sku, qty in fr_sales.items():
        combined[sku] += qty

    for sku, qty in nl_sales.items():
        combined[sku] += qty

    return dict(combined)


def sync_sales_to_inventory_metadata(dry_run: bool = False) -> Dict[str, any]:
    stats = {
        "total_zoho_items": 0,
        "matched_skus": 0,
        "updated_records": 0,
        "skipped_no_sales": 0,
        "unmatched_skus": [],
    }

    sku_to_item_id = get_zoho_items_with_skus()
    stats["total_zoho_items"] = len(sku_to_item_id)

    uk_sales, fr_sales, nl_sales = get_regional_sales()
    combined_fr_sales = merge_fr_nl_sales(fr_sales, nl_sales)

    conn = get_inventory_log_connection()

    try:
        cursor = conn.cursor()
        all_sales_skus = set(uk_sales.keys()) | set(combined_fr_sales.keys())

        for sku in all_sales_skus:
            if sku not in sku_to_item_id:
                stats["unmatched_skus"].append(sku)
                continue

            stats["matched_skus"] += 1
            item_id = sku_to_item_id[sku]

            uk_qty = uk_sales.get(sku, 0)
            fr_qty = combined_fr_sales.get(sku, 0)

            if uk_qty == 0 and fr_qty == 0:
                stats["skipped_no_sales"] += 1
                continue

            if dry_run:
                logger.info(f"[DRY RUN] Would update {item_id} ({sku}): UK={uk_qty}, FR={fr_qty}")
                stats["updated_records"] += 1
            else:
                cursor.execute(
                    """
                    INSERT INTO inventory_metadata (item_id, uk_6m_data, fr_6m_data, updated_at)
                    VALUES (%s, %s, %s, NOW())
                    ON CONFLICT (item_id) DO UPDATE SET
                        uk_6m_data = EXCLUDED.uk_6m_data,
                        fr_6m_data = EXCLUDED.fr_6m_data,
                        updated_at = NOW()
                    """,
                    (item_id, str(uk_qty), str(fr_qty)),
                )

                stats["updated_records"] += 1

        if not dry_run:
            conn.commit()

    finally:
        conn.close()

    logger.info(f"✅ Sync complete: {stats['updated_records']} records updated")
    return stats
