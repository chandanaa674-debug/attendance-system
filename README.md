# SRINIVAS INSTITUTE OF TECHNOLOGY | Valachil, Mangaluru
## TechBots — RFID ATTENDANCE SYSTEM

A complete, clean, and institutional **Club RFID Attendance Management System** built with Python (Flask) and a professional light-themed responsive Vanilla HTML5/CSS3/JavaScript dashboard.

Designed specifically for college clubs and IoT projects to demonstrate card tapping, entry/exit timestamping, and real-time dashboard analytics, with direct architectural compatibility for later integration with **ESP32 + RC522 RFID** hardware.

---

## 1. Project Overview

- **Master Data Source**: Loaded from `data/club_members.xlsx`.
- **Zero-Corruption Demo Mode**: Keeps the master club member list safe and intact, recording session logs cleanly in `data/attendance_records.xlsx` (with automatic backup `club_members_backup.xlsx`).
- **Simulated RFID Workflow**: Uses student **USN** as the simulated RFID UID for the demo phase.
- **Dynamic Entry/Exit Logic**:
  - **1st Tap (Entry)**: Records `In Time`, sets status to `PRESENT`.
  - **2nd Tap (Exit)**: Records `Out Time`, updates status to `EXITED`.
  - **3rd Tap**: Informs the user that attendance has already been completed for today.
  - **Unregistered Tag**: Rejects unknown cards with a warning (`Unknown / Unregistered Member`).
- **Hardware-Ready Architecture**: When the ESP32 is deployed, it sends HTTP POST requests to the exact same `/api/rfid/scan` endpoint.

---

## 2. Project Structure

```
club-rfid-attendance/
│
├── backend/
│   ├── app.py                   # Main Flask REST server and static page router
│   ├── excel_handler.py         # Safe Excel I/O with whitespace & USN normalization
│   ├── attendance_service.py    # Entry/Exit state machine and attendance analytics
│   ├── config.py                # Server, paths, and status configurations
│   └── requirements.txt         # Python dependencies
│
├── data/
│   ├── club_members.xlsx        # Original uploaded club members roster (read-only)
│   ├── club_members_backup.xlsx # Automatic backup of the original file
│   └── attendance_records.xlsx  # Multi-day attendance logs
│
├── frontend/
│   ├── index.html               # Main Executive Dashboard & RFID Simulator
│   ├── members.html             # Club Members Directory with search & filters
│   ├── attendance.html          # Today's live attendance session with status badges
│   ├── history.html             # Multi-date attendance archive with date picker
│   │
│   ├── css/
│   │   └── style.css            # Custom modern CSS design system (glassmorphism)
│   │
│   └── js/
│       ├── dashboard.js         # Real-time dashboard controller & simulator handler
│       ├── members.js           # Members page controller
│       ├── attendance.js        # Live attendance page controller
│       └── history.js           # Attendance history page controller
│
├── .gitignore
└── README.md
```

---

## 3. Technology Stack

- **Backend**: Python 3.10+, Flask, pandas, openpyxl, Flask-CORS
- **Frontend**: HTML5, CSS3 (Modern Glassmorphism & Micro-animations), Vanilla JavaScript (ES6+)
- **Storage / Data Layer**: Microsoft Excel (`.xlsx`) via pandas and openpyxl

---

## 4. Installation

Open your terminal or PowerShell and install the required dependencies:

```bash
cd backend
pip install -r requirements.txt
```

*Required packages include: `Flask`, `Flask-Cors`, `pandas`, `openpyxl`.*

---

## 5. How to Start Flask

From the project root:

```powershell
python backend/app.py
```

Or from inside the `backend` folder:

```powershell
cd backend
python app.py
```

The Flask server will boot on `http://localhost:5000` (and `http://0.0.0.0:5000` to allow local network connections from an ESP32 microcontroller).

---

## 6. How to Open the Website

Once the backend is running, open any modern web browser and navigate to:

```
http://localhost:5000
```

Available navigation pages:
- **Dashboard**: `http://localhost:5000/` or `http://localhost:5000/index.html`
- **Members**: `http://localhost:5000/members` or `http://localhost:5000/members.html`
- **Today's Attendance**: `http://localhost:5000/attendance` or `http://localhost:5000/attendance.html`
- **Attendance History**: `http://localhost:5000/history` or `http://localhost:5000/history.html`

