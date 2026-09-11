/*
 * ทดสอบระบบทั้งเส้น — รันหลัง deploy เพื่อดูว่าทุกอย่างทำงานจริง
 *
 *   npm start          (หน้าต่าง 1 — ต้องรันค้างไว้)
 *   npm run selftest   (หน้าต่าง 2)
 *
 * สร้างเซสชัน S1-SELFTEST ทดสอบครบทุกขั้น แล้วบอกว่าผ่านกี่ข้อ
 * ข้อมูลทดสอบจะหมดอายุและถูกลบเองตาม RETENTION_DAYS
 */
import 'dotenv/config';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const BASE = process.env.SELFTEST_URL || `http://localhost:${process.env.PORT || 8080}`;
const KEY = process.env.API_KEY || 'devkey';
const ADMIN = { 'X-Admin-Key': process.env.ADMIN_KEY || 'devadmin' };
const CODE = 'S1-SELFTEST';
const PIN = '4321';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log('  ✅', name); }
  else { fail++; console.log('  ❌', name, extra); }
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const json = async (r) => { try { return await r.json(); } catch { return {}; } };

// ── สร้างคลิปทดสอบเล็กๆ ด้วย ffmpeg ────────────────────
const clip = path.join(os.tmpdir(), 'selftest.mp4');
const ff = spawnSync(process.env.FFMPEG || 'ffmpeg', [
  '-y', '-f', 'lavfi', '-i', 'testsrc=size=1280x720:rate=30:duration=2',
  '-c:v', 'libx264', '-pix_fmt', 'yuv420p', clip,
]);
if (ff.status !== 0) {
  console.error('❌ เรียก ffmpeg ไม่ได้ — ติดตั้งก่อน: sudo apt install ffmpeg');
  process.exit(1);
}

console.log(`\nทดสอบที่ ${BASE}\n`);

// ── 1. เชื่อมต่อ + สิทธิ์ ───────────────────────────────
const health = await fetch(`${BASE}/api/health`).catch(() => null);
if (!health?.ok) {
  console.error(`❌ ต่อ server ไม่ได้ที่ ${BASE} — รัน "npm start" ค้างไว้ก่อน`);
  process.exit(1);
}
ok('server ตอบสนอง', true);
ok('ปฏิเสธคนไม่มี API key',
  (await fetch(`${BASE}/api/ingest/sessions`, { method: 'POST' })).status === 401);
ok('ปฏิเสธคนไม่มี Admin key',
  (await fetch(`${BASE}/api/admin/live`)).status === 401);

// ── 2. ฝั่งสนาม: ลงทะเบียน + อัปคลิป ───────────────────
const H = { 'X-API-Key': KEY, 'Content-Type': 'application/json' };
const reg = await json(await fetch(`${BASE}/api/ingest/sessions`, {
  method: 'POST', headers: H, body: JSON.stringify({ code: CODE, pin: PIN, lane: 1 }),
}));
ok('ลงทะเบียนเซสชัน (เขียน MySQL ได้)', reg.ok === true, JSON.stringify(reg));

for (const n of [1, 2]) {
  const fd = new FormData();
  fd.set('code', CODE); fd.set('sub_no', String(n));
  fd.set('filename', `selftest-${n}.mp4`); fd.set('duration_s', '2');
  fd.set('file', new Blob([fs.readFileSync(clip)]), 'selftest.mp4');
  const r = await json(await fetch(`${BASE}/api/ingest/videos`, {
    method: 'POST', headers: { 'X-API-Key': KEY }, body: fd,
  }));
  ok(`อัปคลิปที่ ${n}`, r.ok === true, JSON.stringify(r));
}

// ── 3. ffmpeg ทำลายน้ำ ─────────────────────────────────
let look = null;
process.stdout.write('  ⏳ รอ ffmpeg ทำลายน้ำ');
for (let i = 0; i < 60; i++) {
  await sleep(1000); process.stdout.write('.');
  look = await json(await fetch(`${BASE}/api/customer/lookup`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: CODE, pin: PIN }),
  }));
  if (look.videos?.length === 2 && look.videos.every((v) => v.status !== 'processing')) break;
}
console.log('');
ok('ffmpeg ทำลายน้ำสำเร็จ',
  look.videos?.every((v) => v.status === 'ready'),
  JSON.stringify(look.videos));

// ── 4. ฝั่งลูกค้า ───────────────────────────────────────
const token = look.token;
ok('ลูกค้า lookup ด้วย PIN ถูก', !!token);
ok('ปฏิเสธ PIN ผิด', (await fetch(`${BASE}/api/customer/lookup`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: CODE, pin: '0000' }),
})).status === 404);
ok('ปฏิเสธ token ปลอม',
  (await fetch(`${BASE}/api/customer/preview/${look.videos[0].id}?token=aa.bb`)).status === 404);
