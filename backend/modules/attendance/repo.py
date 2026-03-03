from __future__ import annotations
from datetime import date, datetime, timezone as tz
from typing import Any, Dict, List, Optional
import logging

from common.utils import cursor_to_dicts
from common.deps import pg_conn

logger = logging.getLogger(__name__)

class AttendanceRepo:
    """All DB I/O for attendance."""

    # ---- Table Initialization ----
    def check_tables_exist(self) -> Dict[str, Any]:
        """Check if attendance tables exist in the database."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                tables_status = {}
                
                # Check employees table
                cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = 'employees'
                    )
                """)
                tables_status['employees'] = cur.fetchone()[0]
                
                # Check attendance_logs table
                cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = 'attendance_logs'
                    )
                """)
                tables_status['attendance_logs'] = cur.fetchone()[0]
                
                all_exist = all(tables_status.values())
                return {
                    'status': 'success',
                    'tables_status': tables_status,
                    'all_tables_exist': all_exist
                }

    def init_tables(self) -> Dict[str, Any]:
        """Initialize attendance tables if they don't exist."""
        with pg_conn() as conn:
            with conn.cursor() as cur:
                tables_created = []
                
                # Check and create employees table
                cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = 'employees'
                    )
                """)
                if not cur.fetchone()[0]:
                    cur.execute("""
                        CREATE TABLE employees (
                            id SERIAL PRIMARY KEY,
                            name VARCHAR(255) NOT NULL,
                            employee_code VARCHAR(100),
                            location VARCHAR(255),
                            nfc_uid VARCHAR(255),
                            status VARCHAR(50) DEFAULT 'active'
                        )
                    """)
                    tables_created.append('employees')
                    logger.info("✅ Created table: employees")
                else:
                    logger.info("ℹ️  Table already exists: employees")
                
                # Check and create attendance_logs table
                cur.execute("""
                    SELECT EXISTS (
                        SELECT FROM information_schema.tables 
                        WHERE table_schema = 'public' 
                        AND table_name = 'attendance_logs'
                    )
                """)
                if not cur.fetchone()[0]:
                    cur.execute("""
                        CREATE TABLE attendance_logs (
                            id SERIAL PRIMARY KEY,
                            employee_id INTEGER NOT NULL REFERENCES employees(id),
                            log_time TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                            direction VARCHAR(10) NOT NULL,
                            location_id INTEGER REFERENCES locations(id)
                        )
                    """)
                    tables_created.append('attendance_logs')
                    logger.info("✅ Created table: attendance_logs")
                else:
                    logger.info("ℹ️  Table already exists: attendance_logs")
                
                # Migrations for existing attendance_logs table
                cur.execute("""
                    ALTER TABLE attendance_logs
                    ADD COLUMN IF NOT EXISTS location_id INTEGER REFERENCES locations(id)
                """)
                # Upgrade log_time to timezone-aware if it isn't already
                cur.execute("""
                    DO $$
                    BEGIN
                        IF EXISTS (
                            SELECT 1 FROM information_schema.columns
                            WHERE table_name = 'attendance_logs'
                              AND column_name = 'log_time'
                              AND data_type = 'timestamp without time zone'
                        ) THEN
                            ALTER TABLE attendance_logs
                            ALTER COLUMN log_time TYPE TIMESTAMPTZ
                            USING log_time AT TIME ZONE 'UTC';
                        END IF;
                    END $$;
                """)
                
                conn.commit()
                
                return {
                    'status': 'success',
                    'message': 'Attendance tables initialized successfully',
                    'tables': ['employees', 'attendance_logs'],
                    'tables_created': tables_created
                }

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

    def insert_log(self, employee_id: int, direction: str, location_id: Optional[int] = None) -> None:
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "INSERT INTO attendance_logs (employee_id, log_time, direction, location_id) VALUES (%s, %s, %s, %s)",
                    (employee_id, datetime.now(tz.utc), direction, location_id),
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
                    SELECT e.name,
                        (a.log_time AT TIME ZONE COALESCE(l.timezone, 'UTC'))::date AS day,
                        TO_CHAR(a.log_time AT TIME ZONE COALESCE(l.timezone, 'UTC'), 'HH24:MI:SS') AS time,
                        a.direction, e.location, COALESCE(l.timezone, 'UTC') as timezone
                    FROM attendance_logs a
                    JOIN employees e ON a.employee_id = e.id
                    LEFT JOIN locations l ON a.location_id = l.id
                    WHERE {where_clause}
                    ORDER BY a.log_time DESC
                """
                
                cur.execute(query, params)
                rows = cur.fetchall()
                return [
                    {"employee": r[0], "date": r[1].isoformat(), "time": r[2], "direction": r[3], "location": r[4], "timezone": r[5]}
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
        """Calculate work hours and lunch time for each employee in the date range.
        
        Always returns all employees, with null values for those without attendance data.
        """
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # Build WHERE clause for employee filtering
                employee_where_conditions = []
                params = []
                
                if location:
                    employee_where_conditions.append("e.location = %s")
                    params.append(location)
                
                if name_search:
                    employee_where_conditions.append("LOWER(e.name) LIKE %s")
                    params.append(f"%{name_search.lower()}%")
                
                employee_where_clause = ""
                if employee_where_conditions:
                    employee_where_clause = "WHERE " + " AND ".join(employee_where_conditions)
                
                # Add date params after employee filters
                params.extend([from_date, to_date])
                
                query = f"""
                    WITH all_employees AS (
                        SELECT id, name
                        FROM employees e
                        {employee_where_clause}
                    ),
                    daily_times AS (
                        SELECT 
                            e.name,
                            a.log_time::date as work_date,
                            a.log_time,
                            a.direction,
                            ROW_NUMBER() OVER (
                                PARTITION BY e.name, a.log_time::date, a.direction 
                                ORDER BY a.log_time
                            ) as rn
                        FROM all_employees e
                        JOIN attendance_logs a ON e.id = a.employee_id
                        WHERE a.log_time::date BETWEEN %s AND %s
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
                    ),
                    employee_data AS (
                        SELECT 
                            ae.name,
                            dp.work_date,
                            dp.first_in,
                            dp.first_out,
                            dp.second_in,
                            dp.last_out,
                            CASE 
                                WHEN dp.first_in IS NOT NULL AND dp.last_out IS NOT NULL 
                                THEN EXTRACT(EPOCH FROM (dp.last_out - dp.first_in))/3600
                                ELSE NULL 
                            END as hours_worked,
                            CASE 
                                WHEN dp.first_out IS NOT NULL AND dp.second_in IS NOT NULL 
                                THEN EXTRACT(EPOCH FROM (dp.second_in - dp.first_out))/3600
                                ELSE NULL 
                            END as lunch_hours
                        FROM all_employees ae
                        LEFT JOIN daily_pairs dp ON ae.name = dp.name
                    )
                    SELECT * FROM employee_data
                    ORDER BY name, work_date NULLS LAST
                """
                
                cur.execute(query, params)
                rows = cur.fetchall()
                return [{
                    "employee": r[0],
                    "date": r[1].isoformat() if r[1] else None,
                    "first_in": r[2].strftime("%H:%M:%S") if r[2] else None,
                    "first_out": r[3].strftime("%H:%M:%S") if r[3] else None,
                    "second_in": r[4].strftime("%H:%M:%S") if r[4] else None,
                    "last_out": r[5].strftime("%H:%M:%S") if r[5] else None,
                    "hours_worked": round(r[6], 2) if r[6] else 0,
                    "lunch_hours": round(r[7], 2) if r[7] else None
                } for r in rows]

    # ====== NEW DASHBOARD METRICS ======

    def get_realtime_status(self, location: Optional[str] = None) -> Dict[str, Any]:
        """
        Get real-time attendance status for today:
        - today_attendance: employees who have clocked in at least once today
        - today_absences: employees who haven't clocked in today
        - active_breaks: employees currently on break (first out, not clocked back in)
        """
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # Build employee filter
                employee_where = ""
                params = []
                if location:
                    employee_where = "WHERE e.location = %s"
                    params.append(location)
                
                # Query for real-time status
                query = f"""
                    WITH employee_today_status AS (
                        SELECT 
                            e.id,
                            e.name,
                            e.location,
                            -- Has any clock-in today?
                            EXISTS (
                                SELECT 1 FROM attendance_logs al 
                                WHERE al.employee_id = e.id 
                                AND al.log_time::date = CURRENT_DATE 
                                AND al.direction = 'in'
                            ) as has_clocked_in,
                            -- Get latest log for today
                            (
                                SELECT al.direction 
                                FROM attendance_logs al 
                                WHERE al.employee_id = e.id 
                                AND al.log_time::date = CURRENT_DATE 
                                ORDER BY al.log_time DESC 
                                LIMIT 1
                            ) as latest_direction,
                            -- Count of clock-ins today
                            (
                                SELECT COUNT(*) 
                                FROM attendance_logs al 
                                WHERE al.employee_id = e.id 
                                AND al.log_time::date = CURRENT_DATE 
                                AND al.direction = 'in'
                            ) as clock_in_count,
                            -- Count of clock-outs today
                            (
                                SELECT COUNT(*) 
                                FROM attendance_logs al 
                                WHERE al.employee_id = e.id 
                                AND al.log_time::date = CURRENT_DATE 
                                AND al.direction = 'out'
                            ) as clock_out_count
                        FROM employees e
                        {employee_where}
                    )
                    SELECT 
                        -- Today's attendance (clocked in at least once)
                        COUNT(*) FILTER (WHERE has_clocked_in = true) as today_attendance,
                        -- Today's absences (never clocked in)
                        COUNT(*) FILTER (WHERE has_clocked_in = false) as today_absences,
                        -- Active breaks (has clocked out once, latest is 'out', clock-out count = 1)
                        COUNT(*) FILTER (
                            WHERE has_clocked_in = true 
                            AND latest_direction = 'out' 
                            AND clock_out_count = 1
                        ) as active_breaks,
                        -- Total employees
                        COUNT(*) as total_employees
                    FROM employee_today_status
                """
                
                cur.execute(query, params)
                row = cur.fetchone()
                
                return {
                    "today_attendance": row[0] or 0,
                    "today_absences": row[1] or 0,
                    "active_breaks": row[2] or 0,
                    "total_employees": row[3] or 0
                }

    def get_realtime_status_details(self, status_type: str, location: Optional[str] = None,
                                      from_date: Optional[date] = None, to_date: Optional[date] = None) -> List[Dict[str, Any]]:
        """
        Get detailed list of employees for a specific real-time status type.
        status_type: 'attendance' | 'absences' | 'breaks'
        If from_date/to_date provided, returns one row per employee per day in range.
        """
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # Build employee filter
                employee_where = ""
                location_param = []
                if location:
                    employee_where = "AND e.location = %s"
                    location_param = [location]
                
                if status_type == 'attendance':
                    if from_date and to_date:
                        # For date range: one row per employee per day they clocked in
                        query = f"""
                            WITH daily_attendance AS (
                                SELECT 
                                    e.id, e.name, e.location,
                                    al.log_time::date as work_date,
                                    MIN(CASE WHEN al.direction = 'in' THEN al.log_time::time END) as first_in,
                                    MAX(CASE WHEN al.direction = 'out' THEN al.log_time::time END) as last_out
                                FROM employees e
                                JOIN attendance_logs al ON e.id = al.employee_id
                                WHERE al.log_time::date BETWEEN %s AND %s
                                {employee_where}
                                GROUP BY e.id, e.name, e.location, al.log_time::date
                                HAVING COUNT(CASE WHEN al.direction = 'in' THEN 1 END) > 0
                            ),
                            final_status AS (
                                SELECT DISTINCT ON (employee_id, log_time::date)
                                    employee_id, log_time::date as work_date, direction
                                FROM attendance_logs
                                WHERE log_time::date BETWEEN %s AND %s
                                ORDER BY employee_id, log_time::date, log_time DESC
                            )
                            SELECT da.id, da.name, da.location, da.work_date, da.first_in, da.last_out,
                                   COALESCE(fs.direction, 'in') as final_status
                            FROM daily_attendance da
                            LEFT JOIN final_status fs ON da.id = fs.employee_id AND da.work_date = fs.work_date
                            ORDER BY da.work_date DESC, da.name
                        """
                        params = [from_date, to_date] + location_param + [from_date, to_date]
                        cur.execute(query, params)
                        rows = cur.fetchall()
                        return [{
                            "id": r[0],
                            "name": r[1],
                            "location": r[2],
                            "date": r[3].isoformat() if r[3] else None,
                            "first_in": r[4].strftime("%H:%M") if r[4] else None,
                            "last_out": r[5].strftime("%H:%M") if r[5] else None,
                            "status": r[6] or 'in'
                        } for r in rows]
                    else:
                        # Today only: same as before
                        query = f"""
                            SELECT DISTINCT 
                                e.id, e.name, e.location,
                                (SELECT MIN(al.log_time) FROM attendance_logs al 
                                 WHERE al.employee_id = e.id AND al.log_time::date = CURRENT_DATE AND al.direction = 'in') as first_in,
                                (SELECT al.direction FROM attendance_logs al 
                                 WHERE al.employee_id = e.id AND al.log_time::date = CURRENT_DATE 
                                 ORDER BY al.log_time DESC LIMIT 1) as current_status
                            FROM employees e
                            WHERE EXISTS (
                                SELECT 1 FROM attendance_logs al 
                                WHERE al.employee_id = e.id 
                                AND al.log_time::date = CURRENT_DATE 
                                AND al.direction = 'in'
                            )
                            {employee_where}
                            ORDER BY e.name
                        """
                        params = location_param
                        cur.execute(query, params)
                        rows = cur.fetchall()
                        return [{
                            "id": r[0],
                            "name": r[1],
                            "location": r[2],
                            "time": r[3].strftime("%H:%M") if r[3] else None,
                            "status": r[4]
                        } for r in rows]
                        
                elif status_type == 'absences':
                    if from_date and to_date:
                        # For date range: generate all dates and find employees absent on each day
                        query = f"""
                            WITH date_series AS (
                                SELECT generate_series(%s::date, %s::date, '1 day'::interval)::date as work_date
                            ),
                            employee_dates AS (
                                SELECT e.id, e.name, e.location, ds.work_date
                                FROM employees e
                                CROSS JOIN date_series ds
                                WHERE 1=1 {employee_where}
                            )
                            SELECT 
                                ed.id, ed.name, ed.location, ed.work_date,
                                'absent' as status
                            FROM employee_dates ed
                            WHERE NOT EXISTS (
                                SELECT 1 FROM attendance_logs al 
                                WHERE al.employee_id = ed.id 
                                AND al.log_time::date = ed.work_date
                                AND al.direction = 'in'
                            )
                            ORDER BY ed.work_date DESC, ed.name
                        """
                        params = [from_date, to_date] + location_param
                        cur.execute(query, params)
                        rows = cur.fetchall()
                        return [{
                            "id": r[0],
                            "name": r[1],
                            "location": r[2],
                            "date": r[3].isoformat() if r[3] else None,
                            "status": r[4]
                        } for r in rows]
                    else:
                        # Today only
                        query = f"""
                            SELECT e.id, e.name, e.location, NULL as first_in, 'absent' as current_status
                            FROM employees e
                            WHERE NOT EXISTS (
                                SELECT 1 FROM attendance_logs al 
                                WHERE al.employee_id = e.id 
                                AND al.log_time::date = CURRENT_DATE 
                                AND al.direction = 'in'
                            )
                            {employee_where}
                            ORDER BY e.name
                        """
                        params = location_param
                        cur.execute(query, params)
                        rows = cur.fetchall()
                        return [{
                            "id": r[0],
                            "name": r[1],
                            "location": r[2],
                            "time": None,
                            "status": 'absent'
                        } for r in rows]
                        
                elif status_type == 'breaks':
                    if from_date and to_date:
                        # For date range: show break periods per employee per day
                        # A break is when someone clocks out and then clocks back in on the same day
                        query = f"""
                            WITH daily_breaks AS (
                                SELECT 
                                    e.id, e.name, e.location,
                                    al.log_time::date as work_date,
                                    MIN(CASE WHEN al.direction = 'out' THEN al.log_time::time END) as first_out
                                FROM employees e
                                JOIN attendance_logs al ON e.id = al.employee_id
                                WHERE al.log_time::date BETWEEN %s AND %s
                                {employee_where}
                                GROUP BY e.id, e.name, e.location, al.log_time::date
                                HAVING COUNT(CASE WHEN al.direction = 'out' THEN 1 END) > 0
                            ),
                            break_ends AS (
                                SELECT DISTINCT ON (al.employee_id, al.log_time::date)
                                    al.employee_id, 
                                    al.log_time::date as work_date,
                                    al.log_time::time as break_end
                                FROM attendance_logs al
                                WHERE al.log_time::date BETWEEN %s AND %s
                                AND al.direction = 'in'
                                AND EXISTS (
                                    SELECT 1 FROM attendance_logs al2 
                                    WHERE al2.employee_id = al.employee_id 
                                    AND al2.log_time::date = al.log_time::date
                                    AND al2.direction = 'out'
                                    AND al2.log_time < al.log_time
                                )
                                ORDER BY al.employee_id, al.log_time::date, al.log_time
                            )
                            SELECT db.id, db.name, db.location, db.work_date, 
                                   db.first_out as break_start,
                                   be.break_end,
                                   CASE 
                                       WHEN db.first_out IS NOT NULL AND be.break_end IS NOT NULL 
                                       THEN EXTRACT(EPOCH FROM (be.break_end - db.first_out)) / 60
                                       ELSE NULL 
                                   END as duration_minutes
                            FROM daily_breaks db
                            LEFT JOIN break_ends be ON db.id = be.employee_id AND db.work_date = be.work_date
                            WHERE db.first_out IS NOT NULL
                            ORDER BY db.work_date DESC, db.name
                        """
                        params = [from_date, to_date] + location_param + [from_date, to_date]
                        cur.execute(query, params)
                        rows = cur.fetchall()
                        return [{
                            "id": r[0],
                            "name": r[1],
                            "location": r[2],
                            "date": r[3].isoformat() if r[3] else None,
                            "break_start": r[4].strftime("%H:%M") if r[4] else None,
                            "break_end": r[5].strftime("%H:%M") if r[5] else None,
                            "duration": f"{int(r[6])}m" if r[6] else None,
                            "status": 'break_taken'
                        } for r in rows]
                    else:
                        # Today only: employees currently on break
                        query = f"""
                            WITH employee_status AS (
                                SELECT 
                                    e.id, e.name, e.location,
                                    (SELECT al.log_time FROM attendance_logs al 
                                     WHERE al.employee_id = e.id AND al.log_time::date = CURRENT_DATE AND al.direction = 'out'
                                     ORDER BY al.log_time ASC LIMIT 1) as break_start,
                                    (SELECT COUNT(*) FROM attendance_logs al 
                                     WHERE al.employee_id = e.id AND al.log_time::date = CURRENT_DATE AND al.direction = 'out') as out_count,
                                    (SELECT al.direction FROM attendance_logs al 
                                     WHERE al.employee_id = e.id AND al.log_time::date = CURRENT_DATE 
                                     ORDER BY al.log_time DESC LIMIT 1) as latest_direction
                                FROM employees e
                                WHERE EXISTS (
                                    SELECT 1 FROM attendance_logs al 
                                    WHERE al.employee_id = e.id 
                                    AND al.log_time::date = CURRENT_DATE 
                                    AND al.direction = 'in'
                                )
                                {employee_where}
                            )
                            SELECT id, name, location, break_start, 'on_break' as current_status
                            FROM employee_status
                            WHERE latest_direction = 'out' AND out_count >= 1
                            ORDER BY name
                        """
                        params = location_param
                        cur.execute(query, params)
                        rows = cur.fetchall()
                        return [{
                            "id": r[0],
                            "name": r[1],
                            "location": r[2],
                            "time": r[3].strftime("%H:%M") if r[3] else None,
                            "status": r[4]
                        } for r in rows]
                else:
                    return []

    def get_punctuality_metrics(self, from_date: date, to_date: date, location: Optional[str] = None,
                                name: Optional[str] = None, late_threshold_minutes: int = 0, 
                                early_departure_minutes: int = 0) -> Dict[str, Any]:
        """
        Get punctuality and compliance metrics for a date range:
        - late_arrivals: employees who arrived after 9:00 AM (or late_threshold_minutes after)
        - early_departures: employees who left before 5:00 PM (or early_departure_minutes before)
        - missing_punches: days with incomplete clock in/out pairs
        """
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # Build employee filter
                employee_where = ""
                filter_params = []
                if location:
                    employee_where += " AND e.location = %s"
                    filter_params.append(location)
                if name:
                    employee_where += " AND LOWER(e.name) LIKE LOWER(%s)"
                    filter_params.append(f"%{name}%")
                
                # Standard work hours (8:30 AM to 5:30 PM) - can be made configurable later
                late_time = "08:30:00"
                early_time = "17:30:00"
                
                # Parameter order: from_date, to_date, [filter_params...], time
                params_late = [from_date, to_date] + filter_params + [late_time]
                params_early = [from_date, to_date] + filter_params + [early_time]
                params_missing = [from_date, to_date] + filter_params
                
                # Count late arrivals
                late_query = f"""
                    WITH first_clock_ins AS (
                        SELECT 
                            e.id, e.name, a.log_time::date as work_date,
                            MIN(a.log_time::time) as first_in_time
                        FROM employees e
                        JOIN attendance_logs a ON e.id = a.employee_id
                        WHERE a.log_time::date BETWEEN %s AND %s
                        AND a.direction = 'in'
                        {employee_where}
                        GROUP BY e.id, e.name, a.log_time::date
                    )
                    SELECT 
                        COUNT(*) as late_count,
                        COUNT(DISTINCT id) as unique_employees_late
                    FROM first_clock_ins
                    WHERE first_in_time > %s::time
                """
                cur.execute(late_query, params_late)
                late_row = cur.fetchone()
                
                # Count early departures
                early_query = f"""
                    WITH last_clock_outs AS (
                        SELECT 
                            e.id, e.name, a.log_time::date as work_date,
                            MAX(a.log_time::time) as last_out_time
                        FROM employees e
                        JOIN attendance_logs a ON e.id = a.employee_id
                        WHERE a.log_time::date BETWEEN %s AND %s
                        AND a.direction = 'out'
                        {employee_where}
                        GROUP BY e.id, e.name, a.log_time::date
                    )
                    SELECT 
                        COUNT(*) as early_count,
                        COUNT(DISTINCT id) as unique_employees_early
                    FROM last_clock_outs
                    WHERE last_out_time < %s::time
                """
                cur.execute(early_query, params_early)
                early_row = cur.fetchone()
                
                # Count missing punches (days with odd number of logs - incomplete pairs)
                missing_query = f"""
                    WITH daily_logs AS (
                        SELECT 
                            e.id, e.name, a.log_time::date as work_date,
                            SUM(CASE WHEN a.direction = 'in' THEN 1 ELSE 0 END) as in_count,
                            SUM(CASE WHEN a.direction = 'out' THEN 1 ELSE 0 END) as out_count
                        FROM employees e
                        JOIN attendance_logs a ON e.id = a.employee_id
                        WHERE a.log_time::date BETWEEN %s AND %s
                        {employee_where}
                        GROUP BY e.id, e.name, a.log_time::date
                    )
                    SELECT 
                        COUNT(*) as missing_punch_days,
                        COUNT(DISTINCT id) as unique_employees_missing
                    FROM daily_logs
                    WHERE in_count != out_count
                """
                cur.execute(missing_query, params_missing)
                missing_row = cur.fetchone()
                
                # Calculate total work days for rate calculation
                total_query = f"""
                    SELECT COUNT(DISTINCT (e.id, a.log_time::date))
                    FROM employees e
                    JOIN attendance_logs a ON e.id = a.employee_id
                    WHERE a.log_time::date BETWEEN %s AND %s
                    {employee_where}
                """
                cur.execute(total_query, params_missing)
                total_workdays = cur.fetchone()[0] or 1
                
                late_count = late_row[0] or 0
                early_count = early_row[0] or 0
                missing_count = missing_row[0] or 0
                
                return {
                    "late_arrivals": late_count,
                    "late_arrival_rate": round((late_count / total_workdays) * 100, 1) if total_workdays > 0 else 0,
                    "early_departures": early_count,
                    "early_departure_rate": round((early_count / total_workdays) * 100, 1) if total_workdays > 0 else 0,
                    "missing_punches": missing_count,
                    "missing_punch_rate": round((missing_count / total_workdays) * 100, 1) if total_workdays > 0 else 0,
                    "total_workdays": total_workdays
                }

    def get_punctuality_details(self, metric_type: str, from_date: date, to_date: date, 
                                 location: Optional[str] = None, name: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Get detailed list of employees for a specific punctuality metric.
        metric_type: 'late' | 'early' | 'missing'
        """
        with pg_conn() as conn:
            with conn.cursor() as cur:
                # Build employee filter
                employee_where = ""
                params = [from_date, to_date]
                if location:
                    employee_where += " AND e.location = %s"
                    params.append(location)
                if name:
                    employee_where += " AND LOWER(e.name) LIKE LOWER(%s)"
                    params.append(f"%{name}%")
                
                if metric_type == 'late':
                    late_time = "08:30:00"
                    params.append(late_time)
                    query = f"""
                        SELECT 
                            e.id, e.name, e.location, a.log_time::date as work_date,
                            MIN(a.log_time::time) as first_in_time
                        FROM employees e
                        JOIN attendance_logs a ON e.id = a.employee_id
                        WHERE a.log_time::date BETWEEN %s AND %s
                        AND a.direction = 'in'
                        {employee_where}
                        GROUP BY e.id, e.name, e.location, a.log_time::date
                        HAVING MIN(a.log_time::time) > %s::time
                        ORDER BY a.log_time::date DESC, e.name
                    """
                elif metric_type == 'early':
                    early_time = "17:30:00"
                    params.append(early_time)
                    query = f"""
                        SELECT 
                            e.id, e.name, e.location, a.log_time::date as work_date,
                            MAX(a.log_time::time) as last_out_time
                        FROM employees e
                        JOIN attendance_logs a ON e.id = a.employee_id
                        WHERE a.log_time::date BETWEEN %s AND %s
                        AND a.direction = 'out'
                        {employee_where}
                        GROUP BY e.id, e.name, e.location, a.log_time::date
                        HAVING MAX(a.log_time::time) < %s::time
                        ORDER BY a.log_time::date DESC, e.name
                    """
                elif metric_type == 'missing':
                    query = f"""
                        WITH daily_logs AS (
                            SELECT 
                                e.id, e.name, e.location, a.log_time::date as work_date,
                                SUM(CASE WHEN a.direction = 'in' THEN 1 ELSE 0 END) as in_count,
                                SUM(CASE WHEN a.direction = 'out' THEN 1 ELSE 0 END) as out_count
                            FROM employees e
                            JOIN attendance_logs a ON e.id = a.employee_id
                            WHERE a.log_time::date BETWEEN %s AND %s
                            {employee_where}
                            GROUP BY e.id, e.name, e.location, a.log_time::date
                        )
                        SELECT id, name, location, work_date,
                            CASE 
                                WHEN in_count > out_count THEN 'Missing clock-out'
                                ELSE 'Missing clock-in'
                            END as issue_type
                        FROM daily_logs
                        WHERE in_count != out_count
                        ORDER BY work_date DESC, name
                    """
                else:
                    return []
                
                cur.execute(query, params)
                rows = cur.fetchall()
                
                if metric_type == 'missing':
                    return [{
                        "id": r[0],
                        "name": r[1],
                        "location": r[2],
                        "date": r[3].isoformat(),
                        "issue": r[4]
                    } for r in rows]
                else:
                    return [{
                        "id": r[0],
                        "name": r[1],
                        "location": r[2],
                        "date": r[3].isoformat(),
                        "time": r[4].strftime("%H:%M:%S") if r[4] else None
                    } for r in rows]

