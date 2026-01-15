"""
Frontend Code Verification Tests for Product Sourcing System
Tests that all required JavaScript functions exist in the frontend module.
Run with: python modules/inventory/sourcing/test_frontend_code.py

This test suite verifies:
1. All data loading functions exist
2. All rendering functions exist  
3. All modal/form handling functions exist
4. All utility functions exist
5. CSV import functionality exists
6. Pending price management exists
7. Margin reports functionality exists
"""
import os
import sys
from pathlib import Path

# Get the frontend file path
SCRIPT_DIR = Path(__file__).parent
FRONTEND_FILE = SCRIPT_DIR.parent.parent.parent.parent / "frontend/js/modules/inventory/sourcing.js"

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
# Data Loading Function Tests
# ============================================================

def test_data_loading_functions():
    """Test data loading functions exist"""
    print("\n📋 Test: Data Loading Functions")
    source = read_file(FRONTEND_FILE)
    
    report_test("loadInitialData()", 'async function loadInitialData()' in source)
    report_test("initializeTables()", 'async function initializeTables()' in source)
    report_test("loadSuppliers()", 'async function loadSuppliers()' in source)
    report_test("loadSupplierProducts()", 'async function loadSupplierProducts()' in source)
    report_test("loadComparison()", 'async function loadComparison()' in source)
    report_test("loadPriceHistory()", 'async function loadPriceHistory()' in source)
    report_test("loadPendingPrices()", 'async function loadPendingPrices()' in source)
    report_test("loadMargins()", 'async function loadMargins(' in source)
    report_test("loadDashboard()", 'async function loadDashboard()' in source)
    report_test("loadExchangeRates()", 'async function loadExchangeRates()' in source)


def test_api_calls():
    """Test that API calls are made to correct endpoints"""
    print("\n📋 Test: API Endpoint Calls")
    source = read_file(FRONTEND_FILE)
    
    # Health check
    report_test("Calls /health endpoint", "/v1/inventory/sourcing/health" in source)
    
    # Supplier endpoints
    report_test("Calls /suppliers endpoint", "/v1/inventory/sourcing/suppliers" in source)
    
    # Product endpoints
    report_test("Calls /products endpoint", "/v1/inventory/sourcing/products" in source)
    
    # Price endpoints
    report_test("Calls /prices endpoint", "/v1/inventory/sourcing/prices" in source)
    report_test("Calls /prices/history endpoint", "/v1/inventory/sourcing/prices/history" in source)
    report_test("Calls /prices/pending endpoint", "/v1/inventory/sourcing/prices/pending" in source)
    
    # Comparison endpoints
    report_test("Calls /comparison endpoint", "/v1/inventory/sourcing/comparison" in source)
    report_test("Calls /comparison-with-pending endpoint", "/v1/inventory/sourcing/comparison-with-pending" in source)
    
    # Margin reports
    report_test("Calls /margin-reports endpoint", "/v1/inventory/sourcing/margin-reports" in source)
    
    # Import
    report_test("Calls /import/validate endpoint", "/v1/inventory/sourcing/import/validate" in source)
    
    # Currency
    report_test("Calls /currency/rates endpoint", "/v1/inventory/sourcing/currency/rates" in source)
    
    # Available SKUs
    report_test("Calls /available-skus endpoint", "/v1/inventory/sourcing/available-skus" in source)


# ============================================================
# Rendering Function Tests
# ============================================================

def test_rendering_functions():
    """Test rendering functions exist"""
    print("\n📋 Test: Rendering Functions")
    source = read_file(FRONTEND_FILE)
    
    report_test("renderSuppliers()", 'function renderSuppliers()' in source)
    report_test("renderMappings()", 'function renderMappings(' in source)
    report_test("renderComparison()", 'function renderComparison()' in source)
    report_test("renderPriceHistory()", 'function renderPriceHistory()' in source)
    report_test("renderPendingPrices()", 'function renderPendingPrices()' in source)
    report_test("renderMarginReports()", 'function renderMarginReports()' in source)
    report_test("renderCountdown()", 'function renderCountdown(' in source)
    report_test("renderPriceStatusBadge()", 'function renderPriceStatusBadge(' in source)


# ============================================================
# Modal/Form Handling Tests
# ============================================================

def test_modal_functions():
    """Test modal functions exist"""
    print("\n📋 Test: Modal/Form Functions")
    source = read_file(FRONTEND_FILE)
    
    report_test("openAddSupplierModal()", 'function openAddSupplierModal()' in source)
    report_test("openAddMappingModal()", 'function openAddMappingModal()' in source)
    report_test("openEditMappingModal()", 'async function openEditMappingModal(' in source)
    report_test("openAddPriceModal()", 'function openAddPriceModal()' in source)
    report_test("openManualEntryModal()", 'function openManualEntryModal()' in source)
    report_test("closeModal()", 'function closeModal(' in source)


def test_form_submission_functions():
    """Test form submission functions exist"""
    print("\n📋 Test: Form Submission Functions")
    source = read_file(FRONTEND_FILE)
    
    report_test("submitSupplierForm()", 'async function submitSupplierForm()' in source)
    report_test("submitMappingForm()", 'async function submitMappingForm()' in source)
    report_test("submitPriceForm()", 'async function submitPriceForm()' in source)
    report_test("submitManualEntryForm()", 'async function submitManualEntryForm()' in source)


# ============================================================
# Pending Price Management Tests
# ============================================================

