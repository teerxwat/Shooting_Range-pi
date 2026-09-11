# ติดตั้ง server บน Google Cloud VM

เครื่อง: `server-shot24` · zone `asia-southeast1-c`

---

## 1. จอง Static IP (ทำก่อนเลย)

IP ที่ได้ตอนนี้เป็นแบบชั่วคราว — เครื่องรีสตาร์ตแล้วเปลี่ยน

Console → **VPC network** → **IP addresses** → แท็บ **External IP addresses**
→ หาแถวของ `server-shot24` → คอลัมน์ Type เปลี่ยนจาก `Ephemeral` เป็น **`Static`** → ตั้งชื่อ `shot24-ip` → Reserve

## 2. เปิดพอร์ต 8080 (ไว้ทดสอบชั่วคราว)

Console → **VPC network** → **Firewall** → **Create firewall rule**

| ช่อง | ใส่ |
|---|---|
| Name | `allow-8080` |
| Targets | All instances in the network |
| Source IPv4 ranges | `0.0.0.0/0` |
| Protocols and ports | TCP → `8080` |

> พอต่อโดเมน + HTTPS เสร็จแล้ว (ขั้นที่ 7) ให้กลับมาลบกฎนี้ทิ้ง

## 3. เข้าเครื่อง

หน้า VM instances → กดปุ่ม **SSH** ตรงแถวของ `server-shot24` → เปิดหน้าต่าง terminal ในเบราว์เซอร์

## 4. ลงโปรแกรมที่ต้องใช้

```bash
sudo apt update
sudo apt install -y ffmpeg git mariadb-server
# (Ubuntu บาง image ไม่มี mysql-server ให้ใช้ mariadb-server แทน — ใช้แทนกันได้ 100%)

# Node 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# เช็คว่าได้ครบ
node -v && ffmpeg -version | head -1 && mysql --version
```

### สร้างฐานข้อมูล

```bash
sudo mysql -e "CREATE DATABASE IF NOT EXISTS shooting CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;"
sudo mysql -e "CREATE USER IF NOT EXISTS 'shooting'@'localhost' IDENTIFIED BY 'เปลี่ยนรหัสนี้';"
sudo mysql -e "GRANT ALL PRIVILEGES ON shooting.* TO 'shooting'@'localhost';"
sudo mysql -e "FLUSH PRIVILEGES;"

# ทดสอบว่าต่อได้
mysql -u shooting -p'เปลี่ยนรหัสนี้' shooting -e "SELECT VERSION();"
```

ตารางทั้งหมดโปรแกรมสร้างให้เองตอนรันครั้งแรก ไม่ต้อง import อะไร

## 5. เอาโค้ดขึ้นเครื่อง

```bash
cd ~
git clone https://github.com/teerxwat/Shooting_Range.git

# build หน้าเว็บลูกค้า
cd Shooting_Range/v2/web && npm install && npm run build:customer

# ติดตั้ง server
cd ../server && npm install --omit=dev
```

ตั้งค่าลับ:

```bash
cp .env.example .env
openssl rand -hex 32      # รัน 3 ครั้ง เก็บค่าไว้
nano .env
```

แก้ 4 บรรทัดนี้:

```dotenv
DATABASE_URL=mysql://shooting:รหัสที่ตั้งไว้@localhost:3306/shooting
API_KEY=<ค่าสุ่มตัวที่ 1>       # เครื่อง Mac ที่สนามใช้ค่านี้ตอนอัปคลิป
JWT_SECRET=<ค่าสุ่มตัวที่ 2>
ADMIN_KEY=<ค่าสุ่มตัวที่ 3>     # ใช้ดูสถิติ
RETENTION_DAYS=3
```

บันทึก: `Ctrl+O` → `Enter` → `Ctrl+X`

> **เก็บ API_KEY ไว้ให้ดี** เดี๋ยวต้องเอาไปใส่ในเครื่อง Mac ที่สนาม
> ถ้ารหัสผ่านมีอักขระพิเศษ (`@ : / #`) ต้อง encode เช่น `@` → `%40`

## 6. ลองรัน

```bash
npm start
```

เปิดในเบราว์เซอร์: `http://<EXTERNAL_IP>:8080/api/health` → ต้องได้ `{"ok":true}`

ได้แล้วกด `Ctrl+C` ปิด แล้วไปตั้งเป็น service ต่อ

### ตั้งเป็น systemd service (เปิดเองเมื่อเครื่องรีบูต)

