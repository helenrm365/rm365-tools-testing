#!/usr/bin/env python3
"""Quick test to check branch metadata"""
import requests
import json

BASE_URL = "http://localhost:8000/api"

# Login
resp = requests.post(f"{BASE_URL}/v1/auth/login", json={
    "username": "superadmin",
    "password": "admin123"
})
token = resp.json().get("access_token")
headers = {"Authorization": f"Bearer {token}"}

# Get the /metadata endpoint to see raw branch table data
print("Testing UK Birmingham metadata endpoint...")
resp = requests.get(
    f"{BASE_URL}/v1/inventory/management/uk-birmingham/metadata",
    headers=headers
)
data = resp.json()
print(f"Got {len(data)} metadata records")
if data:
    for item in data[:10]:
        print(f"  SKU: {item.get('sku')}, item_id: {item.get('item_id')}, shelf_lt1_qty: {item.get('shelf_lt1_qty')}")
    
    # Find ABG001 specifically
    abg = [i for i in data if i.get('sku') == 'ABG001']
    if abg:
        print(f"\nABG001 found in metadata: {json.dumps(abg[0], indent=2)}")
    else:
        print("\nABG001 NOT found in branch metadata - this is why verification fails!")
        print("The adjustment is going to the branch table but the item may not exist there yet")
else:
    print("No metadata records found")
