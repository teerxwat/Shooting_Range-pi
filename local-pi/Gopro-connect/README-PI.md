# ฝั่งกล้อง (GoPro + YOLO) — เวอร์ชันสำหรับ Raspberry Pi

โฟลเดอร์นี้คือ **ก็อปปี้ของ `local/Gopro-connect`** ที่ปรับให้พร้อมรันบน **Raspberry Pi**
เดิมไฟล์ `.py` เหมือนต้นฉบับทุกตัวอักษร แต่ตอนนี้ **แก้เพิ่มเพื่อให้เสถียรบน Pi แล้ว**
(ดูหัวข้อ "สิ่งที่แก้เพิ่มใน local-pi") ไฟล์ช่วยตั้งค่าฝั่ง Pi ที่เพิ่มเข้ามา:

| ไฟล์ที่เพิ่มมา | หน้าที่ |
|---|---|
| `requirements-pi.txt` | dependency ครบสำหรับ Pi (ARM64) + opencv แบบ headless |
| `setup-pi.sh` | ลง apt + สร้าง venv + ลง pip ให้ครบในคำสั่งเดียว |
| `run-pi.sh` | รัน `server.py` แบบ headless (ไม่ต้องมีจอ) |
| `gopro-kiosk.service` | (ทางเลือก) ให้รันอัตโนมัติตอน Pi บูต ผ่าน systemd |
| `README-PI.md` | ไฟล์นี้ |

> โค้ดต้นฉบับที่รันบนโน้ตบุ๊กยังอยู่ที่ `local/Gopro-connect/` **ไม่ถูกแตะต้อง** — ใช้เทียบ/ย้อนกลับได้ตลอด

---

## ต้องมีอะไรบ้าง

- Raspberry Pi 4 (แนะนำ RAM 4GB ขึ้นไป) หรือ Pi 5
- Raspberry Pi OS **Bookworm 64-bit** (ต้อง 64-bit เพราะ torch/ultralytics ไม่รองรับ 32-bit)
- การ์ด SD 16GB+ (torch + ultralytics กินพื้นที่หลาย GB)
- Bluetooth ของ Pi เปิดอยู่ (ใช้จับคู่ GoPro ผ่าน BLE)
- อยู่วง LAN/WiFi เดียวกับกล้อง GoPro และ ESP32

---

## ติดตั้ง (ทำครั้งเดียว)

```bash
cd ~/Shooting_Range/v2/local-pi/Gopro-connect   # ปรับ path ตามที่วางโปรเจกต์
bash setup-pi.sh
```

`setup-pi.sh` จะ:
1. ลง `ffmpeg`, `bluez`, ไลบรารีระบบที่ opencv/torch ต้องใช้
2. เปิดบริการ Bluetooth
3. สร้าง virtualenv `.venv` แล้วลง `requirements-pi.txt` (ตอนลง torch จะนานหน่อย)
4. ก็อป `.env.example` เป็น `.env` ให้ (ถ้ายังไม่มี)

จากนั้น **แก้ค่าใน `.env`** ให้ตรงกับหน้างาน:

```bash
nano .env
```

ค่าที่ต้องเช็ก: `CH*_CAM*_IP` (IP กล้อง), `ESP32_CH*_MAC`, และกลุ่ม `CLOUD_URL` / `CLOUD_API_KEY` / `CLOUD_UPLOAD`

---

## รัน

```bash
bash run-pi.sh
```

เปิดที่ `http://<ip-ของ-pi>:8000` — ให้จอ kiosk ฝั่ง web (`v2/web`, `npm run dev`) ชี้มาที่ IP ของ Pi ตัวนี้แทน IP ของ Mac

หยุดด้วย `Ctrl+C`

### ให้รันเองตอนบูต (ทางเลือก)

ดูวิธีในหัวไฟล์ `gopro-kiosk.service` — คัดไปไว้ที่ `/etc/systemd/system/` แล้ว `systemctl enable --now`

---

## จุดที่ต่างจากบน Mac (สิ่งที่ควรรู้)

