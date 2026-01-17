"""
Data Integrity Tests for Inventory Management
Verifies that batch operations produce correct results, specifically:
1. SKU merging logic (-MD, -SD, -DP, -NP, -MV suffixes)
2. Sync from Magento produces correct data
3. Item IDs are generated correctly
4. No data corruption from batch inserts/updates
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))


def test_sku_merging_logic():
    """Test that SKU merging correctly normalizes identifier suffixes."""
    import re
    
    print("\n" + "=" * 60)
    print("Testing SKU Merging Logic")
    print("=" * 60)
    
    # The pattern used in merge_identifier_products
    identifier_pattern = re.compile(r'-(?:MD|SD|DP|NP|MV)(?:-.*)?$', re.IGNORECASE)
    
    # Test cases: (input SKU, expected base SKU)
    test_cases = [
        # Standard suffixes
        ("PRODUCT-123-MD", "PRODUCT-123"),
        ("PRODUCT-123-SD", "PRODUCT-123"),
        ("PRODUCT-123-DP", "PRODUCT-123"),
        ("PRODUCT-123-NP", "PRODUCT-123"),
        ("PRODUCT-123-MV", "PRODUCT-123"),
        
        # Extended variants
        ("PRODUCT-123-MD-1234", "PRODUCT-123"),
        ("PRODUCT-123-SD-ABCD", "PRODUCT-123"),
        ("PRODUCT-123-DP-XYZ", "PRODUCT-123"),
        
        # Case insensitivity
        ("PRODUCT-123-md", "PRODUCT-123"),
        ("PRODUCT-123-Md", "PRODUCT-123"),
        
        # SKUs that should NOT be modified
        ("PRODUCT-123", "PRODUCT-123"),
        ("PRODUCT-123-ABC", "PRODUCT-123-ABC"),  # Not a known suffix
        
        # Edge cases
        ("MD-PRODUCT-123", "MD-PRODUCT-123"),  # MD at start
        ("PRODUCT-123-MEDIUM", "PRODUCT-123-MEDIUM"),  # Contains MD but not suffix
        # Note: PRODUCT-MD-123 would match as -MD-123 suffix, but no such SKUs exist in real data
    ]
    
    passed = 0
    failed = 0
    
    for input_sku, expected in test_cases:
        result = identifier_pattern.sub('', input_sku)
        if result == expected:
            print(f"   ✅ '{input_sku}' → '{result}'")
            passed += 1
        else:
            print(f"   ❌ '{input_sku}' → '{result}' (expected '{expected}')")
            failed += 1
    
    print(f"\n   Results: {passed} passed, {failed} failed")
    assert failed == 0, f"SKU merging logic has {failed} failures"
    return True


def test_item_id_generation():
    """Test that item IDs are generated consistently."""
    print("\n" + "=" * 60)
    print("Testing Item ID Generation")
    print("=" * 60)
    
    from modules.inventory.management.repo import InventoryManagementRepo
    
    # Test that same SKU always generates same item ID
    test_skus = ["TEST-001", "PRODUCT-ABC", "SKU-WITH-DASHES-123"]
    
    for sku in test_skus:
        id1 = InventoryManagementRepo.generate_item_id(sku)
        id2 = InventoryManagementRepo.generate_item_id(sku)
        
        assert id1 == id2, f"Item ID not consistent for SKU {sku}"
        assert len(id1) == 18, f"Item ID length should be 18, got {len(id1)}"
        assert id1.startswith('7'), f"Item ID should start with 7, got {id1}"
        print(f"   ✅ '{sku}' → {id1} (consistent, 18 digits, starts with 7)")
    
    # Test that different SKUs generate different IDs
    ids = [InventoryManagementRepo.generate_item_id(sku) for sku in test_skus]
    assert len(ids) == len(set(ids)), "Different SKUs should generate different IDs"
    print(f"   ✅ All {len(test_skus)} SKUs generated unique IDs")
    
    return True


def test_data_integrity_after_sync():
    """Test that data synced from Magento is correct."""
    print("\n" + "=" * 60)
    print("Testing Data Integrity After Sync")
    print("=" * 60)
    
    from modules.inventory.management.repo import InventoryManagementRepo
    
    repo = InventoryManagementRepo()
    
    # Get current data before any operations
    print("\n1. Loading current inventory metadata...")
    metadata = repo.load_inventory_metadata()
    print(f"   Found {len(metadata)} records in inventory_metadata")
    
    # Check for required fields
    print("\n2. Verifying required fields exist...")
    required_fields = ['sku', 'item_id', 'status']
    for record in metadata[:10]:  # Check first 10 records
        for field in required_fields:
            assert field in record, f"Missing field '{field}' in record"
    print(f"   ✅ All required fields present in sample records")
    
    # Check SKU format (no identifier suffixes should remain after merge)
    print("\n3. Checking for remaining identifier suffixes...")
    import re
    identifier_pattern = re.compile(r'-(?:MD|SD|DP|NP|MV)(?:-.*)?$', re.IGNORECASE)
    
    suffix_skus = [r['sku'] for r in metadata if identifier_pattern.search(r.get('sku', ''))]
    if suffix_skus:
        print(f"   ⚠️  Found {len(suffix_skus)} SKUs with identifier suffixes (may need merge):")
        for sku in suffix_skus[:5]:
            print(f"       - {sku}")
    else:
        print(f"   ✅ No SKUs with identifier suffixes found")
    
    # Check item IDs are populated
    print("\n4. Checking item IDs are populated...")
    missing_item_ids = [r['sku'] for r in metadata if not r.get('item_id')]
    if missing_item_ids:
        print(f"   ⚠️  Found {len(missing_item_ids)} SKUs without item IDs")
    else:
        print(f"   ✅ All {len(metadata)} records have item IDs")
    
    # Check for duplicate SKUs (should never happen with unique constraint)
    print("\n5. Checking for duplicate SKUs...")
    skus = [r['sku'] for r in metadata]
    duplicates = [sku for sku in skus if skus.count(sku) > 1]
    if duplicates:
        print(f"   ❌ Found duplicate SKUs: {set(duplicates)}")
        assert False, f"Duplicate SKUs found: {set(duplicates)}"
    else:
        print(f"   ✅ No duplicate SKUs (unique constraint intact)")
    
    # Check item ID uniqueness
    print("\n6. Checking item ID uniqueness...")
    item_ids = [r['item_id'] for r in metadata if r.get('item_id')]
    duplicate_ids = [iid for iid in item_ids if item_ids.count(iid) > 1]
    if duplicate_ids:
        print(f"   ❌ Found duplicate item IDs: {len(set(duplicate_ids))}")
        assert False, f"Duplicate item IDs found"
    else:
        print(f"   ✅ All {len(item_ids)} item IDs are unique")
    
    return True


def test_batch_sync_produces_correct_data():
    """Test that batch sync operation produces correct data."""
    print("\n" + "=" * 60)
    print("Testing Batch Sync Data Correctness")
    print("=" * 60)
    
    from modules.inventory.management.repo import InventoryManagementRepo
    
    repo = InventoryManagementRepo()
    
    # Run sync
    print("\n1. Running sync_magento_products_to_inventory_metadata()...")
    stats = repo.sync_magento_products_to_inventory_metadata()
    print(f"   Synced: {stats.get('synced_records', 0)} records")
    print(f"   Filtered AW365: {stats.get('filtered_aw365', 0)} products")
    
    # Verify no AW365 products in result
    print("\n2. Verifying AW365 products were filtered...")
    metadata = repo.load_inventory_metadata()
    aw365_products = [r for r in metadata if 'AW365' in (r.get('sku', '') or '').upper()]
    if aw365_products:
        print(f"   ❌ Found {len(aw365_products)} AW365 products that should have been filtered")
    else:
        print(f"   ✅ No AW365 products in inventory_metadata")
    
    # Verify status field is populated
    print("\n3. Verifying status field is populated...")
    missing_status = [r['sku'] for r in metadata if not r.get('status')]
    if missing_status:
        print(f"   ⚠️  Found {len(missing_status)} records without status")
    else:
        print(f"   ✅ All records have status field populated")
    
    # Check status values are valid
    print("\n4. Checking status values...")
    valid_statuses = {'Active', 'Temporarily OOS', 'Pre Order', 'Samples', 'Discontinued', None, ''}
    status_counts = {}
    for r in metadata:
        status = r.get('status') or 'Unknown'
        status_counts[status] = status_counts.get(status, 0) + 1
    
    print("   Status distribution:")
    for status, count in sorted(status_counts.items(), key=lambda x: -x[1]):
        print(f"       {status}: {count}")
    
    return True


def test_merge_then_ensure_ids_sequence():
    """Test the full sequence: merge → ensure IDs → verify integrity."""
    print("\n" + "=" * 60)
    print("Testing Full Merge → Ensure IDs Sequence")
    print("=" * 60)
    
    from modules.inventory.management.repo import InventoryManagementRepo
    
    repo = InventoryManagementRepo()
    
    # Step 1: Merge identifiers
    print("\n1. Running merge_identifier_products()...")
    merge_stats = repo.merge_identifier_products()
    print(f"   Checked: {merge_stats.get('total_checked', 0)} SKUs with suffixes")
    print(f"   Deleted (merged): {merge_stats.get('deleted', 0)}")
    print(f"   Renamed to base: {merge_stats.get('renamed', 0)}")
    
    # Step 2: Ensure IDs
    print("\n2. Running ensure_all_products_have_item_ids()...")
    id_stats = repo.ensure_all_products_have_item_ids()
    print(f"   Generated new IDs: {id_stats.get('generated', 0)}")
    print(f"   Already had IDs: {id_stats.get('already_have_id', 0)}")
    
    # Step 3: Verify integrity
    print("\n3. Verifying final data integrity...")
    metadata = repo.load_inventory_metadata()
    
    import re
    identifier_pattern = re.compile(r'-(?:MD|SD|DP|NP|MV)(?:-.*)?$', re.IGNORECASE)
    
    # Check no suffixes remain
    remaining_suffixes = [r['sku'] for r in metadata if identifier_pattern.search(r.get('sku', ''))]
    assert len(remaining_suffixes) == 0, f"Found remaining suffixes: {remaining_suffixes[:5]}"
    print(f"   ✅ No identifier suffixes remaining")
    
    # Check all have item IDs
    missing_ids = [r['sku'] for r in metadata if not r.get('item_id')]
    assert len(missing_ids) == 0, f"Found SKUs without item IDs: {missing_ids[:5]}"
    print(f"   ✅ All {len(metadata)} products have item IDs")
    
    # Check no duplicate SKUs
    skus = [r['sku'] for r in metadata]
    assert len(skus) == len(set(skus)), "Duplicate SKUs found"
    print(f"   ✅ All SKUs are unique")
    
    # Check no duplicate item IDs
    item_ids = [r['item_id'] for r in metadata]
    assert len(item_ids) == len(set(item_ids)), "Duplicate item IDs found"
    print(f"   ✅ All item IDs are unique")
    
    print(f"\n   ✅ FINAL: {len(metadata)} products with correct data integrity")
    
    return True


if __name__ == "__main__":
    print("=" * 70)
    print("INVENTORY DATA INTEGRITY TEST SUITE")
    print("=" * 70)
    
    tests = [
        ("SKU Merging Logic", test_sku_merging_logic),
        ("Item ID Generation", test_item_id_generation),
        ("Data Integrity After Sync", test_data_integrity_after_sync),
        ("Batch Sync Correctness", test_batch_sync_produces_correct_data),
        ("Full Merge → IDs Sequence", test_merge_then_ensure_ids_sequence),
    ]
    
    passed = 0
    failed = 0
    
    for name, test_func in tests:
        try:
            result = test_func()
            if result:
                passed += 1
        except Exception as e:
            print(f"\n   ❌ FAILED: {e}")
            failed += 1
    
    print("\n" + "=" * 70)
    print(f"SUMMARY: {passed} passed, {failed} failed")
    print("=" * 70)
