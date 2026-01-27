#!/usr/bin/env python3
"""Test the load times for Magento Data pages.

This script measures how long the API endpoints take to respond,
simulating what happens when each Magento Data page loads.
"""

import sys
import os
import time
import requests
from concurrent.futures import ThreadPoolExecutor
import json

# Add backend to path for env loading
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

# API Configuration
API_BASE = os.environ.get('API_URL', 'http://localhost:8000')
API_PREFIX = '/api/v1/magentodata'

# Auth token (will be set after login)
AUTH_TOKEN = None


def login() -> str:
    """Login and get auth token using superadmin credentials."""
    global AUTH_TOKEN
    
    username = os.environ.get('SUPERADMIN_USERNAME', 'admin')
    password = os.environ.get('SUPERADMIN_PASSWORD', 'admin')
    
    url = f"{API_BASE}/api/v1/auth/login"
    try:
        response = requests.post(url, json={
            'username': username,
            'password': password
        }, timeout=10)
        
        if response.status_code == 200:
            data = response.json()
            AUTH_TOKEN = data.get('access_token')
            print(f"✅ Logged in as: {username}")
            return AUTH_TOKEN
        else:
            print(f"❌ Login failed: {response.status_code} - {response.text}")
            return None
    except Exception as e:
        print(f"❌ Login error: {e}")
        return None


def time_request(name: str, method: str, endpoint: str, **kwargs) -> dict:
    """Time a single API request."""
    url = f"{API_BASE}{API_PREFIX}{endpoint}"
    
    # Add auth header if we have a token
    headers = kwargs.pop('headers', {})
    if AUTH_TOKEN:
        headers['Authorization'] = f'Bearer {AUTH_TOKEN}'
    
    start = time.time()
    try:
        if method == 'GET':
            response = requests.get(url, timeout=60, headers=headers, **kwargs)
        else:
            response = requests.post(url, timeout=60, headers=headers, **kwargs)
        
        elapsed = time.time() - start
        
        result = {
            'name': name,
            'url': url,
            'status': response.status_code,
            'time_seconds': round(elapsed, 3),
            'success': response.status_code == 200
        }
        
        # Try to get record count from response
        if response.status_code == 200:
            try:
                data = response.json()
                if 'total_count' in data:
                    result['total_records'] = data['total_count']
                if 'data' in data:
                    result['returned_records'] = len(data['data'])
            except:
                pass
        
        return result
        
    except requests.exceptions.Timeout:
        return {
            'name': name,
            'url': url,
            'status': 'TIMEOUT',
            'time_seconds': 60,
            'success': False
        }
    except requests.exceptions.ConnectionError as e:
        return {
            'name': name,
            'url': url,
            'status': 'CONNECTION_ERROR',
            'time_seconds': time.time() - start,
            'success': False,
            'error': str(e)
        }
    except Exception as e:
        return {
            'name': name,
            'url': url,
            'status': 'ERROR',
            'time_seconds': time.time() - start,
            'success': False,
            'error': str(e)
        }


def test_page_load_sequence(region: str) -> dict:
    """
    Simulate the full page load sequence for a Magento region page.
    
    On page load, the frontend does:
    1. Check tables status (checkTablesStatus)
    2. Load data from cache (getXXMagentoData with limit=100, offset=0)
    """
    print(f"\n{'='*60}")
    print(f"Testing {region.upper()} Magento Page Load")
    print('='*60)
    
    results = {
        'region': region,
        'steps': [],
        'total_time': 0
    }
    
    total_start = time.time()
    
    # Step 1: Check tables status
    print("\n1. Checking tables status...")
    status_result = time_request(
        f"{region.upper()} - Check Tables Status",
        'GET',
        '/status'
    )
    results['steps'].append(status_result)
    print(f"   Status: {status_result['status']}, Time: {status_result['time_seconds']}s")
    
    # Step 2: Load initial data (100 records, page 0)
    print(f"\n2. Loading initial {region.upper()} data (100 records)...")
    data_result = time_request(
        f"{region.upper()} - Load Initial Data",
        'GET',
        f'/{region}?limit=100&offset=0&search='
    )
    results['steps'].append(data_result)
    print(f"   Status: {data_result['status']}, Time: {data_result['time_seconds']}s")
    if data_result.get('total_records'):
        print(f"   Total records in DB: {data_result['total_records']:,}")
    if data_result.get('returned_records'):
        print(f"   Records returned: {data_result['returned_records']}")
    
    results['total_time'] = round(time.time() - total_start, 3)
    
    return results


