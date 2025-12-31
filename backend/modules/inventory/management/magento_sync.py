from __future__ import annotations

import logging
from typing import Dict, Tuple, Optional
from collections import defaultdict

import requests

from core.db import (
    get_products_connection, 
    get_inventory_log_connection,
    return_products_connection,
    return_inventory_connection
)

logger = logging.getLogger(__name__)

def get_regional_data() -> Tuple[Dict[str, int], Dict[str, int], Dict[str, int]]:
    conn = get_products_connection()

    try:
        cursor = conn.cursor()

        cursor.execute(
            "SELECT sku, total_qty FROM uk_aggregated_orders WHERE sku IS NOT NULL AND sku != ''"
        )
        uk_data = {row[0]: int(row[1] or 0) for row in cursor.fetchall()}

        cursor.execute(
            "SELECT sku, total_qty FROM fr_aggregated_orders WHERE sku IS NOT NULL AND sku != ''"
        )
        fr_data = {row[0]: int(row[1] or 0) for row in cursor.fetchall()}

        cursor.execute(
            "SELECT sku, total_qty FROM nl_aggregated_orders WHERE sku IS NOT NULL AND sku != ''"
        )
        nl_data = {row[0]: int(row[1] or 0) for row in cursor.fetchall()}

        logger.info(f"Loaded: UK={len(uk_data)}, FR={len(fr_data)}, NL={len(nl_data)} SKUs")
        return uk_data, fr_data, nl_data

    finally:
        return_products_connection(conn)


def merge_fr_nl_data(fr_data: Dict[str, int], nl_data: Dict[str, int]) -> Dict[str, int]:
    combined = defaultdict(int)

    for sku, qty in fr_data.items():
        combined[sku] += qty

    for sku, qty in nl_data.items():
        combined[sku] += qty

    return dict(combined)


def sync_magento_to_inventory_metadata(dry_run: bool = False) -> Dict[str, any]:
    """
    Sync magento data from aggregated_orders tables to inventory_metadata.
    Now uses SKU as the primary key instead of item_id.
    """
    stats = {
        "total_skus": 0,
        "matched_skus": 0,
        "updated_records": 0,
        "skipped_no_data": 0,
        "unmatched_skus": [],
    }

    # Fetch raw magento data
    uk_data, fr_data, nl_data = get_regional_data()
    combined_fr_data = merge_fr_nl_data(fr_data, nl_data)

    # Note: MD variants are already merged in the aggregated tables (handled by Magento 6M Data module)
    # We do NOT merge any variants here - just use the SKUs as-is
    # SD, DP, NP, MV variants stay separate as per documentation
    
    # Build combined data dictionary {sku: {uk: qty, fr: qty}}
    bases: Dict[str, Dict[str, int]] = defaultdict(lambda: {"uk": 0, "fr": 0})

    for sku, qty in uk_data.items():
        bases[sku]["uk"] += int(qty or 0)

    for sku, qty in combined_fr_data.items():
        bases[sku]["fr"] += int(qty or 0)

    stats["total_skus"] = len(bases)

    conn = get_inventory_log_connection()
    try:
        cursor = conn.cursor()

        for base_sku, qtys in bases.items():
            uk_qty = int(qtys.get("uk", 0))
            fr_qty = int(qtys.get("fr", 0))

            # Skip if both zero
            if uk_qty == 0 and fr_qty == 0:
                stats["skipped_no_data"] += 1
                continue

            # Use the SKU directly from aggregated tables (MD variants already merged there)
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
        return_inventory_connection(conn)

    logger.info(f"✅ Sync complete: {stats['updated_records']} records updated")
    return stats


