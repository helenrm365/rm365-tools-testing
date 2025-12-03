from __future__ import annotations
from datetime import date, datetime
from typing import Any, Dict, List, Optional

from common.utils import cursor_to_dicts
from common.deps import pg_conn

class AttendanceRepo:
    """All DB I/O for attendance."""

    # ---- Employees ----
    def list_employees_brief(self) -> List[Dict[str, Any]]:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # nfc_uid is optional; safe to select if present
                cur.execute("SELECT id, name, COALESCE(nfc_uid, NULL) AS nfc_uid FROM employees ORDER BY name")
                rows = cur.fetchall()
                return [{"id": r[0], "name": r[1], "nfc_uid": r[2]} for r in rows]

    def list_employees_with_status(self, location: Optional[str] = None, name_search: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get employees with their current attendance status for overview display"""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # Build WHERE clause for filters
                where_conditions = []
                params = []
                
                if location:
                    where_conditions.append("e.location = %s")
                    params.append(location)
                
                if name_search:
                    where_conditions.append("LOWER(e.name) LIKE %s")
                    params.append(f"%{name_search.lower()}%")
                
                where_clause = ""
                if where_conditions:
                    where_clause = "WHERE " + " AND ".join(where_conditions)
                
                query = f"""
                    SELECT 
                        e.id,
                        e.name,
                        COALESCE(e.nfc_uid, NULL) AS nfc_uid,
                        COALESCE(e.location, NULL) AS location,
                        latest_log.direction AS status,
                        latest_log.log_time,
                        CASE 
                            WHEN latest_log.direction = 'in' THEN 
                                EXTRACT(EPOCH FROM (NOW() - latest_log.log_time))/3600
                            ELSE NULL 
                        END AS hours_worked_today
                    FROM employees e
                    LEFT JOIN LATERAL (
                        SELECT direction, log_time
                        FROM attendance_logs al
                        WHERE al.employee_id = e.id 
                          AND al.log_time::date = CURRENT_DATE
                        ORDER BY al.log_time DESC
                        LIMIT 1
                    ) latest_log ON true
                    {where_clause}
                    ORDER BY e.name
                """
                
                cur.execute(query, params)
                rows = cur.fetchall()
                
                result = []
                for r in rows:
                    employee = {
                        "id": r[0],
                        "name": r[1], 
                        "nfc_uid": r[2],
                        "location": r[3],
                        "status": r[4] or "unknown",
                        "last_activity": r[5].strftime("%H:%M") if r[5] else None,
                        "duration": f"{r[6]:.1f}h" if r[6] is not None else None
                    }
                    result.append(employee)
                
                return result

    def get_locations(self) -> List[str]:
        """Get all distinct employee locations."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT DISTINCT location FROM employees WHERE location IS NOT NULL ORDER BY location")
                rows = cur.fetchall()
                return [row[0] for row in rows]

    # ---- Logs ----
    def latest_direction_today(self, employee_id: int) -> Optional[str]:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    SELECT direction
                    FROM attendance_logs
                    WHERE employee_id = %s AND log_time::date = %s
                    ORDER BY log_time DESC
                    LIMIT 1
                    """,
                    (employee_id, date.today()),
                )
                row = cur.fetchone()
                return row[0] if row else None

    def insert_log(self, employee_id: int, direction: str) -> None:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO attendance_logs (employee_id, log_time, direction) VALUES (%s, %s, %s)",
                    (employee_id, datetime.now(), direction),
                )
            conn.commit()

    def list_logs(self, from_date: date, to_date: date, search: Optional[str] = None, location: Optional[str] = None, name_search: Optional[str] = None) -> List[Dict[str, Any]]:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # Build WHERE clause for filters
                where_conditions = ["a.log_time::date BETWEEN %s AND %s"]
                params = [from_date, to_date]
                
                # Legacy search parameter (if provided, use it for name search)
                if search:
                    where_conditions.append("LOWER(e.name) LIKE %s")
                    params.append(f"%{search.lower()}%")
                
                # New filtering parameters
                if location:
                    where_conditions.append("e.location = %s")
                    params.append(location)
                
                if name_search:
                    where_conditions.append("LOWER(e.name) LIKE %s")
                    params.append(f"%{name_search.lower()}%")
                
                where_clause = " AND ".join(where_conditions)
                
                query = f"""
                    SELECT e.name, a.log_time::date AS day, TO_CHAR(a.log_time,'HH24:MI:SS') AS time, a.direction
                    FROM attendance_logs a
                    JOIN employees e ON a.employee_id = e.id
                    WHERE {where_clause}
                    ORDER BY a.log_time DESC
                """
                
                cur.execute(query, params)
                rows = cur.fetchall()
                return [
                    {"employee": r[0], "date": r[1].isoformat(), "time": r[2], "direction": r[3]}
                    for r in rows
                ]

    def summary_counts(self, from_date: date, to_date: date, location: Optional[str] = None, name_search: Optional[str] = None) -> List[Dict[str, Any]]:
        """Simple per-employee count within date range."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # Build WHERE clause for filters
                where_conditions = ["a.log_time::date BETWEEN %s AND %s"]
                params = [from_date, to_date]
                
                if location:
                    where_conditions.append("e.location = %s")
                    params.append(location)
                
                if name_search:
                    where_conditions.append("LOWER(e.name) LIKE %s")
                    params.append(f"%{name_search.lower()}%")
                
                where_clause = " AND ".join(where_conditions)
                
                query = f"""
                    SELECT e.name, COUNT(*) AS count
                    FROM attendance_logs a
                    JOIN employees e ON a.employee_id = e.id
                    WHERE {where_clause}
                    GROUP BY e.name
                    ORDER BY e.name
                """
                
                cur.execute(query, params)
                return cursor_to_dicts(cur)

    def get_daily_stats(self, location: Optional[str] = None, name_search: Optional[str] = None) -> Dict[str, Any]:
        """Get today's attendance statistics."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # Build WHERE clause for employee filtering
                employee_where_conditions = []
                employee_params = []
                
                if location:
                    employee_where_conditions.append("location = %s")
                    employee_params.append(location)
                
                if name_search:
                    employee_where_conditions.append("LOWER(name) LIKE %s")
                    employee_params.append(f"%{name_search.lower()}%")
                
                employee_where_clause = ""
                if employee_where_conditions:
                    employee_where_clause = "WHERE " + " AND ".join(employee_where_conditions)
                
                # Total employees (filtered)
                total_query = f"SELECT COUNT(*) FROM employees {employee_where_clause}"
                cur.execute(total_query, employee_params)
                total_employees = cur.fetchone()[0]
                
                # Today's attendance status (filtered)
                attendance_query = f"""
                    SELECT 
                        COUNT(DISTINCT CASE WHEN latest_log.direction = 'in' THEN e.id END) as checked_in,
                        COUNT(DISTINCT CASE WHEN latest_log.direction = 'out' THEN e.id END) as checked_out,
                        COUNT(DISTINCT CASE WHEN latest_log.direction IS NULL THEN e.id END) as absent
                    FROM employees e
                    LEFT JOIN LATERAL (
                        SELECT direction
                        FROM attendance_logs al
                        WHERE al.employee_id = e.id 
                          AND al.log_time::date = CURRENT_DATE
                        ORDER BY al.log_time DESC
                        LIMIT 1
                    ) latest_log ON true
                    {employee_where_clause}
                """
                cur.execute(attendance_query, employee_params)
                stats = cur.fetchone()
                
                return {
                    "total_employees": total_employees,
                    "checked_in": stats[0] or 0,
                    "checked_out": stats[1] or 0,
                    "absent": stats[2] or 0
                }

    def get_weekly_attendance_chart(self, from_date: date, to_date: date, location: Optional[str] = None, name_search: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get weekly attendance data for chart visualization."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # Build WHERE clause for employee filtering
                employee_where_conditions = []
                params = [from_date, to_date]
                
                if location:
                    employee_where_conditions.append("e.location = %s")
                    params.append(location)
                
                if name_search:
                    employee_where_conditions.append("LOWER(e.name) LIKE %s")
                    params.append(f"%{name_search.lower()}%")
                
                # Add additional parameters for the subquery
                subquery_params = []
                if location:
                    subquery_params.append(location)
                if name_search:
                    subquery_params.append(f"%{name_search.lower()}%")
                
                params.extend([from_date, to_date])
                params.extend(subquery_params)
                
                employee_where_clause = ""
                subquery_where_clause = ""
                if employee_where_conditions:
                    where_conditions_str = " AND ".join(employee_where_conditions)
                    employee_where_clause = f"WHERE {where_conditions_str}"
                    subquery_where_clause = f"AND {where_conditions_str.replace('e.', 'e2.')}"
                
                query = f"""
                    SELECT 
                        e.name,
                        DATE(a.log_time) as log_date,
                        COUNT(*) as daily_logs,
                        SUM(CASE WHEN a.direction = 'in' THEN 1 ELSE 0 END) as clock_ins,
                        SUM(CASE WHEN a.direction = 'out' THEN 1 ELSE 0 END) as clock_outs
                    FROM employees e
                    LEFT JOIN attendance_logs a ON e.id = a.employee_id
                        AND a.log_time::date BETWEEN %s AND %s
                    WHERE e.id IN (
                        SELECT DISTINCT employee_id 
                        FROM attendance_logs al2
                        JOIN employees e2 ON al2.employee_id = e2.id
                        WHERE al2.log_time::date BETWEEN %s AND %s
                        {subquery_where_clause}
                    )
                    {employee_where_clause}
                    GROUP BY e.name, DATE(a.log_time)
                    ORDER BY e.name, log_date
                """
                
                cur.execute(query, params)
                rows = cur.fetchall()
                result = []
                for row in rows:
                    if row[1]:  # Only include dates with logs
                        result.append({
                            "employee": row[0],
                            "date": row[1].isoformat(),
                            "daily_logs": row[2] or 0,
                            "clock_ins": row[3] or 0,
                            "clock_outs": row[4] or 0
                        })
                return result

    def get_employee_work_hours(self, from_date: date, to_date: date, location: Optional[str] = None, name_search: Optional[str] = None) -> List[Dict[str, Any]]:
        """Calculate work hours and lunch time for each employee in the date range."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # Build WHERE clause for employee filtering
                employee_where_conditions = []
                params = [from_date, to_date]
                
                if location:
                    employee_where_conditions.append("e.location = %s")
                    params.append(location)
                
                if name_search:
                    employee_where_conditions.append("LOWER(e.name) LIKE %s")
                    params.append(f"%{name_search.lower()}%")
                
                employee_where_clause = ""
                if employee_where_conditions:
                    employee_where_clause = "AND " + " AND ".join(employee_where_conditions)
                
                query = f"""
                    WITH daily_times AS (
                        SELECT 
                            e.name,
                            a.log_time::date as work_date,
                            a.log_time,
                            a.direction,
                            ROW_NUMBER() OVER (
                                PARTITION BY e.name, a.log_time::date, a.direction 
                                ORDER BY a.log_time
                            ) as rn
                        FROM employees e
                        JOIN attendance_logs a ON e.id = a.employee_id
                        WHERE a.log_time::date BETWEEN %s AND %s
                        {employee_where_clause}
                    ),
                    daily_pairs AS (
                        SELECT 
                            name,
                            work_date,
                            MIN(CASE WHEN direction = 'in' AND rn = 1 THEN log_time END) as first_in,
                            MIN(CASE WHEN direction = 'out' AND rn = 1 THEN log_time END) as first_out,
                            MIN(CASE WHEN direction = 'in' AND rn = 2 THEN log_time END) as second_in,
                            MAX(CASE WHEN direction = 'out' THEN log_time END) as last_out
                        FROM daily_times
                        GROUP BY name, work_date
                        HAVING MIN(CASE WHEN direction = 'in' AND rn = 1 THEN log_time END) IS NOT NULL
                           AND MAX(CASE WHEN direction = 'out' THEN log_time END) IS NOT NULL
                    )
                    SELECT 
                        name,
                        work_date,
                        first_in,
                        first_out,
                        second_in,
                        last_out,
                        EXTRACT(EPOCH FROM (last_out - first_in))/3600 as hours_worked,
                        CASE 
                            WHEN first_out IS NOT NULL AND second_in IS NOT NULL 
                            THEN EXTRACT(EPOCH FROM (second_in - first_out))/3600
                            ELSE NULL 
                        END as lunch_hours
                    FROM daily_pairs
                    ORDER BY name, work_date
                """
                
                cur.execute(query, params)
                rows = cur.fetchall()
                return [{
                    "employee": r[0],
                    "date": r[1].isoformat(),
                    "first_in": r[2].strftime("%H:%M:%S") if r[2] else None,
                    "first_out": r[3].strftime("%H:%M:%S") if r[3] else None,
                    "second_in": r[4].strftime("%H:%M:%S") if r[4] else None,
                    "last_out": r[5].strftime("%H:%M:%S") if r[5] else None,
                    "hours_worked": round(r[6], 2) if r[6] else 0,
                    "lunch_hours": round(r[7], 2) if r[7] else None
                } for r in rows]

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
