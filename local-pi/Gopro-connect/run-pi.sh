#!/usr/bin/env bash
# ============================================================
# run-pi.sh — รันฝั่งกล้อง (server.py) บน Raspberry Pi แบบ headless
# ใช้:  bash run-pi.sh
# server จะเปิดที่ http://<ip-ของ-pi>:8000  (จอ kiosk ฝั่ง web มาเชื่อมพอร์ตนี้)
# ============================================================
set -e
HERE="$(cd "$(dirname "$0")" && pwd)"
cd "$HERE"

if [ ! -d .venv ]; then
  echo "ยังไม่มี .venv — รัน 'bash setup-pi.sh' ก่อน"
  exit 1
fi
# shellcheck disable=SC1091
source .venv/bin/activate

if [ ! -f .env ]; then
  echo "ยังไม่มีไฟล์ .env — คัดจาก .env.example แล้วแก้ค่าก่อน:  cp .env.example .env"
  exit 1
fi

# headless: ไม่เปิดหน้าต่าง cv2 (server.py ไม่ต้องใช้จอ) — กัน error เรื่อง display บน Pi ไม่มีจอ
export QT_QPA_PLATFORM=offscreen
export OPENCV_VIDEOIO_PRIORITY_MSMF=0

echo "==> เริ่ม server.py  (Ctrl+C เพื่อหยุด)"
exec python server.py
