#!/usr/bin/env bash
# ล้างข้อมูลทดสอบ — ใช้ระหว่างพัฒนาเท่านั้น อย่ารันบนระบบที่เปิดใช้จริงแล้ว
#
#   ./reset.sh          ล้างข้อมูลปฏิบัติการ (เซสชัน/วิดีโอ/ออเดอร์) + ไฟล์วิดีโอ
#                       แต่เก็บสถิติกับรายการเงินไว้
#   ./reset.sh --all    ล้างทุกอย่างรวมสถิติ เหมือนเพิ่งติดตั้งใหม่
set -e
cd "$(dirname "$0")"

export $(grep -E '^(DATABASE_URL|DATA_DIR)=' .env | xargs)

# แยก mysql://user:pass@host:port/db ออกเป็นชิ้นๆ
URL="${DATABASE_URL#mysql://}"
CRED="${URL%%@*}"; REST="${URL#*@}"
DB_USER="${CRED%%:*}"; DB_PASS="${CRED#*:}"
DB_HOST="${REST%%:*}"; DB_NAME="${REST##*/}"
DATA="${DATA_DIR:-./data}"

ALL=0
[ "$1" = "--all" ] && ALL=1

echo "ฐานข้อมูล : $DB_NAME @ $DB_HOST"
echo "ไฟล์วิดีโอ: $DATA"
[ $ALL -eq 1 ] && echo "โหมด      : ล้างทุกอย่าง (รวมสถิติ + รายการเงิน)" \
               || echo "โหมด      : ล้างเฉพาะข้อมูลปฏิบัติการ (เก็บสถิติไว้)"
echo
read -rp "ยืนยันล้างข้อมูล? พิมพ์ yes: " ok
[ "$ok" = "yes" ] || { echo "ยกเลิก"; exit 0; }

sudo systemctl stop shot24 2>/dev/null || true

TABLES="orders videos sessions"
[ $ALL -eq 1 ] && TABLES="$TABLES payments events"

SQL="SET FOREIGN_KEY_CHECKS=0;"
for t in $TABLES; do SQL="$SQL TRUNCATE TABLE $t;"; done
SQL="$SQL SET FOREIGN_KEY_CHECKS=1;"

mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "$SQL"
echo "  ✅ ล้างตาราง: $TABLES"

rm -rf "$DATA"/masters/* "$DATA"/previews/* "$DATA"/renders/* "$DATA"/tmp/* 2>/dev/null || true
echo "  ✅ ลบไฟล์วิดีโอแล้ว"

sudo systemctl start shot24 2>/dev/null || true
echo

mysql -h "$DB_HOST" -u "$DB_USER" -p"$DB_PASS" "$DB_NAME" -e "
SELECT 'sessions' AS ตาราง, COUNT(*) AS เหลือ FROM sessions
UNION ALL SELECT 'videos',   COUNT(*) FROM videos
UNION ALL SELECT 'orders',   COUNT(*) FROM orders
UNION ALL SELECT 'payments', COUNT(*) FROM payments
UNION ALL SELECT 'events',   COUNT(*) FROM events;"
