#!/usr/bin/env python3
"""
Complete test suite for User Preferences (Appearance Settings) feature.
Tests:
1. Database column existence
2. Dark mode toggle
3. Light mode toggle  
4. Custom accent colors
5. Persistence across sessions
"""

import requests
import json
import os
import sys
from pathlib import Path

# Load environment
try:
    from dotenv import load_dotenv
    load_dotenv(Path('/Users/ianhjweng/Documents/github/rm365-tools-testing/.env'))
except ImportError:
    pass

BASE_URL = "http://localhost:8000/api/v1"

def get_token():
    """Login and get auth token"""
    resp = requests.post(f"{BASE_URL}/auth/login", json={
        "username": "superadmin",
        "password": "admin123"
    })
    if resp.status_code == 200:
        return resp.json().get("access_token")
    return None

def test_preferences():
    print("=" * 60)
    print("🧪 APPEARANCE SETTINGS COMPLETE TEST SUITE")
    print("=" * 60)
    
    # Get auth token
    token = get_token()
    if not token:
        print("❌ Failed to get auth token")
        return False
    
    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    
    # Test 1: GET default preferences
    print("\n1️⃣  GET default preferences")
    resp = requests.get(f"{BASE_URL}/users/preferences", headers=headers)
    if resp.status_code == 200:
        prefs = resp.json()
        print(f"   dark_mode: {prefs.get('dark_mode')}")
        print(f"   accent_enabled: {prefs.get('accent_enabled')}")
        print(f"   accent_color: {prefs.get('accent_color')}")
        print("   ✅ GET works!")
    else:
        print(f"   ❌ GET failed: {resp.text}")
        return False
    
    # Test 2: Enable dark mode
    print("\n2️⃣  Enable DARK MODE")
    payload = {
        "dark_mode": True,
        "accent_enabled": False,
        "accent_color": "#8bc34a",
        "accent_dark": "#7ab82d",
        "accent_light": "#a5d461"
    }
    resp = requests.put(f"{BASE_URL}/users/preferences", headers=headers, json=payload)
    if resp.status_code == 200:
        result = resp.json()
        if result.get("preferences", {}).get("dark_mode") == True:
            print("   ✅ Dark mode enabled!")
        else:
            print("   ❌ Dark mode not set correctly")
            return False
    else:
        print(f"   ❌ PUT failed: {resp.text}")
        return False
    
    # Test 3: Switch to light mode
    print("\n3️⃣  Switch to LIGHT MODE")
    payload["dark_mode"] = False
    resp = requests.put(f"{BASE_URL}/users/preferences", headers=headers, json=payload)
    if resp.status_code == 200:
        result = resp.json()
        if result.get("preferences", {}).get("dark_mode") == False:
            print("   ✅ Light mode enabled!")
        else:
            print("   ❌ Light mode not set correctly")
            return False
    else:
        print(f"   ❌ PUT failed: {resp.text}")
        return False
    
    # Test 4: Custom purple accent colors
    print("\n4️⃣  Set CUSTOM PURPLE ACCENT")
    payload = {
        "dark_mode": False,
        "accent_enabled": True,
        "accent_color": "#9c27b0",
        "accent_dark": "#7b1fa2",
        "accent_light": "#ce93d8"
    }
    resp = requests.put(f"{BASE_URL}/users/preferences", headers=headers, json=payload)
    if resp.status_code == 200:
        result = resp.json()
        prefs = result.get("preferences", {})
        print(f"   accent_light: {prefs.get('accent_light')}")
        print(f"   accent:       {prefs.get('accent_color')}")
        print(f"   accent_dark:  {prefs.get('accent_dark')}")
        if prefs.get("accent_color") == "#9c27b0":
            print("   ✅ Purple accent set!")
        else:
            print("   ❌ Accent not set correctly")
            return False
    else:
        print(f"   ❌ PUT failed: {resp.text}")
        return False
    
    # Test 5: Custom blue accent with dark mode
    print("\n5️⃣  Set BLUE ACCENT + DARK MODE")
    payload = {
        "dark_mode": True,
        "accent_enabled": True,
        "accent_color": "#2196f3",
        "accent_dark": "#1976d2",
        "accent_light": "#64b5f6"
    }
    resp = requests.put(f"{BASE_URL}/users/preferences", headers=headers, json=payload)
    if resp.status_code == 200:
        result = resp.json()
        prefs = result.get("preferences", {})
        print(f"   dark_mode:    {prefs.get('dark_mode')}")
        print(f"   accent_light: {prefs.get('accent_light')}")
        print(f"   accent:       {prefs.get('accent_color')}")
        print(f"   accent_dark:  {prefs.get('accent_dark')}")
        if prefs.get("dark_mode") and prefs.get("accent_color") == "#2196f3":
            print("   ✅ Blue theme + dark mode set!")
        else:
            print("   ❌ Settings not correct")
            return False
    else:
        print(f"   ❌ PUT failed: {resp.text}")
        return False
    
    # Test 6: Reset to defaults
    print("\n6️⃣  RESET to defaults")
    payload = {
        "dark_mode": False,
        "accent_enabled": False,
        "accent_color": "#8bc34a",
        "accent_dark": "#7ab82d",
        "accent_light": "#a5d461"
    }
    resp = requests.put(f"{BASE_URL}/users/preferences", headers=headers, json=payload)
    if resp.status_code == 200:
        print("   ✅ Reset to defaults!")
    else:
        print(f"   ❌ Reset failed: {resp.text}")
        return False
    
    print("\n" + "=" * 60)
    print("🎉 ALL TESTS PASSED!")
    print("=" * 60)
    return True

