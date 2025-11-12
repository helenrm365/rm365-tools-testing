from __future__ import annotations

import logging
from typing import Dict, Tuple, Optional
from collections import defaultdict

import requests

from core.config import settings
from core.db import get_products_connection, get_inventory_log_connection

# ✅ Import Zoho helpers from client.py
from modules._integrations.zoho.client import (
    get_zoho_items_with_skus,
    _resolve_zoho_item,
    _base_of,
   # zoho_auth_header,  # keep this if used elsewhere for requests
)

logger = logging.getLogger(__name__)

ZOHO_INVENTORY_BASE = "https://www.zohoapis.eu/inventory/v1"
ZOHO_ORG_ID = settings.ZC_ORG_ID

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
    """
    Sync sales data from condensed_sales tables to inventory_metadata.
    Now uses SKU as the primary key instead of item_id.
    """
    stats = {
        "total_skus": 0,
        "matched_skus": 0,
        "updated_records": 0,
        "skipped_no_sales": 0,
        "unmatched_skus": [],
    }

    # Fetch raw sales data
    uk_sales, fr_sales, nl_sales = get_regional_sales()
    combined_fr_sales = merge_fr_nl_sales(fr_sales, nl_sales)

    # Helper to get base SKU (remove all identifier suffixes)
    def get_base_sku(sku: str) -> str:
        """Remove identifier suffixes: -SD, -DP, -NP, -MV, -MD"""
        for suffix in ["-SD", "-DP", "-NP", "-MV", "-MD"]:
            if sku.endswith(suffix):
                return sku[:-len(suffix)]
        return sku

    # Aggregate sales by base SKU (all identifiers merged with base)
    bases: Dict[str, Dict[str, int]] = defaultdict(lambda: {"uk": 0, "fr": 0})

    for sku, qty in uk_sales.items():
        base = get_base_sku(sku)
        bases[base]["uk"] += int(qty or 0)

    for sku, qty in combined_fr_sales.items():
        base = get_base_sku(sku)
        bases[base]["fr"] += int(qty or 0)

    stats["total_skus"] = len(bases)

    conn = get_inventory_log_connection()
    try:
        cursor = conn.cursor()

        for base_sku, qtys in bases.items():
            uk_qty = int(qtys.get("uk", 0))
            fr_qty = int(qtys.get("fr", 0))

            # Skip if both zero
            if uk_qty == 0 and fr_qty == 0:
                stats["skipped_no_sales"] += 1
                continue

            # Use the base SKU directly (no need to resolve via Zoho)
            sku_to_use = base_sku
            
            if dry_run:
                logger.info(f"[DRY RUN] Would update SKU {sku_to_use}: UK={uk_qty}, FR={fr_qty}")
                stats["updated_records"] += 1
                continue

            # Now using SKU as primary key
            cursor.execute(
                """
                INSERT INTO inventory_metadata (sku, uk_6m_data, fr_6m_data, updated_at)
                VALUES (%s, %s, %s, NOW()) 
                ON CONFLICT (sku) DO UPDATE SET
                    uk_6m_data = EXCLUDED.uk_6m_data,
                    fr_6m_data = EXCLUDED.fr_6m_data,
                    updated_at = NOW()
                """,
                (sku_to_use, str(uk_qty), str(fr_qty)),
            )
            stats["updated_records"] += 1
            stats["matched_skus"] += 1

        if not dry_run:
            conn.commit()
    finally:
        conn.close()

    logger.info(f"✅ Sync complete: {stats['updated_records']} records updated")
    return stats


