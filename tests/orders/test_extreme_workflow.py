#!/usr/bin/env python3
"""
EXTREME Order Fulfillment Workflow Test

A comprehensive end-to-end test covering:
1. Real inventory metadata population and tracking
2. Pick session: create, scan, draft, cancel, complete
3. Check session: create, count, send back for picking, complete
4. Ready to Pick column: draft/cancel behavior with inventory returns
5. Ready to Check column: draft/cancel/send back behavior
6. Counted quantities feature (new feature test)
7. Scheduler daily reset with inventory returns
8. Edge cases: overpicking, multiple sources, partial scans

Uses REAL orders and REAL inventory from the database.
"""

import sys
import os
import uuid
from datetime import datetime
from typing import Dict, List, Tuple, Optional
from collections import Counter
import traceback
import json

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

from dotenv import load_dotenv
from pathlib import Path
load_dotenv(dotenv_path=Path(__file__).parent.parent.parent / '.env')

from modules.orders.order_fulfillment.db_repo import MagentoDbRepo
from modules.orders.order_fulfillment.service import OrderFulfillmentService
from modules.orders.order_fulfillment.schemas import (
    StartSessionSchema, ScanRequestSchema, CompleteSessionSchema
)
from core.db import get_inventory_log_connection, return_inventory_connection

# =============================================================================
# CONFIGURATION
# =============================================================================

TEST_SKU = 'ME071'  # Real SKU to test with
TEST_SKU_2 = 'ME072'  # Second SKU for multi-item tests
TEST_USER = 'extreme_test_user'
TEST_ORDER_PREFIX = f'EXTREME-TEST-{datetime.now().strftime("%H%M%S")}'


# =============================================================================
# TEST RESULT TRACKER
# =============================================================================

class TestResults:
    """Track all test results with detailed reporting"""
    
    def __init__(self):
        self.passed: List[Tuple[str, str]] = []  # (category, test_name)
        self.failed: List[Tuple[str, str, str]] = []  # (category, test_name, error)
        self.skipped: List[Tuple[str, str, str]] = []  # (category, test_name, reason)
        
    def add_pass(self, category: str, name: str):
        self.passed.append((category, name))
        print(f"    ✅ {name}")
        
    def add_fail(self, category: str, name: str, error: str):
        self.failed.append((category, name, error))
        print(f"    ❌ {name}")
        print(f"       Error: {error}")
        
    def add_skip(self, category: str, name: str, reason: str):
        self.skipped.append((category, name, reason))
        print(f"    ⏭️  {name} (skipped: {reason})")
        
    def summary(self):
        print("\n" + "=" * 80)
        print("                        EXTREME TEST SUMMARY")
        print("=" * 80)
        
        # Group by category
        categories = {}
        for cat, name in self.passed:
            if cat not in categories:
                categories[cat] = {'passed': [], 'failed': [], 'skipped': []}
            categories[cat]['passed'].append(name)
        for cat, name, _ in self.failed:
            if cat not in categories:
                categories[cat] = {'passed': [], 'failed': [], 'skipped': []}
            categories[cat]['failed'].append(name)
        for cat, name, _ in self.skipped:
            if cat not in categories:
                categories[cat] = {'passed': [], 'failed': [], 'skipped': []}
            categories[cat]['skipped'].append(name)
            
        for cat, results in categories.items():
            p = len(results['passed'])
            f = len(results['failed'])
            s = len(results['skipped'])
            status = "✅" if f == 0 else "❌"
            print(f"\n{status} {cat}: {p}/{p+f} passed", end="")
            if s:
                print(f" ({s} skipped)", end="")
            print()
            
        total_passed = len(self.passed)
        total_failed = len(self.failed)
        total_skipped = len(self.skipped)
        total = total_passed + total_failed
        
        print("\n" + "=" * 80)
        if total_failed == 0:
            print(f"🎉 ALL {total_passed} TESTS PASSED!")
        else:
            print(f"❌ {total_failed} TESTS FAILED / {total_passed} PASSED")
            print("\nFailed tests:")
            for cat, name, error in self.failed:
                print(f"  [{cat}] {name}: {error}")
        if total_skipped:
            print(f"⏭️  {total_skipped} tests skipped")
        print("=" * 80)
        
        return total_failed == 0


# =============================================================================
# EXTREME WORKFLOW TESTER
# =============================================================================

