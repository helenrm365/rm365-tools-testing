#!/usr/bin/env python3
"""
Test Cancellation Inventory Returns

Tests that cancelling sessions in different statuses correctly handles inventory:
1. Cancel draft with scanned items → return items
2. Cancel in_progress with scanned items → return items
3. Cancel ready_to_check with scanned items → return items
4. Cancel approved (no scanned items) → nothing to return
5. Cannot cancel completed sessions

Only the actual scanned quantity should be returned, not the expected quantity.
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


class CancelInventoryTester:
    def __init__(self):
        self.repo = MagentoDbRepo()
        self.service = OrderFulfillmentService()
        self.test_sku = "ME071"  # Real test SKU
        self.test_user = "test_cancel_inv"
        self.created_sessions = []
        
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
        
    def create_session(
        self, 
        status: str, 
        qty_expected: int, 
        qty_scanned: int,
        source_field: str = "shelf_lt1_qty"
    ) -> str:
        """Create a test session with specific scanned items."""
        session_id = str(uuid.uuid4())
        order_number = f"TEST-CANCEL-{datetime.now().strftime('%H%M%S')}-{len(self.created_sessions)}"
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


def test_cancellation_inventory_returns():
    print("=" * 70)
    print("TESTING CANCELLATION INVENTORY RETURNS")
    print("=" * 70)
    
    tester = CancelInventoryTester()
    all_passed = True
    
    # Save initial inventory
    initial_inv = tester.get_inventory(tester.test_sku)
    print(f"\n📦 Initial inventory for {tester.test_sku}:")
    print(f"   shelf_lt1_qty: {initial_inv['shelf_lt1_qty']}")
    
    # Clean up any existing test sessions
    tester.cleanup()
    
    try:
        # ========================================
        # Test 1: Cancel DRAFT session
        # ========================================
        print("\n" + "-" * 70)
        print("TEST 1: Cancel DRAFT session - expected 5, scanned 3 → return 3")
        print("-" * 70)
        
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=20, top_floor=10)
        
        session_id, order_num = tester.create_session(
            status="draft",
            qty_expected=5,
            qty_scanned=3,
            source_field="shelf_lt1_qty"
        )
        print(f"   Created session: {order_num} (draft, 3/5 scanned)")
        
        # Simulate deduction
        tester.set_inventory(tester.test_sku, shelf_lt1=47, shelf_gt1=20, top_floor=10)  # 50-3=47
        inv_before = tester.get_inventory(tester.test_sku)
        print(f"   Inventory before cancel: shelf_lt1={inv_before['shelf_lt1_qty']}")
        
        # Cancel the session
        print("   Cancelling session...")
        result = tester.service.cancel_session(session_id, user_id="test_user")
        print(f"   Result: {result}")
        
        inv_after = tester.get_inventory(tester.test_sku)
        print(f"   Inventory after cancel: shelf_lt1={inv_after['shelf_lt1_qty']}")
        
        if inv_after['shelf_lt1_qty'] == 50 and result.get('items_returned') == 3:
            print(f"   ✅ PASS: Items correctly returned")
        else:
            print(f"   ❌ FAIL: Expected 50, got {inv_after['shelf_lt1_qty']}")
            all_passed = False
        
        # Verify session is cancelled
        status = tester.get_session_status(session_id)
        if status == "cancelled":
            print(f"   ✅ PASS: Session status is 'cancelled'")
        else:
            print(f"   ❌ FAIL: Session status is '{status}', expected 'cancelled'")
            all_passed = False
        
        tester.cleanup()
        
        # ========================================
        # Test 2: Cancel IN_PROGRESS session
        # ========================================
        print("\n" + "-" * 70)
        print("TEST 2: Cancel IN_PROGRESS session - expected 4, scanned 4 → return 4")
        print("-" * 70)
        
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=20, top_floor=10)
        
        session_id, order_num = tester.create_session(
            status="in_progress",
            qty_expected=4,
            qty_scanned=4,
            source_field="shelf_lt1_qty"
        )
        print(f"   Created session: {order_num} (in_progress, 4/4 scanned)")
        
        tester.set_inventory(tester.test_sku, shelf_lt1=46, shelf_gt1=20, top_floor=10)  # 50-4=46
        
        print("   Cancelling session...")
        result = tester.service.cancel_session(session_id, user_id="test_user")
        print(f"   Result: {result}")
        
        inv_after = tester.get_inventory(tester.test_sku)
        
        if inv_after['shelf_lt1_qty'] == 50 and result.get('items_returned') == 4:
            print(f"   ✅ PASS: Items correctly returned (shelf_lt1={inv_after['shelf_lt1_qty']})")
        else:
            print(f"   ❌ FAIL: Expected 50, got {inv_after['shelf_lt1_qty']}")
            all_passed = False
        
        tester.cleanup()
        
        # ========================================
        # Test 3: Cancel READY_TO_CHECK session
        # ========================================
        print("\n" + "-" * 70)
        print("TEST 3: Cancel READY_TO_CHECK session - expected 6, scanned 2 → return 2")
        print("-" * 70)
        
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=20, top_floor=10)
        
        session_id, order_num = tester.create_session(
            status="ready_to_check",
            qty_expected=6,
            qty_scanned=2,
            source_field="shelf_lt1_qty"
        )
        print(f"   Created session: {order_num} (ready_to_check, 2/6 scanned)")
        
        tester.set_inventory(tester.test_sku, shelf_lt1=48, shelf_gt1=20, top_floor=10)  # 50-2=48
        inv_before = tester.get_inventory(tester.test_sku)
        print(f"   Inventory before cancel: shelf_lt1={inv_before['shelf_lt1_qty']}")
        
        print("   Cancelling session...")
        result = tester.service.cancel_session(session_id, user_id="test_user")
        print(f"   Result: {result}")
        
        inv_after = tester.get_inventory(tester.test_sku)
        print(f"   Inventory after cancel: shelf_lt1={inv_after['shelf_lt1_qty']}")
        
        if inv_after['shelf_lt1_qty'] == 50 and result.get('items_returned') == 2:
            print(f"   ✅ PASS: Items correctly returned (ready_to_check now returns items!)")
        else:
            print(f"   ❌ FAIL: Expected 50 with 2 returned, got {inv_after['shelf_lt1_qty']} with {result.get('items_returned')} returned")
            all_passed = False
        
        tester.cleanup()
        
        # ========================================
        # Test 4: Cancel APPROVED session (no scans yet)
        # ========================================
        print("\n" + "-" * 70)
        print("TEST 4: Cancel APPROVED session - expected 10, scanned 0 → nothing to return")
        print("-" * 70)
        
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=20, top_floor=10)
        
        session_id, order_num = tester.create_session(
            status="approved",
            qty_expected=10,
            qty_scanned=0,  # Not started yet
            source_field="shelf_lt1_qty"
        )
        print(f"   Created session: {order_num} (approved, 0/10 scanned)")
        
        print("   Cancelling session...")
        result = tester.service.cancel_session(session_id, user_id="test_user")
        print(f"   Result: {result}")
        
        inv_after = tester.get_inventory(tester.test_sku)
        
        if inv_after['shelf_lt1_qty'] == 50 and result.get('items_returned', 0) == 0:
            print(f"   ✅ PASS: No items to return (nothing was scanned)")
        else:
            print(f"   ❌ FAIL: Expected 0 items returned")
            all_passed = False
        
        tester.cleanup()
        
        # ========================================
        # Test 5: Try to cancel COMPLETED session
        # ========================================
        print("\n" + "-" * 70)
        print("TEST 5: Try to cancel COMPLETED session → should FAIL")
        print("-" * 70)
        
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=20, top_floor=10)
        
        session_id, order_num = tester.create_session(
            status="completed",
            qty_expected=5,
            qty_scanned=5,
            source_field="shelf_lt1_qty"
        )
        print(f"   Created session: {order_num} (completed, 5/5 scanned)")
        
        # Simulate shipped items
        tester.set_inventory(tester.test_sku, shelf_lt1=45, shelf_gt1=20, top_floor=10)  # 50-5=45
        
        print("   Attempting to cancel completed session...")
        result = tester.service.cancel_session(session_id, user_id="test_user")
        print(f"   Result: {result}")
        
        inv_after = tester.get_inventory(tester.test_sku)
        
        if result.get('success') == False:
            print(f"   ✅ PASS: Cannot cancel completed session (correct behavior)")
        else:
            print(f"   ❌ FAIL: Should not be able to cancel completed session")
            all_passed = False
        
        if inv_after['shelf_lt1_qty'] == 45:
            print(f"   ✅ PASS: Inventory unchanged (items were shipped)")
        else:
            print(f"   ❌ FAIL: Inventory should remain at 45")
            all_passed = False
        
        tester.cleanup()
        
        # ========================================
        # Test 6: Cancel with items from multiple sources
        # ========================================
        print("\n" + "-" * 70)
        print("TEST 6: Cancel with items from shelf_gt1")
        print("-" * 70)
        
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=20, top_floor=10)
        
        session_id, order_num = tester.create_session(
            status="in_progress",
            qty_expected=5,
            qty_scanned=5,
            source_field="shelf_gt1_qty"  # Different field
        )
        print(f"   Created session: {order_num} (in_progress, 5/5 from shelf_gt1)")
        
        tester.set_inventory(tester.test_sku, shelf_lt1=50, shelf_gt1=15, top_floor=10)  # 20-5=15
        
        print("   Cancelling session...")
        result = tester.service.cancel_session(session_id, user_id="test_user")
        print(f"   Result: {result}")
        
        inv_after = tester.get_inventory(tester.test_sku)
        
        if inv_after['shelf_gt1_qty'] == 20 and result.get('items_returned') == 5:
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
    success = test_cancellation_inventory_returns()
    sys.exit(0 if success else 1)