def test_aggregated_view(region: str) -> dict:
    """Test the 6-month aggregated view load time."""
    print(f"\n{'='*60}")
    print(f"Testing {region.upper()} 6-Month Aggregated View")
    print('='*60)
    
    result = time_request(
        f"{region.upper()} - 6-Month Aggregated",
        'GET',
        f'/{region}/aggregated?limit=100&offset=0'
    )
    
    print(f"   Status: {result['status']}, Time: {result['time_seconds']}s")
    if result.get('total_records'):
        print(f"   Total aggregated records: {result['total_records']:,}")
    
    return result


def main():
    print("=" * 60)
    print("MAGENTO DATA PAGE LOAD TIME TEST")
    print("=" * 60)
    print(f"\nAPI Base URL: {API_BASE}")
    print(f"Endpoint Prefix: {API_PREFIX}")
    
    # First, check if the server is running
    print("\nChecking server connection...")
    try:
        response = requests.get(f"{API_BASE}/health", timeout=5)
        print(f"Server health check: {response.status_code}")
    except Exception as e:
        print(f"Warning: Could not reach server health endpoint: {e}")
        print("Continuing with tests anyway...\n")
    
    # Login to get auth token
    print("\nAuthenticating...")
    if not login():
        print("⚠️  Could not authenticate. Tests may fail with 401/422 errors.")
    
    all_results = {
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'api_base': API_BASE,
        'regions': {}
    }
    
    # Test each region's page load
    for region in ['uk', 'fr', 'nl']:
        region_results = test_page_load_sequence(region)
        all_results['regions'][region] = region_results
        
        # Also test aggregated view
        agg_result = test_aggregated_view(region)
        all_results['regions'][region]['aggregated'] = agg_result
    
    # Summary
    print("\n" + "=" * 60)
    print("SUMMARY")
    print("=" * 60)
    
    print("\n┌─────────────────────────────────────────────────────────┐")
    print("│ Region │ Status Check │ Data Load │ Aggregated │ Total  │")
    print("├─────────────────────────────────────────────────────────┤")
    
    for region, data in all_results['regions'].items():
        status_time = data['steps'][0]['time_seconds'] if data['steps'] else 'N/A'
        data_time = data['steps'][1]['time_seconds'] if len(data['steps']) > 1 else 'N/A'
        agg_time = data.get('aggregated', {}).get('time_seconds', 'N/A')
        total_time = data.get('total_time', 'N/A')
        
        print(f"│ {region.upper():6} │ {status_time:12}s │ {data_time:9}s │ {agg_time:10}s │ {total_time:6}s │")
    
    print("└─────────────────────────────────────────────────────────┘")
    
    # Determine if times are acceptable
    print("\n📊 Performance Assessment:")
    for region, data in all_results['regions'].items():
        total = data.get('total_time', 0)
        if isinstance(total, (int, float)):
            if total < 1:
                emoji = "✅"
                status = "Excellent"
            elif total < 3:
                emoji = "✅"
                status = "Good"
            elif total < 5:
                emoji = "⚠️"
                status = "Acceptable"
            else:
                emoji = "❌"
                status = "Slow"
            print(f"   {emoji} {region.upper()}: {status} ({total}s)")
    
    # Save results to file
    results_file = os.path.join(os.path.dirname(__file__), 'magento_load_time_results.json')
    with open(results_file, 'w') as f:
        json.dump(all_results, f, indent=2)
    print(f"\n📁 Detailed results saved to: {results_file}")
    
    return all_results


if __name__ == '__main__':
    main()
