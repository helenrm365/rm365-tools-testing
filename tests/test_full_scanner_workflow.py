#!/usr/bin/env python3
"""
Comprehensive Scanner Workflow API Test
Simulates complete frontend workflow through API calls
"""

import requests
import json
import time
import sys
from pathlib import Path
from datetime import datetime

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent))

from manual_test_script import check_product_in_inventory, count_scanning_logs, get_submission_details

BASE_URL = "http://localhost:8000"

def get_auth_token():
    """Get authentication token"""
    try:
        response = requests.post(
            f"{BASE_URL}/auth/login",
            json={"username": "superadmin", "password": "admin123"},
            timeout=5
        )
        if response.status_code == 200:
            data = response.json()
            return data.get("access_token")
    except:
        pass
    return None

AUTH_TOKEN = get_auth_token()

def get_headers():
    """Get request headers with auth"""
    headers = {"Content-Type": "application/json"}
    if AUTH_TOKEN:
        headers["Authorization"] = f"Bearer {AUTH_TOKEN}"
    return headers

def print_header(text):
    print("\n" + "="*80)
    print(f"  {text}")
    print("="*80)

def print_test(desc, passed, details=""):
    status = "✅ PASS" if passed else "❌ FAIL"
    print(f"{status} - {desc}")
    if details:
        print(f"     {details}")

