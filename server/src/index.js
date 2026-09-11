/*
 * Shooting Range — server (Node + Express + MySQL)
 *   npm run dev    → http://localhost:8080
 *
 * วิดีโออยู่ในโฟลเดอร์ data/ · ข้อมูลอยู่ใน MySQL
 * สถิติ/log ไม่ถูกลบตามอายุไฟล์ — ดูได้ที่ /api/admin/*
 */
import express from 'express';
import cors from 'cors';
import fs from 'node:fs';
import { config, ensureDirs, DIRS } from './config.js';
import { initDb, q, all, logEvent } from './db.js';
// ฐานข้อมูล = MySQL (ตั้ง DATABASE_URL ใน .env)
import { ingest } from './routes/ingest.js';
import { customer } from './routes/customer.js';
import { admin } from './routes/admin.js';

ensureDirs();

try {
  await initDb();
} catch (e) {
  console.error(`\n  ❌ ต่อฐานข้อมูลไม่ได้: ${e.message}\n`);
  console.error('  ตรวจสอบ:');
  console.error('   1. DATABASE_URL ใน .env ถูกต้องไหม (mysql://user:pass@localhost:3306/shooting)');
  console.error('   2. MySQL รันอยู่ไหม  →  sudo systemctl status mysql');
  console.error('   3. ต่อด้วยมือได้ไหม  →  mysql -u shooting -p shooting\n');
  process.exit(1);
}

const app = express();

/*
 * อยู่หลัง Caddy — ถ้าไม่เปิด trust proxy req.ip จะเป็น 127.0.0.1 ทุกคน
 * WeChat H5 ต้องการ IP จริงของลูกค้า ไม่งั้นสร้างรายการไม่ผ่าน
 */
app.set('trust proxy', true);
app.use(cors());                                   // dev: เว็บรันคนละพอร์ตได้
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.use('/api/ingest', ingest);
app.use('/api/customer', customer);
app.use('/api/admin', admin);

/*
 * หน้าพนักงาน (ปลดล็อควิดีโอเอง) — HTML ไฟล์เดียว ไม่ต้อง build
 * เข้าที่ /staff แล้วใส่ Admin Key — key ไม่ได้ฝังในหน้า ต้องกรอกทุกครั้งที่เปิดใหม่
 */
const publicDir = new URL('../public/', import.meta.url).pathname;
app.get('/staff', (_req, res) => res.sendFile(`${publicDir}staff.html`));

// ถ้า build เว็บลูกค้าไว้แล้ว (npm run build:customer) จะเสิร์ฟจากพอร์ตเดียวกันเลย
if (fs.existsSync(config.webDist)) {
  app.use(express.static(config.webDist));
  app.get('*', (req, res, next) =>
    req.path.startsWith('/api/') ? next() : res.sendFile(`${config.webDist}/index.html`)
  );
}

app.use((err, _req, res, _next) => {
  console.error('[error]', err);
  res.status(500).json({ error: 'เกิดข้อผิดพลาดในระบบ' });
});

/*
 * ลบเซสชัน + ไฟล์ที่หมดอายุ ทุก 1 ชม.
 * ลบเฉพาะ sessions/videos/orders — ตาราง events กับ payments ไม่แตะ (เก็บสถิติถาวร)
 */
async function cleanup() {
  try {
    const expired = await all('SELECT id, code, lane FROM sessions WHERE expires_at < NOW(3)');
    for (const s of expired) {
      for (const root of [DIRS.masters, DIRS.previews, DIRS.renders]) {
        fs.rmSync(`${root}/${s.code}`, { recursive: true, force: true });
      }
      await q('DELETE FROM sessions WHERE id = ?', [s.id]);
      logEvent('session.expired', { session_code: s.code, lane: s.lane });
      console.log(`[cleanup] ลบเซสชันหมดอายุ ${s.code}`);
    }
  } catch (e) {
    console.error('[cleanup]', e.message);
  }
}
cleanup();
setInterval(cleanup, 3600_000);

app.listen(config.port, () => {
  console.log(`\n  ✅ server พร้อมแล้ว → http://localhost:${config.port}`);
  console.log(`     ไฟล์วิดีโอ: ${config.dataDir}`);
  console.log(`     API key (ฝั่งสนาม): ${config.apiKey}`);
  console.log(`     Admin key (ดูสถิติ): ${config.adminKey}\n`);
});
