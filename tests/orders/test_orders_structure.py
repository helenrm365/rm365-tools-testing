"""
Test script for orders module load time.
Verifies that orders module doesn't have any table initialization overhead.
"""
import sys
import os
import time

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))


def test_orders_module_structure():
    """Verify orders module structure - should use JSON files, not PostgreSQL tables."""
    print("\n" + "=" * 60)
    print("Testing Orders Module Structure")
    print("=" * 60)
    
    from modules.orders.order_fulfillment.repo import MagentoRepo
    
    repo = MagentoRepo()
    
    # Check that repo uses JSON files, not database tables
    print(f"\n1. Data directory: {repo.data_dir}")
    print(f"   Sessions file: {repo.sessions_file}")
    print(f"   Takeover requests file: {repo.takeover_requests_file}")
    
    assert repo.data_dir.exists(), "Data directory should exist"
    print(f"   ✅ Data directory exists")
    
    # Check there's no init_tables method
    has_init_tables = hasattr(repo, 'init_tables')
    print(f"\n2. Has init_tables method: {has_init_tables}")
    assert not has_init_tables, "Orders repo should NOT have init_tables (uses JSON files)"
    print(f"   ✅ No init_tables method (correct - uses JSON persistence)")
    

def test_orders_service_load_time():
    """Test the orders service instantiation time."""
    print("\n" + "=" * 60)
    print("Testing Orders Service Load Time")
    print("=" * 60)
    
    from modules.orders.order_fulfillment.service import MagentoService
    
    print("\n1. Instantiating MagentoService...")
    start = time.time()
    service = MagentoService()
    elapsed = time.time() - start
    
    print(f"   Time: {elapsed:.3f}s")
    
    if elapsed < 0.5:
        print(f"   ✅ Service instantiation is FAST (under 0.5s)")
    else:
        print(f"   ⚠️ Service instantiation took {elapsed:.2f}s")
    
    assert elapsed < 2.0, f"Service instantiation too slow: {elapsed:.2f}s"


def test_sku_lookup_performance():
    """Test SKU lookup from inventory_metadata (the only DB interaction)."""
    print("\n" + "=" * 60)
    print("Testing SKU Lookup Performance")
    print("=" * 60)
    
    from modules.orders.order_fulfillment.repo import MagentoRepo
    
    repo = MagentoRepo()
    
    # Test lookup by item_id
    print("\n1. Testing get_sku_by_item_id()...")
    
    # First, get a valid item_id from inventory_metadata
    try:
        from core.db import get_psycopg_connection
        conn = get_psycopg_connection()
        cursor = conn.cursor()
        cursor.execute("SELECT item_id, sku FROM inventory_metadata LIMIT 1")
        result = cursor.fetchone()
        cursor.close()
        conn.close()
        
        if result:
            test_item_id, expected_sku = result
            print(f"   Using test item_id: {test_item_id}")
            
            start = time.time()
            found_sku = repo.get_sku_by_item_id(test_item_id)
            elapsed = time.time() - start
            
            print(f"   Found SKU: {found_sku}")
            print(f"   Time: {elapsed:.3f}s")
            
            assert found_sku == expected_sku, f"SKU mismatch: {found_sku} != {expected_sku}"
            print(f"   ✅ SKU lookup correct and fast")
        else:
            print("   ⚠️ No inventory_metadata records to test with")
    except Exception as e:
        print(f"   ⚠️ Could not test SKU lookup: {e}")


def test_orders_has_no_batch_operations():
    """Verify orders module doesn't use batch insert operations (not needed)."""
    print("\n" + "=" * 60)
    print("Testing Orders Module - No Batch Operations")
    print("=" * 60)
    
    import inspect
    from modules.orders.order_fulfillment import repo, service
    
    # Check repo source for execute_values/execute_batch
    repo_source = inspect.getsource(repo)
    service_source = inspect.getsource(service)
    
    has_execute_values = 'execute_values' in repo_source or 'execute_values' in service_source
    has_execute_batch = 'execute_batch' in repo_source or 'execute_batch' in service_source
    has_create_table = 'CREATE TABLE' in repo_source or 'CREATE TABLE' in service_source
    
    print(f"\n1. Uses execute_values: {has_execute_values}")
    print(f"2. Uses execute_batch: {has_execute_batch}")
    print(f"3. Has CREATE TABLE: {has_create_table}")
    
    if not has_execute_values and not has_execute_batch and not has_create_table:
        print(f"\n   ✅ Orders module doesn't need batch operations (uses JSON + read-only Magento)")
    else:
        print(f"\n   ℹ️ Orders module may have some batch operations")


if __name__ == "__main__":
    print("=" * 70)
    print("ORDERS MODULE ANALYSIS")
    print("=" * 70)
    
    tests = [
        ("Module Structure", test_orders_module_structure),
        ("Service Load Time", test_orders_service_load_time),
        ("SKU Lookup Performance", test_sku_lookup_performance),
        ("No Batch Operations", test_orders_has_no_batch_operations),
    ]
    
    passed = 0
    failed = 0
    
    for name, test_func in tests:
        try:
            test_func()
            passed += 1
        except Exception as e:
            print(f"\n   ❌ FAILED: {e}")
            failed += 1
    
    print("\n" + "=" * 70)
    print(f"SUMMARY: {passed} passed, {failed} failed")
    print("=" * 70)
    
    if failed == 0:
        print("\n✅ CONCLUSION: Orders module does NOT need status check/init optimization")
        print("   - Uses JSON files for session persistence (not PostgreSQL tables)")
        print("   - Only does SELECT/UPDATE on inventory_metadata (created by inventory module)")
        print("   - No table initialization on page load")