class WorkflowTest:
    def __init__(self):
        self.results = []
        self.initial_states = {}
        
    def record(self, desc, passed, details=""):
        self.results.append({"desc": desc, "passed": passed, "details": details})
        print_test(desc, passed, details)
        
    def test_birmingham_workflow(self):
        """Test complete Birmingham scanner workflow"""
        print_header("PHASE 1: BIRMINGHAM WORKFLOW TEST")
        
        # Record initial state
        print("\n📊 Recording initial Birmingham state...")
        initial_count = count_scanning_logs("birmingham")
        initial_stock = check_product_in_inventory("birmingham", "TEST-SCAN-001")
        self.initial_states["birmingham"] = {
            "log_count": initial_count,
            "stock": initial_stock
        }
        
        # Create submission
        print("\n🔨 Creating Birmingham submission...")
        url = f"{BASE_URL}/v1/inventory/scanning-logs/uk-birmingham/log"
        payload = {
            "reason": "Birmingham E2E Test - API Workflow",
            "items": [
                {
                    "sku": "TEST-SCAN-001",
                    "item_id": "TEST001",
                    "product_name": "Test Scanner Product",
                    "quantity": 10,
                    "shelf_field": "shelf_lt1",
                    "allocation_details": None
                },
                {
                    "sku": "TEST-SCAN-002",
                    "item_id": "TEST002",
                    "product_name": "Another Test Product",
                    "quantity": 5,
                    "shelf_field": "shelf_gt1",
                    "allocation_details": None
                },
                {
                    "sku": "TEST-SCAN-001",
                    "item_id": "TEST001",
                    "product_name": "Test Scanner Product",
                    "quantity": -8,
                    "shelf_field": "auto",
                    "allocation_details": None
                }
            ]
        }
        
        response = requests.post(url, json=payload, headers=get_headers(), timeout=10)
        self.record(
            "Birmingham submission created",
            response.status_code in [200, 201],
            f"Status: {response.status_code}"
        )
        
        if response.status_code in [200, 201]:
            submission_data = response.json()
            submission_id = submission_data.get("id")
            print(f"   📝 Submission ID: {submission_id}")
            
            # Verify submission in database
            time.sleep(0.5)
            get_submission_details("birmingham", submission_id)
            
            # Check log count increased
            new_count = count_scanning_logs("birmingham")
            self.record(
                "Birmingham log count increased by 1",
                new_count == initial_count + 1,
                f"Initial: {initial_count}, New: {new_count}"
            )
            
            # Check stock updated
            new_stock = check_product_in_inventory("birmingham", "TEST-SCAN-001")
            if initial_stock and new_stock:
                # Added 10, removed 8 = net +2
                expected_total = initial_stock['total_qty'] + 2
                self.record(
                    "Birmingham stock updated correctly",
                    new_stock['total_qty'] == expected_total,
                    f"Expected: {expected_total}, Got: {new_stock['total_qty']}"
                )
        
        return submission_id if response.status_code in [200, 201] else None
    
    def verify_isolation_after_birmingham(self):
        """Verify Birmingham submission didn't affect other branches"""
        print_header("PHASE 2: VERIFY BIRMINGHAM ISOLATION")
        
        print("\n🔍 Checking France logs...")
        france_count = count_scanning_logs("france")
        self.record(
            "France logs unchanged",
            france_count == 0,
            f"France has {france_count} logs (expected 0)"
        )
        
        print("\n🔍 Checking London logs...")
        london_count = count_scanning_logs("london")
        self.record(
            "London logs unchanged",
            london_count == 0,
            f"London has {london_count} logs (expected 0)"
        )
        
        # Check France stock unchanged for same product
        print("\n🔍 Checking France inventory...")
        france_stock = check_product_in_inventory("france", "TEST-SCAN-001")
        if france_stock:
            self.record(
                "France inventory unaffected",
                france_stock['total_qty'] == 100,  # Original amount
                f"France still has {france_stock['total_qty']} units"
            )
        
        # Check London stock unchanged
        print("\n🔍 Checking London inventory...")
        london_stock = check_product_in_inventory("london", "TEST-SCAN-001")
        if london_stock:
            self.record(
                "London inventory unaffected",
                london_stock['total_qty'] == 100,  # Original amount
                f"London still has {london_stock['total_qty']} units"
            )
    
    def test_france_workflow(self):
        """Test complete France scanner workflow"""
        print_header("PHASE 3: FRANCE WORKFLOW TEST")
        
        print("\n📊 Recording initial France state...")
        initial_count = count_scanning_logs("france")
        initial_stock = check_product_in_inventory("france", "TEST-SCAN-002")
        
        print("\n🔨 Creating France submission...")
        url = f"{BASE_URL}/v1/inventory/scanning-logs/fr-paris/log"
        payload = {
            "reason": "France E2E Test - Different Products",
            "items": [
                {
                    "sku": "TEST-SCAN-002",
                    "item_id": "TEST002",
                    "product_name": "Another Test Product",
                    "quantity": 20,
                    "shelf_field": "top_floor",
                    "allocation_details": None
                },
                {
                    "sku": "TEST-SCAN-001",
                    "item_id": "TEST001",
                    "product_name": "Test Scanner Product",
                    "quantity": -15,
                    "shelf_field": "auto",
                    "allocation_details": None
                }
            ]
        }
        
        response = requests.post(url, json=payload, headers=get_headers(), timeout=10)
        self.record(
            "France submission created",
            response.status_code in [200, 201],
            f"Status: {response.status_code}"
        )
        
        if response.status_code in [200, 201]:
            submission_data = response.json()
            submission_id = submission_data.get("id")
            print(f"   📝 Submission ID: {submission_id}")
            
            time.sleep(0.5)
            get_submission_details("france", submission_id)
            
            new_count = count_scanning_logs("france")
            self.record(
                "France log count increased by 1",
                new_count == initial_count + 1,
                f"Initial: {initial_count}, New: {new_count}"
            )
    
    def verify_isolation_after_france(self):
        """Verify France submission didn't affect other branches"""
        print_header("PHASE 4: VERIFY FRANCE ISOLATION")
        
        print("\n🔍 Checking Birmingham logs...")
        birm_count = count_scanning_logs("birmingham")
        self.record(
            "Birmingham still has only 1 log",
            birm_count == 1,
            f"Birmingham has {birm_count} logs"
        )
        
        print("\n🔍 Checking London logs...")
        london_count = count_scanning_logs("london")
        self.record(
            "London still has 0 logs",
            london_count == 0,
            f"London has {london_count} logs"
        )
    
    def test_london_workflow(self):
        """Test complete London scanner workflow"""
        print_header("PHASE 5: LONDON WORKFLOW TEST")
        
        print("\n📊 Recording initial London state...")
        initial_count = count_scanning_logs("london")
        
        print("\n🔨 Creating London submission...")
        url = f"{BASE_URL}/v1/inventory/scanning-logs/uk-london/log"
        payload = {
            "reason": "London E2E Test - Large Addition",
            "items": [
                {
                    "sku": "TEST-SCAN-001",
                    "item_id": "TEST001",
                    "product_name": "Test Scanner Product",
                    "quantity": 30,
                    "shelf_field": "shelf_gt1",
                    "allocation_details": None
                }
            ]
        }
        
        response = requests.post(url, json=payload, headers=get_headers(), timeout=10)
        self.record(
            "London submission created",
            response.status_code in [200, 201],
            f"Status: {response.status_code}"
        )
        
        if response.status_code in [200, 201]:
            submission_data = response.json()
            submission_id = submission_data.get("id")
            print(f"   📝 Submission ID: {submission_id}")
            
            time.sleep(0.5)
            get_submission_details("london", submission_id)
            
            new_count = count_scanning_logs("london")
            self.record(
                "London log count increased by 1",
                new_count == initial_count + 1,
                f"Initial: {initial_count}, New: {new_count}"
            )
    
    def verify_final_isolation(self):
        """Verify all branches are independent"""
        print_header("PHASE 6: FINAL ISOLATION VERIFICATION")
        
        print("\n📊 Final log counts:")
        birm_count = count_scanning_logs("birmingham")
        france_count = count_scanning_logs("france")
        london_count = count_scanning_logs("london")
        
        self.record(
            "Birmingham has exactly 1 log",
            birm_count == 1,
            f"Birmingham: {birm_count}"
        )
        self.record(
            "France has exactly 1 log",
            france_count == 1,
            f"France: {france_count}"
        )
        self.record(
            "London has exactly 1 log",
            london_count == 1,
            f"London: {london_count}"
        )
        
        total = birm_count + france_count + london_count
        self.record(
            "Total logs across all branches = 3",
            total == 3,
            f"Total: {total}"
        )
    
    def test_validation_errors(self):
        """Test validation errors"""
        print_header("PHASE 7: VALIDATION ERROR TESTING")
        
        # Test insufficient stock
        print("\n🧪 Testing insufficient stock error...")
        url = f"{BASE_URL}/v1/inventory/scanning-logs/uk-birmingham/log"
        payload = {
            "reason": "Testing validation - should fail",
            "items": [
                {
                    "sku": "TEST-SCAN-001",
                    "item_id": "TEST001",
                    "product_name": "Test Scanner Product",
                    "quantity": -500,  # Way more than available
                    "shelf_field": "shelf_lt1",
                    "allocation_details": None
                }
            ]
        }
        
        response = requests.post(url, json=payload, headers=get_headers(), timeout=10)
        self.record(
            "Insufficient stock rejected",
            response.status_code in [400, 422],
            f"Status: {response.status_code}"
        )
        
        # Test nonexistent product
        print("\n🧪 Testing nonexistent product...")
        payload = {
            "reason": "Testing nonexistent product",
            "items": [
                {
                    "sku": "NONEXISTENT-999",
                    "item_id": "NONE999",
                    "product_name": "Fake Product",
                    "quantity": 10,
                    "shelf_field": "shelf_lt1",
                    "allocation_details": None
                }
            ]
        }
        
        response = requests.post(url, json=payload, headers=get_headers(), timeout=10)
        self.record(
            "Nonexistent product handled",
            response.status_code in [400, 404, 422],
            f"Status: {response.status_code}"
        )
    
    def generate_report(self):
        """Generate final test report"""
        print_header("COMPREHENSIVE TEST REPORT")
        
        total = len(self.results)
        passed = sum(1 for r in self.results if r["passed"])
        failed = total - passed
        
        print(f"\nTotal Tests: {total}")
        print(f"Passed: {passed}")
        print(f"Failed: {failed}")
        print(f"Success Rate: {(passed/total*100):.1f}%")
        
        if failed > 0:
            print("\n❌ FAILED TESTS:")
            for r in self.results:
                if not r["passed"]:
                    print(f"  - {r['desc']}: {r['details']}")
        else:
            print("\n🎉 ALL TESTS PASSED!")
        
        print("\n" + "="*80)
        print(f"Test completed at {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
        print("="*80)
        
        return failed == 0

def main():
    print("="*80)
    print("  COMPREHENSIVE SCANNER WORKFLOW E2E TEST")
    print("  Full API-based workflow simulation with isolation verification")
    print("="*80)
    print(f"Start Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n")
    
    test = WorkflowTest()
    
    # Run all test phases
    test.test_birmingham_workflow()
    test.verify_isolation_after_birmingham()
    test.test_france_workflow()
    test.verify_isolation_after_france()
    test.test_london_workflow()
    test.verify_final_isolation()
    test.test_validation_errors()
    
    # Generate report
    success = test.generate_report()
    
    return 0 if success else 1

if __name__ == "__main__":
    exit(main())
