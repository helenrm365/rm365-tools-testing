#!/usr/bin/env python3
"""
Sync all branch inventory tables with inventory_metadata.
This copies all products from inventory_metadata to each branch inventory table.
"""
import sys
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from core.db import get_inventory_log_connection, return_inventory_connection

def sync_inventory():
    conn = get_inventory_log_connection()
    cursor = conn.cursor()
    
    # Get column info for inventory_metadata
    cursor.execute("""
        SELECT column_name FROM information_schema.columns 
        WHERE table_name = 'inventory_metadata' 
        ORDER BY ordinal_position
    """)
    metadata_columns = [row[0] for row in cursor.fetchall()]
    print(f"inventory_metadata columns: {metadata_columns}")
    
    # Get count from inventory_metadata
    cursor.execute("SELECT COUNT(*) FROM inventory_metadata")
    metadata_count = cursor.fetchone()[0]
    print(f"\nTotal items in inventory_metadata: {metadata_count}")
    
    # Branch tables to sync
    branch_tables = [
        'uk_birmingham_inventory',
        'uk_london_inventory', 
        'fr_paris_inventory'
    ]
    
    for table in branch_tables:
        print(f"\n--- Syncing {table} ---")
        
        # Get current count
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        before_count = cursor.fetchone()[0]
        print(f"Before sync: {before_count} items")
        
        # Get columns for this table
        cursor.execute(f"""
            SELECT column_name FROM information_schema.columns 
            WHERE table_name = %s 
            ORDER BY ordinal_position
        """, (table,))
        table_columns = [row[0] for row in cursor.fetchall()]
        print(f"Table columns: {table_columns}")
        
        # Find common columns between metadata and branch table
        common_columns = [col for col in metadata_columns if col in table_columns]
        print(f"Common columns: {common_columns}")
        
        if 'sku' not in common_columns or 'item_id' not in common_columns:
            print(f"ERROR: Missing sku or item_id column, skipping {table}")
            continue
        
        # Build column list for insert
        columns_str = ', '.join(common_columns)
        
        # Insert items from inventory_metadata that don't exist in branch table
        # Using ON CONFLICT to handle duplicates (assuming item_id is unique)
        try:
            # First, let's check if there's a unique constraint on item_id
            cursor.execute(f"""
                INSERT INTO {table} ({columns_str})
                SELECT {columns_str} FROM inventory_metadata
                ON CONFLICT (item_id) DO UPDATE SET
                    sku = EXCLUDED.sku,
                    updated_at = NOW()
            """)
            inserted = cursor.rowcount
            conn.commit()
            print(f"Upserted {inserted} items")
        except Exception as e:
            print(f"Error with upsert: {e}")
            conn.rollback()
            
            # Try simpler approach - just insert missing items
            try:
                cursor.execute(f"""
                    INSERT INTO {table} ({columns_str})
                    SELECT {columns_str} FROM inventory_metadata m
                    WHERE NOT EXISTS (
                        SELECT 1 FROM {table} t WHERE t.item_id = m.item_id
                    )
                """)
                inserted = cursor.rowcount
                conn.commit()
                print(f"Inserted {inserted} new items")
            except Exception as e2:
                print(f"Error with insert: {e2}")
                conn.rollback()
        
        # Get final count
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        after_count = cursor.fetchone()[0]
        print(f"After sync: {after_count} items")
    
    # Verify RE003 is now in all tables
    print("\n--- Verifying RE003 in all tables ---")
    for table in branch_tables:
        cursor.execute(f"SELECT sku, item_id FROM {table} WHERE sku = %s", ('RE003',))
        result = cursor.fetchone()
        if result:
            print(f"✅ {table}: RE003 found with item_id {result[1]}")
        else:
            print(f"❌ {table}: RE003 NOT FOUND")
    
    cursor.close()
    return_inventory_connection(conn)
    print("\n✅ Sync complete!")

if __name__ == '__main__':
    sync_inventory()
