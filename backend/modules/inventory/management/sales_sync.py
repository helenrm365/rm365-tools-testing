from __future__ import annotations

import logging
from typing import Dict, Tuple, Optional
from collections import defaultdict

import requests

from core.config import settings
from core.db import get_products_connection, get_inventory_log_connection
from modules._integrations.zoho.client import zoho_auth_header

logger = logging.getLogger(__name__)

ZOHO_INVENTORY_BASE = "https://www.zohoapis.eu/inventory/v1"
ZOHO_ORG_ID = settings.ZC_ORG_ID

def _base_of(sku: str) -> str:
    return (sku or "").split("-")[0].strip()

def _resolve_zoho_item(sku_to_item_id: Dict[str, str], base: str) -> tuple[Optional[str], Optional[str]]:
    """Try base, then base-MD. Returns (sku_used, item_id)."""
    md = f"{base}-MD"
    if base in sku_to_item_id:
        return base, sku_to_item_id[base]
    if md in sku_to_item_id:
        return md, sku_to_item_id[md]
    return None, None


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
            status = item.get("status", "").lower() if item.get("status") else "unknown"

            if sku == "ME008":
                logger.info(f"[ZOHO DEBUG] Found ME008 → item_id={item_id}, status={status}")
            if sku and item_id:
                sku_to_item_id[sku] = item_id

        if not data.get("page_context", {}).get("has_more_page", False):
            break

        page += 1

    logger.info(f"Fetched {len(sku_to_item_id)} items from Zoho")
    logger.info(f"[CHECK] Final item_id for ME008: {sku_to_item_id.get('ME008')}")
    return sku_to_item_id

def get_zoho_items_with_skus_full() -> Dict[str, Tuple[str, str]]:
    """
    Return map: { sku: (item_id, product_name) } from Zoho /items (paged).
    """
    sku_map: Dict[str, Tuple[str, str]] = {}
    page = 1

    while True:
        logger.info(f"[FULL] Fetching Zoho items page {page}...")
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
            sku = (item.get("sku") or "").strip()
            item_id = (item.get("item_id") or "").strip()
            name = (item.get("name") or "").strip()
            if sku and item_id:
                sku_map[sku] = (item_id, name)

        if not data.get("page_context", {}).get("has_more_page", False):
            break
        page += 1

    logger.info(f"[FULL] Fetched {len(sku_map)} sku->(item_id,name) from Zoho")
    return sku_map


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

    # Fetch Zoho item map { sku: item_id}
    sku_to_item_id = get_zoho_items_with_skus()
    stats["total_zoho_items"] = len(sku_to_item_id)

    # Fetch raw sales data
    uk_sales, fr_sales, nl_sales = get_regional_sales()
    combined_fr_sales = merge_fr_nl_sales(fr_sales, nl_sales)

    #  Define SKU filter
    def is_valid_sku(sku: str) -> bool:
        if sku.endswith(("-SD", "-DP", "-NP", "-MV")):
            return False
        return True  # base SKUs and -MD are allowed

    #  Filter SKUs
    uk_sales = {sku: qty for sku, qty in uk_sales.items() if is_valid_sku(sku)}
    combined_fr_sales = {sku: qty for sku, qty in combined_fr_sales.items() if is_valid_sku(sku)}

    # Aggregate sales by base so base and -MD roll up together
    bases: Dict[str, Dict[str, int]] = defaultdict(lambda: {"uk": 0, "fr": 0})

    for sku, qty in uk_sales.items():
        bases[_base_of(sku)]["uk"] += int(qty or 0)

    for sku, qty in combined_fr_sales.items():
        bases[_base_of(sku)]["fr"] += int(qty or 0)

    conn = get_inventory_log_connection()
    try:
        cursor = conn.cursor()

        for base, qtys in bases.items():
            uk_qty = int(qtys.get("uk", 0))
            fr_qty = int(qtys.get("fr", 0))

            # Skip if both zero
            if uk_qty == 0 and fr_qty == 0:
                stats["skipped_no_sales"] += 1
                continue

            # Resolve Zoho item by base -> fallback to base-MD
            sku_used, item_id = _resolve_zoho_item(sku_to_item_id, base)
            if not item_id:
                stats["unmatched_skus"].append(base)  # track base that didn't resolve
                continue

            if dry_run:
                logger.info(f"[DRY RUN] Would update {item_id} ({sku_used} / base={base}): UK={uk_qty}, FR={fr_qty}")
                stats["updated_records"] += 1
                continue

            cursor.execute(
                """
                INSERT INTO inventory_metadata (item_id, uk_6m_data, fr_6m_data, updated_at)
                VALUES (%s, %s, %s, NOW()) ON CONFLICT (item_id) DO
                UPDATE SET
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


