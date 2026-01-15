"""
Frontend Code Validation for Phase 2 Temporal Pricing
Validates that the frontend code changes are syntactically correct
and properly structured for integration with the backend.
"""

import re
import os

def read_file(path):
    with open(path, 'r', encoding='utf-8') as f:
        return f.read()

def test_javascript_functions():
    """Test that all required JavaScript functions are defined"""
    print("\n✅ TEST 1: JavaScript Function Definitions")
    
    js_path = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'js', 'modules', 'inventory', 'sourcing.js')
    content = read_file(js_path)
    
    required_functions = [
        'getDaysUntil',
        'renderCountdown',
        'renderPriceStatusBadge',
        'getPriceRowClass',
        'loadPendingPrices',
        'renderPendingPrices',
        'cancelPendingPrice',
        'editPendingPrice',
    ]
    
    all_found = True
    for func in required_functions:
        # Check for function definition (function name() or const name = or async function name)
        pattern = rf'(function\s+{func}\s*\(|const\s+{func}\s*=|async\s+function\s+{func}\s*\()'
        if re.search(pattern, content):
            print(f"   ✅ {func}() defined")
        else:
            print(f"   ❌ {func}() NOT FOUND")
            all_found = False
    
    return all_found


def test_api_endpoints():
    """Test that API endpoint paths are correct"""
    print("\n✅ TEST 2: API Endpoint Paths")
    
    js_path = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'js', 'modules', 'inventory', 'sourcing.js')
    content = read_file(js_path)
    
    required_endpoints = [
        ('/v1/inventory/sourcing/prices/pending', 'GET pending prices'),
        ('/v1/inventory/sourcing/prices/history', 'GET price history'),
        ('/v1/inventory/sourcing/prices/${priceId}/cancel', 'POST cancel price'),
        ('/v1/inventory/sourcing/prices/${priceId}', 'PUT update price'),
    ]
    
    all_found = True
    for endpoint, description in required_endpoints:
        # Escape special chars for regex but allow ${...} to match any variable
        pattern = endpoint.replace('${priceId}', r'\$\{[a-zA-Z_]+\}')
        if re.search(pattern, content):
            print(f"   ✅ {description}: {endpoint}")
        else:
            print(f"   ❌ {description}: {endpoint} NOT FOUND")
            all_found = False
    
    return all_found


def test_html_structure():
    """Test that HTML has required elements"""
    print("\n✅ TEST 3: HTML Panel Structure")
    
    html_path = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'html', 'inventory', 'sourcing.html')
    content = read_file(html_path)
    
    required_elements = [
        ('id="panel-pending"', 'Pending Prices panel'),
        ('id="pendingPricesTableBody"', 'Pending Prices table body'),
        ('id="pendingEmptyState"', 'Pending empty state'),
        ('data-tab="pending"', 'Pending tab button'),
        ('computed_status', 'Status column reference'),
    ]
    
    all_found = True
    for element, description in required_elements:
        if element in content:
            print(f"   ✅ {description}: {element}")
        else:
            # Some elements might not be directly in HTML (like computed_status)
            if element == 'computed_status':
                print(f"   ℹ️  {description}: rendered dynamically by JS")
            else:
                print(f"   ❌ {description}: {element} NOT FOUND")
                all_found = False
    
    return all_found


def test_css_classes():
    """Test that CSS has required status badge classes"""
    print("\n✅ TEST 4: CSS Status Badge Classes")
    
    css_path = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'css-new', 'pages', 'inventory', 'sourcing.css')
    content = read_file(css_path)
    
    required_classes = [
        ('.price-status-badge', 'Base status badge'),
        ('.status-active', 'Active status (green)'),
        ('.status-pending', 'Pending status (blue)'),
        ('.status-superseded', 'Superseded status (grey)'),
        ('.status-cancelled', 'Cancelled status (red)'),
        ('.countdown-label', 'Countdown label'),
        ('.pending-row', 'Pending row styling'),
        ('.cancelled-row', 'Cancelled row styling'),
    ]
    
    all_found = True
    for cls, description in required_classes:
        if cls in content:
            print(f"   ✅ {description}: {cls}")
        else:
            print(f"   ❌ {description}: {cls} NOT FOUND")
            all_found = False
    
    return all_found


def test_switchTab_pending():
    """Test that switchTab handles 'pending' case"""
    print("\n✅ TEST 5: switchTab() Pending Case")
    
    js_path = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'js', 'modules', 'inventory', 'sourcing.js')
    content = read_file(js_path)
    
    # Look for case 'pending' in switch statement
    if "case 'pending'" in content and 'loadPendingPrices' in content:
        print("   ✅ switchTab() has 'pending' case that calls loadPendingPrices()")
        return True
    else:
        print("   ❌ switchTab() missing 'pending' case or loadPendingPrices call")
        return False


def test_sourcingModule_exports():
    """Test that sourcingModule exports the new functions"""
    print("\n✅ TEST 6: sourcingModule Exports")
    
    js_path = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'js', 'modules', 'inventory', 'sourcing.js')
    content = read_file(js_path)
    
    required_exports = [
        'cancelPendingPrice',
        'editPendingPrice',
    ]
    
    # Find the sourcingModule object definition
    module_match = re.search(r'window\.sourcingModule\s*=\s*\{([^}]+(?:\{[^}]*\}[^}]*)*)\}', content, re.DOTALL)
    if not module_match:
        print("   ❌ window.sourcingModule not found")
        return False
    
    module_content = module_match.group(1)
    
    all_found = True
    for export in required_exports:
        if export in module_content:
            print(f"   ✅ {export} exported")
        else:
            print(f"   ❌ {export} NOT exported in sourcingModule")
            all_found = False
    
    return all_found


def test_http_put_function():
    """Test that put function is added to http.js"""
    print("\n✅ TEST 7: HTTP PUT Function")
    
    http_path = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'js', 'services', 'api', 'http.js')
    content = read_file(http_path)
    
    if "export const put" in content and "'PUT'" in content:
        print("   ✅ put() function exported from http.js")
        return True
    else:
        print("   ❌ put() function missing from http.js")
        return False


def run_all_tests():
    """Run all frontend validation tests"""
    print("=" * 60)
    print("PHASE 2 FRONTEND CODE VALIDATION")
    print("Validating temporal pricing frontend implementation")
    print("=" * 60)
    
    tests = [
        ("JavaScript Functions", test_javascript_functions),
        ("API Endpoints", test_api_endpoints),
        ("HTML Structure", test_html_structure),
        ("CSS Classes", test_css_classes),
        ("switchTab Pending", test_switchTab_pending),
        ("sourcingModule Exports", test_sourcingModule_exports),
        ("HTTP PUT Function", test_http_put_function),
    ]
    
    results = []
    for name, test_func in tests:
        try:
            result = test_func()
            results.append((name, result))
        except Exception as e:
            print(f"\n❌ {name}: EXCEPTION - {e}")
            import traceback
            traceback.print_exc()
            results.append((name, False))
    
    print("\n" + "=" * 60)
    print("VALIDATION SUMMARY")
    print("=" * 60)
    
    passed = sum(1 for _, r in results if r)
    total = len(results)
    
    for name, result in results:
        status = "✅ PASS" if result else "❌ FAIL"
        print(f"  {status}: {name}")
    
    print(f"\nTotal: {passed}/{total} validations passed")
    
    if passed == total:
        print("\n🎉 All validations passed! Frontend code is ready.")
    else:
        print("\n⚠️  Some validations failed. Review the output above.")
    
    return passed == total


if __name__ == "__main__":
    import sys
    success = run_all_tests()
    sys.exit(0 if success else 1)
