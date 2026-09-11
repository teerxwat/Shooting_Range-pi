# Deploy Guide — LianLian Pay Transfer API

## 0. ก่อน deploy: เช็คลิสต์ความพร้อม

โค้ดพร้อมขึ้น server แล้ว ต่อไปนี้คือสิ่งที่ **ต้องทำ/ปรับ** ตอนขึ้นจริง:

- [ ] `.env` ตั้งค่าครบ (ไม่ commit ขึ้น git — มี `.gitignore` กันไว้แล้ว)
- [ ] `merchant_private.pem` อยู่บน server และ path ใน `.env` ถูกต้อง (สิทธิ์ไฟล์ `chmod 600`)
- [ ] MySQL: สร้าง database เปล่า + ตั้ง `DATABASE_URL` ให้ถูก
- [ ] โดเมน `shot24.shop` ชี้มาที่ server และเปิด HTTPS แล้ว
- [ ] whitelist **IP ของ server** ในพอร์ทัล LianLian (ไม่ใช่ IP เครื่อง dev แล้ว)

### ถ้าจะใช้ Production ของ LianLian (ไม่ใช่ sandbox)
Sandbox กับ Production เป็นคนละระบบ credentials กัน ต้องทำเพิ่ม:
- [ ] `LIANLIANPAY_ENV=production` ใน `.env`
- [ ] ใช้ **merchant_id ของ production** (สมัคร/เปิดใช้กับ LianLian)
- [ ] อัป **merchant public key** เข้า production portal (merchant.lianlianpay.co.th)
- [ ] เอา **LianLianPay public key ของ production** มาใส่ `LIANLIANPAY_PUBLIC_KEY`
- [ ] whitelist IP ของ server ใน production portal

---

## 1. เตรียมเครื่อง (Ubuntu ตัวอย่าง)

```bash
sudo apt update && sudo apt install -y python3-venv python3-pip nginx
# ถ้ายังไม่มี MySQL บนเครื่องนี้และจะใช้ที่อื่นก็ข้าม
```

## 2. วางโค้ด + ติดตั้ง

```bash
cd /var/www
git clone <your-repo> api_gateway     # หรือ scp/rsync โฟลเดอร์ขึ้นมา
cd api_gateway

python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
pip install gunicorn

cp .env.example .env
nano .env            # ใส่ค่าจริง: MERCHANT_ID, key, DATABASE_URL, NOTIFY_URL
chmod 600 merchant_private.pem .env
```

## 3. เตรียม database + project

สร้าง database เปล่าใน phpMyAdmin ชื่อ `paygw` (collation utf8mb4) ก่อน แล้ว:

```bash
python manage_projects.py create "shot24"     # ได้ API key -> เก็บไว้ให้แต่ละโปรเจค
python manage_projects.py create "project_b"
```

ตารางจะถูกสร้างอัตโนมัติ กลับไปดูใน phpMyAdmin จะเห็น `projects` และ `transactions`

## 4. รันด้วย gunicorn + systemd

สร้าง `/etc/systemd/system/paygw.service`:

```ini
[Unit]
Description=LianLian Pay Transfer API
After=network.target

[Service]
User=www-data
WorkingDirectory=/var/www/api_gateway
EnvironmentFile=/var/www/api_gateway/.env
ExecStart=/var/www/api_gateway/.venv/bin/gunicorn app:app \
    -k uvicorn.workers.UvicornWorker \
    -w 4 -b 127.0.0.1:8000 \
    --timeout 60
Restart=always

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now paygw
sudo systemctl status paygw
```

## 5. Nginx reverse proxy + HTTPS

`/etc/nginx/sites-available/shot24`:

```nginx
server {
    server_name shot24.shop;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/shot24 /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d shot24.shop      # ออก SSL อัตโนมัติ
```

## 6. ทดสอบหลัง deploy

```bash
curl https://shot24.shop/health
curl -X POST https://shot24.shop/transfer \
  -H 'X-API-Key: pk_xxx' -H 'Content-Type: application/json' \
  -d '{"amount":"8.00","channel":"thai_qr","expire_seconds":600,
       "customer":{"full_name":"Test","merchant_user_id":"U1"}}'
```

webhook (`https://shot24.shop/webhook/lianlian`) จะรับ callback จาก LianLian อัตโนมัติ
เมื่อจ่ายสำเร็จ → บันทึกเป็น `paid` ในตาราง `transactions`

## 7. อัปเดตโค้ดครั้งถัดไป

```bash
cd /var/www/api_gateway && git pull
source .venv/bin/activate && pip install -r requirements.txt
sudo systemctl restart paygw
```

---

## หมายเหตุ
- ถ้าเปลี่ยน server (IP ใหม่) อย่าลืม whitelist IP ใหม่ในพอร์ทัล ไม่งั้นจะเจอ `IP restricted`
- ตอนนี้ `.env` ยังชี้ sandbox — ทดสอบ end-to-end บน server กับ sandbox ให้ผ่านก่อน แล้วค่อยสลับเป็น production
