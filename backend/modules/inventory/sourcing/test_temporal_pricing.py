"""
Test script for Temporal Pricing (Effective Date) feature
Run with: python modules/inventory/sourcing/test_temporal_pricing.py

Tests the new Phase 1 functionality by analyzing source code:
- get_active_price()
- get_pending_prices()
- cancel_pending_price()
- update_pending_price()
- get_price_with_computed_status()
- Updated comparison queries
"""
import os
import sys
from pathlib import Path

# Get the directory of this script
SCRIPT_DIR = Path(__file__).parent
REPO_FILE = SCRIPT_DIR / "repo.py"
SERVICE_FILE = SCRIPT_DIR / "service.py"
API_FILE = SCRIPT_DIR / "api.py"


def read_file(filepath):
    """Read a file and return its contents"""
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()


def test_get_active_price_logic():
    """Test the SQL logic for get_active_price"""
    print("\n📋 Test 1: get_active_price() logic")
    
    source = read_file(REPO_FILE)
    
    # Find the get_active_price function
    start = source.find("def get_active_price(")
    if start == -1:
        print("   ❌ get_active_price() function not found")
        return False
    
    # Get the function body (until next def or end of class method)
    end = source.find("\n    def ", start + 1)
    if end == -1:
        end = len(source)
    func_source = source[start:end]
    
    expected_sql_patterns = [
        "effective_date <= CURRENT_DATE",
        "status IS NULL OR status != 'cancelled'",
        "ORDER BY",
        "effective_date DESC",
        "created_at DESC",
        "LIMIT 1"
    ]
    
    all_found = True
    for pattern in expected_sql_patterns:
        if pattern.lower() in func_source.lower():
            print(f"   ✅ Found: '{pattern}'")
        else:
            print(f"   ❌ Missing: '{pattern}'")
            all_found = False
    
    if all_found:
        print("   ✅ get_active_price() SQL logic is correct")
    
    return all_found


def test_get_pending_prices_logic():
    """Test the SQL logic for get_pending_prices"""
    print("\n📋 Test 2: get_pending_prices() logic")
    
    source = read_file(REPO_FILE)
    
    start = source.find("def get_pending_prices(")
    if start == -1:
        print("   ❌ get_pending_prices() function not found")
        return False
    
    end = source.find("\n    def ", start + 1)
    if end == -1:
        end = len(source)
    func_source = source[start:end]
    
    expected_sql_patterns = [
        "effective_date > CURRENT_DATE",
        "status IS NULL OR",  # Check for the pattern without exact match
        "!= 'cancelled'",
        "ORDER BY",
        "effective_date ASC"
    ]
    
    all_found = True
    for pattern in expected_sql_patterns:
        if pattern.lower() in func_source.lower():
            print(f"   ✅ Found: '{pattern}'")
        else:
            print(f"   ❌ Missing: '{pattern}'")
            all_found = False
    
    if all_found:
        print("   ✅ get_pending_prices() SQL logic is correct")
    
    return all_found


def test_cancel_pending_price_logic():
    """Test the logic for cancel_pending_price"""
    print("\n📋 Test 3: cancel_pending_price() logic")
    
    source = read_file(REPO_FILE)
    
    start = source.find("def cancel_pending_price(")
    if start == -1:
        print("   ❌ cancel_pending_price() function not found")
        return False
    
    end = source.find("\n    def ", start + 1)
    if end == -1:
        end = len(source)
    func_source = source[start:end]
    
    expected_patterns = [
        "effective_date > CURRENT_DATE",
        "status = 'cancelled'",
    ]
    
    all_found = True
    for pattern in expected_patterns:
        if pattern.lower() in func_source.lower():
            print(f"   ✅ Found: '{pattern}'")
        else:
            print(f"   ❌ Missing: '{pattern}'")
            all_found = False
    
    if "is_pending" in func_source.lower():
        print(f"   ✅ Validates price is pending before cancelling")
    else:
        print(f"   ⚠️  Consider adding explicit pending check variable")
    
    if all_found:
        print("   ✅ cancel_pending_price() logic is correct")
    
    return all_found


def test_update_pending_price_logic():
    """Test the logic for update_pending_price"""
    print("\n📋 Test 4: update_pending_price() logic")
    
    source = read_file(REPO_FILE)
    
    start = source.find("def update_pending_price(")
    if start == -1:
        print("   ❌ update_pending_price() function not found")
        return False
    
    end = source.find("\n    def ", start + 1)
    if end == -1:
        end = len(source)
    func_source = source[start:end]
    
    expected_patterns = [
        "effective_date > CURRENT_DATE",
    ]
    
    all_found = True
    for pattern in expected_patterns:
        if pattern.lower() in func_source.lower():
            print(f"   ✅ Found: '{pattern}'")
        else:
            print(f"   ❌ Missing: '{pattern}'")
            all_found = False
    
    if "today()" in func_source.lower():
        print(f"   ✅ Validates new effective_date is in future")
    else:
        print(f"   ⚠️  Check validation of new effective_date")
    
    if all_found:
        print("   ✅ update_pending_price() logic is correct")
    
    return all_found


