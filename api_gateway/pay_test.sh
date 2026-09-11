#!/usr/bin/env bash
# ทดสอบรับเงินจริงผ่าน paygw — ไม่ต้องใช้หน้าเว็บ ไม่ต้องมีวิดีโอ
#
#   ./pay_test.sh                 สร้าง QR 7.50 บาท แล้วรอจนจ่ายเสร็จ
#   ./pay_test.sh 10.00           ระบุยอดเอง
#   ./pay_test.sh status TEST-xxx เช็คสถานะรายการเดิม (ไม่สร้างใหม่)
#
# ต้องมี:  sudo apt install -y qrencode zbar-tools
set -euo pipefail

# ยิงตรงเข้า gunicorn บนเครื่อง — ไม่ต้องผ่าน Caddy จะได้ไม่ติดเรื่อง path หรือ TLS
BASE="${PAYGW_BASE:-http://127.0.0.1:9999}"
KEY="${PAYGW_KEY:-$(grep -oP '(?<=X-API-Key ")[^"]+' /etc/caddy/Caddyfile 2>/dev/null || true)}"

if [ -z "$KEY" ]; then
  echo "❌ ไม่พบ API key — ระบุเอง:  PAYGW_KEY=pk_xxx ./pay_test.sh"
  echo "   ดูรายการ key ได้ที่:  python3 manage_projects.py list"
  exit 1
fi

api() { curl -sS -H "X-API-Key: $KEY" "$@"; }
jqp() { python3 -m json.tool 2>/dev/null || cat; }

# ── โหมดเช็คสถานะอย่างเดียว ───────────────────────────
if [ "${1:-}" = "status" ]; then
  ORDER="${2:?ใส่เลข merchant_order_id ด้วย}"
  echo "เช็คสถานะ $ORDER (paygw จะถาม LianLian ให้สดๆ)"
  api "$BASE/transfer/$ORDER" | jqp
  exit 0
fi

AMOUNT="${1:-7.50}"
ORDER="TEST-$(date +%Y%m%d-%H%M%S)"

# production ขั้นต่ำ 7.50 THB — กันเสียเวลาไปเจอ error 431004 ตอนยิงจริง
if python3 -c "import sys; sys.exit(0 if float('$AMOUNT') >= 7.50 else 1)"; then :; else
  echo "❌ ยอด $AMOUNT ต่ำกว่าขั้นต่ำ 7.50 บาทของ LianLian production"; exit 1
fi

# ── 0. ยืนยันก่อนว่ากำลังคุยกับ environment ไหน ────────
echo "── ตรวจสอบระบบ ──────────────────────────────"
HEALTH=$(curl -sS "$BASE/health")
echo "$HEALTH" | jqp
ENVN=$(echo "$HEALTH" | python3 -c "import json,sys; print(json.load(sys.stdin).get('environment','?'))")
echo
if [ "$ENVN" = "production" ]; then
  echo "⚠️  PRODUCTION — เงินจะถูกตัดจริง $AMOUNT บาท"
  read -r -p "    พิมพ์ yes เพื่อไปต่อ: " OK
  [ "$OK" = "yes" ] || { echo "ยกเลิก"; exit 0; }
fi
echo

echo "ยอด        : $AMOUNT บาท"
echo "เลขอ้างอิง  : $ORDER"
echo

# ── 1. สร้างรายการ ────────────────────────────────────
echo "1) สร้าง QR …"
RESP=$(api -X POST "$BASE/transfer" -H "Content-Type: application/json" -d "{
  \"amount\": \"$AMOUNT\",
  \"channel\": \"thai_qr\",
  \"order_desc\": \"ทดสอบระบบสนามยิงปืน\",
  \"merchant_order_id\": \"$ORDER\",
  \"expire_seconds\": 900,
  \"customer\": { \"merchant_user_id\": \"TESTER\", \"full_name\": \"Shooting Range Test\" }
}")

echo "$RESP" | python3 -c "
import json,sys
d=json.load(sys.stdin)
if 'detail' in d or d.get('code') not in (None,200000):
    print(json.dumps(d, ensure_ascii=False, indent=2)); sys.exit('❌ สร้างไม่สำเร็จ')
open('/tmp/pay.json','w').write(json.dumps(d))
print(json.dumps({k:v for k,v in d.items() if k not in ('qr_image_base64','qr_content')},
                 ensure_ascii=False, indent=2))
"
echo "  ✅"
echo

# ── 2. วาด QR ขึ้นจอ ──────────────────────────────────
python3 -c "
import json, base64, sys
d = json.load(open('/tmp/pay.json'))
b = d.get('qr_image_base64') or ''
if not b: sys.exit(1)
open('/tmp/qr.png','wb').write(base64.b64decode(b))
" && echo "2) บันทึกรูป QR → /tmp/qr.png"

if command -v zbarimg >/dev/null && command -v qrencode >/dev/null; then
  PAYLOAD=$(zbarimg -q --raw /tmp/qr.png 2>/dev/null || true)
  if [ -n "$PAYLOAD" ]; then
    echo
    qrencode -t ANSIUTF8 "$PAYLOAD"
    echo "  ↑ สแกนด้วยแอปธนาคารได้เลย (ขยายหน้าต่าง terminal ถ้า QR เพี้ยน)"
  fi
else
  echo "  ลง qrencode + zbar-tools เพื่อวาด QR บนจอ:"
  echo "    sudo apt install -y qrencode zbar-tools"
fi

# ── 3. รอจนจ่ายเสร็จ ──────────────────────────────────
echo
echo "3) รอการชำระเงิน… (Ctrl+C เพื่อหยุด — เช็คทีหลังด้วย ./pay_test.sh status $ORDER)"
for i in $(seq 1 180); do
  sleep 5
  ST=$(api "$BASE/transfer/$ORDER" 2>/dev/null || echo '{}')
  STATUS=$(echo "$ST" | python3 -c "import json,sys; print(json.load(sys.stdin).get('status','?'))" 2>/dev/null || echo '?')
  printf "\r   สถานะ: %-12s (%3ds)" "$STATUS" "$((i*5))"
  case "$STATUS" in
    paid)
      echo; echo; echo "$ST" | jqp; echo
      echo "══════════════════════════════════════"
      echo "  ✅ รับเงินสำเร็จ $AMOUNT บาท"
      echo "══════════════════════════════════════"
      exit 0 ;;
    expired|failed)
      echo; echo "❌ รายการ $STATUS"; exit 1 ;;
  esac
done
echo; echo "⏱  หมดเวลารอ — เช็คเองด้วย:  ./pay_test.sh status $ORDER"
