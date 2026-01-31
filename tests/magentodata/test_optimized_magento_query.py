#!/usr/bin/env python3
"""
Test optimized direct Magento query (skipping COUNT)
"""

import sys
import os
import time

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

import pymysql
import pymysql.cursors
from core.config import settings

def test_optimized_query():
    print("=" * 70)
    print("OPTIMIZED MAGENTO DIRECT QUERY TEST")
    print("=" * 70)
    
    conn = pymysql.connect(
        host=settings.MAGENTO_DB_HOST_UK,
        port=settings.MAGENTO_DB_PORT,
        database=settings.MAGENTO_DB_NAME_UK,
        user=settings.MAGENTO_DB_USER_UK,
        password=settings.MAGENTO_DB_PASSWORD_UK,
        cursorclass=pymysql.cursors.DictCursor,
        connect_timeout=10,
        read_timeout=60
    )
    
    cursor = conn.cursor()
    
    # Test 1: Original slow query with full GROUP BY
    print("\n📋 Original Query (with GROUP BY and address JOINs)")
    print("-" * 50)
    
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
            MAX(soi.price) as price,
            MAX(soi.product_type) as product_type,
            MAX(sab.street) as billing_street,
            MAX(sab.city) as billing_city,
            MAX(sas.street) as shipping_street,
            MAX(sas.city) as shipping_city
        FROM sales_order_item soi
        JOIN sales_order so ON soi.order_id = so.entity_id
        LEFT JOIN sales_order_address sab ON so.billing_address_id = sab.entity_id
        LEFT JOIN sales_order_address sas ON so.shipping_address_id = sas.entity_id
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
    original_time = (time.time() - start) * 1000
    print(f"   Time: {original_time:.1f} ms")
    print(f"   Rows: {len(rows)}")
    
    # Test 2: Simplified query without address JOINs
    print("\n📋 Simplified Query (no address JOINs)")
    print("-" * 50)
    
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
            soi.name,
            soi.qty_invoiced,
            soi.original_price,
            soi.price
        FROM sales_order_item soi
        JOIN sales_order so ON soi.order_id = so.entity_id
        WHERE soi.product_type != 'configurable'
        AND LOWER(soi.name) NOT LIKE '%%free gift%%'
        AND LOWER(soi.name) NOT LIKE '%%cadeaux gratuits%%'
        ORDER BY so.created_at DESC 
        LIMIT 100 OFFSET 0
    """)
    rows = cursor.fetchall()
    simplified_time = (time.time() - start) * 1000
    print(f"   Time: {simplified_time:.1f} ms")
    print(f"   Rows: {len(rows)}")
    print(f"   Improvement: {original_time/simplified_time:.1f}x faster")
    
    # Test 3: Even simpler - just order items with index hints
    print("\n📋 Minimal Query (with ORDER BY entity_id instead of created_at)")
    print("-" * 50)
    
    start = time.time()
    cursor.execute("""
        SELECT 
            so.increment_id as order_number,
            so.created_at,
            so.status,
            so.order_currency_code as currency,
            so.grand_total,
            so.customer_email,
            soi.sku,
            soi.name,
            soi.qty_invoiced,
            soi.original_price
        FROM sales_order_item soi
        JOIN sales_order so ON soi.order_id = so.entity_id
        WHERE soi.product_type != 'configurable'
        ORDER BY soi.item_id DESC
        LIMIT 100 OFFSET 0
    """)
    rows = cursor.fetchall()
    minimal_time = (time.time() - start) * 1000
    print(f"   Time: {minimal_time:.1f} ms")
    print(f"   Rows: {len(rows)}")
    print(f"   Improvement vs original: {original_time/minimal_time:.1f}x faster")
    
    # Test 4: Check if there's an index on created_at
    print("\n📋 Index Analysis")
    print("-" * 50)
    
    cursor.execute("SHOW INDEX FROM sales_order WHERE Key_name LIKE '%created%' OR Column_name = 'created_at'")
    indexes = cursor.fetchall()
    if indexes:
        for idx in indexes:
            print(f"   Found index: {idx.get('Key_name')} on {idx.get('Column_name')}")
    else:
        print("   ❌ No index on created_at found!")
        print("   Adding an index would dramatically speed up ORDER BY created_at DESC")
    
    cursor.execute("SHOW INDEX FROM sales_order_item WHERE Column_name = 'order_id' OR Column_name = 'product_type'")
    indexes = cursor.fetchall()
    if indexes:
        for idx in indexes:
            print(f"   Found index: {idx.get('Key_name')} on {idx.get('Column_name')}")
    
    cursor.close()
    conn.close()
    
    print("\n" + "=" * 70)
    print("RECOMMENDATIONS")
    print("=" * 70)
    print(f"""
Original query:     {original_time:.0f} ms
Simplified query:   {simplified_time:.0f} ms  
Minimal query:      {minimal_time:.0f} ms

To make direct Magento fast:
1. Remove address JOINs (saves ~50% time)
2. Remove GROUP BY (if not needed)
3. Remove LIKE filters on soi.name (or use FULLTEXT index)
4. Use item_id DESC instead of created_at DESC (uses primary key index)
5. Skip COUNT(*) - use cached/estimated count
    """)

if __name__ == '__main__':
    test_optimized_query()
