"""
Comprehensive Test Suite for Product Sourcing System
Tests all backend API features including:
- Supplier CRUD operations
- Product mapping CRUD operations
- Price management (active, pending, cancelled)
- Price history with computed status
- Supplier comparison
- Margin reports
- CSV import validation
- Exchange rate handling

Run with: python modules/inventory/sourcing/test_sourcing_features.py
"""
import os
import sys
import json
from pathlib import Path
from datetime import date, timedelta
from decimal import Decimal
import requests

# Configuration
BASE_URL = os.getenv("API_BASE_URL", "http://localhost:8000/api")
USERNAME = os.getenv("TEST_USERNAME", "superadmin")
PASSWORD = os.getenv("TEST_PASSWORD", "admin123")

# Track test results
passed = 0
failed = 0
skipped = 0
errors = []

# Store IDs for cleanup
created_supplier_id = None
created_product_id = None
created_price_id = None
pending_price_id = None


def get_auth_token():
    """Get authentication token"""
    try:
        response = requests.post(
            f"{BASE_URL}/v1/auth/login",
            json={"username": USERNAME, "password": PASSWORD}
        )
        if response.status_code == 200:
            return response.json().get("access_token")
        return None
    except Exception as e:
        print(f"   ❌ Auth error: {e}")
        return None


def api_get(endpoint, token, params=None):
    """Make authenticated GET request"""
    headers = {"Authorization": f"Bearer {token}"}
    return requests.get(f"{BASE_URL}{endpoint}", headers=headers, params=params)


def api_post(endpoint, token, data=None, files=None):
    """Make authenticated POST request"""
    headers = {"Authorization": f"Bearer {token}"}
    if files:
        return requests.post(f"{BASE_URL}{endpoint}", headers=headers, data=data, files=files)
    return requests.post(f"{BASE_URL}{endpoint}", headers=headers, json=data)


def api_patch(endpoint, token, data=None):
    """Make authenticated PATCH request"""
    headers = {"Authorization": f"Bearer {token}"}
    return requests.patch(f"{BASE_URL}{endpoint}", headers=headers, json=data)


def api_put(endpoint, token, data=None):
    """Make authenticated PUT request"""
    headers = {"Authorization": f"Bearer {token}"}
    return requests.put(f"{BASE_URL}{endpoint}", headers=headers, json=data)


def report_test(name, success, message=""):
    """Report test result"""
    global passed, failed, errors
    if success:
        passed += 1
        print(f"   ✅ {name}")
    else:
        failed += 1
        errors.append(f"{name}: {message}")
        print(f"   ❌ {name}: {message}")


def report_skip(name, reason=""):
    """Report skipped test"""
    global skipped
    skipped += 1
    print(f"   ⏭️  {name} (skipped: {reason})")


# ============================================================
# Test Sections
# ============================================================

