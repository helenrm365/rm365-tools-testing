#!/usr/bin/env python3
"""
One-time migration script to rename all 'expired' sessions to 'archived'.
This consolidates the two statuses into one.
"""
import os
import sys
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(__file__), '..', '.env'))

from core.db import get_inventory_log_connection, return_inventory_connection

def migrate():
    conn = None
    try:
        conn = get_inventory_log_connection()
        cursor = conn.cursor()

        # Count expired sessions before
        cursor.execute("SELECT COUNT(*) FROM order_fulfillment_sessions WHERE status = 'expired'")
        expired_count = cursor.fetchone()[0]
        print(f'Found {expired_count} sessions with expired status')

        # Update all expired to archived
        cursor.execute("UPDATE order_fulfillment_sessions SET status = 'archived' WHERE status = 'expired'")
        updated = cursor.rowcount
        conn.commit()

        print(f'✅ Migrated {updated} sessions from expired → archived')

        # Verify
        cursor.execute("SELECT COUNT(*) FROM order_fulfillment_sessions WHERE status = 'expired'")
        remaining = cursor.fetchone()[0]
        print(f'Remaining expired sessions: {remaining}')

        cursor.execute("SELECT status, COUNT(*) FROM order_fulfillment_sessions GROUP BY status ORDER BY status")
        print('\nCurrent status distribution:')
        for status, count in cursor.fetchall():
            print(f'  {status}: {count}')

        cursor.close()
    finally:
        if conn:
            return_inventory_connection(conn)

if __name__ == "__main__":
    migrate()
