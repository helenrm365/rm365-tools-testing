"""
Test script for inventory management load time.
Measures baseline performance before optimizations.
"""
import sys
import os
import time

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))

def test_inventory_management_load_time():
    """Test the inventory management page load time."""
    print("=" * 60)
    print("Testing Inventory Management Load Time")
    print("=" * 60)
    
    from modules.inventory.management.service import InventoryManagementService
    
    svc = InventoryManagementService()
    
    # Test full load (simulating page load)
    print("\n1. Testing full inventory load (simulating page load)...")
    print("   This includes: init_tables, sync, merge, ensure IDs, query...")
    
    start = time.time()
    try:
        result = svc.get_inventory_items(page=1, per_page=100, discontinued_status="Active,Temporarily OOS,Pre Order,Samples")
        elapsed = time.time() - start
        
        print(f"\n   Results:")
        print(f"   Items returned: {len(result.get('items', []))}")
        print(f"   Total items: {result.get('total', 0)}")
        print(f"   Load time: {elapsed:.2f} seconds")
        
        if elapsed < 5:
            print(f"   ✅ Performance is GOOD (under 5s)")
        elif elapsed < 15:
            print(f"   ⚠️  Performance is ACCEPTABLE (under 15s)")
        elif elapsed < 30:
            print(f"   ⚠️  Performance needs improvement ({elapsed:.0f}s)")
        else:
            print(f"   ❌ Performance is POOR ({elapsed:.0f}s)")
            
        return elapsed
        
    except Exception as e:
        elapsed = time.time() - start
        print(f"   ❌ Error: {e}")
        print(f"   Time before error: {elapsed:.2f}s")
        return elapsed


def test_individual_operations():
    """Test individual operations to identify bottlenecks."""
    print("\n" + "=" * 60)
    print("Testing Individual Operations")
    print("=" * 60)
    
    from modules.inventory.management.repo import InventoryManagementRepo
    
    repo = InventoryManagementRepo()
    
    # Test check_tables_exist (new status check)
    print("\n0. Testing check_tables_exist() (status check)...")
    start = time.time()
    try:
        status = repo.check_tables_exist()
        print(f"   Tables status: {status}")
        print(f"   Time: {time.time() - start:.3f}s")
    except Exception as e:
        print(f"   Error: {e}")
        print(f"   Time: {time.time() - start:.3f}s")
    
    # Test init_tables
    print("\n1. Testing init_tables()...")
    start = time.time()
    repo.init_tables()
    print(f"   Time: {time.time() - start:.3f}s")
    
    # Test sync_magento_products_to_inventory_metadata
    print("\n2. Testing sync_magento_products_to_inventory_metadata()...")
    start = time.time()
    try:
        repo.sync_magento_products_to_inventory_metadata()
        print(f"   Time: {time.time() - start:.3f}s")
    except Exception as e:
        print(f"   Error: {e}")
        print(f"   Time: {time.time() - start:.3f}s")
    
    # Test merge_identifier_products
    print("\n3. Testing merge_identifier_products()...")
    start = time.time()
    try:
        repo.merge_identifier_products()
        print(f"   Time: {time.time() - start:.3f}s")
    except Exception as e:
        print(f"   Error: {e}")
        print(f"   Time: {time.time() - start:.3f}s")
    
    # Test ensure_all_products_have_item_ids
    print("\n4. Testing ensure_all_products_have_item_ids()...")
    start = time.time()
    try:
        repo.ensure_all_products_have_item_ids()
        print(f"   Time: {time.time() - start:.3f}s")
    except Exception as e:
        print(f"   Error: {e}")
        print(f"   Time: {time.time() - start:.3f}s")
    
    print("\n" + "=" * 60)
    print("Individual Operations Test Complete")
    print("=" * 60)


if __name__ == "__main__":
    # First test individual operations to identify bottlenecks
    test_individual_operations()
    
    # Then test full load
    elapsed = test_inventory_management_load_time()
    
    print(f"\n\n📊 BASELINE SUMMARY")
    print(f"   Inventory management load time: {elapsed:.2f}s")
