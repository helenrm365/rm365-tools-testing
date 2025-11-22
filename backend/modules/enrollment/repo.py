from __future__ import annotations
from typing import Any, Dict, List, Optional

from common.deps import pg_conn
from common.utils import cursor_to_dicts

class EnrollmentRepo:
    # -------- Queries --------
    def list_employees(self) -> List[Dict[str, Any]]:
        """
        Returns employees with a derived has_fingerprint flag.
        """
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT e.id, e.name, COALESCE(e.employee_code, '') AS employee_code,
                           COALESCE(e.location, '') AS location,
                           COALESCE(e.status, '') AS status,
                           COALESCE(e.card_uid, '') AS card_uid,
                           (EXISTS (SELECT 1 FROM employee_fingerprints ef WHERE ef.employee_id = e.id)) AS has_fingerprint
                    FROM employees e
                    ORDER BY e.name
                    """
                )
                return cursor_to_dicts(cur)
        # :contentReference[oaicite:1]{index=1}

    def get_last_employee_code(self) -> Optional[str]:
        """
        Fetch the highest EMP### code to generate the next one.
        """
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT employee_code
                    FROM employees
                    WHERE employee_code IS NOT NULL
                    ORDER BY employee_code DESC
                    LIMIT 1
                    """
                )
                row = cur.fetchone()
                return row[0] if row else None
        # :contentReference[oaicite:2]{index=2}

    # -------- Mutations --------
    def create_employee(self, *, name: str, location: Optional[str], status: Optional[str],
                        employee_code: str, card_uid: Optional[str]) -> Dict[str, Any]:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO employees (name, employee_code, location, status, card_uid)
                    VALUES (%s, %s, %s, %s, %s)
                    RETURNING id, name, employee_code, location, status, card_uid
                    """,
                    (name, employee_code, location, status, card_uid),
                )
                row = cur.fetchone()
                conn.commit()
        return {
            "id": row[0], "name": row[1], "employee_code": row[2],
            "location": row[3], "status": row[4], "card_uid": row[5],
            "has_fingerprint": False,
        }
        # :contentReference[oaicite:3]{index=3}

    def update_employee(self, employee_id: int, **fields) -> Dict[str, Any]:
        """
        Patch-like update – only sets provided fields.
        """
        pairs = []
        vals = []
        for k, v in fields.items():
            if v is not None and k in {"name", "location", "status", "card_uid"}:
                pairs.append(f"{k} = %s")
                vals.append(v)
        if not pairs:
            # nothing to update – return current row
            return self.get_employee(employee_id)

        vals.append(employee_id)
        sql = f"""
            UPDATE employees
               SET {', '.join(pairs)}
             WHERE id = %s
         RETURNING id, name, employee_code, location, status, card_uid
        """
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, vals)
                row = cur.fetchone()
                
                # Check for fingerprints
                cur.execute("SELECT EXISTS(SELECT 1 FROM employee_fingerprints WHERE employee_id = %s)", (employee_id,))
                has_fingerprint = cur.fetchone()[0]
                
                conn.commit()
        return {
            "id": row[0], "name": row[1], "employee_code": row[2],
            "location": row[3], "status": row[4], "card_uid": row[5],
            "has_fingerprint": has_fingerprint,
        }
        # :contentReference[oaicite:4]{index=4}

    def get_employee(self, employee_id: int) -> Dict[str, Any]:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, employee_code, location, status, card_uid
                    FROM employees
                    WHERE id = %s
                    """,
                    (employee_id,),
                )
                row = cur.fetchone()
                if not row:
                    return None
                
                # Fetch fingerprints
                cur.execute(
                    "SELECT id, name, created_at FROM employee_fingerprints WHERE employee_id = %s ORDER BY created_at",
                    (employee_id,)
                )
                fingerprints = [{"id": r[0], "name": r[1], "created_at": r[2]} for r in cur.fetchall()]
                
                has_fingerprint = bool(fingerprints)

        return {
            "id": row[0], "name": row[1], "employee_code": row[2],
            "location": row[3], "status": row[4], "card_uid": row[5],
            "has_fingerprint": has_fingerprint,
            "fingerprints": fingerprints
        }

    def delete_employee(self, employee_id: int) -> int:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # First delete related attendance logs to avoid foreign key constraint violation
                cur.execute("DELETE FROM attendance_logs WHERE employee_id = %s", (employee_id,))
                logs_deleted = cur.rowcount
                print(f"[Repo] Deleted {logs_deleted} attendance logs for employee {employee_id}")
                
                # Then delete the employee
                cur.execute("DELETE FROM employees WHERE id = %s", (employee_id,))
                deleted = cur.rowcount
                conn.commit()
                
                print(f"[Repo] Successfully deleted employee {employee_id} and {logs_deleted} related attendance logs")
        return deleted

    def bulk_delete(self, ids: list[int]) -> int:
        if not ids:
            return 0
        
        print(f"[Repo] Bulk delete called with IDs: {ids}")
        
        try:
            with pg_conn() as conn:
                with conn.cursor() as cur:
                    # First delete related attendance logs for all employees to avoid foreign key constraint violations
                    placeholders_logs = ','.join(['%s'] * len(ids))
                    logs_query = f"DELETE FROM attendance_logs WHERE employee_id IN ({placeholders_logs})"
                    print(f"[Repo] Executing logs cleanup query: {logs_query} with params: {ids}")
                    
                    cur.execute(logs_query, ids)
                    logs_deleted = cur.rowcount
                    print(f"[Repo] Deleted {logs_deleted} attendance logs for employees {ids}")
                    
                    # Then delete the employees
                    placeholders = ','.join(['%s'] * len(ids))
                    query = f"DELETE FROM employees WHERE id IN ({placeholders})"
                    print(f"[Repo] Executing employees query: {query} with params: {ids}")
                    
                    cur.execute(query, ids)
                    deleted = cur.rowcount
                    conn.commit()
                    
                    print(f"[Repo] Successfully deleted {deleted} employees and {logs_deleted} related attendance logs")
                    return deleted
        except Exception as e:
            print(f"[Repo] Database error during bulk delete: {e}")
            raise

    def save_card_uid(self, employee_id: int, uid: str) -> None:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("UPDATE employees SET card_uid = %s WHERE id = %s", (uid, employee_id))
                conn.commit()
        # :contentReference[oaicite:7]{index=7}

    def save_fingerprint(self, employee_id: int, tpl_bytes: bytes, name: str = "Default") -> None:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # Check if exists
                cur.execute(
                    "SELECT id FROM employee_fingerprints WHERE employee_id = %s AND name = %s",
                    (employee_id, name)
                )
                row = cur.fetchone()
                
                if row:
                    # Update
                    cur.execute(
                        "UPDATE employee_fingerprints SET template = %s, created_at = CURRENT_TIMESTAMP WHERE id = %s",
                        (tpl_bytes, row[0])
                    )
                else:
                    # Insert
                    cur.execute(
                        "INSERT INTO employee_fingerprints (employee_id, template, name) VALUES (%s, %s, %s)",
                        (employee_id, tpl_bytes, name),
                    )
                conn.commit()
        # :contentReference[oaicite:8]{index=8}

    def delete_fingerprint(self, fingerprint_id: int) -> None:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("DELETE FROM employee_fingerprints WHERE id = %s", (fingerprint_id,))
                conn.commit()
