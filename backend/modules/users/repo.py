from typing import Optional, Tuple, List
from common.deps import pg_conn

class UsersRepo:
    def get(self, username: str) -> Optional[Tuple[str, str, str]]:
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT username, password_hash, allowed_tabs FROM login_users WHERE username=%s", (username,))
            return cur.fetchone()

    def list_usernames(self) -> List[str]:
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT username FROM login_users ORDER BY username")
            return [r[0] for r in cur.fetchall()]

    def list_all(self) -> List[Tuple[str, str, str]]:
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT username, COALESCE(NULLIF(role, ''), 'user') as role, allowed_tabs FROM login_users ORDER BY username")
            return cur.fetchall()

    def create(self, username: str, password_hash: str, role: str, allowed_tabs_csv: str):
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO login_users (username, password_hash, role, allowed_tabs)
                VALUES (%s, %s, %s, %s)
            """, (username, password_hash, role, allowed_tabs_csv))
            conn.commit()

    def update(self, username: str, *, new_username=None, new_hash=None, role=None, allowed_tabs_csv=None):
        sets, vals = [], []
        if new_username is not None: sets += ["username=%s"];        vals += [new_username]
        if new_hash is not None:     sets += ["password_hash=%s"];   vals += [new_hash]
        if role is not None:         sets += ["role=%s"];           vals += [role]
        if allowed_tabs_csv is not None: sets += ["allowed_tabs=%s"]; vals += [allowed_tabs_csv]
        if not sets: return
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute(f"UPDATE login_users SET {', '.join(sets)} WHERE username=%s", (*vals, username))
            conn.commit()

    def delete(self, username: str):
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM login_users WHERE username=%s", (username,))
            conn.commit()
