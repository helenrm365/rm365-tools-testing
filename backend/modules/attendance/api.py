from __future__ import annotations
from datetime import date
from typing import List, Optional

from fastapi import APIRouter, Depends, Query

from common.deps import get_current_user
from .schemas import ClockRequest, FingerClockRequest
from .service import AttendanceService

router = APIRouter()

def _svc() -> AttendanceService:
    return AttendanceService()

# ---- Employees ----
@router.get("/employees")
def list_employees(user=Depends(get_current_user)):
    return _svc().list_employees_brief()

@router.get("/employees/status")
def list_employees_with_status(
    location: Optional[str] = Query(None),
    name_search: Optional[str] = Query(None),
    user=Depends(get_current_user)
):
    return _svc().list_employees_with_status(location, name_search)

@router.get("/locations")
def get_locations(user=Depends(get_current_user)):
    """Get all available employee locations."""
    return _svc().get_locations()

@router.get("/employees/templates")
def list_employee_templates(user=Depends(get_current_user)):
    """Get all employee fingerprint templates for client-side matching."""
    return _svc().get_employee_templates()

# ---- Clocking ----
@router.post("/clock")
def clock(body: ClockRequest, user=Depends(get_current_user)):
    direction = _svc().toggle_clock(body.employee_id)
    return {"status": "success", "direction": direction}

@router.post("/clock-by-fingerprint")
def clock_by_fingerprint(body: FingerClockRequest, user=Depends(get_current_user)):
    return _svc().clock_by_fingerprint(body.template_b64)

# ---- Logs & summary ----
@router.get("/logs")
def logs(
    from_date: date = Query(...),
    to_date: date = Query(...),
    search: Optional[str] = Query(None),
    location: Optional[str] = Query(None),
    name_search: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    return _svc().get_logs(from_date, to_date, search, location, name_search)

@router.get("/summary")
def summary(
    from_date: date = Query(...),
    to_date: date = Query(...),
    location: Optional[str] = Query(None),
    name_search: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    return _svc().get_summary(from_date, to_date, location, name_search)

@router.get("/daily-stats")
def daily_stats(
    location: Optional[str] = Query(None),
    name_search: Optional[str] = Query(None),
    user=Depends(get_current_user)
):
    """Get today's attendance statistics."""
    return _svc().get_daily_stats(location, name_search)

@router.get("/weekly-chart")
def weekly_chart(
    from_date: date = Query(...),
    to_date: date = Query(...),
    location: Optional[str] = Query(None),
    name_search: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    """Get weekly attendance data for chart visualization."""
    return _svc().get_weekly_attendance_chart(from_date, to_date, location, name_search)

@router.get("/work-hours")
def work_hours(
    from_date: date = Query(...),
    to_date: date = Query(...),
    location: Optional[str] = Query(None),
    name_search: Optional[str] = Query(None),
    user=Depends(get_current_user),
):
    """Calculate work hours for each employee in the date range."""
    return _svc().get_employee_work_hours(from_date, to_date, location, name_search)
