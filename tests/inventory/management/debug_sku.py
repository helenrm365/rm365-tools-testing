import os
import sys
import logging
from typing import List
from pathlib import Path

# Add backend directory to path so we can import modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

# Load environment variables from .env file
try:
    from dotenv import load_dotenv
    # Load .env from project root (one directory up from backend/)
    env_path = Path(__file__).resolve().parent.parent / '.env'
    load_dotenv(dotenv_path=env_path)
    print(f"🔧 Environment variables loaded from {env_path}")
except ImportError:
    print("⚠️  python-dotenv not installed, using system environment variables")

from modules.magentodata.db import get_magento_connection
from core.db import get_inventory_log_connection, return_inventory_connection, get_products_connection, return_products_connection

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def check_sku_in_aggregated_orders(sku: str):
    print(f"\n--- Checking SKU: {sku} in aggregated_orders ---")
    conn = get_products_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT total_qty FROM uk_aggregated_orders WHERE sku = %s", (sku,))
            row = cursor.fetchone()
            if row:
                print(f"✅ Found in uk_aggregated_orders: Qty {row[0]}")
            else:
                print(f"❌ NOT FOUND in uk_aggregated_orders")

            cursor.execute("SELECT total_qty FROM fr_aggregated_orders WHERE sku = %s", (sku,))
            row = cursor.fetchone()
            if row:
                print(f"✅ Found in fr_aggregated_orders: Qty {row[0]}")
            else:
                print(f"❌ NOT FOUND in fr_aggregated_orders")
                
            cursor.execute("SELECT total_qty FROM nl_aggregated_orders WHERE sku = %s", (sku,))
            row = cursor.fetchone()
            if row:
                print(f"✅ Found in nl_aggregated_orders: Qty {row[0]}")
            else:
                print(f"❌ NOT FOUND in nl_aggregated_orders")

    except Exception as e:
        print(f"Error checking aggregated_orders: {e}")
    finally:
        return_products_connection(conn)

def check_sku_in_magento(sku: str):
    print(f"\n--- Checking SKU: {sku} in Magento ---")
    conn = get_magento_connection("uk")
    try:
        with conn.cursor() as cursor:
            # Check basic existence
            cursor.execute("SELECT entity_id, sku FROM catalog_product_entity WHERE sku = %s", (sku,))
            product = cursor.fetchone()
            
            if not product:
                print(f"❌ SKU {sku} NOT FOUND in catalog_product_entity")
                return
            
            entity_id = product['entity_id']
            print(f"✅ Found in catalog_product_entity. Entity ID: {entity_id}")
            
            # Check Name
            cursor.execute("""
                SELECT value FROM catalog_product_entity_varchar 
                WHERE entity_id = %s 
                AND attribute_id = (SELECT attribute_id FROM eav_attribute WHERE attribute_code = 'name' AND entity_type_id = 4)
                AND store_id = 0
            """, (entity_id,))
            name_row = cursor.fetchone()
            name = name_row['value'] if name_row else "Unknown"
            print(f"Name: {name}")

            # Check Status (discontinued_status)
            cursor.execute("""
                SELECT value FROM catalog_product_entity_varchar 
                WHERE entity_id = %s 
                AND attribute_id = (SELECT attribute_id FROM eav_attribute WHERE attribute_code = 'discontinued_status' AND entity_type_id = 4)
                AND store_id = 0
            """, (entity_id,))
            status_row = cursor.fetchone()
            status = status_row['value'] if status_row else "None"
            print(f"Discontinued Status: {status}")

            # Check Categories
            cursor.execute("""
                SELECT ccev.value as category_name
                FROM catalog_category_product ccp
                JOIN catalog_category_entity cce ON ccp.category_id = cce.entity_id
                JOIN catalog_category_entity_varchar ccev ON cce.entity_id = ccev.entity_id
                WHERE ccp.product_id = %s
                AND ccev.attribute_id = (SELECT attribute_id FROM eav_attribute WHERE attribute_code = 'name' AND entity_type_id = 3)
                AND ccev.store_id = 0
            """, (entity_id,))
            categories = [row['category_name'] for row in cursor.fetchall()]
            print(f"Categories: {categories}")
            
            # Check Websites
            cursor.execute("SELECT website_id FROM catalog_product_website WHERE product_id = %s", (entity_id,))
            websites = [row['website_id'] for row in cursor.fetchall()]
            print(f"Websites: {websites}")

            # Check Filter Logic
            is_aw365 = False
            for cat in categories:
                if "AW365" in cat.upper():
                    is_aw365 = True
                    break
            
            if not categories:
                print("⚠️  Would be FILTERED OUT (No categories)")
            elif is_aw365:
                print("⚠️  Would be FILTERED OUT (AW365 category)")
            else:
                print("✅ Would be INCLUDED in sync")

    except Exception as e:
        print(f"Error checking Magento: {e}")
    finally:
        if conn:
            conn.close()

def check_sku_in_inventory_metadata(sku: str):
    print(f"\n--- Checking SKU: {sku} in inventory_metadata ---")
    conn = get_inventory_log_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT * FROM inventory_metadata WHERE sku = %s", (sku,))
            row = cursor.fetchone()
            if row:
                print(f"✅ Found in inventory_metadata: {row}")
            else:
                print(f"❌ NOT FOUND in inventory_metadata")
    except Exception as e:
        print(f"Error checking inventory_metadata: {e}")
    finally:
        return_inventory_connection(conn)

if __name__ == "__main__":
    skus_to_check = ["POHC-YSL-UHZU-SAI-NIK", "POHC-LV-YSMG-LOU-SPE"]
    for sku in skus_to_check:
        check_sku_in_magento(sku)
        check_sku_in_aggregated_orders(sku)
        check_sku_in_inventory_metadata(sku)
