#!/usr/bin/env python3
"""
Manual Test Script Helper
Provides database queries to verify test results
"""

import psycopg2
from psycopg2.extras import RealDictCursor
import json
import os
from datetime import datetime
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables
env_path = Path(__file__).parent.parent / ".env"
load_dotenv(env_path)

# Database configuration from environment
DB_CONFIG = {
    "dbname": os.getenv("INVENTORY_LOGS_NAME", "inventory_database"),
    "user": os.getenv("INVENTORY_LOGS_USER", "postgres"),
    "password": os.getenv("INVENTORY_LOGS_PASSWORD", ""),
    "host": os.getenv("INVENTORY_LOGS_HOST", "localhost"),
    "port": int(os.getenv("INVENTORY_LOGS_PORT", "5432")),
    "sslmode": os.getenv("DB_SSLMODE", "prefer"),
    "connect_timeout": int(os.getenv("DB_CONNECT_TIMEOUT", "10"))
}

def get_connection():
    """Get database connection"""
    return psycopg2.connect(**DB_CONFIG, cursor_factory=RealDictCursor)

def print_section(title):
    """Print section header"""
    print("\n" + "=" * 80)
    print(f"  {title}")
    print("=" * 80)

def check_product_in_inventory(branch: str, sku: str):
    """Check if a product exists in a branch's inventory"""
    print_section(f"Checking {sku} in {branch.upper()} inventory")
    
    conn = get_connection()
    try:
        cur = conn.cursor()
        
        # Map branch to table prefix
        table_map = {
            "birmingham": "uk_birmingham",
            "london": "uk_london",
            "france": "fr_paris"
        }
        table_prefix = table_map.get(branch.lower(), branch)
        
        query = f"""
        SELECT 
            sku,
            product_name,
            shelf_lt1_qty,
            shelf_gt1_qty,
            top_floor_total,
            (COALESCE(shelf_lt1_qty, 0) + COALESCE(shelf_gt1_qty, 0) + COALESCE(top_floor_total, 0)) as total_qty,
            updated_at
        FROM {table_prefix}_inventory
        WHERE sku = %s
        """
        
        cur.execute(query, (sku,))
        result = cur.fetchone()
        
        if result:
            print(f"✅ Product found:")
            for key, value in result.items():
                print(f"   {key}: {value}")
        else:
            print(f"❌ Product NOT found in {branch} inventory")
        
        cur.close()
        return result
    except Exception as e:
        print(f"❌ Error: {e}")
        return None
    finally:
        conn.close()

def count_scanning_logs(branch: str):
    """Count scanning logs for a branch"""
    print_section(f"Counting scanning logs for {branch.upper()}")
    
    conn = get_connection()
    try:
        cur = conn.cursor()
        
        table_map = {
            "birmingham": "uk_birmingham",
            "london": "uk_london",
            "france": "fr_paris"
        }
        table_prefix = table_map.get(branch.lower(), branch)
        
        query = f"""
        SELECT COUNT(*) as count
        FROM {table_prefix}_scanner_submissions
        """
        
        cur.execute(query)
        result = cur.fetchone()
        count = result['count'] if result else 0
        
        print(f"   Total submissions: {count}")
        
        # Get recent submissions
        query = f"""
        SELECT 
            id,
            reason,
            submitted_at
        FROM {table_prefix}_scanner_submissions
        ORDER BY submitted_at DESC
        LIMIT 5
        """
        
        cur.execute(query)
        recent = cur.fetchall()
        
        if recent:
            print(f"\n   Recent submissions:")
            for sub in recent:
                print(f"   - ID {sub['id']}: {sub['reason']} at {sub['submitted_at']}")
        
        cur.close()
        return count
    except Exception as e:
        print(f"❌ Error: {e}")
        return -1
    finally:
        conn.close()

def get_submission_details(branch: str, submission_id: int):
    """Get details of a specific submission"""
    print_section(f"Submission {submission_id} details for {branch.upper()}")
    
    conn = get_connection()
    try:
        cur = conn.cursor()
        
        table_map = {
            "birmingham": "uk_birmingham",
            "london": "uk_london",
            "france": "fr_paris"
        }
        table_prefix = table_map.get(branch.lower(), branch)
        
        # Get submission
        query = f"""
        SELECT *
        FROM {table_prefix}_scanner_submissions
        WHERE id = %s
        """
        
        cur.execute(query, (submission_id,))
        submission = cur.fetchone()
        
        if not submission:
            print(f"❌ Submission {submission_id} not found")
            return
        
        print(f"Submission:")
        for key, value in submission.items():
            print(f"   {key}: {value}")
        
        # Get items
        query = f"""
        SELECT *
        FROM {table_prefix}_scanner_submission_items
        WHERE submission_id = %s
        """
        
        cur.execute(query, (submission_id,))
        items = cur.fetchall()
        
        print(f"\n   Items ({len(items)}):")
        for item in items:
            print(f"   - {item['sku']}: {item['quantity']} (Shelf: {item['shelf_field']})")
        
        cur.close()
    except Exception as e:
        print(f"❌ Error: {e}")
    finally:
        conn.close()

