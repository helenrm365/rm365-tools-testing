from core.db import get_inventory_log_connection, return_inventory_connection
import json
import logging
logging.basicConfig(level=logging.INFO)

conn = get_inventory_log_connection()
with conn.cursor() as cur:
    # Check what variant_statuses values exist
    cur.execute('''
        SELECT 
            sku, 
            variant_statuses,
            status
        FROM inventory_metadata
        ORDER BY sku
        LIMIT 20
    ''')
    print('\nSample variant_statuses in inventory_metadata:')
    print('=' * 80)
    for row in cur.fetchall():
        sku = row[0]
        variant_statuses = row[1]
        status = row[2]
        print(f'SKU: {sku}')
        print(f'  status: {status}')
        print(f'  variant_statuses: {variant_statuses}')
        print()
        
    # Check distribution of statuses
    cur.execute('''
        SELECT 
            jsonb_array_elements_text(variant_statuses) as status,
            COUNT(DISTINCT sku) as sku_count
        FROM inventory_metadata
        WHERE variant_statuses IS NOT NULL
        GROUP BY status
        ORDER BY sku_count DESC
    ''')
    print('\nDistribution of statuses in variant_statuses:')
    print('=' * 80)
    for row in cur.fetchall():
        print(f'{row[0]}: {row[1]} SKUs')
