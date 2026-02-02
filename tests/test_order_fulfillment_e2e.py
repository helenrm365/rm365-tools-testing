#!/usr/bin/env python3
"""
End-to-end tests for Order Fulfillment across all 3 regions.
Tests all API endpoints and core workflow functionality.
"""

import requests
import json
import sys
from datetime import datetime

# Configuration
BASE_URL = "http://localhost:8000/api"
TOKEN_FILE = "/tmp/token.txt"

# Load auth token
try:
    with open(TOKEN_FILE, 'r') as f:
        TOKEN = f.read().strip()
except FileNotFoundError:
    print("❌ No auth token found at /tmp/token.txt - please login first")
    sys.exit(1)

HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# Region configurations
REGIONS = {
    "birmingham": {
        "api_prefix": "/v1/magento",
        "name": "Birmingham (UK)",
    },
    "france": {
        "api_prefix": "/v1/france-magento",
        "name": "France (FR/NL)",
    },
    "london": {
        "api_prefix": "/v1/london-magento",
        "name": "London (UK)",
    }
}

def test_endpoint(name, method, url, expected_status=200, data=None):
    """Test a single endpoint and return result."""
    try:
        if method == "GET":
            resp = requests.get(url, headers=HEADERS, timeout=10)
        elif method == "POST":
            resp = requests.post(url, headers=HEADERS, json=data, timeout=10)
        elif method == "PUT":
            resp = requests.put(url, headers=HEADERS, json=data, timeout=10)
        elif method == "DELETE":
            resp = requests.delete(url, headers=HEADERS, timeout=10)
        else:
            return False, f"Unknown method: {method}"
        
        if resp.status_code == expected_status:
            return True, resp.json() if resp.text else {}
        else:
            return False, f"Status {resp.status_code}: {resp.text[:200]}"
    except requests.exceptions.ConnectionError:
        return False, "Connection refused - is server running?"
    except Exception as e:
        return False, str(e)

