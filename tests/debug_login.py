#!/usr/bin/env python3
"""Simple test to check login functionality"""

from playwright.sync_playwright import sync_playwright

with sync_playwright() as p:
    browser = p.chromium.launch(headless=False, slow_mo=1000)
    page = browser.new_page()
    
    # Navigate to login
    page.goto("http://localhost:8000/login")
    
    # Fill credentials
    page.fill("#loginUsername", "superadmin")
    page.fill("#loginPassword", "admin123")
    
    # Click login
    page.click("#loginBtn")
    
    # Wait and see what happens
    page.wait_for_timeout(5000)
    
    # Print current URL
    print(f"Current URL: {page.url}")
    
    # Print page content
    print(f"Page title: {page.title()}")
    
    # Check if we're logged in
    try:
        sidebar = page.query_selector(".sidebar-container")
        if sidebar:
            print("✅ Sidebar found - login successful")
        else:
            print("❌ Sidebar not found")
            print("Page HTML:", page.content()[:500])
    except Exception as e:
        print(f"Error: {e}")
    
    # Keep browser open
    page.wait_for_timeout(10000)
    browser.close()
