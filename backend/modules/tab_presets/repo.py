from typing import List, Tuple, Optional
from common.deps import pg_conn


class TabPresetsRepo:
    """Persistence layer for tab presets (formerly the `roles` table)."""

    def init_table(self):
        """Create tab_presets table if missing and seed system presets."""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                CREATE TABLE IF NOT EXISTS tab_presets (
                    id SERIAL PRIMARY KEY,
                    preset_name VARCHAR(100) UNIQUE NOT NULL,
                    allowed_tabs TEXT,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
                )
            """)

            # Seed system presets (admin + custom are non-deletable in the UI)
            cur.execute("""
                INSERT INTO tab_presets (preset_name, allowed_tabs) VALUES
                ('admin', ''),
                ('custom', '')
                ON CONFLICT (preset_name) DO NOTHING
            """)

            conn.commit()

    def list_all(self) -> List[Tuple[int, str, str, str, str]]:
        """Get all tab presets with their details."""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, preset_name, COALESCE(allowed_tabs, ''),
                       COALESCE(created_at::text, ''), COALESCE(updated_at::text, '')
                FROM tab_presets
                ORDER BY preset_name
            """)
            return cur.fetchall()

    def get_by_name(self, preset_name: str) -> Optional[Tuple[int, str, str]]:
        """Get a specific preset by name."""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                SELECT id, preset_name, COALESCE(allowed_tabs, '')
                FROM tab_presets
                WHERE preset_name = %s
            """, (preset_name,))
            return cur.fetchone()

    def create(self, preset_name: str, allowed_tabs_csv: str):
        """Create a new tab preset."""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("""
                INSERT INTO tab_presets (preset_name, allowed_tabs)
                VALUES (%s, %s)
                RETURNING id
            """, (preset_name, allowed_tabs_csv))
            preset_id = cur.fetchone()[0]
            conn.commit()
            return preset_id

    def update(self, preset_name: str, *, new_preset_name=None, allowed_tabs_csv=None):
        """Update an existing tab preset."""
        sets, vals = [], []
        if new_preset_name is not None:
            sets.append("preset_name=%s")
            vals.append(new_preset_name)
        if allowed_tabs_csv is not None:
            sets.append("allowed_tabs=%s")
            vals.append(allowed_tabs_csv)

        if not sets:
            return

        sets.append("updated_at=CURRENT_TIMESTAMP")

        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute(
                f"UPDATE tab_presets SET {', '.join(sets)} WHERE preset_name=%s",
                (*vals, preset_name)
            )
            conn.commit()

    def delete(self, preset_name: str):
        """Delete a tab preset."""
        with pg_conn() as conn, conn.cursor() as cur:
            cur.execute("DELETE FROM tab_presets WHERE preset_name=%s", (preset_name,))
            conn.commit()
