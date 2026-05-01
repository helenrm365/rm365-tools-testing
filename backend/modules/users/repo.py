from typing import Optional, Tuple, List, Dict
from common.deps import pg_conn
import json

class UsersRepo:
    def get(self, username: str) -> Optional[Tuple[str, str, str]]:
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT username, password_hash, allowed_tabs FROM login_users WHERE username=%s", (username,))
            return cur.fetchone()

    def list_usernames(self) -> List[str]:
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT username FROM login_users ORDER BY username")
            return [r[0] for r in cur.fetchall()]

    def list_all(self) -> List[Tuple[str, str, str, str, int, int]]:
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT username,
                       NULLIF(role, '') as role,
                       NULLIF(tab_preset, '') as tab_preset,
                       allowed_tabs, location_id, group_id
                FROM login_users ORDER BY username
            """)
            return cur.fetchall()

    def create(self, username: str, password_hash: str, role: str, tab_preset: str, allowed_tabs_csv: str, location_id: int = None, group_id: int = None):
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO login_users (username, password_hash, role, tab_preset, allowed_tabs, location_id, group_id)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (username, password_hash, role, tab_preset, allowed_tabs_csv, location_id, group_id))
            conn.commit()

    def update(self, username: str, *, new_username=None, new_hash=None,
               role=None, clear_role=False,
               tab_preset=None, clear_tab_preset=False,
               allowed_tabs_csv=None,
               location_id=None, clear_location=False,
               group_id=None, clear_group=False):
        sets, vals = [], []
        if new_username is not None: sets += ["username=%s"];        vals += [new_username]
        if new_hash is not None:     sets += ["password_hash=%s"];   vals += [new_hash]
        if role is not None:         sets += ["role=%s"];            vals += [role]
        elif clear_role:             sets += ["role=%s"];            vals += [None]
        if tab_preset is not None:   sets += ["tab_preset=%s"];      vals += [tab_preset]
        elif clear_tab_preset:       sets += ["tab_preset=%s"];      vals += [None]
        if allowed_tabs_csv is not None: sets += ["allowed_tabs=%s"]; vals += [allowed_tabs_csv]
        if location_id is not None:  sets += ["location_id=%s"];    vals += [location_id]
        elif clear_location:         sets += ["location_id=%s"];    vals += [None]
        if group_id is not None:     sets += ["group_id=%s"];       vals += [group_id]
        elif clear_group:            sets += ["group_id=%s"];       vals += [None]
        if not sets: return
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute(f"UPDATE login_users SET {', '.join(sets)} WHERE username=%s", (*vals, username))
            conn.commit()

    def update_tabs_for_preset(self, preset_name: str, allowed_tabs_csv: str):
        """Update allowed_tabs for all users assigned to a given tab preset."""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute(
                "UPDATE login_users SET allowed_tabs = %s WHERE tab_preset = %s",
                (allowed_tabs_csv, preset_name)
            )
            conn.commit()

    def delete(self, username: str):
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM login_users WHERE username=%s", (username,))
            conn.commit()

    # ===== User Preferences =====
    def get_preferences(self, username: str) -> Optional[Dict]:
        """Get user appearance preferences"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT preferences FROM login_users WHERE username=%s
            """, (username,))
            row = cur.fetchone()
            if row and row[0]:
                try:
                    return json.loads(row[0]) if isinstance(row[0], str) else row[0]
                except (json.JSONDecodeError, TypeError):
                    return None
            return None

    def save_preferences(self, username: str, preferences: Dict) -> bool:
        """Save user appearance preferences. Returns True if saved successfully."""
        with pg_conn() as conn, conn.cursor() as cur:
            prefs_json = json.dumps(preferences)
            cur.execute("""
                UPDATE login_users SET preferences = %s WHERE username = %s
            """, (prefs_json, username))
            rows_affected = cur.rowcount
            conn.commit()
            return rows_affected > 0
