"""E2E Test: Save as Draft -> Cancel returns items to inventory."""

import sys
sys.path.insert(0, 'backend')
from dotenv import load_dotenv
from pathlib import Path
load_dotenv(dotenv_path=Path('.env'))

import psycopg2
from modules.orders.order_fulfillment.db_repo import MagentoDbRepo
from modules.orders.order_fulfillment.service import OrderFulfillmentService


def test_pick_draft_cancel_returns_inventory():
    """Test that cancelling a pick-draft returns scanned items to inventory."""
    print('='*60)
    print('E2E Test: Save as Draft -> Cancel returns items')
    print('='*60)

    # Get initial inventory
    conn_str = 'host=localhost port=5433 dbname=inventory_database user=postgres password=RuhUJ1cZ24f/s5<2 sslmode=disable'
    conn = psycopg2.connect(conn_str)
    cur = conn.cursor()
    cur.execute('SELECT shelf_lt1_qty FROM inventory_metadata WHERE sku=%s', ('ME071',))
    initial_qty = cur.fetchone()[0]
    print(f'1. Initial inventory for ME071: {initial_qty}')

    # Create a pick session with scanned items
    repo = MagentoDbRepo()
    session = repo.create_session(
        invoice_id='TEST-INV-E2E-001',
        order_number='TEST-ORDER-E2E-001',
        session_type='pick',
        items_expected=[{'sku': 'ME071', 'name': 'Test Product', 'qty_expected': 5, 'price': 10.0}],
        user_id='test_user'
    )
    session_id = session.session_id
    print(f'2. Created pick session: {session_id}')
    print(f'   Status: {session.status}')

    try:
        # Simulate scanning 2 items (deduct from inventory)
        cur.execute('UPDATE inventory_metadata SET shelf_lt1_qty = shelf_lt1_qty - 2 WHERE sku=%s', ('ME071',))
        conn.commit()
        cur.execute('SELECT shelf_lt1_qty FROM inventory_metadata WHERE sku=%s', ('ME071',))
        after_scan_qty = cur.fetchone()[0]
        print(f'3. After scanning 2 items: {after_scan_qty}')

        # Add scanned items to session using the correct format with deduction_sources
        repo.add_scanned_item(
            session_id=session_id,
            sku='ME071',
            quantity=2,
            deduction_sources=[{'field': 'shelf_lt1_qty', 'quantity': 2}]
        )

        # Save as draft (release session)
        success = repo.release_session(session_id)
        print(f'4. Released session (save as draft): {success}')

        # Verify it is a draft
        session = repo.get_session(session_id)
        print(f'   New status: {session.status}')
        print(f'   Scanned items preserved: {len(session.items_scanned)}')

        # Now cancel the draft (should return items)
        service = OrderFulfillmentService()
        result = service.cancel_session(session_id, user_id='test_user')
        print(f'5. Cancel pick-draft result: {result}')

        # Check inventory after cancel
        cur.execute('SELECT shelf_lt1_qty FROM inventory_metadata WHERE sku=%s', ('ME071',))
        final_qty = cur.fetchone()[0]
        print(f'6. Final inventory for ME071: {final_qty}')

        # Verify
        if final_qty == initial_qty:
            print('\n✅ SUCCESS: Items returned to inventory correctly!')
            return True
        else:
            print(f'\n❌ FAILED: Expected {initial_qty}, got {final_qty}')
            return False

    finally:
        # Cleanup
        try:
            repo.delete_session(session_id)
            print('7. Cleaned up test session')
        except Exception:
            pass
        cur.close()
        conn.close()


def test_check_draft_cancel_no_inventory_change():
    """Test that cancelling a check-draft doesn't affect inventory (only resets counting)."""
    print('\n' + '='*60)
    print('E2E Test: Check-Draft Cancel (no inventory change)')
    print('='*60)

    # Get initial inventory
    conn_str = 'host=localhost port=5433 dbname=inventory_database user=postgres password=RuhUJ1cZ24f/s5<2 sslmode=disable'
    conn = psycopg2.connect(conn_str)
    cur = conn.cursor()
    cur.execute('SELECT shelf_lt1_qty FROM inventory_metadata WHERE sku=%s', ('ME071',))
    initial_qty = cur.fetchone()[0]
    print(f'1. Initial inventory for ME071: {initial_qty}')

    # Create a check session
    repo = MagentoDbRepo()
    session = repo.create_session(
        invoice_id='TEST-INV-E2E-002',
        order_number='TEST-ORDER-E2E-002',
        session_type='check',
        items_expected=[{'sku': 'ME071', 'name': 'Test Product', 'qty_expected': 5, 'price': 10.0}],
        user_id='test_user'
    )
    session_id = session.session_id
    print(f'2. Created check session: {session_id}')

    try:
        # Simulate checking some items (no inventory deduction for check phase)
        repo.add_scanned_item(
            session_id=session_id,
            sku='ME071',
            quantity=3,
            deduction_sources=[]  # No deduction for checking
        )
        print('3. Added checked items to session')

        # Save as draft (release session)
        success = repo.release_session(session_id)
        print(f'4. Released session (save as draft): {success}')

        # Verify it is a draft
        session = repo.get_session(session_id)
        print(f'   New status: {session.status}')

        # Now cancel the draft
        service = OrderFulfillmentService()
        result = service.cancel_session(session_id, user_id='test_user')
        print(f'5. Cancel check-draft result: {result}')

        # Check inventory after cancel - should be unchanged
        cur.execute('SELECT shelf_lt1_qty FROM inventory_metadata WHERE sku=%s', ('ME071',))
        final_qty = cur.fetchone()[0]
        print(f'6. Final inventory for ME071: {final_qty}')

        # Verify
        if final_qty == initial_qty:
            print('\n✅ SUCCESS: Inventory unchanged as expected for check-draft!')
            return True
        else:
            print(f'\n❌ FAILED: Inventory changed unexpectedly from {initial_qty} to {final_qty}')
            return False

    finally:
        # Cleanup
        try:
            repo.delete_session(session_id)
            print('7. Cleaned up test session')
        except Exception:
            pass
        cur.close()
        conn.close()


if __name__ == '__main__':
    print('\n' + '='*60)
    print('         E2E DRAFT -> CANCEL TESTS')
    print('='*60)
    
    results = []
    results.append(('Pick-Draft Cancel Returns Items', test_pick_draft_cancel_returns_inventory()))
    results.append(('Check-Draft Cancel No Change', test_check_draft_cancel_no_inventory_change()))
    
    print('\n' + '='*60)
    print('         FINAL RESULTS')
    print('='*60)
    for name, passed in results:
        status = '✅ PASS' if passed else '❌ FAIL'
        print(f'{status}: {name}')
    
    all_passed = all(p for _, p in results)
    print('\n' + ('✅ All E2E tests passed!' if all_passed else '❌ Some tests failed'))
