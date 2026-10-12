import os
from pathlib import Path
from zoneinfo import ZoneInfo
from dotenv import load_dotenv

# Base directories
BACKEND_DIR = Path(__file__).resolve().parent
BASE_DIR = BACKEND_DIR.parent
DATA_DIR = BASE_DIR / "data"
BACKUPS_DIR = DATA_DIR / "backups"
FRONTEND_DIR = BASE_DIR / "frontend"

# Ensure directories exist
DATA_DIR.mkdir(parents=True, exist_ok=True)
BACKUPS_DIR.mkdir(parents=True, exist_ok=True)

# Load .env file
env_path = BASE_DIR / ".env"
if env_path.exists():
    load_dotenv(dotenv_path=env_path)

# Timezone configuration for Mangaluru, Karnataka, India
TIMEZONE_NAME = os.environ.get("TIMEZONE", "Asia/Kolkata")
try:
    SYSTEM_TIMEZONE = ZoneInfo(TIMEZONE_NAME)
except Exception:
    SYSTEM_TIMEZONE = ZoneInfo("Asia/Kolkata")

# Excel file paths (configurable via env vars)
MEMBERS_EXCEL_PATH = Path(os.environ.get("MEMBERS_EXCEL_PATH", str(DATA_DIR / "club_members.xlsx")))
if not MEMBERS_EXCEL_PATH.is_absolute():
    MEMBERS_EXCEL_PATH = BASE_DIR / MEMBERS_EXCEL_PATH

ATTENDANCE_EXCEL_PATH = Path(os.environ.get("ATTENDANCE_EXCEL_PATH", str(DATA_DIR / "attendance_records.xlsx")))
if not ATTENDANCE_EXCEL_PATH.is_absolute():
    ATTENDANCE_EXCEL_PATH = BASE_DIR / ATTENDANCE_EXCEL_PATH

BACKUP_EXCEL_PATH = DATA_DIR / "club_members_backup.xlsx"

# Standard columns matching the college Excel file
EXCEL_COLUMNS = [
    "Date",
    "Name",
    "Department",
    "USN",
    "In Time",
    "Out Time",
    "Status"
]

# Standard Attendance Statuses
STATUS_PRESENT = "Present"
STATUS_LEFT = "Left"
STATUS_NOT_SCANNED = "Not Marked"

# Recognized historical or alternative aliases for backward compatibility
STATUS_ALIASES = {
    "PRESENT": STATUS_PRESENT,
    "present": STATUS_PRESENT,
    "Present": STATUS_PRESENT,
    "EXITED": STATUS_LEFT,
    "exited": STATUS_LEFT,
    "LEFT": STATUS_LEFT,
    "left": STATUS_LEFT,
    "Left": STATUS_LEFT,
    "NOT SCANNED": STATUS_NOT_SCANNED,
    "not scanned": STATUS_NOT_SCANNED,
    "Not Marked": STATUS_NOT_SCANNED,
    "Absent": STATUS_NOT_SCANNED,
    "ABSENT": STATUS_NOT_SCANNED
}

def canonicalize_status(status_str: str) -> str:
    """Returns canonical display status ('Present', 'Left', 'Not Marked')."""
    if not status_str:
        return STATUS_NOT_SCANNED
    s = str(status_str).strip()
    return STATUS_ALIASES.get(s, s)

# Attendance Actions
ACTION_ENTRY = "ENTRY"
ACTION_EXIT = "EXIT"
ACTION_ALREADY_COMPLETED = "ALREADY_COMPLETED"

# Configurable entry/exit rule mode:
# 'strict_single_session' (default): 1st scan = Present, 2nd scan = Left, 3rd+ = Informs completed without corrupting times
ENTRY_EXIT_MODE = os.environ.get("ENTRY_EXIT_MODE", "strict_single_session")


# Admin Authentication
ADMIN_USERNAME = os.environ.get("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "TechBots@SIT2026")
JWT_SECRET = os.environ.get("JWT_SECRET", "techbots-sit-jwt-secret-key-replace-in-production")
JWT_ALGORITHM = "HS256"
JWT_EXPIRATION_HOURS = 24

# RFID Hardware Authentication Secret
RFID_API_SECRET = os.environ.get("RFID_API_SECRET", "techbots-sit-rfid-hw-secret-2026")

# Debounce cooldown in seconds to prevent rapid repeated scans
RAPID_SCAN_COOLDOWN_SECONDS = int(os.environ.get("RAPID_SCAN_COOLDOWN_SECONDS", "15"))

# Server Configuration
SERVER_HOST = os.environ.get("HOST", "0.0.0.0")
SERVER_PORT = int(os.environ.get("PORT", "5000"))
DEBUG_MODE = os.environ.get("DEBUG", "True").lower() in ("true", "1", "yes")

# Optional sync to master Excel
SYNC_TO_MASTER_EXCEL = False
