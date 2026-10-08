from datetime import datetime
from typing import Dict, List, Optional, Any
from excel_handler import ExcelHandler, usn_match_key
from config import (
    STATUS_PRESENT,
    STATUS_EXITED,
    STATUS_NOT_SCANNED,
    ACTION_ENTRY,
    ACTION_EXIT
)


class AttendanceService:
    def __init__(self, excel_handler: Optional[ExcelHandler] = None):
        self.excel = excel_handler or ExcelHandler()
        self._latest_scan: Optional[Dict[str, Any]] = None

    @staticmethod
    def get_today_date_str() -> str:
        """Returns current date in YYYY-MM-DD format."""
        return datetime.now().strftime("%Y-%m-%d")

    @staticmethod
    def get_current_time_str() -> str:
        """Returns current time in 12-hour format e.g. '09:15 AM'."""
        return datetime.now().strftime("%I:%M %p")

    def process_scan(self, identifier: str) -> Dict[str, Any]:
        """
        Processes an RFID scan using the member's identifier (USN for demo).
        Handles ENTRY, EXIT, or already completed attendance.
        """
        if not identifier or not str(identifier).strip():
            return {
                "success": False,
                "message": "Invalid scan identifier. Identifier cannot be empty."
            }

        clean_id = str(identifier).strip()
        member = self.excel.find_member_by_usn(clean_id)

        if not member:
            return {
                "success": False,
                "message": "Unknown / Unregistered Member"
            }

        today_str = self.get_today_date_str()
        current_time = self.get_current_time_str()

        # Check existing attendance records for today
        records = self.excel.get_attendance_records(date_str=today_str)
        target_key = member["canonical_usn"]

        existing_record = None
        for r in records:
            if r["canonical_usn"] == target_key:
                existing_record = r
                break

        # Case 1: First scan today -> ENTRY
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
                "usn": member["usn"],
                "time": current_time,
                "status": STATUS_PRESENT,
                "message": f"Welcome, {member['name']}! Entry recorded."
            }
            self._latest_scan = scan_info
            return scan_info

        # Case 2: Second scan today -> EXIT (In Time exists, Out Time is empty)
        if existing_record.get("in_time") and not existing_record.get("out_time"):
            updated = self.excel.save_or_update_attendance(
                date_str=today_str,
                member=member,
                in_time=existing_record["in_time"],
                out_time=current_time,
                status=STATUS_EXITED
            )

            scan_info = {
                "success": True,
                "action": ACTION_EXIT,
                "name": member["name"],
                "department": member["department"],
                "usn": member["usn"],
                "time": current_time,
                "status": STATUS_EXITED,
                "message": f"Goodbye, {member['name']}! Exit recorded."
            }
            self._latest_scan = scan_info
            return scan_info

        # Case 3: Third scan today -> Already completed
        scan_info = {
            "success": False,
            "action": "COMPLETED",
            "message": "Attendance already completed for today.",
            "name": member["name"],
            "department": member["department"],
            "usn": member["usn"],
            "time": current_time,
            "status": STATUS_EXITED
        }
        return scan_info

    def get_today_attendance_summary(self) -> List[Dict[str, Any]]:
        """
        Returns attendance list for today for all registered members.
        Members not scanned yet are marked as 'NOT SCANNED'.
        """
        members = self.excel.get_all_members()
        today_str = self.get_today_date_str()
        records = self.excel.get_attendance_records(date_str=today_str)

        # Map by canonical USN
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
                    "usn": m["usn"],
                    "in_time": r.get("in_time", ""),
                    "out_time": r.get("out_time", ""),
                    "status": r.get("status") or STATUS_NOT_SCANNED
                })
            else:
                result.append({
                    "date": today_str,
                    "name": m["name"],
                    "department": m["department"],
                    "usn": m["usn"],
                    "in_time": "",
                    "out_time": "",
                    "status": STATUS_NOT_SCANNED
                })

        return result

    def get_attendance_history(self, date_str: str) -> Dict[str, Any]:
        """
        Returns attendance records for a specific date (YYYY-MM-DD).
        """
        if not date_str:
            date_str = self.get_today_date_str()

        # If date is today, return full roster with statuses
        if date_str == self.get_today_date_str():
            records = self.get_today_attendance_summary()
        else:
            # For historical dates, return recorded entries merged with members if desired
            hist_records = self.excel.get_attendance_records(date_str=date_str)
            record_map = {r["canonical_usn"]: r for r in hist_records}
            members = self.excel.get_all_members()

            records = []
            for m in members:
                key = m["canonical_usn"]
                if key in record_map:
                    r = record_map[key]
                    records.append({
                        "date": date_str,
                        "name": m["name"],
                        "department": m["department"],
                        "usn": m["usn"],
                        "in_time": r.get("in_time", ""),
                        "out_time": r.get("out_time", ""),
                        "status": r.get("status") or STATUS_NOT_SCANNED
                    })
                else:
                    records.append({
                        "date": date_str,
                        "name": m["name"],
                        "department": m["department"],
                        "usn": m["usn"],
                        "in_time": "",
                        "out_time": "",
                        "status": STATUS_NOT_SCANNED
                    })

        present_count = sum(1 for r in records if r["status"] == STATUS_PRESENT)
        exited_count = sum(1 for r in records if r["status"] == STATUS_EXITED)
        not_scanned_count = sum(1 for r in records if r["status"] == STATUS_NOT_SCANNED)

        return {
            "date": date_str,
            "total_members": len(records),
            "present_count": present_count,
            "exited_count": exited_count,
            "not_scanned_count": not_scanned_count,
            "records": records
        }

    def get_dashboard_data(self) -> Dict[str, Any]:
        """
        Calculates dynamic dashboard stats:
        - total_members
        - present_count
        - exited_count
        - not_scanned_count
        - latest_scan
        - today_attendance
        """
        today_list = self.get_today_attendance_summary()

        total_members = len(today_list)
        present_count = sum(1 for r in today_list if r["status"] == STATUS_PRESENT)
        exited_count = sum(1 for r in today_list if r["status"] == STATUS_EXITED)
        not_scanned_count = sum(1 for r in today_list if r["status"] == STATUS_NOT_SCANNED)

        # If _latest_scan is None, check if there's any completed or present record today
        latest_scan = self._latest_scan
        if latest_scan is None:
            # Find the most recently active record if any
            active_scans = [r for r in today_list if r["status"] in (STATUS_PRESENT, STATUS_EXITED)]
            if active_scans:
                last_rec = active_scans[-1]
                time_val = last_rec["out_time"] if last_rec["status"] == STATUS_EXITED else last_rec["in_time"]
                action_val = ACTION_EXIT if last_rec["status"] == STATUS_EXITED else ACTION_ENTRY
                latest_scan = {
                    "name": last_rec["name"],
                    "department": last_rec["department"],
                    "usn": last_rec["usn"],
                    "time": time_val,
                    "action": action_val,
                    "status": last_rec["status"]
                }

        return {
            "date": self.get_today_date_str(),
            "total_members": total_members,
            "present_count": present_count,
            "exited_count": exited_count,
            "not_scanned_count": not_scanned_count,
            "latest_scan": latest_scan,
            "today_attendance": today_list
        }
