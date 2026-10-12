import os
import sys
import shutil
import tempfile
from pathlib import Path
import pytest
import pandas as pd

# Add backend directory to sys.path
BASE_DIR = Path(__file__).resolve().parent.parent
BACKEND_DIR = BASE_DIR / "backend"
sys.path.insert(0, str(BACKEND_DIR))

from config import (
    STATUS_PRESENT,
    STATUS_LEFT,
    STATUS_NOT_SCANNED,
    ACTION_ENTRY,
    ACTION_EXIT,
    ACTION_ALREADY_COMPLETED,
    RFID_API_SECRET
)
from excel_handler import ExcelHandler, canonical_key, normalize_rfid
from attendance_service import AttendanceService
from auth import verify_admin_credentials, create_admin_token, decode_admin_token
from app import app


@pytest.fixture
def test_environment():
    """Sets up a safe temporary isolated workspace for Excel testing."""
    temp_dir = Path(tempfile.mkdtemp(prefix="techbots_test_"))
    temp_members = temp_dir / "club_members.xlsx"
    temp_attendance = temp_dir / "attendance_records.xlsx"
    temp_backups = temp_dir / "backups"
    temp_backups.mkdir()

    # Copy real data or create test sample
    real_members = BASE_DIR / "data" / "club_members.xlsx"
    if real_members.exists():
        shutil.copy2(real_members, temp_members)
    else:
        sample_df = pd.DataFrame([
            {"Date": "", "Name": "", "Department": "", "USN": "", "In Time": "", "Out Time": "", "Status": ""},
            {"Date": "", "Name": "Ananya udupi", "Department": "CSE", "USN": "4SN25CS002", "In Time": "", "Out Time": "", "Status": ""},
            {"Date": "", "Name": "Adarsh", "Department": "EAC", "USN": "4SN24 EC006", "In Time": "", "Out Time": "", "Status": ""}
        ])
        sample_df.to_excel(temp_members, index=False)

    handler = ExcelHandler(members_path=temp_members, attendance_path=temp_attendance, backups_dir=temp_backups)
    service = AttendanceService(handler)

    yield handler, service, temp_dir

    # Cleanup
    shutil.rmtree(temp_dir, ignore_errors=True)


def test_excel_loading_and_nan_handling(test_environment):
    """Verifies that empty rows/NaNs are stripped and real members loaded."""
    handler, service, _ = test_environment
    members = handler.get_all_members()

    assert len(members) > 0
    for m in members:
        assert m["name"] != ""
        assert m["usn"] != ""
        assert m["canonical_usn"] != ""


def test_member_lookup_by_usn_and_rfid(test_environment):
    """Tests member lookup by exact USN, spaced USN, and assigned RFID UID."""
    handler, service, _ = test_environment

    # Lookup standard USN
    m1 = handler.find_member_by_usn("4SN25CS002")
    assert m1 is not None
    assert m1["name"] == "Ananya udupi"

    # Lookup USN with internal space (4SN24 EC006)
    m2 = handler.find_member_by_usn("4SN24EC006")
    assert m2 is not None
    assert m2["name"] == "Adarsh"

    # Assign RFID UID to m1 and lookup by RFID UID
    success, msg, updated = handler.update_member("4SN25CS002", {"rfid_uid": "E3A4128B"})
    assert success is True

    m_by_rfid = handler.find_member_by_identifier("E3A4128B")
    assert m_by_rfid is not None
    assert m_by_rfid["name"] == "Ananya udupi"


def test_first_scan_checkin_present(test_environment):
    """Tests that first valid scan records In Time and sets status to Present."""
    handler, service, _ = test_environment

    res = service.process_scan("4SN25CS002")
    assert res["success"] is True
    assert res["action"] == ACTION_ENTRY
    assert res["status"] == STATUS_PRESENT
    assert res["in_time"] != ""
    assert res["out_time"] == ""


def test_second_scan_checkout_left(test_environment):
    """Tests that second valid scan records Out Time and sets status to Left."""
    handler, service, _ = test_environment

    # 1st Scan
    res1 = service.process_scan("4SN25CS002")
    assert res1["success"] is True
    first_in_time = res1["in_time"]

    # Force bypass debounce timer for unit test
    service._last_scan_times.clear()

    # 2nd Scan
    res2 = service.process_scan("4SN25CS002")
    assert res2["success"] is True
    assert res2["action"] == ACTION_EXIT
    assert res2["status"] == STATUS_LEFT
    assert res2["in_time"] == first_in_time
    assert res2["out_time"] != ""


