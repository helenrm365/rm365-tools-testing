"""
Test script for labels status check and init endpoints.
Tests the new /status and /init endpoints added to the labels module.
"""
import sys
import os
import time
from datetime import datetime, timezone, timedelta

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

def test_labels_status_endpoint():
    """Test that the labels status endpoint works correctly."""
    print("=" * 60)
    print("Testing Labels Status Check Endpoints")
    print("=" * 60)
    
    from core.db import get_inventory_log_connection, return_inventory_connection
    from modules.labels.repo import LabelsRepo
    from modules.labels.service import LabelsService
    from modules.labels.jobs import _ensure_label_print_schema
    
    repo = LabelsRepo()
    svc = LabelsService(repo)
    
    # Test 1: Check tables status via service
    print("\n1. Testing check_tables_status() via service...")
    start = time.time()
    result = svc.check_tables_status()
    elapsed = time.time() - start
    
    print(f"   Status: {result.get('status')}")
    print(f"   Tables status: {result.get('tables_status')}")
    print(f"   All tables exist: {result.get('all_tables_exist')}")
    print(f"   Time: {elapsed:.3f}s")
    
    assert result.get('status') == 'success', "Status should be success"
    assert 'tables_status' in result, "Should have tables_status"
    assert 'all_tables_exist' in result, "Should have all_tables_exist"
    print("   ✓ Status check passed")
    
    # Test 2: Check tables exist via repo directly
    print("\n2. Testing check_tables_exist() via repo...")
    start = time.time()
    tables = repo.check_tables_exist()
    elapsed = time.time() - start
    
    print(f"   Tables: {tables}")
    print(f"   Time: {elapsed:.3f}s")
    
    expected_tables = ['label_print_jobs', 'label_print_items', 'label_printing_presets', 'inventory_metadata']
    for table in expected_tables:
        assert table in tables, f"Should check for {table}"
    print("   ✓ Repo check passed")
    
    # Test 3: Test init if tables don't exist
    print("\n3. Testing table initialization...")
    conn = get_inventory_log_connection()
    try:
        start = time.time()
        _ensure_label_print_schema(conn)
        conn.commit()
        elapsed = time.time() - start
        print(f"   Schema ensured in {elapsed:.3f}s")
        print("   ✓ Init passed")
    finally:
        return_inventory_connection(conn)
    
    # Test 4: Re-check status after init
    print("\n4. Re-checking status after init...")
    start = time.time()
    result = svc.check_tables_status()
    elapsed = time.time() - start
    
    print(f"   Tables status: {result.get('tables_status')}")
    print(f"   All tables exist: {result.get('all_tables_exist')}")
    print(f"   Time: {elapsed:.3f}s")
    
    # Label tables should exist after init
    tables_status = result.get('tables_status', {})
    assert tables_status.get('label_print_jobs') == True, "label_print_jobs should exist"
    assert tables_status.get('label_print_items') == True, "label_print_items should exist"
    assert tables_status.get('label_printing_presets') == True, "label_printing_presets should exist"
    print("   ✓ Post-init status check passed")
    
    print("\n" + "=" * 60)
    print("ALL TESTS PASSED ✓")
    print("=" * 60)


def test_labels_load_with_status_check():
    """Test full flow: status check -> init -> load products"""
    print("\n" + "=" * 60)
    print("Testing Full Flow: Status -> Init -> Load Products")
    print("=" * 60)
    
    from core.db import get_inventory_log_connection, return_inventory_connection
    from modules.labels.repo import LabelsRepo
    from modules.labels.service import LabelsService
    from modules.labels.jobs import _ensure_label_print_schema
    
    repo = LabelsRepo()
    svc = LabelsService(repo)
    
    total_start = time.time()
    
    # Step 1: Check status
    print("\nStep 1: Checking tables status...")
    step_start = time.time()
    status = svc.check_tables_status()
    step_time = time.time() - step_start
    print(f"   All tables exist: {status.get('all_tables_exist')}")
    print(f"   Time: {step_time:.3f}s")
    
    # Step 2: Init if needed
    if not status.get('all_tables_exist'):
        print("\nStep 2: Initializing missing tables...")
        step_start = time.time()
        conn = get_inventory_log_connection()
        try:
            _ensure_label_print_schema(conn)
            conn.commit()
        finally:
            return_inventory_connection(conn)
        step_time = time.time() - step_start
        print(f"   Time: {step_time:.3f}s")
    else:
        print("\nStep 2: Tables already exist, skipping init")
    
    # Step 3: Load products
    print("\nStep 3: Loading products (with Magento sync)...")
    step_start = time.time()
    conn = get_inventory_log_connection()
    try:
        products = repo.get_labels_to_print_psycopg(
            conn, 
            product_statuses=['Active', 'Temporarily OOS', 'Pre Order', 'Samples'],
            preferred_region='uk',
            show_orphaned=False
        )
        step_time = time.time() - step_start
        print(f"   Products loaded: {len(products)}")
        print(f"   Time: {step_time:.3f}s")
    finally:
        return_inventory_connection(conn)
    
    total_time = time.time() - total_start
    print(f"\nTotal time: {total_time:.3f}s")
    
    print("\n" + "=" * 60)
    print("FULL FLOW TEST PASSED ✓")
    print("=" * 60)
    
    return total_time


