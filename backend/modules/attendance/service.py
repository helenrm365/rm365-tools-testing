from __future__ import annotations
import base64
import os
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional

import httpx

from .repo import AttendanceRepo

class AttendanceService:
    def __init__(self, repo: AttendanceRepo | None = None):
        self.repo = repo or AttendanceRepo()

    # ---- Table Initialization ----
    def check_tables_status(self) -> Dict[str, Any]:
        """Check if attendance tables exist in the database."""
        return self.repo.check_tables_exist()

    def initialize_tables(self) -> Dict[str, Any]:
        """Initialize attendance tables if they don't exist."""
        return self.repo.init_tables()

    # ---- Employees ----
    def list_employees_brief(self) -> List[Dict[str, Any]]:
        return self.repo.list_employees_brief()

    def list_employees_with_status(self, location: Optional[str] = None, name_search: Optional[str] = None) -> List[Dict[str, Any]]:
        return self.repo.list_employees_with_status(location, name_search)

    def get_locations(self) -> List[str]:
        """Get all available employee locations."""
        return self.repo.get_locations()

    # ---- Clocking ----
    def toggle_clock(self, employee_id: int, location_id: int = None) -> Dict[str, Any]:
        """
        Toggle IN/OUT for the given employee, based on today's latest direction.
        Resolves the effective location_id by priority:
          1) The employee's first clock-in location of the day
          2) The employee's assigned branch location
          3) The admin user's location (passed as location_id)
        Returns direction plus local time/timezone info.
        """
        resolved_location_id = self.repo.resolve_clock_location(employee_id, fallback_location_id=location_id)
        last = self.repo.latest_direction_today(employee_id, resolved_location_id)
        direction = "in" if last != "in" else "out"
        log_info = self.repo.insert_log(employee_id, direction, resolved_location_id)
        return {"direction": direction, **log_info}

    # ---- Logs & summary ----
    def get_logs(self, from_date: date, to_date: date, search: Optional[str] = None, location: Optional[str] = None, name_search: Optional[str] = None) -> List[Dict[str, Any]]:
        return self.repo.list_logs(from_date, to_date, search, location, name_search)

    def get_summary(self, from_date: date, to_date: date, location: Optional[str] = None, name_search: Optional[str] = None) -> List[Dict[str, Any]]:
        return self.repo.summary_counts(from_date, to_date, location, name_search)

    def get_daily_stats(self, location: Optional[str] = None, name_search: Optional[str] = None) -> Dict[str, Any]:
        """Get today's attendance statistics."""
        return self.repo.get_daily_stats(location, name_search)

    def get_weekly_attendance_chart(self, from_date: date, to_date: date, location: Optional[str] = None, name_search: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get weekly attendance data for chart visualization."""
        return self.repo.get_weekly_attendance_chart(from_date, to_date, location, name_search)

    def get_employee_work_hours(self, from_date: date, to_date: date, location: Optional[str] = None, name_search: Optional[str] = None) -> List[Dict[str, Any]]:
        """Calculate work hours for each employee in the date range."""
        return self.repo.get_employee_work_hours(from_date, to_date, location, name_search)

    # ====== NEW DASHBOARD METRICS ======

    def get_realtime_status(self, location: Optional[str] = None) -> Dict[str, Any]:
        """Get real-time attendance status for today."""
        return self.repo.get_realtime_status(location)

    def get_realtime_status_details(self, status_type: str, location: Optional[str] = None, 
                                      from_date: Optional[date] = None, to_date: Optional[date] = None) -> List[Dict[str, Any]]:
        """Get detailed list of employees for a specific real-time status type."""
        return self.repo.get_realtime_status_details(status_type, location, from_date, to_date)

    def get_punctuality_metrics(self, from_date: date, to_date: date, location: Optional[str] = None, name: Optional[str] = None) -> Dict[str, Any]:
        """Get punctuality and compliance metrics for a date range."""
        return self.repo.get_punctuality_metrics(from_date, to_date, location, name)

    def get_punctuality_details(self, metric_type: str, from_date: date, to_date: date, 
                                 location: Optional[str] = None, name: Optional[str] = None) -> List[Dict[str, Any]]:
        """Get detailed list of employees for a specific punctuality metric."""
        return self.repo.get_punctuality_details(metric_type, from_date, to_date, location, name)