def test_health_check(token):
    """Test health endpoint and table initialization"""
    print("\n📋 Test: Health Check & Table Initialization")
    
    # Health check should work without auth too
    response = requests.get(f"{BASE_URL}/v1/inventory/sourcing/health")
    report_test(
        "Health check endpoint accessible",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    if response.status_code == 200:
        data = response.json()
        report_test(
            "Tables initialized",
            data.get("tables") == "initialized",
            f"Response: {data}"
        )
    
    # Auth-protected init-tables
    response = api_post("/v1/inventory/sourcing/init-tables", token)
    report_test(
        "Init tables with auth",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )


def test_supplier_crud(token):
    """Test supplier CRUD operations"""
    global created_supplier_id
    print("\n📋 Test: Supplier CRUD Operations")
    
    # Create supplier
    supplier_data = {
        "name": f"Test Supplier {date.today().isoformat()}",
        "code": "TEST001",
        "contact_email": "test@supplier.com",
        "contact_phone": "+1234567890",
        "website": "https://testsupplier.com",
        "notes": "Created by automated tests",
        "is_active": True
    }
    
    response = api_post("/v1/inventory/sourcing/suppliers", token, supplier_data)
    report_test(
        "Create supplier",
        response.status_code == 200,
        f"Status: {response.status_code}, Response: {response.text[:200]}"
    )
    
    if response.status_code == 200:
        created_supplier_id = response.json().get("id")
        report_test(
            "Supplier has ID",
            created_supplier_id is not None,
            "No ID returned"
        )
    
    # Get all suppliers
    response = api_get("/v1/inventory/sourcing/suppliers", token)
    report_test(
        "Get all suppliers",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    if response.status_code == 200:
        suppliers = response.json()
        report_test(
            "Suppliers list is array",
            isinstance(suppliers, list),
            f"Type: {type(suppliers)}"
        )
        
        # Check our created supplier is in the list
        if created_supplier_id:
            found = any(s.get("id") == created_supplier_id for s in suppliers)
            report_test(
                "Created supplier in list",
                found,
                "Supplier not found in list"
            )
    
    # Get single supplier
    if created_supplier_id:
        response = api_get(f"/v1/inventory/sourcing/suppliers/{created_supplier_id}", token)
        report_test(
            "Get single supplier",
            response.status_code == 200,
            f"Status: {response.status_code}"
        )
        
        if response.status_code == 200:
            supplier = response.json()
            report_test(
                "Supplier name matches",
                supplier.get("name") == supplier_data["name"],
                f"Expected: {supplier_data['name']}, Got: {supplier.get('name')}"
            )
    
    # Update supplier
    if created_supplier_id:
        update_data = {"notes": "Updated by automated tests", "code": "TEST001-UPD"}
        response = api_patch(f"/v1/inventory/sourcing/suppliers/{created_supplier_id}", token, update_data)
        report_test(
            "Update supplier",
            response.status_code == 200,
            f"Status: {response.status_code}"
        )
        
        if response.status_code == 200:
            updated = response.json()
            report_test(
                "Update applied",
                updated.get("code") == "TEST001-UPD",
                f"Got: {updated.get('code')}"
            )
    
    # Deactivate supplier
    if created_supplier_id:
        response = api_patch(
            f"/v1/inventory/sourcing/suppliers/{created_supplier_id}", 
            token, 
            {"is_active": False}
        )
        report_test(
            "Deactivate supplier",
            response.status_code == 200,
            f"Status: {response.status_code}"
        )
    
    # Get suppliers including inactive
    response = api_get("/v1/inventory/sourcing/suppliers", token, {"include_inactive": "true"})
    report_test(
        "Get suppliers with inactive",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    # Reactivate for further tests
    if created_supplier_id:
        api_patch(
            f"/v1/inventory/sourcing/suppliers/{created_supplier_id}", 
            token, 
            {"is_active": True}
        )


def test_product_mapping_crud(token):
    """Test supplier product mapping CRUD operations"""
    global created_product_id
    print("\n📋 Test: Product Mapping CRUD Operations")
    
    if not created_supplier_id:
        report_skip("Product mapping tests", "No supplier created")
        return
    
    # Create product mapping
    product_data = {
        "supplier_id": created_supplier_id,
        "supplier_sku": f"SKU-TEST-{date.today().isoformat()}",
        "supplier_product_name": "Test Product From Supplier",
        "internal_sku": "TEST-INTERNAL-SKU",
        "pack_size": 1,
        "notes": "Created by automated tests",
        "is_active": True
    }
    
    response = api_post("/v1/inventory/sourcing/products", token, product_data)
    report_test(
        "Create product mapping",
        response.status_code == 200,
        f"Status: {response.status_code}, Response: {response.text[:200]}"
    )
    
    if response.status_code == 200:
        created_product_id = response.json().get("id")
        report_test(
            "Product mapping has ID",
            created_product_id is not None,
            "No ID returned"
        )
    
    # Get all product mappings
    response = api_get("/v1/inventory/sourcing/products", token)
    report_test(
        "Get all product mappings",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    if response.status_code == 200:
        products = response.json()
        report_test(
            "Products list is array",
            isinstance(products, list),
            f"Type: {type(products)}"
        )
    
    # Filter by supplier
    response = api_get("/v1/inventory/sourcing/products", token, {"supplier_id": created_supplier_id})
    report_test(
        "Filter products by supplier",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    # Update product mapping
    if created_product_id:
        update_data = {"pack_size": 10, "notes": "Updated pack size"}
        response = api_patch(f"/v1/inventory/sourcing/products/{created_product_id}", token, update_data)
        report_test(
            "Update product mapping",
            response.status_code == 200,
            f"Status: {response.status_code}"
        )
        
        if response.status_code == 200:
            updated = response.json()
            report_test(
                "Pack size updated",
                updated.get("pack_size") == 10,
                f"Got: {updated.get('pack_size')}"
            )


def test_price_management(token):
    """Test price CRUD and status management"""
    global created_price_id, pending_price_id
    print("\n📋 Test: Price Management")
    
    if not created_product_id:
        report_skip("Price management tests", "No product mapping created")
        return
    
    # Create active price (today's date)
    today = date.today().isoformat()
    price_data = {
        "supplier_product_id": created_product_id,
        "buy_price": 25.50,
        "currency": "GBP",
        "effective_date": today,
        "notes": "Active price from automated tests"
    }
    
    response = api_post("/v1/inventory/sourcing/prices", token, price_data)
    report_test(
        "Create active price",
        response.status_code == 200,
        f"Status: {response.status_code}, Response: {response.text[:200]}"
    )
    
    if response.status_code == 200:
        created_price_id = response.json().get("id")
        report_test(
            "Price has ID",
            created_price_id is not None,
            "No ID returned"
        )
    
    # Create pending price (future date)
    tomorrow = (date.today() + timedelta(days=1)).isoformat()
    pending_price_data = {
        "supplier_product_id": created_product_id,
        "buy_price": 23.00,
        "currency": "GBP",
        "effective_date": tomorrow,
        "notes": "Pending price from automated tests"
    }
    
    response = api_post("/v1/inventory/sourcing/prices", token, pending_price_data)
    report_test(
        "Create pending price",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    if response.status_code == 200:
        pending_price_id = response.json().get("id")
    
    # Get price with computed status
    if created_price_id:
        response = api_get(f"/v1/inventory/sourcing/prices/{created_price_id}", token)
        report_test(
            "Get price with computed status",
            response.status_code == 200,
            f"Status: {response.status_code}"
        )
        
        if response.status_code == 200:
            price = response.json()
            report_test(
                "Active price has active status",
                price.get("computed_status") == "active",
                f"Got: {price.get('computed_status')}"
            )
    
    # Verify pending price status
    if pending_price_id:
        response = api_get(f"/v1/inventory/sourcing/prices/{pending_price_id}", token)
        if response.status_code == 200:
            price = response.json()
            report_test(
                "Future price has pending status",
                price.get("computed_status") == "pending",
                f"Got: {price.get('computed_status')}"
            )
    
    # Get active price for product
    response = api_get(f"/v1/inventory/sourcing/prices/active/{created_product_id}", token)
    report_test(
        "Get active price for product",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    if response.status_code == 200:
        active = response.json()
        report_test(
            "Active price is today's price",
            float(active.get("buy_price", 0)) == 25.50,
            f"Got: {active.get('buy_price')}"
        )


def test_pending_prices(token):
    """Test pending price management"""
    print("\n📋 Test: Pending Price Management")
    
    if not pending_price_id:
        report_skip("Pending price tests", "No pending price created")
        return
    
    # Get pending prices
    response = api_get("/v1/inventory/sourcing/prices/pending", token)
    report_test(
        "Get pending prices list",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    if response.status_code == 200:
        data = response.json()
        report_test(
            "Pending prices has count",
            "count" in data,
            f"Keys: {data.keys()}"
        )
        
        pending_list = data.get("pending_prices", [])
        found = any(p.get("id") == pending_price_id for p in pending_list)
        report_test(
            "Our pending price in list",
            found,
            "Pending price not found in list"
        )
    
    # Filter pending by supplier
    if created_supplier_id:
        response = api_get(
            "/v1/inventory/sourcing/prices/pending", 
            token, 
            {"supplier_id": created_supplier_id}
        )
        report_test(
            "Filter pending by supplier",
            response.status_code == 200,
            f"Status: {response.status_code}"
        )
    
    # Update pending price
    next_week = (date.today() + timedelta(days=7)).isoformat()
    update_data = {
        "supplier_product_id": created_product_id,
        "buy_price": 22.00,
        "currency": "GBP",
        "effective_date": next_week,
        "notes": "Updated pending price"
    }
    
    response = api_put(f"/v1/inventory/sourcing/prices/{pending_price_id}", token, update_data)
    report_test(
        "Update pending price",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    # Try to update active price (should fail)
    if created_price_id:
        response = api_put(f"/v1/inventory/sourcing/prices/{created_price_id}", token, update_data)
        report_test(
            "Cannot update active price",
            response.status_code == 400,
            f"Got status: {response.status_code} (expected 400)"
        )


def test_cancel_pending_price(token):
    """Test cancelling pending prices"""
    print("\n📋 Test: Cancel Pending Price")
    
    if not created_product_id:
        report_skip("Cancel price tests", "No product created")
        return
    
    # Create a new pending price to cancel
    next_week = (date.today() + timedelta(days=7)).isoformat()
    price_data = {
        "supplier_product_id": created_product_id,
        "buy_price": 99.99,
        "currency": "GBP",
        "effective_date": next_week,
        "notes": "Price to be cancelled"
    }
    
    response = api_post("/v1/inventory/sourcing/prices", token, price_data)
    if response.status_code != 200:
        report_skip("Cancel pending price", "Failed to create test price")
        return
    
    cancel_price_id = response.json().get("id")
    
    # Cancel the pending price
    response = api_post(f"/v1/inventory/sourcing/prices/{cancel_price_id}/cancel", token)
    report_test(
        "Cancel pending price",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    # Verify it's cancelled
    response = api_get(f"/v1/inventory/sourcing/prices/{cancel_price_id}", token)
    if response.status_code == 200:
        price = response.json()
        report_test(
            "Cancelled price has cancelled status",
            price.get("computed_status") == "cancelled",
            f"Got: {price.get('computed_status')}"
        )
    
    # Try to cancel active price (should fail)
    if created_price_id:
        response = api_post(f"/v1/inventory/sourcing/prices/{created_price_id}/cancel", token)
        report_test(
            "Cannot cancel active price",
            response.status_code == 400,
            f"Got status: {response.status_code} (expected 400)"
        )


def test_price_history(token):
    """Test price history retrieval"""
    print("\n📋 Test: Price History")
    
    # Get all price history
    response = api_get("/v1/inventory/sourcing/prices/history", token)
    report_test(
        "Get price history",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    if response.status_code == 200:
        data = response.json()
        report_test(
            "History has prices key",
            "prices" in data,
            f"Keys: {data.keys()}"
        )
        
        prices = data.get("prices", [])
        if prices:
            # Check computed_status exists
            first_price = prices[0]
            report_test(
                "Prices have computed_status",
                "computed_status" in first_price,
                f"Keys: {first_price.keys()}"
            )
    
    # Filter by supplier product
    if created_product_id:
        response = api_get(
            "/v1/inventory/sourcing/prices/history", 
            token, 
            {"supplier_product_id": created_product_id}
        )
        report_test(
            "Filter history by product",
            response.status_code == 200,
            f"Status: {response.status_code}"
        )


def test_supplier_comparison(token):
    """Test supplier comparison features"""
    print("\n📋 Test: Supplier Comparison")
    
    # Basic comparison
    response = api_get("/v1/inventory/sourcing/comparison", token)
    report_test(
        "Get supplier comparison",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    if response.status_code == 200:
        data = response.json()
        report_test(
            "Comparison has products key",
            "products" in data,
            f"Keys: {data.keys()}"
        )
    
    # Comparison with inventory
    response = api_get("/v1/inventory/sourcing/comparison-with-inventory", token)
    report_test(
        "Get comparison with inventory",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    # Comparison with pending prices
    response = api_get("/v1/inventory/sourcing/comparison-with-pending", token)
    report_test(
        "Get comparison with pending prices",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )


def test_margin_reports(token):
    """Test margin report features"""
    print("\n📋 Test: Margin Reports")
    
    # All products margin report
    response = api_get("/v1/inventory/sourcing/margin-reports", token)
    report_test(
        "Get all margin reports",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    # Low margin report
    response = api_get("/v1/inventory/sourcing/margin-reports", token, {"report_type": "low_margin"})
    report_test(
        "Get low margin report",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    # High margin report
    response = api_get("/v1/inventory/sourcing/margin-reports", token, {"report_type": "high_margin"})
    report_test(
        "Get high margin report",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    # Negative margin report
    response = api_get("/v1/inventory/sourcing/margin-reports", token, {"report_type": "negative_margin"})
    report_test(
        "Get negative margin report",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    # With margin filters
    response = api_get(
        "/v1/inventory/sourcing/margin-reports", 
        token, 
        {"min_margin": 10, "max_margin": 50}
    )
    report_test(
        "Filter by margin range",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )


def test_exchange_rates(token):
    """Test currency exchange rate features"""
    print("\n📋 Test: Exchange Rates")
    
    response = api_get("/v1/inventory/sourcing/currency/rates", token)
    report_test(
        "Get exchange rates",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    if response.status_code == 200:
        data = response.json()
        report_test(
            "Has base currency",
            data.get("base") == "GBP",
            f"Got: {data.get('base')}"
        )
        
        report_test(
            "Has rates object",
            "rates" in data,
            f"Keys: {data.keys()}"
        )
        
        rates = data.get("rates", {})
        report_test(
            "Has EUR rate",
            "EUR" in rates,
            f"Rate keys: {rates.keys()}"
        )
        
        report_test(
            "Has USD rate",
            "USD" in rates,
            f"Rate keys: {rates.keys()}"
        )


def test_available_skus(token):
    """Test available SKUs from inventory"""
    print("\n📋 Test: Available SKUs")
    
    response = api_get("/v1/inventory/sourcing/available-skus", token)
    report_test(
        "Get available SKUs",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    if response.status_code == 200:
        data = response.json()
        report_test(
            "Has skus key",
            "skus" in data,
            f"Keys: {data.keys()}"
        )
        
        report_test(
            "Has count",
            "count" in data,
            f"Keys: {data.keys()}"
        )
    
    # Search available SKUs
    response = api_get("/v1/inventory/sourcing/available-skus", token, {"search": "test", "limit": 10})
    report_test(
        "Search available SKUs",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )


def test_sync_logs(token):
    """Test price sync log features"""
    print("\n📋 Test: Price Sync Logs")
    
    response = api_get("/v1/inventory/sourcing/sync-logs", token)
    report_test(
        "Get sync logs",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )
    
    if response.status_code == 200:
        data = response.json()
        report_test(
            "Has logs key",
            "logs" in data,
            f"Keys: {data.keys()}"
        )
        
        report_test(
            "Has count",
            "count" in data,
            f"Keys: {data.keys()}"
        )
    
    # Trigger daily activation
    response = api_post("/v1/inventory/sourcing/sync-logs/trigger-daily-activation", token)
    report_test(
        "Trigger daily activation",
        response.status_code == 200,
        f"Status: {response.status_code}"
    )


def test_csv_import_validation(token):
    """Test CSV import validation features"""
    print("\n📋 Test: CSV Import Validation")
    
    if not created_supplier_id:
        report_skip("CSV import tests", "No supplier created")
        return
    
    # Create a test CSV
    csv_content = """supplier_sku,buy_price,currency,internal_sku,product_name
CSV-SKU-001,15.99,GBP,TEST-INT-001,Test Product 1
CSV-SKU-002,25.50,EUR,TEST-INT-002,Test Product 2
CSV-SKU-003,invalid,GBP,TEST-INT-003,Test Product 3
"""
    
    import io
    files = {"file": ("test_import.csv", io.BytesIO(csv_content.encode()), "text/csv")}
    data = {"supplier_id": str(created_supplier_id)}
    
    response = api_post("/v1/inventory/sourcing/import/validate", token, data=data, files=files)
    report_test(
        "CSV validation endpoint",
        response.status_code == 200 or response.status_code == 400,  # 400 for validation errors is ok
        f"Status: {response.status_code}"
    )
    
    if response.status_code == 200:
        result = response.json()
        report_test(
            "Validation has valid_rows",
            "valid_rows" in result or "conflicts" in result,
            f"Keys: {result.keys()}"
        )


def cleanup_test_data(token):
    """Clean up test data"""
    print("\n🧹 Cleanup: Removing test data")
    
    # Note: In a real test, we'd delete the created resources
    # But since the API may not have DELETE endpoints, we'll just deactivate
    
    if created_supplier_id:
        api_patch(
            f"/v1/inventory/sourcing/suppliers/{created_supplier_id}",
            token,
            {"is_active": False, "notes": "Deactivated by automated tests"}
        )
        print(f"   ℹ️  Deactivated supplier {created_supplier_id}")
    
    if created_product_id:
        api_patch(
            f"/v1/inventory/sourcing/products/{created_product_id}",
            token,
            {"is_active": False}
        )
        print(f"   ℹ️  Deactivated product mapping {created_product_id}")


def main():
    """Run all tests"""
    print("=" * 60)
    print("  PRODUCT SOURCING SYSTEM - COMPREHENSIVE FEATURE TESTS")
    print("=" * 60)
    
    # Check if server is running
    try:
        response = requests.get(f"{BASE_URL}/v1/inventory/sourcing/health", timeout=5)
        if response.status_code != 200:
            print(f"\n❌ Server not responding correctly at {BASE_URL}")
            print("   Please start the backend server first:")
            print("   cd backend && python app.py")
            return
    except requests.exceptions.ConnectionError:
        print(f"\n❌ Cannot connect to server at {BASE_URL}")
        print("   Please start the backend server first:")
        print("   cd backend && python app.py")
        return
    except Exception as e:
        print(f"\n❌ Error connecting to server: {e}")
        return
    
    # Get auth token
    print("\n🔐 Authenticating...")
    token = get_auth_token()
    if not token:
        print("❌ Authentication failed. Check credentials.")
        print(f"   Username: {USERNAME}")
        print(f"   API URL: {BASE_URL}")
        return
    
    print("✅ Authentication successful")
    
    # Run tests
    try:
        test_health_check(token)
        test_supplier_crud(token)
        test_product_mapping_crud(token)
        test_price_management(token)
        test_pending_prices(token)
        test_cancel_pending_price(token)
        test_price_history(token)
        test_supplier_comparison(token)
        test_margin_reports(token)
        test_exchange_rates(token)
        test_available_skus(token)
        test_sync_logs(token)
        test_csv_import_validation(token)
    finally:
        cleanup_test_data(token)
    
    # Report results
    print("\n" + "=" * 60)
    print(f"  RESULTS: {passed} passed, {failed} failed, {skipped} skipped")
    print("=" * 60)
    
    if errors:
        print("\n❌ Failed tests:")
        for error in errors:
            print(f"   - {error}")
    
    if failed == 0:
        print("\n✅ All tests passed!")
    else:
        print(f"\n⚠️  {failed} test(s) failed")
        sys.exit(1)


if __name__ == "__main__":
    main()
