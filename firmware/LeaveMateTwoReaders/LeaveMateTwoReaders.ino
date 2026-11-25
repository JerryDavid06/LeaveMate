#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <MFRC522.h>
#include <Preferences.h>
#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <algorithm>
#include <vector>
#include <esp_system.h>
#include <sys/time.h>
#include <time.h>

constexpr int CS1 = 5, CS2 = 21, RFID_RST = 22;
constexpr int IR_PIN = 25, IR_BLOCKED = LOW;
constexpr char WIFI_SSID[] = "";
constexpr char WIFI_PASSWORD[] = "";
constexpr char DEVICE_API_KEY[] = "";
constexpr char API[] = "https://leavemate-api.onrender.com";
constexpr char DEVICE_ID[] = "leavemate-rfid-01";

// Public root certificates used to validate the Render HTTPS endpoint.
constexpr char RENDER_CA[] = R"PEM(
-----BEGIN CERTIFICATE-----
MIICCTCCAY6gAwIBAgINAgPlwGjvYxqccpBQUjAKBggqhkjOPQQDAzBHMQswCQYDVQQGEwJV
UzEiMCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIGA1UEAxMLR1RTIFJv
b3QgUjQwHhcNMTYwNjIyMDAwMDAwWhcNMzYwNjIyMDAwMDAwWjBHMQswCQYDVQQGEwJVUzEi
MCAGA1UEChMZR29vZ2xlIFRydXN0IFNlcnZpY2VzIExMQzEUMBIGA1UEAxMLR1RTIFJvb3Qg
UjQwdjAQBgcqhkjOPQIBBgUrgQQAIgNiAATzdHOnaItgrkO4NcWBMHtLSZ37wWHO5t5GvWvV
YRg1rkDdc/eJkTBa6zzuhXyiQHY7qca4R9gq55KRanPpsXI5nymfopjTX15YhmUPoYRlBtHc
i8nHc8iMai/lxKvRHYqjQjBAMA4GA1UdDwEB/wQEAwIBhjAPBgNVHRMBAf8EBTADAQH/MB0G
A1UdDgQWBBSATNbrdP9JNqPV2Py1PsVq8JQdjDAKBggqhkjOPQQDAwNpADBmAjEA6ED/g94D
9J+uHXqnLrmvT/aDHQ4thQEd0dlq7A/Cr8deVl5c1RxYIigL9zC2L7F8AjEA8GE8p/SgguMh
1YQdc4acLa/KNJvxn7kjNuK8YAOdgLOaVsjh4rsUecrNIdSUtUlD
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIDdTCCAl2gAwIBAgILBAAAAAABFUtaw5QwDQYJKoZIhvcNAQEFBQAwVzELMAkGA1UEBhMC
QkUxGTAXBgNVBAoTEEdsb2JhbFNpZ24gbnYtc2ExEDAOBgNVBAsTB1Jvb3QgQ0ExGzAZBgNV
BAMTEkdsb2JhbFNpZ24gUm9vdCBDQTAeFw05ODA5MDExMjAwMDBaFw0yODAxMjgxMjAwMDBa
MFcxCzAJBgNVBAYTAkJFMRkwFwYDVQQKExBHbG9iYWxTaWduIG52LXNhMRAwDgYDVQQLEwdS
b290IENBMRswGQYDVQQDExJHbG9iYWxTaWduIFJvb3QgQ0EwggEiMA0GCSqGSIb3DQEBAQUA
A4IBDwAwggEKAoIBAQDaDuaZjc6j40+Kfvvxi4Mla+pIH/EqsLmVEQS98GPR4mdmzxzdzxtI
K+6NiY6arymAZavpxy0Sy6scTHAHoT0KMM0VjU/43dSMUBUc71DuxC73/OlS8pF94G3VNTCO
XkNz8kHp1Wrjsok6Vjk4bwY8iGlbKk3Fp1S4bInMm/k8yuX9ifUSPJJ4ltbcdG6TRGHRjcdG
snUOhugZitVtbNV4FpWi6cgKOOvyJBNPc1STE4U6G7weNLWLBYy5d4ux2x8gkasJU26Qzns3
dLlwR5EiUWMWea6xrkEmCMgZK9FGqkjWZCrXgzT/LCrBbBlDSgeF59N89iFo7+ryUp9/k5DP
AgMBAAGjQjBAMA4GA1UdDwEB/wQEAwIBBjAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBRg
e2YaRQ2XyolQL30EzTSo//z9SzANBgkqhkiG9w0BAQUFAAOCAQEA1nPnfE920I2/7LqivjTF
KDK1fPxsnCwrvQmeU79rXqoRSLblCKOzyj1hTdNGCbM+w6DjY1Ub8rrvrTnhQ7k4o+YviiY7
76BQVvnGCv04zcQLcFGUl5gE38NflNUVyRRBnMRddWQVDf9VMOyGj/8N7yy5Y0b2qvzfvGn9
LhJIZJrglfCm7ymPAbEVtQwdpf5pLGkkeB6zpxxxYu7KyJesF12KwvhHhm4qxFYxldBniYUr
+WymXUadDKqC5JlR3XC321Y9YeRq4VzW9v493kHMB65jUr9TU/Qr6cf9tveCX4XSQRjbgbME
HMUfpIBvFSDJ3gyICh3WZlXi/EjJKSZp4A==
-----END CERTIFICATE-----
)PEM";

