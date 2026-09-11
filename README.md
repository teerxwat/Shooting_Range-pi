# Shooting Range — v2

```
v2/
├── web/       React (Vite) — โค้ดชุดเดียว รันได้ 2 หน้า
│   ├── src/kiosk/      จอที่สนาม        → พอร์ต 5173
│   ├── src/customer/   หน้าดาวน์โหลด    → พอร์ต 5174
│   └── src/shared/     ใช้ร่วมกัน
│
├── server/    Node + Express + MySQL — เก็บคลิป / ขาย / สถิติ  → พอร์ต 8080
│
└── local/Gopro-connect/   Python — คุมกล้อง GoPro + YOLO  → พอร์ต 8000
                           (ต้องเป็น Python เพราะใช้ YOLO)
```

ต้องมี: **Node 18+** · **ffmpeg** · **MySQL**

```bash
brew install ffmpeg mysql && brew services start mysql
mysql -u root -e "CREATE DATABASE shooting CHARACTER SET utf8mb4;
  CREATE USER 'shooting'@'localhost' IDENTIFIED BY 'devpass';
  GRANT ALL ON shooting.* TO 'shooting'@'localhost';"
```

---

## รันทดสอบ

### ฝั่งลูกค้า (เว็บดาวน์โหลด) — ทดสอบได้เลย ไม่ต้องมีกล้อง

เปิด 2 หน้าต่าง terminal:

```bash
# หน้าต่าง 1 — server
cd v2/server
npm install                     # ครั้งแรกครั้งเดียว
cp .env.example .env            # แก้ DATABASE_URL ให้ตรงกับ MySQL ในเครื่อง
npm run dev                     # → http://localhost:8080
```

```bash
# หน้าต่าง 2 — เว็บลูกค้า
cd v2/web
npm install        # ครั้งแรกครั้งเดียว
npm run dev:customer   # → http://localhost:5174
```

ใส่ข้อมูลทดสอบ (อีกหน้าต่าง):

```bash
cd v2/server
npm run seed       # สร้างเซสชัน S1-TEST / PIN 1234 + อัปคลิป 3 อันล่าสุด
# หรือระบุไฟล์เอง:
npm run seed -- ~/Desktop/clip.mp4
```

แล้วเปิด `http://localhost:5174` → กรอก **S1-TEST** / **1234**
→ เห็นคลิปมีลายน้ำ → เลือกฟิลเตอร์ + ความเร็ว → กดซื้อ → (QR ปลอม) → กดจ่าย → รอ render → ดาวน์โหลด

**ตรวจว่าทุกอย่างทำงานครบ** — สั่งครั้งเดียวเทสต์ทั้งเส้น (อัปคลิป → ลายน้ำ → ซื้อ → จ่าย → เรนเดอร์ → โหลด → สถิติ):

```bash
cd v2/server && npm run selftest
```

> ล้างไฟล์วิดีโอ: `npm run reset` (ข้อมูลใน MySQL ยังอยู่)

### ฝั่ง kiosk (จอที่สนาม) — ต้องมีกล้องต่ออยู่

```bash
# หน้าต่าง 1 — backend กล้อง
cd v2/local/Gopro-connect
python server.py       # → http://localhost:8000
```

```bash
# หน้าต่าง 2 — จอ kiosk
cd v2/web
npm run dev            # → http://localhost:5173
```

เปิดจาก iPad/แท็บเล็ตในวง LAN เดียวกัน: `http://<ip ของ Mac>:5173`

---

## ทำไมแยก 2 พอร์ต

| | kiosk | ลูกค้า |
|---|---|---|
| ใครใช้ | ลูกค้าที่สนาม | ลูกค้าที่บ้าน |
| คุยกับ | `server.py` :8000 (กล้อง) | `server/` :8080 (คลิป+ขาย) |
| เน็ตล่ม | ยังใช้ได้ | ใช้ไม่ได้ |

โค้ด React อยู่โฟลเดอร์เดียวกัน แชร์ component/ธีมกันได้ แค่ build แยก

---

## ขึ้น production

```bash
cd v2/web && npm run build       # ได้ dist/kiosk + dist/customer
cd ../server && npm start        # เสิร์ฟ dist/customer ที่พอร์ตเดียวกันเลย
```

`v2/server/.env` (คัดจาก `.env.example`) — บนเซิร์ฟเวอร์จริงต้องเปลี่ยน `API_KEY` กับ `JWT_SECRET`

---

## API ของ server

| | |
|---|---|
| `POST /api/ingest/sessions` | ลงทะเบียนเซสชัน (ต้องมี header `X-API-Key`) |
| `POST /api/ingest/videos` | อัปคลิป + สร้าง preview ลายน้ำอัตโนมัติ |
| `POST /api/customer/lookup` | เลขเซสชัน + PIN → token + รายการคลิป |
| `GET /api/customer/preview/:id` | ดูคลิปลายน้ำ (ฟรี) |
| `POST /api/customer/orders` | สั่งซื้อ (ฟิลเตอร์ + ความเร็ว) |
| `POST /api/customer/orders/:id/pay` | จ่ายเงิน — **ยัง mock อยู่** |
| `GET /api/customer/orders/:id` | เช็คสถานะ render → ได้ลิงก์ดาวน์โหลด |
| `GET /api/customer/download/:token` | ดาวน์โหลด (ซ้ำได้จนไฟล์หมดอายุ) |
| `GET /api/admin/*` | สถิติ + log ทั้งหมด (ต้องมี header `X-Admin-Key`) |

