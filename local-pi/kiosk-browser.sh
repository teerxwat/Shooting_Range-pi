#!/usr/bin/env bash
# ============================================================
# kiosk-browser.sh — เปิด Chromium เต็มจอ (kiosk mode) ชี้ไปหน้าเว็บ kiosk
# ถูกเรียกอัตโนมัติตอน login desktop ผ่าน ~/.config/autostart/kiosk-browser.desktop
#
# รอจน kiosk-web.service (พอร์ต 5173) ตอบก่อน ค่อยเปิด browser
# กัน error "ต่อไม่ติด" ตอนบูตเร็วกว่า service
# ============================================================
URL="http://localhost:5173"

for i in $(seq 1 60); do
  curl -s -o /dev/null "$URL" && break
  sleep 1
done

exec chromium \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --disable-translate \
  --incognito \
  --start-fullscreen \
  --check-for-update-interval=31536000 \
  "$URL"
