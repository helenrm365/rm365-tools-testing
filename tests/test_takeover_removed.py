#!/usr/bin/env python3
"""
Test that takeover request functionality has been properly removed from order fulfillment.
"""
import sys
import os

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))


def test_france_fulfillment_imports():
    """Test France fulfillment imports work correctly."""
    print('Testing France fulfillment imports...')
    from modules.orders.france_fulfillment import api as france_api
    from modules.orders.france_fulfillment import service as france_service
    from modules.orders.france_fulfillment import db_repo as france_db_repo
    print('✅ France fulfillment imports OK')


def test_london_fulfillment_imports():
    """Test London fulfillment imports work correctly."""
    print('Testing London fulfillment imports...')
    from modules.orders.london_fulfillment import api as london_api
    from modules.orders.london_fulfillment import service as london_service
    from modules.orders.london_fulfillment import db_repo as london_db_repo
    print('✅ London fulfillment imports OK')


def test_base_order_fulfillment_imports():
    """Test base order_fulfillment imports work correctly."""
    print('Testing base order_fulfillment imports...')
    from modules.orders.order_fulfillment import api as base_api
    from modules.orders.order_fulfillment import service as base_service
    from modules.orders.order_fulfillment import db_repo as base_db_repo
    print('✅ Base order_fulfillment imports OK')


def test_takeover_not_in_france_service():
    """Verify takeover methods removed from France service."""
    from modules.orders.france_fulfillment.service import FranceOrderFulfillmentService
    service = FranceOrderFulfillmentService
    
    # These methods should NOT exist
    assert not hasattr(service, 'request_takeover'), "request_takeover should be removed"
    assert not hasattr(service, 'respond_to_takeover'), "respond_to_takeover should be removed"
    assert not hasattr(service, 'get_pending_requests'), "get_pending_requests should be removed"
    print('✅ Takeover methods removed from France service')


def test_takeover_not_in_london_service():
    """Verify takeover methods removed from London service."""
    from modules.orders.london_fulfillment.service import LondonOrderFulfillmentService
    service = LondonOrderFulfillmentService
    
    # These methods should NOT exist
    assert not hasattr(service, 'request_takeover'), "request_takeover should be removed"
    assert not hasattr(service, 'respond_to_takeover'), "respond_to_takeover should be removed"
    assert not hasattr(service, 'get_pending_requests'), "get_pending_requests should be removed"
    print('✅ Takeover methods removed from London service')


def test_takeover_not_in_base_db_repo():
    """Verify takeover methods removed from base db_repo."""
    from modules.orders.order_fulfillment.db_repo import MagentoDbRepo
    repo = MagentoDbRepo
    
    # These methods should NOT exist
    assert not hasattr(repo, 'create_takeover_request'), "create_takeover_request should be removed"
    assert not hasattr(repo, 'get_takeover_request'), "get_takeover_request should be removed"
    assert not hasattr(repo, 'get_pending_takeover_requests'), "get_pending_takeover_requests should be removed"
    assert not hasattr(repo, 'respond_to_takeover_request'), "respond_to_takeover_request should be removed"
    assert not hasattr(repo, '_row_to_takeover_request'), "_row_to_takeover_request should be removed"
    print('✅ Takeover methods removed from base db_repo')


if __name__ == '__main__':
    print('\n' + '=' * 60)
    print('Testing Takeover Removal from Order Fulfillment')
    print('=' * 60 + '\n')
    
    try:
        test_france_fulfillment_imports()
        test_london_fulfillment_imports()
        test_base_order_fulfillment_imports()
        test_takeover_not_in_france_service()
        test_takeover_not_in_london_service()
        test_takeover_not_in_base_db_repo()
        
        print('\n' + '=' * 60)
        print('✅ ALL TESTS PASSED!')
        print('=' * 60)
    except Exception as e:
        print(f'\n❌ TEST FAILED: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(1)
