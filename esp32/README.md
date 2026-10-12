# TechBots-SIT ESP32 + RC522 RFID Hardware Integration

**Srinivas Institute of Technology, Valachil, Mangaluru, Karnataka**  
*Department of Computer Science & Engineering / Electronics & Communication Engineering*  
*TechBots Robotics & IoT Club*

---

## 1. Overview

This folder contains the complete, tested Arduino C++ firmware for the senior-designed **ESP32 + RC522 RFID reader**. It reads standard 13.56 MHz RFID cards or key fobs (Mifare Classic 1K / Ultralight), extracts their hexadecimal UID, and submits the scan over WiFi directly to the authenticated TechBots Attendance backend.

---

## 2. Pin Connections Table

| ESP32 Pin | RC522 (RFID Reader) | Active Buzzer | Green Status LED | Red Status LED | Notes |
|:---:|:---:|:---:|:---:|:---:|:---|
| **3.3V** | **VCC** | - | - | - | ⚠️ **DO NOT connect RC522 to 5V!** It destroys the reader. |
| **GND** | **GND** | **(-) GND** | **(-) GND** | **(-) GND** | Common Ground |
| **GPIO 5** | **SDA (SS)** | - | - | - | SPI Slave Select |
| **GPIO 18** | **SCK** | - | - | - | SPI Clock |
| **GPIO 23** | **MOSI** | - | - | - | SPI Master Out Slave In |
| **GPIO 19** | **MISO** | - | - | - | SPI Master In Slave Out |
| **GPIO 22** | **RST** | - | - | - | Reset Pin |
| **GPIO 4** | - | **(+) Pin** | - | - | Short beep on Entry, double beep on Exit |
| **GPIO 2** | - | - | **(+) via 220Ω** | - | Flashes on successful scan |
| **GPIO 15** | - | - | - | **(+) via 220Ω** | Flashes on unknown card / error |

---

## 3. Required Arduino IDE Libraries

Install these libraries via **Arduino IDE -> Tools -> Manage Libraries...**:
1. **MFRC522** by *GithubCommunity* (v1.4.10 or higher)
2. **ArduinoJson** by *Benoit Blanchon* (v6.21.0 or higher)

*(WiFi.h, HTTPClient.h, and SPI.h are included automatically with the official ESP32 Arduino Board Support Package).*

---

## 4. Hardware Configuration in `techbots_esp32_rfid.ino`

Before flashing your ESP32 board, modify lines 38-48:

```cpp
const char* WIFI_SSID     = "YOUR_COLLEGE_OR_MOBILE_HOTSPOT";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Local LAN server (when running Flask on PC connected to same WiFi):
const char* SERVER_SCAN_URL = "http://192.168.1.100:5000/api/attendance/scan";

// OR Production Deployed URL:
// const char* SERVER_SCAN_URL = "https://your-domain.onrender.com/api/attendance/scan";

// Hardware Security Token (must match RFID_API_SECRET in backend .env)
const char* API_SECRET_KEY  = "techbots-sit-rfid-hw-secret-2026";
```

---

## 5. Security & Debounce Flow

1. **Hardware Authentication**:
   - The ESP32 sends the secret key in the `X-API-Key` HTTP header.
   - The backend validates this secret before allowing attendance events.
   - If the secret is missing or wrong, the server returns `401 Unauthorized`.

2. **Rapid Scan Debounce**:
   - Both the ESP32 firmware and the Flask backend enforce a cooldown period (default 5-15 seconds).
   - If a student repeatedly holds or taps a card, subsequent rapid taps are ignored safely without duplicating attendance events.

3. **Audio / Visual Feedback**:
   - **Entry Success**: 1 short beep + Green LED flash.
   - **Exit Success**: 2 short beeps + Green LED flash.
   - **Unknown Card / Reject**: 3 rapid warning beeps + Red LED flash.

---

## 6. How to Find Your PC's Local IP Address for Hardware Testing

Run the following in PowerShell on your laptop:
```powershell
ipconfig
```
Look for `IPv4 Address` under your active Wi-Fi adapter (e.g. `192.168.1.45`), and set `SERVER_SCAN_URL` in the firmware to:
`http://192.168.1.45:5000/api/attendance/scan`.
