"""
Test Suite for Locations API
Tests all endpoints for the new locations structure with name, city_code, country_code
"""
import os
import requests

# Configuration
BASE_URL = os.getenv("API_BASE_URL", "http://127.0.0.1:8000/api")
USERNAME = os.getenv("TEST_USERNAME", "superadmin")
PASSWORD = os.getenv("TEST_PASSWORD", "admin123")

# Track results
passed = 0
failed = 0


def get_auth_token():
    """Get authentication token"""
    try:
        response = requests.post(
            f"{BASE_URL}/v1/auth/login",
            json={"username": USERNAME, "password": PASSWORD}
        )
        if response.status_code == 200:
            return response.json().get("access_token")
        print(f"   ❌ Auth failed: {response.status_code} - {response.text}")
        return None
    except Exception as e:
        print(f"   ❌ Auth error: {e}")
        return None


def test_pass(msg):
    global passed
    passed += 1
    print(f"   ✅ {msg}")


def test_fail(msg):
    global failed
    failed += 1
    print(f"   ❌ {msg}")


def run_tests():
    global passed, failed
    
    print("=" * 60)
    print("LOCATIONS API TEST SUITE")
    print("=" * 60)
    
    # Get auth token
    print("\n1. Authentication")
    token = get_auth_token()
    if not token:
        print("   ❌ Cannot continue without authentication")
        return
    test_pass("Login successful")
    headers = {"Authorization": f"Bearer {token}"}
    
    # Test init endpoint
    print("\n2. Initialize Locations Table")
    response = requests.get(f"{BASE_URL}/v1/locations/init", headers=headers)
    if response.status_code == 200:
        data = response.json()
        test_pass(f"Init successful - {data.get('message', 'OK')}")
    else:
        test_fail(f"Init failed: {response.status_code} - {response.text}")
    
    # Test get all locations
    print("\n3. Get All Locations")
    response = requests.get(f"{BASE_URL}/v1/locations", headers=headers)
    if response.status_code == 200:
        locations = response.json()
        test_pass(f"Found {len(locations)} locations")
        for loc in locations:
            print(f"      - {loc['country_code']} | {loc['name']} | {loc['city_code']}")
        
        # Verify structure has new fields
        if locations and all('city_code' in loc and 'country_code' in loc for loc in locations):
            test_pass("All locations have city_code and country_code fields")
        else:
            test_fail("Locations missing new fields")
    else:
        test_fail(f"Get locations failed: {response.status_code}")
    
    # Test get country codes
    print("\n4. Get Unique Country Codes")
    response = requests.get(f"{BASE_URL}/v1/locations/country-codes", headers=headers)
    if response.status_code == 200:
        codes = response.json()
        test_pass(f"Found country codes: {codes}")
    else:
        test_fail(f"Get country codes failed: {response.status_code} - {response.text}")
    
    # Test create location
    print("\n5. Create New Location")
    new_location_data = {
        "name": "London",
        "city_code": "LON",
        "country_code": "UK",
        "timezone": "Europe/London"
    }
    response = requests.post(f"{BASE_URL}/v1/locations", headers=headers, json=new_location_data)
    if response.status_code in [200, 201]:
        new_loc = response.json()
        test_pass(f"Created: {new_loc['country_code']} | {new_loc['name']} | {new_loc['city_code']}")
        new_id = new_loc['id']
        
        # Test get by name
        print("\n6. Get Location by Name")
        response = requests.get(f"{BASE_URL}/v1/locations/by-name/London%20Heathrow", headers=headers)
        if response.status_code == 200:
            loc = response.json()
            if loc and loc['name'] == 'London':
                test_pass(f"Found by name: {loc}")
            else:
                test_fail("Location data mismatch")
        else:
            test_fail(f"Get by name failed: {response.status_code} - {response.text}")
        
        # Test get by city code
        print("\n7. Get Location by City Code")
        response = requests.get(f"{BASE_URL}/v1/locations/by-city-code/LON", headers=headers)
        if response.status_code == 200:
            loc = response.json()
            if loc and loc['city_code'] == 'LON':
                test_pass(f"Found by city code: {loc}")
            else:
                test_fail("Location data mismatch")
        else:
            test_fail(f"Get by city code failed: {response.status_code} - {response.text}")
        
        # Test get by country
        print("\n8. Get Locations by Country")
        response = requests.get(f"{BASE_URL}/v1/locations/by-country/UK", headers=headers)
        if response.status_code == 200:
            locs = response.json()
            test_pass(f"Found {len(locs)} locations in UK")
            for loc in locs:
                print(f"      - {loc['name']} ({loc['city_code']})")
        else:
            test_fail(f"Get by country failed: {response.status_code} - {response.text}")
        
        # Test update location
        print("\n9. Update Location")
        update_data = {"city_code": "LCY"}  # Change from LON to LCY
        response = requests.patch(f"{BASE_URL}/v1/locations/{new_id}", headers=headers, json=update_data)
        if response.status_code == 200:
            updated = response.json()
            if updated['city_code'] == 'LCY':
                test_pass(f"Updated city code: {updated['city_code']}")
            else:
                test_fail("Update didn't apply")
        else:
            test_fail(f"Update failed: {response.status_code} - {response.text}")
        
        # Test delete location
        print("\n10. Delete Location")
        response = requests.delete(f"{BASE_URL}/v1/locations/{new_id}", headers=headers)
        if response.status_code == 200:
            test_pass("Deleted test location")
        else:
            test_fail(f"Delete failed: {response.status_code} - {response.text}")
        
        # Verify deletion
        response = requests.get(f"{BASE_URL}/v1/locations/{new_id}", headers=headers)
        if response.status_code == 404:
            test_pass("Verified deletion - location not found")
        else:
            test_fail("Location still exists after deletion")
    else:
        test_fail(f"Create failed: {response.status_code} - {response.text}")
    
    # Summary
    print("\n" + "=" * 60)
    print(f"RESULTS: {passed} passed, {failed} failed")
    print("=" * 60)
    
    return failed == 0


if __name__ == "__main__":
    success = run_tests()
    exit(0 if success else 1)
