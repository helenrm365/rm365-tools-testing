#!/usr/bin/env python3
"""
Test Archive Workflow with Inventory Returns

Tests the complete daily reset/archive workflow including:
1. Incomplete sessions (draft, in_progress, ready_to_check) have scanned items returned to inventory
2. Completed sessions are archived but do NOT have items returned
3. Only the actual scanned quantity is returned (not expected quantity)

Example: If order expected 5 items but only 3 were scanned, only 3 should be returned.
"""

import sys
import os
import json
import uuid
from datetime import datetime

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from core.db import get_inventory_log_connection, return_inventory_connection
from modules.orders.order_fulfillment.db_repo import MagentoDbRepo
from modules.orders.order_fulfillment.service import OrderFulfillmentService


class InventoryReturnTester:
    def __init__(self):
        self.repo = MagentoDbRepo()
        self.service = OrderFulfillmentService()
        self.test_sku = "ME071"  # Real test SKU
        self.test_user = "test_archive_inv"
        self.created_sessions = []
        self.initial_inventory = None
        
    def get_item_id(self, sku: str) -> str:
        """Get item_id from SKU"""
        conn = get_inventory_log_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT item_id FROM inventory_metadata WHERE sku = %s", (sku,))
        row = cursor.fetchone()
        cursor.close()
        return_inventory_connection(conn)
        return row[0] if row else None
    
    def get_inventory(self, sku: str) -> dict:
        """Get current inventory for a SKU"""
        conn = get_inventory_log_connection()
        cursor = conn.cursor()
        cursor.execute("""
            SELECT item_id, shelf_lt1_qty, shelf_gt1_qty, top_floor_total 
            FROM inventory_metadata WHERE sku = %s
        """, (sku,))
        row = cursor.fetchone()
        cursor.close()
        return_inventory_connection(conn)
        
        if row:
            return {
                'item_id': row[0],
                'shelf_lt1_qty': int(row[1] or 0),
                'shelf_gt1_qty': int(row[2] or 0),
                'top_floor_total': int(row[3] or 0)
            }
        return {}
    
    def set_inventory(self, sku: str, shelf_lt1: int, shelf_gt1: int, top_floor: int):
        """Set inventory for a SKU"""
        conn = get_inventory_log_connection()
        cursor = conn.cursor()
        cursor.execute("""
            UPDATE inventory_metadata 
            SET shelf_lt1_qty = %s, shelf_gt1_qty = %s, top_floor_total = %s
            WHERE sku = %s
        """, (shelf_lt1, shelf_gt1, top_floor, sku))
        conn.commit()
        cursor.close()
        return_inventory_connection(conn)
        
    def create_session_with_scanned_items(
        self, 
        status: str, 
        qty_expected: int, 
        qty_scanned: int,
        source_field: str = "shelf_lt1_qty"
    ) -> str:
        """
        Create a test session with specific scanned items.
        
        Args:
            status: Session status (draft, in_progress, ready_to_check, completed)
            qty_expected: How many items were expected
            qty_scanned: How many items were actually scanned
            source_field: Which inventory field items were taken from
        """
        session_id = str(uuid.uuid4())
        order_number = f"TEST-INV-{datetime.now().strftime('%H%M%S')}-{len(self.created_sessions)}"
        invoice_id = f"INV-{order_number}"
        
        items_expected = [
            {"sku": self.test_sku, "qty_expected": qty_expected, "name": "Test Product", "price": 10.0}
        ]
        
        items_scanned = []
        if qty_scanned > 0:
            items_scanned = [{
                "sku": self.test_sku,
                "qty_expected": qty_expected,
                "qty_scanned": qty_scanned,
                "deduction_sources": [
                    {"field": source_field, "original": 100, "taken": qty_scanned, "remaining": qty_scanned}
                ]
            }]
        
        conn = get_inventory_log_connection()
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO order_fulfillment_sessions 
            (session_id, invoice_id, order_number, session_type, status, user_id, 
             created_by, items_expected, items_scanned, started_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
        """, (
            session_id, invoice_id, order_number, "pick", status,
            self.test_user, self.test_user,
            json.dumps(items_expected), json.dumps(items_scanned)
        ))
        conn.commit()
        cursor.close()
        return_inventory_connection(conn)
        
        self.created_sessions.append(session_id)
        return session_id, order_number
    
    def cleanup(self):
        """Clean up test sessions"""
        conn = get_inventory_log_connection()
        cursor = conn.cursor()
        for session_id in self.created_sessions:
            cursor.execute("DELETE FROM order_fulfillment_sessions WHERE session_id = %s", (session_id,))
        cursor.execute("DELETE FROM order_fulfillment_sessions WHERE user_id = %s", (self.test_user,))
        conn.commit()
        cursor.close()
        return_inventory_connection(conn)
        self.created_sessions = []
        
    def get_session_status(self, session_id: str) -> str:
        """Get session status"""
        session = self.repo.get_session(session_id)
        return session.status if session else None


def test_archive_with_inventory_returns():
    print("=" * 70)
    print("TESTING ARCHIVE WORKFLOW WITH INVENTORY RETURNS")
    print("=" * 70)
    
    tester = InventoryReturnTester()
    all_passed = True
    
    # Save initial inventory
    initial_inv = tester.get_inventory(tester.test_sku)
    print(f"\n📦 Initial inventory for {tester.test_sku}:")
    print(f"   shelf_lt1_qty: {initial_inv['shelf_lt1_qty']}")
    print(f"   shelf_gt1_qty: {initial_inv['shelf_gt1_qty']}")
    print(f"   top_floor_total: {initial_inv['top_floor_total']}")
    
    # Clean up any existing test sessions
    tester.cleanup()
    
    try:
        # ========================================
        # Test 1: Draft session with partial scan
        # ========================================
        print("\n" + "-" * 70)
        print("TEST 1: Draft session - expected 5, scanned 3 → return 3 to shelf_lt1")
        print("-" * 70)
        
        # Set up known inventory
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=20, top_floor=10)
        inv_before = tester.get_inventory(tester.test_sku)
        print(f"   Inventory before: shelf_lt1={inv_before['shelf_lt1_qty']}")
        
        # Create draft session: expected 5, scanned 3
        session_id, order_num = tester.create_session_with_scanned_items(
            status="draft",
            qty_expected=5,
            qty_scanned=3,
            source_field="shelf_lt1_qty"
        )
        print(f"   Created session: {order_num} (draft, 3/5 scanned)")
        
        # Simulate that items were deducted during scanning
        tester.set_inventory(tester.test_sku, shelf_lt1=47, shelf_gt1=20, top_floor=10)  # 50-3=47
        inv_after_scan = tester.get_inventory(tester.test_sku)
        print(f"   Inventory after scanning: shelf_lt1={inv_after_scan['shelf_lt1_qty']} (simulated deduction)")
        
        # Run daily reset
        print("   Running daily reset...")
        result = tester.service.reset_daily_sessions()
        
        inv_after_reset = tester.get_inventory(tester.test_sku)
        print(f"   Inventory after reset: shelf_lt1={inv_after_reset['shelf_lt1_qty']}")
        print(f"   Items returned: {result.get('items_returned_to_inventory', 0)}")
        
        # Verify: 47 + 3 = 50
        expected_qty = 50
        if inv_after_reset['shelf_lt1_qty'] == expected_qty:
            print(f"   ✅ PASS: Inventory correctly restored to {expected_qty}")
        else:
            print(f"   ❌ FAIL: Expected {expected_qty}, got {inv_after_reset['shelf_lt1_qty']}")
            all_passed = False
        
        # Verify session is archived
        status = tester.get_session_status(session_id)
        if status == "archived":
            print(f"   ✅ PASS: Session status is 'archived'")
        else:
            print(f"   ❌ FAIL: Session status is '{status}', expected 'archived'")
            all_passed = False
        
        # Clean up
        tester.cleanup()
        
        # ========================================
        # Test 2: In-progress session with full scan
        # ========================================
        print("\n" + "-" * 70)
        print("TEST 2: In-progress session - expected 4, scanned 4 → return 4")
        print("-" * 70)
        
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=20, top_floor=10)
        
        session_id, order_num = tester.create_session_with_scanned_items(
            status="in_progress",
            qty_expected=4,
            qty_scanned=4,
            source_field="shelf_lt1_qty"
        )
        print(f"   Created session: {order_num} (in_progress, 4/4 scanned)")
        
        # Simulate deduction
        tester.set_inventory(tester.test_sku, shelf_lt1=46, shelf_gt1=20, top_floor=10)  # 50-4=46
        
        print("   Running daily reset...")
        result = tester.service.reset_daily_sessions()
        
        inv_after = tester.get_inventory(tester.test_sku)
        print(f"   Inventory after reset: shelf_lt1={inv_after['shelf_lt1_qty']}")
        print(f"   Items returned: {result.get('items_returned_to_inventory', 0)}")
        
        if inv_after['shelf_lt1_qty'] == 50:
            print(f"   ✅ PASS: Inventory correctly restored")
        else:
            print(f"   ❌ FAIL: Expected 50, got {inv_after['shelf_lt1_qty']}")
            all_passed = False
        
        tester.cleanup()
        
        # ========================================
        # Test 3: Ready-to-check session
        # ========================================
        print("\n" + "-" * 70)
        print("TEST 3: Ready-to-check session - expected 6, scanned 2 → return 2")
        print("-" * 70)
        
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=20, top_floor=10)
        
        session_id, order_num = tester.create_session_with_scanned_items(
            status="ready_to_check",
            qty_expected=6,
            qty_scanned=2,
            source_field="shelf_lt1_qty"
        )
        print(f"   Created session: {order_num} (ready_to_check, 2/6 scanned)")
        
        tester.set_inventory(tester.test_sku, shelf_lt1=48, shelf_gt1=20, top_floor=10)  # 50-2=48
        
        print("   Running daily reset...")
        result = tester.service.reset_daily_sessions()
        
        inv_after = tester.get_inventory(tester.test_sku)
        print(f"   Inventory after reset: shelf_lt1={inv_after['shelf_lt1_qty']}")
        
        if inv_after['shelf_lt1_qty'] == 50:
            print(f"   ✅ PASS: Inventory correctly restored")
        else:
            print(f"   ❌ FAIL: Expected 50, got {inv_after['shelf_lt1_qty']}")
            all_passed = False
        
        tester.cleanup()
        
        # ========================================
        # Test 4: Completed session - NO inventory return
        # ========================================
        print("\n" + "-" * 70)
        print("TEST 4: Completed session - expected 5, scanned 5 → NO return (shipped)")
        print("-" * 70)
        
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=20, top_floor=10)
        
        session_id, order_num = tester.create_session_with_scanned_items(
            status="completed",
            qty_expected=5,
            qty_scanned=5,
            source_field="shelf_lt1_qty"
        )
        print(f"   Created session: {order_num} (completed, 5/5 scanned)")
        
        # Simulate that items were shipped (inventory should stay reduced)
        tester.set_inventory(tester.test_sku, shelf_lt1=45, shelf_gt1=20, top_floor=10)  # 50-5=45
        inv_before = tester.get_inventory(tester.test_sku)
        print(f"   Inventory before reset: shelf_lt1={inv_before['shelf_lt1_qty']} (items shipped)")
        
        print("   Running daily reset...")
        result = tester.service.reset_daily_sessions()
        
        inv_after = tester.get_inventory(tester.test_sku)
        print(f"   Inventory after reset: shelf_lt1={inv_after['shelf_lt1_qty']}")
        
        # Completed sessions should NOT have inventory returned
        if inv_after['shelf_lt1_qty'] == 45:
            print(f"   ✅ PASS: Inventory NOT restored (correct - items were shipped)")
        else:
            print(f"   ❌ FAIL: Expected 45 (no return), got {inv_after['shelf_lt1_qty']}")
            all_passed = False
        
        # But session should still be archived
        status = tester.get_session_status(session_id)
        if status == "archived":
            print(f"   ✅ PASS: Completed session is archived")
        else:
            print(f"   ❌ FAIL: Session status is '{status}', expected 'archived'")
            all_passed = False
        
        tester.cleanup()
        
        # ========================================
        # Test 5: Approved session - no items scanned yet
        # ========================================
        print("\n" + "-" * 70)
        print("TEST 5: Approved session - expected 10, scanned 0 → no return needed")
        print("-" * 70)
        
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=20, top_floor=10)
        
        session_id, order_num = tester.create_session_with_scanned_items(
            status="approved",
            qty_expected=10,
            qty_scanned=0,  # Not started yet
            source_field="shelf_lt1_qty"
        )
        print(f"   Created session: {order_num} (approved, 0/10 scanned)")
        
        print("   Running daily reset...")
        result = tester.service.reset_daily_sessions()
        
        inv_after = tester.get_inventory(tester.test_sku)
        print(f"   Inventory after reset: shelf_lt1={inv_after['shelf_lt1_qty']}")
        
        if inv_after['shelf_lt1_qty'] == 50:
            print(f"   ✅ PASS: No inventory change (nothing was scanned)")
        else:
            print(f"   ❌ FAIL: Expected 50, got {inv_after['shelf_lt1_qty']}")
            all_passed = False
        
        status = tester.get_session_status(session_id)
        if status == "archived":
            print(f"   ✅ PASS: Approved session is archived")
        else:
            print(f"   ❌ FAIL: Session status is '{status}', expected 'archived'")
            all_passed = False
        
        tester.cleanup()
        
        # ========================================
        # Test 6: Multiple sources - different fields
        # ========================================
        print("\n" + "-" * 70)
        print("TEST 6: Items from shelf_gt1 instead of shelf_lt1")
        print("-" * 70)
        
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=20, top_floor=10)
        
        session_id, order_num = tester.create_session_with_scanned_items(
            status="in_progress",
            qty_expected=5,
            qty_scanned=5,
            source_field="shelf_gt1_qty"  # From the other shelf
        )
        print(f"   Created session: {order_num} (in_progress, 5/5 from shelf_gt1)")
        
        # Simulate deduction from shelf_gt1
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=15, top_floor=10)  # 20-5=15
        
        print("   Running daily reset...")
        result = tester.service.reset_daily_sessions()
        
        inv_after = tester.get_inventory(tester.test_sku)
        print(f"   Inventory after reset: shelf_gt1={inv_after['shelf_gt1_qty']}")
        
        if inv_after['shelf_gt1_qty'] == 20:
            print(f"   ✅ PASS: shelf_gt1 correctly restored to 20")
        else:
            print(f"   ❌ FAIL: Expected shelf_gt1=20, got {inv_after['shelf_gt1_qty']}")
            all_passed = False
        
        tester.cleanup()
        
    except Exception as e:
        print(f"\n❌ ERROR: {e}")
        import traceback
        traceback.print_exc()
        all_passed = False
    finally:
        # Restore original inventory
        tester.set_inventory(
            tester.test_sku, 
            initial_inv['shelf_lt1_qty'], 
            initial_inv['shelf_gt1_qty'], 
            initial_inv['top_floor_total']
        )
        print(f"\n📦 Restored original inventory")
        tester.cleanup()
    
    # ========================================
    # Summary
    # ========================================
    print("\n" + "=" * 70)
    if all_passed:
        print("✅ ALL TESTS PASSED!")
    else:
        print("❌ SOME TESTS FAILED!")
    print("=" * 70)
    
    return all_passed


if __name__ == "__main__":
    success = test_archive_with_inventory_returns()
    sys.exit(0 if success else 1)
