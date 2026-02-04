#!/usr/bin/env python3
"""Test preferences persistence with a real database user"""
import os
import sys
from pathlib import Path

# Load env
try:
    from dotenv import load_dotenv
    env_path = Path('/Users/ianhjweng/Documents/github/rm365-tools-testing/.env')
    load_dotenv(dotenv_path=env_path)
except ImportError:
    pass

sys.path.insert(0, '/Users/ianhjweng/Documents/github/rm365-tools-testing/backend')

from modules.users.service import UsersService

svc = UsersService()

# Test with 'ian' user who exists in database
test_user = 'ian'
print(f"Testing with user: {test_user}")

# Get initial preferences
print("\n1. Initial preferences:")
prefs = svc.get_preferences(test_user)
print(prefs)

# Save custom preferences
custom = {
    'dark_mode': True,
    'accent_enabled': True,
    'accent_color': '#673ab7',  # Purple
    'accent_dark': '#512da8',
    'accent_light': '#9575cd'
}
print("\n2. Saving custom preferences:")
print(custom)
result = svc.save_preferences(test_user, custom)

# Verify persistence
print("\n3. Reading back preferences:")
verified = svc.get_preferences(test_user)
print(verified)

if verified['accent_color'] == custom['accent_color']:
    print("\n✅ PERSISTENCE TEST PASSED!")
else:
    print("\n❌ PERSISTENCE TEST FAILED!")
    
# Reset to defaults
defaults = {
    'dark_mode': False,
    'accent_enabled': False,
    'accent_color': '#8bc34a',
    'accent_dark': '#7ab82d',
    'accent_light': '#a5d461'
}
svc.save_preferences(test_user, defaults)
print("\n4. Reset to defaults")
