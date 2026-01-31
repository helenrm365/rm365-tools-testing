#!/usr/bin/env python3
"""
Diagnose where the slowness is in Magento data page loads.
Tests raw database queries vs full API response to identify bottleneck.
"""

import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

import psycopg2
import requests

API_BASE = 'http://localhost:8000'

def get_connection():
    return psycopg2.connect(
        host=os.environ.get('PRODUCTS_DB_HOST', '100.65.109.31'),
        port=int(os.environ.get('PRODUCTS_DB_PORT', 5432)),
        database=os.environ.get('PRODUCTS_DB_NAME', 'productSalesDb'),
        user=os.environ.get('PRODUCTS_DB_USER', 'ianhjweng'),
        password=os.environ.get('PRODUCTS_DB_PASSWORD', ''),
        sslmode='require'
    )

def diagnose():
    print("=" * 70)
    print("PERFORMANCE DIAGNOSIS")
    print("=" * 70)
    
    conn = get_connection()
    cursor = conn.cursor()
    
    tables = ['uk_orders_cache', 'fr_orders_cache', 'nl_orders_cache']
    
    for table in tables:
        print(f"\n📋 Table: {table}")
        print("-" * 50)
        
        # Test 1: Simple COUNT(*)
        print("\n1. COUNT(*) query:")
        start = time.time()
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        count = cursor.fetchone()[0]
        print(f"   Result: {count:,} rows")
        print(f"   Time: {(time.time() - start)*1000:.1f} ms")
        
        # Test 2: SELECT with ORDER BY and LIMIT (what the page load does)
        print("\n2. SELECT * ORDER BY imported_at DESC LIMIT 100:")
        start = time.time()
        cursor.execute(f"""
            SELECT * FROM {table}
            ORDER BY imported_at DESC
            LIMIT 100 OFFSET 0
        """)
        rows = cursor.fetchall()
        print(f"   Rows returned: {len(rows)}")
        print(f"   Time: {(time.time() - start)*1000:.1f} ms")
        
        # Test 3: Using the new index
        print("\n3. EXPLAIN ANALYZE for ORDER BY with new index:")
        cursor.execute(f"""
            EXPLAIN (ANALYZE, BUFFERS, FORMAT TEXT)
            SELECT * FROM {table}
            ORDER BY imported_at DESC
            LIMIT 100 OFFSET 0
        """)
        plan = cursor.fetchall()
        for row in plan[:5]:  # First 5 lines of plan
            print(f"   {row[0]}")
        
        # Test 4: Total time for both queries (what the API does)
        print("\n4. Combined COUNT + SELECT (what API does):")
        start = time.time()
        cursor.execute(f"SELECT COUNT(*) FROM {table}")
        cursor.fetchone()
        cursor.execute(f"""
            SELECT * FROM {table}
            ORDER BY imported_at DESC
            LIMIT 100 OFFSET 0
        """)
        cursor.fetchall()
        total_db_time = (time.time() - start) * 1000
        print(f"   Total DB time: {total_db_time:.1f} ms")
    
    cursor.close()
    conn.close()
    
    # Now test the API
    print("\n" + "=" * 70)
    print("API RESPONSE TIME BREAKDOWN")
    print("=" * 70)
    
    # Login first
    response = requests.post(f"{API_BASE}/api/v1/auth/login", json={
        'username': os.environ.get('SUPERADMIN_USERNAME', 'superadmin'),
        'password': os.environ.get('SUPERADMIN_PASSWORD', '')
    })
    token = response.json().get('access_token')
    headers = {'Authorization': f'Bearer {token}'}
    
    for region in ['uk', 'fr', 'nl']:
        print(f"\n📋 {region.upper()} API call:")
        
        start = time.time()
        response = requests.get(
            f"{API_BASE}/api/v1/magentodata/{region}?limit=100&offset=0",
            headers=headers
        )
        total_api_time = (time.time() - start) * 1000
        
        data = response.json()
        print(f"   Status: {response.status_code}")
        print(f"   Total API time: {total_api_time:.1f} ms")
        print(f"   Records returned: {len(data.get('data', []))}")
        print(f"   Total count: {data.get('total_count', 0):,}")
        
        # Calculate overhead
        db_time = 50  # Approximate from direct DB tests
        overhead = total_api_time - db_time
        print(f"   Estimated overhead (network + processing): {overhead:.1f} ms")
    
    print("\n" + "=" * 70)
    print("DIAGNOSIS SUMMARY")
    print("=" * 70)
    print("""
If DB time is fast (<100ms) but API time is slow (>5s):
   → Network latency to database is the bottleneck
   → Consider database connection pooling improvements
   → Consider caching the total count

If DB time is also slow:
   → Database query optimization needed
   → Consider adding more indexes or optimizing queries
    """)

if __name__ == '__main__':
    diagnose()
