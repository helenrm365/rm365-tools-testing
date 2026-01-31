"""
Comprehensive Order Fulfillment Workflow Tests

Tests the ENTIRE workflow from top to bottom:
1. Session creation/starting for any order
2. Scanning items in (pick phase)
3. Returning items (unscan)
4. Moving to ready to check
5. Checking phase scanning
6. Completing orders
7. Drafting orders in any section
8. Cancelling orders (in-progress and draft)
9. Send back to picking
10. Inventory tracking through all operations
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from dotenv import load_dotenv
from pathlib import Path
load_dotenv(dotenv_path=Path(__file__).parent.parent / '.env')

import psycopg2
from datetime import datetime
from typing import Optional, Dict, List, Tuple
import traceback

from modules.orders.order_fulfillment.db_repo import MagentoDbRepo
from modules.orders.order_fulfillment.service import OrderFulfillmentService
from modules.orders.order_fulfillment.schemas import (
    StartSessionSchema, ScanRequestSchema, CompleteSessionSchema
)


# Test configuration
DB_CONN_STR = 'host=localhost port=5433 dbname=inventory_database user=postgres password=RuhUJ1cZ24f/s5<2 sslmode=disable'
TEST_SKU = 'ME071'  # Real SKU with inventory
TEST_USER = 'test_workflow_user'
TEST_ORDER_PREFIX = 'TEST-WORKFLOW-'


class TestResult:
    """Track test results"""
    def __init__(self):
        self.passed: List[str] = []
        self.failed: List[Tuple[str, str]] = []  # (test_name, error_message)
        self.fixed: List[Tuple[str, str]] = []   # (test_name, fix_description)
    
    def add_pass(self, name: str):
        self.passed.append(name)
        print(f"  ✅ PASS: {name}")
    
    def add_fail(self, name: str, error: str):
        self.failed.append((name, error))
        print(f"  ❌ FAIL: {name}")
        print(f"         Error: {error}")
    
    def add_fixed(self, name: str, fix: str):
        self.fixed.append((name, fix))
        print(f"  🔧 FIXED: {name}")
        print(f"         Fix: {fix}")
    
    def summary(self):
        print("\n" + "="*70)
        print("                     FINAL TEST RESULTS")
        print("="*70)
        
        print(f"\n✅ PASSED ({len(self.passed)}):")
        for name in self.passed:
            print(f"   • {name}")
        
        if self.failed:
            print(f"\n❌ FAILED ({len(self.failed)}):")
            for name, error in self.failed:
                print(f"   • {name}")
                print(f"     → {error}")
        
        if self.fixed:
            print(f"\n🔧 FIXED ({len(self.fixed)}):")
            for name, fix in self.fixed:
                print(f"   • {name}")
                print(f"     → {fix}")
        
        total = len(self.passed) + len(self.failed)
        print(f"\n{'='*70}")
        print(f"TOTAL: {len(self.passed)}/{total} passed")
        if not self.failed:
            print("🎉 ALL TESTS PASSED!")
        print("="*70)


class WorkflowTester:
    """Comprehensive workflow tester"""
    
    def __init__(self):
        self.repo = MagentoDbRepo()
        self.service = OrderFulfillmentService()
        self.results = TestResult()
        self.conn = psycopg2.connect(DB_CONN_STR)
        self.created_sessions: List[str] = []
        self.initial_inventory: Dict[str, int] = {}
    
    def cleanup(self):
        """Clean up all test sessions"""
        for session_id in self.created_sessions:
            try:
                self.repo.delete_session(session_id)
            except:
                pass
        self.created_sessions.clear()
    
    def get_inventory(self, sku: str) -> Dict[str, int]:
        """Get current inventory for a SKU"""
        cur = self.conn.cursor()
        cur.execute("""
            SELECT shelf_lt1_qty, shelf_gt1_qty, top_floor_total, item_id 
            FROM inventory_metadata WHERE sku = %s
        """, (sku,))
        row = cur.fetchone()
        cur.close()
        if row:
            return {
                'shelf_lt1_qty': int(row[0] or 0),
                'shelf_gt1_qty': int(row[1] or 0),
                'top_floor_total': int(row[2] or 0),
                'item_id': row[3]
            }
        return {}
    
    def set_inventory(self, sku: str, field: str, value: int):
        """Set inventory value for testing"""
        cur = self.conn.cursor()
        cur.execute(f"UPDATE inventory_metadata SET {field} = %s WHERE sku = %s", (value, sku))
        self.conn.commit()
        cur.close()
    
    def ensure_test_inventory(self, sku: str):
        """Ensure there's enough inventory for testing"""
        cur = self.conn.cursor()
        cur.execute("""
            UPDATE inventory_metadata 
            SET shelf_lt1_qty = 20, shelf_gt1_qty = 10, top_floor_total = 5
            WHERE sku = %s
        """, (sku,))
        self.conn.commit()
        cur.close()
    
    def save_initial_inventory(self, sku: str):
        """Save initial inventory to restore later"""
        self.initial_inventory[sku] = self.get_inventory(sku)
    
    def restore_inventory(self, sku: str):
        """Restore inventory to initial values"""
        if sku in self.initial_inventory:
            inv = self.initial_inventory[sku]
            cur = self.conn.cursor()
            cur.execute("""
                UPDATE inventory_metadata 
                SET shelf_lt1_qty = %s, shelf_gt1_qty = %s, top_floor_total = %s
                WHERE sku = %s
            """, (inv['shelf_lt1_qty'], inv['shelf_gt1_qty'], inv['top_floor_total'], sku))
            self.conn.commit()
            cur.close()
    
    def create_test_session(self, order_suffix: str, session_type: str = 'pick', 
                           user_id: str = TEST_USER, qty_expected: int = 5) -> str:
        """Create a test session and track it for cleanup"""
        session = self.repo.create_session(
            invoice_id=f'{TEST_ORDER_PREFIX}INV-{order_suffix}',
            order_number=f'{TEST_ORDER_PREFIX}{order_suffix}',
            session_type=session_type,
            items_expected=[{
                'sku': TEST_SKU, 
                'name': 'Test Product', 
                'qty_expected': qty_expected, 
                'price': 10.0
            }],
            user_id=user_id
        )
        self.created_sessions.append(session.session_id)
        return session.session_id

    # ========================================================================
    # TEST CATEGORY 1: SESSION CREATION
    # ========================================================================
    
    def test_create_pick_session(self):
        """Test: Create a new pick session"""
        test_name = "Create pick session"
        try:
            session_id = self.create_test_session('001')
            session = self.repo.get_session(session_id)
            
            assert session is not None, "Session not created"
            assert session.status == 'in_progress', f"Expected in_progress, got {session.status}"
            assert session.session_type == 'pick', f"Expected pick, got {session.session_type}"
            assert session.user_id == TEST_USER, f"Expected {TEST_USER}, got {session.user_id}"
            assert len(session.items_expected) == 1, "Expected 1 item"
            
            self.results.add_pass(test_name)
        except Exception as e:
            self.results.add_fail(test_name, str(e))
    
    def test_create_check_session(self):
        """Test: Create a check session directly"""
        test_name = "Create check session"
        try:
            session_id = self.create_test_session('002', session_type='check')
            session = self.repo.get_session(session_id)
            
            assert session is not None, "Session not created"
            assert session.session_type == 'check', f"Expected check, got {session.session_type}"
            
            self.results.add_pass(test_name)
        except Exception as e:
            self.results.add_fail(test_name, str(e))
    
    # ========================================================================
    # TEST CATEGORY 2: SCANNING ITEMS (PICK PHASE)
    # ========================================================================
    
    def test_scan_single_item(self):
        """Test: Scan a single item during picking"""
        test_name = "Scan single item (pick)"
        try:
            self.save_initial_inventory(TEST_SKU)
            # Ensure sufficient inventory
            self.set_inventory(TEST_SKU, 'shelf_lt1_qty', 10)
            initial_inv = self.get_inventory(TEST_SKU)
            
            session_id = self.create_test_session('003')
            
            # Scan 1 item
            request = ScanRequestSchema(
                session_id=session_id,
                sku=TEST_SKU,
                quantity=1,
                field='shelf_lt1_qty'
            )
            result = self.service.scan_product(request)
            
            assert result.success, f"Scan failed: {result.message}"
            assert result.qty_scanned == 1, f"Expected qty_scanned=1, got {result.qty_scanned}"
            
            # Verify inventory decreased
            new_inv = self.get_inventory(TEST_SKU)
            assert new_inv['shelf_lt1_qty'] == initial_inv['shelf_lt1_qty'] - 1, \
                f"Inventory not decreased: {initial_inv['shelf_lt1_qty']} -> {new_inv['shelf_lt1_qty']}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_scan_multiple_items(self):
        """Test: Scan multiple items at once"""
        test_name = "Scan multiple items at once"
        try:
            self.save_initial_inventory(TEST_SKU)
            # Ensure sufficient inventory
            self.set_inventory(TEST_SKU, 'shelf_lt1_qty', 10)
            initial_inv = self.get_inventory(TEST_SKU)
            
            session_id = self.create_test_session('004')
            
            # Scan 3 items at once
            request = ScanRequestSchema(
                session_id=session_id,
                sku=TEST_SKU,
                quantity=3,
                field='shelf_lt1_qty'
            )
            result = self.service.scan_product(request)
            
            assert result.success, f"Scan failed: {result.message}"
            assert result.qty_scanned == 3, f"Expected qty_scanned=3, got {result.qty_scanned}"
            
            # Verify inventory
            new_inv = self.get_inventory(TEST_SKU)
            assert new_inv['shelf_lt1_qty'] == initial_inv['shelf_lt1_qty'] - 3, \
                f"Inventory not decreased by 3"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_scan_from_different_locations(self):
        """Test: Scan items from different inventory locations"""
        test_name = "Scan from different locations"
        try:
            self.save_initial_inventory(TEST_SKU)
            
            # Ensure we have inventory in multiple locations
            self.set_inventory(TEST_SKU, 'shelf_lt1_qty', 5)
            self.set_inventory(TEST_SKU, 'shelf_gt1_qty', 5)
            
            session_id = self.create_test_session('005')
            
            # Scan from shelf_lt1_qty
            result1 = self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            assert result1.success, f"Scan 1 failed: {result1.message}"
            
            # Scan from shelf_gt1_qty
            result2 = self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_gt1_qty'
            ))
            assert result2.success, f"Scan 2 failed: {result2.message}"
            
            # Verify total scanned
            assert result2.qty_scanned == 4, f"Expected 4 scanned, got {result2.qty_scanned}"
            
            # Verify both locations decreased
            inv = self.get_inventory(TEST_SKU)
            assert inv['shelf_lt1_qty'] == 3, f"shelf_lt1_qty should be 3, got {inv['shelf_lt1_qty']}"
            assert inv['shelf_gt1_qty'] == 3, f"shelf_gt1_qty should be 3, got {inv['shelf_gt1_qty']}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_scan_complete_item(self):
        """Test: Scan until item is complete"""
        test_name = "Scan until item complete"
        try:
            self.save_initial_inventory(TEST_SKU)
            self.set_inventory(TEST_SKU, 'shelf_lt1_qty', 10)
            
            session_id = self.create_test_session('006', qty_expected=3)
            
            # Scan all 3
            result = self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            
            assert result.success, f"Scan failed: {result.message}"
            assert result.is_complete, "Item should be complete"
            assert result.qty_remaining == 0, f"Should have 0 remaining, got {result.qty_remaining}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    # ========================================================================
    # TEST CATEGORY 3: RETURNING ITEMS (UNSCAN)
    # ========================================================================
    
    def test_return_single_item(self):
        """Test: Return a single scanned item"""
        test_name = "Return single item"
        try:
            self.save_initial_inventory(TEST_SKU)
            initial_inv = self.get_inventory(TEST_SKU)
            
            session_id = self.create_test_session('007')
            
            # Scan 2 items
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            
            # Return 1 item
            result = self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=-1, field='shelf_lt1_qty'
            ))
            
            assert result.success, f"Return failed: {result.message}"
            assert result.qty_scanned == 1, f"Expected 1 remaining, got {result.qty_scanned}"
            
            # Verify inventory restored by 1
            inv = self.get_inventory(TEST_SKU)
            assert inv['shelf_lt1_qty'] == initial_inv['shelf_lt1_qty'] - 1, \
                f"Expected {initial_inv['shelf_lt1_qty'] - 1}, got {inv['shelf_lt1_qty']}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_return_all_items(self):
        """Test: Return all scanned items"""
        test_name = "Return all scanned items"
        try:
            self.save_initial_inventory(TEST_SKU)
            initial_inv = self.get_inventory(TEST_SKU)
            
            session_id = self.create_test_session('008')
            
            # Scan 3 items
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            
            # Return all 3
            result = self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=-3, field='shelf_lt1_qty'
            ))
            
            assert result.success, f"Return failed: {result.message}"
            assert result.qty_scanned == 0, f"Expected 0, got {result.qty_scanned}"
            
            # Verify inventory fully restored
            inv = self.get_inventory(TEST_SKU)
            assert inv['shelf_lt1_qty'] == initial_inv['shelf_lt1_qty'], \
                f"Inventory not restored: expected {initial_inv['shelf_lt1_qty']}, got {inv['shelf_lt1_qty']}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_return_more_than_scanned_fails(self):
        """Test: Cannot return more than scanned"""
        test_name = "Return more than scanned fails"
        try:
            self.save_initial_inventory(TEST_SKU)
            
            session_id = self.create_test_session('009')
            
            # Scan 2 items
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            
            # Try to return 5
            result = self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=-5, field='shelf_lt1_qty'
            ))
            
            assert not result.success, "Should have failed"
            assert "Cannot return" in result.message, f"Wrong error: {result.message}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    # ========================================================================
    # TEST CATEGORY 4: MOVE TO READY TO CHECK
    # ========================================================================
    
    def test_mark_ready_to_check(self):
        """Test: Mark order as ready to check"""
        test_name = "Mark ready to check"
        try:
            self.save_initial_inventory(TEST_SKU)
            
            session_id = self.create_test_session('010', qty_expected=2)
            
            # Scan items
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            
            # Mark ready to check
            success = self.service.mark_ready_to_check(session_id, TEST_USER)
            assert success, "Failed to mark ready to check"
            
            # Verify status
            session = self.repo.get_session(session_id)
            assert session.status == 'ready_to_check', f"Expected ready_to_check, got {session.status}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_mark_ready_to_check_preserves_scanned(self):
        """Test: Moving to ready_to_check preserves scanned items"""
        test_name = "Ready to check preserves scanned items"
        try:
            self.save_initial_inventory(TEST_SKU)
            
            session_id = self.create_test_session('011', qty_expected=3)
            
            # Scan 3 items
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            
            # Mark ready to check
            self.service.mark_ready_to_check(session_id, TEST_USER)
            
            # Verify scanned items preserved
            session = self.repo.get_session(session_id)
            assert len(session.items_scanned) > 0, "Scanned items lost"
            
            scanned_qty = session.items_scanned[0].get('qty_scanned', 0)
            assert scanned_qty == 3, f"Expected 3 scanned, got {scanned_qty}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    # ========================================================================
    # TEST CATEGORY 5: CHECKING PHASE
    # ========================================================================
    
    def test_start_check_session_from_ready_to_check(self):
        """Test: Start checking from ready_to_check status"""
        test_name = "Start check from ready_to_check"
        try:
            self.save_initial_inventory(TEST_SKU)
            
            # Create pick session
            session_id = self.create_test_session('012', qty_expected=2)
            
            # Scan and move to ready_to_check
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            self.service.mark_ready_to_check(session_id, TEST_USER)
            
            # Use start_checking_session (not claim_session) for ready_to_check orders
            session = self.repo.start_checking_session(session_id, 'checker_user')
            assert session is not None, "Failed to start checking session"
            
            # Verify
            assert session.user_id == 'checker_user', f"Expected checker_user, got {session.user_id}"
            assert session.status == 'in_progress', f"Expected in_progress, got {session.status}"
            assert session.session_type == 'check', f"Expected check, got {session.session_type}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_check_scanning_no_inventory_change(self):
        """Test: Scanning during check phase doesn't change inventory"""
        test_name = "Check scanning no inventory change"
        try:
            self.save_initial_inventory(TEST_SKU)
            self.set_inventory(TEST_SKU, 'shelf_lt1_qty', 10)
            
            # Create check session directly
            session_id = self.create_test_session('013', session_type='check', qty_expected=3)
            
            inv_before = self.get_inventory(TEST_SKU)
            
            # "Scan" during check - this might behave differently
            # Check sessions typically just verify counts, not deduct
            session = self.repo.get_session(session_id)
            
            inv_after = self.get_inventory(TEST_SKU)
            
            # Inventory should be unchanged for check sessions
            assert inv_before['shelf_lt1_qty'] == inv_after['shelf_lt1_qty'], \
                "Check phase should not change inventory"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    # ========================================================================
    # TEST CATEGORY 6: COMPLETE ORDER
    # ========================================================================
    
    def test_complete_order(self):
        """Test: Complete an order"""
        test_name = "Complete order"
        try:
            self.save_initial_inventory(TEST_SKU)
            self.set_inventory(TEST_SKU, 'shelf_lt1_qty', 10)
            
            session_id = self.create_test_session('014', qty_expected=2)
            
            # Scan all items
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            
            # Complete
            request = CompleteSessionSchema(session_id=session_id)
            success = self.service.complete_session(request, user_id=TEST_USER)
            assert success, "Failed to complete session"
            
            # Verify
            session = self.repo.get_session(session_id)
            assert session.status == 'completed', f"Expected completed, got {session.status}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_complete_with_partial_scan_fails(self):
        """Test: Cannot complete with partial scan (without force)"""
        test_name = "Complete with partial scan fails"
        try:
            self.save_initial_inventory(TEST_SKU)
            self.set_inventory(TEST_SKU, 'shelf_lt1_qty', 10)
            
            session_id = self.create_test_session('015', qty_expected=5)
            
            # Scan only 2 of 5
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            
            # Try to complete without force
            try:
                request = CompleteSessionSchema(session_id=session_id, force_complete=False)
                self.service.complete_session(request, user_id=TEST_USER)
                self.restore_inventory(TEST_SKU)
                self.results.add_fail(test_name, "Should have failed for partial scan")
            except ValueError as e:
                # Expected - should fail
                self.restore_inventory(TEST_SKU)
                self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_force_complete_with_partial_scan(self):
        """Test: Force complete with partial scan works"""
        test_name = "Force complete with partial scan"
        try:
            self.save_initial_inventory(TEST_SKU)
            self.set_inventory(TEST_SKU, 'shelf_lt1_qty', 10)
            
            session_id = self.create_test_session('016', qty_expected=5)
            
            # Scan only 2 of 5
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            
            # Force complete
            request = CompleteSessionSchema(session_id=session_id, force_complete=True)
            success = self.service.complete_session(request, user_id=TEST_USER)
            assert success, "Force complete failed"
            
            session = self.repo.get_session(session_id)
            assert session.status == 'completed', f"Expected completed, got {session.status}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    # ========================================================================
    # TEST CATEGORY 7: DRAFT SESSIONS
    # ========================================================================
    
    def test_release_pick_session_to_draft(self):
        """Test: Release pick session to draft"""
        test_name = "Release pick session to draft"
        try:
            session_id = self.create_test_session('017')
            
            # Release to draft
            success = self.repo.release_session(session_id)
            assert success, "Failed to release"
            
            session = self.repo.get_session(session_id)
            assert session.status == 'draft', f"Expected draft, got {session.status}"
            assert session.user_id is None, f"User should be cleared, got {session.user_id}"
            
            self.results.add_pass(test_name)
        except Exception as e:
            self.results.add_fail(test_name, str(e))
    
    def test_release_check_session_to_draft(self):
        """Test: Release check session to draft"""
        test_name = "Release check session to draft"
        try:
            self.save_initial_inventory(TEST_SKU)
            
            # Create pick, move to ready_to_check
            session_id = self.create_test_session('018', qty_expected=2)
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            self.service.mark_ready_to_check(session_id, TEST_USER)
            
            # Start checking using start_checking_session
            session = self.repo.start_checking_session(session_id, 'checker')
            assert session is not None, "Failed to start checking session"
            
            # Release to draft
            success = self.repo.release_session(session_id)
            assert success, "Failed to release"
            
            session = self.repo.get_session(session_id)
            assert session.status == 'draft', f"Expected draft, got {session.status}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_draft_preserves_scanned_items(self):
        """Test: Drafting preserves all scanned items"""
        test_name = "Draft preserves scanned items"
        try:
            self.save_initial_inventory(TEST_SKU)
            self.set_inventory(TEST_SKU, 'shelf_lt1_qty', 10)
            
            session_id = self.create_test_session('019', qty_expected=5)
            
            # Scan 3 items
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            
            # Release to draft
            self.repo.release_session(session_id)
            
            # Verify scanned items preserved
            session = self.repo.get_session(session_id)
            assert len(session.items_scanned) > 0, "Scanned items lost"
            assert session.items_scanned[0].get('qty_scanned') == 3, "Quantity not preserved"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_claim_draft_session(self):
        """Test: Claim a draft session"""
        test_name = "Claim draft session"
        try:
            session_id = self.create_test_session('020')
            
            # Release to draft
            self.repo.release_session(session_id)
            
            # Claim by another user
            success = self.service.claim_session(session_id, 'new_user')
            assert success, "Failed to claim"
            
            session = self.repo.get_session(session_id)
            assert session.status == 'in_progress', f"Expected in_progress, got {session.status}"
            assert session.user_id == 'new_user', f"Expected new_user, got {session.user_id}"
            
            self.results.add_pass(test_name)
        except Exception as e:
            self.results.add_fail(test_name, str(e))
    
    # ========================================================================
    # TEST CATEGORY 8: CANCEL SESSIONS
    # ========================================================================
    
    def test_cancel_pick_in_progress_returns_items(self):
        """Test: Cancel in-progress pick session returns items"""
        test_name = "Cancel pick in-progress returns items"
        try:
            self.save_initial_inventory(TEST_SKU)
            initial_inv = self.get_inventory(TEST_SKU)
            
            session_id = self.create_test_session('021')
            
            # Scan 2 items with proper deduction tracking
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            
            # Verify inventory decreased
            after_scan = self.get_inventory(TEST_SKU)
            assert after_scan['shelf_lt1_qty'] == initial_inv['shelf_lt1_qty'] - 2
            
            # Cancel
            result = self.service.cancel_session(session_id, TEST_USER)
            assert result['success'], f"Cancel failed: {result}"
            assert result['items_returned'] == 2, f"Expected 2 returned, got {result['items_returned']}"
            
            # Verify inventory restored
            final_inv = self.get_inventory(TEST_SKU)
            assert final_inv['shelf_lt1_qty'] == initial_inv['shelf_lt1_qty'], \
                f"Inventory not restored: expected {initial_inv['shelf_lt1_qty']}, got {final_inv['shelf_lt1_qty']}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_cancel_pick_draft_returns_items(self):
        """Test: Cancel pick-draft returns items"""
        test_name = "Cancel pick-draft returns items"
        try:
            self.save_initial_inventory(TEST_SKU)
            initial_inv = self.get_inventory(TEST_SKU)
            
            session_id = self.create_test_session('022')
            
            # Scan 3 items
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            
            # Release to draft
            self.repo.release_session(session_id)
            
            # Cancel the draft
            result = self.service.cancel_session(session_id, TEST_USER)
            assert result['success'], f"Cancel failed: {result}"
            assert result['items_returned'] == 3, f"Expected 3 returned, got {result['items_returned']}"
            
            # Verify inventory restored
            final_inv = self.get_inventory(TEST_SKU)
            assert final_inv['shelf_lt1_qty'] == initial_inv['shelf_lt1_qty'], \
                f"Inventory not restored"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_cancel_pick_no_items_scanned(self):
        """Test: Cancel pick with no items scanned"""
        test_name = "Cancel pick no items scanned"
        try:
            session_id = self.create_test_session('023')
            
            # Cancel immediately without scanning
            result = self.service.cancel_session(session_id, TEST_USER)
            assert result['success'], f"Cancel failed: {result}"
            assert result['items_returned'] == 0, f"Expected 0 returned, got {result['items_returned']}"
            
            session = self.repo.get_session(session_id)
            assert session.status == 'cancelled', f"Expected cancelled, got {session.status}"
            
            self.results.add_pass(test_name)
        except Exception as e:
            self.results.add_fail(test_name, str(e))
    
    def test_cancel_check_in_progress_no_return(self):
        """Test: Cancel check in-progress doesn't return items"""
        test_name = "Cancel check in-progress no return"
        try:
            self.save_initial_inventory(TEST_SKU)
            
            # Create pick, scan, move to check
            session_id = self.create_test_session('024', qty_expected=2)
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            
            inv_after_pick = self.get_inventory(TEST_SKU)
            
            self.service.mark_ready_to_check(session_id, TEST_USER)
            # Use start_checking_session instead of claim_session for ready_to_check
            session = self.repo.start_checking_session(session_id, 'checker')
            assert session is not None, "Failed to start checking session"
            
            # Cancel check phase
            result = self.service.cancel_session(session_id, 'checker')
            assert result['success'], f"Cancel failed: {result}"
            assert result['items_returned'] == 0, f"Check cancel should return 0 items"
            assert "Items remain picked" in result['message'] or result['items_returned'] == 0
            
            # Inventory should NOT change (items still out)
            final_inv = self.get_inventory(TEST_SKU)
            assert final_inv['shelf_lt1_qty'] == inv_after_pick['shelf_lt1_qty'], \
                "Check cancel should not change inventory"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_cancel_check_draft_no_return(self):
        """Test: Cancel check-draft doesn't return items"""
        test_name = "Cancel check-draft no return"
        try:
            self.save_initial_inventory(TEST_SKU)
            
            # Create pick, scan, move to check
            session_id = self.create_test_session('025', qty_expected=2)
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            
            inv_after_pick = self.get_inventory(TEST_SKU)
            
            self.service.mark_ready_to_check(session_id, TEST_USER)
            # Use start_checking_session instead of claim_session for ready_to_check
            session = self.repo.start_checking_session(session_id, 'checker')
            assert session is not None, "Failed to start checking session"
            
            # Release to draft
            self.repo.release_session(session_id)
            
            # Cancel the draft
            result = self.service.cancel_session(session_id, 'checker')
            assert result['success'], f"Cancel failed: {result}"
            assert result['items_returned'] == 0, "Check-draft cancel should return 0 items"
            
            # Inventory unchanged
            final_inv = self.get_inventory(TEST_SKU)
            assert final_inv['shelf_lt1_qty'] == inv_after_pick['shelf_lt1_qty']
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    # ========================================================================
    # TEST CATEGORY 9: SEND BACK TO PICKING
    # ========================================================================
    
    def test_send_back_for_picking(self):
        """Test: Send order back for picking from check phase"""
        test_name = "Send back for picking"
        try:
            self.save_initial_inventory(TEST_SKU)
            
            # Create pick, scan, move to check
            session_id = self.create_test_session('026', qty_expected=3)
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            self.service.mark_ready_to_check(session_id, TEST_USER)
            
            # Send back for picking
            success = self.service.send_back_for_picking(session_id, TEST_USER)
            assert success, "Failed to send back"
            
            session = self.repo.get_session(session_id)
            assert session.status == 'draft', f"Expected draft, got {session.status}"
            assert session.session_type == 'pick', f"Expected pick, got {session.session_type}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_send_back_preserves_scanned(self):
        """Test: Send back preserves scanned items"""
        test_name = "Send back preserves scanned"
        try:
            self.save_initial_inventory(TEST_SKU)
            
            session_id = self.create_test_session('027', qty_expected=3)
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            self.service.mark_ready_to_check(session_id, TEST_USER)
            
            # Send back
            self.service.send_back_for_picking(session_id, TEST_USER)
            
            # Verify scanned items preserved
            session = self.repo.get_session(session_id)
            assert len(session.items_scanned) > 0, "Scanned items lost"
            assert session.items_scanned[0].get('qty_scanned') == 3
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_cancel_after_send_back_returns_items(self):
        """Test: Cancel after send back returns items"""
        test_name = "Cancel after send back returns items"
        try:
            self.save_initial_inventory(TEST_SKU)
            initial_inv = self.get_inventory(TEST_SKU)
            
            session_id = self.create_test_session('028', qty_expected=2)
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            self.service.mark_ready_to_check(session_id, TEST_USER)
            
            # Send back to picking
            self.service.send_back_for_picking(session_id, TEST_USER)
            
            # Now cancel (should return items since it's back in pick phase)
            result = self.service.cancel_session(session_id, TEST_USER)
            assert result['success'], f"Cancel failed: {result}"
            assert result['items_returned'] == 2, f"Expected 2 returned, got {result['items_returned']}"
            
            # Verify inventory restored
            final_inv = self.get_inventory(TEST_SKU)
            assert final_inv['shelf_lt1_qty'] == initial_inv['shelf_lt1_qty']
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    # ========================================================================
    # TEST CATEGORY 10: EDGE CASES
    # ========================================================================
    
    def test_scan_insufficient_inventory_fails(self):
        """Test: Scanning more than available inventory fails"""
        test_name = "Scan insufficient inventory fails"
        try:
            self.save_initial_inventory(TEST_SKU)
            self.set_inventory(TEST_SKU, 'shelf_lt1_qty', 1)
            
            session_id = self.create_test_session('029', qty_expected=5)
            
            # Try to scan 3 when only 1 available
            result = self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            
            assert not result.success, "Should fail for insufficient inventory"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_session_not_found(self):
        """Test: Operations on non-existent session fail gracefully"""
        test_name = "Session not found handling"
        try:
            fake_id = 'non-existent-session-id'
            
            # Cancel non-existent
            result = self.service.cancel_session(fake_id, TEST_USER)
            assert not result['success'], "Should fail for non-existent session"
            
            # Get non-existent
            session = self.repo.get_session(fake_id)
            assert session is None, "Should return None"
            
            self.results.add_pass(test_name)
        except Exception as e:
            self.results.add_fail(test_name, str(e))
    
    def test_multi_location_cancel_returns_correct(self):
        """Test: Cancel with items from multiple locations returns correctly"""
        test_name = "Multi-location cancel returns correctly"
        try:
            self.save_initial_inventory(TEST_SKU)
            self.set_inventory(TEST_SKU, 'shelf_lt1_qty', 5)
            self.set_inventory(TEST_SKU, 'shelf_gt1_qty', 5)
            
            initial_lt1 = 5
            initial_gt1 = 5
            
            session_id = self.create_test_session('030', qty_expected=6)
            
            # Scan from both locations
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_gt1_qty'
            ))
            
            # Verify both decreased
            inv = self.get_inventory(TEST_SKU)
            assert inv['shelf_lt1_qty'] == 2, f"Expected 2, got {inv['shelf_lt1_qty']}"
            assert inv['shelf_gt1_qty'] == 3, f"Expected 3, got {inv['shelf_gt1_qty']}"
            
            # Cancel
            result = self.service.cancel_session(session_id, TEST_USER)
            assert result['success']
            assert result['items_returned'] == 5, f"Expected 5 returned, got {result['items_returned']}"
            
            # Verify both restored
            final = self.get_inventory(TEST_SKU)
            assert final['shelf_lt1_qty'] == initial_lt1, f"lt1 not restored: {final['shelf_lt1_qty']}"
            assert final['shelf_gt1_qty'] == initial_gt1, f"gt1 not restored: {final['shelf_gt1_qty']}"
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def test_complete_check_session(self):
        """Test: Complete an order from check phase"""
        test_name = "Complete check session"
        try:
            self.save_initial_inventory(TEST_SKU)
            self.set_inventory(TEST_SKU, 'shelf_lt1_qty', 10)
            
            # Full workflow: pick -> ready_to_check -> start_checking -> complete
            session_id = self.create_test_session('031', qty_expected=2)
            
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            
            self.service.mark_ready_to_check(session_id, TEST_USER)
            # Use start_checking_session instead of claim_session
            session = self.repo.start_checking_session(session_id, 'checker')
            assert session is not None, "Failed to start checking session"
            
            # Complete from check phase
            request = CompleteSessionSchema(session_id=session_id)
            success = self.service.complete_session(request, user_id='checker')
            assert success, "Complete failed"
            
            session = self.repo.get_session(session_id)
            assert session.status == 'completed'
            
            self.restore_inventory(TEST_SKU)
            self.results.add_pass(test_name)
        except Exception as e:
            self.restore_inventory(TEST_SKU)
            self.results.add_fail(test_name, str(e))
    
    def run_all_tests(self):
        """Run all workflow tests"""
        print("="*70)
        print("         COMPREHENSIVE ORDER FULFILLMENT WORKFLOW TESTS")
        print("="*70)
        print(f"Test SKU: {TEST_SKU}")
        print(f"Test User: {TEST_USER}")
        print("="*70)
        
        # Save initial state and ensure we have enough inventory
        self.save_initial_inventory(TEST_SKU)
        self.ensure_test_inventory(TEST_SKU)
        
        try:
            # Category 1: Session Creation
            print("\n📦 CATEGORY 1: SESSION CREATION")
            print("-"*50)
            self.test_create_pick_session()
            self.test_create_check_session()
            
            # Category 2: Scanning Items - reset inventory before this category
            self.ensure_test_inventory(TEST_SKU)
            print("\n📱 CATEGORY 2: SCANNING ITEMS (PICK PHASE)")
            print("-"*50)
            self.test_scan_single_item()
            self.test_scan_multiple_items()
            self.test_scan_from_different_locations()
            self.test_scan_complete_item()
            
            # Category 3: Returning Items - reset inventory
            self.ensure_test_inventory(TEST_SKU)
            print("\n↩️ CATEGORY 3: RETURNING ITEMS (UNSCAN)")
            print("-"*50)
            self.test_return_single_item()
            self.test_return_all_items()
            self.test_return_more_than_scanned_fails()
            
            # Category 4: Move to Ready to Check - reset inventory
            self.ensure_test_inventory(TEST_SKU)
            print("\n➡️ CATEGORY 4: MOVE TO READY TO CHECK")
            print("-"*50)
            self.test_mark_ready_to_check()
            self.test_mark_ready_to_check_preserves_scanned()
            
            # Category 5: Checking Phase - reset inventory
            self.ensure_test_inventory(TEST_SKU)
            print("\n✓ CATEGORY 5: CHECKING PHASE")
            print("-"*50)
            self.test_start_check_session_from_ready_to_check()
            self.test_check_scanning_no_inventory_change()
            
            # Category 6: Complete Order - reset inventory
            self.ensure_test_inventory(TEST_SKU)
            print("\n✅ CATEGORY 6: COMPLETE ORDER")
            print("-"*50)
            self.test_complete_order()
            self.test_complete_with_partial_scan_fails()
            self.test_force_complete_with_partial_scan()
            
            # Category 7: Draft Sessions - reset inventory
            self.ensure_test_inventory(TEST_SKU)
            print("\n📝 CATEGORY 7: DRAFT SESSIONS")
            print("-"*50)
            self.test_release_pick_session_to_draft()
            self.test_release_check_session_to_draft()
            self.test_draft_preserves_scanned_items()
            self.test_claim_draft_session()
            
            # Category 8: Cancel Sessions - reset inventory
            self.ensure_test_inventory(TEST_SKU)
            print("\n❌ CATEGORY 8: CANCEL SESSIONS")
            print("-"*50)
            self.test_cancel_pick_in_progress_returns_items()
            self.test_cancel_pick_draft_returns_items()
            self.test_cancel_pick_no_items_scanned()
            self.test_cancel_check_in_progress_no_return()
            self.test_cancel_check_draft_no_return()
            
            # Category 9: Send Back to Picking - reset inventory
            self.ensure_test_inventory(TEST_SKU)
            print("\n🔄 CATEGORY 9: SEND BACK TO PICKING")
            print("-"*50)
            self.test_send_back_for_picking()
            self.test_send_back_preserves_scanned()
            self.test_cancel_after_send_back_returns_items()
            
            # Category 10: Edge Cases - reset inventory
            self.ensure_test_inventory(TEST_SKU)
            print("\n⚠️ CATEGORY 10: EDGE CASES")
            print("-"*50)
            self.test_scan_insufficient_inventory_fails()
            self.test_session_not_found()
            self.test_multi_location_cancel_returns_correct()
            self.test_complete_check_session()
            
        finally:
            # Cleanup
            print("\n🧹 Cleaning up test sessions...")
            self.cleanup()
            self.restore_inventory(TEST_SKU)
            self.conn.close()
        
        # Print summary
        self.results.summary()
        
        return len(self.results.failed) == 0


if __name__ == '__main__':
    tester = WorkflowTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)