MFRC522 reader1(CS1, MFRC522::UNUSED_PIN);
MFRC522 reader2(CS2, MFRC522::UNUSED_PIN);
String deviceKey;

void connectWiFi() {
  String ssid = WIFI_SSID, password = WIFI_PASSWORD;
  deviceKey = DEVICE_API_KEY;
  Preferences saved;
  if ((ssid.isEmpty() || deviceKey.isEmpty()) && saved.begin("leavemate", true)) {
    JsonDocument settings;
    if (!deserializeJson(settings, saved.getString("station"))) {
      if (ssid.isEmpty()) {
        ssid = settings["ssid"] | "";
        password = settings["password"] | "";
      }
      if (deviceKey.isEmpty()) deviceKey = settings["deviceKey"] | "";
    }
    saved.end();
  }
  if (ssid.isEmpty() || deviceKey.isEmpty()) {
    Serial.println("Set Wi-Fi and the LeaveMate device key. Tag reads still work over USB.");
    return;
  }
  WiFi.persistent(false);
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.begin(ssid.c_str(), password.c_str());
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
}

bool online() {
  return !deviceKey.isEmpty() && WiFi.status() == WL_CONNECTED && time(nullptr) >= 1700000000;
}

int post(const String& path, const JsonDocument& payload, String* reply) {
  WiFiClientSecure tls;
  tls.setCACert(RENDER_CA);
  HTTPClient http;
  http.setConnectTimeout(5000);
  http.setTimeout(6000);
  if (!http.begin(tls, String(API) + path)) return -1;
  http.addHeader("Content-Type", "application/json");
  http.addHeader("x-device-key", deviceKey);
  String body;
  serializeJson(payload, body);
  const int status = http.POST(body);
  if (reply && status == 202) *reply = http.getString();
  http.end();
  return status;
}

void makeId(char* id) {
  uint8_t b[16];
  esp_fill_random(b, sizeof(b));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  snprintf(id, 37,
           "%02x%02x%02x%02x-%02x%02x-%02x%02x-%02x%02x-%02x%02x%02x%02x%02x%02x",
           b[0], b[1], b[2], b[3], b[4], b[5], b[6], b[7],
           b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15]);
}

int64_t remainingMillis(const char* deadline) {
  if (strlen(deadline) != 24 || deadline[19] != '.' || deadline[23] != 'Z') return 0;
  tm date{};
  if (strptime(deadline, "%Y-%m-%dT%H:%M:%S", &date) != deadline + 19) return 0;
  for (int i = 20; i <= 22; ++i)
    if (deadline[i] < '0' || deadline[i] > '9') return 0;
  const int millisPart = (deadline[20] - '0') * 100
                       + (deadline[21] - '0') * 10 + deadline[22] - '0';
  timeval now;
  gettimeofday(&now, nullptr);
  return (static_cast<int64_t>(mktime(&date)) - now.tv_sec) * 1000
         + millisPart - now.tv_usec / 1000;
}

bool readerReady(MFRC522& reader) {
  const byte v = reader.PCD_ReadRegister(MFRC522::VersionReg);
  return v != 0x00 && v != 0xFF && v != 0xEE;
}

String scanTag(MFRC522& reader) {
  reader.PCD_AntennaOn();
  delay(5);
  String uid;
  if (reader.PICC_IsNewCardPresent() && reader.PICC_ReadCardSerial()) {
    const byte n = reader.uid.size;
    if (n > 0 && n <= 10) {
      char result[21] = {};
      for (byte i = 0; i < n; ++i)
        snprintf(result + 2 * i, 3, "%02X", static_cast<unsigned>(reader.uid.uidByte[i]));
      uid = result;
    }
    reader.PICC_HaltA();
    reader.PCD_StopCrypto1();
  }
  reader.PCD_AntennaOff();
  return uid;
}

void showTag(const String& uid, int input) {
  static String previous[2];
  static uint32_t printedAt[2] = {};
  if (uid.isEmpty()) return;
  const uint32_t now = millis();
  if (uid == previous[input] && now - printedAt[input] < 2000) return;
  previous[input] = uid;
  printedAt[input] = now;
  Serial.printf("Reader %d RFID UID: %s\n", input + 1, uid.c_str());
}

int sendReport(const String& path, const std::vector<String>& tags, bool complete) {
  JsonDocument report;
  JsonArray identifiers = report["identifiers"].to<JsonArray>();
  for (const String& uid : tags) identifiers.add(uid);
  report["complete"] = complete;
  // The server holds a short grace period for the final reply, so a slow
  // connection never discards a valid departure check.
  report["requireInWindow"] = false;
  return post(path, report, nullptr);
}

