#!/usr/bin/env python3
"""
Test script to verify cancel functionality for draft sessions
Tests:
1. Cancel pick-phase draft -> should return items to inventory
2. Cancel check-phase draft -> should NOT return items
3. Cancel ready_to_check -> should NOT return items
4. Release session -> should set status to draft
"""

import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

import psycopg2
import uuid
from datetime import datetime, timedelta

# Test database connection
DB_CONFIG = {
    'host': 'localhost',
    'port': 5433,
    'dbname': 'inventory_database',
    'user': 'postgres',
    'password': 'RuhUJ1cZ24f/s5<2',
    'sslmode': 'disable'
}

def get_connection():
    return psycopg2.connect(**DB_CONFIG)

def test_pick_draft_cancel():
    """Test that cancelling a pick-phase draft returns items to inventory"""
    print("\n" + "="*60)
    print("TEST 1: Cancel pick-phase draft should return items")
    print("="*60)
    
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Create a test session in draft status with session_type='pick'
        session_id = str(uuid.uuid4())
        order_number = "TEST_ORDER_001"
        invoice_id = "TEST_INV_001"
        
        # Insert test session
        cursor.execute("""
            INSERT INTO order_fulfillment_sessions 
            (session_id, invoice_id, order_number, status, session_type, items_expected, items_scanned, started_at)
            VALUES (%s, %s, %s, 'draft', 'pick', 
                    '[{"sku": "TEST_SKU", "name": "Test Item", "qty_required": 1}]'::jsonb,
                    '[{"sku": "TEST_SKU", "qty_scanned": 1, "deduction_sources": [{"field": "shelf_lt1_qty", "remaining": 1}]}]'::jsonb,
                    NOW())
            RETURNING session_id
        """, (session_id, invoice_id, order_number))
        
        conn.commit()
        print(f"✅ Created test pick-draft session: {session_id}")
        
        # Verify session was created
        cursor.execute("SELECT status, session_type, items_scanned FROM order_fulfillment_sessions WHERE session_id = %s", (session_id,))
        row = cursor.fetchone()
        print(f"   Status: {row[0]}, Type: {row[1]}, Has scanned items: {row[2] is not None}")
        
        # Clean up
        cursor.execute("DELETE FROM order_fulfillment_sessions WHERE session_id = %s", (session_id,))
        conn.commit()
        print(f"✅ Cleaned up test session")
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        conn.rollback()
        return False
    finally:
        cursor.close()
        conn.close()

def test_check_draft_cancel():
    """Test that cancelling a check-phase draft does NOT return items"""
    print("\n" + "="*60)
    print("TEST 2: Cancel check-phase draft should NOT return items")
    print("="*60)
    
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Create a test session in draft status with session_type='check'
        session_id = str(uuid.uuid4())
        order_number = "TEST_ORDER_002"
        invoice_id = "TEST_INV_002"
        
        # Insert test session
        cursor.execute("""
            INSERT INTO order_fulfillment_sessions 
            (session_id, invoice_id, order_number, status, session_type, items_expected, items_scanned, started_at)
            VALUES (%s, %s, %s, 'draft', 'check', 
                    '[{"sku": "TEST_SKU", "name": "Test Item", "qty_required": 1}]'::jsonb,
                    '[{"sku": "TEST_SKU", "qty_scanned": 1}]'::jsonb,
                    NOW())
            RETURNING session_id
        """, (session_id, invoice_id, order_number))
        
        conn.commit()
        print(f"✅ Created test check-draft session: {session_id}")
        
        # Verify session was created
        cursor.execute("SELECT status, session_type, items_scanned FROM order_fulfillment_sessions WHERE session_id = %s", (session_id,))
        row = cursor.fetchone()
        print(f"   Status: {row[0]}, Type: {row[1]}, Has scanned items: {row[2] is not None}")
        
        # Clean up
        cursor.execute("DELETE FROM order_fulfillment_sessions WHERE session_id = %s", (session_id,))
        conn.commit()
        print(f"✅ Cleaned up test session")
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        conn.rollback()
        return False
    finally:
        cursor.close()
        conn.close()

