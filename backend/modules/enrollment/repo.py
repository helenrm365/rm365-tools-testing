from __future__ import annotations
from typing import Any, Dict, List, Optional

from common.deps import pg_conn
from common.utils import cursor_to_dicts

class EnrollmentRepo:
    # -------- Queries --------
    def list_employees(self) -> List[Dict[str, Any]]:
        """
        Returns employees with a derived has_fingerprint flag,
        matching your old manager/routes expectations.
        """
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, COALESCE(employee_code, '') AS employee_code,
                           COALESCE(location, '') AS location,
                           COALESCE(status, '') AS status,
                           COALESCE(card_uid, '') AS card_uid,
                           (fingerprint_template IS NOT NULL) AS has_fingerprint
                    FROM employees
                    ORDER BY name
                    """
                )
                return cursor_to_dicts(cur)  # has_fingerprint comes through as bool
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
                    RETURNING id, name, employee_code, location, status, card_uid,
                              (fingerprint_template IS NOT NULL) AS has_fingerprint
                    """,
                    (name, employee_code, location, status, card_uid),
                )
                row = cur.fetchone()
                conn.commit()
        return {
            "id": row[0], "name": row[1], "employee_code": row[2],
            "location": row[3], "status": row[4], "card_uid": row[5],
            "has_fingerprint": row[6],
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
         RETURNING id, name, employee_code, location, status, card_uid,
                   (fingerprint_template IS NOT NULL) AS has_fingerprint
        """
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(sql, vals)
                row = cur.fetchone()
                conn.commit()
        return {
            "id": row[0], "name": row[1], "employee_code": row[2],
            "location": row[3], "status": row[4], "card_uid": row[5],
            "has_fingerprint": row[6],
        }
        # :contentReference[oaicite:4]{index=4}

    def get_employee(self, employee_id: int) -> Dict[str, Any]:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT id, name, employee_code, location, status, card_uid,
                           (fingerprint_template IS NOT NULL) AS has_fingerprint
                    FROM employees
                    WHERE id = %s
                    """,
                    (employee_id,),
                )
                row = cur.fetchone()
        return {
            "id": row[0], "name": row[1], "employee_code": row[2],
            "location": row[3], "status": row[4], "card_uid": row[5],
            "has_fingerprint": row[6],
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

    def save_fingerprint(self, employee_id: int, tpl_bytes: bytes) -> None:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE employees SET fingerprint_template = %s WHERE id = %s",
                    (tpl_bytes, employee_id),
                )
                conn.commit()
        # :contentReference[oaicite:8]{index=8}
