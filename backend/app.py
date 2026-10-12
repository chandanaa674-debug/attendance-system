import io
import os
import shutil
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import pandas as pd
from werkzeug.utils import secure_filename

from config import (
    FRONTEND_DIR,
    SERVER_HOST,
    SERVER_PORT,
    DEBUG_MODE,
    TIMEZONE_NAME,
    MEMBERS_EXCEL_PATH,
    ATTENDANCE_EXCEL_PATH,
    BACKUPS_DIR,
    SYSTEM_TIMEZONE,
    DATA_DIR,
    ENTRY_EXIT_MODE,
    RAPID_SCAN_COOLDOWN_SECONDS,
    RFID_API_SECRET
)
from excel_handler import ExcelHandler
from attendance_service import AttendanceService
from auth import (
    verify_admin_credentials,
    create_admin_token,
    decode_admin_token,
    extract_bearer_token,
    admin_required,
    hardware_or_admin_required
)

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
CORS(app)  # Enable Cross-Origin Resource Sharing for decoupled clients

excel_handler = ExcelHandler()
attendance_service = AttendanceService(excel_handler)


# -------------------------------------------------------------
# Frontend Page Routes (Direct serving from Flask)
# -------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.route("/login")
@app.route("/login.html")
def login_page():
    return send_from_directory(FRONTEND_DIR, "login.html")


@app.route("/members")
@app.route("/members.html")
def members_page():
    return send_from_directory(FRONTEND_DIR, "members.html")


@app.route("/attendance")
@app.route("/attendance.html")
def attendance_page():
    return send_from_directory(FRONTEND_DIR, "attendance.html")


@app.route("/history")
@app.route("/history.html")
@app.route("/reports")
@app.route("/reports.html")
def history_page():
    # Serve reports.html if exists, otherwise history.html
    reports_target = FRONTEND_DIR / "reports.html"
    if reports_target.exists():
        return send_from_directory(FRONTEND_DIR, "reports.html")
    return send_from_directory(FRONTEND_DIR, "history.html")


@app.route("/settings")
@app.route("/settings.html")
def settings_page():
    return send_from_directory(FRONTEND_DIR, "settings.html")


@app.route("/<path:path>")
def static_proxy(path):
    target = FRONTEND_DIR / path
    if target.exists() and target.is_file():
        return send_from_directory(FRONTEND_DIR, path)
    return jsonify({"error": "Resource not found"}), 404


# -------------------------------------------------------------
# System Health & Status Endpoints
# -------------------------------------------------------------
@app.route("/api/health", methods=["GET"])
def health_check():
    """System diagnostic and health check."""
    members_exist = MEMBERS_EXCEL_PATH.exists()
    att_exist = ATTENDANCE_EXCEL_PATH.exists()

    member_count = 0
    if members_exist:
        try:
            member_count = len(excel_handler.get_all_members())
        except Exception:
            member_count = -1

    backup_count = len(list(BACKUPS_DIR.glob("*.xlsx"))) if BACKUPS_DIR.exists() else 0

    return jsonify({
        "status": "healthy" if members_exist else "degraded",
        "system": "TechBots-SIT RFID Attendance Management System",
        "institution": "Srinivas Institute of Technology, Valachil, Mangaluru",
        "timezone": TIMEZONE_NAME,
        "current_time": attendance_service.get_current_time_str(),
        "today": attendance_service.get_today_date_str(),
        "registered_members": member_count,
        "master_excel_accessible": members_exist,
        "attendance_excel_accessible": att_exist,
        "backups_stored": backup_count
    }), 200


