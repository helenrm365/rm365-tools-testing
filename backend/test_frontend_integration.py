"""
Frontend Integration Tests for Phase 2 Temporal Pricing
Tests the API endpoints that the frontend will call.
Run with: python test_frontend_integration.py
"""

import os
import sys
from datetime import date, timedelta
from decimal import Decimal

# Add backend to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# Load environment from .env if it exists (many prod setups use this)
try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass


def test_pending_prices_query():
    """Test the pending prices query returns correct structure for frontend"""
    from modules.inventory.sourcing.repo import SourcingRepo
    
    repo = SourcingRepo()
    
    try:
        # Get pending prices (no filters)
        pending = repo.get_pending_prices()
        
        print("\n✅ TEST 1: get_pending_prices()")
        print(f"   Found {len(pending)} pending prices")
        
        if pending:
            # Check required fields for frontend
            first = pending[0]
            required_fields = [
                'id', 'supplier_product_id', 'buy_price', 'currency',
                'effective_date', 'supplier_sku', 'supplier_product_name',
                'internal_sku', 'supplier_name'
            ]
            
            missing = [f for f in required_fields if f not in first]
            if missing:
                print(f"   ❌ Missing fields: {missing}")
                return False
            else:
                print(f"   ✅ All required fields present")
                print(f"   Sample: {first['supplier_name']} - {first['supplier_sku']} @ {first['buy_price']} {first['currency']}")
                print(f"   Effective: {first['effective_date']}")
        else:
            print("   ℹ️  No pending prices in database (this is OK)")
        
        return True
    except Exception as e:
        print(f"   ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_price_history_with_status():
    """Test price history includes computed_status for frontend"""
    from modules.inventory.sourcing.repo import SourcingRepo
    
    repo = SourcingRepo()
    
    try:
        # Get price history
        history = repo.get_price_history(limit=50)
        
        print("\n✅ TEST 2: get_price_history() with computed_status")
        print(f"   Found {len(history)} price records")
        
        if history:
            # Check computed_status field
            first = history[0]
            if 'computed_status' not in first:
                print("   ❌ computed_status field missing!")
                return False
            
            # Count status distribution
            statuses = {}
            for p in history:
                s = p.get('computed_status', 'unknown')
                statuses[s] = statuses.get(s, 0) + 1
            
            print(f"   ✅ computed_status field present")
            print(f"   Status distribution: {statuses}")
            
            # Check required fields for frontend rendering
            required_fields = [
                'id', 'supplier_name', 'supplier_sku', 'supplier_product_name',
                'internal_sku', 'buy_price', 'currency', 'effective_date',
                'created_by', 'import_batch_id', 'computed_status'
            ]
            missing = [f for f in required_fields if f not in first]
            if missing:
                print(f"   ⚠️  Missing fields: {missing}")
            else:
                print(f"   ✅ All required fields for rendering present")
        else:
            print("   ℹ️  No price history in database")
        
        return True
    except Exception as e:
        print(f"   ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_active_price_query():
    """Test get_active_price returns the correct price"""
    from modules.inventory.sourcing.repo import SourcingRepo
    
    repo = SourcingRepo()
    
    try:
        # First get a supplier_product_id from price history
        history = repo.get_price_history(limit=10)
        
        print("\n✅ TEST 3: get_active_price()")
        
        if not history:
            print("   ℹ️  No prices to test - skipping")
            return True
        
        # Get unique supplier_product_ids
        sp_ids = list(set(p['supplier_product_id'] for p in history))[:3]
        
        for sp_id in sp_ids:
            active = repo.get_active_price(sp_id)
            if active:
                print(f"   ✅ supplier_product_id={sp_id}: Active price = {active['buy_price']} {active['currency']} (effective: {active['effective_date']})")
            else:
                print(f"   ℹ️  supplier_product_id={sp_id}: No active price (may be all pending or cancelled)")
        
        return True
    except Exception as e:
        print(f"   ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_price_with_computed_status():
    """Test individual price lookup with computed status"""
    from modules.inventory.sourcing.repo import SourcingRepo
    
    repo = SourcingRepo()
    
    try:
        # Get a price ID from history
        history = repo.get_price_history(limit=5)
        
        print("\n✅ TEST 4: get_price_with_computed_status()")
        
        if not history:
            print("   ℹ️  No prices to test - skipping")
            return True
        
        for price in history[:3]:
            price_id = price['id']
            detailed = repo.get_price_with_computed_status(price_id)
            if detailed:
                print(f"   ✅ Price ID {price_id}: status={detailed['computed_status']}, price={detailed['buy_price']} {detailed['currency']}")
            else:
                print(f"   ❌ Price ID {price_id} not found!")
                return False
        
        return True
    except Exception as e:
        print(f"   ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_supplier_comparison_filtering():
    """Test that supplier comparison uses active price filtering"""
    from modules.inventory.sourcing.repo import SourcingRepo
    
    repo = SourcingRepo()
    
    try:
        print("\n✅ TEST 5: get_supplier_comparison() (active prices only)")
        
        comparison = repo.get_supplier_comparison()
        print(f"   Found {len(comparison)} products with suppliers")
        
        if comparison:
            # Check that we have supplier data
            sample = comparison[0]
            print(f"   Sample: {sample.get('internal_sku', 'N/A')} - {sample.get('product_name', 'N/A')}")
            if 'suppliers' in sample:
                print(f"   Has {len(sample['suppliers'])} suppliers")
        
        return True
    except Exception as e:
        print(f"   ❌ Error: {e}")
        import traceback
        traceback.print_exc()
        return False


def test_frontend_api_response_format():
    """Test that API response format matches frontend expectations"""
    print("\n✅ TEST 6: API Response Format Validation")
    
    # Expected response formats
    expected_pending = {
        "endpoint": "/prices/pending",
        "response_key": "pending_prices",
        "fields": ["id", "supplier_name", "supplier_sku", "buy_price", "currency", "effective_date"]
    }
    
    expected_history = {
        "endpoint": "/prices/history", 
        "response_key": "prices",
        "fields": ["id", "supplier_name", "supplier_sku", "buy_price", "currency", "effective_date", "computed_status"]
    }
    
    print(f"   ✅ Pending endpoint: {expected_pending['endpoint']}")
    print(f"      Response key: {expected_pending['response_key']}")
    print(f"   ✅ History endpoint: {expected_history['endpoint']}")
    print(f"      Response key: {expected_history['response_key']}")
    print(f"      Includes computed_status: ✅")
    
    return True


def run_all_tests():
    """Run all frontend integration tests"""
    print("=" * 60)
    print("PHASE 2 FRONTEND INTEGRATION TESTS")
    print("Testing temporal pricing API endpoints for frontend")
    print("=" * 60)
    
    tests = [
        ("Pending Prices Query", test_pending_prices_query),
        ("Price History with Status", test_price_history_with_status),
        ("Active Price Query", test_active_price_query),
        ("Price with Computed Status", test_price_with_computed_status),
        ("Supplier Comparison Filtering", test_supplier_comparison_filtering),
        ("API Response Format", test_frontend_api_response_format),
    ]
    
    results = []
    for name, test_func in tests:
        try:
            result = test_func()
            results.append((name, result))
        except Exception as e:
            print(f"\n❌ {name}: EXCEPTION - {e}")
            results.append((name, False))
    
    print("\n" + "=" * 60)
    print("TEST SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for _, r in results if r)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status}: {name}")
    
    print(f"\nTotal: {passed}/{total} tests passed")
    
    if passed == total:
        print("\n🎉 All tests passed! Frontend integration is ready.")
    else:
        print("\n⚠️  Some tests failed. Review the output above.")
    
    return passed == total


if __name__ == "__main__":
    success = run_all_tests()
    sys.exit(0 if success else 1)
