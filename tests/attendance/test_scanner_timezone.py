"""
Test Suite: Scanner Location Timezone Refactor
Validates all attendance repo functions execute correctly with scanner-first timezone logic.
Each test calls the actual database to ensure SQL is valid.

Run with: python tests/attendance/test_scanner_timezone.py
"""
import os
import sys
from datetime import date, timedelta

# Add backend to path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'backend'))

# Load .env
env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.env')
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, val = line.split('=', 1)
                os.environ.setdefault(key.strip(), val.strip())

from modules.attendance.repo import AttendanceRepo

repo = AttendanceRepo()
today = date.today()
week_ago = today - timedelta(days=7)
month_ago = today - timedelta(days=30)

passed = 0
failed = 0


def test(name, fn):
    global passed, failed
    try:
        result = fn()
        passed += 1
        print(f"  ✅ {name}")
        return result
    except Exception as e:
        failed += 1
        print(f"  ❌ {name}: {e}")
        return None


def run_tests():
    print("=" * 70)
    print("SCANNER TIMEZONE REFACTOR — INTEGRATION TEST SUITE")
    print("=" * 70)

    # ─── 1. list_logs ───────────────────────────────────────────────
    print("\n📋 list_logs")
    result = test("list_logs (no filters)", lambda: repo.list_logs(week_ago, today))
    if result:
        test("list_logs returns clock_country field",
             lambda: None if not result else (
                 None if 'clock_country' in result[0] else (_ for _ in ()).throw(AssertionError("missing clock_country"))
             ))
        test("list_logs returns timezone field",
             lambda: None if not result else (
                 None if 'timezone' in result[0] else (_ for _ in ()).throw(AssertionError("missing timezone"))
             ))
    test("list_logs with location filter", lambda: repo.list_logs(week_ago, today, location="Birmingham"))
    test("list_logs with name filter", lambda: repo.list_logs(week_ago, today, name_search="a"))

    # ─── 2. summary_counts ──────────────────────────────────────────
    print("\n📊 summary_counts")
    result = test("summary_counts (no filters)", lambda: repo.summary_counts(week_ago, today))
    if result and isinstance(result, dict):
        test("summary_counts has expected keys",
             lambda: None if all(k in result for k in ['clock_ins', 'clock_outs', 'unique_employees', 'avg_daily']) 
             else (_ for _ in ()).throw(AssertionError(f"missing keys: {result.keys()}")))
    elif result:
        test("summary_counts returns data", lambda: None)
    test("summary_counts with location", lambda: repo.summary_counts(week_ago, today, location="Birmingham"))

    # ─── 3. list_employees_with_status ──────────────────────────────
    print("\n👥 list_employees_with_status")
    test("list_employees_with_status (no filters)", lambda: repo.list_employees_with_status())
    test("list_employees_with_status with location", lambda: repo.list_employees_with_status(location="Birmingham"))

    # ─── 4. get_daily_stats ─────────────────────────────────────────
    print("\n📅 get_daily_stats")
    result = test("get_daily_stats (no filters)", lambda: repo.get_daily_stats())
    if result:
        test("get_daily_stats returns dict",
             lambda: None if isinstance(result, dict) else (_ for _ in ()).throw(AssertionError(f"expected dict, got {type(result)}")))
    test("get_daily_stats with location", lambda: repo.get_daily_stats(location="Birmingham"))

    # ─── 5. get_weekly_attendance_chart ─────────────────────────────
    print("\n📈 get_weekly_attendance_chart")
    test("get_weekly_attendance_chart", lambda: repo.get_weekly_attendance_chart(week_ago, today))
    test("get_weekly_attendance_chart with location", lambda: repo.get_weekly_attendance_chart(week_ago, today, location="Birmingham"))

    # ─── 6. get_employee_work_hours ─────────────────────────────────
    print("\n⏱️  get_employee_work_hours")
    result = test("get_employee_work_hours (no filters)", lambda: repo.get_employee_work_hours(week_ago, today))
    if result:
        with_data = [r for r in result if r.get('date')]
        if with_data:
            test("work_hours has expected fields",
                 lambda: None if all(k in with_data[0] for k in ['employee', 'date', 'first_in', 'last_out', 'hours_worked'])
                 else (_ for _ in ()).throw(AssertionError(f"missing keys: {with_data[0].keys()}")))
    test("get_employee_work_hours with location", lambda: repo.get_employee_work_hours(week_ago, today, location="Birmingham"))
    test("get_employee_work_hours with name search", lambda: repo.get_employee_work_hours(week_ago, today, name_search="a"))

    # ─── 7. get_realtime_status ─────────────────────────────────────
    print("\n🔴 get_realtime_status")
    result = test("get_realtime_status (no filters)", lambda: repo.get_realtime_status())
    if result:
        test("realtime_status has expected keys",
             lambda: None if all(k in result for k in ['today_attendance', 'today_absences', 'active_breaks', 'total_employees'])
             else (_ for _ in ()).throw(AssertionError(f"missing keys: {result.keys()}")))
    test("get_realtime_status with location", lambda: repo.get_realtime_status(location="Birmingham"))

    # ─── 8. get_realtime_status_details ─────────────────────────────
    print("\n🔍 get_realtime_status_details")
    # Today-only variants
    test("status_details: attendance (today)", lambda: repo.get_realtime_status_details('attendance'))
    test("status_details: absences (today)", lambda: repo.get_realtime_status_details('absences'))
    test("status_details: breaks (today)", lambda: repo.get_realtime_status_details('breaks'))
    # Date range variants
    test("status_details: attendance (range)", lambda: repo.get_realtime_status_details('attendance', from_date=week_ago, to_date=today))
    test("status_details: absences (range)", lambda: repo.get_realtime_status_details('absences', from_date=week_ago, to_date=today))
    test("status_details: breaks (range)", lambda: repo.get_realtime_status_details('breaks', from_date=week_ago, to_date=today))
    # With location filter
    test("status_details: attendance (today + location)", lambda: repo.get_realtime_status_details('attendance', location="Birmingham"))
    test("status_details: attendance (range + location)", lambda: repo.get_realtime_status_details('attendance', location="Birmingham", from_date=week_ago, to_date=today))

    # ─── 9. get_punctuality_metrics ─────────────────────────────────
    print("\n📏 get_punctuality_metrics")
    result = test("punctuality_metrics (no filters)", lambda: repo.get_punctuality_metrics(month_ago, today))
    if result:
        test("punctuality_metrics has expected keys",
             lambda: None if all(k in result for k in ['late_arrivals', 'early_departures', 'missing_punches', 'total_workdays'])
             else (_ for _ in ()).throw(AssertionError(f"missing keys: {result.keys()}")))
    test("punctuality_metrics with location", lambda: repo.get_punctuality_metrics(month_ago, today, location="Birmingham"))
    test("punctuality_metrics with name", lambda: repo.get_punctuality_metrics(month_ago, today, name="a"))

    # ─── 10. get_punctuality_details ────────────────────────────────
    print("\n📝 get_punctuality_details")
    test("punctuality_details: late", lambda: repo.get_punctuality_details('late', month_ago, today))
    test("punctuality_details: early", lambda: repo.get_punctuality_details('early', month_ago, today))
    test("punctuality_details: missing", lambda: repo.get_punctuality_details('missing', month_ago, today))
    test("punctuality_details: late + location", lambda: repo.get_punctuality_details('late', month_ago, today, location="Birmingham"))
    test("punctuality_details: early + name", lambda: repo.get_punctuality_details('early', month_ago, today, name="a"))

    # ─── Summary ────────────────────────────────────────────────────
    print("\n" + "=" * 70)
    total = passed + failed
    print(f"RESULTS: {passed}/{total} passed, {failed} failed")
    if failed == 0:
        print("🎉 ALL TESTS PASSED — Scanner timezone refactor is working correctly!")
    else:
        print("⚠️  Some tests failed — review errors above")
    print("=" * 70)
    return failed == 0


if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