void runCheck() {
  if (!online() || !readerReady(reader1) || !readerReady(reader2)) {
    Serial.println("Check skipped. Verify Wi-Fi, time sync, and both readers.");
    return;
  }
  char id[37], stamp[25];
  makeId(id);
  const time_t now = time(nullptr);
  tm utc{};
  gmtime_r(&now, &utc);
  strftime(stamp, sizeof(stamp), "%Y-%m-%dT%H:%M:%SZ", &utc);

  JsonDocument request;
  request["id"] = id;
  request["eventType"] = "DEPARTURE_DETECTED";
  request["source"] = "hardware";
  request["timestamp"] = stamp;
  request["deviceId"] = DEVICE_ID;
  String response;
  const int status = post("/api/gateway/departures", request, &response);
  if (status != 202) {
    Serial.printf("Could not start check (HTTP %d).\n", status);
    return;
  }
  JsonDocument window;
  if (deserializeJson(window, response) || strcmp(window["id"] | "", id) != 0) return;
  const int64_t left = remainingMillis(window["deadline"] | "");
  constexpr int SEND_MARGIN_MS = 2500;
  if (left <= SEND_MARGIN_MS || left > 65000) {
    Serial.println("Scan window is too short. Check the timeout and network.");
    return;
  }

  const uint32_t duration = static_cast<uint32_t>(left - SEND_MARGIN_MS);
  const uint32_t started = millis();
  std::vector<String> tags;
  MFRC522* readers[] = {&reader1, &reader2};
  Serial.println("SCANNING: Tap your items on either reader.");
  while (millis() - started < duration && WiFi.status() == WL_CONNECTED) {
    for (int i = 0; i < 2 && millis() - started < duration; ++i) {
      const String uid = scanTag(*readers[i]);
      if (!uid.isEmpty() && std::find(tags.begin(), tags.end(), uid) == tags.end()) {
        if (tags.size() == 300) return;
        tags.push_back(uid);
        Serial.printf("Reader %d RFID UID: %s\n", i + 1, uid.c_str());
        const String path = String("/api/gateway/departures/") + id + "/reports";
        const int status = sendReport(path, tags, false);
        Serial.printf("Scan update sent (HTTP %d).\n", status);
      }
    }
  }
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Scan interrupted. Check Wi-Fi.");
    return;
  }
  const String path = String("/api/gateway/departures/") + id + "/reports";
  for (int attempt = 1; attempt <= 3; ++attempt) {
    const int status = sendReport(path, tags, true);
    Serial.printf("Final results, attempt %d (HTTP %d).\n", attempt, status);
    if (status == 204) break;
    delay(1200);
  }
}

void setup() {
  Serial.begin(115200);
  pinMode(IR_PIN, INPUT_PULLUP);
  pinMode(CS1, OUTPUT);
  pinMode(CS2, OUTPUT);
  digitalWrite(CS1, HIGH);
  digitalWrite(CS2, HIGH);
  pinMode(RFID_RST, OUTPUT);
  digitalWrite(RFID_RST, LOW);
  delay(2);
  digitalWrite(RFID_RST, HIGH);
  delay(50);

  SPI.begin(18, 19, 23, CS1);
  reader1.PCD_Init();
  reader1.PCD_AntennaOff();
  reader2.PCD_Init();
  reader2.PCD_AntennaOff();
  Serial.printf("Reader 1: 0x%02X; Reader 2: 0x%02X\n",
                static_cast<unsigned>(reader1.PCD_ReadRegister(MFRC522::VersionReg)),
                static_cast<unsigned>(reader2.PCD_ReadRegister(MFRC522::VersionReg)));
  setenv("TZ", "UTC0", 1);
  tzset();
  connectWiFi();
  Serial.println("Tap a tag to see its UID.");
}

void loop() {
  static bool raw = false, stable = false, armed = false;
  static uint32_t changedAt = 0, lastHeartbeat = millis() - 30000;
  const uint32_t now = millis();
  const bool blocked = digitalRead(IR_PIN) == IR_BLOCKED;
  if (blocked != raw) {
    raw = blocked;
    changedAt = now;
  }
  if (now - changedAt >= 60) {
    stable = raw;
    if (!stable) {
      armed = true;
    } else if (armed) {
      armed = false;
      runCheck();
    }
  }

  showTag(scanTag(reader1), 0);
  showTag(scanTag(reader2), 1);
  if (online() && readerReady(reader1) && readerReady(reader2) && now - lastHeartbeat >= 30000) {
    lastHeartbeat = now;
    JsonDocument heartbeat;
    heartbeat["deviceId"] = DEVICE_ID;
    const int status = post("/api/gateway/heartbeat", heartbeat, nullptr);
    if (status != 204) Serial.printf("Heartbeat failed (HTTP %d).\n", status);
  }
}