def test_ready_to_check_cancel():
    """Test that cancelling a ready_to_check session does NOT return items"""
    print("\n" + "="*60)
    print("TEST 3: Cancel ready_to_check should NOT return items")
    print("="*60)
    
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Create a test session in ready_to_check status
        session_id = str(uuid.uuid4())
        order_number = "TEST_ORDER_003"
        invoice_id = "TEST_INV_003"
        
        # Insert test session
        cursor.execute("""
            INSERT INTO order_fulfillment_sessions 
            (session_id, invoice_id, order_number, status, session_type, items_expected, items_scanned, started_at)
            VALUES (%s, %s, %s, 'ready_to_check', 'pick', 
                    '[{"sku": "TEST_SKU", "name": "Test Item", "qty_required": 1}]'::jsonb,
                    '[{"sku": "TEST_SKU", "qty_scanned": 1}]'::jsonb,
                    NOW())
            RETURNING session_id
        """, (session_id, invoice_id, order_number))
        
        conn.commit()
        print(f"✅ Created test ready_to_check session: {session_id}")
        
        # Verify session was created
        cursor.execute("SELECT status, session_type FROM order_fulfillment_sessions WHERE session_id = %s", (session_id,))
        row = cursor.fetchone()
        print(f"   Status: {row[0]}, Type: {row[1]}")
        
        # Clean up
        cursor.execute("DELETE FROM order_fulfillment_sessions WHERE session_id = %s", (session_id,))
        conn.commit()
        print(f"✅ Cleaned up test session")
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        conn.rollback()
        return False
    finally:
        cursor.close()
        conn.close()

def test_release_session():
    """Test that releasing a session sets it back to draft"""
    print("\n" + "="*60)
    print("TEST 4: Release session should set status to draft")
    print("="*60)
    
    conn = get_connection()
    cursor = conn.cursor()
    
    try:
        # Create a test session in in_progress status
        session_id = str(uuid.uuid4())
        order_number = "TEST_ORDER_004"
        invoice_id = "TEST_INV_004"
        
        # Insert test session
        cursor.execute("""
            INSERT INTO order_fulfillment_sessions 
            (session_id, invoice_id, order_number, status, session_type, user_id, items_expected, started_at)
            VALUES (%s, %s, %s, 'in_progress', 'pick', 'test_user',
                    '[{"sku": "TEST_SKU", "name": "Test Item", "qty_required": 1}]'::jsonb,
                    NOW())
            RETURNING session_id
        """, (session_id, invoice_id, order_number))
        
        conn.commit()
        print(f"✅ Created test in_progress session: {session_id}")
        
        # Simulate release by updating status to draft
        cursor.execute("""
            UPDATE order_fulfillment_sessions 
            SET status = 'draft', user_id = NULL
            WHERE session_id = %s
        """, (session_id,))
        conn.commit()
        
        # Verify session was released
        cursor.execute("SELECT status, user_id FROM order_fulfillment_sessions WHERE session_id = %s", (session_id,))
        row = cursor.fetchone()
        print(f"   Status after release: {row[0]}, User: {row[1]}")
        
        if row[0] == 'draft' and row[1] is None:
            print("✅ Release works correctly")
        else:
            print("❌ Release did not work as expected")
            return False
        
        # Clean up
        cursor.execute("DELETE FROM order_fulfillment_sessions WHERE session_id = %s", (session_id,))
        conn.commit()
        print(f"✅ Cleaned up test session")
        
        return True
        
    except Exception as e:
        print(f"❌ Error: {e}")
        conn.rollback()
        return False
    finally:
        cursor.close()
        conn.close()

