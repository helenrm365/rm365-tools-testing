"""
Test Suite: resolve_clock_location priority logic
Validates that manual clock in/out uses:
  1) The employee's first clock-in location of the day
  2) The employee's assigned branch location
  3) The admin user's JWT location (fallback)

Uses TestEmp1 (Birmingham, id=107) and TestEmp2 (London, id=108).
Cleans up all test data it creates.

Run with: python tests/attendance/test_resolve_clock_location.py
"""
import os
import sys
from datetime import datetime, timezone as tz

# ── Setup paths & env ────────────────────────────────────────────────
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', 'backend'))

env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..', '.env')
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line and not line.startswith('#') and '=' in line:
                key, val = line.split('=', 1)
                os.environ.setdefault(key.strip(), val.strip())

from common.deps import pg_conn
from modules.attendance.repo import AttendanceRepo
from modules.attendance.service import AttendanceService

repo = AttendanceRepo()
svc = AttendanceService(repo=repo)

# Known IDs from the database
TESTEMP1_ID = 107   # location = Birmingham  → location_id = 1
TESTEMP2_ID = 108   # location = London      → location_id = 5
LOC_BIRMINGHAM = 1  # Europe/London
LOC_PARIS = 2       # Europe/Paris
LOC_LONDON = 5      # Europe/London

passed = 0
failed = 0
created_log_ids: list[int] = []


# ── Helpers ──────────────────────────────────────────────────────────
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
        import traceback
        traceback.print_exc()
        return None


def cleanup():
    """Remove all attendance_logs created during this test run."""
    if not created_log_ids:
        print("\n🧹 No test logs to clean up.")
        return
    with pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DELETE FROM attendance_logs WHERE id = ANY(%s)",
                (created_log_ids,),
            )
        conn.commit()
    print(f"\n🧹 Cleaned up {len(created_log_ids)} test log(s): {created_log_ids}")


def clear_today_logs(employee_id: int):
    """Delete any existing today-logs for an employee so we start clean."""
    with pg_conn() as conn:
        with conn.cursor() as cur:
            # Use UTC-based "today" wide window to be safe
            cur.execute(
                """
                DELETE FROM attendance_logs
                WHERE employee_id = %s
                  AND log_time::date >= (NOW() AT TIME ZONE 'UTC')::date - INTERVAL '1 day'
                RETURNING id
                """,
                (employee_id,),
            )
            deleted = cur.fetchall()
        conn.commit()
    if deleted:
        print(f"  🧹 Cleared {len(deleted)} pre-existing today-log(s) for employee {employee_id}")


