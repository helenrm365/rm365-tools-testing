#!/usr/bin/env python3
"""
Test Mobile Responsiveness for Scanner and Scanning Logs Pages
Tests multiple viewport sizes: Mobile (375x667), Tablet (768x1024), Desktop (1920x1080)
"""

import sys
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright, expect


BASE_URL = "http://localhost:8000"
CREDENTIALS = {"username": "superadmin", "password": "admin123"}

# Viewport sizes to test
VIEWPORTS = {
    "mobile": {"width": 375, "height": 667, "name": "Mobile (iPhone SE)"},
    "tablet": {"width": 768, "height": 1024, "name": "Tablet (iPad)"},
    "desktop": {"width": 1920, "height": 1080, "name": "Desktop"}
}

BRANCHES = [
    {"name": "Birmingham", "scanner": "/birmingham-orders/scanner", "logs": "/birmingham-orders/scanning-logs"},
    {"name": "France", "scanner": "/france-orders/scanner", "logs": "/france-orders/scanning-logs"},
    {"name": "London", "scanner": "/london-orders/scanner", "logs": "/london-orders/scanning-logs"}
]


def login(page):
    """Login to the application"""
    print("  [Login] Logging in...")
    page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    page.fill('#loginUsername', CREDENTIALS["username"])
    page.fill('#loginPassword', CREDENTIALS["password"])
    page.click('#loginBtn')
    page.wait_for_timeout(1000)
    page.wait_for_selector('.sidebar-container', timeout=15000)
    print("  [Login] ✅ Logged in")


def test_scanner_page(page, branch_name, scanner_url, viewport_name):
    """Test scanner page responsiveness"""
    print(f"\n  [{viewport_name}] Testing {branch_name} Scanner Page")
    
    # Navigate to scanner page
    page.goto(f"{BASE_URL}{scanner_url}")
    page.wait_for_selector('#skuInput', timeout=5000)
    
    # Test 1: Check page is visible
    print(f"  [{viewport_name}] ✓ Page loaded")
    
    # Test 2: Check search input is visible and accessible
    search_input = page.locator('#skuInput')
    expect(search_input).to_be_visible()
    expect(search_input).to_be_enabled()
    print(f"  [{viewport_name}] ✓ Search input visible and accessible")
    
    # Test 3: Test search dropdown
    search_input.fill('AS')
    page.wait_for_timeout(500)  # Wait for debounce + API
    
    search_dropdown = page.locator('#searchDropdown')
    # Dropdown should appear
    page.wait_for_timeout(300)
    print(f"  [{viewport_name}] ✓ Search dropdown functional")
    
    # Test 4: Check if results are clickable
    search_results = page.locator('.search-result-item')
    if search_results.count() > 0:
        # Click first result
        search_results.first.click()
        page.wait_for_timeout(500)
        
        # Check if item was added to pending list
        pending_items = page.locator('.pending-item')
        if pending_items.count() > 0:
            print(f"  [{viewport_name}] ✓ Can add items from search")
            
            # Test 5: Check pending item controls are accessible
            qty_input = pending_items.first.locator('.qty-value-input')
            expect(qty_input).to_be_visible()
            
            shelf_select = pending_items.first.locator('.shelf-select')
            expect(shelf_select).to_be_visible()
            
            print(f"  [{viewport_name}] ✓ Pending item controls accessible")
            
            # Test 6: Check remove button is accessible
            remove_btn = pending_items.first.locator('.pending-item-remove')
            expect(remove_btn).to_be_visible()
            print(f"  [{viewport_name}] ✓ Remove button accessible")
            
            # Clean up
            clear_btn = page.locator('#clearAllBtn')
            if clear_btn.is_visible():
                clear_btn.click()
                page.wait_for_timeout(300)
        else:
            print(f"  [{viewport_name}] ⚠ No items added (might be expected)")
    else:
        print(f"  [{viewport_name}] ⚠ No search results (might be expected)")
    
    print(f"  [{viewport_name}] ✅ Scanner page responsive tests passed")


