#pragma once

constexpr char API_ORIGIN[] = "https://leavemate-api.onrender.com";
constexpr char STATION_ID[] = "leavemate-rfid-01";

// Classic ESP32 DevKit / ESP32-WROOM with the RC522 in SPI mode.
constexpr int RFID_SCK = 18;
constexpr int RFID_MISO = 19;
constexpr int RFID_MOSI = 23;
constexpr int RFID_CS = 5;
constexpr int RFID_RESET = 22;
constexpr int IR_INSIDE = 25;
constexpr int IR_OUTSIDE = 26;
constexpr bool IR_ACTIVE_LOW = true;
