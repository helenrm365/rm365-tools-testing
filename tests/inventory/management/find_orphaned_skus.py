import os
import sys
import logging
from typing import Set
from pathlib import Path

# Add backend directory to path
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Load environment variables
try:
    from dotenv import load_dotenv
    env_path = Path(__file__).resolve().parent.parent / '.env'
    load_dotenv(dotenv_path=env_path)
except ImportError:
    pass

from modules.magentodata.db import get_magento_connection
from core.db import get_inventory_log_connection, return_inventory_connection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def find_orphaned_skus():
    print("--- Finding Orphaned SKUs in Inventory Metadata ---")
    
    # 1. Get all SKUs from inventory_metadata
    inventory_skus = set()
    conn = get_inventory_log_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT sku FROM inventory_metadata")
            inventory_skus = {row[0] for row in cursor.fetchall()}
    finally:
        return_inventory_connection(conn)
    
    print(f"Total Inventory SKUs: {len(inventory_skus)}")

    # 2. Get all SKUs from Magento catalog_product_entity
    magento_skus = set()
    conn = get_magento_connection("uk")
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT sku FROM catalog_product_entity")
            # Handle both dict and tuple cursors
            rows = cursor.fetchall()
            if rows and isinstance(rows[0], dict):
                magento_skus = {row['sku'] for row in rows}
            else:
                magento_skus = {row[0] for row in rows}
    finally:
        if conn:
            conn.close()
            
    print(f"Total Magento SKUs: {len(magento_skus)}")

    # 3. Find orphans
    orphans = inventory_skus - magento_skus
    print(f"Found {len(orphans)} orphaned SKUs (in Inventory but not in Magento)")
    
    if orphans:
        print("\nSample Orphans:")
        for sku in list(orphans)[:20]:
            print(f" - {sku}")
            
        print("\nTo delete these, you can run a DELETE query on inventory_metadata.")

if __name__ == "__main__":
    find_orphaned_skus()