```bash
sudo tee /etc/systemd/system/shot24.service > /dev/null << EOF
[Unit]
Description=Shooting Range server
After=network.target mariadb.service

[Service]
Type=simple
User=$(whoami)
WorkingDirectory=$(pwd)
ExecStart=/usr/bin/node src/index.js
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now shot24
sudo systemctl status shot24        # ต้องขึ้น active (running) — กด q ออก
```

คำสั่งที่ใช้บ่อย:

```bash
sudo systemctl restart shot24     # รีสตาร์ตหลังแก้โค้ด
journalctl -u shot24 -f           # ดู log สดๆ (Ctrl+C ออก)
```

## 6.5 เปิดให้เข้าจากข้างนอก (ยังไม่มีโดเมน)

GCP บล็อกทุกพอร์ตยกเว้น 22/80/443 — แทนที่จะไปเปิด 8080 ให้เอา Caddy มารับที่พอร์ต 80
(ซึ่งเปิดอยู่แล้วจากตอนติ๊ก "Allow HTTP traffic") แล้วส่งต่อไป 8080

```bash
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo tee /etc/caddy/Caddyfile > /dev/null << 'EOF'
:80 {
    reverse_proxy localhost:8080
}
EOF
sudo systemctl restart caddy
```

เปิด `http://<EXTERNAL_IP>` ได้เลย (ไม่ต้องใส่ `:8080`)

## 7. ต่อโดเมน + HTTPS

ต้องมีโดเมนก่อน แล้วชี้ A record มาที่ Static IP:

```
dl.yourdomain.com  →  <EXTERNAL_IP>
```

(ถ้าใช้ Cloudflare ให้ปิด proxy/เมฆส้ม เป็น DNS only ก่อน ไม่งั้น Caddy ขอใบรับรองไม่ผ่าน)

จากนั้น build เว็บลูกค้าแล้วติดตั้ง Caddy:

```bash
# build หน้าเว็บลูกค้า
cd ~/Shooting_Range/v2/web
npm install && npm run build:customer

# Caddy — ขอใบรับรอง HTTPS ให้อัตโนมัติ ไม่ต้องตั้งอะไร
sudo apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy

sudo tee /etc/caddy/Caddyfile > /dev/null << 'EOF'
dl.yourdomain.com {
    reverse_proxy localhost:8080
}
EOF

sudo systemctl restart caddy
```

เปิด `https://dl.yourdomain.com` → เจอหน้ากรอกเลขเซสชัน + PIN

เสร็จแล้วกลับไปลบกฎ firewall `allow-8080` ทิ้ง

## 8. ทดสอบ

```bash
# ลงทะเบียนเซสชันทดสอบ (รันบนเครื่อง VM)
curl -X POST http://localhost:8080/api/ingest/sessions \
  -H "X-API-Key: <API_KEY ใน .env>" \
  -H "Content-Type: application/json" \
  -d '{"code":"S1-TEST","pin":"1234","lane":1}'
```

แล้วอัปคลิปจากเครื่อง Mac:

```bash
curl -X POST https://dl.yourdomain.com/api/ingest/videos \
  -H "X-API-Key: <API_KEY>" \
  -F code=S1-TEST -F sub_no=1 -F filename=test.mp4 -F duration_s=10 \
  -F file=@/path/to/clip.mp4
```

รอสักครู่ให้ ffmpeg ทำลายน้ำ แล้วเปิดเว็บกรอก `S1-TEST` / `1234`

---

## อัปเดตโค้ดรอบถัดไป

```bash
cd ~/Shooting_Range && git pull
cd v2/server && npm install --omit=dev
sudo systemctl restart shot24
# ถ้าแก้หน้าเว็บด้วย:
cd ../web && npm run build:customer && sudo systemctl reload caddy
```

## เช็คพื้นที่ดิสก์

```bash
df -h /                                  # ดิสก์เหลือเท่าไร
du -sh ~/Shooting_Range/v2/server/data   # วิดีโอกินไปเท่าไร
```

ใกล้เต็ม → ลด `RETENTION_DAYS` ใน `.env` แล้ว `sudo systemctl restart shot24`

---

## ดูสถิติ

ทุกคำสั่งต้องแนบ `-H "X-Admin-Key: <ADMIN_KEY ใน .env>"`

