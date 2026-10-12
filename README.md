# SRINIVAS INSTITUTE OF TECHNOLOGY | Valachil, Mangaluru
## TechBots — RFID ATTENDANCE MANAGEMENT SYSTEM

An institutional-grade, full-stack **RFID Attendance Management System** built for the **TechBots** club at **Srinivas Institute of Technology, Valachil, Mangaluru, Karnataka**.

Connects the existing club Excel data with senior-developed **ESP32 + RC522 RFID hardware**, a secure Python Flask REST backend, real-time responsive web dashboard, administrator portal, and attendance export tools.

---

## 1. System Features

- **Existing Excel Compatibility**: Safely reads and updates `data/club_members.xlsx` and `data/attendance_records.xlsx` without overwriting historical attendance records or corrupting rows.
- **Timestamped Auto-Backups**: Automatically generates backups in `data/backups/` before any modifying operation.
- **Asia/Kolkata Timezone Support**: Configured for Mangaluru (`Asia/Kolkata`) with formatted 12-hour timestamps (`08:00 PM`).
- **State-Machine Attendance Rules**:
  - **1st Tap**: Marks **Present** and records `In Time`.
  - **2nd Tap**: Marks **Left** and records `Exit Time`.
  - **3rd Tap**: Informs that attendance is already completed for today without modifying original in/out times.
- **Hardware Debounce Protection**: 15-second cooldown timer prevents duplicate attendance events from accidental double taps.
- **Unknown Card Rejection**: Unknown RFID cards are rejected safely with a 404 response without creating false member entries.
- **Administrator Console (`/login.html`)**:
  - Secure password hashing with PBKDF2/SHA256 and JWT session authentication.
  - Member management: Add, Edit, Delete, and assign physical RFID UIDs.
  - Duplicate detection for USNs and RFID UIDs.
  - Safe Excel import with duplicate skipping.
  - One-click workbook backup download.
- **Multi-Date Reports & Analytics (`/reports.html`)**:
  - Date-range filtering, department breakdowns, and turnout percentage.
  - Export filtered attendance data as **Excel (.xlsx)** or **CSV**.
- **Hardware-Ready ESP32 Firmware**: Tested Arduino C++ sketch in `esp32/techbots_esp32_rfid.ino` with WiFi reconnect, buzzer feedback, and `X-API-Key` authentication.

---

## 2. Project Organization

```
attendance-system/
├── backend/
│   ├── app.py                   # Flask REST server & routing
│   ├── attendance_service.py    # Attendance state machine & analytics
│   ├── auth.py                  # Admin password hashing & JWT auth
│   ├── config.py                # System & timezone configurations
│   ├── excel_handler.py         # Safe Excel I/O with backups & normalization
│   └── requirements.txt         # Python dependencies
├── data/
│   ├── club_members.xlsx        # Master registered club roster
│   ├── club_members_backup.xlsx # Original master backup
│   ├── attendance_records.xlsx  # Multi-day attendance records
│   └── backups/                 # Auto-generated timestamped backups
├── esp32/
│   ├── techbots_esp32_rfid.ino  # Production ESP32 Arduino C++ firmware
│   └── README.md                # Pinout wiring & hardware setup
├── frontend/
│   ├── index.html               # Live Dashboard & RFID Card Simulator
│   ├── login.html               # Admin Login Portal
│   ├── members.html             # Member Directory & Admin Management
│   ├── attendance.html          # Today's Live Attendance Session
│   ├── reports.html             # Reports, Archive, & Multi-date Analytics
│   ├── css/
│   │   └── style.css            # Responsive institutional UI design system
│   └── js/
│       ├── dashboard.js         # Real-time polling & simulation
│       ├── members.js           # Member CRUD & duplicate checks
│       ├── attendance.js        # Today's session controller
│       ├── reports.js           # Multi-date reports & exports
│       └── navigation.js        # Mobile drawer navigation
├── tests/
│   └── test_attendance.py       # 12 automated pytest unit & integration tests
├── .env.example                 # Environment variables template
├── .gitignore                   # Ignores .env and temporary files
├── Dockerfile                   # Production Docker container definition
├── Procfile                     # Gunicorn WSGI start command
├── render.yaml                  # Render Cloud blueprint
├── vercel.json                  # Vercel serverless deployment config
├── wsgi.py                      # WSGI entrypoint
├── DEPLOYMENT.md                # Comprehensive deployment guide
└── README.md                    # System documentation
```

---

## 3. Quick Start (Local Development)

```powershell
# 1. Install dependencies
pip install -r requirements.txt

# 2. Run backend
python backend/app.py
```

Open your browser at:
- **Dashboard**: `http://localhost:5000/`
- **Members**: `http://localhost:5000/members`
- **Attendance**: `http://localhost:5000/attendance`
- **Reports**: `http://localhost:5000/reports`
- **Settings**: `http://localhost:5000/settings`
- **Admin Login**: `http://localhost:5000/login`

Default Admin Credentials:
- **Username**: `admin`
- **Password**: `TechBots@SIT2026`

---

## 4. REST API Endpoints

| Method | Endpoint | Description | Auth |
|---|---|---|---|
| `GET` | `/api/health` | Diagnostic health check & timezone info | Public |
| `GET` | `/api/settings` | System configuration, storage & hardware details | Public |
| `PUT` | `/api/settings` | Update rules & debounce cooldown | Admin Required |
| `POST` | `/api/settings/backup_now` | Immediate timestamped Excel backup snapshot | Admin Required |
| `POST` | `/api/auth/login` | Admin login, returns JWT token | Public |
| `GET` | `/api/auth/me` | Validates active admin session | Bearer Token |
| `GET` | `/api/dashboard` | Live metrics, latest scan, & roster | Public |
| `GET` | `/api/attendance/today` | Today's session records with status | Public |
| `GET` | `/api/attendance/history` | Historical logs for date / date-range | Public |
| `POST` / `GET` | `/api/attendance/scan` | RFID tap scan (supports USN or Card UID) | `X-API-Key` / Simulator |
| `GET` | `/api/members` | Full member list with department/branch filter | Public |
| `POST` | `/api/members` | Register new member | Admin Required |
| `PUT` | `/api/members/<usn>` | Edit member or assign RFID UID | Admin Required |
| `DELETE` | `/api/members/<usn>` | Delete member from roster | Admin Required |
| `GET` | `/api/members/duplicates` | Check for duplicate USNs or RFID UIDs | Admin Required |
| `POST` | `/api/members/import` | Upload Excel (.xlsx) member roster | Admin Required |
| `GET` | `/api/members/backup` | Download latest Excel workbook backup | Admin Required |
| `GET` | `/api/reports/attendance` | Multi-date, department, & branch analytics | Public |
| `GET` | `/api/attendance/export` | Download filtered logs (.xlsx or .csv) | Public |

---

## 5. Automated Tests

Run the comprehensive test suite using pytest:
```powershell
pytest -v tests/test_attendance.py
```
All 17 automated unit and integration tests pass cleanly in ~1.5s with isolated workbook sandboxing.
