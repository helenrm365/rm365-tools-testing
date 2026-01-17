#!/usr/bin/env python3
"""Test the performance of refresh_aggregated_data components"""

import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

import psycopg2

def main():
    print("=" * 60)
    print("TESTING REFRESH_AGGREGATED_DATA PERFORMANCE")
    print("=" * 60)
    
    # Connect to products DB
    conn = psycopg2.connect(
        host=os.environ.get('PRODUCTS_DB_HOST', '100.65.109.31'),
        port=int(os.environ.get('PRODUCTS_DB_PORT', 5432)),
        database=os.environ.get('PRODUCTS_DB_NAME', 'productSalesDb'),
        user=os.environ.get('PRODUCTS_DB_USER', 'ianhjweng'),
        password=os.environ.get('PRODUCTS_DB_PASSWORD', ''),
        sslmode='require'
    )
    cursor = conn.cursor()
    
    # Test 1: Simple count
    print("\n1. Simple COUNT query:")
    start = time.time()
    cursor.execute("SELECT COUNT(*) FROM uk_orders_cache")
    count = cursor.fetchone()[0]
    print(f"   UK cache has {count:,} rows - took {time.time() - start:.2f}s")
    
    # Test 2: The complex date filter query
    print("\n2. Complex date filter query (6 months):")
    start = time.time()
    cursor.execute("""
        SELECT COUNT(*) FROM uk_orders_cache s
        WHERE (
            (s.created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' AND 
             TO_TIMESTAMP(s.created_at, 'YYYY-MM-DD HH24:MI:SS') >= CURRENT_DATE - INTERVAL '6 months')
            OR NOT (s.created_at ~ '^[0-9]')
        )
    """)
    count = cursor.fetchone()[0]
    print(f"   Matching rows: {count:,} - took {time.time() - start:.2f}s")
    
    # Test 3: Full SELECT with JOIN
    print("\n3. Full SELECT with LEFT JOIN to sku_aliases:")
    start = time.time()
    cursor.execute("""
        SELECT 
            COALESCE(sa.unified_sku, s.sku) as sku,
            s.name, s.qty, s.grand_total, s.currency,
            s.customer_email, s.customer_group_code, s.created_at, s.status
        FROM uk_orders_cache s
        LEFT JOIN sku_aliases sa ON s.sku = sa.alias_sku
        WHERE s.created_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}'
          AND TO_TIMESTAMP(s.created_at, 'YYYY-MM-DD HH24:MI:SS') >= CURRENT_DATE - INTERVAL '6 months'
    """)
    rows = cursor.fetchall()
    print(f"   Fetched {len(rows):,} rows - took {time.time() - start:.2f}s")
    
    # Test 4: Fetch filters (additional queries done per-region)
    print("\n4. Fetch filters (done per-region in refresh):")
    start = time.time()
    
    cursor.execute("SELECT threshold_value FROM magento_region_filters WHERE region = 'uk' AND filter_type = 'threshold'")
    cursor.fetchall()
    
    cursor.execute("SELECT qty_threshold_value FROM magento_region_filters WHERE region = 'uk' AND filter_type = 'qty_threshold'")
    cursor.fetchall()
    
    cursor.execute("SELECT customer_email FROM magento_region_filters WHERE region = 'uk' AND filter_type = 'excluded_customer'")
    cursor.fetchall()
    
    cursor.execute("SELECT customer_group FROM magento_region_filters WHERE region = 'uk' AND filter_type = 'excluded_group'")
    cursor.fetchall()
    
    cursor.execute("SELECT order_status FROM magento_region_filters WHERE region = 'uk' AND filter_type = 'excluded_status'")
    cursor.fetchall()
    
    print(f"   5 filter queries - took {time.time() - start:.2f}s")
    
    # Test 5: Python processing simulation
    print("\n5. Python processing of rows (date parsing, etc):")
    start = time.time()
    processed = 0
    for row in rows:
        sku, name, qty, grand_total, currency, customer_email, customer_group, created_at, status = row
        # Simulate the date parsing done in refresh_aggregated_data
        if created_at:
            if '-' in str(created_at):
                pass  # Would parse YYYY-MM-DD
            elif '/' in str(created_at):
                pass  # Would try multiple formats
        processed += 1
    print(f"   Processed {processed:,} rows - took {time.time() - start:.2f}s")
    
    # Test 6: Batch INSERT
    print("\n6. Test batch INSERT (100 rows):")
    # First check if test table exists
    cursor.execute("SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = 'perf_test_temp')")
    if not cursor.fetchone()[0]:
        cursor.execute("""
            CREATE TABLE perf_test_temp (
                sku VARCHAR(255),
                name TEXT,
                total_qty INT
            )
        """)
        conn.commit()
    
    start = time.time()
    for i in range(100):
        cursor.execute("INSERT INTO perf_test_temp (sku, name, total_qty) VALUES (%s, %s, %s)", 
                      (f'TEST-{i}', f'Test Product {i}', i))
    conn.commit()
    print(f"   100 individual INSERTs - took {time.time() - start:.2f}s")
    
    # Clean up
    cursor.execute("DROP TABLE IF EXISTS perf_test_temp")
    conn.commit()
    
    # Summary
    print("\n" + "=" * 60)
    print("ANALYSIS")
    print("=" * 60)
    print("""
The slow parts are likely:
1. Complex regex-based date parsing in WHERE clause
2. Multiple round-trips for filter queries  
3. Row-by-row INSERT instead of batch INSERT
4. Processing 60K+ rows in Python

With 3 regions, the 95K total rows are processed 3x during init!
""")
    
    conn.close()

if __name__ == "__main__":
    main()
