/*
 * ==============================================================================
 * TechBots-SIT RFID Attendance Management System
 * Srinivas Institute of Technology, Valachil, Mangaluru, Karnataka
 * Hardware: ESP32 NodeMCU / DevKit + RC522 RFID Reader (SPI)
 * ==============================================================================
 *
 * Required Arduino Libraries:
 *   - MFRC522 by GithubCommunity (v1.4.10+)
 *   - ArduinoJson by Benoit Blanchon (v6.21.0+)
 *   - WiFi & HTTPClient (Built-in with ESP32 board package)
 *
 * Pin Connections:
 *   ESP32 Pin       RC522 Pin
 *   ---------       ---------
 *   3.3V            VCC (WARNING: Do NOT connect to 5V!)
 *   GND             GND
 *   GPIO 22         RST
 *   GPIO 5          SDA (SS)
 *   GPIO 18         SCK
 *   GPIO 19         MISO
 *   GPIO 23         MOSI
 *
 * Optional Indicators:
 *   GPIO 4          Active Buzzer (+)
 *   GPIO 2          Green LED (Entry/Exit Success)
 *   GPIO 15         Red LED (Unknown/Error/Cooldown)
 * ==============================================================================
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <SPI.h>
#include <MFRC522.h>
#include <ArduinoJson.h>

// ------------------------------------------------------------------------------
// Network & Server Configuration (Update these for your college network/server)
// ------------------------------------------------------------------------------
const char* WIFI_SSID     = "YOUR_WIFI_SSID";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";

// Backend API URL (Replace with your server's IP address or deployed domain)
// Example Local: "http://192.168.1.100:5000/api/attendance/scan"
// Example Cloud: "https://your-techbots-demo.onrender.com/api/attendance/scan"
const char* SERVER_SCAN_URL = "http://192.168.1.100:5000/api/attendance/scan";

// Hardware Security Token (Must match RFID_API_SECRET in backend .env)
const char* API_SECRET_KEY  = "techbots-sit-rfid-hw-secret-2026";
const char* DEVICE_ID       = "ESP32-GATEWAY-VALACHIL-01";

// ------------------------------------------------------------------------------
// Hardware Pin Definitions
// ------------------------------------------------------------------------------
#define PIN_RST       22
#define PIN_SS         5
#define PIN_BUZZER     4
#define PIN_LED_GREEN  2
#define PIN_LED_RED   15

// Cooldown debounce between scans (in milliseconds)
const unsigned long SCAN_COOLDOWN_MS = 5000;
unsigned long lastScanMillis = 0;
String lastScannedUID = "";

MFRC522 mfrc522(PIN_SS, PIN_RST);

// ------------------------------------------------------------------------------
// Audio & Visual Feedback Helpers
// ------------------------------------------------------------------------------
void beepSuccessEntry() {
  digitalWrite(PIN_LED_GREEN, HIGH);
  digitalWrite(PIN_BUZZER, HIGH);
  delay(180);
  digitalWrite(PIN_BUZZER, LOW);
  delay(100);
  digitalWrite(PIN_LED_GREEN, LOW);
}

void beepSuccessExit() {
  digitalWrite(PIN_LED_GREEN, HIGH);
  for (int i = 0; i < 2; i++) {
    digitalWrite(PIN_BUZZER, HIGH);
    delay(100);
    digitalWrite(PIN_BUZZER, LOW);
    delay(80);
  }
  digitalWrite(PIN_LED_GREEN, LOW);
}

void beepError() {
  digitalWrite(PIN_LED_RED, HIGH);
  for (int i = 0; i < 3; i++) {
    digitalWrite(PIN_BUZZER, HIGH);
    delay(80);
    digitalWrite(PIN_BUZZER, LOW);
    delay(60);
  }
  digitalWrite(PIN_LED_RED, LOW);
}

// ------------------------------------------------------------------------------
// WiFi Connection
// ------------------------------------------------------------------------------
void connectToWiFi() {
  Serial.print("[WiFi] Connecting to: ");
  Serial.println(WIFI_SSID);
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  int attempts = 0;
  while (WiFi.status() != WL_CONNECTED && attempts < 25) {
    delay(500);
    Serial.print(".");
    attempts++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n[WiFi] Connected successfully!");
    Serial.print("[WiFi] IP Address: ");
    Serial.println(WiFi.localIP());
  } else {
    Serial.println("\n[WiFi] Connection failed. Will retry during scan.");
  }
}

// ------------------------------------------------------------------------------
// HTTP POST Scan to TechBots Backend
// ------------------------------------------------------------------------------
void submitScanToServer(String cardUID) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[HTTP] WiFi disconnected. Reconnecting...");
    connectToWiFi();
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("[HTTP] Reconnect failed. Cannot send scan.");
      beepError();
      return;
    }
  }

  HTTPClient http;
  Serial.print("[HTTP] Submitting UID to: ");
  Serial.println(SERVER_SCAN_URL);

  http.begin(SERVER_SCAN_URL);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("X-API-Key", API_SECRET_KEY);
  http.setTimeout(4000);

  // Prepare JSON Payload
  StaticJsonDocument<256> doc;
  doc["identifier"] = cardUID;
  doc["device_id"]  = DEVICE_ID;

  String requestBody;
  serializeJson(doc, requestBody);

  int httpCode = http.POST(requestBody);

  if (httpCode > 0) {
    String responseString = http.getString();
    Serial.printf("[HTTP] Response [%d]: %s\n", httpCode, responseString.c_str());

    StaticJsonDocument<512> respDoc;
    DeserializationError err = deserializeJson(respDoc, responseString);

    if (!err) {
      const char* action = respDoc["action"] | "";
      bool success = respDoc["success"] | false;

      if (success) {
        if (strcmp(action, "ENTRY") == 0) {
          Serial.printf("[ATTENDANCE] ENTRY MARKED for: %s\n", respDoc["name"] | "");
          beepSuccessEntry();
        } else if (strcmp(action, "EXIT") == 0) {
          Serial.printf("[ATTENDANCE] EXIT MARKED for: %s\n", respDoc["name"] | "");
          beepSuccessExit();
        }
      } else {
        Serial.printf("[ALERT] %s\n", respDoc["message"] | "Scan rejected");
        beepError();
      }
    } else {
      beepError();
    }
  } else {
    Serial.printf("[HTTP] POST failed. Error: %s\n", http.errorToString(httpCode).c_str());
    beepError();
  }

  http.end();
}

// ------------------------------------------------------------------------------
// Arduino Setup
// ------------------------------------------------------------------------------
void setup() {
  Serial.begin(115200);
  delay(1000);

  Serial.println("\n========================================================");
  Serial.println("  TechBots-SIT RFID Attendance System");
  Serial.println("  Srinivas Institute of Technology, Valachil, Mangaluru");
  Serial.println("========================================================");

  // Configure Output Pins
  pinMode(PIN_BUZZER, OUTPUT);
  pinMode(PIN_LED_GREEN, OUTPUT);
  pinMode(PIN_LED_RED, OUTPUT);
  digitalWrite(PIN_BUZZER, LOW);
  digitalWrite(PIN_LED_GREEN, LOW);
  digitalWrite(PIN_LED_RED, LOW);

  // Initialize SPI bus and RC522 Reader
  SPI.begin();
  mfrc522.PCD_Init();
  delay(50);
  mfrc522.PCD_DumpVersionToSerial();

  // Connect to WiFi
  connectToWiFi();

  // Ready Chirp
  digitalWrite(PIN_LED_GREEN, HIGH);
  delay(100);
  digitalWrite(PIN_LED_GREEN, LOW);
  Serial.println("[SYSTEM] Ready. Waiting for RFID card taps...\n");
}

// ------------------------------------------------------------------------------
// Main Loop
// ------------------------------------------------------------------------------
void loop() {
  // Check if a new card is present
  if (!mfrc522.PICC_IsNewCardPresent()) {
    delay(50);
    return;
  }

  // Select card
  if (!mfrc522.PICC_ReadCardSerial()) {
    delay(50);
    return;
  }

  // Extract UID in standard Hex format (e.g. "E3A4128B")
  String cardUID = "";
  for (byte i = 0; i < mfrc522.uid.size; i++) {
    if (mfrc522.uid.uidByte[i] < 0x10) cardUID += "0";
    cardUID += String(mfrc522.uid.uidByte[i], HEX);
  }
  cardUID.toUpperCase();

  Serial.print("[RFID] Card Detected! UID: ");
  Serial.println(cardUID);

  // Hardware Debounce check
  unsigned long now = millis();
  if (cardUID == lastScannedUID && (now - lastScanMillis < SCAN_COOLDOWN_MS)) {
    Serial.println("[RFID] Debounce: Card was tapped too quickly. Ignoring duplicate.");
    mfrc522.PICC_HaltA();
    mfrc522.PCD_StopCrypto1();
    return;
  }

  lastScannedUID = cardUID;
  lastScanMillis = now;

  // Submit scan to backend API
  submitScanToServer(cardUID);

  // Halt PICC
  mfrc522.PICC_HaltA();
  mfrc522.PCD_StopCrypto1();
  delay(300);
}
