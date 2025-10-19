from typing import List, Tuple, Optional
from common.deps import pg_conn

class RolesRepo:
    def init_table(self):
        """Create roles table if it doesn't exist and add default roles"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS roles (
                    id SERIAL PRIMARY KEY,
                    role_name VARCHAR(100) UNIQUE NOT NULL,
                    allowed_tabs TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            
            # Insert default roles
            cur.execute("""
                INSERT INTO roles (role_name, allowed_tabs) VALUES
                ('admin', 'enrollment,inventory,attendance,labels,sales-imports,usermanagement'),
                ('manager', 'enrollment,inventory,attendance,labels,sales-imports'),
                ('user', 'enrollment,attendance')
                ON CONFLICT (role_name) DO NOTHING
            """)
            
            conn.commit()

    def list_all(self) -> List[Tuple[int, str, str, str, str]]:
        """Get all roles with their details"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, role_name, COALESCE(allowed_tabs, ''), 
                       COALESCE(created_at::text, ''), COALESCE(updated_at::text, '')
                FROM roles 
                ORDER BY role_name
            """)
            return cur.fetchall()

    def get_by_name(self, role_name: str) -> Optional[Tuple[int, str, str]]:
        """Get a specific role by name"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, role_name, COALESCE(allowed_tabs, '')
                FROM roles 
                WHERE role_name = %s
            """, (role_name,))
            return cur.fetchone()

    def create(self, role_name: str, allowed_tabs_csv: str):
        """Create a new role"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO roles (role_name, allowed_tabs)
                VALUES (%s, %s)
                RETURNING id
            """, (role_name, allowed_tabs_csv))
            role_id = cur.fetchone()[0]
            conn.commit()
            return role_id

    def update(self, role_name: str, *, new_role_name=None, allowed_tabs_csv=None):
        """Update an existing role"""
        sets, vals = [], []
        if new_role_name is not None:
            sets.append("role_name=%s")
            vals.append(new_role_name)
        if allowed_tabs_csv is not None:
            sets.append("allowed_tabs=%s")
            vals.append(allowed_tabs_csv)
        
        if not sets:
            return
            
        sets.append("updated_at=CURRENT_TIMESTAMP")
        
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"UPDATE roles SET {', '.join(sets)} WHERE role_name=%s",
                (*vals, role_name)
            )
            conn.commit()

    def delete(self, role_name: str):
        """Delete a role"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM roles WHERE role_name=%s", (role_name,))
            conn.commit()

    def upsert(self, role_name: str, allowed_tabs_csv: str):
        """Insert or update a role (used when saving user with role)"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO roles (role_name, allowed_tabs)
                VALUES (%s, %s)
                ON CONFLICT (role_name) 
                DO UPDATE SET 
                    allowed_tabs = EXCLUDED.allowed_tabs,
                    updated_at = CURRENT_TIMESTAMP
            """, (role_name, allowed_tabs_csv))
            conn.commit()
