#!/usr/bin/env python3
"""
Apply missing database indexes to improve Magento data page load times.

This script adds the critical missing indexes identified by analyze_magento_indexes.py
"""

import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

import psycopg2

def get_connection():
    return psycopg2.connect(
        host=os.environ.get('PRODUCTS_DB_HOST', '100.65.109.31'),
        port=int(os.environ.get('PRODUCTS_DB_PORT', 5432)),
        database=os.environ.get('PRODUCTS_DB_NAME', 'productSalesDb'),
        user=os.environ.get('PRODUCTS_DB_USER', 'ianhjweng'),
        password=os.environ.get('PRODUCTS_DB_PASSWORD', ''),
        sslmode='require'
    )

def index_exists(cursor, index_name: str) -> bool:
    """Check if an index already exists."""
    cursor.execute("""
        SELECT EXISTS (
            SELECT 1 FROM pg_indexes WHERE indexname = %s
        )
    """, (index_name,))
    return cursor.fetchone()[0]

def create_index(cursor, index_name: str, table_name: str, column_def: str) -> bool:
    """Create an index if it doesn't exist."""
    if index_exists(cursor, index_name):
        print(f"   ✓ Index {index_name} already exists")
        return False
    
    sql = f"CREATE INDEX {index_name} ON {table_name}({column_def})"
    print(f"   Creating {index_name}...")
    start = time.time()
    cursor.execute(sql)
    elapsed = time.time() - start
    print(f"   ✅ Created {index_name} in {elapsed:.2f}s")
    return True

def apply_indexes():
    """Apply missing indexes to improve query performance."""
    print("=" * 70)
    print("APPLYING DATABASE INDEXES")
    print("=" * 70)
    
    conn = get_connection()
    conn.autocommit = True  # Required for CREATE INDEX without CONCURRENTLY in a transaction
    cursor = conn.cursor()
    
    tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache']
    
    indexes_created = 0
    indexes_skipped = 0
    
    for table in tables:
        print(f"\n📋 Table: {table}")
        
        # Check if table exists
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = %s
            )
        """, (table,))
        
        if not cursor.fetchone()[0]:
            print(f"   ❌ Table does not exist, skipping")
            continue
        
        # Critical: imported_at DESC index for ORDER BY performance
        idx_name = f"idx_{table}_imported_at"
        if create_index(cursor, idx_name, table, "imported_at DESC"):
            indexes_created += 1
        else:
            indexes_skipped += 1
        
        # Status index for filtering
        idx_name = f"idx_{table}_status"
        if create_index(cursor, idx_name, table, "status"):
            indexes_created += 1
        else:
            indexes_skipped += 1
        
        # Customer group index for aggregation queries
        idx_name = f"idx_{table}_customer_group"
        if create_index(cursor, idx_name, table, "customer_group_code"):
            indexes_created += 1
        else:
            indexes_skipped += 1
    
    cursor.close()
    conn.close()
    
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"   Indexes created: {indexes_created}")
    print(f"   Indexes skipped (already exist): {indexes_skipped}")
    
    if indexes_created > 0:
        print("\n✅ Index creation complete!")
        print("   Run the page load test again to see the improvement.")
    else:
        print("\n✓ All indexes already exist.")

if __name__ == '__main__':
    apply_indexes()
