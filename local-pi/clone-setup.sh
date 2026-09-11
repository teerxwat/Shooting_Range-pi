#!/usr/bin/env bash
# ============================================================
# clone-setup.sh — รันครั้งเดียวหลัง clone SD card ทั้งใบ (dd / Raspberry Pi
# Imager "Duplicate SD Card") จากเครื่องต้นแบบไปลง Pi เครื่องใหม่
#
# ทำไมต้องรัน: การ clone ทั้ง OS จะติดของเฉพาะเครื่องต้นแบบไปด้วย เช่น
# hostname, SSH host key, machine-id, เลขนับ session เดิม ฯลฯ — ถ้าไม่แก้
# จะชนกับเครื่องต้นแบบตอนอยู่วง LAN เดียวกัน (SSH MITM warning, session
# code ชนกันบนคลาวด์ ฯลฯ)
#
# ใช้ (บน Pi เครื่องใหม่ หลังบูตครั้งแรก ก่อนเสียบกล้อง/ESP32):
#   sudo bash clone-setup.sh <เลขเลน>
#   เช่น เครื่องนี้จะเป็นเลน 2:  sudo bash clone-setup.sh 2
#
# สิ่งที่สคริปต์นี้ทำให้อัตโนมัติ:
#   - ตั้ง hostname ใหม่ (7lnetwork-s<เลข>)
#   - gen SSH host key + machine-id ใหม่ (กันซ้ำกับเครื่องต้นแบบ)
#   - ตั้ง LANE_ID=<เลข> ใน .env (กัน session code ชนกันบนคลาวด์)
#   - ล้าง session counter / คลิปเก่า / auth กล้องเดิมของเครื่องต้นแบบทิ้ง
#
# สิ่งที่ยังต้องแก้เอง (สคริปต์รู้ไม่ได้ว่ากล้อง/ESP32 เลนนี้คืออันไหน):
#   - CH1_CAM1_IP และ ESP32_CH1_MAC ใน .env
#   - จับคู่ BLE กับกล้องตัวใหม่ของเลนนี้ (ble_pair.py)
# ============================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "ต้องรันด้วย sudo:  sudo bash clone-setup.sh <เลขเลน>"; exit 1
fi

LANE="${1:-}"
if ! [[ "$LANE" =~ ^[0-9]+$ ]]; then
  echo "ใส่เลขเลนด้วย เช่น:  sudo bash clone-setup.sh 2"; exit 1
fi

HOSTNAME_NEW="7lnetwork-s${LANE}"
ROOT="$(cd "$(dirname "$0")" && pwd)"
GOPRO_DIR="$ROOT/Gopro-connect"

log()  { printf "\n\033[1;36m==> %s\033[0m\n" "$1"; }
ok()   { printf "  \033[32m✓\033[0m %s\n" "$1"; }
warn() { printf "  \033[33m!\033[0m %s\n" "$1"; }

if [ ! -d "$GOPRO_DIR" ]; then
  echo "ไม่พบ $GOPRO_DIR — รันสคริปต์นี้จาก v2/local-pi/ เท่านั้น"; exit 1
fi

log "[1/5] ตั้ง hostname เป็น $HOSTNAME_NEW"
hostnamectl set-hostname "$HOSTNAME_NEW"
sed -i "s/^127\.0\.1\.1.*/127.0.1.1\t${HOSTNAME_NEW}/" /etc/hosts
ok "hostname = $HOSTNAME_NEW"

log "[2/5] gen SSH host key ใหม่ (กันชนกับเครื่องต้นแบบ — สำคัญมาก ห้ามข้าม)"
rm -f /etc/ssh/ssh_host_*
ssh-keygen -A > /dev/null
systemctl restart ssh 2>/dev/null || true
ok "SSH host key ใหม่แล้ว"

log "[3/5] gen machine-id ใหม่"
rm -f /etc/machine-id /var/lib/dbus/machine-id
systemd-machine-id-setup > /dev/null
ok "machine-id ใหม่แล้ว"

log "restart avahi ให้ประกาศ hostname ใหม่ทาง mDNS"
systemctl restart avahi-daemon
ok "avahi-daemon restart แล้ว — ${HOSTNAME_NEW}.local ใช้ได้เลย"

log "[4/5] ตั้ง LANE_ID=$LANE ใน .env"
if [ -f "$GOPRO_DIR/.env" ]; then
  if grep -q "^LANE_ID=" "$GOPRO_DIR/.env"; then
    sed -i "s/^LANE_ID=.*/LANE_ID=${LANE}/" "$GOPRO_DIR/.env"
  else
    sed -i "1i LANE_ID=${LANE}" "$GOPRO_DIR/.env"
  fi
  ok "LANE_ID=$LANE"
else
  warn "ไม่พบ .env ที่ $GOPRO_DIR — คัดจาก .env.example เองด้วย: cp .env.example .env"
fi

log "[5/5] ล้างของเก่าจากเครื่องต้นแบบทิ้ง (session counter / คลิปเก่า / auth กล้องเดิม)"
rm -rf "$GOPRO_DIR/.session" "$GOPRO_DIR/downloads" "$GOPRO_DIR/gopro_auth.json"
ok "เคลียร์แล้ว — เลนนี้จะเริ่มนับ S${LANE}-0001 ใหม่สะอาดๆ"

echo ""
echo "==================================================="
echo " เสร็จแล้ว! เหลือแก้เองอีก 2 จุด (เฉพาะของเลนนี้ สคริปต์รู้แทนไม่ได้):"
echo ""
echo "   1) nano $GOPRO_DIR/.env"
echo "      - CH1_CAM1_IP      → IP กล้อง GoPro ตัวที่ใช้กับเลนนี้"
echo "      - ESP32_CH1_MAC    → MAC ของ ESP32 ปุ่ม/จอของเลนนี้"
echo ""
echo "   2) จับคู่กล้องใหม่ผ่าน BLE (กล้องคนละตัว ต้อง pair ใหม่เสมอ):"
echo "      cd $GOPRO_DIR && source .venv/bin/activate && python ble_pair.py"
echo ""
echo "   แล้ว reboot ให้ hostname/SSH key ใหม่มีผลเต็มที่:"
echo "      sudo reboot"
echo "==================================================="
