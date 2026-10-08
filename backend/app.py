import io
from pathlib import Path
from flask import Flask, request, jsonify, send_from_directory, send_file
from flask_cors import CORS
import pandas as pd

from config import (
    FRONTEND_DIR,
    SERVER_HOST,
    SERVER_PORT,
    DEBUG_MODE
)
from excel_handler import ExcelHandler
from attendance_service import AttendanceService

app = Flask(__name__, static_folder=str(FRONTEND_DIR), static_url_path="")
CORS(app)  # Enable Cross-Origin Resource Sharing for modern decoupled frontends

excel_handler = ExcelHandler()
attendance_service = AttendanceService(excel_handler)


# -------------------------------------------------------------
# Frontend Page Routes (Direct serving from Flask)
# -------------------------------------------------------------
@app.route("/")
def index():
    return send_from_directory(FRONTEND_DIR, "index.html")


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
def history_page():
    return send_from_directory(FRONTEND_DIR, "history.html")


@app.route("/<path:path>")
def static_proxy(path):
    target = FRONTEND_DIR / path
    if target.exists():
        return send_from_directory(FRONTEND_DIR, path)
    return jsonify({"error": "Resource not found"}), 404


# -------------------------------------------------------------
# REST API Endpoints
# -------------------------------------------------------------
@app.route("/api/dashboard", methods=["GET"])
def get_dashboard():
    """Returns aggregated metrics, latest scan, and today's attendance roster."""
    try:
        data = attendance_service.get_dashboard_data()
        return jsonify(data), 200
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to retrieve dashboard data: {str(e)}"}), 500


@app.route("/api/members", methods=["GET"])
def get_members():
    """Returns all registered club members loaded from the Excel file."""
    try:
        members = excel_handler.get_all_members()
        # Return public-facing fields
        clean_list = [
            {
                "name": m["name"],
                "department": m["department"],
                "usn": m["usn"]
            }
            for m in members
        ]
        return jsonify({
            "success": True,
            "total_members": len(clean_list),
            "members": clean_list
        }), 200
    except FileNotFoundError as fnf:
        return jsonify({"success": False, "error": f"Excel file not found: {str(fnf)}"}), 404
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to fetch members: {str(e)}"}), 500


@app.route("/api/member/<usn>", methods=["GET"])
def get_member_by_usn(usn):
    """Fetches details for a specific member by USN."""
    try:
        member = excel_handler.find_member_by_usn(usn)
        if not member:
            return jsonify({"success": False, "message": "Unknown / Unregistered Member"}), 404
        return jsonify({
            "success": True,
            "member": {
                "name": member["name"],
                "department": member["department"],
                "usn": member["usn"]
            }
        }), 200
    except Exception as e:
        return jsonify({"success": False, "error": str(e)}), 500


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
    """Returns attendance records for a requested date (default: today)."""
    try:
        date_param = request.args.get("date")
        if not date_param:
            date_param = attendance_service.get_today_date_str()

        # Basic format check
        try:
            pd.to_datetime(date_param)
        except Exception:
            return jsonify({"success": False, "error": "Invalid date format. Expected YYYY-MM-DD"}), 400

        data = attendance_service.get_attendance_history(date_param)
        return jsonify({
            "success": True,
            **data
        }), 200
    except Exception as e:
        return jsonify({"success": False, "error": f"Failed to fetch attendance history: {str(e)}"}), 500


@app.route("/api/rfid/scan", methods=["POST"])
def scan_rfid():
    """
    Simulated RFID Scan Endpoint (Hardware ready for ESP32).
    Expects JSON: { "identifier": "USN_OR_RFID_UID" }
    """
    try:
        payload = request.get_json(silent=True)
        if not payload:
            # Fallback to form data if sent from simple form
            payload = request.form

        identifier = payload.get("identifier") or payload.get("usn") or payload.get("uid")

        if not identifier:
            return jsonify({
                "success": False,
                "message": "Missing scan identifier. Provide 'identifier' in JSON body."
            }), 400

        result = attendance_service.process_scan(str(identifier))
        status_code = 200 if result.get("success") else 400

        # If unknown member, return 404
        if "Unknown" in result.get("message", ""):
            status_code = 404

        return jsonify(result), status_code

    except Exception as e:
        return jsonify({
            "success": False,
            "message": f"Server error processing scan: {str(e)}"
        }), 500


@app.route("/api/attendance/export", methods=["GET"])
def export_attendance():
    """Exports attendance records as an Excel file for download."""
    try:
        date_param = request.args.get("date")
        df = excel_handler.export_attendance_df(date_param)

        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, sheet_name='Attendance', index=False)
        output.seek(0)

        filename = f"attendance_{date_param if date_param else 'all'}.xlsx"
        return send_file(
            output,
            as_attachment=True,
            download_name=filename,
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
        return jsonify({"success": False, "error": "API route not found"}), 404
    return send_from_directory(FRONTEND_DIR, "index.html")


@app.errorhandler(500)
def handle_500(e):
    return jsonify({"success": False, "error": "Internal server error"}), 500


if __name__ == "__main__":
    print(f"==================================================")
    print(f"  Club RFID Attendance Management System Demo")
    print(f"  Running on: http://localhost:{SERVER_PORT}")
    print(f"  Network accessible at: http://{SERVER_HOST}:{SERVER_PORT}")
    print(f"==================================================")
    app.run(host=SERVER_HOST, port=SERVER_PORT, debug=DEBUG_MODE)