def test_pending_price_functions():
    """Test pending price functions exist"""
    print("\n📋 Test: Pending Price Management Functions")
    source = read_file(FRONTEND_FILE)
    
    report_test("cancelPendingPrice()", 'async function cancelPendingPrice(' in source)
    report_test("editPendingPrice()", 'async function editPendingPrice(' in source)
    report_test("loadPendingPrices()", 'async function loadPendingPrices()' in source)
    report_test("renderPendingPrices()", 'function renderPendingPrices()' in source)


# ============================================================
# CSV Import Tests
# ============================================================

def test_csv_import_functions():
    """Test CSV import functions exist"""
    print("\n📋 Test: CSV Import Functions")
    source = read_file(FRONTEND_FILE)
    
    report_test("startCsvImport()", 'async function startCsvImport()' in source)
    report_test("handleFileSelection()", 'function handleFileSelection(' in source)
    report_test("handleFileDrop()", 'function handleFileDrop(' in source)
    report_test("handleFileSelect()", 'function handleFileSelect(' in source)
    report_test("downloadCsvTemplate()", 'function downloadCsvTemplate()' in source)
    report_test("executeImportWithResolutions()", 'async function executeImportWithResolutions()' in source)
    report_test("showConflictModal()", 'function showConflictModal(' in source)
    report_test("resolveConflict()", 'function resolveConflict(' in source)
    report_test("showImportSummary()", 'function showImportSummary(' in source)


# ============================================================
# Utility Function Tests
# ============================================================

def test_utility_functions():
    """Test utility functions exist"""
    print("\n📋 Test: Utility Functions")
    source = read_file(FRONTEND_FILE)
    
    report_test("escapeHtml()", 'function escapeHtml(' in source)
    report_test("formatCurrency()", 'function formatCurrency(' in source)
    report_test("formatDate()", 'function formatDate(' in source)
    report_test("getDaysUntil()", 'function getDaysUntil(' in source)
    report_test("debounce()", 'function debounce(' in source)
    report_test("formatFileSize()", 'function formatFileSize(' in source)
    report_test("getMarginClass()", 'function getMarginClass(' in source)
    report_test("convertToGBP()", 'function convertToGBP(' in source)


# ============================================================
# Filter/Search Function Tests
# ============================================================

def test_filter_functions():
    """Test filter functions exist"""
    print("\n📋 Test: Filter/Search Functions")
    source = read_file(FRONTEND_FILE)
    
    report_test("filterComparison()", 'function filterComparison()' in source)
    report_test("filterMappings()", 'function filterMappings()' in source)
    report_test("filterPriceHistory()", 'function filterPriceHistory()' in source)
    report_test("searchAvailableSkus()", 'async function searchAvailableSkus(' in source)


# ============================================================
# Tab Navigation Tests
# ============================================================

def test_navigation_functions():
    """Test navigation functions exist"""
    print("\n📋 Test: Navigation Functions")
    source = read_file(FRONTEND_FILE)
    
    report_test("switchTab()", 'function switchTab(' in source)
    report_test("cacheElements()", 'function cacheElements()' in source)
    report_test("setupEventListeners()", 'function setupEventListeners()' in source)


# ============================================================
# Stats/Dashboard Tests
# ============================================================

def test_stats_functions():
    """Test stats/dashboard functions exist"""
    print("\n📋 Test: Stats/Dashboard Functions")
    source = read_file(FRONTEND_FILE)
    
    report_test("updateStats()", 'function updateStats()' in source)
    report_test("populateSupplierDropdowns()", 'function populateSupplierDropdowns()' in source)
    report_test("getMarginStatusBadge()", 'function getMarginStatusBadge(' in source)


# ============================================================
# Module Export Tests
# ============================================================

def test_module_exports():
    """Test module exports exist"""
    print("\n📋 Test: Module Exports")
    source = read_file(FRONTEND_FILE)
    
    report_test("init() exported", 'export async function init(' in source)
    report_test("cleanup() exported", 'export function cleanup()' in source)


# ============================================================
# Main Test Runner
# ============================================================

def run_all_tests():
    """Run all tests"""
    global passed, failed
    
    print("=" * 70)
    print("  FRONTEND CODE VERIFICATION - PRODUCT SOURCING MODULE")
    print("=" * 70)
    print(f"  Testing: {FRONTEND_FILE}")
    print("=" * 70)
    
    # Check file exists
    if not FRONTEND_FILE.exists():
        print(f"\n❌ Frontend file not found: {FRONTEND_FILE}")
        return False
    
    # Run all tests
    test_data_loading_functions()
    test_api_calls()
    test_rendering_functions()
    test_modal_functions()
    test_form_submission_functions()
    test_pending_price_functions()
    test_csv_import_functions()
    test_utility_functions()
    test_filter_functions()
    test_navigation_functions()
    test_stats_functions()
    test_module_exports()
    
    # Report results
    print("\n" + "=" * 70)
    print(f"  RESULTS: {passed} passed, {failed} failed")
    print("=" * 70)
    
    if errors:
        print("\n❌ Failed tests:")
        for error in errors[:10]:
            print(f"   - {error}")
        if len(errors) > 10:
            print(f"   ... and {len(errors) - 10} more")
    
    if failed == 0:
        print("\n✅ All frontend code structure tests passed!")
        print("   All required JavaScript functions are present.")
    else:
        print(f"\n⚠️  {failed} test(s) failed. Review the frontend code for missing implementations.")
    
    return failed == 0


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
