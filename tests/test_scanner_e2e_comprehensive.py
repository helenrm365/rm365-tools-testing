#!/usr/bin/env python3
"""
Comprehensive End-to-End Test for Scanner Workflow
Tests complete workflow across all branches with isolation verification
"""

import requests
import json
import time
from datetime import datetime
from typing import Dict, List, Any

BASE_URL = "http://localhost:8000"

# Test configuration
TEST_PRODUCT = {
    "sku": "TEST-SCAN-001",
    "item_id": "TEST001",
    "product_name": "Test Scanner Product",
    "initial_stock": {
        "shelf_lt1_qty": 50,
        "shelf_gt1_qty": 30,
        "top_floor_total": 20,
        "total_qty": 100
    }
}

BRANCHES = [
    {"id": "uk-birmingham", "name": "Birmingham", "table": "uk_birmingham"},
    {"id": "uk-london", "name": "London", "table": "uk_london"},
    {"id": "fr-paris", "name": "France", "table": "fr_paris"}
]

# Simulated auth token (replace with real token if needed)
AUTH_TOKEN = None

def get_headers():
    """Get request headers"""
    headers = {"Content-Type": "application/json"}
    if AUTH_TOKEN:
        headers["Authorization"] = f"Bearer {AUTH_TOKEN}"
    return headers

def print_section(title):
    """Print a section header"""
    print("\n" + "=" * 80)
    print(f"  {title}")
    print("=" * 80)

def print_test(description, passed, details=""):
    """Print test result"""
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status} - {description}")
    if details:
        print(f"     {details}")

class TestResults:
    def __init__(self):
        self.total = 0
        self.passed = 0
        self.failed = 0
        self.failures = []
    
    def add(self, description, passed, details=""):
        self.total += 1
        if passed:
            self.passed += 1
        else:
            self.failed += 1
            self.failures.append(f"{description}: {details}")
        print_test(description, passed, details)
    
    def summary(self):
        print_section("TEST SUMMARY")
        print(f"Total Tests: {self.total}")
        print(f"Passed: {self.passed}")
        print(f"Failed: {self.failed}")
        print(f"Success Rate: {(self.passed/self.total*100):.1f}%")
        
        if self.failures:
            print("\n❌ FAILURES:")
            for f in self.failures:
                print(f"  - {f}")
        else:
            print("\n🎉 ALL TESTS PASSED!")
        
        return self.failed == 0

results = TestResults()

