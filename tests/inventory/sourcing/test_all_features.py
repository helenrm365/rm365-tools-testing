"""
Comprehensive Code Verification Tests for Product Sourcing System
Tests all backend code structure and feature implementations via static analysis.
Run with: python modules/inventory/sourcing/test_all_features.py

This test suite verifies:
1. All API endpoints are registered
2. All service layer methods exist
3. All repository layer methods exist  
4. Correct SQL patterns for temporal pricing
5. Schema migrations are in place
6. Indexes are defined
7. CSV import functionality exists
8. Margin report functionality exists
9. Exchange rate functionality exists
"""
import os
import sys
from pathlib import Path

# Get the directory of this script
SCRIPT_DIR = Path(__file__).parent
# Reference the actual backend module directory
BACKEND_MODULE_DIR = SCRIPT_DIR.parent.parent.parent / "backend" / "modules" / "inventory" / "sourcing"
REPO_FILE = BACKEND_MODULE_DIR / "repo.py"
SERVICE_FILE = BACKEND_MODULE_DIR / "service.py"
API_FILE = BACKEND_MODULE_DIR / "api.py"
SCHEMAS_FILE = BACKEND_MODULE_DIR / "schemas.py"


def read_file(filepath):
    """Read a file and return its contents"""
    with open(filepath, 'r', encoding='utf-8') as f:
        return f.read()


passed = 0
failed = 0
errors = []


def report_test(name, success, details=""):
    """Report test result"""
    global passed, failed, errors
    if success:
        passed += 1
        print(f"   ✅ {name}")
    else:
        failed += 1
        errors.append(f"{name}: {details}")
        print(f"   ❌ {name}: {details}")


# ============================================================
# API Endpoint Tests
# ============================================================

def test_health_endpoints():
    """Test health check endpoints are defined"""
    print("\n📋 Test: Health Check Endpoints")
    source = read_file(API_FILE)
    
    report_test("GET /health endpoint", '@router.get("/health")' in source)
    report_test("POST /init-tables endpoint", '@router.post("/init-tables")' in source)


def test_supplier_endpoints():
    """Test supplier CRUD endpoints are defined"""
    print("\n📋 Test: Supplier CRUD Endpoints")
    source = read_file(API_FILE)
    
    report_test("GET /suppliers endpoint", '@router.get("/suppliers"' in source)
    report_test("POST /suppliers endpoint", '@router.post("/suppliers"' in source)
    report_test("GET /suppliers/{id} endpoint", '@router.get("/suppliers/{supplier_id}"' in source)
    report_test("PATCH /suppliers/{id} endpoint", '@router.patch("/suppliers/{supplier_id}"' in source)


def test_product_endpoints():
    """Test product mapping endpoints are defined"""
    print("\n📋 Test: Product Mapping Endpoints")
    source = read_file(API_FILE)
    
    report_test("GET /products endpoint", '@router.get("/products"' in source)
    report_test("POST /products endpoint", '@router.post("/products"' in source)
    report_test("PATCH /products/{id} endpoint", '@router.patch("/products/{product_id}"' in source)


def test_price_endpoints():
    """Test price management endpoints are defined"""
    print("\n📋 Test: Price Management Endpoints")
    source = read_file(API_FILE)
    
    report_test("GET /prices endpoint", '@router.get("/prices")' in source)
    report_test("POST /prices endpoint", '@router.post("/prices"' in source)
    report_test("GET /prices/history endpoint", '@router.get("/prices/history")' in source)
    report_test("GET /prices/pending endpoint", '@router.get("/prices/pending")' in source)
    report_test("GET /prices/{id} endpoint", '@router.get("/prices/{price_id}")' in source)
    report_test("PUT /prices/{id} endpoint", '@router.put("/prices/{price_id}")' in source)
    report_test("POST /prices/{id}/cancel endpoint", '@router.post("/prices/{price_id}/cancel")' in source)
    report_test("GET /prices/active/{id} endpoint", '@router.get("/prices/active/{supplier_product_id}")' in source)


def test_comparison_endpoints():
    """Test supplier comparison endpoints are defined"""
    print("\n📋 Test: Supplier Comparison Endpoints")
    source = read_file(API_FILE)
    
    report_test("GET /comparison endpoint", '@router.get("/comparison")' in source)
    report_test("GET /comparison-with-inventory endpoint", '@router.get("/comparison-with-inventory")' in source)
    report_test("GET /comparison-with-pending endpoint", '@router.get("/comparison-with-pending")' in source)


def test_margin_endpoints():
    """Test margin report endpoints are defined"""
    print("\n📋 Test: Margin Report Endpoints")
    source = read_file(API_FILE)
    
    report_test("GET /margin-reports endpoint", '@router.get("/margin-reports")' in source)
    report_test("Supports report_type parameter", 'report_type' in source and 'low_margin' in source)


