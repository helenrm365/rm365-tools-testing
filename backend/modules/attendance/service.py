from __future__ import annotations
import base64
from dataclasses import dataclass
from datetime import date
from typing import Any, Dict, List, Optional

import httpx

from .repo import AttendanceRepo

# Local SecuGen endpoints (same order you used previously)
_SGI_ENDPOINTS = [
    "https://localhost:8443/SGIMatchScore",
    "https://127.0.0.1:8443/SGIMatchScore",
    "https://localhost:8080/SGIMatchScore",
    "https://127.0.0.1:8080/SGIMatchScore",
    "http://localhost:8080/SGIMatchScore",
    "http://127.0.0.1:8080/SGIMatchScore",
]

@dataclass
class Match:
    employee_id: int
    name: str
    score: int

class AttendanceService:
    def __init__(self, repo: AttendanceRepo | None = None):
        self.repo = repo or AttendanceRepo()

    # ---- Employees ----
    def list_employees_brief(self) -> List[Dict[str, Any]]:
        return self.repo.list_employees_brief()

    def list_employees_with_status(self, location: Optional[str] = None, name_search: Optional[str] = None) -> List[Dict[str, Any]]:
        return self.repo.list_employees_with_status(location, name_search)

    def get_locations(self) -> List[str]:
        """Get all available employee locations."""
        return self.repo.get_locations()

    # ---- Clocking ----
    def toggle_clock(self, employee_id: int) -> str:
        """
        Toggle IN/OUT for the given employee, based on today's latest direction.
        Uses lowercase 'in'/'out' just like your original data.
        """
        last = self.repo.latest_direction_today(employee_id)
        direction = "in" if last != "in" else "out"
        self.repo.insert_log(employee_id, direction)
        return direction

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

    # ---- Fingerprint matching ----
    def identify_best_match(self, live_template_b64: str, threshold: int = 130, template_format: str = "ANSI") -> Optional[Match]:
        """
        Ask the local SGIMatchScore service to compare the live probe with each stored template.
        Returns the best match if score >= threshold.
        """
        candidates = self.repo.active_employee_templates()
        best = Match(employee_id=-1, name="", score=-1)

        for cand in candidates:
            cand_b64 = base64.b64encode(cand["tpl_bytes"]).decode("ascii")
            score = self._sgi_match_score(live_template_b64, cand_b64, template_format)
            if score is None:
                continue
            if score > best.score:
                best = Match(employee_id=cand["id"], name=cand["name"], score=score)

        if best.score >= threshold and best.employee_id != -1:
            return best
        return None

    def clock_by_fingerprint(self, live_template_b64: str) -> Dict[str, Any]:
        match = self.identify_best_match(live_template_b64)
        if not match:
            return {"status": "error", "message": "No matching fingerprint found"}

        direction = self.toggle_clock(match.employee_id)
        return {
            "status": "success",
            "message": f"Clocked {direction.upper()} for {match.name}",
            "employee": {"id": match.employee_id, "name": match.name, "score": match.score},
            "direction": direction.upper(),
        }

    @staticmethod
    def _sgi_match_score(live_b64: str, cand_b64: str, template_format: str = "ANSI") -> Optional[int]:
        payload = {
            "Template1": live_b64,
            "Template2": cand_b64,
            "TemplateFormat": template_format,
        }
        for ep in _SGI_ENDPOINTS:
            try:
                with httpx.Client(verify=False, timeout=5.0) as client:
                    r = client.post(ep, json=payload)
                    if r.status_code != 200:
                        continue
                    data = r.json()
                    if data.get("ErrorCode") != 0:
                        continue
                    score = data.get("Score")
                    if isinstance(score, int):
                        return score
            except Exception:
                continue
        return None