## ฐานข้อมูล

ตารางแบ่ง 2 กลุ่ม

| กลุ่ม | ตาราง | อายุ |
|---|---|---|
| ชั่วคราว | `sessions` `videos` `orders` | ถูกลบพร้อมไฟล์วิดีโอตาม `RETENTION_DAYS` |
| **ถาวร** | `payments` `events` | **ไม่ถูกลบ** — สถิติย้อนหลังอยู่ตรงนี้ |

ตารางสร้างเองอัตโนมัติตอนรันครั้งแรก · เวลาเก็บเป็น UTC แล้วแปลงเป็นเวลาไทยตอนทำสถิติ

`events` บันทึกทุกเหตุการณ์: เปิดเซสชัน, อัปคลิป, ทำลายน้ำเสร็จ/ล้มเหลว, ลูกค้ากรอก PIN (ถูก/ผิด), เปิดดูพรีวิว, สั่งซื้อ, จ่ายเงิน, เรนเดอร์เสร็จ, ดาวน์โหลด, เซสชันหมดอายุ — พร้อมเวลาที่ใช้ (ms) และขนาดไฟล์ (bytes)

`payments` เก็บทุกรายการเงินแยกต่างหาก ไม่ผูกกับวิดีโอ → วิดีโอถูกลบไปแล้วยังดูยอดขายย้อนหลังได้

**ไม่เก็บ IP หรือข้อมูลอุปกรณ์ของลูกค้า** — เก็บเฉพาะตัวเลขสถิติ

### สถิติที่ดูได้

| endpoint | ได้อะไร |
|---|---|
| `/api/admin/live` | สถานะตอนนี้ — เซสชันที่ยังไม่หมดอายุ, คิวเรนเดอร์, รายได้สะสม |
| `/api/admin/summary` | ภาพรวมช่วงเวลา — รายได้, จำนวนคลิป, อัตราการซื้อ, เวลาเรนเดอร์เฉลี่ย, GB ที่โหลดไป |
| `/api/admin/timeseries` | กราฟรายวัน/รายชั่วโมง |
| `/api/admin/breakdown` | ฟิลเตอร์/ความเร็ว/เลน/ชั่วโมง/วันไหนนิยมสุด |
| `/api/admin/payments` | รายการโอนเงินทั้งหมด |
| `/api/admin/events` | log ดิบ กรองตาม type ได้ |

ใส่ช่วงเวลาได้ทุก endpoint: `?from=2026-08-01&to=2026-08-31` (default 30 วันล่าสุด, เวลาไทย)

---

## ลูกค้าใช้งานยังไง

1. เดินมาที่เลน → แตะเลือกช่องบนแท็บเล็ต
2. **ตั้ง PIN 4 หลักเอง** บนแป้นกดที่จอ (ระบบลงทะเบียนเซสชันขึ้นคลาวด์ทันที)
3. กดเริ่ม → ระบบจับท่าเล็ง → นับถอยหลัง → อัด
4. คลิปถูก**ส่งขึ้นคลาวด์อัตโนมัติทันทีที่อัดเสร็จ** (ลูกค้าไม่ต้องรอ)
5. ดูรีเพลย์ที่จอได้ แต่**ซื้อไม่ได้ที่เลน** — หน้ารายการคลิปโชว์การ์ด เลขเซสชัน + PIN + QR
6. ถ่ายรูปการ์ดเก็บไว้ แล้วเดินออกได้เลย → ไปเปิดเว็บซื้อ/โหลดที่บ้านเมื่อไรก็ได้ภายใน 3 วัน

> เน็ตล่มที่สนาม = ยังยิงและอัดได้ปกติ คลิปจะค้างคิวไว้แล้วส่งเองเมื่อเน็ตกลับมา
> ดูคิวค้างได้ที่ `GET /api/upload/status`

## ตั้งค่าฝั่งสนามให้ส่งขึ้นคลาวด์

`v2/local/Gopro-connect/.env`:

```dotenv
CLOUD_URL=http://136.85.26.125       # หรือ https://dl.yourdomain.com
CLOUD_API_KEY=<API_KEY เดียวกับใน v2/server/.env บนเซิร์ฟเวอร์>
CLOUD_UPLOAD=1                       # 0 = ปิด เก็บคลิปไว้ในเครื่องอย่างเดียว
```

ถ้าปิด (`CLOUD_UPLOAD=0`) หน้าจอจะไม่ถาม PIN และไม่มีการ์ดเซสชัน — ใช้ทดสอบระบบกล้องอย่างเดียวได้

## สถานะ

- [x] server: รับคลิป, ลายน้ำ, lookup+PIN, ปรับสี/slow, จ่าย(mock), ดาวน์โหลดซ้ำได้, ลบไฟล์หมดอายุ
- [x] สถิติ + log ครบทุกเหตุการณ์ (`/api/admin/*`)
- [x] เว็บลูกค้า 4 หน้า
- [x] `uploader.py` — อัปคลิปอัตโนมัติ + คิวทนเน็ตล่ม + ตั้ง PIN บนจอ + การ์ดเซสชัน
- [ ] payment gateway จริง (แทน mock — โครงรองรับแล้ว)
- [ ] หน้า admin dashboard (ตอนนี้มีแต่ API)

> โค้ด server ตัวเก่า (Python + Docker + Postgres) ย้ายไป `.archive-cloud-server-python/` แล้ว ลบทิ้งได้
