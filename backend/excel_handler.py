import json
import re
import shutil
from datetime import datetime
from pathlib import Path
from typing import List, Dict, Optional, Any, Tuple
import pandas as pd
import openpyxl

from config import (
    MEMBERS_EXCEL_PATH,
    BACKUP_EXCEL_PATH,
    ATTENDANCE_EXCEL_PATH,
    BACKUPS_DIR,
    EXCEL_COLUMNS,
    STATUS_PRESENT,
    STATUS_LEFT,
    STATUS_NOT_SCANNED,
    canonicalize_status,
    SYNC_TO_MASTER_EXCEL,
    SYSTEM_TIMEZONE
)

def normalize_string(val: Any) -> str:
    """Safely converts any value to trimmed string, stripping NaN."""
    if val is None or pd.isna(val):
        return ""
    s = str(val).strip()
    if s.lower() == "nan":
        return ""
    return s

def canonical_key(val: str) -> str:
    """Normalizes string for comparison: strips all whitespace, uppercase."""
    if not val:
        return ""
    return re.sub(r"\s+", "", str(val)).upper()

def normalize_rfid(rfid_str: str) -> str:
    """Normalizes RFID hex tag (e.g., 'a3:5f:8c:12' -> 'A35F8C12' or standardized)."""
    if not rfid_str:
        return ""
    cleaned = re.sub(r"[\s:\-]+", "", str(rfid_str)).upper()
    return cleaned

def derive_branch(department: str, usn: str) -> str:
    """Derives a student branch from department or USN if branch is unspecified."""
    dept = normalize_string(department).upper()
    usn_clean = canonical_key(usn)

    if "CSE" in dept or "COMPUTER" in dept or "CS" in usn_clean:
        return "Computer Science & Engineering"
    if "EAC" in dept or "ECE" in dept or "EC" in dept or "EC" in usn_clean:
        return "Electronics & Communication Engineering"
    if "ME" in dept or "MECHANICAL" in dept:
        return "Mechanical Engineering"
    if "IS" in dept or "ISE" in dept:
        return "Information Science & Engineering"
    if "AI" in dept or "AIML" in dept:
        return "Artificial Intelligence & Machine Learning"
    if "CIVIL" in dept or "CV" in dept:
        return "Civil Engineering"

    return dept if dept else "General"