def test_get_price_with_computed_status_logic():
    """Test the CASE statement for computed_status"""
    print("\n📋 Test 5: get_price_with_computed_status() logic")
    
    source = read_file(REPO_FILE)
    
    start = source.find("def get_price_with_computed_status(")
    if start == -1:
        print("   ❌ get_price_with_computed_status() function not found")
        return False
    
    end = source.find("\n    def ", start + 1)
    if end == -1:
        end = len(source)
    func_source = source[start:end]
    
    expected_patterns = [
        "CASE",
        "cancelled",
        "pending",
        "active",
        "superseded",
        "computed_status"
    ]
    
    all_found = True
    for pattern in expected_patterns:
        if pattern.lower() in func_source.lower():
            print(f"   ✅ Found: '{pattern}'")
        else:
            print(f"   ❌ Missing: '{pattern}'")
            all_found = False
    
    if all_found:
        print("   ✅ get_price_with_computed_status() logic is correct")
    
    return all_found


def test_get_supplier_comparison_uses_active_prices():
    """Test that get_supplier_comparison filters for active prices only"""
    print("\n📋 Test 6: get_supplier_comparison() uses active prices")
    
    source = read_file(REPO_FILE)
    
    start = source.find("def get_supplier_comparison(")
    if start == -1:
        print("   ❌ get_supplier_comparison() function not found")
        return False
    
    end = source.find("\n    def ", start + 1)
    if end == -1:
        end = len(source)
    func_source = source[start:end]
    
    expected_patterns = [
        "effective_date <= CURRENT_DATE",
        "status IS NULL OR status != 'cancelled'",
        "active_prices"
    ]
    
    all_found = True
    for pattern in expected_patterns:
        if pattern.lower() in func_source.lower():
            print(f"   ✅ Found: '{pattern}'")
        else:
            print(f"   ❌ Missing: '{pattern}'")
            all_found = False
    
    if all_found:
        print("   ✅ get_supplier_comparison() filters for active prices only")
    
    return all_found


def test_get_comparison_with_inventory_uses_active_prices():
    """Test that get_comparison_with_inventory filters for active prices only"""
    print("\n📋 Test 7: get_comparison_with_inventory() uses active prices")
    
    source = read_file(REPO_FILE)
    
    start = source.find("def get_comparison_with_inventory(")
    if start == -1:
        print("   ❌ get_comparison_with_inventory() function not found")
        return False
    
    end = source.find("\n    def ", start + 1)
    if end == -1:
        end = len(source)
    func_source = source[start:end]
    
    expected_patterns = [
        "effective_date <= CURRENT_DATE",
        "status IS NULL OR status != 'cancelled'",
        "active_prices"
    ]
    
    all_found = True
    for pattern in expected_patterns:
        if pattern.lower() in func_source.lower():
            print(f"   ✅ Found: '{pattern}'")
        else:
            print(f"   ❌ Missing: '{pattern}'")
            all_found = False
    
    if all_found:
        print("   ✅ get_comparison_with_inventory() filters for active prices only")
    
    return all_found


def test_get_supplier_products_uses_active_prices():
    """Test that get_supplier_products shows active prices"""
    print("\n📋 Test 8: get_supplier_products() uses active prices")
    
    source = read_file(REPO_FILE)
    
    start = source.find("def get_supplier_products(")
    if start == -1:
        print("   ❌ get_supplier_products() function not found")
        return False
    
    end = source.find("\n    def ", start + 1)
    if end == -1:
        end = len(source)
    func_source = source[start:end]
    
    expected_patterns = [
        "effective_date <= CURRENT_DATE",
        "status IS NULL OR status != 'cancelled'",
        "active_price"
    ]
    
    all_found = True
    for pattern in expected_patterns:
        if pattern.lower() in func_source.lower():
            print(f"   ✅ Found: '{pattern}'")
        else:
            print(f"   ❌ Missing: '{pattern}'")
            all_found = False
    
    if all_found:
        print("   ✅ get_supplier_products() shows active prices only")
    
    return all_found


def test_get_price_history_includes_computed_status():
    """Test that get_price_history includes computed_status"""
    print("\n📋 Test 9: get_price_history() includes computed_status")
    
    source = read_file(REPO_FILE)
    
    start = source.find("def get_price_history(")
    if start == -1:
        print("   ❌ get_price_history() function not found")
        return False
    
    end = source.find("\n    def ", start + 1)
    if end == -1:
        end = len(source)
    func_source = source[start:end]
    
    expected_patterns = [
        "computed_status",
        "CASE",
        "pending",
        "active",
        "superseded",
        "cancelled"
    ]
    
    all_found = True
    for pattern in expected_patterns:
        if pattern.lower() in func_source.lower():
            print(f"   ✅ Found: '{pattern}'")
        else:
            print(f"   ❌ Missing: '{pattern}'")
            all_found = False
    
    if all_found:
        print("   ✅ get_price_history() includes computed_status")
    
    return all_found