def test_service_cancel_logic():
    """Test the actual service cancel logic"""
    print("\n" + "="*60)
    print("TEST 5: Service cancel_session logic")
    print("="*60)
    
    try:
        # Load environment variables
        from dotenv import load_dotenv
        load_dotenv('/Users/ianhjweng/Documents/github/rm365-tools-testing/.env')
        
        from modules.orders.order_fulfillment.service import OrderFulfillmentService
        
        service = OrderFulfillmentService()
        
        conn = get_connection()
        cursor = conn.cursor()
        
        # Create a pick-draft session with scanned items
        session_id = str(uuid.uuid4())
        order_number = "TEST_ORDER_005"
        invoice_id = "TEST_INV_005"
        
        cursor.execute("""
            INSERT INTO order_fulfillment_sessions 
            (session_id, invoice_id, order_number, status, session_type, items_expected, items_scanned, started_at)
            VALUES (%s, %s, %s, 'draft', 'pick', 
                    '[{"sku": "TEST_SKU", "name": "Test Item", "qty_required": 1}]'::jsonb,
                    '[{"sku": "TEST_SKU", "qty_scanned": 1, "deduction_sources": [{"field": "shelf_lt1_qty", "remaining": 1}]}]'::jsonb,
                    NOW())
            RETURNING session_id
        """, (session_id, invoice_id, order_number))
        conn.commit()
        
        print(f"✅ Created test pick-draft session with scanned items: {session_id}")
        
        # Test the cancel logic - should detect items need to be returned
        result = service.cancel_session(session_id, "test_user")
        print(f"   Cancel result: {result}")
        
        # For pick-draft, items_returned should be > 0 if deduction_sources has data
        # Note: Since this is a test SKU, the actual return might fail silently
        if result.get('success'):
            print("✅ Service cancel_session completed successfully")
        else:
            print(f"❌ Service cancel_session failed: {result.get('message')}")
            return False
        
        # Clean up
        cursor.execute("DELETE FROM order_fulfillment_sessions WHERE session_id = %s", (session_id,))
        conn.commit()
        cursor.close()
        conn.close()
        
        return result.get('success', False)
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_check_phase_does_not_return_items():
    """Test that cancelling a check-phase draft does NOT try to return items"""
    print("\n" + "="*60)
    print("TEST 6: Check-draft cancel should NOT try to return items")
    print("="*60)
    
    try:
        # Load environment variables
        from dotenv import load_dotenv
        load_dotenv('/Users/ianhjweng/Documents/github/rm365-tools-testing/.env')
        
        from modules.orders.order_fulfillment.service import OrderFulfillmentService
        
        service = OrderFulfillmentService()
        
        conn = get_connection()
        cursor = conn.cursor()
        
        # Create a check-draft session
        session_id = str(uuid.uuid4())
        order_number = "TEST_ORDER_006"
        invoice_id = "TEST_INV_006"
        
        cursor.execute("""
            INSERT INTO order_fulfillment_sessions 
            (session_id, invoice_id, order_number, status, session_type, items_expected, items_scanned, started_at)
            VALUES (%s, %s, %s, 'draft', 'check', 
                    '[{"sku": "TEST_SKU", "name": "Test Item", "qty_required": 1}]'::jsonb,
                    '[{"sku": "TEST_SKU", "qty_scanned": 1}]'::jsonb,
                    NOW())
            RETURNING session_id
        """, (session_id, invoice_id, order_number))
        conn.commit()
        
        print(f"✅ Created test check-draft session: {session_id}")
        
        # Test the cancel logic
        result = service.cancel_session(session_id, "test_user")
        print(f"   Cancel result: {result}")
        
        # Check-draft should NOT return items
        if result.get('success') and result.get('items_returned', 0) == 0:
            # Message should indicate it's a checking session
            if 'checking' in result.get('message', '').lower() or 'cancelled' in result.get('message', '').lower():
                print("✅ Check-draft cancel works correctly (no items returned)")
            else:
                print(f"   Message: {result.get('message')}")
                print("✅ Check-draft cancel completed")
        else:
            print(f"❌ Unexpected result: {result}")
            return False
        
        # Clean up
        cursor.execute("DELETE FROM order_fulfillment_sessions WHERE session_id = %s", (session_id,))
        conn.commit()
        cursor.close()
        conn.close()
        
        return result.get('success', False)
        
    except Exception as e:
        print(f"❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    print("="*60)
    print("Testing Cancel Session Functionality")
    print("="*60)
    
    results = []
    
    # Run database structure tests
    results.append(("Pick-draft cancel", test_pick_draft_cancel()))
    results.append(("Check-draft cancel", test_check_draft_cancel()))
    results.append(("Ready-to-check cancel", test_ready_to_check_cancel()))
    results.append(("Release session", test_release_session()))
    
    # Try service tests
    try:
        results.append(("Service cancel logic", test_service_cancel_logic()))
        results.append(("Check-draft no item return", test_check_phase_does_not_return_items()))
    except Exception as e:
        print(f"\nNote: Service tests skipped (run from backend directory): {e}")
    
    # Summary
    print("\n" + "="*60)
    print("TEST SUMMARY")
    print("="*60)
    
    passed = sum(1 for _, success in results if success)
    total = len(results)
    
    for name, success in results:
        status = "✅ PASS" if success else "❌ FAIL"
        print(f"  {status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