def test_third_scan_already_completed_no_corruption(test_environment):
    """Tests that third scan informs completed attendance without altering original times."""
    handler, service, _ = test_environment

    # 1st Scan
    res1 = service.process_scan("4SN25CS002")
    service._last_scan_times.clear()

    # 2nd Scan
    res2 = service.process_scan("4SN25CS002")
    service._last_scan_times.clear()

    orig_in_time = res2["in_time"]
    orig_out_time = res2["out_time"]

    # 3rd Scan
    res3 = service.process_scan("4SN25CS002")
    assert res3["success"] is False
    assert res3["action"] == ACTION_ALREADY_COMPLETED
    assert res3["in_time"] == orig_in_time
    assert res3["out_time"] == orig_out_time

    # Verify workbook record is still intact
    records = handler.get_attendance_records()
    target = [r for r in records if r["canonical_usn"] == "4SN25CS002"][0]
    assert target["in_time"] == orig_in_time
    assert target["out_time"] == orig_out_time


def test_rapid_scan_debounce(test_environment):
    """Tests that rapid scans within cooldown window are rejected safely."""
    handler, service, _ = test_environment

    res1 = service.process_scan("4SN25CS002")
    assert res1["success"] is True

    # Immediate second scan without clearing _last_scan_times
    res_rapid = service.process_scan("4SN25CS002")
    assert res_rapid["success"] is False
    assert res_rapid.get("cooldown") is True
    assert "too quickly" in res_rapid["message"]


def test_unknown_rfid_card(test_environment):
    """Tests that unknown RFID card is rejected with 404 info and no false attendance."""
    handler, service, _ = test_environment

    res = service.process_scan("UNKNOWN_TAG_99999")
    assert res["success"] is False
    assert res.get("unknown_card") is True
    assert "Unknown RFID Card" in res["message"]

    # Verify no record was added
    records = handler.get_attendance_records(date_str=service.get_today_date_str())
    assert not any(r["usn"] == "UNKNOWN_TAG_99999" for r in records)


def test_duplicate_usn_and_rfid_detection(test_environment):
    """Tests prevention and detection of duplicate USNs and RFID UIDs."""
    handler, service, _ = test_environment

    # Attempt to add member with duplicate USN
    success, msg, _ = handler.add_member({
        "name": "Duplicate Tester",
        "usn": "4SN25CS002",
        "department": "CSE"
    })
    assert success is False
    assert "already exists" in msg

    # Assign RFID to member 1
    handler.update_member("4SN25CS002", {"rfid_uid": "UNIQUE_TAG_100"})

    # Attempt to assign same RFID to member 2
    success2, msg2, _ = handler.update_member("4SN24EC006", {"rfid_uid": "UNIQUE_TAG_100"})
    assert success2 is False
    assert "already assigned" in msg2


def test_admin_authentication_and_jwt():
    """Tests password verification, JWT generation, and token decoding."""
    assert verify_admin_credentials("admin", "TechBots@SIT2026") is True
    assert verify_admin_credentials("admin", "WrongPassword") is False
    assert verify_admin_credentials("hacker", "TechBots@SIT2026") is False

    token = create_admin_token("admin")
    assert token is not None

    payload = decode_admin_token(token)
    assert payload is not None
    assert payload["sub"] == "admin"
    assert payload["role"] == "admin"


def test_flask_api_health_endpoint():
    """Tests the /api/health endpoint via Flask test client."""
    client = app.test_client()
    resp = client.get("/api/health")
    assert resp.status_code == 200

    data = resp.get_json()
    assert data["status"] == "healthy"
    assert "TechBots" in data["system"]
    assert "Srinivas Institute of Technology" in data["institution"]
    assert data["timezone"] == "Asia/Kolkata"


def test_flask_api_attendance_scan_and_auth():
    """Tests hardware scan API with valid X-API-Key vs unauthorized request."""
    client = app.test_client()

    # 1. Unauthorized scan (missing header and token)
    unauth_resp = client.post("/api/attendance/scan", json={"identifier": "4SN25CS002"})
    assert unauth_resp.status_code == 401

    # 2. Authorized scan with X-API-Key header
    auth_resp = client.post(
        "/api/attendance/scan",
        json={"identifier": "4SN25CS002"},
        headers={"X-API-Key": RFID_API_SECRET}
    )
    # Could be 200 (success) or 429 (debounce if recently run)
    assert auth_resp.status_code in (200, 429)


def test_attendance_export_endpoints():
    """Tests Excel and CSV attendance export endpoints."""
    client = app.test_client()

    # Export Excel
    excel_resp = client.get("/api/attendance/export?format=xlsx")
    assert excel_resp.status_code == 200
    assert "application/vnd.openxmlformats" in excel_resp.content_type

    # Export CSV
    csv_resp = client.get("/api/attendance/export?format=csv")
    assert csv_resp.status_code == 200
    assert "text/csv" in csv_resp.content_type