# -------------------------------------------------------------
# System Settings & Configuration Endpoints
# -------------------------------------------------------------
@app.route("/api/settings", methods=["GET"])
def get_settings():
    """Retrieve current system configuration, storage details, and attendance rules."""
    members_count = len(excel_handler.get_all_members()) if MEMBERS_EXCEL_PATH.exists() else 0
    backups_count = len(list(BACKUPS_DIR.glob("*.xlsx"))) if BACKUPS_DIR.exists() else 0

    return jsonify({
        "success": True,
        "institution": {
            "college_name": "Srinivas Institute of Technology",
            "college_location": "Valachil, Mangaluru, Karnataka, India",
            "club_name": "TechBots Club",
            "system_name": "RFID Attendance Management System"
        },
        "attendance_rules": {
            "timezone": TIMEZONE_NAME,
            "entry_exit_mode": ENTRY_EXIT_MODE,
            "rapid_scan_cooldown_seconds": RAPID_SCAN_COOLDOWN_SECONDS,
            "rule_description": "First scan = In-Time & Present; Second scan = Exit-Time & Left; Subsequent = Session Finished."
        },
        "storage": {
            "members_excel_file": str(MEMBERS_EXCEL_PATH.name),
            "attendance_excel_file": str(ATTENDANCE_EXCEL_PATH.name),
            "total_registered_members": members_count,
            "total_backup_snapshots": backups_count,
            "data_directory": str(DATA_DIR)
        },
        "hardware_integration": {
            "rfid_endpoint": "/api/attendance/scan",
            "auth_header": "X-API-Key",
            "api_key_configured": bool(RFID_API_SECRET),
            "baud_rate": 115200,
            "reader_type": "RC522 / PN532 RFID + ESP32 NodeMCU"
        },
        "server_status": {
            "status": "online",
            "current_time": attendance_service.get_current_time_str(),
            "today_date": attendance_service.get_today_date_str()
        }
    }), 200


@app.route("/api/settings", methods=["PUT"])
@admin_required
def update_settings():
    """Update configurable settings (admin protected)."""
    global RAPID_SCAN_COOLDOWN_SECONDS, ENTRY_EXIT_MODE
    payload = request.get_json(silent=True) or {}

    if "rapid_scan_cooldown_seconds" in payload:
        try:
            val = int(payload["rapid_scan_cooldown_seconds"])
            if 0 <= val <= 300:
                RAPID_SCAN_COOLDOWN_SECONDS = val
            else:
                return jsonify({"success": False, "error": "Cooldown seconds must be between 0 and 300."}), 400
        except (ValueError, TypeError):
            return jsonify({"success": False, "error": "Invalid cooldown value."}), 400

    if "entry_exit_mode" in payload:
        mode = str(payload["entry_exit_mode"]).strip()
        if mode in ("strict_single_session", "multi_scan"):
            ENTRY_EXIT_MODE = mode
        else:
            return jsonify({"success": False, "error": "Unsupported entry_exit_mode."}), 400

    return jsonify({
        "success": True,
        "message": "Settings updated successfully.",
        "settings": {
            "entry_exit_mode": ENTRY_EXIT_MODE,
            "rapid_scan_cooldown_seconds": RAPID_SCAN_COOLDOWN_SECONDS
        }
    }), 200


@app.route("/api/settings/backup_now", methods=["POST"])
@admin_required
def trigger_backup_now():
    """Create an immediate timestamped backup snapshot of both master workbooks."""
    try:
        from datetime import datetime
        now_tag = datetime.now(SYSTEM_TIMEZONE).strftime("%Y%m%d_%H%M%S")
        m_backup = BACKUPS_DIR / f"club_members_manual_{now_tag}.xlsx"
        a_backup = BACKUPS_DIR / f"attendance_records_manual_{now_tag}.xlsx"

        created_files = []
        if MEMBERS_EXCEL_PATH.exists():
            shutil.copy2(MEMBERS_EXCEL_PATH, m_backup)
            created_files.append(m_backup.name)
        if ATTENDANCE_EXCEL_PATH.exists():
            shutil.copy2(ATTENDANCE_EXCEL_PATH, a_backup)
            created_files.append(a_backup.name)

        total_backups = len(list(BACKUPS_DIR.glob("*.xlsx")))

        return jsonify({
            "success": True,
            "message": "Manual backup snapshot created successfully.",
            "snapshots_created": created_files,
            "total_backup_snapshots": total_backups,
            "timestamp": now_tag
        }), 200
    except Exception as e:
        return jsonify({"success": False, "error": f"Backup snapshot failed: {str(e)}"}), 500