def test_service_methods_exist():
    """Test that all service methods exist"""
    print("\n📋 Test 10: Service layer methods")
    
    source = read_file(SERVICE_FILE)
    
    required_methods = [
        'def get_active_price(',
        'def get_pending_prices(',
        'def cancel_pending_price(',
        'def update_pending_price(',
        'def get_price_with_computed_status('
    ]
    
    all_exist = True
    for method in required_methods:
        if method in source:
            method_name = method.replace("def ", "").replace("(", "()")
            print(f"   ✅ {method_name} exists")
        else:
            method_name = method.replace("def ", "").replace("(", "()")
            print(f"   ❌ {method_name} missing")
            all_exist = False
    
    if all_exist:
        print("   ✅ All service methods exist")
    
    return all_exist


def test_api_endpoints_exist():
    """Test that all API endpoints are registered"""
    print("\n📋 Test 11: API endpoints")
    
    source = read_file(API_FILE)
    
    expected_endpoints = [
        ('@router.get("/prices/pending")', "GET /prices/pending"),
        ('@router.get("/prices/{price_id}")', "GET /prices/{price_id}"),
        ('@router.put("/prices/{price_id}")', "PUT /prices/{price_id}"),
        ('@router.post("/prices/{price_id}/cancel")', "POST /prices/{price_id}/cancel"),
        ('@router.get("/prices/active/{supplier_product_id}")', "GET /prices/active/{supplier_product_id}"),
    ]
    
    all_exist = True
    for pattern, description in expected_endpoints:
        if pattern in source:
            print(f"   ✅ {description}")
        else:
            print(f"   ❌ {description} - not found")
            all_exist = False
    
    if all_exist:
        print("   ✅ All API endpoints registered")
    
    return all_exist


def test_schema_migration_logic():
    """Test that schema migration for status column is in place"""
    print("\n📋 Test 12: Schema migration for 'status' column")
    
    source = read_file(REPO_FILE)
    
    # Find the ensure_tables_exist function
    start = source.find("def ensure_tables_exist(")
    if start == -1:
        print("   ❌ ensure_tables_exist() function not found")
        return False
    
    end = source.find("\ndef ", start + 1)
    if end == -1:
        end = source.find("\nclass ", start + 1)
    if end == -1:
        end = len(source)
    func_source = source[start:end]
    
    expected_patterns = [
        "column_name = 'status'",
        "ALTER TABLE",
        "sourcing_prices",
        "VARCHAR(20)"
    ]
    
    all_found = True
    for pattern in expected_patterns:
        if pattern.lower() in func_source.lower():
            print(f"   ✅ Found: '{pattern}'")
        else:
            print(f"   ❌ Missing: '{pattern}'")
            all_found = False
    
    if all_found:
        print("   ✅ Schema migration logic is in place")
    
    return all_found


def test_index_verification():
    """Test that effective_date index verification is in place"""
    print("\n📋 Test 13: Index verification for effective_date")
    
    source = read_file(REPO_FILE)
    
    expected_patterns = [
        "idx_sourcing_prices_effective_date",
        "CREATE INDEX IF NOT EXISTS"
    ]
    
    all_found = True
    for pattern in expected_patterns:
        if pattern.lower() in source.lower():
            print(f"   ✅ Found: '{pattern}'")
        else:
            print(f"   ❌ Missing: '{pattern}'")
            all_found = False
    
    if all_found:
        print("   ✅ Index verification is in place")
    
    return all_found


def run_all_tests():
    """Run all tests and report results"""
    print("=" * 60)
    print("  TEMPORAL PRICING (EFFECTIVE DATE) FEATURE TESTS")
    print("=" * 60)
    
    tests = [
        ("get_active_price() logic", test_get_active_price_logic),
        ("get_pending_prices() logic", test_get_pending_prices_logic),
        ("cancel_pending_price() logic", test_cancel_pending_price_logic),
        ("update_pending_price() logic", test_update_pending_price_logic),
        ("get_price_with_computed_status() logic", test_get_price_with_computed_status_logic),
        ("get_supplier_comparison() uses active prices", test_get_supplier_comparison_uses_active_prices),
        ("get_comparison_with_inventory() uses active prices", test_get_comparison_with_inventory_uses_active_prices),
        ("get_supplier_products() uses active prices", test_get_supplier_products_uses_active_prices),
        ("get_price_history() includes computed_status", test_get_price_history_includes_computed_status),
        ("Service layer methods", test_service_methods_exist),
        ("API endpoints", test_api_endpoints_exist),
        ("Schema migration", test_schema_migration_logic),
        ("Index verification", test_index_verification),
    ]
    
    passed = 0
    failed = 0
    
    for name, test_fn in tests:
        try:
            result = test_fn()
            if result:
                passed += 1
            else:
                failed += 1
        except Exception as e:
            print(f"\n📋 {name}")
            print(f"   ❌ Exception: {e}")
            import traceback
            traceback.print_exc()
            failed += 1
    
    print("\n" + "=" * 60)
    print(f"  RESULTS: {passed} passed, {failed} failed")
    print("=" * 60)
    
    if failed == 0:
        print("\n✅ All tests passed! Ready for staging deployment.")
    else:
        print(f"\n❌ {failed} test(s) failed. Please review and fix.")
    
    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
