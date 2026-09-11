#!/usr/bin/env bash
# ============================================================
# setup-pi.sh — ติดตั้งทุกอย่างสำหรับรันฝั่งกล้อง (server.py) บน Raspberry Pi
# ใช้ครั้งเดียวตอนตั้งเครื่องใหม่:   bash setup-pi.sh
# ทดสอบบน: Raspberry Pi OS Bookworm (64-bit) / Pi 4 ขึ้นไป
# ============================================================
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

echo "==> [1/5] ติดตั้ง system package (ต้องใช้ sudo)"
sudo apt-get update
sudo apt-get install -y \
  python3 python3-venv python3-pip \
  ffmpeg \
  bluez bluetooth libbluetooth-dev \
  libgl1 libglib2.0-0 \
  build-essential

echo "==> [2/5] เปิดบริการ Bluetooth (ใช้คุย BLE กับ GoPro)"
sudo systemctl enable --now bluetooth || true

echo "==> [3/5] สร้าง Python virtual environment (.venv)"
if [ ! -d .venv ]; then
  python3 -m venv .venv
fi
# shellcheck disable=SC1091
source .venv/bin/activate
python -m pip install --upgrade pip wheel

echo "==> [4/5] ติดตั้ง Python dependencies (อาจใช้เวลาสักพักตอนลง torch)"
pip install -r requirements-pi.txt

echo "==> [5/5] เตรียมไฟล์ .env"
if [ ! -f .env ]; then
  cp .env.example .env
  echo "    สร้าง .env จาก .env.example แล้ว — แก้ค่ากล้อง/ESP32/CLOUD ให้ตรงก่อนรัน"
else
  echo "    มี .env อยู่แล้ว ข้ามไป"
fi

echo ""
echo "==================================================="
echo " เสร็จแล้ว! ขั้นต่อไป:"
echo "   1) แก้ค่าใน .env  (nano .env)"
echo "   2) รัน:  bash run-pi.sh"
echo "==================================================="