def test_import_endpoints():
    """Test CSV import endpoints are defined"""
    print("\n📋 Test: CSV Import Endpoints")
    source = read_file(API_FILE)
    
    report_test("POST /import/validate endpoint", '@router.post("/import/validate")' in source)
    report_test("POST /import/execute endpoint", '@router.post("/import/execute")' in source)
    report_test("POST /import/csv endpoint", '@router.post("/import/csv")' in source)
    report_test("POST /import/manual endpoint", '@router.post("/import/manual")' in source)


def test_sync_log_endpoints():
    """Test price sync log endpoints are defined"""
    print("\n📋 Test: Price Sync Log Endpoints")
    source = read_file(API_FILE)
    
    report_test("GET /sync-logs endpoint", '@router.get("/sync-logs")' in source)
    report_test("POST /sync-logs/trigger-daily-activation endpoint", '@router.post("/sync-logs/trigger-daily-activation")' in source)


def test_utility_endpoints():
    """Test utility endpoints are defined"""
    print("\n📋 Test: Utility Endpoints")
    source = read_file(API_FILE)
    
    report_test("GET /available-skus endpoint", '@router.get("/available-skus")' in source)
    report_test("GET /currency/rates endpoint", '@router.get("/currency/rates")' in source)


# ============================================================
# Service Layer Tests
# ============================================================

def test_service_supplier_methods():
    """Test supplier service methods exist"""
    print("\n📋 Test: Service Layer - Supplier Methods")
    source = read_file(SERVICE_FILE)
    
    report_test("get_suppliers() method", 'def get_suppliers(' in source)
    report_test("get_supplier() method", 'def get_supplier(' in source)
    report_test("create_supplier() method", 'def create_supplier(' in source)
    report_test("update_supplier() method", 'def update_supplier(' in source)


def test_service_product_methods():
    """Test product mapping service methods exist"""
    print("\n📋 Test: Service Layer - Product Methods")
    source = read_file(SERVICE_FILE)
    
    report_test("get_supplier_products() method", 'def get_supplier_products(' in source)
    report_test("create_supplier_product() method", 'def create_supplier_product(' in source)
    report_test("update_supplier_product() method", 'def update_supplier_product(' in source)


def test_service_price_methods():
    """Test price management service methods exist"""
    print("\n📋 Test: Service Layer - Price Methods")
    source = read_file(SERVICE_FILE)
    
    report_test("get_price_history() method", 'def get_price_history(' in source)
    report_test("create_price() method", 'def create_price(' in source)
    report_test("get_active_price() method", 'def get_active_price(' in source)
    report_test("get_pending_prices() method", 'def get_pending_prices(' in source)
    report_test("cancel_pending_price() method", 'def cancel_pending_price(' in source)
    report_test("update_pending_price() method", 'def update_pending_price(' in source)
    report_test("get_price_with_computed_status() method", 'def get_price_with_computed_status(' in source)


def test_service_comparison_methods():
    """Test comparison service methods exist"""
    print("\n📋 Test: Service Layer - Comparison Methods")
    source = read_file(SERVICE_FILE)
    
    report_test("get_supplier_comparison() method", 'def get_supplier_comparison(' in source)
    report_test("get_comparison_with_inventory() method", 'def get_comparison_with_inventory(' in source)
    report_test("get_comparison_with_pending_prices() method", 'def get_comparison_with_pending_prices(' in source)


def test_service_margin_methods():
    """Test margin report service methods exist"""
    print("\n📋 Test: Service Layer - Margin Methods")
    source = read_file(SERVICE_FILE)
    
    report_test("get_margin_report() method", 'def get_margin_report(' in source)


def test_service_import_methods():
    """Test CSV import service methods exist"""
    print("\n📋 Test: Service Layer - Import Methods")
    source = read_file(SERVICE_FILE)
    
    report_test("validate_csv_import() method", 'def validate_csv_import(' in source)
    report_test("create_import_batch() method", 'def create_import_batch(' in source)
    report_test("process_csv_import() method", 'def process_csv_import(' in source)


def test_service_sync_methods():
    """Test sync log service methods exist"""
    print("\n📋 Test: Service Layer - Sync Methods")
    source = read_file(SERVICE_FILE)
    
    report_test("get_price_sync_logs() method", 'def get_price_sync_logs(' in source)
    report_test("activate_prices_for_today() method", 'def activate_prices_for_today(' in source)


# ============================================================
# Repository Layer Tests
# ============================================================

def test_repo_table_creation():
    """Test table creation logic exists"""
    print("\n📋 Test: Repository Layer - Table Creation")
    source = read_file(REPO_FILE)
    
    report_test("ensure_tables_exist() function", 'def ensure_tables_exist(' in source)
    report_test("_create_tables() function", 'def _create_tables(' in source)
    report_test("sourcing_suppliers table creation", 'sourcing_suppliers' in source)
    report_test("sourcing_supplier_products table creation", 'sourcing_supplier_products' in source)
    report_test("sourcing_prices table creation", 'sourcing_prices' in source)
    report_test("sourcing_import_batches table creation", 'sourcing_import_batches' in source)


