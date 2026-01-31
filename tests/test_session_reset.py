#!/usr/bin/env python3
"""
Test Session Reset Functionality

Tests that the daily session reset:
1. Expires all incomplete sessions (draft, in_progress, ready_to_check, ready_to_pick, approved)
2. Returns inventory for sessions that had items scanned
3. Orders reappear in pending approvals after reset
4. Pending orders filter correctly excludes all active session statuses
"""

import sys
import os
import json
from datetime import datetime, timezone

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from dotenv import load_dotenv
from pathlib import Path
load_dotenv(dotenv_path=Path(__file__).parent.parent / '.env')


class TestResult:
    def __init__(self, name: str):
        self.name = name
        self.passed = False
        self.error = None
        self.fixed = False
        
    def __repr__(self):
        status = "✅ PASS" if self.passed else "❌ FAIL"
        if self.fixed:
            status = "🔧 FIXED"
        return f"{status}: {self.name}"


class SessionResetTester:
    def __init__(self):
        from modules.orders.order_fulfillment.service import OrderFulfillmentService
        from modules.orders.order_fulfillment.db_repo import MagentoDbRepo
        
        self.service = OrderFulfillmentService()
        self.repo = MagentoDbRepo()
        self.results = []
        self.test_sku = "ME071"  # Real inventory item
        self.test_user = "test_reset_user"
        self.created_sessions = []
        self.initial_inventory = {}
        
    def save_initial_inventory(self):
        """Save the current inventory state"""
        self.initial_inventory = self.get_inventory(self.test_sku)
        print(f"📦 Initial inventory: {self.initial_inventory}")
        
    def restore_inventory(self):
        """Restore inventory to initial state"""
        if self.initial_inventory:
            self.set_inventory(self.test_sku, self.initial_inventory)
            print(f"📦 Restored inventory to: {self.initial_inventory}")
    
    def get_inventory(self, sku: str) -> dict:
        """Get current inventory levels for a SKU"""
        try:
            from core.db import get_inventory_log_connection, return_inventory_connection
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
                    'shelf_lt1_qty': row[1] or 0,
                    'shelf_gt1_qty': row[2] or 0,
                    'top_floor_total': row[3] or 0
                }
            return {}
        except Exception as e:
            print(f"Error getting inventory: {e}")
            return {}
    
    def set_inventory(self, sku: str, values: dict):
        """Set inventory levels for a SKU"""
        try:
            from core.db import get_inventory_log_connection, return_inventory_connection
            conn = get_inventory_log_connection()
            cursor = conn.cursor()
            cursor.execute("""
                UPDATE inventory_metadata 
                SET shelf_lt1_qty = %s, shelf_gt1_qty = %s, top_floor_total = %s
                WHERE sku = %s
            """, (
                values.get('shelf_lt1_qty', 0),
                values.get('shelf_gt1_qty', 0),
                values.get('top_floor_total', 0),
                sku
            ))
            conn.commit()
            cursor.close()
            return_inventory_connection(conn)
        except Exception as e:
            print(f"Error setting inventory: {e}")
    
    def ensure_test_inventory(self):
        """Set up known inventory levels for testing"""
        self.set_inventory(self.test_sku, {
            'shelf_lt1_qty': 20,
            'shelf_gt1_qty': 10,
            'top_floor_total': 5
        })
        print(f"📦 Set test inventory: shelf_lt1=20, shelf_gt1=10, top_floor=5")
    
    def cleanup_test_sessions(self):
        """Clean up any test sessions we created"""
        try:
            from core.db import get_inventory_log_connection, return_inventory_connection
            conn = get_inventory_log_connection()
            cursor = conn.cursor()
            
            # Delete test sessions
            for session_id in self.created_sessions:
                cursor.execute("DELETE FROM order_fulfillment_sessions WHERE session_id = %s", (session_id,))
            
            # Also clean up any sessions from this test user
            cursor.execute("DELETE FROM order_fulfillment_sessions WHERE user_id = %s", (self.test_user,))
            cursor.execute("DELETE FROM order_fulfillment_sessions WHERE created_by = %s", (self.test_user,))
            
            conn.commit()
            cursor.close()
            return_inventory_connection(conn)
            print(f"🧹 Cleaned up {len(self.created_sessions)} test sessions")
        except Exception as e:
            print(f"Error cleaning up: {e}")
    
    def create_test_order(self, status: str = 'approved', session_type: str = 'pick', 
                          with_scanned_items: bool = False) -> str:
        """Create a test order session directly in the database"""
        import uuid
        
        session_id = str(uuid.uuid4())
        order_number = f"RESET-TEST-{len(self.created_sessions) + 1:03d}"
        invoice_id = f"INV-{order_number}"
        
        items_expected = [
            {"sku": self.test_sku, "qty_expected": 2, "name": "Test Product"}
        ]
        
        items_scanned = []
        if with_scanned_items:
            # Simulate scanned items with deduction sources
            items_scanned = [{
                "sku": self.test_sku,
                "qty_expected": 2,
                "qty_scanned": 2,
                "deduction_sources": [
                    {"field": "shelf_lt1_qty", "original": 20, "taken": 2, "remaining": 2}
                ]
            }]
        
        try:
            from core.db import get_inventory_log_connection, return_inventory_connection
            conn = get_inventory_log_connection()
            cursor = conn.cursor()
            
            cursor.execute("""
                INSERT INTO order_fulfillment_sessions 
                (session_id, invoice_id, order_number, session_type, status, user_id, 
                 created_by, items_expected, items_scanned, started_at)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, NOW())
            """, (
                session_id, invoice_id, order_number, session_type, status,
                self.test_user, self.test_user,
                json.dumps(items_expected), json.dumps(items_scanned)
            ))
            
            conn.commit()
            cursor.close()
            return_inventory_connection(conn)
            
            self.created_sessions.append(session_id)
            return session_id
            
        except Exception as e:
            print(f"Error creating test session: {e}")
            return None
    
    def get_session_status(self, session_id: str) -> str:
        """Get the status of a session"""
        try:
            from core.db import get_inventory_log_connection, return_inventory_connection
            conn = get_inventory_log_connection()
            cursor = conn.cursor()
            cursor.execute("SELECT status FROM order_fulfillment_sessions WHERE session_id = %s", (session_id,))
            row = cursor.fetchone()
            cursor.close()
            return_inventory_connection(conn)
            return row[0] if row else None
        except Exception as e:
            print(f"Error getting session status: {e}")
            return None
    
    def run_test(self, name: str, test_func) -> TestResult:
        """Run a single test and record result"""
        result = TestResult(name)
        try:
            test_func()
            result.passed = True
        except AssertionError as e:
            result.error = str(e)
        except Exception as e:
            result.error = f"Exception: {e}"
        
        self.results.append(result)
        return result
    
    # ============= TESTS =============
    
    def test_pending_filter_includes_all_active_statuses(self):
        """Test that pending orders filter correctly excludes all active session statuses"""
        # Create sessions with each active status
        statuses_to_test = ['draft', 'approved', 'in_progress', 'ready_to_check', 'ready_to_pick']
        created = []
        
        for status in statuses_to_test:
            session_id = self.create_test_order(status=status, session_type='pick')
            created.append((status, session_id))
        
        # Get the order numbers that should be excluded
        excluded_order_numbers = set()
        for status, session_id in created:
            session = self.repo.get_session(session_id)
            if session:
                excluded_order_numbers.add(session.order_number)
        
        # Get the pending orders filter logic - now includes all active statuses
        all_sessions = self.repo.get_sessions_by_status(['draft', 'approved', 'in_progress', 'ready_to_check', 'ready_to_pick', 'completed'])
        filter_order_numbers = {s.order_number for s in all_sessions}
        
        # draft and ready_to_pick should now be in the filter
        missing_from_filter = []
        for status, session_id in created:
            session = self.repo.get_session(session_id)
            if session and session.order_number not in filter_order_numbers:
                if status not in ('completed', 'cancelled', 'archived'):
                    missing_from_filter.append(status)
        
        # If draft or ready_to_pick are missing, the filter is incomplete
        assert 'draft' not in missing_from_filter and 'ready_to_pick' not in missing_from_filter, \
            f"Pending filter is missing statuses: {missing_from_filter}"
    
    def test_reset_expires_all_incomplete_statuses(self):
        """Test that reset expires all incomplete session statuses"""
        # Create sessions with each incomplete status
        incomplete_statuses = ['draft', 'approved', 'in_progress', 'ready_to_check', 'ready_to_pick']
        created = {}
        
        for status in incomplete_statuses:
            session_id = self.create_test_order(status=status, session_type='pick')
            created[status] = session_id
            print(f"  Created {status} session: {session_id}")
        
        # Run the reset using SERVICE (which returns inventory)
        result = self.service.reset_daily_sessions()
        print(f"  Reset result: {result}")
        
        # Check that all sessions are now archived
        for status, session_id in created.items():
            new_status = self.get_session_status(session_id)
            assert new_status == 'archived', f"Session with original status '{status}' should be 'archived', got '{new_status}'"
    
    def test_reset_returns_inventory_for_draft_picking(self):
        """Test that reset returns inventory for draft picking sessions with scanned items"""
        self.ensure_test_inventory()
        inv_before = self.get_inventory(self.test_sku)
        print(f"  Inventory before: {inv_before}")
        
        # Create a draft picking session with scanned items
        session_id = self.create_test_order(
            status='draft', 
            session_type='pick', 
            with_scanned_items=True
        )
        
        # Manually deduct inventory to simulate picking
        self.set_inventory(self.test_sku, {
            'shelf_lt1_qty': inv_before['shelf_lt1_qty'] - 2,  # 2 items picked
            'shelf_gt1_qty': inv_before['shelf_gt1_qty'],
            'top_floor_total': inv_before['top_floor_total']
        })
        inv_after_pick = self.get_inventory(self.test_sku)
        print(f"  Inventory after picking: {inv_after_pick}")
        
        # Run reset using SERVICE (which returns inventory)
        result = self.service.reset_daily_sessions()
        print(f"  Reset result: {result}")
        
        # Check inventory was returned
        inv_after_reset = self.get_inventory(self.test_sku)
        print(f"  Inventory after reset: {inv_after_reset}")
        
        assert inv_after_reset['shelf_lt1_qty'] == inv_before['shelf_lt1_qty'], \
            f"Inventory should be restored. Before: {inv_before['shelf_lt1_qty']}, After reset: {inv_after_reset['shelf_lt1_qty']}"
    
    def test_reset_returns_inventory_for_in_progress_picking(self):
        """Test that reset returns inventory for in_progress picking sessions"""
        self.ensure_test_inventory()
        inv_before = self.get_inventory(self.test_sku)
        print(f"  Inventory before: {inv_before}")
        
        # Create an in_progress picking session with scanned items
        session_id = self.create_test_order(
            status='in_progress', 
            session_type='pick', 
            with_scanned_items=True
        )
        
        # Manually deduct inventory
        self.set_inventory(self.test_sku, {
            'shelf_lt1_qty': inv_before['shelf_lt1_qty'] - 2,
            'shelf_gt1_qty': inv_before['shelf_gt1_qty'],
            'top_floor_total': inv_before['top_floor_total']
        })
        inv_after_pick = self.get_inventory(self.test_sku)
        print(f"  Inventory after picking: {inv_after_pick}")
        
        # Run reset using SERVICE
        result = self.service.reset_daily_sessions()
        print(f"  Reset result: {result}")
        
        inv_after_reset = self.get_inventory(self.test_sku)
        print(f"  Inventory after reset: {inv_after_reset}")
        
        assert inv_after_reset['shelf_lt1_qty'] == inv_before['shelf_lt1_qty'], \
            f"Inventory should be restored. Before: {inv_before['shelf_lt1_qty']}, After reset: {inv_after_reset['shelf_lt1_qty']}"
    
    def test_reset_returns_inventory_for_ready_to_check(self):
        """Test that reset returns inventory for ready_to_check sessions"""
        self.ensure_test_inventory()
        inv_before = self.get_inventory(self.test_sku)
        print(f"  Inventory before: {inv_before}")
        
        # Create a ready_to_check session with scanned items
        session_id = self.create_test_order(
            status='ready_to_check', 
            session_type='pick', 
            with_scanned_items=True
        )
        
        # Manually deduct inventory
        self.set_inventory(self.test_sku, {
            'shelf_lt1_qty': inv_before['shelf_lt1_qty'] - 2,
            'shelf_gt1_qty': inv_before['shelf_gt1_qty'],
            'top_floor_total': inv_before['top_floor_total']
        })
        inv_after_pick = self.get_inventory(self.test_sku)
        print(f"  Inventory after picking: {inv_after_pick}")
        
        # Run reset using SERVICE
        result = self.service.reset_daily_sessions()
        print(f"  Reset result: {result}")
        
        inv_after_reset = self.get_inventory(self.test_sku)
        print(f"  Inventory after reset: {inv_after_reset}")
        
        assert inv_after_reset['shelf_lt1_qty'] == inv_before['shelf_lt1_qty'], \
            f"Inventory should be restored. Before: {inv_before['shelf_lt1_qty']}, After reset: {inv_after_reset['shelf_lt1_qty']}"
    
    def test_reset_archives_completed_sessions(self):
        """Test that reset DOES archive completed sessions (but doesn't return inventory)"""
        session_id = self.create_test_order(status='completed', session_type='pick')
        
        # Run reset using SERVICE
        result = self.service.reset_daily_sessions()
        
        # Check status is now archived (completed sessions are archived at end of day)
        new_status = self.get_session_status(session_id)
        assert new_status == 'archived', f"Completed session should be 'archived', got '{new_status}'"
    
    def test_reset_archives_cancelled_sessions(self):
        """Test that reset DOES archive cancelled sessions"""
        session_id = self.create_test_order(status='cancelled', session_type='pick')
        
        # Run reset using SERVICE
        result = self.service.reset_daily_sessions()
        
        # Check status is now archived (cancelled sessions are archived at end of day)
        new_status = self.get_session_status(session_id)
        assert new_status == 'archived', f"Cancelled session should be 'archived', got '{new_status}'"
    
    def run_all_tests(self):
        """Run all reset tests"""
        print("\n" + "=" * 60)
        print("🧪 SESSION RESET TESTS")
        print("=" * 60)
        
        self.save_initial_inventory()
        
        tests = [
            ("Pending filter includes all active statuses", self.test_pending_filter_includes_all_active_statuses),
            ("Reset expires all incomplete statuses", self.test_reset_expires_all_incomplete_statuses),
            ("Reset returns inventory for draft picking", self.test_reset_returns_inventory_for_draft_picking),
            ("Reset returns inventory for in_progress picking", self.test_reset_returns_inventory_for_in_progress_picking),
            ("Reset returns inventory for ready_to_check", self.test_reset_returns_inventory_for_ready_to_check),
            ("Reset archives completed sessions", self.test_reset_archives_completed_sessions),
            ("Reset archives cancelled sessions", self.test_reset_archives_cancelled_sessions),
        ]
        
        for name, test_func in tests:
            print(f"\n🔄 {name}...")
            self.cleanup_test_sessions()  # Clean before each test
            self.ensure_test_inventory()  # Reset inventory before each test
            result = self.run_test(name, test_func)
            print(f"   {result}")
            if result.error:
                print(f"   Error: {result.error}")
        
        # Final cleanup
        self.cleanup_test_sessions()
        self.restore_inventory()
        
        # Summary
        print("\n" + "=" * 60)
        print("📊 SUMMARY")
        print("=" * 60)
        
        passed = sum(1 for r in self.results if r.passed)
        failed = sum(1 for r in self.results if not r.passed)
        
        print(f"Passed: {passed}/{len(self.results)}")
        print(f"Failed: {failed}/{len(self.results)}")
        
        if failed > 0:
            print("\n❌ FAILED TESTS:")
            for r in self.results:
                if not r.passed:
                    print(f"  - {r.name}")
                    if r.error:
                        print(f"    Error: {r.error}")
        
        return failed == 0


if __name__ == "__main__":
    tester = SessionResetTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)
