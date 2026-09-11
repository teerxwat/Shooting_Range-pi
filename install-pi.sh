#!/usr/bin/env bash
# ============================================================
# install-pi.sh — ติดตั้งทุกอย่างที่ต้องใช้รันบน Pi เครื่องนี้
#   1) apt system packages (python, ffmpeg, bluetooth, node/npm, ...)
#   2) Python venv + pip libs สำหรับ local-pi/Gopro-connect (service กล้อง)
#   3) node_modules สำหรับ web/ (หน้า kiosk)
#
# ใช้ครั้งเดียวตอนตั้งเครื่องใหม่:   bash install-pi.sh
# รันซ้ำได้ปลอดภัย — ข้ามขั้นที่ทำไปแล้วอัตโนมัติ
# ============================================================
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
GOPRO_DIR="$ROOT/local-pi/Gopro-connect"
WEB_DIR="$ROOT/web"

log()  { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }

# ---------- 0) เช็ค path ----------
if [ ! -d "$GOPRO_DIR" ]; then
  echo "ไม่พบ $GOPRO_DIR — รันสคริปต์นี้จาก v2/ root เท่านั้น"; exit 1
fi

# ---------- 1) apt system packages ----------
log "[1/5] ติดตั้ง system package (ต้องใช้ sudo)"
sudo apt-get update
sudo apt-get install -y \
  python3 python3-venv python3-pip \
  ffmpeg \
  bluez bluetooth libbluetooth-dev \
  libgl1 libglib2.0-0 \
  build-essential \
  nodejs npm
ok "system package ครบ"

log "เปิดบริการ Bluetooth"
sudo systemctl enable --now bluetooth || true

# ---------- 2) Python venv + libs (ฝั่งกล้อง) ----------
log "[2/5] สร้าง Python virtualenv (.venv) — local-pi/Gopro-connect"
cd "$GOPRO_DIR"
if [ ! -d .venv ]; then
  python3 -m venv .venv
  ok "สร้าง .venv แล้ว"
else
  ok ".venv มีอยู่แล้ว ข้าม"
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip wheel

log "[3/5] ติดตั้ง Python dependencies (requirements-pi.txt) — ตอนลง torch จะนานหน่อย"
pip install -r requirements-pi.txt
ok "ลง Python libs ครบ"
deactivate

log "เตรียมไฟล์ .env (ฝั่งกล้อง)"
if [ ! -f .env ]; then
  cp .env.example .env
  warn "สร้าง .env จาก .env.example แล้ว — ต้องแก้ CH*_CAM*_IP / ESP32_CH*_MAC / CLOUD_API_KEY ก่อนรันจริง (nano .env)"
else
  ok ".env มีอยู่แล้ว ข้าม"
fi

# ---------- 3) Node libs (ฝั่งเว็บ kiosk) ----------
log "[4/5] ติดตั้ง node_modules — web/ (หน้า kiosk)"
cd "$WEB_DIR"
npm install
ok "ลง node libs ครบ"

log "[5/5] build หน้า kiosk (dist/kiosk)"
npm run build:kiosk
ok "build kiosk เสร็จ → web/dist/kiosk"

echo ""
echo "==================================================="
echo " เสร็จแล้ว! ขั้นต่อไป:"
echo "   1) แก้ค่าใน local-pi/Gopro-connect/.env  (nano local-pi/Gopro-connect/.env)"
echo "   2) รันฝั่งกล้อง:  cd local-pi/Gopro-connect && bash run-pi.sh"
echo "   3) เสิร์ฟหน้า kiosk (web/dist/kiosk) — ยังไม่มีตัวเสิร์ฟติดตั้งถาวรบนเครื่องนี้"
echo "      ทดสอบชั่วคราวได้ด้วย:  npx --prefix web serve web/dist/kiosk -l 5173"
echo "==================================================="