# -------------------------------------------------------------
# Admin Authentication Endpoints
# -------------------------------------------------------------
@app.route("/api/auth/login", methods=["POST"])
def admin_login():
    """Authenticates administrator and returns signed JWT session token."""
    payload = request.get_json(silent=True) or request.form
    username = payload.get("username", "").strip()
    password = payload.get("password", "").strip()

    if not username or not password:
        return jsonify({
            "success": False,
            "error": "Both username and password are required."
        }), 400

    if not verify_admin_credentials(username, password):
        return jsonify({
            "success": False,
            "error": "Invalid administrator username or password."
        }), 401

    token = create_admin_token(username)
    return jsonify({
        "success": True,
        "message": "Login successful.",
        "token": token,
        "admin": {
            "username": username,
            "role": "admin"
        }
    }), 200


@app.route("/api/auth/me", methods=["GET"])
def admin_me():
    """Checks current admin authentication status."""
    token = extract_bearer_token()
    if not token:
        return jsonify({"authenticated": False}), 200

    payload = decode_admin_token(token)
    if not payload or payload.get("role") != "admin":
        return jsonify({"authenticated": False}), 200

    return jsonify({
        "authenticated": True,
        "admin": {
            "username": payload.get("sub"),
            "role": "admin"
        }
    }), 200


@app.route("/api/auth/logout", methods=["POST"])
def admin_logout():
    """Terminates admin session."""
    return jsonify({"success": True, "message": "Logged out successfully."}), 200


# -------------------------------------------------------------
# Dashboard & Live Attendance Endpoints
# -------------------------------------------------------------
@app.route("/api/dashboard", methods=["GET"])
def get_dashboard():
    """Returns aggregated counters, latest scan details, and today's roster."""
    try:
        data = attendance_service.get_dashboard_data()
        return jsonify({
            "success": True,
            **data
        }), 200
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to retrieve dashboard: {str(e)}"}), 500


@app.route("/api/attendance/today", methods=["GET"])
def get_today_attendance():
    """Returns today's attendance for all club members with status badges."""
    try:
        records = attendance_service.get_today_attendance_summary()
        return jsonify({
            "success": True,
            "date": attendance_service.get_today_date_str(),
            "total_records": len(records),
            "records": records
        }), 200
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to fetch today's attendance: {str(e)}"}), 500


@app.route("/api/attendance/history", methods=["GET"])
def get_attendance_history():
    """Returns attendance records for a requested date or date range."""
    try:
        date_param = request.args.get("date")
        start_date = request.args.get("start_date") or date_param
        end_date = request.args.get("end_date") or date_param
        department = request.args.get("department")
        branch = request.args.get("branch")
        status = request.args.get("status")

        report_data = attendance_service.get_comprehensive_reports(
            start_date=start_date,
            end_date=end_date,
            department=department,
            branch=branch,
            status=status
        )
        return jsonify({
            "success": True,
            **report_data
        }), 200
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to fetch attendance history: {str(e)}"}), 500


# -------------------------------------------------------------
# RFID Card Tap Scan Endpoint (ESP32 Hardware & Simulator)
# -------------------------------------------------------------
@app.route("/api/attendance/scan", methods=["GET", "POST"])
@app.route("/api/rfid/scan", methods=["GET", "POST"])  # Backward compatibility with senior's route
@hardware_or_admin_required
def scan_rfid():
    """
    RFID Scan Endpoint (Hardware ready for ESP32 + Web Simulator).
    Expects JSON or form/query: { "identifier": "RFID_UID_OR_USN", "device_id": "optional" }
    """
    try:
        payload = (
            request.get_json(silent=True) or
            (request.form.to_dict() if request.form else None) or
            (request.args.to_dict() if request.args else {})
        )
        identifier = (
            payload.get("identifier") or
            payload.get("rfid_uid") or
            payload.get("card_uid") or
            payload.get("uid") or
            payload.get("usn") or
            payload.get("rfid")
        )

        if not identifier:
            return jsonify({
                "success": False,
                "error": "Missing scan identifier. Provide 'identifier' or 'rfid_uid' in request body/parameters."
            }), 400

        result = attendance_service.process_scan(str(identifier).strip())

        # Determine HTTP status code
        if result.get("unknown_card"):
            return jsonify(result), 404
        if result.get("cooldown"):
            return jsonify(result), 429

        return jsonify(result), 200

    except Exception as e:
        return jsonify({
            "success": False,
            "error": f"Server error processing scan: {str(e)}"
        }), 500