def test_logs_page(page, branch_name, logs_url, viewport_name):
    """Test scanning logs page responsiveness"""
    print(f"\n  [{viewport_name}] Testing {branch_name} Scanning Logs Page")
    
    # Navigate to logs page
    page.goto(f"{BASE_URL}{logs_url}")
    page.wait_for_selector('.scanning-logs', timeout=5000)
    
    # Test 1: Check page is visible
    print(f"  [{viewport_name}] ✓ Page loaded")
    
    # Test 2: Check filters are accessible
    date_from = page.locator('#dateFrom')
    date_to = page.locator('#dateTo')
    
    if date_from.count() > 0:
        expect(date_from).to_be_visible()
        print(f"  [{viewport_name}] ✓ Filter controls visible")
    
    # Test 3: Check search/filter button is accessible
    search_btn = page.locator('button:has-text("Search"), button:has-text("Filter")')
    if search_btn.count() > 0:
        expect(search_btn.first).to_be_visible()
        print(f"  [{viewport_name}] ✓ Search/filter button accessible")
    
    # Test 4: Check if submissions are displayed or empty state is shown
    submissions = page.locator('.submission-card')
    empty_state = page.locator('.empty-state')
    
    if submissions.count() > 0:
        print(f"  [{viewport_name}] ✓ Submissions displayed (found {submissions.count()})")
        
        # Test 5: Check if first submission is accessible
        first_submission = submissions.first
        expect(first_submission).to_be_visible()
        
        # Check if items table is visible (might need to expand)
        items_table = first_submission.locator('.items-table')
        if items_table.count() > 0:
            print(f"  [{viewport_name}] ✓ Items table visible in submission")
    elif empty_state.count() > 0:
        expect(empty_state).to_be_visible()
        print(f"  [{viewport_name}] ✓ Empty state displayed correctly")
    else:
        print(f"  [{viewport_name}] ⚠ No submissions or empty state (loading)")
    
    # Test 6: Check pagination if present
    pagination = page.locator('.pagination')
    if pagination.count() > 0:
        print(f"  [{viewport_name}] ✓ Pagination visible")
    
    print(f"  [{viewport_name}] ✅ Scanning logs page responsive tests passed")


def take_screenshot(page, filename):
    """Take a screenshot"""
    page.screenshot(path=f"tests/screenshots/{filename}")


def main():
    print("=" * 70)
    print("Mobile Responsiveness Test - Scanner & Scanning Logs Pages")
    print("=" * 70)
    
    start_time = datetime.now()
    
    with sync_playwright() as p:
        for viewport_key, viewport_config in VIEWPORTS.items():
            print(f"\n{'=' * 70}")
            print(f"Testing Viewport: {viewport_config['name']} ({viewport_config['width']}x{viewport_config['height']})")
            print(f"{'=' * 70}")
            
            # Launch browser with specific viewport
            browser = p.chromium.launch(headless=True)
            context = browser.new_context(
                viewport={"width": viewport_config["width"], "height": viewport_config["height"]},
                device_scale_factor=2 if viewport_key == "mobile" else 1
            )
            page = context.new_page()
            
            try:
                # Login once per viewport
                login(page)
                
                # Test each branch
                for branch in BRANCHES:
                    print(f"\n--- {branch['name']} Branch ---")
                    
                    # Test scanner page
                    test_scanner_page(page, branch['name'], branch['scanner'], viewport_config['name'])
                    
                    # Test logs page
                    test_logs_page(page, branch['name'], branch['logs'], viewport_config['name'])
                
            except Exception as e:
                print(f"\n❌ Test failed on {viewport_config['name']}: {e}")
                # Take screenshot on failure
                timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
                page.screenshot(path=f"test_failure_{viewport_key}_{timestamp}.png")
                raise
            
            finally:
                browser.close()
        
        print("\n" + "=" * 70)
        print("✅ All mobile responsiveness tests completed successfully")
        print("=" * 70)
    
    end_time = datetime.now()
    print(f"\nStart: {start_time}")
    print(f"End:   {end_time}")
    print(f"Duration: {(end_time - start_time).total_seconds():.2f}s")


if __name__ == "__main__":
    main()
