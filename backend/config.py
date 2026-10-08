import os
from pathlib import Path

# Base directories
BACKEND_DIR = Path(__file__).resolve().parent
BASE_DIR = BACKEND_DIR.parent
DATA_DIR = BASE_DIR / "data"
FRONTEND_DIR = BASE_DIR / "frontend"

# Excel file paths
MEMBERS_EXCEL_PATH = DATA_DIR / "club_members.xlsx"
BACKUP_EXCEL_PATH = DATA_DIR / "club_members_backup.xlsx"
ATTENDANCE_EXCEL_PATH = DATA_DIR / "attendance_records.xlsx"

# Excel Column Definitions (exact match with senior's file)
EXCEL_COLUMNS = [
    "Date",
    "Name",
    "Department",
    "USN",
    "In Time",
    "Out Time",
    "Status"
]

# Attendance Statuses
STATUS_PRESENT = "PRESENT"
STATUS_EXITED = "EXITED"
STATUS_NOT_SCANNED = "NOT SCANNED"

# Attendance Actions
ACTION_ENTRY = "ENTRY"
ACTION_EXIT = "EXIT"

# Safety mode:
# If False (Recommended): club_members.xlsx is kept read-only as the master roster.
# Attendance logs are safely recorded in attendance_records.xlsx without corrupting member rows.
SYNC_TO_MASTER_EXCEL = False

# Server Configuration
SERVER_HOST = "0.0.0.0"  # Allows ESP32 on the same LAN to connect
SERVER_PORT = 5000
DEBUG_MODE = True
