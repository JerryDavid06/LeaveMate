# LeaveMate with two RC522 readers and one IR sensor

Open `LeaveMateTwoReaders.ino` in Arduino IDE. Select **ESP32 Dev Module** and install **MFRC522 1.4.12** and **ArduinoJson 7.4.3**. Open Serial Monitor at **115200 baud** after uploading.

Unplug USB before wiring. Use the labels printed on the modules and the ESP32.

| RC522 pin | Reader 1 to ESP32 | Reader 2 to ESP32 |
| --- | --- | --- |
| SDA / SS | D5 | D21 |
| SCK | D18 | D18 |
| MISO | D19 | D19 |
| MOSI | D23 | D23 |
| RST | D22 | D22 |
| 3.3V | 3V3 | 3V3 |
| GND | GND | GND |
| IRQ | Leave disconnected | Leave disconnected |

Connect the IR module output to **D25** and ground to **GND**. The sketch uses an active-low input. Choose the module supply according to its specifications and use a 3.3 V-compatible output at D25. A single IR sensor triggers a check when blocked in either direction.

The sketch defaults to the deployed LeaveMate API. Its Wi-Fi and gateway key fields are blank. An ESP32 with saved LeaveMate credentials can reuse them after a normal upload that preserves flash settings. On a new or erased board, fill in the Wi-Fi fields and the same device key configured on the LeaveMate API. Keep that key private. For a separate deployment, change the API origin and use the trust roots appropriate to that HTTPS endpoint.

In Serial Monitor, check both startup version values before testing tags. Values of `0x00`, `0xFF` or `0xEE` do not confirm a responding reader. Each reader should print a tag UID when tested. Copy each UID into its item's **Detection identifier** in LeaveMate. To test an alert, enable monitoring for the enrolled items, block the IR sensor, then wait for `SCANNING` and tap the tags you carried.

This sketch includes the shared D22 reset correction and was compiled for ESP32 Dev Module. Both physical readers still need a successful test.
