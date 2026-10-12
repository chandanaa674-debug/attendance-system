# TechBots-SIT RFID Attendance Management System — Deployment Guide

**Srinivas Institute of Technology, Valachil, Mangaluru, Karnataka**  
*College Club Project | Single Repository Architecture*

---

## 1. Architecture Overview

The system maintains all software components in **one repository**:
- **Frontend**: Responsive institutional web application (Vanilla HTML5, CSS3, JS).
- **Backend**: Python Flask REST API server.
- **Data Source**: Excel workbooks (`data/club_members.xlsx` & `data/attendance_records.xlsx`).
- **Hardware Integration**: ESP32 + RC522 RFID reader with hardware authentication.

---

## 2. Local Development & College Gate Deployment

### Quick Start
1. **Clone & Navigate**:
   ```powershell
   git clone https://github.com/chandanaa674-debug/attendance-system.git
   cd attendance-system
   ```

2. **Install Dependencies**:
   ```powershell
   pip install -r requirements.txt
   ```

3. **Configure Environment**:
   Copy `.env.example` to `.env`:
   ```powershell
   copy .env.example .env
   ```

4. **Run Server**:
   ```powershell
   python backend/app.py
   ```
   Server boots on:
   - Local: `http://localhost:5000`
   - College LAN: `http://0.0.0.0:5000` (e.g. `http://192.168.1.45:5000`)

---

## 3. Public Cloud Deployment (Demo & Production)

### Option A: Render / Railway / Fly.io (Recommended for Stateful Excel + ESP32)
These platforms support persistent Python processes and direct LAN/WAN connections:
1. Connect your GitHub repository to **Render** (https://render.com).
2. Choose **Web Service**.
3. Render automatically detects `render.yaml` or `Procfile`:
   - Build Command: `pip install -r requirements.txt`
   - Start Command: `gunicorn --bind 0.0.0.0:$PORT wsgi:app`
4. Set Environment Variables in Render Dashboard:
   - `TIMEZONE`: `Asia/Kolkata`
   - `ADMIN_USERNAME`: `admin`
   - `ADMIN_PASSWORD`: `<your-secure-password>`
   - `RFID_API_SECRET`: `techbots-sit-rfid-hw-secret-2026`
   - `JWT_SECRET`: `<generated-secret>`

### Option B: Vercel (Serverless Demo)
- Configuration included in `vercel.json` and `api/index.py`.
- **Note on Serverless Limitations**: Vercel functions have read-only filesystems (ephemeral `/tmp`). Attendance changes during serverless execution do not write back permanently to Git repository files. For permanent attendance tracking, use **Render** or mount external cloud storage.

---

## 4. Default Credentials & Hardware Secrets

| Parameter | Default Value | Purpose |
|---|---|---|
| **Admin Username** | `admin` | Sign in at `/login.html` |
| **Admin Password** | `TechBots@SIT2026` | Configurable in `.env` |
| **Timezone** | `Asia/Kolkata` | Mangaluru local time |
| **Hardware Secret** | `techbots-sit-rfid-hw-secret-2026` | ESP32 `X-API-Key` header |
| **Scan Cooldown** | `15` seconds | Debounce protection |