# -------------------------------------------------------------
# Member Management Endpoints
# -------------------------------------------------------------
@app.route("/api/members", methods=["GET"])
def get_members():
    """Returns all registered club members loaded from the Excel file."""
    try:
        members = excel_handler.get_all_members()
        query = request.args.get("q", "").strip().lower()
        dept = request.args.get("department", "").strip().upper()

        filtered = []
        for m in members:
            if dept and dept != "ALL" and m["department"].upper() != dept:
                continue
            if query:
                match = (query in m["name"].lower() or
                         query in m["usn"].lower() or
                         query in m["department"].lower() or
                         query in m["branch"].lower() or
                         query in m.get("rfid_uid", "").lower())
                if not match:
                    continue
            filtered.append(m)

        return jsonify({
            "success": True,
            "total_members": len(filtered),
            "members": filtered
        }), 200
    except FileNotFoundError as fnf:
        return jsonify({"success": False, "error": f"Master Excel file not found: {str(fnf)}"}), 404
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to fetch members: {str(e)}"}), 500


@app.route("/api/members", methods=["POST"])
@admin_required
def add_member():
    """(Admin) Registers a new member."""
    payload = request.get_json(silent=True) or request.form
    success, msg, member = excel_handler.add_member(payload)
    if not success:
        return jsonify({"success": False, "error": msg}), 400

    return jsonify({
        "success": True,
        "message": msg,
        "member": member
    }), 201


@app.route("/api/members/<usn>", methods=["GET"])
def get_member(usn):
    """Fetches details for a specific member by USN."""
    member = excel_handler.find_member_by_usn(usn)
    if not member:
        return jsonify({"success": False, "error": f"Member with USN '{usn}' not found."}), 404
    return jsonify({"success": True, "member": member}), 200


@app.route("/api/members/<usn>", methods=["PUT"])
@admin_required
def update_member(usn):
    """(Admin) Updates member info or assigns/updates RFID UID."""
    payload = request.get_json(silent=True) or request.form
    success, msg, member = excel_handler.update_member(usn, payload)
    if not success:
        return jsonify({"success": False, "error": msg}), 400

    return jsonify({
        "success": True,
        "message": msg,
        "member": member
    }), 200


@app.route("/api/members/<usn>", methods=["DELETE"])
@admin_required
def delete_member(usn):
    """(Admin) Removes a member from the master roster safely."""
    success, msg = excel_handler.delete_member(usn)
    if not success:
        return jsonify({"success": False, "error": msg}), 400
    return jsonify({"success": True, "message": msg}), 200


@app.route("/api/members/duplicates", methods=["GET"])
@admin_required
def check_duplicates():
    """(Admin) Identifies duplicate USNs or RFID UIDs in the database."""
    dups = excel_handler.detect_duplicates()
    return jsonify({
        "success": True,
        **dups
    }), 200


@app.route("/api/members/import", methods=["POST"])
@admin_required
def import_members():
    """(Admin) Uploads and imports an Excel file with member records."""
    if "file" not in request.files:
        return jsonify({"success": False, "error": "No file uploaded. Key 'file' is required."}), 400

    file = request.files["file"]
    if not file.filename or not file.filename.endswith((".xlsx", ".xls")):
        return jsonify({"success": False, "error": "Invalid file format. Upload an Excel (.xlsx) file."}), 400

    temp_path = BACKUPS_DIR / f"upload_temp_{secure_filename(file.filename)}"
    try:
        file.save(temp_path)
        result = excel_handler.import_members_from_file(temp_path)
        return jsonify(result), 200 if result.get("success") else 400
    finally:
        if temp_path.exists():
            temp_path.unlink()


