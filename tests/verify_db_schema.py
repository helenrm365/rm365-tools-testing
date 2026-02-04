#!/usr/bin/env python3
"""Verify database schema for preferences"""
import os
import sys
from pathlib import Path

# Load env
try:
    from dotenv import load_dotenv
    load_dotenv(Path('/Users/ianhjweng/Documents/github/rm365-tools-testing/.env'))
except ImportError:
    pass

sys.path.insert(0, '/Users/ianhjweng/Documents/github/rm365-tools-testing/backend')

from core.db import get_psycopg_connection, return_attendance_connection

print("=" * 60)
print("DATABASE SCHEMA VERIFICATION")
print("=" * 60)

conn = get_psycopg_connection()
with conn.cursor() as cur:
    # Check column exists
    cur.execute("""
        SELECT column_name, data_type, is_nullable
        FROM information_schema.columns 
        WHERE table_name = 'login_users' AND column_name = 'preferences'
    """)
    col = cur.fetchone()
    if col:
        print(f"\n✅ Column 'preferences' exists:")
        print(f"   Type: {col[1]}")
        print(f"   Nullable: {col[2]}")
    else:
        print("\n❌ Column 'preferences' NOT FOUND!")
    
    # Check sample data
    print("\n📊 Sample preferences data from login_users:")
    cur.execute("SELECT username, preferences FROM login_users WHERE preferences IS NOT NULL LIMIT 5")
    rows = cur.fetchall()
    if rows:
        for username, prefs in rows:
            print(f"   {username}: {prefs}")
    else:
        print("   (no preferences saved yet)")

return_attendance_connection(conn)

print("\n" + "=" * 60)
print("✅ DATABASE VERIFICATION COMPLETE")
print("=" * 60)
