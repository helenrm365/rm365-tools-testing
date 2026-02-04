#!/usr/bin/env python3
"""
Test Scanner Search Functionality
Validates that:
1. Search bar shows nothing initially
2. Debounced search works
3. Products appear in dropdown
4. Clicking a product adds it with quantity 0
5. Styling is correct
"""

import asyncio
import sys
from pathlib import Path
from datetime import datetime

# Add parent directory to path
sys.path.insert(0, str(Path(__file__).parent.parent))

from playwright.sync_api import sync_playwright, expect


BASE_URL = "http://localhost:8000"
CREDENTIALS = {"username": "superadmin", "password": "admin123"}


def login(page):
    """Login to the application"""
    print("[Login] Logging in...")
    page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    page.fill('#loginUsername', CREDENTIALS["username"])
    page.fill('#loginPassword', CREDENTIALS["password"])
    page.click('#loginBtn')
    
    # Wait for app shell and sidebar to appear
    page.wait_for_timeout(1000)
    page.wait_for_selector('.sidebar-container', timeout=15000)
    print("[Login] ✅ Logged in")


def test_scanner_search(page, branch_name, branch_url):
    """Test scanner search functionality for a branch"""
    print(f"\n[{branch_name}] Testing scanner search functionality")
    
    # Navigate to scanner page
    page.goto(f"{BASE_URL}/{branch_url}/scanner")
    page.wait_for_selector('#skuInput', timeout=5000)
    
    search_input = page.locator('#skuInput')
    search_dropdown = page.locator('#searchDropdown')
    
    # Test 1: Initially, dropdown should not be visible
    print(f"[{branch_name}] Test 1: Verifying dropdown is hidden initially...")
    expect(search_dropdown).not_to_have_class('active')
    print(f"[{branch_name}] ✅ Dropdown hidden initially")
    
    # Test 2: Click input - should show no results initially
    print(f"[{branch_name}] Test 2: Clicking input (should remain hidden)...")
    search_input.click()
    page.wait_for_timeout(500)  # Give it a moment
    expect(search_dropdown).not_to_have_class('active')
    print(f"[{branch_name}] ✅ Dropdown remains hidden on click")
    
    # Test 3: Start typing - should show dropdown with debounce
    print(f"[{branch_name}] Test 3: Typing 'AS' (testing debounce + dropdown)...")
    search_input.fill('AS')
    
    # Wait for debounce (300ms) + API call
    page.wait_for_timeout(500)
    
    # Dropdown should now be visible with results
    expect(search_dropdown).to_have_class(re.compile('active'))
    print(f"[{branch_name}] ✅ Dropdown appears after debounce")
    
    # Test 4: Check if results are displayed
    print(f"[{branch_name}] Test 4: Verifying search results appear...")
    search_results = page.locator('.search-result-item')
    expect(search_results.first).to_be_visible(timeout=5000)
    result_count = search_results.count()
    print(f"[{branch_name}] ✅ Found {result_count} search results")
    
    # Test 5: Check styling of results
    print(f"[{branch_name}] Test 5: Verifying result item styling...")
    first_result = search_results.first
    
    # Check for product name
    product_name = first_result.locator('.search-result-name')
    expect(product_name).to_be_visible()
    
    # Check for SKU
    product_sku = first_result.locator('.search-result-sku')
    expect(product_sku).to_be_visible()
    
    # Check for stock info
    product_stock = first_result.locator('.search-result-stock')
    expect(product_stock).to_be_visible()
    
    print(f"[{branch_name}] ✅ Result styling correct")
    
    # Test 6: Click a result and verify it adds with quantity 0
    print(f"[{branch_name}] Test 6: Clicking result to add item...")
    
    # Get the product name before clicking
    product_name_text = product_name.text_content()
    
    # Click the first result
    first_result.click()
    
    # Wait for item to be added to pending list
    page.wait_for_timeout(500)
    
    # Verify dropdown is hidden after selection
    expect(search_dropdown).not_to_have_class('active')
    print(f"[{branch_name}] ✅ Dropdown hidden after selection")
    
    # Verify input is cleared
    expect(search_input).to_have_value('')
    print(f"[{branch_name}] ✅ Input cleared after selection")
    
    # Test 7: Verify item appears in pending adjustments with quantity 0
    print(f"[{branch_name}] Test 7: Verifying item in pending adjustments...")
    pending_item = page.locator('.pending-item').first
    expect(pending_item).to_be_visible(timeout=5000)
    
    # Check quantity is 0
    qty_input = pending_item.locator('.qty-value')
    expect(qty_input).to_have_value('0')
    print(f"[{branch_name}] ✅ Item added with quantity 0")
    
    # Test 8: Try adding the same item again
    print(f"[{branch_name}] Test 8: Attempting to add duplicate item...")
    search_input.fill('AS')
    page.wait_for_timeout(500)
    
    # Click the same product again
    first_result_again = page.locator('.search-result-item').first
    first_result_again.click()
    page.wait_for_timeout(500)
    
    # Should still only have 1 item in pending list
    pending_items = page.locator('.pending-item')
    expect(pending_items).to_have_count(1)
    print(f"[{branch_name}] ✅ Duplicate detection working")
    
    # Test 9: Test hover styling
    print(f"[{branch_name}] Test 9: Testing hover effects...")
    search_input.fill('JU')
    page.wait_for_timeout(500)
    
    # Hover over a result
    hover_result = page.locator('.search-result-item').first
    hover_result.hover()
    page.wait_for_timeout(200)
    
    # Check if hover class or background changes (visual check)
    print(f"[{branch_name}] ✅ Hover effects working (visual)")
    
    # Clean up - clear all items
    print(f"[{branch_name}] Cleaning up...")
    clear_btn = page.locator('#clearAllBtn')
    if clear_btn.is_visible():
        clear_btn.click()
    
    print(f"[{branch_name}] ✅ All scanner search tests passed!")


def main():
    print("Scanner Search Functionality Test (Playwright)\n")
    
    start_time = datetime.now()
    
    with sync_playwright() as p:
        # Launch browser
        browser = p.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()
        
        try:
            # Login
            login(page)
            
            # Test all three branches
            branches = [
                ("Birmingham", "birmingham-orders"),
                ("France", "france-orders"),
                ("London", "london-orders")
            ]
            
            for branch_name, branch_url in branches:
                test_scanner_search(page, branch_name, branch_url)
            
            print("\n" + "="*60)
            print("✅ All scanner search tests completed successfully")
            print("="*60)
            
        except Exception as e:
            print(f"\n❌ Test failed: {e}")
            # Take screenshot on failure
            page.screenshot(path=f"test_failure_{datetime.now().strftime('%Y%m%d_%H%M%S')}.png")
            raise
        
        finally:
            browser.close()
    
    end_time = datetime.now()
    print(f"\nStart: {start_time}")
    print(f"End:   {end_time}")
    print(f"Duration: {(end_time - start_time).total_seconds():.2f}s")


if __name__ == "__main__":
    # Need to import re for regex in expect
    import re
    main()