*(Note: Thanks to Flask-CORS, you can also open `frontend/index.html` directly in your browser or with VS Code Live Server if preferred).*

---

## 7. Excel File Location & Safety Architecture

- **Master File**: `data/club_members.xlsx`
  - Columns: `Date`, `Name`, `Department`, `USN`, `In Time`, `Out Time`, `Status`.
  - Rows 2–10 contain the club members (e.g. `Ananya udupi`, `Rakshitha`, `Adarsh`, etc.).
- **Automatic Backup**: `data/club_members_backup.xlsx`.
- **Session Attendance File**: `data/attendance_records.xlsx`
  - Columns: `Date`, `Name`, `Department`, `USN`, `In Time`, `Out Time`, `Status`.
- **Why Separate Attendance Logging?**
  - Mixing single-member profile records with multi-day attendance records in a single sheet would overwrite previous days' attendance logs or duplicate member roster records.
  - Using `data/attendance_records.xlsx` preserves `club_members.xlsx` as a clean, read-only master roster while allowing full historical session logs across multiple dates.
  - A configurable toggle `SYNC_TO_MASTER_EXCEL` is also available in `backend/config.py` if single-file synchronization is ever required.

---

## 8. REST API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/dashboard` | Aggregated counters, latest scan details, and today's roster. |
| `GET` | `/api/members` | Full list of registered members loaded from Excel. |
| `GET` | `/api/member/<usn>` | Lookup specific member by USN. |
| `GET` | `/api/attendance/today` | Current date attendance logs with status badges. |
| `GET` | `/api/attendance/history?date=YYYY-MM-DD` | Attendance records for a specific date. |
| `POST` | `/api/rfid/scan` | Simulates or processes an RFID scan (`{ "identifier": "USN" }`). |
| `GET` | `/api/attendance/export?date=YYYY-MM-DD` | Downloads formatted Excel file of attendance. |

---

## 9. How Simulated RFID Scanning Works

1. On the **Dashboard**, look at the **Simulate RFID Card Scan** card.
2. Select any member from the dropdown (e.g., `Ananya udupi - USN: 4SN25CS002`).
3. Click **SCAN CARD**:
   - The frontend sends:
     ```json
     POST /api/rfid/scan
     {
       "identifier": "4SN25CS002"
     }
     ```
   - **First Tap**: Backend records `In Time` (e.g. `09:15 AM`) and sets status to `PRESENT`.
   - **Second Tap**: Backend detects existing `In Time`, records `Out Time` (e.g. `12:30 PM`), and sets status to `EXITED`.
   - **Third Tap**: Backend alerts that attendance has already been completed for today.
4. You can also click **Enter Custom USN** to test unregistered tags (e.g., `INVALID999`) to verify the "Unknown / Unregistered Member" warning.

---

## 10. How to Replace Simulated Scanning with ESP32 Later

When the seniors' ESP32 + RC522 RFID reader is ready to be connected:

1. **Keep the Backend API Untouched**:
   The ESP32 will make an HTTP POST request to the exact same route:
   ```
   POST http://<SERVER_IP>:5000/api/rfid/scan
   Content-Type: application/json
   
   {
     "identifier": "<SCANNED_RFID_UID_OR_USN>"
   }
   ```
2. **RFID UID Mapping**:
   - In `club_members.xlsx` or via an added `RFID_UID` column, map the physical card hex UID (e.g. `A3 5F 8C 12`) to the member's record.
   - In `backend/excel_handler.py`, simply check `member.get("rfid_uid") == target_key or member.get("usn") == target_key`.
3. **Sample ESP32 Arduino C++ Snippet**:
   ```cpp
   #include <WiFi.h>
   #include <HTTPClient.h>

   void sendRFIDScan(String cardUID) {
     if (WiFi.status() == WL_CONNECTED) {
       HTTPClient http;
       http.begin("http://192.168.1.100:5000/api/rfid/scan"); // Replace with PC IP
       http.addHeader("Content-Type", "application/json");

       String payload = "{\"identifier\":\"" + cardUID + "\"}";
       int httpResponseCode = http.POST(payload);

       if (httpResponseCode > 0) {
         String response = http.getString();
         Serial.println("Response: " + response);
       }
       http.end();
     }
   }
   ```
4. No frontend changes are necessary; the dashboard's background polling will immediately display live card taps executed at the physical gate!
