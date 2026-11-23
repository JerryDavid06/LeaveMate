# LeaveMate RFID station

This sketch uses a classic **ESP32 DevKit / ESP32-WROOM**, an **RC522** RFID reader and two digital IR obstacle sensor modules. The inside sensor followed by the outside sensor opens a verification. The reverse order is treated as an entry. Tap each RFID tag on the reader while the scan is open.

## Wiring

Disconnect power while wiring. Use the ESP32 pin numbers printed on your board. The following map assumes a classic ESP32, not an ESP32-C3 or ESP32-S3.

| Module pin | ESP32 connection |
| --- | --- |
| RC522 3.3V | 3V3 |
| RC522 GND | GND |
| RC522 SCK | GPIO18 |
| RC522 MISO | GPIO19 |
| RC522 MOSI | GPIO23 |
| RC522 SDA / SS | GPIO21 |
| RC522 RST | GPIO22 |
| RC522 IRQ | Leave disconnected |
| Inside IR OUT | GPIO25 |
| Outside IR OUT | GPIO26 |
| Both IR GND pins | GND |

Check the supply rating and digital output voltage of your exact IR boards. A module that functions on 3.3 V can share the ESP32 3V3 supply. If a 5 V module drives OUT at 5 V, use a suitable level shifter at OUT before connecting it to an ESP32 input. The sketch assumes active-low IR outputs. Edit `IR_ACTIVE_LOW` in `config.h` if both modules are active-high.

Mount the IR sensors at two points along the same lane, one on the inside and one nearer the outside. Aim and tune them so a single person reliably triggers one before the other. Place the RC522 beside the exit within reach. The RC522 reads at close range, so present each tag individually. Use compatible 13.56 MHz ISO/IEC 14443A tags. [RC522 datasheet](https://www.nxp.com/docs/en/data-sheet/MFRC522.pdf) · [ESP32 DevKitC pinout](https://docs.espressif.com/projects/esp-dev-kits/en/latest/esp32/esp32-devkitc/user_guide.html)

## Upload and enroll tags

1. Open `LeaveMateStation/LeaveMateStation.ino` in Arduino IDE. For the classic ESP32, select **ESP32 Dev Module** in the Espressif ESP32 board package. This release uses the ESP32 Arduino core **2.0.17**, **MFRC522 1.4.12**, and **ArduinoJson 7.4.3**.
2. Place your private `secrets.h` beside the sketch and fill in `WIFI_SSID` and `WIFI_PASSWORD`. Keep the gateway key that was supplied in that file. If you are hosting your own copy, duplicate `secrets.example.h` as `secrets.h` and use the same `DEVICE_API_KEY` as your backend.
3. Upload the sketch and open Serial Monitor at **115200 baud**. Tap and remove each tag before the next one. Copy the complete value after `RFID UID:` into **Detection identifier** when adding or editing that belonging in LeaveMate. The firmware prints uppercase hexadecimal with no spaces. Enable monitoring for the belongings you want checked.
4. In LeaveMate **Settings → General**, use a **15-second verification timeout** for the first physical test. The station reserves the last 1.5 seconds to deliver the readings. Press **Test voice** under Voice alerts if your browser needs an audio gesture.

## First doorway test

1. After Wi-Fi and clock synchronization, the station sends heartbeats. Wait for **Hardware Connected** in LeaveMate. A cold start on free Render can delay the first heartbeat.
2. Walk past the inside sensor, then the outside sensor. Wait for **Live verification** on the dashboard or `Scan open` in Serial Monitor, then tap the enrolled tags you carried. The server marks any monitored item without a matching read as missing.
3. Walk back in through the outside sensor first. Serial Monitor should print `Entry detected.` and the app should stay idle.
4. Repeat the exit with one enrolled item left behind. Confirm that LeaveMate flags the missing item in the Hardware session, then acknowledge the alert.

If you only want to enroll tags, run the sketch without `secrets.h`. It will still print tag UIDs. If both IR sensors trigger together, the station waits for the lane to clear before arming. Tighten their sensing zones or separate them slightly if ordinary walks keep producing simultaneous detections.

## Network connection

The station talks directly to the hosted Render API. It validates Render's HTTPS certificate and syncs its clock over NTP before reporting events. Use `config.h` for board pin changes and the API origin. If you change the API hostname to one with a different certificate authority, replace the trusted public roots in `render-ca.h` accordingly.

The station batches unique reads into one completion report. A late report or interrupted scan fails the verification so a network or reader problem cannot turn all recorded reads into a missing-item alert. Wi-Fi and the device key live in `secrets.h`, which is ignored by Git.

GitHub Actions also produces firmware without credentials. A fresh station flashed with that build prints `SETUP_REQUIRED` at 115200 baud. To configure it over USB, send one UTF-8 JSON line with the string fields `ssid`, `password`, and `deviceKey`. The station saves the settings in flash and restarts after printing `SETUP_SAVED`. Use a local serial connection to provide the settings. The firmware does not echo them. A build with a populated `secrets.h` uses that file's values.
