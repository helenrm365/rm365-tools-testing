#!/usr/bin/env python3
"""
Test the order fulfillment archive workflow
"""
import sys
import os
import uuid
from datetime import datetime
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from collections import Counter
from modules.orders.order_fulfillment.db_repo import MagentoDbRepo
from modules.orders.order_fulfillment.service import OrderFulfillmentService

def test_archive_workflow():
    print("=" * 60)
    print("TESTING ORDER FULFILLMENT ARCHIVE WORKFLOW")
    print("=" * 60)
    
    repo = MagentoDbRepo()
    service = OrderFulfillmentService()
    all_passed = True
    
    # 1. Current state
    print("\n1. Current sessions by status:")
    sessions = repo.get_all_sessions(include_archived=True)
    status_counts = Counter(s.status for s in sessions)
    for status, count in sorted(status_counts.items()):
        print(f"   {status}: {count}")
    
    # 2. Test get_all_sessions exclusion
    print("\n2. Testing get_all_sessions():")
    active = repo.get_all_sessions(include_archived=False)
    total = repo.get_all_sessions(include_archived=True)
    print(f"   Active (exclude archived/expired/cancelled): {len(active)}")
    print(f"   Total (include all): {len(total)}")
    
    # 3. Test get_any_session_for_invoice excludes archived/expired/cancelled
    print("\n3. Testing get_any_session_for_invoice():")
    for s in sessions:
        if s.status in ('expired', 'archived', 'cancelled'):
            found = repo.get_any_session_for_invoice(s.invoice_id)
            if found:
                print(f"   FAIL: {s.status} session for {s.order_number} returned {found.status}")
                all_passed = False
            else:
                print(f"   PASS: {s.status} session for {s.order_number} returns None (allows re-approval)")
            break
    
    # 4. Create test sessions and test the full reset
    print("\n4. Testing full reset_daily_sessions() workflow:")
    
    # Create test sessions with different statuses
    test_order_prefix = f"TEST-ARCHIVE-{datetime.now().strftime('%H%M%S')}"
    test_sessions = []
    
    try:
        # Create a draft session
        draft_session = repo.create_session(
            invoice_id=f"INV-{uuid.uuid4().hex[:8]}",
            order_number=f"{test_order_prefix}-DRAFT",
            session_type="pick",
            items_expected=[{"sku": "TEST", "name": "Test", "qty_expected": 5, "price": 10}],
            user_id="test_user"
        )
        test_sessions.append(draft_session.session_id)
        print(f"   Created draft session: {draft_session.order_number}")
        
        # Create a completed session
        completed_session = repo.create_session(
            invoice_id=f"INV-{uuid.uuid4().hex[:8]}",
            order_number=f"{test_order_prefix}-COMPLETED",
            session_type="pick",
            items_expected=[{"sku": "TEST", "name": "Test", "qty_expected": 5, "price": 10}],
            user_id="test_user"
        )
        repo.complete_session(completed_session.session_id, "test_user")
        test_sessions.append(completed_session.session_id)
        print(f"   Created completed session: {completed_session.order_number}")
        
        # Check counts before reset
        before_active = len(repo.get_all_sessions(include_archived=False))
        print(f"   Active sessions before reset: {before_active}")
        
        # Run the daily reset
        print("   Running reset_daily_sessions()...")
        result = service.reset_daily_sessions()
        print(f"   Result: {result}")
        
        # Check counts after reset
        after_active = len(repo.get_all_sessions(include_archived=False))
        print(f"   Active sessions after reset: {after_active}")
        
        # Verify test sessions are now archived
        for session_id in test_sessions:
            session = repo.get_session(session_id)
            if session:
                if session.status == 'archived':
                    # Check audit log has the original status
                    last_log = session.audit_logs[-1] if session.audit_logs else {}
                    print(f"   PASS: {session.order_number} is archived (was: {last_log.get('details', 'unknown')})")
                else:
                    print(f"   FAIL: {session.order_number} has status {session.status}, expected archived")
                    all_passed = False
        
        # Verify these orders can be re-approved (get_any_session returns None)
        for session_id in test_sessions:
            session = repo.get_session(session_id)
            if session:
                found = repo.get_any_session_for_invoice(session.invoice_id)
                if found:
                    print(f"   FAIL: Archived session {session.order_number} still blocks re-approval")
                    all_passed = False
                else:
                    print(f"   PASS: Archived session {session.order_number} allows re-approval")
        
        # 5. Test reactivation of archived session
        print("\n5. Testing reactivation of archived sessions:")
        
        # Get an archived session to reactivate
        archived_session = repo.get_session(test_sessions[0])
        if archived_session and archived_session.status == 'archived':
            # Test get_archived_session_for_invoice
            found_archived = repo.get_archived_session_for_invoice(archived_session.invoice_id)
            if found_archived:
                print(f"   PASS: get_archived_session_for_invoice() found {found_archived.order_number}")
                
                # Test reactivation
                success = repo.reactivate_session(found_archived.session_id, "test_reactivator")
                if success:
                    # Verify status is now 'approved'
                    reactivated = repo.get_session(found_archived.session_id)
                    if reactivated and reactivated.status == 'approved':
                        print(f"   PASS: Session reactivated to 'approved' status")
                        
                        # Check audit log has reactivation entry
                        last_log = reactivated.audit_logs[-1] if reactivated.audit_logs else {}
                        if last_log.get('action') == 'reactivated':
                            print(f"   PASS: Audit log shows reactivation: {last_log.get('details')}")
                        else:
                            print(f"   FAIL: Audit log missing reactivation entry")
                            all_passed = False
                        
                        # Verify get_any_session_for_invoice now returns it
                        found_again = repo.get_any_session_for_invoice(reactivated.invoice_id)
                        if found_again:
                            print(f"   PASS: Reactivated session now visible in active sessions")
                        else:
                            print(f"   FAIL: Reactivated session not found in active sessions")
                            all_passed = False
                    else:
                        print(f"   FAIL: Reactivated session has wrong status: {reactivated.status if reactivated else 'None'}")
                        all_passed = False
                else:
                    print(f"   FAIL: reactivate_session() returned False")
                    all_passed = False
            else:
                print(f"   FAIL: get_archived_session_for_invoice() returned None for archived session")
                all_passed = False
        else:
            print(f"   SKIP: No archived session available for reactivation test")
        
    except Exception as e:
        print(f"   ERROR: {e}")
        import traceback
        traceback.print_exc()
        all_passed = False
    
    # 6. Summary
    print("\n" + "=" * 60)
    if all_passed:
        print("ALL TESTS PASSED!")
    else:
        print("SOME TESTS FAILED!")
    print("=" * 60)
    
    return all_passed

if __name__ == "__main__":
    success = test_archive_workflow()
    sys.exit(0 if success else 1)
