import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Any
import pandas as pd
import openpyxl

from config import (
    MEMBERS_EXCEL_PATH,
    BACKUP_EXCEL_PATH,
    ATTENDANCE_EXCEL_PATH,
    EXCEL_COLUMNS,
    SYNC_TO_MASTER_EXCEL,
    STATUS_NOT_SCANNED
)


def normalize_string(val: Any) -> str:
    """Safely converts value to string and strips leading/trailing whitespace."""
    if val is None or pd.isna(val):
        return ""
    return str(val).strip()


def normalize_usn(usn: Any) -> str:
    """
    Normalizes USN for robust matching.
    Trims whitespace and converts to uppercase.
    Also handles internal space variations (e.g., '4SN24 EC006' vs '4SN24EC006').
    """
    cleaned = normalize_string(usn).upper()
    return cleaned


def usn_match_key(usn: Any) -> str:
    """Returns canonical USN key without spaces for flexible comparison."""
    return "".join(normalize_usn(usn).split())


class ExcelHandler:
    def __init__(self, members_path: Path = MEMBERS_EXCEL_PATH,
                 attendance_path: Path = ATTENDANCE_EXCEL_PATH,
                 backup_path: Path = BACKUP_EXCEL_PATH):
        self.members_path = Path(members_path)
        self.attendance_path = Path(attendance_path)
        self.backup_path = Path(backup_path)

        # Ensure data folder exists
        self.members_path.parent.mkdir(parents=True, exist_ok=True)
        self._ensure_backup()
        self._ensure_attendance_workbook()

    def _ensure_backup(self):
        """Creates a backup copy of the master members excel if not already present."""
        if self.members_path.exists() and not self.backup_path.exists():
            try:
                shutil.copy2(self.members_path, self.backup_path)
                print(f"[ExcelHandler] Safe backup created at: {self.backup_path}")
            except Exception as e:
                print(f"[ExcelHandler] Warning creating backup: {e}")

    def _ensure_attendance_workbook(self):
        """Initializes the attendance records workbook if it does not exist."""
        if not self.attendance_path.exists():
            try:
                df = pd.DataFrame(columns=EXCEL_COLUMNS)
                with pd.ExcelWriter(self.attendance_path, engine='openpyxl') as writer:
                    df.to_excel(writer, sheet_name='Sheet1', index=False)
                print(f"[ExcelHandler] Initialized attendance workbook at: {self.attendance_path}")
            except Exception as e:
                print(f"[ExcelHandler] Error initializing attendance workbook: {e}")

    def get_all_members(self) -> List[Dict[str, str]]:
        """
        Reads club members from the master Excel file.
        Cleans whitespace, filters empty rows, and returns a list of member dicts.
        """
        if not self.members_path.exists():
            raise FileNotFoundError(f"Master Excel file not found at: {self.members_path}")

        try:
            df = pd.read_excel(self.members_path, sheet_name=0, dtype=str)
            df = df.astype(object).fillna("")
        except Exception as e:
            raise RuntimeError(f"Failed to read master Excel file: {e}")

        # Validate columns
        required_cols = ["Name", "Department", "USN"]
        for col in required_cols:
            if col not in df.columns:
                raise ValueError(f"Missing required column '{col}' in Excel file: {self.members_path.name}")

        members = []
        for _, row in df.iterrows():
            name = normalize_string(row.get("Name"))
            dept = normalize_string(row.get("Department"))
            usn = normalize_string(row.get("USN"))

            # Skip header or blank rows where USN or Name is absent
            if not name or not usn:
                continue

            members.append({
                "name": name,
                "department": dept,
                "usn": usn,
                "canonical_usn": usn_match_key(usn)
            })

        return members

    def find_member_by_usn(self, usn: str) -> Optional[Dict[str, str]]:
        """
        Looks up a member by USN using normalized comparison.
        Matches case-insensitively and handles whitespace differences.
        """
        target_key = usn_match_key(usn)
        if not target_key:
            return None

        members = self.get_all_members()
        for m in members:
            if m["canonical_usn"] == target_key:
                return m
        return None

    def get_attendance_records(self, date_str: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Reads attendance records from the attendance workbook.
        Optionally filters by Date (format YYYY-MM-DD).
        """
        self._ensure_attendance_workbook()
        if not self.attendance_path.exists():
            return []

        try:
            df = pd.read_excel(self.attendance_path, sheet_name=0, dtype=str)
            df = df.astype(object).fillna("")
        except Exception as e:
            print(f"[ExcelHandler] Error reading attendance workbook: {e}")
            return []

        if df.empty:
            return []

        records = []
        for _, row in df.iterrows():
            rec_date = normalize_string(row.get("Date"))
            name = normalize_string(row.get("Name"))
            dept = normalize_string(row.get("Department"))
            usn = normalize_string(row.get("USN"))
            in_time = normalize_string(row.get("In Time"))
            out_time = normalize_string(row.get("Out Time"))
            status = normalize_string(row.get("Status"))

            if not usn:
                continue

            # Filter by date if provided
            if date_str and rec_date != date_str:
                continue

            records.append({
                "date": rec_date,
                "name": name,
                "department": dept,
                "usn": usn,
                "canonical_usn": usn_match_key(usn),
                "in_time": in_time,
                "out_time": out_time,
                "status": status
            })

        return records

    def save_or_update_attendance(self, date_str: str, member: Dict[str, str],
                                  in_time: Optional[str] = None,
                                  out_time: Optional[str] = None,
                                  status: Optional[str] = None) -> Dict[str, Any]:
        """
        Creates or updates an attendance record for a specific date and member.
        Saves changes to attendance_records.xlsx.
        """
        self._ensure_attendance_workbook()
        try:
            df = pd.read_excel(self.attendance_path, sheet_name=0, dtype=str)
            df = df.astype(object).fillna("")
        except Exception:
            df = pd.DataFrame(columns=EXCEL_COLUMNS, dtype=object)

        # Ensure all columns exist
        for col in EXCEL_COLUMNS:
            if col not in df.columns:
                df[col] = ""

        # Find existing row for this date and canonical USN
        member_key = member.get("canonical_usn", usn_match_key(member["usn"]))
        match_idx = None

        for idx, row in df.iterrows():
            row_date = normalize_string(row.get("Date"))
            row_usn_key = usn_match_key(row.get("USN"))
            if row_date == date_str and row_usn_key == member_key:
                match_idx = idx
                break

        if match_idx is not None:
            # Update existing record
            if in_time is not None:
                df.at[match_idx, "In Time"] = str(in_time)
            if out_time is not None:
                df.at[match_idx, "Out Time"] = str(out_time)
            if status is not None:
                df.at[match_idx, "Status"] = str(status)
            record_row = df.loc[match_idx]
        else:
            # Create new record
            new_row = {
                "Date": date_str,
                "Name": member["name"],
                "Department": member["department"],
                "USN": member["usn"],
                "In Time": str(in_time or ""),
                "Out Time": str(out_time or ""),
                "Status": str(status or "")
            }
            df = pd.concat([df, pd.DataFrame([new_row], dtype=object)], ignore_index=True)
            record_row = new_row

        # Save to attendance Excel file safely
        try:
            with pd.ExcelWriter(self.attendance_path, engine='openpyxl') as writer:
                df.to_excel(writer, sheet_name='Sheet1', index=False)
        except Exception as e:
            raise IOError(f"Failed to write to attendance workbook: {e}")

        # Optional sync to master Excel if enabled
        if SYNC_TO_MASTER_EXCEL:
            self._sync_today_to_master(date_str, member["usn"], in_time, out_time, status)

        return {
            "date": date_str,
            "name": member["name"],
            "department": member["department"],
            "usn": member["usn"],
            "in_time": normalize_string(record_row.get("In Time")),
            "out_time": normalize_string(record_row.get("Out Time")),
            "status": normalize_string(record_row.get("Status"))
        }

    def _sync_today_to_master(self, date_str: str, usn: str,
                              in_time: Optional[str], out_time: Optional[str], status: Optional[str]):
        """Safely updates today's status in club_members.xlsx while preserving member records."""
        try:
            if not self.members_path.exists():
                return
            df = pd.read_excel(self.members_path, sheet_name=0)
            target_key = usn_match_key(usn)

            for idx, row in df.iterrows():
                if usn_match_key(row.get("USN")) == target_key:
                    df.at[idx, "Date"] = date_str
                    if in_time is not None:
                        df.at[idx, "In Time"] = in_time
                    if out_time is not None:
                        df.at[idx, "Out Time"] = out_time
                    if status is not None:
                        df.at[idx, "Status"] = status
                    break

            with pd.ExcelWriter(self.members_path, engine='openpyxl') as writer:
                df.to_excel(writer, sheet_name='Sheet1', index=False)
        except Exception as e:
            print(f"[ExcelHandler] Master sync warning: {e}")

    def export_attendance_df(self, date_str: Optional[str] = None) -> pd.DataFrame:
        """Returns a formatted DataFrame for export/download."""
        self._ensure_attendance_workbook()
        try:
            df = pd.read_excel(self.attendance_path, sheet_name=0)
        except Exception:
            df = pd.DataFrame(columns=EXCEL_COLUMNS)

        if date_str:
            df = df[df["Date"].astype(str) == date_str]

        return df
