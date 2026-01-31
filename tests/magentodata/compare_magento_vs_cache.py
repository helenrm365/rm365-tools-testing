#!/usr/bin/env python3
"""
Compare direct Magento MySQL query performance vs local PostgreSQL cache.
"""

import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

import psycopg2
import pymysql

def get_postgres_connection():
    return psycopg2.connect(
        host=os.environ.get('PRODUCTS_DB_HOST', '100.65.109.31'),
        port=int(os.environ.get('PRODUCTS_DB_PORT', 5432)),
        database=os.environ.get('PRODUCTS_DB_NAME', 'productSalesDb'),
        user=os.environ.get('PRODUCTS_DB_USER', 'ianhjweng'),
        password=os.environ.get('PRODUCTS_DB_PASSWORD', ''),
        sslmode='require'
    )

def get_magento_uk_connection():
    # Import settings from the backend
    sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))
    from core.config import settings
    
    return pymysql.connect(
        host=settings.MAGENTO_DB_HOST_UK,
        port=settings.MAGENTO_DB_PORT,
        database=settings.MAGENTO_DB_NAME_UK,
        user=settings.MAGENTO_DB_USER_UK,
        password=settings.MAGENTO_DB_PASSWORD_UK,
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
        read_timeout=60
    )

def compare_performance():
    print("=" * 70)
    print("MAGENTO DIRECT vs CACHE PERFORMANCE COMPARISON")
    print("=" * 70)
    
    # Test 1: PostgreSQL Cache
    print("\n📋 PostgreSQL Cache (uk_orders_cache)")
    print("-" * 50)
    
    try:
        start = time.time()
        pg_conn = get_postgres_connection()
        connect_time = (time.time() - start) * 1000
        print(f"   Connection time: {connect_time:.1f} ms")
        
        cursor = pg_conn.cursor()
        
        # Count
        start = time.time()
        cursor.execute("SELECT COUNT(*) FROM uk_orders_cache")
        count = cursor.fetchone()[0]
        count_time = (time.time() - start) * 1000
        print(f"   COUNT(*): {count:,} rows in {count_time:.1f} ms")
        
        # Select with limit
        start = time.time()
        cursor.execute("""
            SELECT * FROM uk_orders_cache
            ORDER BY imported_at DESC
            LIMIT 100 OFFSET 0
        """)
        rows = cursor.fetchall()
        select_time = (time.time() - start) * 1000
        print(f"   SELECT LIMIT 100: {len(rows)} rows in {select_time:.1f} ms")
        
        print(f"   TOTAL: {connect_time + count_time + select_time:.1f} ms")
        
        cursor.close()
        pg_conn.close()
    except Exception as e:
        print(f"   ERROR: {e}")
    
    # Test 2: Magento MySQL Direct
    print("\n📋 Magento MySQL Direct (UK)")
    print("-" * 50)
    
    try:
        start = time.time()
        mysql_conn = get_magento_uk_connection()
        connect_time = (time.time() - start) * 1000
        print(f"   Connection time: {connect_time:.1f} ms")
        
        cursor = mysql_conn.cursor()
        
        # Count (the expensive query)
        start = time.time()
        cursor.execute("""
            SELECT COUNT(*) as count
            FROM sales_order_item soi
            JOIN sales_order so ON soi.order_id = so.entity_id
            WHERE soi.product_type != 'configurable'
            AND LOWER(soi.name) NOT LIKE '%%free gift%%'
            AND LOWER(soi.name) NOT LIKE '%%cadeaux gratuits%%'
        """)
        result = cursor.fetchone()
        count = result['count']
        count_time = (time.time() - start) * 1000
        print(f"   COUNT(*): {count:,} rows in {count_time:.1f} ms")
        
        # Select with limit (the actual data query)
        start = time.time()
        cursor.execute("""
            SELECT 
                so.increment_id as order_number,
                so.created_at,
                so.status,
                so.order_currency_code as currency,
                so.grand_total,
                so.customer_email,
                so.customer_firstname,
                so.customer_lastname,
                so.customer_group_id,
                soi.sku,
                MAX(soi.name) as name,
                SUM(soi.qty_invoiced) as qty_invoiced,
                MAX(soi.original_price) as original_price,
                MAX(soi.price) as price
            FROM sales_order_item soi
            JOIN sales_order so ON soi.order_id = so.entity_id
            WHERE soi.product_type != 'configurable'
            AND LOWER(soi.name) NOT LIKE '%%free gift%%'
            AND LOWER(soi.name) NOT LIKE '%%cadeaux gratuits%%'
            GROUP BY so.increment_id, so.created_at, so.status, so.order_currency_code,
                     so.grand_total, so.customer_email, so.customer_firstname,
                     so.customer_lastname, so.customer_group_id, soi.sku
            ORDER BY so.created_at DESC 
            LIMIT 100 OFFSET 0
        """)
        rows = cursor.fetchall()
        select_time = (time.time() - start) * 1000
        print(f"   SELECT LIMIT 100: {len(rows)} rows in {select_time:.1f} ms")
        
        total_magento = connect_time + count_time + select_time
        print(f"   TOTAL: {total_magento:.1f} ms")
        
        cursor.close()
        mysql_conn.close()
        
    except Exception as e:
        print(f"   ERROR: {e}")
        import traceback
        traceback.print_exc()
    
    # Test 3: Check network latency
    print("\n📋 Network Latency Check")
    print("-" * 50)
    
    pg_host = os.environ.get('PRODUCTS_DB_HOST', '')
    magento_host = os.environ.get('MAGENTO_UK_HOST', '')
    
    print(f"   PostgreSQL host: {pg_host}")
    print(f"   Magento UK host: {magento_host}")
    
    # Ping test (if possible)
    import subprocess
    for name, host in [("PostgreSQL", pg_host), ("Magento UK", magento_host)]:
        if host:
            try:
                result = subprocess.run(
                    ["ping", "-c", "3", host],
                    capture_output=True,
                    text=True,
                    timeout=10
                )
                # Parse average ping time
                for line in result.stdout.split('\n'):
                    if 'avg' in line.lower() or 'average' in line.lower():
                        print(f"   {name}: {line.strip()}")
                        break
            except Exception as e:
                print(f"   {name}: Could not ping ({e})")

    print("\n" + "=" * 70)
    print("ANALYSIS")
    print("=" * 70)
    print("""
The main factors affecting Magento direct query speed:
1. Network latency to Magento MySQL server
2. The COUNT(*) query scans entire tables
3. Complex JOINs and GROUP BY in the data query
4. No indexes optimized for this query pattern on Magento's side

Potential optimizations for faster direct Magento queries:
1. Skip COUNT(*) - use estimated count or cache it
2. Add indexes on Magento DB (if you have access):
   - sales_order(created_at DESC)
   - sales_order_item(product_type, order_id)
3. Use connection pooling to avoid reconnection overhead
4. Query only needed fields, not SELECT *
    """)

if __name__ == '__main__':
    compare_performance()
