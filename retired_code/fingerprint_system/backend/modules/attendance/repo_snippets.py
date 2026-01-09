from typing import List, Dict, Any
from core.db import pg_conn

class AttendanceRepoSnippet:
    # ---- Fingerprint templates ----
    def active_employee_templates(self) -> List[Dict[str, Any]]:
        """
        Returns: [{'id': int, 'name': str, 'tpl_bytes': bytes}, ...]
        """
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT e.id, e.name, ef.template
                    FROM employees e
                    JOIN employee_fingerprints ef ON e.id = ef.employee_id
                    ORDER BY e.name
                    """
                )
                out: List[Dict[str, Any]] = []
                for id_, name, tpl in cur.fetchall():
                    if isinstance(tpl, memoryview):
                        tpl = tpl.tobytes()
                    out.append({"id": id_, "name": name, "tpl_bytes": bytes(tpl)})
                return out