**1. ความเร็ว YOLO ต่ำลง** — Pi ไม่มี GPU/Neural Engine แบบ Mac รันบน CPU ล้วน
FPS การตรวจจับท่าจะน้อยกว่า ถ้าช้าเกินไปลองปรับใน `.env`:
- ใช้โมเดล `yolo11n-pose.pt` (nano) ที่ให้มาแล้ว — เบาสุด อย่าเปลี่ยนเป็นตัวใหญ่กว่า
- ลด `RECORD_SECONDS` / ปรับค่า `DETECT_*` ให้ตรวจจับหยาบลงถ้าจำเป็น
- (ขั้นสูง) export โมเดลเป็น **NCNN** เพื่อเร่งความเร็วบน ARM — เป็นการปรับฝั่งโหลดโมเดล ทำเพิ่มทีหลังได้ ยังไม่รวมมาในนี้เพราะจะต้องแก้ logic

**2. เข้ารหัสวิดีโอช้าลง** — โค้ดใช้ `libx264` (ซอฟต์แวร์, ข้ามแพลตฟอร์มได้อยู่แล้ว)
บน Pi การ render/convert จะกินเวลากว่า Mac ถ้าช้ามากค่อยพิจารณา hardware encoder (`h264_v4l2m2m`) ภายหลัง

**3. Bluetooth ใช้ BlueZ** — `open_gopro` บน Linux คุย BLE ผ่าน BlueZ (ลงให้แล้วใน setup)
ถ้าจับคู่กล้องไม่เจอ: `sudo systemctl status bluetooth` และเช็กว่า Pi กับกล้องอยู่ในระยะ

**4. รันแบบ headless** — `run-pi.sh` ตั้ง `QT_QPA_PLATFORM=offscreen` ให้ ไม่ต้องต่อจอ
(`server.py` ไม่เปิดหน้าต่าง cv2 อยู่แล้ว — ส่วนที่เปิดหน้าต่างคือ `main.py` ซึ่งเป็นโหมด debug บนเครื่องมีจอเท่านั้น)

**5. Firewall** — Pi ปกติไม่มี firewall บล็อก UDP เหมือน macOS แต่ถ้าเปิด `ufw` ไว้
ต้องอนุญาตพอร์ต UDP `12344/12345` (คุย ESP32) และ TCP `8000` (web/kiosk)

---

## สิ่งที่แก้เพิ่มใน local-pi (ต่างจาก `local/`)

แก้อาการ "ภาพสดขึ้นช้า / บางทีดึงภาพไม่ได้ / สั่งอัดบางทีไม่ติด":

| ไฟล์ | แก้อะไร |
|---|---|
| `detect_stream.py` | คำสั่ง ffmpeg ลดเวลา probe + buffer (เฟรมแรก 8.0s → 1.7s ไม่มีภาพค้างสะสม), นับว่าต่อสำเร็จเมื่อได้เฟรมจริง (เดิม ffmpeg ตายก็ผ่าน), ยกเลิกได้ระหว่างต่อ stream, เช็ค status 55 แล้วโหลด `LIVE_PRESET_ID` ถ้ากล้องไม่ส่งภาพ, ทิ้งเฟรมที่ decode พัง (`discardcorrupt`), เก็บ log ffmpeg ไว้ที่ `.session/ffmpeg_stream.log`, จำกัด thread ของ YOLO |
| `uploader.py` + `save.py` + `gopro.py` | อัปคลาวด์สำเร็จแล้วลบไฟล์ต้นฉบับบนกล้อง (`DELETE_AFTER_UPLOAD=1`) กันเมมกล้องเต็ม, ดาวน์โหลดจากกล้องค้างท้ายไฟล์ → resume ภายใน ~6 วิ (เดิมรอ 45 วิ) |
| `server.py` (เพิ่ม) | แปลงไฟล์ + อัปโหลดเป็นคิวเบื้องหลัง (ลูกค้าไม่ต้องรอหน้าจอโหลด), ปุ่ม "จบการใช้งาน" (`POST /api/channels/{ch}/end`) |
| `session_reports.py` (ใหม่) | popup จบการใช้งาน: รายชื่อผู้ดูแล (`GET /api/staff`) + รายงานจบเซสชัน/ค่าคอมมิชชั่น เก็บในเครื่องแล้วส่งขึ้นคลาวด์เบื้องหลัง — สเปกเต็มใน `server/STAFF_COMMISSION_API.md` |

### รายชื่อผู้ดูแล (popup จบการใช้งาน)