def insert_test_log(employee_id: int, direction: str, location_id: int) -> int:
    """Insert a clock log directly and track the ID for cleanup."""
    with pg_conn() as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                INSERT INTO attendance_logs (employee_id, log_time, direction, location_id)
                VALUES (%s, NOW(), %s, %s)
                RETURNING id
                """,
                (employee_id, direction, location_id),
            )
            log_id = cur.fetchone()[0]
        conn.commit()
    created_log_ids.append(log_id)
    return log_id


# ── Tests ────────────────────────────────────────────────────────────
def run_tests():
    print("=" * 70)
    print("RESOLVE CLOCK LOCATION — PRIORITY LOGIC TESTS")
    print("=" * 70)

    # ─── Pre-clean ──────────────────────────────────────────────────
    print("\n🔧 Pre-clean: removing any existing today-logs for test employees")
    clear_today_logs(TESTEMP1_ID)
    clear_today_logs(TESTEMP2_ID)

    # ═══════════════════════════════════════════════════════════════
    # TEST 1: No clock-ins today → fallback to branch location
    # ═══════════════════════════════════════════════════════════════
    print("\n─── Test 1: No logs today → branch location fallback ───")

    def test_testemp1_branch_fallback():
        loc = repo.resolve_clock_location(TESTEMP1_ID, fallback_location_id=LOC_PARIS)
        assert loc == LOC_BIRMINGHAM, \
            f"Expected Birmingham ({LOC_BIRMINGHAM}), got {loc}. Should prefer branch over JWT fallback."
        return loc
    test("TestEmp1 (Birmingham branch) → resolves to Birmingham (1)", test_testemp1_branch_fallback)

    def test_testemp2_branch_fallback():
        loc = repo.resolve_clock_location(TESTEMP2_ID, fallback_location_id=LOC_PARIS)
        assert loc == LOC_LONDON, \
            f"Expected London ({LOC_LONDON}), got {loc}. Should prefer branch over JWT fallback."
        return loc
    test("TestEmp2 (London branch) → resolves to London (5)", test_testemp2_branch_fallback)

    # ═══════════════════════════════════════════════════════════════
    # TEST 2: First clock-in today at Paris → should use Paris
    # ═══════════════════════════════════════════════════════════════
    print("\n─── Test 2: First clock-in at Paris → uses Paris ───")

    # Simulate TestEmp1 first clocking in at Paris today
    insert_test_log(TESTEMP1_ID, 'in', LOC_PARIS)

    def test_testemp1_first_clockin_paris():
        loc = repo.resolve_clock_location(TESTEMP1_ID, fallback_location_id=LOC_LONDON)
        assert loc == LOC_PARIS, \
            f"Expected Paris ({LOC_PARIS}), got {loc}. Should use first clock-in location."
        return loc
    test("TestEmp1 first clocked in at Paris → resolves to Paris (2)", test_testemp1_first_clockin_paris)

    # ═══════════════════════════════════════════════════════════════
    # TEST 3: Additional clock-outs/ins at other locations → still uses first clock-in
    # ═══════════════════════════════════════════════════════════════
    print("\n─── Test 3: Later logs at other locations → still first clock-in ───")

    import time
    time.sleep(1)  # ensure ordering by log_time

    # TestEmp1 clocks out at London, then back in at Birmingham
    insert_test_log(TESTEMP1_ID, 'out', LOC_LONDON)
    time.sleep(1)
    insert_test_log(TESTEMP1_ID, 'in', LOC_BIRMINGHAM)

    def test_testemp1_still_paris():
        loc = repo.resolve_clock_location(TESTEMP1_ID, fallback_location_id=LOC_LONDON)
        assert loc == LOC_PARIS, \
            f"Expected Paris ({LOC_PARIS}), got {loc}. Should still use FIRST clock-in of the day."
        return loc
    test("TestEmp1 (multiple later logs) → still resolves to Paris (2)", test_testemp1_still_paris)

    # ═══════════════════════════════════════════════════════════════
    # TEST 4: TestEmp2 with no logs → branch, then add a clock-in
    # ═══════════════════════════════════════════════════════════════
    print("\n─── Test 4: TestEmp2 branch fallback, then first clock-in override ───")

    def test_testemp2_no_logs():
        loc = repo.resolve_clock_location(TESTEMP2_ID, fallback_location_id=LOC_BIRMINGHAM)
        assert loc == LOC_LONDON, \
            f"Expected London ({LOC_LONDON}) branch, got {loc}."
        return loc
    test("TestEmp2 (no logs) → London branch (5)", test_testemp2_no_logs)

    # Now TestEmp2 clocks in at Birmingham
    insert_test_log(TESTEMP2_ID, 'in', LOC_BIRMINGHAM)

    def test_testemp2_first_clockin_bham():
        loc = repo.resolve_clock_location(TESTEMP2_ID, fallback_location_id=LOC_PARIS)
        assert loc == LOC_BIRMINGHAM, \
            f"Expected Birmingham ({LOC_BIRMINGHAM}), got {loc}. Should use first clock-in."
        return loc
    test("TestEmp2 first clocked in at Birmingham → resolves to Birmingham (1)", test_testemp2_first_clockin_bham)

    # ═══════════════════════════════════════════════════════════════
    # TEST 5: End-to-end via service toggle_clock
    # ═══════════════════════════════════════════════════════════════
    print("\n─── Test 5: End-to-end toggle_clock uses resolved location ───")

    # Clear TestEmp2 and do a full toggle_clock
    clear_today_logs(TESTEMP2_ID)
    created_log_ids.clear()  # those were already deleted

    # First clock — no prior logs, should use London branch (id=5)
    def test_toggle_no_prior():
        result = svc.toggle_clock(TESTEMP2_ID, location_id=LOC_PARIS)
        assert result['direction'] == 'in', f"Expected 'in', got {result['direction']}"
        # Timezone should match London branch (Europe/London), NOT Paris
        assert result['timezone'] == 'Europe/London', \
            f"Expected Europe/London (branch), got {result['timezone']}"
        # Track the log for cleanup
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM attendance_logs WHERE employee_id = %s ORDER BY log_time DESC LIMIT 1",
                    (TESTEMP2_ID,),
                )
                created_log_ids.append(cur.fetchone()[0])
        return result
    test("toggle_clock (no prior) → clocks in with London tz", test_toggle_no_prior)

    # Second clock — should use first clock-in location (London, just set above)
    def test_toggle_second():
        result = svc.toggle_clock(TESTEMP2_ID, location_id=LOC_PARIS)
        assert result['direction'] == 'out', f"Expected 'out', got {result['direction']}"
        assert result['timezone'] == 'Europe/London', \
            f"Expected Europe/London (first clock-in location), got {result['timezone']}"
        with pg_conn() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT id FROM attendance_logs WHERE employee_id = %s ORDER BY log_time DESC LIMIT 1",
                    (TESTEMP2_ID,),
                )
                created_log_ids.append(cur.fetchone()[0])
        return result
    test("toggle_clock (second) → clocks out with London tz (from first clock-in)", test_toggle_second)

    # ─── Summary ────────────────────────────────────────────────────
    print("\n" + "=" * 70)
    total = passed + failed
    print(f"RESULTS: {passed}/{total} passed, {failed} failed")
    if failed == 0:
        print("🎉 ALL TESTS PASSED — resolve_clock_location priority logic works!")
    else:
        print("⚠️  Some tests failed — review errors above")
    print("=" * 70)
    return failed == 0


# ── Main ─────────────────────────────────────────────────────────────
if __name__ == "__main__":
    try:
        success = run_tests()
    finally:
        cleanup()
    sys.exit(0 if success else 1)