```bash
K="X-Admin-Key: <ADMIN_KEY>"

curl -H "$K" http://localhost:8080/api/admin/live         # สถานะตอนนี้
curl -H "$K" http://localhost:8080/api/admin/summary      # ภาพรวม 30 วัน
curl -H "$K" "http://localhost:8080/api/admin/summary?from=2026-08-01&to=2026-08-31"
curl -H "$K" "http://localhost:8080/api/admin/timeseries?bucket=day"
curl -H "$K" http://localhost:8080/api/admin/breakdown    # ฟิลเตอร์/เลน/ชั่วโมงยอดนิยม
curl -H "$K" http://localhost:8080/api/admin/payments     # รายการโอนเงิน
curl -H "$K" "http://localhost:8080/api/admin/events?type=order.paid&limit=50"
```

อ่านง่ายขึ้นด้วย `| python3 -m json.tool`

### สำรองข้อมูล

วิดีโอหายได้ (มีอายุ 3 วันอยู่แล้ว) แต่**สถิติกับรายการเงินหายไม่ได้**

```bash
# สำรอง (ไฟล์เล็กมาก ไม่มีวิดีโอ)
mysqldump -u shooting -p'รหัส' shooting | gzip > ~/backup-$(date +%F).sql.gz

# กู้คืน
gunzip -c ~/backup-2026-08-01.sql.gz | mysql -u shooting -p'รหัส' shooting
```

ตั้งให้สำรองอัตโนมัติทุกคืนตี 3:

```bash
crontab -e
# เพิ่มบรรทัดนี้ (แก้รหัสผ่านให้ตรง) — เก็บย้อนหลัง 30 วัน
0 3 * * * mysqldump -u shooting -p'รหัส' shooting | gzip > ~/backup-$(date +\%F).sql.gz && find ~ -name "backup-*.sql.gz" -mtime +30 -delete
```

---

## เปิด MySQL จากเครื่องตัวเอง (DBeaver / TablePlus / Sequel Ace)

### วิธีแนะนำ — SSH tunnel (ไม่ต้องเปิดพอร์ต ปลอดภัยที่สุด)

โปรแกรม GUI ส่วนใหญ่รองรับในตัว เลือกแท็บ **SSH** แล้วกรอก:

| ช่อง | ใส่ |
|---|---|
| SSH Host | `136.85.26.125` |
| SSH User | `dev001` |
| SSH Key | `~/.ssh/id_ed25519` |
| MySQL Host | `127.0.0.1` |
| MySQL Port | `3306` |
| User / Password | `shooting` / รหัสที่ตั้งไว้ |

หรือเปิด tunnel เองจาก terminal แล้วต่อที่ `localhost:3307`:

```bash
ssh -N -L 3307:localhost:3306 dev001@136.85.26.125
```

**ข้อดี**: ไม่ต้องเปิดพอร์ต 3306 ให้โลกภายนอกเลย ใครไม่มี SSH key ก็เข้าไม่ได้

### วิธีเปิดพอร์ตตรง (ถ้าจำเป็นจริงๆ)

⚠️ บอตสแกนหา MySQL ที่เปิดพอร์ต 3306 ตลอดเวลา ถ้าจะทำต้องล็อก IP ต้นทางเสมอ

```bash
# 1. ให้ MariaDB รับ connection จากข้างนอก
sudo nano /etc/mysql/mariadb.conf.d/50-server.cnf
#    แก้  bind-address = 127.0.0.1   →   bind-address = 0.0.0.0
sudo systemctl restart mariadb

# 2. สร้าง user แยกสำหรับเข้าจากข้างนอก (รหัสยาวๆ)
sudo mysql -e "CREATE USER 'remote'@'%' IDENTIFIED BY 'รหัสยาวมากๆ';"
sudo mysql -e "GRANT SELECT ON shooting.* TO 'remote'@'%';"   # ให้อ่านอย่างเดียวพอ
sudo mysql -e "FLUSH PRIVILEGES;"
```

**3. firewall — ต้องล็อก IP ตัวเอง อย่าใช้ `0.0.0.0/0` เด็ดขาด**

หา IP ตัวเองด้วย `curl ifconfig.me` แล้วสร้างกฎใน Console:

| ช่อง | ใส่ |
|---|---|
| Name | `allow-mysql-me` |
| Source IPv4 ranges | `<IP ของคุณ>/32` |
| Protocols and ports | TCP `3306` |

> IP บ้านส่วนใหญ่เปลี่ยนเป็นระยะ ต้องกลับมาแก้กฎเรื่อยๆ — อีกเหตุผลที่ SSH tunnel สะดวกกว่าในระยะยาว