@app.route("/api/members/backup", methods=["GET"])
@admin_required
def download_backup():
    """(Admin) Downloads a timestamped backup of the master members Excel workbook."""
    backup_file = excel_handler.create_timestamped_backup("manual_download")
    if not backup_file or not backup_file.exists():
        backup_file = MEMBERS_EXCEL_PATH

    return send_file(
        backup_file,
        as_attachment=True,
        download_name=f"TechBots_Members_Backup_{attendance_service.get_today_date_str()}.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    )


# -------------------------------------------------------------
# Reports & Export Endpoints
# -------------------------------------------------------------
@app.route("/api/reports/attendance", methods=["GET"])
def get_reports():
    """Multi-dimensional report (date range, member history, department summary, branch)."""
    try:
        start_date = request.args.get("start_date")
        end_date = request.args.get("end_date")
        department = request.args.get("department")
        branch = request.args.get("branch")
        status = request.args.get("status")
        usn = request.args.get("usn")

        reports = attendance_service.get_comprehensive_reports(
            start_date=start_date,
            end_date=end_date,
            department=department,
            branch=branch,
            status=status,
            usn=usn
        )
        return jsonify({"success": True, **reports}), 200
    except Exception as e:
        return jsonify({"success": False, "error": f"Report error: {str(e)}"}), 500


@app.route("/api/attendance/export", methods=["GET"])
def export_attendance():
    """Exports filtered attendance records as Excel (.xlsx) or CSV."""
    try:
        fmt = request.args.get("format", "xlsx").lower()
        date_param = request.args.get("date")
        start_date = request.args.get("start_date") or date_param
        end_date = request.args.get("end_date") or date_param
        department = request.args.get("department")
        branch = request.args.get("branch")
        status = request.args.get("status")
        search_q = request.args.get("q")

        # Include today's full roster summary if exporting today
        today_summary = attendance_service.get_today_attendance_summary()

        df = excel_handler.export_filtered_dataframe(
            date_str=date_param,
            start_date=start_date,
            end_date=end_date,
            department=department,
            branch=branch,
            status=status,
            search_query=search_q,
            today_summary_fallback=today_summary
        )

        output = io.BytesIO()
        filename_prefix = f"TechBots_Attendance_{start_date if start_date else (date_param if date_param else 'all')}"

        if fmt == "csv":
            df.to_csv(output, index=False)
            output.seek(0)
            return send_file(
                output,
                as_attachment=True,
                download_name=f"{filename_prefix}.csv",
                mimetype="text/csv"
            )
        else:
            with pd.ExcelWriter(output, engine="openpyxl") as writer:
                df.to_excel(writer, sheet_name="Attendance_Records", index=False)
            output.seek(0)
            return send_file(
                output,
                as_attachment=True,
                download_name=f"{filename_prefix}.xlsx",
                mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            )

    except Exception as e:
        return jsonify({"success": False, "error": f"Export failed: {str(e)}"}), 500



# -------------------------------------------------------------
# Error Handlers
# -------------------------------------------------------------
@app.errorhandler(404)
def handle_404(e):
    if request.path.startswith("/api/"):
        return jsonify({"success": False, "error": f"API endpoint '{request.path}' not found"}), 404
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.errorhandler(500)
def handle_500(e):
    return jsonify({"success": False, "error": "Internal server error"}), 500


if __name__ == "__main__":
    print(f"==================================================")
    print(f"  TechBots-SIT RFID Attendance Management System")
    print(f"  Srinivas Institute of Technology, Valachil, Mangaluru")
    print(f"  Timezone: {TIMEZONE_NAME} | Port: {SERVER_PORT}")
    print(f"  Local URL:   http://localhost:{SERVER_PORT}")
    print(f"  Network URL: http://{SERVER_HOST}:{SERVER_PORT}")
    print(f"==================================================")
    app.run(host=SERVER_HOST, port=SERVER_PORT, debug=DEBUG_MODE)
