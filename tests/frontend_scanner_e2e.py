#!/usr/bin/env python3
"""Frontend-only E2E test using Playwright.

Covers:
- Login
- Branch-specific scanner workflows (add/remove)
- Scanning logs verification
- Cross-branch isolation (logs)
"""

from datetime import datetime
from playwright.sync_api import sync_playwright, expect

BASE_URL = "http://localhost:8000"

BRANCHES = [
    {
        "id": "birmingham",
        "name": "Birmingham",
        "scanner_path": "/birmingham-orders/scanner",
        "logs_path": "/birmingham-orders/scanning-logs",
        "reason": "Birmingham UI E2E",
        "items": [
            {"sku": "AS004", "qty": 10, "shelf": "shelf_lt1_qty"},
            {"sku": "AS005", "qty": 5, "shelf": "shelf_gt1_qty"},
            {"sku": "AS004", "qty": -8, "shelf": "auto"},
        ],
    },
    {
        "id": "france",
        "name": "France",
        "scanner_path": "/france-orders/scanner",
        "logs_path": "/france-orders/scanning-logs",
        "reason": "France UI E2E",
        "items": [
            {"sku": "AS005", "qty": 20, "shelf": "top_floor_total"},
            {"sku": "AS004", "qty": -15, "shelf": "auto"},
        ],
    },
    {
        "id": "london",
        "name": "London",
        "scanner_path": "/london-orders/scanner",
        "logs_path": "/london-orders/scanning-logs",
        "reason": "London UI E2E",
        "items": [
            {"sku": "AS004", "qty": 30, "shelf": "shelf_gt1_qty"},
        ],
    },
]


def log(msg):
    print(msg, flush=True)


def login(page):
    log("\n[Login]")
    page.goto(f"{BASE_URL}/login", wait_until="networkidle")
    page.fill("#loginUsername", "superadmin")
    page.fill("#loginPassword", "admin123")
    page.click("#loginBtn")
    # Wait for app shell and sidebar to appear (route can vary)
    page.wait_for_timeout(1000)
    page.wait_for_selector(".sidebar-container", timeout=15000)
    log("  ✅ Logged in")


def add_item(page, sku, qty, shelf):
    # Scan/add item
    page.fill("#skuInput", sku)
    page.keyboard.press("Enter")

    # Wait for search results or pending item to appear
    try:
        page.wait_for_selector(".search-result-item", timeout=3000)
        page.click(".search-result-item")
    except Exception:
        # Fallback: wait for pending item creation
        pass

    page.wait_for_timeout(1000)
    items = page.query_selector_all(".pending-item")
    if not items:
        message = page.text_content("#scanMessage") or "(no scan message)"
        raise RuntimeError(f"Failed to add item {sku}. Scan message: {message}")
    # Find last item index
    items = page.query_selector_all(".pending-item")
    index = len(items) - 1
    qty_selector = f".qty-value-input[data-index='{index}']"
    shelf_selector = f".shelf-select[data-index='{index}']"
    # Set quantity
    page.fill(qty_selector, str(qty))
    page.keyboard.press("Enter")
    # Set shelf
    page.select_option(shelf_selector, shelf)


def submit_items(page, reason):
    page.fill("#reasonInput", reason)
    page.click("#submitBtn")
    page.wait_for_selector("#confirmModal.active", timeout=10000)
    page.click("#confirmSubmitBtn")
    page.wait_for_selector("#successModal.active", timeout=15000)
    page.click("#successOkBtn")
    log("  ✅ Submission completed")


def verify_logs(page, reason):
    page.wait_for_selector("#submissionsList", timeout=15000)
    page.wait_for_selector(".submission-card", timeout=15000)
    # Ensure the reason appears in the list (card summary)
    cards = page.query_selector_all(".submission-card")
    texts = [c.inner_text() for c in cards]
    if not any(reason in t for t in texts):
        raise AssertionError(f"Reason '{reason}' not found in logs. Cards: {texts}")
    log("  ✅ Log entry found")


def run_branch_flow(page, branch):
    log(f"\n[Branch: {branch['name']}] Scanner workflow")
    page.goto(f"{BASE_URL}{branch['scanner_path']}", wait_until="networkidle")
    page.wait_for_selector("#skuInput", timeout=15000)
    page.wait_for_function("() => { const el = document.querySelector('#skuInput'); return el && !el.disabled; }")

    for item in branch["items"]:
        add_item(page, item["sku"], item["qty"], item["shelf"])

    submit_items(page, branch["reason"])

    log(f"[Branch: {branch['name']}] Verify logs")
    page.goto(f"{BASE_URL}{branch['logs_path']}", wait_until="networkidle")
    verify_logs(page, branch["reason"])


def verify_isolation(page, branches):
    log("\n[Isolation Check]")
    # Ensure each branch logs only contain its own reason, and do not contain others
    for branch in branches:
        page.goto(f"{BASE_URL}{branch['logs_path']}", wait_until="networkidle")
        page.wait_for_selector("#submissionsList", timeout=15000)
        content = page.content()
        for other in branches:
            if other["id"] == branch["id"]:
                assert other["reason"] in content, f"Expected '{other['reason']}' in {branch['name']} logs"
            else:
                assert other["reason"] not in content, f"Found '{other['reason']}' in {branch['name']} logs"
        log(f"  ✅ {branch['name']} logs isolated")


def main():
    start = datetime.now()
    log("=" * 80)
    log("Frontend Scanner E2E Test (Playwright)")
    log("=" * 80)

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()

        login(page)

        # Run branch flows
        for branch in BRANCHES:
            run_branch_flow(page, branch)

        # Verify isolation
        verify_isolation(page, BRANCHES)

        browser.close()

    end = datetime.now()
    log("\n✅ All frontend workflows completed successfully")
    log(f"Start: {start}")
    log(f"End:   {end}")


if __name__ == "__main__":
    main()
