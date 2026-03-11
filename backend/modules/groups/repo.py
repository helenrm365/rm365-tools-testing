from typing import List, Tuple, Optional
from common.deps import pg_conn


class GroupsRepo:
    def init_table(self):
        """Create groups table if it doesn't exist"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS groups (
                    id SERIAL PRIMARY KEY,
                    group_name VARCHAR(100) UNIQUE NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)
            # Add group_id column to login_users if not exists
            cur.execute("""
                DO $$
                BEGIN
                    IF NOT EXISTS (
                        SELECT 1 FROM information_schema.columns
                        WHERE table_name = 'login_users' AND column_name = 'group_id'
                    ) THEN
                        ALTER TABLE login_users ADD COLUMN group_id INTEGER REFERENCES groups(id) ON DELETE SET NULL;
                    END IF;
                END $$;
            """)
            conn.commit()

    def list_all(self) -> List[Tuple[int, str, str, str]]:
        """Get all groups"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, group_name,
                       COALESCE(created_at::text, ''),
                       COALESCE(updated_at::text, '')
                FROM groups
                ORDER BY group_name
            """)
            return cur.fetchall()

    def get_by_id(self, group_id: int) -> Optional[Tuple[int, str]]:
        """Get a specific group by ID"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT id, group_name FROM groups WHERE id = %s", (group_id,))
            return cur.fetchone()

    def get_by_name(self, group_name: str) -> Optional[Tuple[int, str]]:
        """Get a specific group by name"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("SELECT id, group_name FROM groups WHERE group_name = %s", (group_name,))
            return cur.fetchone()

    def create(self, group_name: str) -> int:
        """Create a new group, returns the group ID"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO groups (group_name)
                VALUES (%s)
                RETURNING id
            """, (group_name,))
            group_id = cur.fetchone()[0]
            conn.commit()
            return group_id

    def update(self, group_id: int, new_name: str):
        """Update a group's name"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                UPDATE groups SET group_name = %s, updated_at = CURRENT_TIMESTAMP
                WHERE id = %s
            """, (new_name, group_id))
            conn.commit()

    def delete(self, group_id: int):
        """Delete a group (sets users' group_id to NULL via ON DELETE SET NULL)"""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM groups WHERE id = %s", (group_id,))
            conn.commit()