ระหว่างที่เซิร์ฟเวอร์หลักยังไม่มี API รายชื่อ ให้สร้างไฟล์ `staff.json` ข้าง `server.py` (คัดจาก `staff.example.json`):

```json
[
  { "id": "1", "name": "สมชาย ใจดี" },
  { "id": "2", "name": "สมหญิง รักงาน" }
]
```

แก้ไฟล์แล้วมีผลทันทีตอนเปิด popup ครั้งถัดไป ไม่ต้อง restart — ใช้ `id` ชุดเดียวกับที่จะใส่ในตาราง `staff` บนเซิร์ฟเวอร์ภายหลัง
| `server.py` | กันภาพสดกับรอบอัดแย่งกล้อง/พอร์ตกัน (รอภาพสดปิดจริงก่อนเริ่ม), กล้องออฟไลน์เมื่อพลาดติดกัน 3 รอบ, ไฟล์ที่กำลังแปลงไม่โผล่ในรายการคลิป, แปลงไฟล์ด้วย `nice` + เลือก `TRANSCODE_HWACCEL` ได้ |
| `gopro.py` | `start_recording` รอกล้องว่าง (status 8/10) ก่อนกด shutter และลองใหม่เมื่อกล้องตอบ error, timeout คำสั่งควบคุมสั้นลง |
| `recorder.py` | รอกล้องสลับ preset เสร็จ, อ่าน state ไม่ได้จะไม่กด shutter ซ้ำ, ตั้งความละเอียด/fps ตาม `VIDEO_RES_CODE` / `VIDEO_FPS_CODE` |
| `config.py` | อ่าน `VIDEO_RES_CODE` / `VIDEO_FPS_CODE` |

> ไฟล์ H.264 ที่แปลงแล้ว **ยังเป็น 240fps ตามเดิมโดยตั้งใจ** เพราะคลาวด์ใช้ไฟล์นี้เป็นต้นฉบับทำ slow-mo ที่ขาย

### แปลงไฟล์ช้า (~2 นาทีต่อคลิป)

สาเหตุ: กล้องอัด **4K 240fps** (~2,760 เฟรม/คลิป 11 วิ) → Pi ต้อง decode 4K ทุกเฟรม ย่อเป็น 1080p แล้ว encode ใหม่
และ **การ decode 4K ด้วย CPU กินเวลาเกินครึ่ง** (39 เฟรม/วิ) — เปลี่ยน preset x264 อย่างเดียวจึงแทบไม่ช่วย

วัดบน Pi 5 จริง (ตัดคลิป S2-0074 มา 719 เฟรม, ประมาณเวลาเต็มคลิปตามสัดส่วน):

| แบบ | 719 เฟรม | เต็มคลิป (ประมาณ) |
|---|---|---|
| เดิม: CPU decode → `veryfast` | 27.6s | ~2 นาที (log จริง 123s) |
| CPU decode → `superfast` | 26.9s | แทบไม่ต่าง |
| **`TRANSCODE_HWACCEL=drm` → `superfast` (แนะนำ)** | **14.0s** | **~1 นาที** |
| อัด 1080p (`VIDEO_RES_CODE=9`) → `superfast` | 8.1s ต่อ 480 เฟรม | ~55 วิ แต่ภาพคมน้อยกว่า |

- hardware decode (`drm`) ให้ภาพ **เหมือน CPU decode ทุกพิกเซล** (SSIM = 1.000000) และยังย่อจาก 4K เหมือนเดิม
- ใช้แค่ใส่ `TRANSCODE_HWACCEL=drm` ใน `.env` (preset `superfast` เป็นค่าเริ่มต้นในโค้ดแล้ว) — ดูเวลาจริงใน log บรรทัด `แปลง H.264 เสร็จใน ...s`
- ถ้าเลือกอัด 1080p ด้วย: ดู log ตอนเตรียมกล้องว่าขึ้น `mode=9, fps=0` — ถ้าขึ้น `ตั้ง resolution ... ไม่สำเร็จ` แปลว่ากล้องไม่รองรับ

### เช็กฮาร์ดแวร์ Pi (ทำก่อนถ้ายังมีอาการ)