def test_purge_old_jobs():
    """Test the purge old jobs functionality."""
    print("\n" + "=" * 60)
    print("Testing Purge Old Jobs")
    print("=" * 60)
    
    from core.db import get_inventory_log_connection, return_inventory_connection
    
    conn = get_inventory_log_connection()
    try:
        with conn.cursor() as cur:
            # Get current counts
            cur.execute("SELECT COUNT(*) FROM label_print_jobs")
            total_jobs = cur.fetchone()[0]
            
            cur.execute("SELECT COUNT(*) FROM label_print_items")
            total_items = cur.fetchone()[0]
            
            print(f"\n1. Current state:")
            print(f"   Total jobs: {total_jobs}")
            print(f"   Total items: {total_items}")
            
            # Check for old jobs (older than 6 months)
            cutoff = datetime.now(timezone.utc) - timedelta(days=180)
            cur.execute(
                "SELECT COUNT(*) FROM label_print_jobs WHERE created_at < %s",
                (cutoff,)
            )
            old_jobs = cur.fetchone()[0]
            
            cur.execute(
                """
                SELECT COUNT(*) FROM label_print_items i
                JOIN label_print_jobs j ON i.job_id = j.id
                WHERE j.created_at < %s
                """,
                (cutoff,)
            )
            old_items = cur.fetchone()[0]
            
            print(f"\n2. Jobs older than 6 months (cutoff: {cutoff.date()}):")
            print(f"   Old jobs: {old_jobs}")
            print(f"   Old items: {old_items}")
            
            if old_jobs > 0:
                # Test the purge
                cur.execute(
                    "DELETE FROM label_print_jobs WHERE created_at < %s",
                    (cutoff,)
                )
                conn.commit()
                print(f"\n3. Purged {old_jobs} old jobs (items deleted via CASCADE)")
            else:
                print(f"\n3. No old jobs to purge")
            
            # Verify counts after purge
            cur.execute("SELECT COUNT(*) FROM label_print_jobs")
            remaining_jobs = cur.fetchone()[0]
            
            cur.execute("SELECT COUNT(*) FROM label_print_items")
            remaining_items = cur.fetchone()[0]
            
            print(f"\n4. After purge:")
            print(f"   Remaining jobs: {remaining_jobs}")
            print(f"   Remaining items: {remaining_items}")
            
            expected_jobs = total_jobs - old_jobs
            expected_items = total_items - old_items
            
            assert remaining_jobs == expected_jobs, f"Expected {expected_jobs} jobs, got {remaining_jobs}"
            assert remaining_items == expected_items, f"Expected {expected_items} items, got {remaining_items}"
            
            print("   ✓ Purge verification passed")
    
    finally:
        return_inventory_connection(conn)
    
    print("\n" + "=" * 60)
    print("PURGE TEST PASSED ✓")
    print("=" * 60)


if __name__ == "__main__":
    test_labels_status_endpoint()
    total_time = test_labels_load_with_status_check()
    
    print(f"\n\n📊 SUMMARY")
    print(f"   Full label generator load time: {total_time:.2f}s")
    if total_time < 10:
        print(f"   ✅ Performance is GOOD (under 10s)")
    elif total_time < 30:
        print(f"   ⚠️  Performance is ACCEPTABLE (under 30s)")
    else:
        print(f"   ❌ Performance needs improvement (over 30s)")
    
    # Test purge functionality
    test_purge_old_jobs()
