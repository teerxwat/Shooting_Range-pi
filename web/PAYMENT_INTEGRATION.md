# การรวมระบบชำระเงิน LianLian Pay (พร้อมเพย์ / Alipay / WeChat)

เพิ่มปุ่มเลือกช่องทางชำระเงิน + QR จริง + เช็คสถานะอัตโนมัติ เข้ากับ CheckoutModal เดิม
โดยไม่แตะ flow render/download เดิม

## ภาพรวมสถาปัตยกรรม (ปลอดภัย — API key ไม่หลุดมา browser)

```
React (customer)                Caddy (shot24.shop)              Payment API (127.0.0.1:9999)
  createPayment() ── POST /api/pay/transfer ──▶ handle_path /api/pay/*
                                                 + เติม header X-API-Key ──▶ POST /transfer
  paymentStatus() ── GET  /api/pay/transfer/:id ─▶  (เดียวกัน) ──────────▶ GET /transfer/:id
                                                                              ↓ ถาม LianLian สด
                                                                          MySQL paygw (log)
```

- **API key อยู่ที่ Caddy เท่านั้น** — React ไม่เห็นคีย์เลย (เรียกผ่าน `/api/pay/*`)
- webhook จาก LianLian → `https://shot24.shop/webhook/lianlian` (มีอยู่แล้ว) อัปเดตสถานะเป็น paid
- ตอน poll ถ้ายัง pending payment API จะถาม LianLian สดให้ด้วย → เด้ง paid ไวขึ้น

## ไฟล์ที่แก้ในโปรเจคนี้ (frontend)

| ไฟล์ | เปลี่ยนอะไร |
|------|-------------|
| `src/customer/api.js` | เพิ่ม `createPayment()` + `paymentStatus()` (เรียกผ่าน `/api/pay/*`) |
| `src/customer/components/CheckoutModal.jsx` | เพิ่ม step เลือกช่องทาง → QR จริง → poll สถานะ → ต่อ flow render/download เดิม |
| `src/shared/i18n/translations.js` | เพิ่มคำแปล: choosePayMethod, promptpay, alipay, wechat, payExpired (th/en/zh) |

## สิ่งที่ต้องทำตอน deploy (3 ส่วน)

### 1) อัปเดต Payment API บน server (/var/www/api_gateway)
ไฟล์ที่เปลี่ยน: `lianlian/client.py` (render QR wechat/alipay), `app.py` (live status), `requirements.txt`
```bash
# อัปไฟล์ใหม่ขึ้นไป (scp/rsync/git) แล้วบน server:
cd /var/www/api_gateway
source .venv/bin/activate
pip install "qrcode[pil]"
sudo systemctl restart paygw
curl http://127.0.0.1:9999/health   # ต้อง mysql เหมือนเดิม
```

### 2) เพิ่ม route ปลอดภัยใน Caddy
แก้ `/etc/caddy/Caddyfile` เพิ่ม `handle_path /api/pay/*` เข้าไปในบล็อก `shot24.shop { }`
**ก่อน** `handle { reverse_proxy localhost:8080 }`:

```
shot24.shop {
    handle /db-7lnetwork* {
        root * /var/www
        php_fastcgi unix//run/php/php8.4-fpm.sock
        file_server
    }

    # webhook + endpoint ตรงของ payment API (มีอยู่แล้ว)
    @paygw path /transfer /transfer/* /transfers /webhook/* /payment/* /health
    handle @paygw {
        reverse_proxy localhost:9999
    }

    # ── ใหม่: proxy สำหรับ frontend โดยเติม API key ฝั่ง server ──
    handle_path /api/pay/* {
        reverse_proxy localhost:9999 {
            header_up X-API-Key "pk_sxA_2MPDrcCUaemIzR6IOdDsKExiVWDT_pWBg2rwzU4"
        }
    }

    handle {
        reverse_proxy localhost:8080
    }
}
```
แล้ว:
```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

### 3) build + deploy frontend
```bash
cd <โปรเจค web>
npm run build:customer          # ออกที่ dist/customer
# นำ dist/customer ไปเสิร์ฟตามระบบเดิม (ตัวที่ Caddy proxy ไป :8080)
```

## หมายเหตุด้านความปลอดภัย (แนะนำทำต่อ)

- `/api/pay/transfer` ตอนนี้เปิดให้ frontend เรียกได้ (Caddy เติม key ให้) — ใครยิง path นี้ก็สร้าง QR ได้
  เงินยังเข้าร้านปลอดภัย แต่ควรกัน spam ด้วย rate-limit หรือผูกกับ order ที่ auth แล้วในอนาคต
- flow ปัจจุบัน: frontend ยืนยันว่าจ่ายแล้ว (จาก payment API ที่เช็ค LianLian จริง) → เรียก `payOrder` ปลดล็อค
  ในระบบที่รัดกุมกว่า ควรให้ backend `/api/customer` เป็นคนเช็คสถานะกับ payment API เอง (server-to-server)
  หรือรับ webhook LianLian โดยตรง แทนการเชื่อฝั่ง frontend
