#!/usr/bin/env bash
# ตรวจสถานะระบบทั้งหมด — อ่านอย่างเดียว ไม่แก้อะไร
# ใช้: bash checkup.sh
R=/var/www/Shooting_range/v2

ok=0; bad=0
chk() {  # $1=ไฟล์ (path เต็ม)  $2=md5ที่ถูก
  if [ ! -f "$1" ]; then printf "  \033[31m✗ ไม่มีไฟล์\033[0m  %s\n" "${1#$R/}"; bad=$((bad+1)); return; fi
  a=$(md5sum "$1" | cut -d' ' -f1)
  if [ "$a" = "$2" ]; then printf "  \033[32m✓\033[0m %s\n" "${1#$R/}"; ok=$((ok+1))
  else printf "  \033[31m✗ เก่า\033[0m      %s  (มี %s)\n" "${1#$R/}" "${a:0:8}"; bad=$((bad+1)); fi
}

echo "════════ 1. ไฟล์ตรงกับบน Mac ไหม ════════"
echo "-- Node (แก้แล้ว restart พอ) --"
chk $R/server/src/index.js                              66f8deb8a96d2d654fe1b98ac7fb09d3
chk $R/server/src/db.js                                 08d7c132220520be702d57f54339fc65
chk $R/server/src/payment.js                            8733083b68e70de8d214830402c29e9f
chk $R/server/src/render.js                             22a8e91bb06444f4fed94655fd5185f7
chk $R/server/src/routes/customer.js                    c4d7ee1abc03e9d9e40bd0ed563bae4b
chk $R/server/src/routes/admin.js                       327da3ba6bdf81ee4b5d537758ee7a59
chk $R/server/public/staff.html                         26aba2e912b0d6aea3ffe641e8192e1b
echo "-- เว็บ (แก้แล้วต้อง build:customer ใหม่) --"
chk $R/web/src/customer/api.js                          7d0a7a03d35a943232ef49cfa9220ab2
chk $R/web/src/customer/components/CheckoutModal.jsx    566d2a925a62736b3d9d96e27e7fa501
chk $R/web/src/customer/pages/Lookup.jsx                b7917f033cbac7e3a4e6debfa47f688b
chk $R/web/src/shared/AppContext.jsx                    b0ec3737548e044fc7f10b2b1ef9faee
chk $R/web/src/shared/components/LanguagePicker.jsx     9abac2cb60a1463fdca1b7a38a850480
chk $R/web/src/shared/components/flags.jsx              ef6f117f739fe6177ff0339c8043e473
chk $R/web/src/shared/i18n/translations.js              7f5ae1a39576d465f733934a9162fafd
echo "  → ตรง $ok / เก่าหรือขาด $bad"

echo
echo "════════ 2. build ล่าสุดมีของใหม่ไหม ════════"
D=$R/web/dist/customer
if [ ! -d "$D" ]; then echo "  ✗ ไม่มี dist/customer — ยังไม่เคย build"; else
  echo "  build เมื่อ: $(date -r "$D" '+%F %H:%M')"
  for kw in "pay-status" "openPayApp" "lang.asked"; do
    grep -rq "$kw" "$D" && echo "  ✓ มี $kw" || echo "  ✗ ไม่มี $kw — ต้อง build ใหม่"
  done
  grep -rq "api/pay/transfer" "$D" && echo "  ✗ ยังมีโค้ดเก่าปนอยู่" || echo "  ✓ ไม่มีโค้ดเก่า"
fi

echo
echo "════════ 3. บริการ ════════"
for s in shot24 paygw caddy mariadb; do
  printf "  %-9s %s\n" "$s" "$(systemctl is-active $s 2>/dev/null || echo '-')"
done

echo
echo "════════ 4. endpoint ตอบจริงไหม ════════"
t() { printf "  %-42s %s\n" "$2" "$(curl -s -o /dev/null -w '%{http_code}' --max-time 6 -X "$1" "http://127.0.0.1:8080$2")"; }
t GET  /api/health
t GET  /api/customer/config
t GET  /api/customer/purchases
t POST /api/customer/orders/1/qr
t GET  /staff
echo "  (401/404 พร้อม JSON = route มีอยู่ ปกติ / 404 HTML = route หาย)"
echo "  purchases ควรได้ 401 · qr ควรได้ 404 · staff ควรได้ 200"

echo
echo "════════ 5. paygw ════════"
curl -s --max-time 6 http://127.0.0.1:9999/health \
  | python3 -c "import json,sys; d=json.load(sys.stdin); [print(f'  {k}: {v}') for k,v in d.items()]" 2>/dev/null \
  || echo "  ✗ ไม่ตอบ"
grep -E "^ALIPAY_MODE" /var/www/api_gateway/.env 2>/dev/null | sed 's/^/  /' || echo "  ALIPAY_MODE ไม่ได้ตั้ง (= offline)"

echo
echo "════════ 6. ราคา ════════"
curl -s --max-time 6 http://127.0.0.1:8080/api/customer/config | sed 's/^/  /'; echo
echo "  price ต้อง >= 7.50 ไม่งั้นลูกค้าสร้าง QR ไม่ได้"

echo
echo "════════ 7. ยอดขายที่บันทึกไว้ ════════"
sudo mysql -N -e "SELECT CONCAT('  ', method, ': ', COUNT(*), ' รายการ  ', IFNULL(SUM(amount),0), ' บาท') FROM shooting.payments GROUP BY method;" 2>/dev/null \
  || echo "  (ข้ามไป — เข้า mysql ไม่ได้)"