def test_region(region_key, config):
    """Test all endpoints for a specific region."""
    prefix = config["api_prefix"]
    name = config["name"]
    
    print(f"\n{'='*60}")
    print(f"  Testing {name}")
    print(f"{'='*60}")
    
    results = {"passed": 0, "failed": 0, "tests": []}
    
    # Test 1: Tracking Board
    print("\n📋 Test 1: Tracking Board (GET /tracking/board)")
    success, data = test_endpoint(
        "Tracking Board",
        "GET",
        f"{BASE_URL}{prefix}/tracking/board"
    )
    if success:
        rtp = len(data.get("ready_to_pick", []))
        rtc = len(data.get("ready_to_check", []))
        comp = len(data.get("completed", []))
        print(f"   ✅ PASS - ready_to_pick: {rtp}, ready_to_check: {rtc}, completed: {comp}")
        results["passed"] += 1
        
        # Get an order number for further tests
        orders = data.get("ready_to_pick", []) + data.get("ready_to_check", []) + data.get("completed", [])
        test_order = orders[0]["order_number"] if orders else None
    else:
        print(f"   ❌ FAIL - {data}")
        results["failed"] += 1
        test_order = None
    
    # Test 2: Status endpoint
    print("\n📋 Test 2: Magento Status (GET /status)")
    success, data = test_endpoint(
        "Status",
        "GET",
        f"{BASE_URL}{prefix}/status"
    )
    if success:
        print(f"   ✅ PASS - Tables exist: {data.get('tables_exist')}")
        results["passed"] += 1
    else:
        print(f"   ❌ FAIL - {data}")
        results["failed"] += 1
    
    # Test 3: Invoice Lookup
    if test_order:
        print(f"\n📋 Test 3: Invoice Lookup (GET /invoice/lookup/{test_order})")
        success, data = test_endpoint(
            "Invoice Lookup",
            "GET",
            f"{BASE_URL}{prefix}/invoice/lookup/{test_order}"
        )
        if success:
            items = len(data.get("items", []))
            print(f"   ✅ PASS - Order: {data.get('order_number')}, Invoice: {data.get('invoice_number')}, Items: {items}")
            results["passed"] += 1
            test_invoice = data.get("invoice_number")
        else:
            print(f"   ❌ FAIL - {data}")
            results["failed"] += 1
            test_invoice = None
    else:
        print("\n📋 Test 3: Invoice Lookup - SKIPPED (no orders available)")
        test_invoice = None
    
    # Test 4: Session Check
    if test_order:
        print(f"\n📋 Test 4: Session Check (GET /session/check/{test_order})")
        success, data = test_endpoint(
            "Session Check",
            "GET",
            f"{BASE_URL}{prefix}/session/check/{test_order}"
        )
        if success:
            has_session = data.get("has_session", False)
            status = data.get("status", "none")
            print(f"   ✅ PASS - Has session: {has_session}, Status: {status}")
            results["passed"] += 1
            session_id = data.get("session_id")
        else:
            print(f"   ❌ FAIL - {data}")
            results["failed"] += 1
            session_id = None
    else:
        print("\n📋 Test 4: Session Check - SKIPPED (no orders available)")
        session_id = None
    
    # Test 5: Session Status (if session exists)
    if session_id:
        print(f"\n📋 Test 5: Session Status (GET /session/status/{session_id})")
        success, data = test_endpoint(
            "Session Status",
            "GET",
            f"{BASE_URL}{prefix}/session/status/{session_id}"
        )
        if success:
            print(f"   ✅ PASS - Order: {data.get('order_number')}, Status: {data.get('status')}, Items: {len(data.get('items', []))}")
            results["passed"] += 1
        else:
            print(f"   ❌ FAIL - {data}")
            results["failed"] += 1
    else:
        print("\n📋 Test 5: Session Status - SKIPPED (no active session)")
    
    # Test 6: Active Sessions
    print("\n📋 Test 6: Active Sessions (GET /sessions/active)")
    success, data = test_endpoint(
        "Active Sessions",
        "GET",
        f"{BASE_URL}{prefix}/sessions/active"
    )
    if success:
        print(f"   ✅ PASS - Active sessions: {len(data) if isinstance(data, list) else 'N/A'}")
        results["passed"] += 1
    else:
        print(f"   ❌ FAIL - {data}")
        results["failed"] += 1
    
    # Test 7: Approval Board
    print("\n📋 Test 7: Approval Board (GET /approval/board)")
    success, data = test_endpoint(
        "Approval Board",
        "GET",
        f"{BASE_URL}{prefix}/approval/board"
    )
    if success:
        pending = len(data.get("pending", []))
        approved = len(data.get("approved", []))
        print(f"   ✅ PASS - Pending: {pending}, Approved: {approved}")
        results["passed"] += 1
    else:
        # This might not exist for all regions
        if "404" in str(data) or "Not Found" in str(data):
            print(f"   ⚠️ SKIP - Approval board not available for this region")
        else:
            print(f"   ❌ FAIL - {data}")
            results["failed"] += 1
    
    return results

def main():
    print("\n" + "="*60)
    print("   ORDER FULFILLMENT E2E TEST SUITE")
    print(f"   {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print("="*60)
    
    # Check server connectivity
    print("\n🔌 Checking server connectivity...")
    try:
        resp = requests.get(f"{BASE_URL}/v1/magento/status", headers=HEADERS, timeout=5)
        if resp.status_code == 200:
            print("   ✅ Server is running and responsive")
        else:
            print(f"   ⚠️ Server responded with status {resp.status_code}")
    except requests.exceptions.ConnectionError:
        print("   ❌ Cannot connect to server at localhost:8000")
        print("   Please start the backend server first!")
        sys.exit(1)
    
    # Run tests for each region
    all_results = {}
    for region_key, config in REGIONS.items():
        all_results[region_key] = test_region(region_key, config)
    
    # Summary
    print("\n" + "="*60)
    print("   TEST SUMMARY")
    print("="*60)
    
    total_passed = 0
    total_failed = 0
    
    for region_key, results in all_results.items():
        name = REGIONS[region_key]["name"]
        passed = results["passed"]
        failed = results["failed"]
        total_passed += passed
        total_failed += failed
        status = "✅" if failed == 0 else "❌"
        print(f"   {status} {name}: {passed} passed, {failed} failed")
    
    print(f"\n   TOTAL: {total_passed} passed, {total_failed} failed")
    
    if total_failed == 0:
        print("\n🎉 All tests passed!")
        return 0
    else:
        print(f"\n⚠️ {total_failed} test(s) failed")
        return 1

if __name__ == "__main__":
    sys.exit(main())
