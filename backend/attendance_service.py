import time
from datetime import datetime
from typing import Dict, Any, List, Optional

from config import (
    STATUS_PRESENT,
    STATUS_LEFT,
    STATUS_NOT_SCANNED,
    ACTION_ENTRY,
    ACTION_EXIT,
    ACTION_ALREADY_COMPLETED,
    SYSTEM_TIMEZONE,
    RAPID_SCAN_COOLDOWN_SECONDS,
    canonicalize_status
)
from excel_handler import ExcelHandler, canonical_key, normalize_rfid

class AttendanceService:
    """
    Core attendance engine with Asia/Kolkata timezone support,
    state-machine transitions (Present -> Left -> Completed),
    and rapid-scan debounce protection.
    """

    def __init__(self, excel_handler: ExcelHandler):
        self.excel = excel_handler
        self._latest_scan: Optional[Dict[str, Any]] = None
        self._last_scan_times: Dict[str, float] = {}  # canonical_key -> epoch timestamp

    def get_today_date_str(self) -> str:
        """Returns today's date formatted as YYYY-MM-DD in Asia/Kolkata timezone."""
        return datetime.now(SYSTEM_TIMEZONE).strftime("%Y-%m-%d")

    def get_current_time_str(self) -> str:
        """Returns the current formatted 12-hour time (e.g. '07:55 PM') in Asia/Kolkata."""
        return datetime.now(SYSTEM_TIMEZONE).strftime("%I:%M %p")

    def check_debounce(self, identifier: str) -> Optional[int]:
        """
        Checks if the card was scanned too quickly within the cooldown window.
        Returns remaining cooldown seconds if debounced, otherwise None.
        """
        key = canonical_key(identifier)
        now_ts = time.time()
        last_ts = self._last_scan_times.get(key)

        if last_ts is not None:
            elapsed = now_ts - last_ts
            if elapsed < RAPID_SCAN_COOLDOWN_SECONDS:
                remaining = int(RAPID_SCAN_COOLDOWN_SECONDS - elapsed)
                return max(1, remaining)

        self._last_scan_times[key] = now_ts
        return None

    def process_scan(self, identifier: str, source: str = "Hardware/Simulator") -> Dict[str, Any]:
        """
        Processes an RFID tap or USN scan.
        Transitions:
          - First scan today: Entry -> Present, In-Time recorded.
          - Second scan today: Exit -> Left, Out-Time recorded.
          - Subsequent scans: Inform attendance completed today without overwriting.
        """
        if not identifier or not str(identifier).strip():
            return {
                "success": False,
                "error": "Empty scan identifier received."
            }

        identifier_str = str(identifier).strip()
        current_time = self.get_current_time_str()
        today_str = self.get_today_date_str()

        # 1. Lookup member by RFID UID or USN
        member = self.excel.find_member_by_identifier(identifier_str)
        if not member:
            scan_info = {
                "success": False,
                "unknown_card": True,
                "action": "UNKNOWN",
                "message": f"Unknown RFID Card: '{identifier_str}'. No registered member found.",
                "identifier": identifier_str,
                "time": current_time,
                "status": "Unknown"
            }
            self._latest_scan = scan_info
            return scan_info

        # 2. Debounce check for rapid repeated scans
        cooldown_remaining = self.check_debounce(member["canonical_usn"])
        if cooldown_remaining is not None:
            return {
                "success": False,
                "cooldown": True,
                "action": "DEBOUNCE",
                "message": f"Card scanned too quickly. Please wait {cooldown_remaining}s before scanning again.",
                "name": member["name"],
                "usn": member["usn"],
                "time": current_time,
                "status": "Cooldown"
            }

        # 3. Read today's existing records
        records = self.excel.get_attendance_records(date_str=today_str)
        target_key = member["canonical_usn"]

        existing_record = None
        for r in records:
            if r["canonical_usn"] == target_key:
                existing_record = r
                break

        # Case 1: First scan today -> ENTRY (Present)
        if not existing_record or not existing_record.get("in_time"):
            updated = self.excel.save_or_update_attendance(
                date_str=today_str,
                member=member,
                in_time=current_time,
                out_time="",
                status=STATUS_PRESENT
            )

            scan_info = {
                "success": True,
                "action": ACTION_ENTRY,
                "name": member["name"],
                "department": member["department"],
                "branch": member["branch"],
                "usn": member["usn"],
                "rfid_uid": member.get("rfid_uid", ""),
                "time": current_time,
                "in_time": current_time,
                "out_time": "",
                "status": STATUS_PRESENT,
                "message": f"Welcome, {member['name']}! Entry marked at {current_time}."
            }
            self._latest_scan = scan_info
            return scan_info

        # Case 2: Second scan today -> EXIT (Left)
        if existing_record.get("in_time") and not existing_record.get("out_time"):
            updated = self.excel.save_or_update_attendance(
                date_str=today_str,
                member=member,
                in_time=existing_record["in_time"],
                out_time=current_time,
                status=STATUS_LEFT
            )

            scan_info = {
                "success": True,
                "action": ACTION_EXIT,
                "name": member["name"],
                "department": member["department"],
                "branch": member["branch"],
                "usn": member["usn"],
                "rfid_uid": member.get("rfid_uid", ""),
                "time": current_time,
                "in_time": existing_record["in_time"],
                "out_time": current_time,
                "status": STATUS_LEFT,
                "message": f"Goodbye, {member['name']}! Exit marked at {current_time}."
            }
            self._latest_scan = scan_info
            return scan_info

        # Case 3: Third or further scan today -> ALREADY COMPLETED (Preserve original in & out times)
        in_t = existing_record.get("in_time", "")
        out_t = existing_record.get("out_time", "")
        scan_info = {
            "success": False,
            "action": ACTION_ALREADY_COMPLETED,
            "message": f"Attendance already completed for today. In: {in_t}, Exit: {out_t}.",
            "name": member["name"],
            "department": member["department"],
            "branch": member["branch"],
            "usn": member["usn"],
            "rfid_uid": member.get("rfid_uid", ""),
            "time": current_time,
            "in_time": in_t,
            "out_time": out_t,
            "status": STATUS_LEFT
        }
        self._latest_scan = scan_info
        return scan_info

    def get_today_attendance_summary(self) -> List[Dict[str, Any]]:
        """
        Returns full roster for today with status:
        'Present', 'Left', or 'Not Marked'.
        """
        members = self.excel.get_all_members()
        today_str = self.get_today_date_str()
        records = self.excel.get_attendance_records(date_str=today_str)

        record_map = {r["canonical_usn"]: r for r in records}

        result = []
        for m in members:
            key = m["canonical_usn"]
            if key in record_map:
                r = record_map[key]
                result.append({
                    "date": today_str,
                    "name": m["name"],
                    "department": m["department"],
                    "branch": m["branch"],
                    "usn": m["usn"],
                    "rfid_uid": m.get("rfid_uid", ""),
                    "in_time": r.get("in_time", ""),
                    "out_time": r.get("out_time", ""),
                    "status": canonicalize_status(r.get("status")) or STATUS_NOT_SCANNED
                })
            else:
                result.append({
                    "date": today_str,
                    "name": m["name"],
                    "department": m["department"],
                    "branch": m["branch"],
                    "usn": m["usn"],
                    "rfid_uid": m.get("rfid_uid", ""),
                    "in_time": "",
                    "out_time": "",
                    "status": STATUS_NOT_SCANNED
                })

        return result

    def get_dashboard_data(self) -> Dict[str, Any]:
        """
        Aggregates live dashboard metrics from actual data:
        - Total Registered Members
        - Present Now
        - Members Left
        - Attendance Records Today
        - Department breakdown
        - Latest scan
        """
        today_list = self.get_today_attendance_summary()
        total_members = len(today_list)

        present_count = sum(1 for r in today_list if r["status"] == STATUS_PRESENT)
        left_count = sum(1 for r in today_list if r["status"] == STATUS_LEFT)
        not_scanned_count = sum(1 for r in today_list if r["status"] == STATUS_NOT_SCANNED)
        today_records_count = present_count + left_count

        # Department breakdown
        dept_summary: Dict[str, Dict[str, int]] = {}
        for r in today_list:
            dept = r["department"]
            if dept not in dept_summary:
                dept_summary[dept] = {"total": 0, "present": 0, "left": 0, "not_marked": 0}
            dept_summary[dept]["total"] += 1
            if r["status"] == STATUS_PRESENT:
                dept_summary[dept]["present"] += 1
            elif r["status"] == STATUS_LEFT:
                dept_summary[dept]["left"] += 1
            else:
                dept_summary[dept]["not_marked"] += 1

        # Fallback for latest_scan if none in session memory yet
        latest_scan = self._latest_scan
        if latest_scan is None:
            active_scans = [r for r in today_list if r["status"] in (STATUS_PRESENT, STATUS_LEFT)]
            if active_scans:
                last_rec = active_scans[-1]
                latest_scan = {
                    "name": last_rec["name"],
                    "department": last_rec["department"],
                    "branch": last_rec["branch"],
                    "usn": last_rec["usn"],
                    "time": last_rec["out_time"] if last_rec["status"] == STATUS_LEFT else last_rec["in_time"],
                    "action": ACTION_EXIT if last_rec["status"] == STATUS_LEFT else ACTION_ENTRY,
                    "status": last_rec["status"]
                }

        return {
            "date": self.get_today_date_str(),
            "current_time": self.get_current_time_str(),
            "total_members": total_members,
            "present_count": present_count,
            "left_count": left_count,
            "not_scanned_count": not_scanned_count,
            "today_records_count": today_records_count,
            "latest_scan": latest_scan,
            "dept_summary": dept_summary,
            "today_attendance": today_list
        }

    def get_comprehensive_reports(self,
                                  start_date: Optional[str] = None,
                                  end_date: Optional[str] = None,
                                  department: Optional[str] = None,
                                  branch: Optional[str] = None,
                                  status: Optional[str] = None,
                                  usn: Optional[str] = None) -> Dict[str, Any]:
        """
        Generates comprehensive attendance report across single date or date range.
        Includes department-wise breakdown, present/left stats, and individual logs.
        """
        today = self.get_today_date_str()
        if not start_date:
            start_date = today
        if not end_date:
            end_date = start_date

        records = self.excel.get_attendance_records(start_date=start_date, end_date=end_date)
        all_members = self.excel.get_all_members()

        # If report date is single date and that date is today, merge with full roster
        if start_date == end_date and start_date == today:
            records = self.get_today_attendance_summary()

        filtered = []
        dept_filter = department.strip().upper() if department and department != "ALL" else ""
        branch_filter = branch.strip().lower() if branch and branch != "ALL" else ""
        stat_filter = canonicalize_status(status) if status and status != "ALL" else ""
        usn_filter = canonical_key(usn) if usn else ""

        for r in records:
            if dept_filter and r.get("department", "").upper() != dept_filter:
                continue
            if branch_filter and r.get("branch", "").lower() != branch_filter:
                continue
            if stat_filter and r.get("status") != stat_filter:
                continue
            if usn_filter and canonical_key(r.get("usn")) != usn_filter:
                continue
            filtered.append(r)


        present_total = sum(1 for r in filtered if r.get("status") == STATUS_PRESENT)
        left_total = sum(1 for r in filtered if r.get("status") == STATUS_LEFT)
        not_marked_total = sum(1 for r in filtered if r.get("status") == STATUS_NOT_SCANNED)

        # Department breakdown
        dept_stats: Dict[str, Dict[str, int]] = {}
        for r in filtered:
            d = r.get("department", "General")
            if d not in dept_stats:
                dept_stats[d] = {"total": 0, "present": 0, "left": 0, "not_marked": 0}
            dept_stats[d]["total"] += 1
            if r.get("status") == STATUS_PRESENT:
                dept_stats[d]["present"] += 1
            elif r.get("status") == STATUS_LEFT:
                dept_stats[d]["left"] += 1
            else:
                dept_stats[d]["not_marked"] += 1

        return {
            "start_date": start_date,
            "end_date": end_date,
            "total_records": len(filtered),
            "present_count": present_total,
            "left_count": left_total,
            "not_marked_count": not_marked_total,
            "department_breakdown": dept_stats,
            "records": filtered
        }