class ExcelHandler:
    """
    Handles robust, non-corrupting I/O for master club members and attendance logs.
    Includes automated backups, normalization, and duplicate detection.
    """

    def __init__(self,
                 members_path: Path = MEMBERS_EXCEL_PATH,
                 attendance_path: Path = ATTENDANCE_EXCEL_PATH,
                 backups_dir: Path = BACKUPS_DIR):
        self.members_path = Path(members_path)
        self.attendance_path = Path(attendance_path)
        self.backups_dir = Path(backups_dir)
        self.backups_dir.mkdir(parents=True, exist_ok=True)
        self.rfid_map_file = self.members_path.parent / "rfid_mappings.json"

        # Initialize and ensure safety backups
        self._ensure_initial_backup()
        self._ensure_attendance_workbook()

    def _ensure_initial_backup(self):
        """Creates an initial backup copy of the master workbook if not already present."""
        try:
            if self.members_path.exists():
                if not BACKUP_EXCEL_PATH.exists():
                    shutil.copy2(self.members_path, BACKUP_EXCEL_PATH)
        except Exception as e:
            print(f"[ExcelHandler] Initial backup warning: {e}")

    def create_timestamped_backup(self, tag: str = "auto") -> Optional[Path]:
        """Creates a timestamped backup in data/backups before modifying operations."""
        try:
            if not self.members_path.exists():
                return None
            ts = datetime.now(SYSTEM_TIMEZONE).strftime("%Y%m%d_%H%M%S")
            dest = self.backups_dir / f"club_members_backup_{ts}_{tag}.xlsx"
            shutil.copy2(self.members_path, dest)
            return dest
        except Exception as e:
            print(f"[ExcelHandler] Timestamped backup error: {e}")
            return None

    def _load_rfid_mappings(self) -> Dict[str, str]:
        """Loads canonical USN -> RFID UID mappings from JSON fallback file."""
        if self.rfid_map_file.exists():
            try:
                with open(self.rfid_map_file, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                return {}
        return {}

    def _save_rfid_mappings(self, mapping: Dict[str, str]):
        """Saves canonical USN -> RFID UID mappings."""
        try:
            with open(self.rfid_map_file, "w", encoding="utf-8") as f:
                json.dump(mapping, f, indent=2)
        except Exception as e:
            print(f"[ExcelHandler] Error saving rfid mappings: {e}")

    def _ensure_attendance_workbook(self):
        """Ensures attendance_records.xlsx exists with correct headers."""
        if not self.attendance_path.exists():
            try:
                df = pd.DataFrame(columns=EXCEL_COLUMNS)
                with pd.ExcelWriter(self.attendance_path, engine="openpyxl") as writer:
                    df.to_excel(writer, sheet_name="Sheet1", index=False)
            except Exception as e:
                print(f"[ExcelHandler] Failed to initialize attendance workbook: {e}")

    def get_all_members(self) -> List[Dict[str, Any]]:
        """
        Loads all club members from club_members.xlsx safely.
        Filters out empty/NaN rows, trims whitespace, maps branches and RFID UIDs.
        """
        if not self.members_path.exists():
            raise FileNotFoundError(f"Master member file not found at: {self.members_path}")

        try:
            df = pd.read_excel(self.members_path, sheet_name=0, dtype=str)
            df = df.astype(object).fillna("")
        except Exception as e:
            raise RuntimeError(f"Failed to read master Excel file: {e}")

        # Determine column names (case-insensitive mapping)
        cols_lower = {str(c).strip().lower(): c for c in df.columns}
        name_col = cols_lower.get("name")
        usn_col = cols_lower.get("usn")
        dept_col = cols_lower.get("department")
        branch_col = cols_lower.get("branch")
        rfid_col = cols_lower.get("rfid_uid") or cols_lower.get("rfid card uid") or cols_lower.get("rfid") or cols_lower.get("uid")

        if not name_col or not usn_col:
            raise ValueError(f"Required columns 'Name' and 'USN' not found in {self.members_path.name}")

        rfid_mappings = self._load_rfid_mappings()

        members = []
        for idx, row in df.iterrows():
            name = normalize_string(row.get(name_col))
            usn = normalize_string(row.get(usn_col))
            dept = normalize_string(row.get(dept_col)) if dept_col else ""
            branch = normalize_string(row.get(branch_col)) if branch_col else ""

            # Skip blank / header NaN rows
            if not name or not usn:
                continue

            c_usn = canonical_key(usn)

            # Determine RFID UID from Excel column or sidecar mapping
            excel_rfid = normalize_string(row.get(rfid_col)) if rfid_col else ""
            mapped_rfid = rfid_mappings.get(c_usn, "")
            final_rfid = excel_rfid or mapped_rfid

            if not branch:
                branch = derive_branch(dept, usn)

            members.append({
                "id": c_usn,
                "name": name,
                "department": dept or "General",
                "branch": branch,
                "usn": usn,
                "canonical_usn": c_usn,
                "rfid_uid": final_rfid,
                "normalized_rfid": normalize_rfid(final_rfid)
            })

        return members

    def find_member_by_identifier(self, identifier: str) -> Optional[Dict[str, Any]]:
        """
        Looks up a member by EITHER their scanned RFID Card UID OR their USN.
        Matches case-insensitively and handles whitespace differences.
        """
        if not identifier:
            return None

        clean_id = canonical_key(identifier)
        clean_rfid = normalize_rfid(identifier)
        members = self.get_all_members()

        for m in members:
            # 1. Match by RFID UID if assigned
            if m["normalized_rfid"] and (m["normalized_rfid"] == clean_rfid or m["normalized_rfid"] == clean_id):
                return m
            # 2. Match by USN (direct or canonical)
            if m["canonical_usn"] == clean_id:
                return m

        return None

    def find_member_by_usn(self, usn: str) -> Optional[Dict[str, Any]]:
        """Lookup member specifically by USN."""
        target_key = canonical_key(usn)
        if not target_key:
            return None
        members = self.get_all_members()
        for m in members:
            if m["canonical_usn"] == target_key:
                return m
        return None

    def detect_duplicates(self) -> Dict[str, List[str]]:
        """Detects any duplicate USNs or duplicate RFID UIDs in the registered members."""
        members = self.get_all_members()
        usn_counts: Dict[str, List[str]] = {}
        rfid_counts: Dict[str, List[str]] = {}

        for m in members:
            u = m["canonical_usn"]
            usn_counts.setdefault(u, []).append(m["name"])

            r = m["normalized_rfid"]
            if r:
                rfid_counts.setdefault(r, []).append(m["name"])

        dup_usns = {k: v for k, v in usn_counts.items() if len(v) > 1}
        dup_rfids = {k: v for k, v in rfid_counts.items() if len(v) > 1}

        return {
            "duplicate_usns": dup_usns,
            "duplicate_rfids": dup_rfids
        }

    def add_member(self, member_data: Dict[str, Any]) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """
        Safely adds a new member to the master Excel file.
        Validates USN, verifies uniqueness, creates backup, and appends row.
        """
        name = normalize_string(member_data.get("name"))
        usn = normalize_string(member_data.get("usn"))
        dept = normalize_string(member_data.get("department")) or "General"
        branch = normalize_string(member_data.get("branch")) or derive_branch(dept, usn)
        rfid_uid = normalize_string(member_data.get("rfid_uid"))

        if not name:
            return False, "Member Name is required.", None
        if not usn:
            return False, "USN is required.", None

        c_usn = canonical_key(usn)
        norm_rfid = normalize_rfid(rfid_uid)

        # Check existing duplicates
        existing_members = self.get_all_members()
        for m in existing_members:
            if m["canonical_usn"] == c_usn:
                return False, f"Member with USN '{usn}' already exists ({m['name']}).", None
            if norm_rfid and m["normalized_rfid"] == norm_rfid:
                return False, f"RFID UID '{rfid_uid}' is already assigned to {m['name']} ({m['usn']}).", None

        # Backup before writing
        self.create_timestamped_backup("before_add_member")

        try:
            df = pd.read_excel(self.members_path, sheet_name=0, dtype=str).fillna("")
        except Exception:
            df = pd.DataFrame(columns=EXCEL_COLUMNS)

        new_row = {col: "" for col in df.columns}
        new_row["Name"] = name
        new_row["USN"] = usn
        new_row["Department"] = dept
        if "Branch" in df.columns:
            new_row["Branch"] = branch
        if "RFID_UID" in df.columns and rfid_uid:
            new_row["RFID_UID"] = rfid_uid

        df = pd.concat([df, pd.DataFrame([new_row])], ignore_index=True)

        with pd.ExcelWriter(self.members_path, engine="openpyxl") as writer:
            df.to_excel(writer, sheet_name="Sheet1", index=False)

        # Also store RFID mapping in sidecar JSON
        if rfid_uid:
            mappings = self._load_rfid_mappings()
            mappings[c_usn] = rfid_uid
            self._save_rfid_mappings(mappings)

        new_member = {
            "id": c_usn,
            "name": name,
            "department": dept,
            "branch": branch,
            "usn": usn,
            "canonical_usn": c_usn,
            "rfid_uid": rfid_uid,
            "normalized_rfid": norm_rfid
        }
        return True, "Member registered successfully.", new_member

    def update_member(self, usn: str, update_data: Dict[str, Any]) -> Tuple[bool, str, Optional[Dict[str, Any]]]:
        """
        Updates an existing member's information or assigns/updates their RFID UID.
        """
        c_usn = canonical_key(usn)
        if not c_usn:
            return False, "Invalid USN provided.", None

        existing = self.find_member_by_usn(usn)
        if not existing:
            return False, f"Member with USN '{usn}' not found.", None

        new_name = normalize_string(update_data.get("name")) or existing["name"]
        new_dept = normalize_string(update_data.get("department")) or existing["department"]
        new_branch = normalize_string(update_data.get("branch")) or existing["branch"]
        new_rfid = normalize_string(update_data.get("rfid_uid"))

        # If changing RFID, check if another member already has it
        norm_rfid = normalize_rfid(new_rfid)
        if norm_rfid:
            all_m = self.get_all_members()
            for m in all_m:
                if m["canonical_usn"] != c_usn and m["normalized_rfid"] == norm_rfid:
                    return False, f"RFID UID '{new_rfid}' is already assigned to {m['name']} ({m['usn']}).", None

        self.create_timestamped_backup("before_update_member")

        try:
            df = pd.read_excel(self.members_path, sheet_name=0, dtype=str).fillna("")
            cols_lower = {str(c).strip().lower(): c for c in df.columns}
            usn_col = cols_lower.get("usn", "USN")
            name_col = cols_lower.get("name", "Name")
            dept_col = cols_lower.get("department", "Department")
            branch_col = cols_lower.get("branch")
            rfid_col = cols_lower.get("rfid_uid")

            matched = False
            for idx, row in df.iterrows():
                if canonical_key(row.get(usn_col)) == c_usn:
                    df.at[idx, name_col] = new_name
                    df.at[idx, dept_col] = new_dept
                    if branch_col:
                        df.at[idx, branch_col] = new_branch
                    if rfid_col and new_rfid is not None:
                        df.at[idx, rfid_col] = new_rfid
                    matched = True
                    break

            if matched:
                with pd.ExcelWriter(self.members_path, engine="openpyxl") as writer:
                    df.to_excel(writer, sheet_name="Sheet1", index=False)

        except Exception as e:
            return False, f"Failed to update Excel record: {e}", None

        # Always update sidecar mapping
        mappings = self._load_rfid_mappings()
        if new_rfid:
            mappings[c_usn] = new_rfid
        elif c_usn in mappings and update_data.get("rfid_uid") == "":
            del mappings[c_usn]
        self._save_rfid_mappings(mappings)

        updated_member = {
            "id": c_usn,
            "name": new_name,
            "department": new_dept,
            "branch": new_branch,
            "usn": existing["usn"],
            "canonical_usn": c_usn,
            "rfid_uid": new_rfid if new_rfid is not None else existing["rfid_uid"],
            "normalized_rfid": norm_rfid
        }
        return True, "Member updated successfully.", updated_member

    def delete_member(self, usn: str) -> Tuple[bool, str]:
        """Safely removes a member from the master roster after creating a backup."""
        c_usn = canonical_key(usn)
        if not c_usn:
            return False, "Invalid USN."

        existing = self.find_member_by_usn(usn)
        if not existing:
            return False, f"Member with USN '{usn}' not found."

        self.create_timestamped_backup("before_delete_member")

        try:
            df = pd.read_excel(self.members_path, sheet_name=0, dtype=str).fillna("")
            cols_lower = {str(c).strip().lower(): c for c in df.columns}
            usn_col = cols_lower.get("usn", "USN")

            filtered_rows = [idx for idx, row in df.iterrows() if canonical_key(row.get(usn_col)) != c_usn]
            df = df.loc[filtered_rows].reset_index(drop=True)

            with pd.ExcelWriter(self.members_path, engine="openpyxl") as writer:
                df.to_excel(writer, sheet_name="Sheet1", index=False)

            mappings = self._load_rfid_mappings()
            if c_usn in mappings:
                del mappings[c_usn]
                self._save_rfid_mappings(mappings)

            return True, f"Member '{existing['name']}' ({existing['usn']}) deleted successfully."
        except Exception as e:
            return False, f"Error deleting member: {e}"

    def import_members_from_file(self, filepath: Path) -> Dict[str, Any]:
        """
        Safely imports new members from an uploaded Excel file.
        Skips duplicates and preserves existing data.
        """
        if not filepath.exists():
            return {"success": False, "error": "Uploaded file does not exist."}

        try:
            upload_df = pd.read_excel(filepath, sheet_name=0, dtype=str).fillna("")
        except Exception as e:
            return {"success": False, "error": f"Failed to read uploaded Excel: {e}"}

        cols_lower = {str(c).strip().lower(): c for c in upload_df.columns}
        name_col = cols_lower.get("name")
        usn_col = cols_lower.get("usn")
        dept_col = cols_lower.get("department")
        rfid_col = cols_lower.get("rfid_uid") or cols_lower.get("rfid") or cols_lower.get("uid")

        if not name_col or not usn_col:
            return {
                "success": False,
                "error": "Uploaded Excel must contain at least 'Name' and 'USN' columns."
            }

        existing_members = {m["canonical_usn"]: m for m in self.get_all_members()}
        imported_count = 0
        skipped_count = 0
        skipped_reasons = []

        self.create_timestamped_backup("before_excel_import")

        for _, row in upload_df.iterrows():
            name = normalize_string(row.get(name_col))
            usn = normalize_string(row.get(usn_col))
            dept = normalize_string(row.get(dept_col)) if dept_col else "General"
            rfid = normalize_string(row.get(rfid_col)) if rfid_col else ""

            if not name or not usn:
                skipped_count += 1
                continue

            c_usn = canonical_key(usn)
            if c_usn in existing_members:
                skipped_count += 1
                skipped_reasons.append(f"USN {usn} already exists")
                continue

            success, msg, _ = self.add_member({
                "name": name,
                "usn": usn,
                "department": dept,
                "rfid_uid": rfid
            })
            if success:
                imported_count += 1
                existing_members[c_usn] = True
            else:
                skipped_count += 1
                skipped_reasons.append(f"{usn}: {msg}")

        return {
            "success": True,
            "imported_count": imported_count,
            "skipped_count": skipped_count,
            "total_processed": imported_count + skipped_count,
            "details": skipped_reasons[:10]
        }

    # ---------------------------------------------------------
    # Attendance Methods
    # ---------------------------------------------------------
    def get_attendance_records(self,
                               date_str: Optional[str] = None,
                               start_date: Optional[str] = None,
                               end_date: Optional[str] = None) -> List[Dict[str, Any]]:
        """
        Reads attendance records from the attendance workbook.
        Supports single date or date-range filtering.
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
            status = canonicalize_status(normalize_string(row.get("Status")))

            if not usn:
                continue

            # Filtering
            if date_str and rec_date != date_str:
                continue
            if start_date and rec_date < start_date:
                continue
            if end_date and rec_date > end_date:
                continue

            branch = derive_branch(dept, usn)

            records.append({
                "date": rec_date,
                "name": name,
                "department": dept,
                "branch": branch,
                "usn": usn,
                "canonical_usn": canonical_key(usn),
                "in_time": in_time,
                "out_time": out_time,
                "status": status
            })

        return records

    def save_or_update_attendance(self,
                                  date_str: str,
                                  member: Dict[str, Any],
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

        for col in EXCEL_COLUMNS:
            if col not in df.columns:
                df[col] = ""

        member_key = member.get("canonical_usn", canonical_key(member["usn"]))
        match_idx = None

        for idx, row in df.iterrows():
            row_date = normalize_string(row.get("Date"))
            row_usn_key = canonical_key(row.get("USN"))
            if row_date == date_str and row_usn_key == member_key:
                match_idx = idx
                break

        canonical_stat = canonicalize_status(status) if status else None

        if match_idx is not None:
            if in_time is not None:
                df.at[match_idx, "In Time"] = str(in_time)
            if out_time is not None:
                df.at[match_idx, "Out Time"] = str(out_time)
            if canonical_stat is not None:
                df.at[match_idx, "Status"] = str(canonical_stat)
            record_row = df.loc[match_idx]
        else:
            new_row = {
                "Date": date_str,
                "Name": member["name"],
                "Department": member["department"],
                "USN": member["usn"],
                "In Time": str(in_time or ""),
                "Out Time": str(out_time or ""),
                "Status": str(canonical_stat or "")
            }
            df = pd.concat([df, pd.DataFrame([new_row], dtype=object)], ignore_index=True)
            record_row = new_row

        try:
            with pd.ExcelWriter(self.attendance_path, engine="openpyxl") as writer:
                df.to_excel(writer, sheet_name="Sheet1", index=False)
        except Exception as e:
            raise IOError(f"Failed to write to attendance workbook: {e}")

        if SYNC_TO_MASTER_EXCEL:
            self._sync_today_to_master(date_str, member["usn"], in_time, out_time, canonical_stat)

        return {
            "date": date_str,
            "name": member["name"],
            "department": member["department"],
            "branch": member.get("branch", derive_branch(member["department"], member["usn"])),
            "usn": member["usn"],
            "in_time": normalize_string(record_row.get("In Time")),
            "out_time": normalize_string(record_row.get("Out Time")),
            "status": canonicalize_status(normalize_string(record_row.get("Status")))
        }

    def _sync_today_to_master(self, date_str: str, usn: str,
                              in_time: Optional[str], out_time: Optional[str], status: Optional[str]):
        """Safely syncs today's record to club_members.xlsx if SYNC_TO_MASTER_EXCEL is enabled."""
        try:
            if not self.members_path.exists():
                return
            df = pd.read_excel(self.members_path, sheet_name=0)
            target_key = canonical_key(usn)

            for idx, row in df.iterrows():
                if canonical_key(row.get("USN")) == target_key:
                    df.at[idx, "Date"] = date_str
                    if in_time is not None:
                        df.at[idx, "In Time"] = in_time
                    if out_time is not None:
                        df.at[idx, "Out Time"] = out_time
                    if status is not None:
                        df.at[idx, "Status"] = status
                    break

            with pd.ExcelWriter(self.members_path, engine="openpyxl") as writer:
                df.to_excel(writer, sheet_name="Sheet1", index=False)
        except Exception as e:
            print(f"[ExcelHandler] Master sync warning: {e}")

    def export_filtered_dataframe(self,
                                  date_str: Optional[str] = None,
                                  start_date: Optional[str] = None,
                                  end_date: Optional[str] = None,
                                  department: Optional[str] = None,
                                  branch: Optional[str] = None,
                                  status: Optional[str] = None,
                                  search_query: Optional[str] = None,
                                  today_summary_fallback: Optional[List[Dict[str, Any]]] = None) -> pd.DataFrame:
        """Returns a filtered pandas DataFrame for Excel or CSV export."""
        records = None
        if today_summary_fallback is not None and (date_str or start_date):
            today_str = datetime.now(SYSTEM_TIMEZONE).strftime("%Y-%m-%d")
            if (date_str == today_str) or (start_date == today_str and (not end_date or end_date == today_str)):
                records = today_summary_fallback

        if records is None:
            records = self.get_attendance_records(date_str=date_str, start_date=start_date, end_date=end_date)

        if not records:
            return pd.DataFrame(columns=["Date", "Name", "Department", "Branch", "USN", "In Time", "Out Time", "Status"])

        filtered = []
        q = search_query.strip().lower() if search_query else ""
        d_filter = department.strip().upper() if department and department != "ALL" else ""
        b_filter = branch.strip().lower() if branch and branch != "ALL" else ""
        s_filter = canonicalize_status(status) if status and status != "ALL" else ""

        for r in records:
            if d_filter and r["department"].upper() != d_filter:
                continue
            if b_filter and r.get("branch", "").lower() != b_filter:
                continue
            if s_filter and r["status"] != s_filter:
                continue
            if q:
                match = (q in r["name"].lower() or
                         q in r["usn"].lower() or
                         q in r["department"].lower() or
                         q in r.get("branch", "").lower())
                if not match:
                    continue
            filtered.append({
                "Date": r["date"],
                "Name": r["name"],
                "Department": r["department"],
                "Branch": r.get("branch", derive_branch(r["department"], r["usn"])),
                "USN": r["usn"],
                "In Time": r["in_time"],
                "Out Time": r["out_time"],
                "Status": r["status"]
            })

        return pd.DataFrame(filtered)

