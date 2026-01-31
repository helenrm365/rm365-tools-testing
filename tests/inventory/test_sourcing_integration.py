#!/usr/bin/env python3
"""
Quick integration test for sourcing module changes
"""
import sys
sys.path.insert(0, './backend')

def test_imports():
    """Test all imports work"""
    from modules.inventory.sourcing.repository import SourcingRepository
    from modules.inventory.sourcing.service import SourcingService
    from modules.inventory.sourcing.api import router
    print("✅ All imports successful")
    return True

def test_repository_methods():
    """Test repository has required methods"""
    from modules.inventory.sourcing.repository import SourcingRepository
    repo = SourcingRepository()
    
    methods = [
        'get_all_products_from_inventory_metadata',
        'get_magento_prices',
        'get_full_matrix',
        'get_suppliers',
    ]
    
    for method in methods:
        if hasattr(repo, method):
            print(f"✅ Repository.{method} exists")
        else:
            print(f"❌ Repository.{method} MISSING")
            return False
    return True

def test_service_signatures():
    """Test service methods have correct signatures"""
    from modules.inventory.sourcing.service import SourcingService
    import inspect
    
    svc = SourcingService()
    
    # Check get_supplier_matrix
    sig = inspect.signature(svc.get_supplier_matrix)
    params = list(sig.parameters.keys())
    required = ['status_filter', 'search', 'page', 'per_page']
    for p in required:
        if p in params:
            print(f"✅ get_supplier_matrix has '{p}' param")
        else:
            print(f"❌ get_supplier_matrix MISSING '{p}' param")
            return False
    
    # Check get_analysis_dashboard
    sig = inspect.signature(svc.get_analysis_dashboard)
    params = list(sig.parameters.keys())
    required = ['status_filter', 'search', 'margin_status', 'page']
    for p in required:
        if p in params:
            print(f"✅ get_analysis_dashboard has '{p}' param")
        else:
            print(f"❌ get_analysis_dashboard MISSING '{p}' param")
            return False
    
    return True

def test_api_routes():
    """Test API routes are registered"""
    from modules.inventory.sourcing.api import router
    
    routes = [r.path for r in router.routes]
    print(f"✅ {len(router.routes)} API routes registered")
    
    required_routes = ['/matrix', '/analysis', '/suppliers', '/fx-rates']
    for r in required_routes:
        if r in routes:
            print(f"✅ Route {r} exists")
        else:
            print(f"❌ Route {r} MISSING")
            return False
    return True

if __name__ == '__main__':
    print("=" * 50)
    print("SOURCING MODULE INTEGRATION TEST")
    print("=" * 50)
    
    tests = [
        test_imports,
        test_repository_methods,
        test_service_signatures,
        test_api_routes,
    ]
    
    all_passed = True
    for test in tests:
        print(f"\n--- {test.__doc__} ---")
        try:
            if not test():
                all_passed = False
        except Exception as e:
            print(f"❌ Test failed with error: {e}")
            all_passed = False
    
    print("\n" + "=" * 50)
    if all_passed:
        print("✅ ALL TESTS PASSED")
    else:
        print("❌ SOME TESTS FAILED")
    print("=" * 50)
    
    sys.exit(0 if all_passed else 1)