```bash
vcgencmd get_throttled     # ต้องได้ throttled=0x0 (ไม่ใช่ = ไฟไม่พอ/ร้อน)
lsusb -t                   # กล้องต้องขึ้น 5000M (ถ้า 480M = เสียบพอร์ต USB 2.0 สีดำ → ย้ายไปพอร์ตสีฟ้า)
dmesg -w                   # ถ้ากล้องหลุดจะเห็น "USB disconnect" / "over-current"
journalctl -u gopro-kiosk -f
```

Pi 5 ที่ไม่ได้ใช้อะแดปเตอร์ 5A (27W) จะจ่ายไฟ USB รวมทุกพอร์ตได้แค่ 600mA — กล้องที่ชาร์จผ่าน USB อาจดึงเกินจนหลุด

### เช็กความเร็วแปลงไฟล์

```bash
ffmpeg -benchmark -i downloads/clips/ch1/originals/<ไฟล์>.mp4 -f null -
ffmpeg -benchmark -hwaccel drm -i downloads/clips/ch1/originals/<ไฟล์>.mp4 -f null -
```

ถ้าบรรทัดที่ 2 ไม่ error และ `speed=` สูงกว่าบรรทัดแรกชัดเจน → ตั้ง `TRANSCODE_HWACCEL=drm` ใน `.env`

---

## แก้ปัญหาที่พบบ่อย

| อาการ | ทางแก้ |
|---|---|
| `pip install` torch ล้มเหลว / ช้ามาก | ยืนยันว่าเป็น Pi OS **64-bit** (`uname -m` ต้องขึ้น `aarch64`) |
| `ImportError: libGL.so.1` ตอน import cv2 | `sudo apt install -y libgl1 libglib2.0-0` (setup ลงให้แล้ว) |
| จับคู่ GoPro ไม่เจอ | เปิด Bluetooth: `sudo systemctl enable --now bluetooth` แล้วลองใหม่ |
| จอ kiosk ต่อไม่ติด | ชี้ web ไปที่ IP ของ **Pi** ไม่ใช่ Mac และเช็กว่าอยู่วง LAN เดียวกัน |
| RAM ไม่พอตอนโหลดโมเดล | ใช้ Pi ที่ RAM ≥ 4GB และปิดโปรแกรมอื่น |

---

## ขยายไปหลายเลน (clone Pi เครื่องนี้ไปเครื่องใหม่)

จะ setup เร็วสุดคือ **clone ทั้ง SD card** (dd / Raspberry Pi Imager "Duplicate SD Card")
จากเครื่องต้นแบบไปลง SD card ใบใหม่ — ได้ `.venv`/`node_modules` ที่ลงไว้แล้วติดไปด้วยเลย
ไม่ต้องมานั่งลง torch ใหม่ (ช้าสุดตอน setup)

แต่การ clone ทั้ง OS จะติด hostname / SSH key / เลขนับ session ของเครื่องต้นแบบไปด้วย
ถ้าไม่แก้จะชนกับเครื่องต้นแบบตอนต่อ LAN เดียวกัน — รันสคริปต์นี้ **ครั้งเดียว** หลังบูต
เครื่องใหม่ครั้งแรก (ก่อนเสียบกล้อง/ESP32):

```bash
cd ~/Desktop/Shooting_Range/v2/local-pi
sudo bash clone-setup.sh 2      # 2 = เลขเลนของเครื่องนี้ (เครื่องต่อไปใส่ 3, 4, ...)
```

จะตั้ง hostname (`7lnetwork-s2`), gen SSH key/machine-id ใหม่, ตั้ง `LANE_ID=2` ใน `.env`,
และล้าง session/คลิปเก่าของเครื่องต้นแบบทิ้งให้อัตโนมัติ — เหลือแค่ 2 จุดที่ต้องแก้เอง
(สคริปต์รู้แทนไม่ได้เพราะเป็นของเฉพาะเลนนั้นจริงๆ): IP กล้อง/MAC ESP32 ใน `.env` และจับคู่
BLE กับกล้องตัวใหม่ (`ble_pair.py`) — รายละเอียดสคริปต์จะบอกตอนรันจบ

---

## หมายเหตุ

ทั้งหมดนี้แยกขาดจากของเดิม — ทดสอบ Pi ในโฟลเดอร์นี้ได้เต็มที่ ของบนโน้ตบุ๊กที่ `local/` ไม่ได้รับผลกระทบ
