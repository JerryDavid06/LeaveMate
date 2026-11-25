#include "station.h"

#include <Arduino.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <MFRC522.h>
#include <Preferences.h>
#include <SPI.h>
#include <WiFi.h>
#include <WiFiClientSecure.h>
#include <esp_system.h>
#include <sys/time.h>
#include <time.h>

#include <algorithm>
#include <array>
#include <atomic>
#include <cstdlib>
#include <cstring>
#include <vector>

#include "config.h"
#include "direction.h"
#include "render-ca.h"
#if __has_include("secrets.h")
#include "secrets.h"
#else
#include "secrets.example.h"
#endif

namespace station {
namespace {

constexpr uint32_t heartbeatMs = 30000;
constexpr uint32_t wifiRetryMs = 30000;
constexpr uint32_t sendLeadMs = 1500;
constexpr size_t maxIdentifiers = 300;
constexpr char departuresPath[] = "/api/gateway/departures";
constexpr char settingsNamespace[] = "leavemate";
constexpr char settingsKey[] = "station";
constexpr size_t maxSetupLine = 2048;
using Tag = std::array<char, 21>;

MFRC522 reader(RFID_CS, RFID_RESET);
DebouncedInput insideSensor, outsideSensor;
DirectionTracker direction;
QueueHandle_t scannedTags = nullptr;
SemaphoreHandle_t scanLock = nullptr;
TaskHandle_t networkTask = nullptr;
std::atomic<bool> readerOnline{false};
std::atomic<bool> scanOpen{false};
std::atomic<bool> scanFault{false};
std::atomic<bool> busy{false};
String deviceKey;
bool awaitingSetup = false;

bool readSetup(const String& line, JsonDocument& settings) {
  if (deserializeJson(settings, line, DeserializationOption::NestingLimit(2))) return false;
  if (!settings["ssid"].is<const char*>() || !settings["password"].is<const char*>() ||
      !settings["deviceKey"].is<const char*>()) return false;
  const auto ssid = settings["ssid"].as<JsonString>();
  const auto password = settings["password"].as<JsonString>();
  const auto key = settings["deviceKey"].as<JsonString>();
  return ssid.size() > 0 && ssid.size() <= 32 && strlen(ssid.c_str()) == ssid.size() &&
         password.size() <= 64 && strlen(password.c_str()) == password.size() &&
         key.size() > 0 && key.size() <= 128 && strlen(key.c_str()) == key.size() &&
         !strpbrk(key.c_str(), "\r\n");
}

void pollSetup() {
  static String line;
  static bool tooLong = false;
  for (size_t i = 0; i < 128 && Serial.available(); i++) {
    const char ch = static_cast<char>(Serial.read());
    if (ch != '\n') {
      if (!tooLong && ch != '\r') tooLong = line.length() >= maxSetupLine || !line.concat(ch);
      continue;
    }
    JsonDocument settings;
    if (!tooLong && readSetup(line, settings)) {
      Preferences storage;
      if (storage.begin(settingsNamespace) && storage.putString(settingsKey, line) == line.length()) {
        storage.end();
        Serial.println("SETUP_SAVED");
        Serial.flush();
        ESP.restart();
        return;
      }
      Serial.println("SETUP_STORAGE_ERROR");
    } else {
      Serial.println("SETUP_INVALID");
    }
    line = "";
    tooLong = false;
  }
}

bool readerResponds() {
  const byte version = reader.PCD_ReadRegister(MFRC522::VersionReg);
  return version != 0 && version != 0xff && version != 0xee;
}

bool hasNetworkTime() {
  return WiFi.status() == WL_CONNECTED && time(nullptr) >= 1700000000;
}

int64_t unixMilliseconds() {
  timeval now;
  gettimeofday(&now, nullptr);
  return static_cast<int64_t>(now.tv_sec) * 1000 + now.tv_usec / 1000;
}

int64_t deadlineMilliseconds(const char* value) {
  if (!value || strlen(value) != 24 || value[19] != '.' || value[23] != 'Z') return 0;
  tm utc{};
  const char* suffix = strptime(value, "%Y-%m-%dT%H:%M:%S", &utc);
  if (!suffix || suffix != value + 19) return 0;
  unsigned fraction = 0;
  for (size_t i = 20; i < 23; i++) {
    if (value[i] < '0' || value[i] > '9') return 0;
    fraction = fraction * 10 + value[i] - '0';
  }
  return static_cast<int64_t>(mktime(&utc)) * 1000 + fraction;
}

void eventUuid(char (&id)[37]) {
  std::array<uint8_t, 16> random{};
  esp_fill_random(random.data(), random.size());
  random[6] = (random[6] & 0x0f) | 0x40;
  random[8] = (random[8] & 0x3f) | 0x80;
  constexpr char hex[] = "0123456789abcdef";
  size_t out = 0;
  for (size_t i = 0; i < random.size(); i++) {
    if (i == 4 || i == 6 || i == 8 || i == 10) id[out++] = '-';
    id[out++] = hex[random[i] >> 4];
    id[out++] = hex[random[i] & 0x0f];
  }
  id[out] = 0;
}

int post(const String& path, const JsonDocument& document, String* response = nullptr) {
  WiFiClientSecure connection;
  connection.setCACert(RENDER_CA);
  HTTPClient request;
  request.setConnectTimeout(8000);
  request.setTimeout(12000);
  request.setFollowRedirects(HTTPC_DISABLE_FOLLOW_REDIRECTS);
  if (!request.begin(connection, String(API_ORIGIN) + path)) return -1;
  request.addHeader("Content-Type", "application/json");
  request.addHeader("x-device-key", deviceKey);
  String body;
  serializeJson(document, body);
  const int status = request.POST(body);
  if (response && status == 202) *response = request.getString();
  request.end();
  return status;
}

void heartbeat() {
  JsonDocument body;
  body["deviceId"] = STATION_ID;
  const int status = post("/api/gateway/heartbeat", body);
  if (status != 204) {
    Serial.printf("Heartbeat failed (HTTP %d).\n", status);
  } else {
    static bool first = true;
    if (first) Serial.println("Connected to LeaveMate.");
    first = false;
  }
}

bool addTag(std::vector<Tag>& seen, const Tag& tag) {
  if (std::find(seen.begin(), seen.end(), tag) != seen.end()) return true;
  if (seen.size() >= maxIdentifiers) return false;
  seen.push_back(tag);
  return true;
}

void verifyDeparture() {
  if (!hasNetworkTime() || !readerOnline.load()) {
    Serial.println("Departure skipped. Check Wi-Fi, clock synchronization and RC522.");
    return;
  }

  const time_t timeNow = time(nullptr);
  tm utc{};
  gmtime_r(&timeNow, &utc);
  char timestamp[26];
  strftime(timestamp, sizeof(timestamp), "%Y-%m-%dT%H:%M:%SZ", &utc);
  char id[37];
  eventUuid(id);
  JsonDocument departure;
  departure["id"] = id;
  departure["eventType"] = "DEPARTURE_DETECTED";
  departure["source"] = "hardware";
  departure["timestamp"] = timestamp;
  departure["deviceId"] = STATION_ID;

  String response;
  const int status = post(departuresPath, departure, &response);
  if (status != 202) {
    Serial.printf("Could not open a verification (HTTP %d).\n", status);
    return;
  }
  JsonDocument window;
  if (deserializeJson(window, response)) {
    Serial.println("Could not read the server verification window.");
    return;
  }
  const char* sessionId = window["id"] | "";
  const int64_t remaining = deadlineMilliseconds(window["deadline"] | "") - unixMilliseconds();
  if (strcmp(sessionId, id) != 0 || remaining <= sendLeadMs || remaining > 65000) {
    Serial.println("Verification deadline is unavailable or too close. Check the clock and scan timeout.");
    return;
  }

  xQueueReset(scannedTags);
  scanFault.store(false);
  const auto scanLength = static_cast<uint32_t>(remaining) - sendLeadMs;
  const uint32_t started = millis();
  std::vector<Tag> seen;
  seen.reserve(16);
  scanOpen.store(true);
  Serial.printf("Scan open for %.1f seconds. Tap one item tag at a time.\n", scanLength / 1000.0);
  while (millis() - started < scanLength && !scanFault.load() && WiFi.status() == WL_CONNECTED) {
    Tag tag{};
    if (xQueueReceive(scannedTags, &tag, pdMS_TO_TICKS(40)) == pdTRUE && !addTag(seen, tag)) {
      scanFault.store(true);
    }
  }
  xSemaphoreTake(scanLock, portMAX_DELAY);
  scanOpen.store(false);
  xSemaphoreGive(scanLock);

  Tag pending{};
  while (xQueueReceive(scannedTags, &pending, 0) == pdTRUE) {
    if (!addTag(seen, pending)) scanFault.store(true);
  }
  if (scanFault.load() || !readerOnline.load() || WiFi.status() != WL_CONNECTED) {
    Serial.println("Scan interrupted. LeaveMate will mark this verification as failed.");
    return;
  }

  JsonDocument report;
  JsonArray tags = report["identifiers"].to<JsonArray>();
  for (const auto& tag : seen) tags.add(tag.data());
  report["complete"] = true;
  report["requireInWindow"] = true;
  const String reportPath = String(departuresPath) + "/" + id + "/reports";
  const int complete = post(reportPath, report);
  if (complete == 204) {
    Serial.printf("Scan submitted with %u unique tag(s).\n", static_cast<unsigned>(seen.size()));
  } else {
    Serial.printf("Scan submission failed (HTTP %d). Check LeaveMate before trying again.\n", complete);
  }
}

void networkLoop(void*) {
  uint32_t lastHeartbeat = millis() - heartbeatMs;
  uint32_t lastWifiRetry = millis();
  bool clockReady = false;
  for (;;) {
    if (ulTaskNotifyTake(pdTRUE, pdMS_TO_TICKS(150)) > 0) {
      verifyDeparture();
      busy.store(false);
    }
    const uint32_t now = millis();
    if (WiFi.status() == WL_CONNECTED) {
      lastWifiRetry = now;
    } else if (now - lastWifiRetry >= wifiRetryMs) {
      lastWifiRetry = now;
      WiFi.reconnect();
    }
    const bool ready = hasNetworkTime();
    if (ready && !clockReady) Serial.println("Wi-Fi clock synchronized.");
    clockReady = ready;
    if (!busy.load() && ready && readerOnline.load() && now - lastHeartbeat >= heartbeatMs) {
      lastHeartbeat = now;
      heartbeat();
    }
  }
}

void readTag() {
  if (!reader.PICC_IsNewCardPresent()) return;
  if (!reader.PICC_ReadCardSerial()) {
    static uint32_t lastWarning = 0;
    const uint32_t now = millis();
    if (now - lastWarning >= 1000) {
      Serial.println("RC522 saw a tag but could not read its UID.");
      lastWarning = now;
    }
    return;
  }
  if (!readerOnline.exchange(true)) Serial.println("RC522 responding again.");
  const auto uidSize = reader.uid.size;
  if (uidSize > 0 && uidSize <= 10) {
    Tag id{};
    constexpr char hex[] = "0123456789ABCDEF";
    for (byte i = 0; i < uidSize; i++) {
      id[2 * i] = hex[reader.uid.uidByte[i] >> 4];
      id[2 * i + 1] = hex[reader.uid.uidByte[i] & 0x0f];
    }
    if (scanOpen.load()) {
      xSemaphoreTake(scanLock, portMAX_DELAY);
      if (scanOpen.load() && xQueueSend(scannedTags, &id, 0) != pdTRUE) scanFault.store(true);
      xSemaphoreGive(scanLock);
    }
    Serial.printf("RFID UID: %s\n", id.data());
  }
  reader.PICC_HaltA();
  reader.PCD_StopCrypto1();
}

bool triggered(int pin) {
  return digitalRead(pin) == (IR_ACTIVE_LOW ? LOW : HIGH);
}

}  // namespace

void setup() {
  Serial.setRxBufferSize(maxSetupLine + 2);
  Serial.begin(115200);
  pinMode(IR_INSIDE, INPUT);
  pinMode(IR_OUTSIDE, INPUT);
  SPI.begin(RFID_SCK, RFID_MISO, RFID_MOSI, RFID_CS);
  reader.PCD_Init();
  delay(100);
  const byte version = reader.PCD_ReadRegister(MFRC522::VersionReg);
  Serial.printf("RC522 firmware version 0x%02X.\n", static_cast<unsigned>(version));
  readerOnline.store(readerResponds());
  if (!readerOnline.load()) Serial.println("RC522 not responding. Check its SPI wiring and 3.3 V power.");

  Serial.println("LeaveMate station. Tap a tag to display its Detection identifier.");
  String ssid = WIFI_SSID;
  String password = WIFI_PASSWORD;
  deviceKey = DEVICE_API_KEY;
  if (ssid.isEmpty() || deviceKey.isEmpty()) {
    Preferences storage;
    JsonDocument settings;
    if (!storage.begin(settingsNamespace, true) || !readSetup(storage.getString(settingsKey), settings)) {
      awaitingSetup = true;
      Serial.println("SETUP_REQUIRED");
      return;
    }
    ssid = settings["ssid"].as<String>();
    password = settings["password"].as<String>();
    deviceKey = settings["deviceKey"].as<String>();
  }

  setenv("TZ", "UTC0", 1);
  tzset();
  WiFi.onEvent([](WiFiEvent_t event, WiFiEventInfo_t info) {
    if (event == ARDUINO_EVENT_WIFI_STA_GOT_IP) {
      Serial.println("Wi-Fi connected.");
    } else if (event == ARDUINO_EVENT_WIFI_STA_DISCONNECTED) {
      Serial.printf("Wi-Fi disconnected (reason %u).\n", static_cast<unsigned>(info.wifi_sta_disconnected.reason));
    }
  });
  WiFi.mode(WIFI_STA);
  WiFi.setAutoReconnect(true);
  WiFi.persistent(false);
  WiFi.begin(ssid.c_str(), password.c_str());
  configTime(0, 0, "pool.ntp.org", "time.nist.gov");
  scannedTags = xQueueCreate(48, sizeof(Tag));
  scanLock = xSemaphoreCreateMutex();
  if (!scannedTags || !scanLock || xTaskCreate(networkLoop, "gateway", 12288, nullptr, 1, &networkTask) != pdPASS) {
    Serial.println("Could not start the network task.");
  }
}

void poll() {
  if (awaitingSetup) pollSetup();
  const uint32_t now = millis();
  static uint32_t readerChecked = now;
  if (now - readerChecked >= 1000) {
    readerChecked = now;
    const bool available = readerResponds();
    const bool wasAvailable = readerOnline.exchange(available);
    if (!available && wasAvailable) Serial.println("RC522 not responding. Check its SPI wiring and 3.3 V power.");
    if (available && !wasAvailable) Serial.println("RC522 responding again.");
    if (scanOpen.load() && !available) scanFault.store(true);
  }

  const bool inside = insideSensor.update(triggered(IR_INSIDE), now);
  const bool outside = outsideSensor.update(triggered(IR_OUTSIDE), now);
  static bool lastInside = inside;
  static bool lastOutside = outside;
  if (inside != lastInside || outside != lastOutside) {
    Serial.printf("IR inside GPIO%d %s, outside GPIO%d %s.\n", IR_INSIDE, inside ? "blocked" : "clear",
                  IR_OUTSIDE, outside ? "blocked" : "clear");
    lastInside = inside;
    lastOutside = outside;
  }
  const Passage passage = direction.update(inside, outside, now);
  if (passage == Passage::Departure) {
    if (networkTask && !busy.exchange(true)) {
      Serial.println("Exit detected. Opening verification...");
      xTaskNotifyGive(networkTask);
    } else {
      Serial.println("Exit detected. Gateway is in setup mode or handling another check.");
    }
  } else if (passage == Passage::Arrival) {
    Serial.println("Entry detected.");
  }

  readTag();
  delay(5);
}

}  // namespace station
