#!/usr/bin/env python3
"""Check if item_id exists in Birmingham inventory"""
import sys
import os
from dotenv import load_dotenv

# Load environment variables
load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

sys.path.insert(0, os.path.join(os.path.dirname(__file__), 'backend'))

from core.db import get_inventory_log_connection, return_inventory_connection

conn = get_inventory_log_connection()
cursor = conn.cursor()

# Search for the item_id
item_id = '717300108691213543'
cursor.execute('SELECT sku, item_id FROM uk_birmingham_inventory WHERE item_id = %s', (item_id,))
result = cursor.fetchone()
if result:
    print(f'Found: SKU={result[0]}, item_id={result[1]}')
else:
    print(f'No match for item_id={item_id}')
    
# Let's also search for partial matches
cursor.execute('SELECT sku, item_id FROM uk_birmingham_inventory WHERE item_id LIKE %s LIMIT 5', (f'%{item_id[-6:]}%',))
results = cursor.fetchall()
print(f'\nPartial matches (last 6 digits): {results}')

# Check if item exists with different formats
cursor.execute('SELECT sku, item_id FROM uk_birmingham_inventory WHERE sku = %s LIMIT 5', ('RE003',))
results = cursor.fetchall()
print(f'\nRows for SKU RE003: {results}')

# Check total rows for RE003
cursor.execute('SELECT COUNT(*) FROM uk_birmingham_inventory WHERE sku = %s', ('RE003',))
count = cursor.fetchone()[0]
print(f'Total RE003 items: {count}')

cursor.close()

# Check other inventory tables
print('\n--- Checking inventory tables ---')
cursor = conn.cursor()

# List all tables with inventory in the name
cursor.execute("SELECT table_name FROM information_schema.tables WHERE table_name LIKE '%inventory%' ORDER BY table_name")
tables = cursor.fetchall()
print(f'Inventory tables: {[t[0] for t in tables]}')

# Check UK London inventory
try:
    cursor.execute("SELECT COUNT(*) FROM uk_london_inventory WHERE sku = %s", ('RE003',))
    count = cursor.fetchone()[0]
    print(f'UK London inventory RE003 count: {count}')
    
    # Check for item_id in London
    cursor.execute('SELECT sku, item_id FROM uk_london_inventory WHERE item_id = %s', ('717300108691213543',))
    result = cursor.fetchone()
    print(f'London match for item_id: {result}')
except Exception as e:
    print(f'Error checking London: {e}')

# Check UK Birmingham sample items
cursor.execute("SELECT sku, item_id FROM uk_birmingham_inventory LIMIT 5")
results = cursor.fetchall()
print(f'\nSample Birmingham items: {results}')

# Check UK London sample items  
cursor.execute("SELECT sku, item_id FROM uk_london_inventory LIMIT 5")
results = cursor.fetchall()
print(f'Sample London items: {results}')

# Check inventory_metadata table
print('\n--- Checking inventory_metadata table ---')
cursor.execute("SELECT sku, item_id FROM inventory_metadata WHERE item_id = %s", ('717300108691213543',))
result = cursor.fetchone()
print(f'Metadata match for item_id: {result}')

cursor.execute("SELECT sku, item_id FROM inventory_metadata WHERE sku = %s LIMIT 5", ('RE003',))
results = cursor.fetchall()
print(f'Metadata rows for RE003: {results}')

cursor.execute("SELECT COUNT(*) FROM inventory_metadata WHERE sku = %s", ('RE003',))
count = cursor.fetchone()[0]
print(f'Metadata RE003 count: {count}')

cursor.close()
return_inventory_connection(conn)
