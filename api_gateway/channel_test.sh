#!/usr/bin/env bash
# ทดสอบว่า LianLian รับคำขอของแต่ละช่องทางไหม — ยังไม่มีการจ่ายเงิน
#
#   ./channel_test.sh          ทดสอบทั้ง 3 ช่องทาง
#   ./channel_test.sh alipay   เฉพาะช่องทางเดียว
#
# รายการที่สร้างจะค้างเป็น pending แล้วหมดอายุเอง ไม่มีเงินเคลื่อนไหว
# จนกว่าจะมีคนสแกน/กดจ่ายจริง — รันซ้ำได้ไม่จำกัด
set -uo pipefail

BASE="${PAYGW_BASE:-http://127.0.0.1:9999}"
KEY="${PAYGW_KEY:-$(grep -oP '(?<=X-API-Key ")[^"]+' /etc/caddy/Caddyfile 2>/dev/null || true)}"
AMOUNT="${AMOUNT:-8.00}"

if [ -z "$KEY" ]; then
  echo "❌ ไม่พบ API key — PAYGW_KEY=pk_xxx ./channel_test.sh"; exit 1
fi

echo "── ระบบที่กำลังคุยด้วย ─────────────────────"
curl -sS "$BASE/health" | python3 -m json.tool | grep -E "environment|gateway|merchant_id|store_id"
echo

CHANNELS="${1:-thai_qr alipay wechat}"

for CH in $CHANNELS; do
  ORDER="CHK-$(date +%H%M%S)-$CH"
  RESP=$(curl -sS -X POST "$BASE/transfer" \
    -H "X-API-Key: $KEY" -H 'Content-Type: application/json' \
    -d "{\"amount\":\"$AMOUNT\",\"channel\":\"$CH\",\"order_desc\":\"channel check\",
         \"merchant_order_id\":\"$ORDER\",\"expire_seconds\":300,
         \"customer\":{\"merchant_user_id\":\"TESTER\",\"full_name\":\"Range Test\"}}" 2>&1)

  echo "$RESP" | CH="$CH" python3 -c "
import json, os, sys
ch = os.environ['CH']
try:
    d = json.loads(sys.stdin.read())
except Exception:
    print(f'  {ch:9s} ❌ ตอบกลับไม่ใช่ JSON'); sys.exit()

det = d.get('detail')
if det:
    if isinstance(det, dict):
        print(f\"  {ch:9s} ❌ {det.get('message')}  (code {det.get('code')})\")
    else:
        print(f'  {ch:9s} ❌ {det}')
    sys.exit()

# สำเร็จ — ดูว่าได้อะไรกลับมา รูป QR หรือลิงก์
if d.get('qr_image_base64'):
    kind = 'รูป QR (แสดงให้สแกนได้เลย)'
elif d.get('qr_content'):
    kind = 'ลิงก์ → ' + d['qr_content'][:58] + '…'
else:
    kind = '⚠️ ไม่ได้ทั้งรูปและลิงก์ — หน้าเว็บจะแสดงอะไรไม่ได้'
print(f\"  {ch:9s} ✅ {kind}\")
print(f\"             เลขอ้างอิง {d.get('merchant_order_id')}  หมดอายุ {d.get('expires_at')}\")
"
done

echo
echo "──────────────────────────────────────────"
echo "✅ = LianLian ยอมรับคำขอ ช่องทางนี้เปิดใช้งานได้"
echo "❌ = ยังใช้ไม่ได้ ดูรหัสข้างบน:"
echo "     401001 ลายเซ็น / 404002 merchant / 400000 ฟิลด์ขาด"
echo "     ถ้าบอกว่า service ไม่ถูกต้องหรือไม่มีสิทธิ์ = ต้องให้ LianLian เปิดให้"
echo
echo "หมายเหตุ: ผ่านระดับนี้แปลว่า 'สร้างรายการได้' เท่านั้น"
echo "          การจ่ายเงินจริงต้องมีบัญชี Alipay / WeChat ทดสอบอีกที"
