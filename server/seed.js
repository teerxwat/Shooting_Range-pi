/*
 * สร้างข้อมูลทดสอบ: เซสชัน S1-TEST / PIN 1234 + อัปคลิปเข้าไป
 *
 *   npm run seed                       ← ใช้คลิปจาก Gopro-connect/downloads/clips (ถ้ามี)
 *   npm run seed -- /path/to/clip.mp4  ← ระบุไฟล์เอง
 *
 * ต้องรัน `npm run dev` ค้างไว้อีกหน้าต่างก่อน
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.API || 'http://localhost:8080';
const KEY = process.env.API_KEY || 'devkey';
const CODE = 'S1-TEST';
const PIN = '1234';

// ── หาไฟล์วิดีโอมาใช้ทดสอบ ──────────────────────────────
function findClips() {
  if (process.argv[2]) return [process.argv[2]];

  const dir = path.resolve(HERE, '../../Gopro-connect/downloads/clips');
  if (!fs.existsSync(dir)) return [];

  const found = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.name.endsWith('.mp4')) found.push(p);
    }
  };
  walk(dir);
  return found
    .sort((a, b) => fs.statSync(a).mtimeMs - fs.statSync(b).mtimeMs)
    .slice(-3);                                   // เอา 3 คลิปล่าสุดพอ
}

const clips = findClips();
if (!clips.length) {
  console.error('❌ ไม่เจอคลิปทดสอบ — ใส่ path เอง:  npm run seed -- /path/to/clip.mp4');
  process.exit(1);
}

// ── ยิงเข้า API ────────────────────────────────────────
const r0 = await fetch(`${BASE}/api/ingest/sessions`, {
  method: 'POST',
  headers: { 'X-API-Key': KEY, 'Content-Type': 'application/json' },
  body: JSON.stringify({ code: CODE, pin: PIN, lane: 1 }),
}).catch(() => null);

if (!r0 || !r0.ok) {
  console.error(`❌ ต่อ server ไม่ได้ที่ ${BASE} — รัน "npm run dev" ค้างไว้ก่อน`);
  process.exit(1);
}
console.log('✅ เซสชัน', CODE, await r0.json());

let n = 0;
for (const clip of clips) {
  n += 1;
  const fd = new FormData();
  fd.set('code', CODE);
  fd.set('sub_no', String(n));
  fd.set('filename', path.basename(clip));
  fd.set('duration_s', '5');
  fd.set('file', new Blob([fs.readFileSync(clip)]), path.basename(clip));

  const r = await fetch(`${BASE}/api/ingest/videos`, { method: 'POST', headers: { 'X-API-Key': KEY }, body: fd });
  console.log(`   คลิป ${n}:`, r.status, await r.text());
}

console.log(`
──────────────────────────────────────────
  เปิดเว็บลูกค้า:  http://localhost:5174
  เลขเซสชัน: ${CODE}    PIN: ${PIN}
  (รอสัก 10-30 วิให้ ffmpeg ทำลายน้ำเสร็จก่อน)
──────────────────────────────────────────`);