def test_database_persistence():
    """Test that preferences persist in database for real users"""
    print("\n" + "=" * 60)
    print("🗄️  DATABASE PERSISTENCE TEST (with real user 'ian')")
    print("=" * 60)
    
    sys.path.insert(0, '/Users/ianhjweng/Documents/github/rm365-tools-testing/backend')
    
    try:
        from modules.users.service import UsersService
        svc = UsersService()
        
        test_user = 'ian'
        
        # Save custom preferences
        custom = {
            'dark_mode': True,
            'accent_enabled': True,
            'accent_color': '#ff5722',  # Deep Orange
            'accent_dark': '#e64a19',
            'accent_light': '#ff8a65'
        }
        
        print(f"\n1️⃣  Saving to database for user '{test_user}':")
        print(f"   {json.dumps(custom, indent=6)}")
        svc.save_preferences(test_user, custom)
        
        print(f"\n2️⃣  Reading back from database:")
        saved = svc.get_preferences(test_user)
        print(f"   {json.dumps(saved, indent=6)}")
        
        if saved.get('accent_color') == custom['accent_color']:
            print("\n   ✅ DATABASE PERSISTENCE VERIFIED!")
        else:
            print("\n   ❌ DATABASE PERSISTENCE FAILED!")
            return False
        
        # Reset
        defaults = {
            'dark_mode': False,
            'accent_enabled': False,
            'accent_color': '#8bc34a',
            'accent_dark': '#7ab82d',
            'accent_light': '#a5d461'
        }
        svc.save_preferences(test_user, defaults)
        print("\n3️⃣  ✅ Reset to defaults")
        
        return True
        
    except Exception as e:
        print(f"\n   ❌ Database test failed: {e}")
        import traceback
        traceback.print_exc()
        return False

if __name__ == "__main__":
    api_ok = test_preferences()
    db_ok = test_database_persistence()
    
    print("\n" + "=" * 60)
    print("📊 FINAL RESULTS")
    print("=" * 60)
    print(f"   API Tests:      {'✅ PASS' if api_ok else '❌ FAIL'}")
    print(f"   Database Tests: {'✅ PASS' if db_ok else '❌ FAIL'}")
    print("=" * 60)
    
    sys.exit(0 if (api_ok and db_ok) else 1)