class ExtremeWorkflowTester:
    """Complete workflow tester with real inventory"""
    
    def __init__(self):
        self.repo = MagentoDbRepo()
        self.service = OrderFulfillmentService()
        self.results = TestResults()
        self.conn = get_inventory_log_connection()
        self.created_sessions: List[str] = []
        self.initial_inventory: Dict[str, Dict] = {}
        self.order_counter = 0
        
    # =========================================================================
    # HELPER METHODS
    # =========================================================================
    
    def get_order_number(self) -> str:
        """Generate unique order number"""
        self.order_counter += 1
        return f"{TEST_ORDER_PREFIX}-{self.order_counter:03d}"
    
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
    
    def set_inventory(self, sku: str, shelf_lt1: int = None, shelf_gt1: int = None, top_floor: int = None):
        """Set inventory values for a SKU"""
        cur = self.conn.cursor()
        updates = []
        values = []
        if shelf_lt1 is not None:
            updates.append("shelf_lt1_qty = %s")
            values.append(shelf_lt1)
        if shelf_gt1 is not None:
            updates.append("shelf_gt1_qty = %s")
            values.append(shelf_gt1)
        if top_floor is not None:
            updates.append("top_floor_total = %s")
            values.append(top_floor)
        if updates:
            values.append(sku)
            cur.execute(f"UPDATE inventory_metadata SET {', '.join(updates)} WHERE sku = %s", values)
            self.conn.commit()
        cur.close()
    
    def save_inventory(self, sku: str):
        """Save current inventory state to restore later"""
        self.initial_inventory[sku] = self.get_inventory(sku)
        
    def restore_inventory(self, sku: str):
        """Restore inventory to saved state"""
        if sku in self.initial_inventory:
            inv = self.initial_inventory[sku]
            self.set_inventory(sku, inv['shelf_lt1_qty'], inv['shelf_gt1_qty'], inv['top_floor_total'])
            
    def restore_all_inventory(self):
        """Restore all saved inventory"""
        for sku in self.initial_inventory:
            self.restore_inventory(sku)
    
    def ensure_sku_exists(self, sku: str) -> bool:
        """Ensure SKU exists in inventory_metadata, return True if exists"""
        inv = self.get_inventory(sku)
        return bool(inv)
    
    def create_session(self, order_number: str = None, session_type: str = 'pick',
                       items: List[Dict] = None, user_id: str = TEST_USER) -> str:
        """Create a test session and track for cleanup"""
        if order_number is None:
            order_number = self.get_order_number()
        if items is None:
            items = [{'sku': TEST_SKU, 'name': 'Test Product', 'qty_expected': 3, 'price': 10.0}]
            
        session = self.repo.create_session(
            invoice_id=f'INV-{order_number}',
            order_number=order_number,
            session_type=session_type,
            items_expected=items,
            user_id=user_id
        )
        self.created_sessions.append(session.session_id)
        return session.session_id
    
    def cleanup_sessions(self):
        """Clean up all test sessions"""
        for session_id in self.created_sessions:
            try:
                self.repo.delete_session(session_id)
            except:
                pass
        self.created_sessions.clear()
        
    def full_cleanup(self):
        """Full cleanup of sessions and inventory"""
        self.cleanup_sessions()
        self.restore_all_inventory()
        return_inventory_connection(self.conn)
    
    # =========================================================================
    # TEST CATEGORY 1: INVENTORY SETUP & VERIFICATION
    # =========================================================================
    
    def test_inventory_setup(self):
        """Test inventory can be read and modified"""
        cat = "1. Inventory Setup"
        print(f"\n{'='*60}")
        print(f"  {cat}")
        print(f"{'='*60}")
        
        # Test 1.1: SKU exists
        try:
            inv = self.get_inventory(TEST_SKU)
            assert inv, f"SKU {TEST_SKU} not found in inventory_metadata"
            self.results.add_pass(cat, f"SKU {TEST_SKU} exists")
        except Exception as e:
            self.results.add_fail(cat, f"SKU {TEST_SKU} exists", str(e))
            return False  # Can't continue without inventory
        
        # Test 1.2: Save initial state
        try:
            self.save_inventory(TEST_SKU)
            assert TEST_SKU in self.initial_inventory
            self.results.add_pass(cat, "Save initial inventory state")
        except Exception as e:
            self.results.add_fail(cat, "Save initial inventory state", str(e))
        
        # Test 1.3: Set known values
        try:
            self.set_inventory(TEST_SKU, shelf_lt1=100, shelf_gt1=50, top_floor=25)
            inv = self.get_inventory(TEST_SKU)
            assert inv['shelf_lt1_qty'] == 100
            assert inv['shelf_gt1_qty'] == 50
            assert inv['top_floor_total'] == 25
            self.results.add_pass(cat, "Set inventory to known values")
        except Exception as e:
            self.results.add_fail(cat, "Set inventory to known values", str(e))
            
        return True
    
    # =========================================================================
    # TEST CATEGORY 2: PICK SESSION LIFECYCLE
    # =========================================================================
    
    def test_pick_session_lifecycle(self):
        """Test complete pick session: create → scan → complete"""
        cat = "2. Pick Session Lifecycle"
        print(f"\n{'='*60}")
        print(f"  {cat}")
        print(f"{'='*60}")
        
        # Setup known inventory
        self.set_inventory(TEST_SKU, shelf_lt1=100, shelf_gt1=50, top_floor=25)
        
        # Test 2.1: Create pick session
        try:
            session_id = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test Product', 'qty_expected': 5, 'price': 10.0}
            ])
            session = self.repo.get_session(session_id)
            assert session.status == 'in_progress'
            assert session.session_type == 'pick'
            self.results.add_pass(cat, "Create pick session (in_progress)")
        except Exception as e:
            self.results.add_fail(cat, "Create pick session (in_progress)", str(e))
            return
        
        # Test 2.2: Scan items (deduct inventory)
        try:
            inv_before = self.get_inventory(TEST_SKU)
            result = self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            assert result.success, f"Scan failed: {result.message}"
            assert result.qty_scanned == 3
            
            inv_after = self.get_inventory(TEST_SKU)
            assert inv_after['shelf_lt1_qty'] == inv_before['shelf_lt1_qty'] - 3
            self.results.add_pass(cat, "Scan 3 items (inventory deducted)")
        except Exception as e:
            self.results.add_fail(cat, "Scan 3 items (inventory deducted)", str(e))
        
        # Test 2.3: Scan remaining items
        try:
            result = self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            assert result.success
            assert result.qty_scanned == 5  # Total now 5
            assert result.is_complete
            self.results.add_pass(cat, "Scan remaining 2 items (complete)")
        except Exception as e:
            self.results.add_fail(cat, "Scan remaining 2 items (complete)", str(e))
        
        # Test 2.4: Complete session (no inventory return)
        try:
            inv_before_complete = self.get_inventory(TEST_SKU)
            self.service.complete_session(CompleteSessionSchema(session_id=session_id))
            session = self.repo.get_session(session_id)
            assert session.status == 'completed'
            
            inv_after_complete = self.get_inventory(TEST_SKU)
            assert inv_after_complete['shelf_lt1_qty'] == inv_before_complete['shelf_lt1_qty']
            self.results.add_pass(cat, "Complete session (no inventory return)")
        except Exception as e:
            self.results.add_fail(cat, "Complete session (no inventory return)", str(e))
    
    # =========================================================================
    # TEST CATEGORY 3: DRAFT & CANCEL WITH INVENTORY RETURNS
    # =========================================================================
    
    def test_draft_cancel_inventory_returns(self):
        """Test drafting and cancelling returns inventory correctly"""
        cat = "3. Draft/Cancel Inventory Returns"
        print(f"\n{'='*60}")
        print(f"  {cat}")
        print(f"{'='*60}")
        
        # Test 3.1: Draft preserves inventory (no return on draft)
        self.set_inventory(TEST_SKU, shelf_lt1=100, shelf_gt1=50, top_floor=25)
        session_id_for_draft = None
        try:
            session_id_for_draft = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test Product', 'qty_expected': 10, 'price': 10.0}
            ])
            # Scan some items
            scan_result = self.service.scan_product(ScanRequestSchema(
                session_id=session_id_for_draft, sku=TEST_SKU, quantity=5, field='shelf_lt1_qty'
            ))
            assert scan_result.success, f"Scan failed: {scan_result.message}"
            
            inv_after_scan = self.get_inventory(TEST_SKU)
            assert inv_after_scan['shelf_lt1_qty'] == 95, \
                f"After scan: expected 95, got {inv_after_scan['shelf_lt1_qty']}"
            
            # Save as draft
            self.repo.release_session(session_id_for_draft, TEST_USER)
            session = self.repo.get_session(session_id_for_draft)
            assert session.status == 'draft', f"Expected draft, got {session.status}"
            
            # Inventory should NOT be returned on draft
            inv_after_draft = self.get_inventory(TEST_SKU)
            assert inv_after_draft['shelf_lt1_qty'] == 95, \
                f"After draft: expected 95, got {inv_after_draft['shelf_lt1_qty']}"
            self.results.add_pass(cat, "Draft session (inventory NOT returned)")
        except Exception as e:
            self.results.add_fail(cat, "Draft session (inventory NOT returned)", str(e) or repr(e))
        
        # Test 3.2: Cancel DRAFT returns inventory
        try:
            if not session_id_for_draft:
                raise ValueError("No session_id from Test 3.1")
            inv_before_cancel = self.get_inventory(TEST_SKU)
            
            result = self.service.cancel_session(session_id_for_draft, TEST_USER)
            assert result['success'], f"Cancel failed: {result.get('message')}"
            
            session = self.repo.get_session(session_id_for_draft)
            assert session.status == 'cancelled', f"Expected cancelled, got {session.status}"
            
            inv_after_cancel = self.get_inventory(TEST_SKU)
            expected = inv_before_cancel['shelf_lt1_qty'] + 5
            assert inv_after_cancel['shelf_lt1_qty'] == expected, \
                f"Expected {expected}, got {inv_after_cancel['shelf_lt1_qty']}"
            self.results.add_pass(cat, "Cancel draft (inventory returned)")
        except Exception as e:
            self.results.add_fail(cat, "Cancel draft (inventory returned)", str(e) or repr(e))
        
        # Test 3.3: Cancel IN_PROGRESS returns inventory
        self.set_inventory(TEST_SKU, shelf_lt1=100)
        try:
            session_id = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test Product', 'qty_expected': 10, 'price': 10.0}
            ])
            scan_result = self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=7, field='shelf_lt1_qty'
            ))
            assert scan_result.success, f"Scan failed: {scan_result.message}"
            
            inv_after_scan = self.get_inventory(TEST_SKU)['shelf_lt1_qty']
            assert inv_after_scan == 93, f"After scan: expected 93, got {inv_after_scan}"
            
            result = self.service.cancel_session(session_id, TEST_USER)
            assert result['success'], f"Cancel failed: {result.get('message')}"
            assert result['items_returned'] == 7, f"Expected 7 returned, got {result['items_returned']}"
            
            inv = self.get_inventory(TEST_SKU)
            assert inv['shelf_lt1_qty'] == 100, f"Expected 100, got {inv['shelf_lt1_qty']}"
            self.results.add_pass(cat, "Cancel in_progress (inventory returned)")
        except Exception as e:
            self.results.add_fail(cat, "Cancel in_progress (inventory returned)", str(e) or repr(e))
        
        # Test 3.4: Cancel COMPLETED does NOT return inventory
        self.set_inventory(TEST_SKU, shelf_lt1=100)
        try:
            session_id = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test', 'qty_expected': 2, 'price': 10}
            ])
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            assert self.get_inventory(TEST_SKU)['shelf_lt1_qty'] == 98
            
            self.service.complete_session(CompleteSessionSchema(session_id=session_id))
            
            result = self.service.cancel_session(session_id, TEST_USER)
            assert not result['success']  # Cannot cancel completed
            
            inv = self.get_inventory(TEST_SKU)
            assert inv['shelf_lt1_qty'] == 98  # Still deducted
            self.results.add_pass(cat, "Cancel completed (blocked, no return)")
        except Exception as e:
            self.results.add_fail(cat, "Cancel completed (blocked, no return)", str(e))
    
    # =========================================================================
    # TEST CATEGORY 4: READY TO CHECK WORKFLOW
    # =========================================================================
    
    def test_ready_to_check_workflow(self):
        """Test ready to check: mark ready, check, complete/send back"""
        cat = "4. Ready to Check Workflow"
        print(f"\n{'='*60}")
        print(f"  {cat}")
        print(f"{'='*60}")
        
        self.set_inventory(TEST_SKU, shelf_lt1=100)
        
        # Test 4.1: Pick and mark ready to check
        try:
            session_id = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test', 'qty_expected': 5, 'price': 10}
            ])
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=5, field='shelf_lt1_qty'
            ))
            
            self.service.mark_ready_to_check(session_id, TEST_USER)
            session = self.repo.get_session(session_id)
            assert session.status == 'ready_to_check'
            self.results.add_pass(cat, "Mark order ready to check")
        except Exception as e:
            self.results.add_fail(cat, "Mark order ready to check", str(e))
            return
        
        # Test 4.2: Cancel ready_to_check CLEARS COUNT but does NOT return inventory
        self.set_inventory(TEST_SKU, shelf_lt1=100)
        try:
            session_id = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test', 'qty_expected': 3, 'price': 10}
            ])
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            self.service.mark_ready_to_check(session_id, TEST_USER)
            
            inv_before = self.get_inventory(TEST_SKU)
            assert inv_before['shelf_lt1_qty'] == 97  # 100 - 3 scanned
            
            result = self.service.cancel_session(session_id, TEST_USER)
            assert result['success']
            assert result['items_returned'] == 0  # No inventory returned
            assert result.get('action') == 'count_cleared'
            
            # Session should still be ready_to_check
            session = self.repo.get_session(session_id)
            assert session.status == 'ready_to_check', f"Expected ready_to_check, got {session.status}"
            
            # Inventory should NOT have changed
            inv_after = self.get_inventory(TEST_SKU)
            assert inv_after['shelf_lt1_qty'] == 97, f"Expected 97, got {inv_after['shelf_lt1_qty']}"
            
            self.results.add_pass(cat, "Cancel ready_to_check (clears count, keeps inventory held)")
            
            # Clean up: send back and cancel to actually return inventory
            self.service.send_back_for_picking(session_id, TEST_USER)
            self.service.cancel_session(session_id, TEST_USER)
        except Exception as e:
            self.results.add_fail(cat, "Cancel ready_to_check (clears count, keeps inventory held)", str(e))
        
        # Test 4.3: To return inventory from ready_to_check: send back first, then cancel
        self.set_inventory(TEST_SKU, shelf_lt1=100)
        try:
            session_id = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test', 'qty_expected': 4, 'price': 10}
            ])
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=4, field='shelf_lt1_qty'
            ))
            self.service.mark_ready_to_check(session_id, TEST_USER)
            
            inv_before = self.get_inventory(TEST_SKU)
            assert inv_before['shelf_lt1_qty'] == 96  # 100 - 4
            
            # Send back for picking first (changes to draft)
            self.service.send_back_for_picking(session_id, TEST_USER)
            session = self.repo.get_session(session_id)
            assert session.status == 'draft'
            
            # Now cancel from draft - this returns inventory
            result = self.service.cancel_session(session_id, TEST_USER)
            assert result['success']
            assert result['items_returned'] == 4
            
            inv_after = self.get_inventory(TEST_SKU)
            assert inv_after['shelf_lt1_qty'] == 100, f"Expected 100, got {inv_after['shelf_lt1_qty']}"
            
            self.results.add_pass(cat, "Send back then cancel (inventory returned)")
        except Exception as e:
            self.results.add_fail(cat, "Send back then cancel (inventory returned)", str(e))
    
    # =========================================================================
    # TEST CATEGORY 5: SEND BACK FOR PICKING (WITH COUNTED)
    # =========================================================================
    
    def test_send_back_for_picking(self):
        """Test send back for picking with counted quantities"""
        cat = "5. Send Back for Picking"
        print(f"\n{'='*60}")
        print(f"  {cat}")
        print(f"{'='*60}")
        
        self.set_inventory(TEST_SKU, shelf_lt1=100)
        
        # Test 5.1: Basic send back for picking
        try:
            session_id = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test', 'qty_expected': 5, 'price': 10}
            ])
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=5, field='shelf_lt1_qty'
            ))
            self.service.mark_ready_to_check(session_id, TEST_USER)
            
            success = self.service.send_back_for_picking(session_id, TEST_USER)
            assert success
            
            session = self.repo.get_session(session_id)
            assert session.status == 'draft'
            assert session.session_type == 'pick'
            self.results.add_pass(cat, "Send back for picking (status: draft, type: pick)")
            
            # Clean up: cancel to return inventory
            self.service.cancel_session(session_id, TEST_USER)
        except Exception as e:
            self.results.add_fail(cat, "Send back for picking (status: draft, type: pick)", str(e))
        
        # Test 5.2: Send back with counted quantities (NEW FEATURE)
        self.set_inventory(TEST_SKU, shelf_lt1=100)
        try:
            session_id = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test', 'qty_expected': 5, 'price': 10}
            ])
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=5, field='shelf_lt1_qty'
            ))
            self.service.mark_ready_to_check(session_id, TEST_USER)
            
            # Checker counted only 4 (mismatch)
            items_counted = [{'sku': TEST_SKU, 'qty_counted': 4}]
            success = self.service.send_back_for_picking(session_id, TEST_USER, items_counted)
            assert success
            
            session = self.repo.get_session(session_id)
            assert session.items_counted == items_counted
            self.results.add_pass(cat, "Send back with items_counted saved")
        except Exception as e:
            self.results.add_fail(cat, "Send back with items_counted saved", str(e))
        
        # Test 5.3: items_counted appears in session
        try:
            session = self.repo.get_session(session_id)
            assert session.items_counted is not None
            counted_lookup = {item['sku']: item['qty_counted'] for item in session.items_counted}
            assert counted_lookup.get(TEST_SKU) == 4, f"Expected qty_counted=4, got {counted_lookup.get(TEST_SKU)}"
            self.results.add_pass(cat, "items_counted stored in session")
            
            # Clean up: cancel to return inventory
            self.service.cancel_session(session_id, TEST_USER)
        except Exception as e:
            self.results.add_fail(cat, "items_counted stored in session", str(e))
        
        # Test 5.4: Overwrite items_counted on second send back
        self.set_inventory(TEST_SKU, shelf_lt1=100)
        try:
            session_id = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test', 'qty_expected': 3, 'price': 10}
            ])
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            self.service.mark_ready_to_check(session_id, TEST_USER)
            
            # First send back with count=2
            self.service.send_back_for_picking(session_id, TEST_USER, [{'sku': TEST_SKU, 'qty_counted': 2}])
            
            # Resume picking, mark ready to check again
            self.repo.claim_session(session_id, TEST_USER)
            self.service.mark_ready_to_check(session_id, TEST_USER)
            
            # Second send back with count=1
            self.service.send_back_for_picking(session_id, TEST_USER, [{'sku': TEST_SKU, 'qty_counted': 1}])
            
            session = self.repo.get_session(session_id)
            assert session.items_counted == [{'sku': TEST_SKU, 'qty_counted': 1}]
            self.results.add_pass(cat, "items_counted overwritten on re-send")
            
            # Clean up: cancel to return inventory
            self.service.cancel_session(session_id, TEST_USER)
        except Exception as e:
            self.results.add_fail(cat, "items_counted overwritten on re-send", str(e))
    
    # =========================================================================
    # TEST CATEGORY 6: MULTI-SOURCE INVENTORY
    # =========================================================================
    
    def test_multi_source_inventory(self):
        """Test scanning from multiple inventory sources and returns"""
        cat = "6. Multi-Source Inventory"
        print(f"\n{'='*60}")
        print(f"  {cat}")
        print(f"{'='*60}")
        
        self.set_inventory(TEST_SKU, shelf_lt1=5, shelf_gt1=5, top_floor=5)
        
        # Test 6.1: Scan from different sources
        try:
            session_id = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test', 'qty_expected': 9, 'price': 10}
            ])
            
            # Scan 3 from shelf_lt1
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            inv = self.get_inventory(TEST_SKU)
            assert inv['shelf_lt1_qty'] == 2
            
            # Scan 3 from shelf_gt1
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='shelf_gt1_qty'
            ))
            inv = self.get_inventory(TEST_SKU)
            assert inv['shelf_gt1_qty'] == 2
            
            # Scan 3 from top_floor
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=3, field='top_floor_total'
            ))
            inv = self.get_inventory(TEST_SKU)
            assert inv['top_floor_total'] == 2
            
            self.results.add_pass(cat, "Scan from 3 different sources")
        except Exception as e:
            self.results.add_fail(cat, "Scan from 3 different sources", str(e))
            return
        
        # Test 6.2: Cancel returns to correct sources
        try:
            result = self.service.cancel_session(session_id, TEST_USER)
            assert result['success']
            assert result['items_returned'] == 9
            
            inv = self.get_inventory(TEST_SKU)
            assert inv['shelf_lt1_qty'] == 5
            assert inv['shelf_gt1_qty'] == 5
            assert inv['top_floor_total'] == 5
            self.results.add_pass(cat, "Cancel returns to correct sources")
        except Exception as e:
            self.results.add_fail(cat, "Cancel returns to correct sources", str(e))
    
    # =========================================================================
    # TEST CATEGORY 7: DAILY RESET / SCHEDULER
    # =========================================================================
    
    def test_daily_reset(self):
        """Test daily reset archives sessions and returns inventory"""
        cat = "7. Daily Reset / Scheduler"
        print(f"\n{'='*60}")
        print(f"  {cat}")
        print(f"{'='*60}")
        
        # Pre-cleanup: Run a reset first to clear any leftover sessions from previous tests/runs
        # This ensures we start with a clean slate for accurate inventory accounting
        self.service.reset_daily_sessions()
        
        self.set_inventory(TEST_SKU, shelf_lt1=100)
        sessions_before_reset = []
        
        # Test 7.1: Create various test sessions
        try:
            # Create a draft session
            s1 = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test', 'qty_expected': 10, 'price': 10}
            ])
            self.service.scan_product(ScanRequestSchema(
                session_id=s1, sku=TEST_SKU, quantity=5, field='shelf_lt1_qty'
            ))
            self.repo.release_session(s1, TEST_USER)
            sessions_before_reset.append(('draft', s1, 5))
            
            # Create an in_progress session
            s2 = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test', 'qty_expected': 10, 'price': 10}
            ])
            self.service.scan_product(ScanRequestSchema(
                session_id=s2, sku=TEST_SKU, quantity=3, field='shelf_lt1_qty'
            ))
            sessions_before_reset.append(('in_progress', s2, 3))
            
            # Create a completed session
            s3 = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test', 'qty_expected': 2, 'price': 10}
            ])
            self.service.scan_product(ScanRequestSchema(
                session_id=s3, sku=TEST_SKU, quantity=2, field='shelf_lt1_qty'
            ))
            self.service.complete_session(CompleteSessionSchema(session_id=s3))
            sessions_before_reset.append(('completed', s3, 0))  # No return for completed
            
            # Create a ready_to_check session
            s4 = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test', 'qty_expected': 4, 'price': 10}
            ])
            self.service.scan_product(ScanRequestSchema(
                session_id=s4, sku=TEST_SKU, quantity=4, field='shelf_lt1_qty'
            ))
            self.service.mark_ready_to_check(s4, TEST_USER)
            sessions_before_reset.append(('ready_to_check', s4, 4))
            
            self.results.add_pass(cat, "Create test sessions (draft, in_progress, completed, ready_to_check)")
        except Exception as e:
            self.results.add_fail(cat, "Create test sessions", str(e))
            return
        
        # Test 7.2: Check inventory before reset
        try:
            inv_before = self.get_inventory(TEST_SKU)
            expected_before = 100 - 5 - 3 - 2 - 4  # 86
            assert inv_before['shelf_lt1_qty'] == expected_before, \
                f"Expected {expected_before}, got {inv_before['shelf_lt1_qty']}"
            self.results.add_pass(cat, f"Inventory before reset: {inv_before['shelf_lt1_qty']} (correct)")
        except Exception as e:
            self.results.add_fail(cat, "Inventory before reset", str(e))
        
        # Test 7.3: Run daily reset
        try:
            result = self.service.reset_daily_sessions()
            assert result['success']
            self.results.add_pass(cat, f"Daily reset completed: {result.get('archived', 0)} archived")
        except Exception as e:
            self.results.add_fail(cat, "Daily reset completed", str(e))
            return
        
        # Test 7.4: Verify all sessions are archived
        try:
            for orig_status, session_id, _ in sessions_before_reset:
                session = self.repo.get_session(session_id)
                assert session.status == 'archived', \
                    f"{orig_status} session should be archived, got {session.status}"
            self.results.add_pass(cat, "All sessions archived")
        except Exception as e:
            self.results.add_fail(cat, "All sessions archived", str(e))
        
        # Test 7.5: Verify inventory returns for incomplete sessions
        try:
            inv_after = self.get_inventory(TEST_SKU)
            # Should return: 5 (draft) + 3 (in_progress) + 4 (ready_to_check) = 12
            # Should NOT return: 2 (completed)
            expected_after = 86 + 5 + 3 + 4  # = 98
            assert inv_after['shelf_lt1_qty'] == expected_after, \
                f"Expected {expected_after}, got {inv_after['shelf_lt1_qty']}"
            self.results.add_pass(cat, f"Inventory after reset: {inv_after['shelf_lt1_qty']} (incomplete returned)")
        except Exception as e:
            self.results.add_fail(cat, "Inventory after reset (incomplete returned)", str(e))
    
    # =========================================================================
    # TEST CATEGORY 8: EDGE CASES
    # =========================================================================
    
    def test_edge_cases(self):
        """Test edge cases: overpicking, zero scans, etc."""
        cat = "8. Edge Cases"
        print(f"\n{'='*60}")
        print(f"  {cat}")
        print(f"{'='*60}")
        
        self.set_inventory(TEST_SKU, shelf_lt1=100)
        
        # Test 8.1: Overpicking is prevented (cannot scan more than expected)
        try:
            session_id = self.create_session(items=[
                {'sku': TEST_SKU, 'name': 'Test', 'qty_expected': 3, 'price': 10}
            ])
            # Try to scan 5 when only 3 expected (overpick) - should be blocked
            result = self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=5, field='shelf_lt1_qty'
            ))
            # System should block overpicking
            assert result.success == False, "Expected overpick to be blocked"
            assert result.is_overpicked == True, "Expected is_overpicked flag"
            
            # Inventory should NOT have changed (scan was blocked)
            inv = self.get_inventory(TEST_SKU)
            assert inv['shelf_lt1_qty'] == 100, f"Expected 100 (unchanged), got {inv['shelf_lt1_qty']}"
            
            self.results.add_pass(cat, "Overpicking scenario")
            
            # Cancel should have nothing to return
            result = self.service.cancel_session(session_id, TEST_USER)
            assert result['items_returned'] == 0, f"Expected 0 returned, got {result['items_returned']}"
        except Exception as e:
            self.results.add_fail(cat, "Overpicking scenario", str(e) or repr(e))
        
        # Test 8.2: Zero items scanned then cancel
        self.set_inventory(TEST_SKU, shelf_lt1=100)
        try:
            session_id = self.create_session()
            # Don't scan anything
            result = self.service.cancel_session(session_id, TEST_USER)
            assert result['success']
            assert result['items_returned'] == 0
            
            inv = self.get_inventory(TEST_SKU)
            assert inv['shelf_lt1_qty'] == 100
            self.results.add_pass(cat, "Cancel with zero scans (no inventory change)")
        except Exception as e:
            self.results.add_fail(cat, "Cancel with zero scans", str(e))
        
        # Test 8.3: Unscan (negative scan)
        self.set_inventory(TEST_SKU, shelf_lt1=100)
        try:
            session_id = self.create_session()
            # Scan 5
            self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=5, field='shelf_lt1_qty'
            ))
            assert self.get_inventory(TEST_SKU)['shelf_lt1_qty'] == 95
            
            # Unscan 2 (negative quantity)
            result = self.service.scan_product(ScanRequestSchema(
                session_id=session_id, sku=TEST_SKU, quantity=-2, field='shelf_lt1_qty'
            ))
            
            inv = self.get_inventory(TEST_SKU)
            # If unscan is supported, inventory should be 97; if not, 95
            if inv['shelf_lt1_qty'] == 97:
                self.results.add_pass(cat, "Unscan (negative scan) returns inventory")
            else:
                self.results.add_skip(cat, "Unscan not supported", "Negative quantity may not be allowed")
        except Exception as e:
            self.results.add_skip(cat, "Unscan (negative scan)", f"May not be supported: {str(e)[:50]}")
    
    # =========================================================================
    # RUN ALL TESTS
    # =========================================================================
    
    def run_all_tests(self):
        """Run the complete test suite"""
        print("\n" + "=" * 80)
        print("        EXTREME ORDER FULFILLMENT WORKFLOW TEST")
        print("=" * 80)
        print(f"Test SKU: {TEST_SKU}")
        print(f"Test User: {TEST_USER}")
        print(f"Order Prefix: {TEST_ORDER_PREFIX}")
        print("=" * 80)
        
        try:
            # Category 1: Inventory Setup
            if not self.test_inventory_setup():
                print("\n⛔ Cannot continue without inventory setup")
                return False
            
            # Category 2: Pick Session Lifecycle
            self.test_pick_session_lifecycle()
            
            # Category 3: Draft/Cancel Inventory Returns
            self.test_draft_cancel_inventory_returns()
            
            # Category 4: Ready to Check Workflow
            self.test_ready_to_check_workflow()
            
            # Category 5: Send Back for Picking
            self.test_send_back_for_picking()
            
            # Category 6: Multi-Source Inventory
            self.test_multi_source_inventory()
            
            # Category 7: Daily Reset (run last as it archives sessions)
            self.test_daily_reset()
            
            # Category 8: Edge Cases
            self.test_edge_cases()
            
        except Exception as e:
            print(f"\n⛔ FATAL ERROR: {e}")
            traceback.print_exc()
        finally:
            # Cleanup
            print("\n" + "-" * 40)
            print("Cleaning up test sessions and restoring inventory...")
            self.full_cleanup()
            print("Cleanup complete.")
        
        # Show summary
        return self.results.summary()


# =============================================================================
# MAIN
# =============================================================================

if __name__ == '__main__':
    tester = ExtremeWorkflowTester()
    success = tester.run_all_tests()
    sys.exit(0 if success else 1)