def test_repo_temporal_pricing_logic():
    """Test temporal pricing SQL logic"""
    print("\n📋 Test: Repository Layer - Temporal Pricing SQL")
    source = read_file(REPO_FILE)
    
    # Check active price logic
    report_test(
        "Active price uses effective_date <= CURRENT_DATE",
        'effective_date <= CURRENT_DATE' in source
    )
    report_test(
        "Active price excludes cancelled",
        "status != 'cancelled'" in source or "status IS NULL OR status != 'cancelled'" in source
    )
    
    # Check pending price logic
    report_test(
        "Pending price uses effective_date > CURRENT_DATE",
        'effective_date > CURRENT_DATE' in source
    )


def test_repo_computed_status():
    """Test computed status CASE statement exists"""
    print("\n📋 Test: Repository Layer - Computed Status")
    source = read_file(REPO_FILE)
    
    report_test("CASE statement for computed_status", 'CASE' in source and 'computed_status' in source)
    report_test("Status 'pending' in CASE", "'pending'" in source)
    report_test("Status 'active' in CASE", "'active'" in source)
    report_test("Status 'superseded' in CASE", "'superseded'" in source)
    report_test("Status 'cancelled' in CASE", "'cancelled'" in source)


def test_repo_indexes():
    """Test database indexes are defined"""
    print("\n📋 Test: Repository Layer - Database Indexes")
    source = read_file(REPO_FILE)
    
    report_test(
        "Index on effective_date",
        'idx_sourcing_prices_effective_date' in source
    )
    report_test(
        "Index on supplier_product_id",
        'idx_sourcing_supplier_products_supplier_id' in source or 'idx_sourcing_prices_supplier_product_id' in source
    )


def test_repo_schema_migration():
    """Test schema migration for status column"""
    print("\n📋 Test: Repository Layer - Schema Migration")
    source = read_file(REPO_FILE)
    
    report_test(
        "Status column migration check",
        "column_name = 'status'" in source
    )
    report_test(
        "ALTER TABLE for status column",
        'ALTER TABLE' in source and 'sourcing_prices' in source
    )


# ============================================================
# Schema Tests
# ============================================================

def test_pydantic_schemas():
    """Test Pydantic schemas are defined"""
    print("\n📋 Test: Pydantic Schemas")
    source = read_file(SCHEMAS_FILE)
    
    report_test("SupplierCreateIn schema", 'class SupplierCreateIn' in source)
    report_test("SupplierUpdateIn schema", 'class SupplierUpdateIn' in source)
    report_test("SupplierOut schema", 'class SupplierOut' in source)
    report_test("SupplierProductCreateIn schema", 'class SupplierProductCreateIn' in source)
    report_test("SupplierProductUpdateIn schema", 'class SupplierProductUpdateIn' in source)
    report_test("SupplierProductOut schema", 'class SupplierProductOut' in source)
    report_test("SupplierPriceCreateIn schema", 'class SupplierPriceCreateIn' in source)
    report_test("SupplierPriceOut schema", 'class SupplierPriceOut' in source)


# ============================================================
# Main Test Runner
# ============================================================

def run_all_tests():
    """Run all tests"""
    global passed, failed
    
    print("=" * 70)
    print("  PRODUCT SOURCING SYSTEM - COMPREHENSIVE CODE VERIFICATION")
    print("=" * 70)
    
    # API Endpoint Tests
    test_health_endpoints()
    test_supplier_endpoints()
    test_product_endpoints()
    test_price_endpoints()
    test_comparison_endpoints()
    test_margin_endpoints()
    test_import_endpoints()
    test_sync_log_endpoints()
    test_utility_endpoints()
    
    # Service Layer Tests
    test_service_supplier_methods()
    test_service_product_methods()
    test_service_price_methods()
    test_service_comparison_methods()
    test_service_margin_methods()
    test_service_import_methods()
    test_service_sync_methods()
    
    # Repository Layer Tests
    test_repo_table_creation()
    test_repo_temporal_pricing_logic()
    test_repo_computed_status()
    test_repo_indexes()
    test_repo_schema_migration()
    
    # Schema Tests
    test_pydantic_schemas()
    
    # Report results
    print("\n" + "=" * 70)
    print(f"  RESULTS: {passed} passed, {failed} failed")
    print("=" * 70)
    
    if errors:
        print("\n❌ Failed tests:")
        for error in errors[:10]:  # Show first 10 errors
            print(f"   - {error}")
        if len(errors) > 10:
            print(f"   ... and {len(errors) - 10} more")
    
    if failed == 0:
        print("\n✅ All code structure tests passed!")
        print("   All API endpoints, service methods, and repository functions are present.")
    else:
        print(f"\n⚠️  {failed} test(s) failed. Review the code for missing implementations.")
    
    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
