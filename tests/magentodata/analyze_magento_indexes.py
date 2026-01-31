#!/usr/bin/env python3
"""
Analyze existing database indexes and suggest improvements for Magento data tables.
"""

import sys
import os

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

def analyze_indexes():
    """Check existing indexes on Magento cache tables."""
    print("=" * 70)
    print("DATABASE INDEX ANALYSIS")
    print("=" * 70)
    
    conn = get_connection()
    cursor = conn.cursor()
    
    tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache']
    
    for table in tables:
        print(f"\n📋 Table: {table}")
        print("-" * 50)
        
        # Check if table exists
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = %s
            )
        """, (table,))
        
        if not cursor.fetchone()[0]:
            print(f"   ❌ Table does not exist")
            continue
        
        # Get row count
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        row_count = cursor.fetchone()[0]
        print(f"   Rows: {row_count:,}")
        
        # Get table size
        cursor.execute(f"""
            SELECT pg_size_pretty(pg_total_relation_size('{table}'))
        """)
        table_size = cursor.fetchone()[0]
        print(f"   Size: {table_size}")
        
        # Get existing indexes
        cursor.execute("""
            SELECT indexname, indexdef 
            FROM pg_indexes 
            WHERE tablename = %s
            ORDER BY indexname
        """, (table,))
        
        indexes = cursor.fetchall()
        print(f"\n   Existing indexes ({len(indexes)}):")
        for idx_name, idx_def in indexes:
            print(f"   ✓ {idx_name}")
            # Show abbreviated definition
            idx_short = idx_def.replace('CREATE INDEX ', '').replace('CREATE UNIQUE INDEX ', 'UNIQUE: ')
            print(f"     {idx_short[:80]}...")
    
    # Check for missing recommended indexes
    print("\n" + "=" * 70)
    print("MISSING INDEX ANALYSIS")
    print("=" * 70)
    
    recommended_indexes = {
        'imported_at DESC': 'Critical for ORDER BY imported_at DESC (default sort)',
        'status': 'Useful for filtering by order status',
        'customer_group_code': 'Useful for aggregation queries that filter by customer group',
        '(created_at DESC)': 'May help with date range queries',
    }
    
    for table in tables:
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = %s
            )
        """, (table,))
        
        if not cursor.fetchone()[0]:
            continue
            
        print(f"\n📋 {table}:")
        
        # Get existing index columns
        cursor.execute("""
            SELECT indexdef FROM pg_indexes WHERE tablename = %s
        """, (table,))
        existing_defs = ' '.join([row[0] for row in cursor.fetchall()])
        
        # Check for imported_at index (the most critical one)
        if 'imported_at' not in existing_defs:
            print(f"   ❌ MISSING: idx_{table}_imported_at (imported_at DESC)")
            print(f"      → This is causing slow ORDER BY performance!")
        else:
            print(f"   ✓ Has imported_at index")
        
        if 'status' not in existing_defs:
            print(f"   ⚠️  MISSING: idx_{table}_status (status)")
        
        if 'customer_group_code' not in existing_defs:
            print(f"   ⚠️  MISSING: idx_{table}_customer_group (customer_group_code)")
    
    # Generate SQL to add missing indexes
    print("\n" + "=" * 70)
    print("RECOMMENDED INDEX CREATION SQL")
    print("=" * 70)
    
    print("\n-- Critical indexes for page load performance:")
    for table in tables:
        cursor.execute("""
            SELECT indexdef FROM pg_indexes WHERE tablename = %s
        """, (table,))
        existing_defs = ' '.join([row[0] for row in cursor.fetchall()])
        
        if 'imported_at' not in existing_defs:
            print(f"CREATE INDEX CONCURRENTLY idx_{table}_imported_at ON {table}(imported_at DESC);")
        
        if 'status' not in existing_defs:
            print(f"CREATE INDEX CONCURRENTLY idx_{table}_status ON {table}(status);")
        
        if 'customer_group_code' not in existing_defs:
            print(f"CREATE INDEX CONCURRENTLY idx_{table}_customer_group ON {table}(customer_group_code);")
    
    # Run EXPLAIN ANALYZE on a typical query
    print("\n" + "=" * 70)
    print("QUERY PERFORMANCE ANALYSIS")
    print("=" * 70)
    
    for table in tables:
        cursor.execute("""
            SELECT EXISTS (
                SELECT FROM information_schema.tables 
                WHERE table_schema = 'public' AND table_name = %s
            )
        """, (table,))
        
        if not cursor.fetchone()[0]:
            continue
        
        print(f"\n📋 {table} - Typical page load query:")
        
        # First, the count query
        cursor.execute(f"EXPLAIN ANALYZE SELECT COUNT(*) FROM {table}")
        plan = cursor.fetchall()
        print("\n   COUNT(*) query plan:")
        for row in plan:
            print(f"   {row[0]}")
        
        # Then the data query
        cursor.execute(f"""
            EXPLAIN ANALYZE 
            SELECT * FROM {table}
            ORDER BY imported_at DESC
            LIMIT 100 OFFSET 0
        """)
        plan = cursor.fetchall()
        print("\n   SELECT with ORDER BY imported_at DESC LIMIT 100:")
        for row in plan:
            print(f"   {row[0]}")
    
    cursor.close()
    conn.close()
    
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print("""
The most impactful improvement is adding an index on 'imported_at DESC' 
since that's the default sort order for page loads.

Run the SQL commands above to add missing indexes. Use CONCURRENTLY 
to avoid locking the tables during index creation.
    """)

if __name__ == '__main__':
    analyze_indexes()