def test_date_rollover_and_daily_session_reset(test_environment):
    """Tests that a date rollover creates a fresh daily session without corrupting prior days."""
    handler, service, _ = test_environment

    # Day 1 scan
    day1_date = "2026-10-01"
    member = handler.find_member_by_usn("4SN25CS002")
    assert member is not None

    handler.save_or_update_attendance(
        date_str=day1_date,
        member=member,
        in_time="09:00 AM",
        out_time="05:00 PM",
        status=STATUS_LEFT
    )

    # Day 2 scan (different date)
    day2_date = "2026-10-02"
    handler.save_or_update_attendance(
        date_str=day2_date,
        member=member,
        in_time="09:15 AM",
        out_time="",
        status=STATUS_PRESENT
    )

    day1_records = handler.get_attendance_records(date_str=day1_date)
    assert len(day1_records) == 1
    assert day1_records[0]["in_time"] == "09:00 AM"
    assert day1_records[0]["out_time"] == "05:00 PM"
    assert day1_records[0]["status"] == STATUS_LEFT

    day2_records = handler.get_attendance_records(date_str=day2_date)
    assert len(day2_records) == 1
    assert day2_records[0]["in_time"] == "09:15 AM"
    assert day2_records[0]["out_time"] == ""
    assert day2_records[0]["status"] == STATUS_PRESENT


def test_department_and_branch_summary_reporting(test_environment):
    """Tests comprehensive attendance report generation with branch and department filters."""
    handler, service, _ = test_environment

    # Generate report
    report = service.get_comprehensive_reports(department="CSE")
    assert "department_breakdown" in report
    assert "records" in report
    for r in report["records"]:
        assert r["department"].upper() == "CSE"

    # Filter by specific branch
    branch_report = service.get_comprehensive_reports(branch="Computer Science & Engineering")
    for r in branch_report["records"]:
        assert "Computer Science" in r["branch"]


def test_admin_unauthorized_member_modification_rejected():
    """Tests that modifying members without valid admin credentials is rejected with 401."""
    client = app.test_client()

    # Unauthorized POST /api/members
    post_resp = client.post("/api/members", json={"name": "Hacker", "usn": "4SN99CS999"})
    assert post_resp.status_code == 401

    # Unauthorized PUT /api/members/<usn>
    put_resp = client.put("/api/members/4SN25CS002", json={"name": "Changed Name"})
    assert put_resp.status_code == 401

    # Unauthorized DELETE /api/members/<usn>
    del_resp = client.delete("/api/members/4SN25CS002")
    assert del_resp.status_code == 401


def test_frontend_static_pages_and_routes():
    """Tests that all frontend HTML pages, CSS, and JS routes return 200 OK with expected content."""
    client = app.test_client()

    routes_to_test = [
        ("/", "TechBots"),
        ("/login", "Admin"),
        ("/members", "Member"),
        ("/attendance", "Attendance"),
        ("/reports", "Reports"),
        ("/settings", "Settings"),
        ("/settings.html", "Settings"),
        ("/css/style.css", "font-family"),
        ("/js/dashboard.js", "API_BASE"),
        ("/js/members.js", "API_BASE"),
        ("/js/reports.js", "API_BASE"),
        ("/js/attendance.js", "API_BASE"),
        ("/js/settings.js", "API_BASE"),
        ("/js/navigation.js", "initMobileNav")
    ]

    for path, keyword in routes_to_test:
        resp = client.get(path)
        assert resp.status_code == 200, f"Route {path} failed with status {resp.status_code}"
        assert keyword.lower() in resp.get_data(as_text=True).lower(), f"Keyword {keyword} not in {path}"


def test_system_settings_api():
    """Tests GET/PUT /api/settings and /api/settings/backup_now with authorization checks."""
    client = app.test_client()

    # 1. GET /api/settings
    resp = client.get("/api/settings")
    assert resp.status_code == 200
    data = resp.get_json()
    assert data["success"] is True
    assert "Srinivas Institute of Technology" in data["institution"]["college_name"]
    assert data["attendance_rules"]["timezone"] == "Asia/Kolkata"
    assert data["storage"]["total_registered_members"] >= 0

    # 2. Unauthorized PUT /api/settings rejected
    unauth_put = client.put("/api/settings", json={"rapid_scan_cooldown_seconds": 25})
    assert unauth_put.status_code == 401

    # 3. Authorized PUT /api/settings
    admin_token = create_admin_token("admin")
    auth_put = client.put(
        "/api/settings",
        headers={"Authorization": f"Bearer {admin_token}"},
        json={"rapid_scan_cooldown_seconds": 25, "entry_exit_mode": "strict_single_session"}
    )
    assert auth_put.status_code == 200
    put_data = auth_put.get_json()
    assert put_data["success"] is True
    assert put_data["settings"]["rapid_scan_cooldown_seconds"] == 25

    # 4. Unauthorized POST /api/settings/backup_now rejected
    unauth_bkp = client.post("/api/settings/backup_now")
    assert unauth_bkp.status_code == 401

    # 5. Authorized POST /api/settings/backup_now succeeds
    auth_bkp = client.post(
        "/api/settings/backup_now",
        headers={"Authorization": f"Bearer {admin_token}"}
    )
    assert auth_bkp.status_code == 200
    bkp_data = auth_bkp.get_json()
    assert bkp_data["success"] is True
    assert "snapshots_created" in bkp_data