def _get_product_name_from_inventory_metadata(sku: str) -> str | None:
    conn = get_connection()
    try:
        cur = conn.cursor()
        cur.execute("SELECT product_name FROM inventory_metadata WHERE sku = %s", (sku,))
        row = cur.fetchone()
        return row.get('product_name') if row else None
    except Exception:
        return None
    finally:
        conn.close()


def insert_test_product(branch: str, sku: str, product_name: str | None, initial_qty: int = 100):
    """Insert a test product into a branch's inventory"""
    print_section(f"Inserting test product {sku} into {branch.upper()}")
    
    conn = get_connection()
    try:
        cur = conn.cursor()
        
        table_map = {
            "birmingham": "uk_birmingham",
            "london": "uk_london",
            "france": "fr_paris"
        }
        table_prefix = table_map.get(branch.lower(), branch)
        
        if not product_name:
            product_name = _get_product_name_from_inventory_metadata(sku) or sku

        shelf_lt1 = initial_qty // 2
        shelf_gt1 = initial_qty // 3
        top_floor = initial_qty - shelf_lt1 - shelf_gt1
        
        query = f"""
        INSERT INTO {table_prefix}_inventory (
            sku, product_name, item_id,
            shelf_lt1_qty, shelf_gt1_qty, top_floor_total,
            created_at, updated_at
        ) VALUES (
            %s, %s, %s,
            %s, %s, %s,
            NOW(), NOW()
        )
        ON CONFLICT (sku) DO UPDATE SET
            product_name = EXCLUDED.product_name,
            shelf_lt1_qty = EXCLUDED.shelf_lt1_qty,
            shelf_gt1_qty = EXCLUDED.shelf_gt1_qty,
            top_floor_total = EXCLUDED.top_floor_total,
            updated_at = NOW()
        """
        
        item_id = sku.replace("TEST-SCAN-", "TEST")
        
        cur.execute(query, (
            sku, product_name, item_id,
            shelf_lt1, shelf_gt1, top_floor
        ))
        
        conn.commit()
        print(f"✅ Product inserted/updated successfully")
        print(f"   Shelf <1: {shelf_lt1}")
        print(f"   Shelf >1: {shelf_gt1}")
        print(f"   Top Floor: {top_floor}")
        print(f"   Total: {shelf_lt1 + shelf_gt1 + top_floor}")
        
        cur.close()
    except Exception as e:
        print(f"❌ Error: {e}")
        conn.rollback()
    finally:
        conn.close()

def main():
    """Main menu"""
    while True:
        print("\n" + "=" * 80)
        print("  SCANNER TESTING HELPER")
        print("=" * 80)
        print("\n1. Insert test product into all branches")
        print("2. Check product in specific branch")
        print("3. Count scanning logs for branch")
        print("4. Get submission details")
        print("5. Check product in ALL branches")
        print("6. Count logs for ALL branches")
        print("0. Exit")
        
        choice = input("\nEnter choice: ").strip()
        
        if choice == "1":
            sku = input("Enter SKU (default: TEST-SCAN-001): ").strip() or "TEST-SCAN-001"
            name = input("Enter product name (default: Test Scanner Product): ").strip() or "Test Scanner Product"
            qty = input("Enter initial quantity (default: 100): ").strip() or "100"
            qty = int(qty)
            
            for branch in ["birmingham", "london", "france"]:
                insert_test_product(branch, sku, name, qty)
        
        elif choice == "2":
            branch = input("Enter branch (birmingham/london/france): ").strip()
            sku = input("Enter SKU: ").strip()
            check_product_in_inventory(branch, sku)
        
        elif choice == "3":
            branch = input("Enter branch (birmingham/london/france): ").strip()
            count_scanning_logs(branch)
        
        elif choice == "4":
            branch = input("Enter branch (birmingham/london/france): ").strip()
            sub_id = input("Enter submission ID: ").strip()
            get_submission_details(branch, int(sub_id))
        
        elif choice == "5":
            sku = input("Enter SKU: ").strip()
            for branch in ["birmingham", "london", "france"]:
                check_product_in_inventory(branch, sku)
        
        elif choice == "6":
            for branch in ["birmingham", "london", "france"]:
                count_scanning_logs(branch)
        
        elif choice == "0":
            print("\nGoodbye!")
            break
        
        else:
            print("Invalid choice")

if __name__ == "__main__":
    main()
