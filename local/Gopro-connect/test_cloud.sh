#!/usr/bin/env bash
# ทดสอบว่าเครื่องที่สนามส่งคลิปขึ้นคลาวด์ได้จริงไหม — ไม่ต้องใช้กล้อง
#
#   ./test_cloud.sh              ใช้คลิปล่าสุดที่มีในเครื่อง
#   ./test_cloud.sh path/to.mp4  ระบุไฟล์เอง
#
# เลขเซสชันดึงจากชื่อไฟล์จริง (S1-0036_20260801_200415.mp4 → S1-0036)
# เหมือนที่ uploader.py ทำตอนใช้งานจริงทุกประการ
set -e
cd "$(dirname "$0")"

export $(grep -E '^CLOUD_(URL|API_KEY)=' .env | xargs)
PIN="1111"        # ของจริงลูกค้าตั้งเองบนจอที่เลน

if [ -z "$CLOUD_URL" ] || [ -z "$CLOUD_API_KEY" ]; then
  echo "❌ ยังไม่ได้ตั้ง CLOUD_URL / CLOUD_API_KEY ใน .env"; exit 1
fi

# ── หาคลิป + ดึงเลขเซสชันจากชื่อไฟล์ ─────────────────
CLIP="${1:-$(ls -t downloads/clips/*/*.mp4 2>/dev/null | head -1)}"
if [ -z "$CLIP" ] || [ ! -f "$CLIP" ]; then
  echo "❌ ไม่เจอคลิปในเครื่อง — ระบุไฟล์เอง: ./test_cloud.sh /path/to/clip.mp4"; exit 1
fi

NAME=$(basename "$CLIP")
CODE="${NAME%%_*}"                       # ตัดตั้งแต่ _ แรก → เหลือเลขเซสชัน
LANE=$(basename "$(dirname "$CLIP")")    # ch1 → เลน
LANE="${LANE#ch}"

echo "เซิร์ฟเวอร์ : $CLOUD_URL"
echo "คลิป        : $NAME"
echo "เลขเซสชัน   : $CODE   (เลน $LANE)"
echo

# ── 1. เซิร์ฟเวอร์ตอบไหม ─────────────────────────────
echo "1) เช็คว่าเซิร์ฟเวอร์ออนไลน์…"
curl -sf --max-time 15 "$CLOUD_URL/api/health" \
  || { echo "❌ ต่อไม่ได้ — เช็คเน็ต หรือ CLOUD_URL"; exit 1; }
echo "  ✅"
echo

# ── 2. ลงทะเบียนเซสชัน ───────────────────────────────
echo "2) ลงทะเบียนเซสชัน $CODE …"
curl -sf --max-time 20 -X POST "$CLOUD_URL/api/ingest/sessions" \
  -H "X-API-Key: $CLOUD_API_KEY" -H "Content-Type: application/json" \
  -d "{\"code\":\"$CODE\",\"pin\":\"$PIN\",\"lane\":$LANE}" \
  || { echo "❌ ไม่ผ่าน — มักเป็นเพราะ CLOUD_API_KEY ไม่ตรงกับ API_KEY บนเซิร์ฟเวอร์"; exit 1; }
echo "  ✅"
echo

# ── 3. อัปคลิป ───────────────────────────────────────
SIZE=$(du -h "$CLIP" | cut -f1)
echo "3) อัปคลิป ($SIZE) …"
curl -f --max-time 900 --progress-bar -X POST "$CLOUD_URL/api/ingest/videos" \
  -H "X-API-Key: $CLOUD_API_KEY" \
  -F "code=$CODE" -F "sub_no=1" -F "filename=$NAME" -F "duration_s=10" \
  -F "file=@$CLIP" \
  || { echo "❌ อัปไม่สำเร็จ"; exit 1; }
echo
echo "  ✅"

cat <<EOF

──────────────────────────────────────────
  สำเร็จทั้งหมด

  เปิด $CLOUD_URL
  เลขเซสชัน: $CODE     PIN: $PIN

  (รอ 10-60 วิให้เซิร์ฟเวอร์ทำลายน้ำก่อน)
──────────────────────────────────────────
EOF