ok('เล่นคลิปลายน้ำได้',
  (await fetch(`${BASE}/api/customer/preview/${look.videos[0].id}?token=${token}`)).status === 200);

const order = await json(await fetch(`${BASE}/api/customer/orders`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ token, video_id: look.videos[0].id, filter: 'cinema', speed: 0.25 }),
}));
ok('สั่งซื้อได้', order.order_id > 0, JSON.stringify(order));

const payRes = await fetch(`${BASE}/api/customer/orders/${order.order_id}/pay?token=${token}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({}),
});
if (payRes.status === 402) {
  console.log('\n  ℹ️  เปิดโหมดตรวจสอบการชำระเงินจริงอยู่ (PAYGW_URL ถูกตั้งไว้)');
  console.log('     selftest จ่ายเงินจริงไม่ได้ — ทดสอบถึงขั้นนี้พอ');
  console.log(`\n  ผ่าน ${pass} ข้อ · ไม่ผ่าน ${fail} ข้อ\n`);
  process.exit(fail === 0 ? 0 : 1);
}

let st = {};
process.stdout.write('  ⏳ รอ ffmpeg เรนเดอร์ไฟล์ขาย');
for (let i = 0; i < 120; i++) {
  await sleep(1000); process.stdout.write('.');
  st = await json(await fetch(`${BASE}/api/customer/orders/${order.order_id}?token=${token}`));
  if (st.status !== 'rendering') break;
}
console.log('');
ok('เรนเดอร์ไฟล์ขายสำเร็จ', st.status === 'ready', JSON.stringify(st));

if (st.download_url) {
  const d = await fetch(BASE + st.download_url);
  const size = (await d.arrayBuffer()).byteLength;
  ok('ดาวน์โหลดได้', d.status === 200 && size > 0, `${size} bytes`);
  ok('ดาวน์โหลดซ้ำได้', (await fetch(BASE + st.download_url)).status === 200);
  const again = await json(await fetch(`${BASE}/api/customer/orders`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token, video_id: look.videos[0].id, filter: 'cinema', speed: 0.25 }),
  }));
  ok('ซื้อชุดเดิมซ้ำไม่คิดเงินใหม่', again.order_id === order.order_id);
}

// ── 5. สถิติ ────────────────────────────────────────────
const live = await json(await fetch(`${BASE}/api/admin/live`, { headers: ADMIN }));
ok('/admin/live ทำงาน', live['สะสมทั้งหมด']?.['เหตุการณ์'] > 0, JSON.stringify(live));

const sum = await json(await fetch(`${BASE}/api/admin/summary`, { headers: ADMIN }));
ok('/admin/summary ทำงาน', sum['การขาย']?.['รายได้'] > 0);

const ts = await json(await fetch(`${BASE}/api/admin/timeseries?bucket=hour`, { headers: ADMIN }));
ok('/admin/timeseries ทำงาน', ts.points?.length > 0);

const bd = await json(await fetch(`${BASE}/api/admin/breakdown`, { headers: ADMIN }));
ok('/admin/breakdown ทำงาน', bd['ตามฟิลเตอร์']?.length > 0, JSON.stringify(bd));

const pay = await json(await fetch(`${BASE}/api/admin/payments`, { headers: ADMIN }));
ok('/admin/payments บันทึกการโอนเงิน', pay.total > 0 && pay.revenue > 0);

const evs = await json(await fetch(`${BASE}/api/admin/events?limit=200`, { headers: ADMIN }));
const types = new Set(evs.rows?.map((r) => r.type));
ok('/admin/events บันทึก log ครบ',
  ['session.created', 'video.uploaded', 'video.preview_ready', 'customer.lookup',
   'order.created', 'order.paid', 'order.render_done', 'order.download']
    .every((t) => types.has(t)),
  [...types].join(', '));

// ── สรุป ───────────────────────────────────────────────
console.log(`\n${'─'.repeat(50)}`);
console.log(fail === 0 ? `  ✅ ผ่านทั้งหมด ${pass} ข้อ` : `  ผ่าน ${pass} ข้อ · ไม่ผ่าน ${fail} ข้อ`);
console.log(`${'─'.repeat(50)}\n`);
if (fail === 0) {
  console.log('  สถิติจากการทดสอบ:');
  console.log(JSON.stringify(sum, null, 2).split('\n').map((l) => '  ' + l).join('\n'));
}
process.exit(fail === 0 ? 0 : 1);
