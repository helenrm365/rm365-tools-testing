"""
One-shot migration: split the legacy `role` field into `tab_preset` (the bundle
assignment) and a new `role` field (free-text identity label like 'Admin' /
'Staff' / 'manager').

Idempotent — safe to re-run.

Schema changes:
    1. login_users.role → login_users.tab_preset   (rename existing column)
    2. login_users.role                              (new TEXT column, default 'Staff')
    3. roles → tab_presets                           (rename table)
    4. tab_presets.role_name → tab_presets.preset_name

Data backfill:
    * tab_preset is preserved (it's just the renamed column)
    * role defaults to 'Staff', upgraded to 'Admin' for users whose tab_preset is 'admin'
    * Ado specifically gets role='manager' so the existing magentodata role gates
      (which check role in ['admin','manager']) work for them
"""
import os
import sys

# Make backend/ importable
HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
sys.path.insert(0, BACKEND)

from dotenv import load_dotenv
load_dotenv(os.path.join(os.path.dirname(BACKEND), ".env"))

from core.db import get_psycopg_connection, return_attendance_connection


def column_exists(cur, table, column):
    cur.execute(
        "SELECT 1 FROM information_schema.columns WHERE table_name=%s AND column_name=%s",
        (table, column),
    )
    return cur.fetchone() is not None


def table_exists(cur, table):
    cur.execute(
        "SELECT 1 FROM information_schema.tables WHERE table_name=%s",
        (table,),
    )
    return cur.fetchone() is not None


def main():
    conn = get_psycopg_connection()
    try:
        with conn.cursor() as cur:
            # --- login_users column changes ---
            has_role = column_exists(cur, "login_users", "role")
            has_tab_preset = column_exists(cur, "login_users", "tab_preset")

            if has_role and not has_tab_preset:
                print("• Renaming login_users.role -> login_users.tab_preset")
                cur.execute("ALTER TABLE login_users RENAME COLUMN role TO tab_preset")
            elif has_tab_preset:
                print("• login_users.tab_preset already exists, skipping rename")
            else:
                # No role column at all — create tab_preset
                print("• Adding login_users.tab_preset")
                cur.execute("ALTER TABLE login_users ADD COLUMN tab_preset TEXT")

            # Now (re)check that role column doesn't exist after rename
            if not column_exists(cur, "login_users", "role"):
                print("• Adding new login_users.role (identity label)")
                cur.execute(
                    "ALTER TABLE login_users ADD COLUMN role TEXT DEFAULT 'Staff'"
                )
            else:
                print("• login_users.role already exists, skipping add")

            # --- roles table -> tab_presets ---
            if table_exists(cur, "roles") and not table_exists(cur, "tab_presets"):
                print("• Renaming table roles -> tab_presets")
                cur.execute("ALTER TABLE roles RENAME TO tab_presets")
            elif table_exists(cur, "tab_presets"):
                print("• Table tab_presets already exists, skipping rename")
            else:
                print("• Neither roles nor tab_presets exists — creating tab_presets")
                cur.execute(
                    """
                    CREATE TABLE tab_presets (
                        id SERIAL PRIMARY KEY,
                        preset_name VARCHAR(100) UNIQUE NOT NULL,
                        allowed_tabs TEXT,
                        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                    )
                    """
                )

            # Rename column on tab_presets
            if column_exists(cur, "tab_presets", "role_name") and not column_exists(
                cur, "tab_presets", "preset_name"
            ):
                print("• Renaming tab_presets.role_name -> tab_presets.preset_name")
                cur.execute(
                    "ALTER TABLE tab_presets RENAME COLUMN role_name TO preset_name"
                )
            else:
                print("• tab_presets.preset_name already in place, skipping")

            # --- Data backfill ---
            # Upgrade role to 'Admin' for users whose tab_preset is 'admin'
            print("• Backfilling role='Admin' for users with tab_preset='admin'")
            cur.execute(
                "UPDATE login_users SET role='Admin' "
                "WHERE LOWER(COALESCE(tab_preset,''))='admin' "
                "AND (role IS NULL OR role='' OR role='Staff')"
            )
            print(f"   updated {cur.rowcount} row(s)")

            # Default everyone else to 'Staff' if NULL/empty
            cur.execute(
                "UPDATE login_users SET role='Staff' WHERE role IS NULL OR role=''"
            )
            print(f"• Defaulted role='Staff' for {cur.rowcount} row(s)")

            # Specifically: Ado gets 'manager' so the magentodata gates work
            cur.execute(
                "UPDATE login_users SET role='manager' WHERE username='Ado'"
            )
            print(f"• Set Ado.role='manager' ({cur.rowcount} row(s))")

            # Ensure system tab_presets exist (admin + custom)
            cur.execute(
                """
                INSERT INTO tab_presets (preset_name, allowed_tabs)
                VALUES ('admin', ''), ('custom', '')
                ON CONFLICT (preset_name) DO NOTHING
                """
            )

            conn.commit()
            print("\n✅ Migration committed.")

            # --- Verify ---
            cur.execute(
                "SELECT username, tab_preset, role FROM login_users ORDER BY username"
            )
            print("\nFinal state of login_users:")
            print(f"  {'username':<22} {'tab_preset':<14} role")
            for row in cur.fetchall():
                u, tp, r = row
                print(f"  {u:<22} {tp or '—':<14} {r or '—'}")

            cur.execute(
                "SELECT preset_name, allowed_tabs FROM tab_presets ORDER BY preset_name"
            )
            print("\nFinal state of tab_presets:")
            for r in cur.fetchall():
                print(f"  {r[0]:<14} {(r[1] or '')[:80]}")

    except Exception as e:
        conn.rollback()
        print(f"❌ Migration failed: {e}")
        raise
    finally:
        return_attendance_connection(conn)


if __name__ == "__main__":
    main()
