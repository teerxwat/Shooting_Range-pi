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

// ── 2.1 ผู้ดูแล + ค่าคอมมิชชั่น (STAFF_COMMISSION_API.md) ──
// รันก่อนขั้นจ่ายเงิน เพราะเครื่องจริง (PAYGW_URL) จะหยุด selftest ที่ 402
// ข้อมูลในตารางถาวร: ใช้ผู้ดูแลชื่อ SELFTEST คนเดิมทุกรอบ, ปิด active ตอนจบ, งวดค่าคอมถูก void, เซสชันถูกเปลี่ยนเป็น skip
{
  const AH = { ...ADMIN, 'Content-Type': 'application/json' };
  const call = async (method, url, body, headers = AH) => {
    const r = await fetch(BASE + url, { method, headers, body: body && JSON.stringify(body) });
    return { status: r.status, body: await json(r) };
  };
  const today = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);   // วันที่ไทย
  const STAFF_NAME = 'SELFTEST (ทดสอบระบบ)';

  ok('ค่าคอม: ปฏิเสธ percent เกิน 100',
    (await call('POST', '/api/admin/staff', { name: 'x', commission_type: 'percent', commission_value: 150 })).status === 400);

  const list = await call('GET', '/api/admin/staff');
  let staffId = list.body.items?.find((s) => s.name === STAFF_NAME)?.id;
  if (!staffId) {
    const c = await call('POST', '/api/admin/staff', { name: STAFF_NAME, commission_type: 'fixed', commission_value: 50, lanes: [1] });
    staffId = c.body.id;
    ok('ค่าคอม: เพิ่มผู้ดูแล', c.status === 201 && staffId > 0, JSON.stringify(c));
  }
  const up = await call('PATCH', `/api/admin/staff/${staffId}`,
    { active: true, commission_type: 'fixed', commission_value: 50, lanes: [1] });
  ok('ค่าคอม: แก้ข้อมูลผู้ดูแล', up.status === 200, JSON.stringify(up));

  const lane1 = await call('GET', '/api/ingest/staff?lane=1', null, H);
  const lane2 = await call('GET', '/api/ingest/staff?lane=2', null, H);
  ok('ค่าคอม: dropdown ที่เลนกรองตามเลน',
    lane1.body.staff?.some((s) => s.id === staffId) && !lane2.body.staff?.some((s) => s.id === staffId),
    JSON.stringify({ lane1: lane1.body, lane2: lane2.body }));

  const report = {
    report_id: crypto.randomUUID(), session_code: CODE, lane: 1, channel: 1, device: 'selftest',
    started_at: new Date(Date.now() - 3600e3).toISOString(), ended_at: new Date().toISOString(),
    duration_s: 3600, clip_count: 2, action: 'confirm', staff: { id: staffId, name: STAFF_NAME },
  };
  const end1 = await call('POST', `/api/ingest/sessions/${CODE}/end`, report, H);
  ok('ค่าคอม: รับรายงานจบเซสชัน', end1.status === 201 && end1.body.staff_matched === true, JSON.stringify(end1));
  ok('ค่าคอม: ส่งซ้ำ report_id เดิม → 409',
    (await call('POST', `/api/ingest/sessions/${CODE}/end`, report, H)).status === 409);
  ok('ค่าคอม: payload ผิด → 400',
    (await call('POST', `/api/ingest/sessions/${CODE}/end`, { ...report, report_id: crypto.randomUUID(), action: 'x' }, H)).status === 400);

  const ends = await call('GET', `/api/admin/session-ends?staff_id=${staffId}&from=${today}&to=${today}`);
  const se = ends.body.items?.find((r) => r.report_id === report.report_id);
  ok('ค่าคอม: /admin/session-ends คิดค่าคอม fixed ถูก', se?.commission === 50 && se?.staff_matched === true, JSON.stringify(ends.body));

  const com = await call('GET', `/api/admin/commissions?from=${today}&to=${today}`);
  const mine = com.body.items?.find((r) => r.staff_id === staffId);
  ok('ค่าคอม: /admin/commissions สรุปรายคน', mine?.commission >= 50 && mine?.outstanding >= 50, JSON.stringify(com.body));

  // งวดที่ค้าง pending จากรอบก่อน (เช่นรอบก่อนพังกลางทาง) → void ทิ้ง ไม่งั้นช่วงเวลาซ้อน
  const old = await call('GET', `/api/admin/commission-payouts?staff_id=${staffId}&status=pending`);
  for (const p of old.body.items || []) await call('PATCH', `/api/admin/commission-payouts/${p.id}`, { status: 'void' });

  const po = await call('POST', '/api/admin/commission-payouts', { staff_id: staffId, from: today, to: today, note: 'selftest' });
  ok('ค่าคอม: ปิดยอดงวด', po.status === 201 && po.body.amount >= 50 && po.body.status === 'pending', JSON.stringify(po));
  ok('ค่าคอม: ปิดยอดช่วงซ้อน → 409',
    (await call('POST', '/api/admin/commission-payouts', { staff_id: staffId, from: today, to: today })).status === 409);
  ok('ค่าคอม: แก้เซสชันในงวดที่ปิดยอดแล้ว → 409',
    (await call('PATCH', `/api/admin/session-ends/${se?.id}`, { staff_id: null })).status === 409);

  const detail = await call('GET', `/api/admin/commission-payouts/${po.body.id}`);
  ok('ค่าคอม: รายละเอียดงวดมี snapshot เซสชัน',
    detail.body.detail?.sessions?.some((s) => s.session_end_id === se?.id), JSON.stringify(detail.body));

  ok('ค่าคอม: void งวด', (await call('PATCH', `/api/admin/commission-payouts/${po.body.id}`, { status: 'void' })).status === 200);
  ok('ค่าคอม: งวดที่ void แล้วเปลี่ยนเป็น paid ไม่ได้ → 409',
    (await call('PATCH', `/api/admin/commission-payouts/${po.body.id}`, { status: 'paid' })).status === 409);

  const fix = await call('PATCH', `/api/admin/session-ends/${se?.id}`, { staff_id: null, note: 'selftest' });
  const after = await call('GET', `/api/admin/session-ends?staff_id=${staffId}&from=${today}&to=${today}`);
  ok('ค่าคอม: แอดมินแก้เซสชันเป็นไม่มีผู้ดูแล',
    fix.status === 200 && !after.body.items?.some((r) => r.id === se?.id), JSON.stringify(fix));

  await call('PATCH', `/api/admin/staff/${staffId}`, { active: false });
  const lane1b = await call('GET', '/api/ingest/staff?lane=1', null, H);
  ok('ค่าคอม: ผู้ดูแลที่ปิด active ไม่อยู่ใน dropdown', !lane1b.body.staff?.some((s) => s.id === staffId));
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
