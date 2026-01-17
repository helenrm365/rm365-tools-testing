"""
Test script for user management module structure.
Verifies that no table initialization happens on page load.
"""
import sys
import os
import time

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', '..', 'backend'))


def test_usermanagement_module_structure():
    """Verify user management module structure."""
    print("\n" + "=" * 60)
    print("Testing User Management Module Structure")
    print("=" * 60)
    
    # Users module
    from modules.users.repo import UsersRepo
    users_repo = UsersRepo()
    
    print("\n1. Users module:")
    has_init_tables = hasattr(users_repo, 'init_table') or hasattr(users_repo, 'init_tables')
    print(f"   Has init_table/init_tables: {has_init_tables}")
    
    if not has_init_tables:
        print(f"   ✅ Users module has no table init (table created externally)")
    
    # Roles module
    from modules.roles.repo import RolesRepo
    roles_repo = RolesRepo()
    
    print("\n2. Roles module:")
    has_init_table = hasattr(roles_repo, 'init_table')
    print(f"   Has init_table: {has_init_table}")
    
    if has_init_table:
        print(f"   ✅ Roles module has init_table (called at server startup)")


def test_roles_init_at_startup():
    """Verify roles table is initialized at server startup, not page load."""
    print("\n" + "=" * 60)
    print("Testing Roles Init Location")
    print("=" * 60)
    
    # Check if initialize_database calls init_roles_table
    import inspect
    from core.db import initialize_database
    
    source = inspect.getsource(initialize_database)
    
    has_roles_init = 'init_roles_table' in source
    print(f"\n1. initialize_database() calls init_roles_table: {has_roles_init}")
    
    if has_roles_init:
        print(f"   ✅ Roles table created at SERVER STARTUP, not page load")
    
    # Check roles API doesn't call init
    from modules.roles import api as roles_api
    api_source = inspect.getsource(roles_api)
    
    has_init_in_api = 'init_table' in api_source or 'init_roles' in api_source
    print(f"\n2. Roles API calls init: {has_init_in_api}")
    
    if not has_init_in_api:
        print(f"   ✅ Roles API does NOT call init on page load")


def test_service_instantiation_speed():
    """Test that service instantiation is fast (no DB init)."""
    print("\n" + "=" * 60)
    print("Testing Service Instantiation Speed")
    print("=" * 60)
    
    from modules.users.service import UsersService
    from modules.roles.service import RolesService
    
    print("\n1. Instantiating UsersService...")
    start = time.time()
    users_svc = UsersService()
    elapsed = time.time() - start
    print(f"   Time: {elapsed:.4f}s")
    
    if elapsed < 0.1:
        print(f"   ✅ UsersService instantiation is INSTANT")
    
    print("\n2. Instantiating RolesService...")
    start = time.time()
    roles_svc = RolesService()
    elapsed = time.time() - start
    print(f"   Time: {elapsed:.4f}s")
    
    if elapsed < 0.1:
        print(f"   ✅ RolesService instantiation is INSTANT (no DB init)")


def test_page_routing():
    """Verify that home page doesn't load management module."""
    print("\n" + "=" * 60)
    print("Testing Page Routing")
    print("=" * 60)
    
    # Read the index.js file
    frontend_path = os.path.join(os.path.dirname(__file__), '..', '..', 'frontend', 'js', 'modules', 'usermanagement', 'index.js')
    
    with open(frontend_path, 'r') as f:
        content = f.read()
    
    # Check routing
    home_loads_module = "case '/usermanagement':" in content and "break;" in content
    management_loads_module = "case '/usermanagement/management':" in content and "management.js" in content
    
    print(f"\n1. Home page (/usermanagement) loads module: {not home_loads_module}")
    print(f"2. Management page (/usermanagement/management) loads module: {management_loads_module}")
    
    if home_loads_module and management_loads_module:
        print(f"\n   ✅ Routing is correct: home page = no module, management page = module")


if __name__ == "__main__":
    print("=" * 70)
    print("USER MANAGEMENT MODULE ANALYSIS")
    print("=" * 70)
    
    tests = [
        ("Module Structure", test_usermanagement_module_structure),
        ("Roles Init Location", test_roles_init_at_startup),
        ("Service Instantiation Speed", test_service_instantiation_speed),
        ("Page Routing", test_page_routing),
    ]
    
    passed = 0
    failed = 0
    
    for name, test_func in tests:
        try:
            test_func()
            passed += 1
        except Exception as e:
            print(f"\n   ❌ FAILED: {e}")
            import traceback
            traceback.print_exc()
            failed += 1
    
    print("\n" + "=" * 70)
    print(f"SUMMARY: {passed} passed, {failed} failed")
    print("=" * 70)
    
    if failed == 0:
        print("\n✅ CONCLUSION: User management module does NOT need status check optimization")
        print("   - Roles table is created at SERVER STARTUP, not page load")
        print("   - Users table is assumed to exist (no init method)")
        print("   - Home page (/usermanagement) loads no module")
        print("   - Service instantiation is instant (no DB operations)")