def check_inventory_stock(branch_id: str, sku: str) -> Dict[str, Any]:
    """Get current stock for a product in a branch"""
    try:
        url = f"{BASE_URL}/v1/inventory/management/{branch_id}/items?search={sku}&per_page=1"
        response = requests.get(url, headers=get_headers(), timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            if data.get("items") and len(data["items"]) > 0:
                return data["items"][0]
        return None
    except Exception as e:
        print(f"Error checking inventory: {e}")
        return None

def create_test_product_in_branch(branch_id: str) -> bool:
    """Create or update test product in a branch's inventory"""
    try:
        # For now, we'll assume products exist or will be created through the scanner
        # In a real test, we'd insert into the database directly
        print(f"   Setting up test product in {branch_id}...")
        return True
    except Exception as e:
        print(f"   Error setting up product: {e}")
        return False

def count_scanning_logs(branch_id: str) -> int:
    """Count total scanning log submissions for a branch"""
    try:
        url = f"{BASE_URL}/v1/inventory/scanning-logs/{branch_id}/logs?per_page=1000"
        response = requests.get(url, headers=get_headers(), timeout=5)
        
        if response.status_code == 200:
            data = response.json()
            return data.get("total", 0)
        return 0
    except Exception as e:
        print(f"Error counting logs: {e}")
        return -1

def simulate_scanner_submission(branch_id: str, items: List[Dict], reason: str) -> Dict[str, Any]:
    """Simulate a scanner submission through the API"""
    try:
        url = f"{BASE_URL}/v1/inventory/scanning-logs/{branch_id}/log"
        payload = {
            "reason": reason,
            "items": items
        }
        
        response = requests.post(url, headers=get_headers(), json=payload, timeout=10)
        
        if response.status_code in [200, 201]:
            return {"success": True, "data": response.json()}
        else:
            return {"success": False, "error": f"Status {response.status_code}: {response.text}"}
    except Exception as e:
        return {"success": False, "error": str(e)}

def test_branch_isolation():
    """Test that branches are isolated from each other"""
    print_section("TESTING BRANCH ISOLATION")
    
    # Get initial states for all branches
    initial_states = {}
    for branch in BRANCHES:
        stock = check_inventory_stock(branch["id"], TEST_PRODUCT["sku"])
        log_count = count_scanning_logs(branch["id"])
        initial_states[branch["id"]] = {
            "stock": stock,
            "log_count": log_count
        }
        print(f"   {branch['name']}: {log_count} logs, Stock: {stock.get('total_qty') if stock else 'N/A'}")
    
    # Test Birmingham submission
    print(f"\n   Submitting to Birmingham...")
    items = [{
        "sku": TEST_PRODUCT["sku"],
        "item_id": TEST_PRODUCT["item_id"],
        "product_name": TEST_PRODUCT["product_name"],
        "quantity": -5,
        "shelf_field": "auto",
        "allocation_details": None
    }]
    
    result = simulate_scanner_submission("uk-birmingham", items, "Branch isolation test")
    
    if not result["success"]:
        results.add(
            "Birmingham submission",
            False,
            result.get("error", "Unknown error")
        )
        return
    
    results.add("Birmingham submission", True, "Submission created successfully")
    
    # Wait a moment for processing
    time.sleep(1)
    
    # Check all branches after Birmingham submission
    print(f"\n   Checking branch states after Birmingham submission...")
    for branch in BRANCHES:
        log_count = count_scanning_logs(branch["id"])
        initial_count = initial_states[branch["id"]]["log_count"]
        
        if branch["id"] == "uk-birmingham":
            # Birmingham should have one more log
            expected = initial_count + 1
            passed = log_count == expected
            results.add(
                f"{branch['name']} log count increased",
                passed,
                f"Expected {expected}, got {log_count}"
            )
        else:
            # Other branches should NOT have changed
            passed = log_count == initial_count
            results.add(
                f"{branch['name']} logs unchanged",
                passed,
                f"Expected {initial_count}, got {log_count}"
            )

def test_api_endpoints():
    """Test that all API endpoints are accessible"""
    print_section("TESTING API ENDPOINTS")
    
    endpoints = [
        ("/v1/inventory/management/uk-birmingham/items?per_page=1", "Birmingham inventory"),
        ("/v1/inventory/management/uk-london/items?per_page=1", "London inventory"),
        ("/v1/inventory/management/fr-paris/items?per_page=1", "France inventory"),
        ("/v1/inventory/scanning-logs/uk-birmingham/logs?per_page=1", "Birmingham logs"),
        ("/v1/inventory/scanning-logs/uk-london/logs?per_page=1", "London logs"),
        ("/v1/inventory/scanning-logs/fr-paris/logs?per_page=1", "France logs"),
    ]
    
    for endpoint, name in endpoints:
        try:
            response = requests.get(f"{BASE_URL}{endpoint}", headers=get_headers(), timeout=5)
            passed = response.status_code in [200, 401]  # 401 is OK if auth required
            results.add(
                f"{name} endpoint accessible",
                passed,
                f"Status: {response.status_code}"
            )
        except Exception as e:
            results.add(f"{name} endpoint accessible", False, str(e))

def test_frontend_routes():
    """Test that frontend routes are accessible"""
    print_section("TESTING FRONTEND ROUTES")
    
    routes = [
        "/birmingham-orders/scanner",
        "/birmingham-orders/scanning-logs",
        "/france-orders/scanner",
        "/france-orders/scanning-logs",
        "/london-orders/scanner",
        "/london-orders/scanning-logs"
    ]
    
    for route in routes:
        try:
            response = requests.get(f"{BASE_URL}{route}", timeout=5)
            passed = response.status_code == 200
            results.add(
                f"Route {route}",
                passed,
                f"Status: {response.status_code}"
            )
        except Exception as e:
            results.add(f"Route {route}", False, str(e))

def test_sidebar_navigation():
    """Test that sidebar includes scanner and scanning logs"""
    print_section("TESTING SIDEBAR NAVIGATION")
    
    try:
        response = requests.get(f"{BASE_URL}/js/ui/sidebar.js", timeout=5)
        if response.status_code == 200:
            content = response.text
            
            # Check Birmingham
            has_birm_scanner = "'/birmingham-orders/scanner'" in content
            has_birm_logs = "'/birmingham-orders/scanning-logs'" in content
            results.add("Birmingham scanner in sidebar", has_birm_scanner)
            results.add("Birmingham logs in sidebar", has_birm_logs)
            
            # Check France
            has_fr_scanner = "'/france-orders/scanner'" in content
            has_fr_logs = "'/france-orders/scanning-logs'" in content
            results.add("France scanner in sidebar", has_fr_scanner)
            results.add("France logs in sidebar", has_fr_logs)
            
            # Check London
            has_ldn_scanner = "'/london-orders/scanner'" in content
            has_ldn_logs = "'/london-orders/scanning-logs'" in content
            results.add("London scanner in sidebar", has_ldn_scanner)
            results.add("London logs in sidebar", has_ldn_logs)
        else:
            results.add("Sidebar file accessible", False, f"Status: {response.status_code}")
    except Exception as e:
        results.add("Sidebar file accessible", False, str(e))

def test_validation_logic():
    """Test that validation logic exists in scanner files"""
    print_section("TESTING VALIDATION LOGIC")
    
    branches = ["birmingham", "france", "london"]
    
    for branch in branches:
        try:
            url = f"{BASE_URL}/js/modules/{branch}-orders/scanner.js"
            response = requests.get(url, timeout=5)
            
            if response.status_code == 200:
                content = response.text
                
                has_validation = "validateStockAvailability" in content
                has_shelf_stock = "shelfStock:" in content
                has_error_beep = "playErrorBeep" in content
                
                results.add(f"{branch.title()} has validation method", has_validation)
                results.add(f"{branch.title()} stores shelf stock", has_shelf_stock)
                results.add(f"{branch.title()} has error beep", has_error_beep)
            else:
                results.add(f"{branch.title()} scanner accessible", False, f"Status: {response.status_code}")
        except Exception as e:
            results.add(f"{branch.title()} scanner accessible", False, str(e))

def main():
    print("=" * 80)
    print("  COMPREHENSIVE SCANNER WORKFLOW E2E TEST")
    print("  Testing complete isolation and functionality across all branches")
    print("=" * 80)
    print(f"Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"Base URL: {BASE_URL}")
    
    # Run all tests
    test_api_endpoints()
    test_frontend_routes()
    test_sidebar_navigation()
    test_validation_logic()
    test_branch_isolation()
    
    # Print summary
    print("\n")
    success = results.summary()
    
    print(f"\nEnd Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    
    return 0 if success else 1

if __name__ == "__main__":
    exit(main())
