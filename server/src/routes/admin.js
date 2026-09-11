/*
 * /api/admin/*  — สถิติและ log ทั้งหมด (ต้องมี header X-Admin-Key)
 *
 * ข้อมูลมาจากตาราง events + payments ซึ่งไม่ถูกลบตามอายุไฟล์
 * → ย้อนดูได้ตลอด แม้วิดีโอจะถูกลบไปนานแล้ว
 *
 * เก็บเป็น UTC แต่คิดสถิติตามเวลาไทย (+07:00) — ไทยไม่มี daylight saving
 * เลยใช้ offset คงที่ได้ ไม่ต้องพึ่งตาราง timezone ของ MySQL
 */
import express from 'express';
import { q, all, one, logEvent } from '../db.js';
import { startRender } from '../render.js';
import { config } from '../config.js';

export const admin = express.Router();

const TH = "CONVERT_TZ(created_at,'+00:00','+07:00')";   // เวลาไทย

admin.use((req, res, next) => {
  if (req.get('X-Admin-Key') !== config.adminKey) {
    return res.status(401).json({ error: 'admin key ไม่ถูกต้อง' });
  }
  next();
});

/** อ่านช่วงเวลาจาก query — default = 30 วันล่าสุด */
function range(req) {
  const to = req.query.to ? new Date(req.query.to) : new Date();
  const from = req.query.from
    ? new Date(req.query.from)
    : new Date(to.getTime() - 30 * 86400000);
  return [from, to];
}

const num = (v) => Number(v ?? 0);

/*
 * MySQL คืนคอลัมน์ JSON มาเป็น object แล้ว แต่ MariaDB เก็บเป็น LONGTEXT
 * เลยคืนมาเป็น string — แปลงให้เหมือนกันก่อนส่งออก
 */
const parseJson = (rows, ...cols) =>
  rows.map((r) => {
    for (const c of cols) {
      if (typeof r[c] === 'string') {
        try { r[c] = JSON.parse(r[c]); } catch { /* ปล่อยไว้ */ }
      }
    }
    return r;
  });

/** ภาพรวมทั้งช่วง */
admin.get('/summary', async (req, res, next) => {
  try {
    const [from, to] = range(req);

    const ev = await one(
      `SELECT
         SUM(type='session.created')                                  AS sessions,
         SUM(type='video.uploaded')                                   AS clips,
         COALESCE(SUM(CASE WHEN type='video.uploaded' THEN bytes END),0)  AS upload_bytes,
         SUM(type='customer.lookup' AND ok=1)                         AS lookup_ok,
         SUM(type='customer.lookup' AND ok=0)                         AS lookup_fail,
         SUM(type='customer.preview')                                 AS previews,
         SUM(type='order.created')                                    AS orders,
         SUM(type='order.download')                                   AS downloads,
         COALESCE(SUM(CASE WHEN type='order.download' THEN bytes END),0)  AS download_bytes,
         SUM(type='video.preview_failed')                             AS preview_failed,
         SUM(type='order.render_failed')                              AS render_failed,
         AVG(CASE WHEN type='video.preview_ready' THEN ms END)        AS avg_preview_ms,
         AVG(CASE WHEN type='order.render_done'   THEN ms END)        AS avg_render_ms
       FROM events WHERE created_at BETWEEN ? AND ?`,
      [from, to]
    );

    const pay = await one(
      `SELECT COUNT(*) AS paid, COALESCE(SUM(amount),0) AS revenue
       FROM payments WHERE status='paid' AND created_at BETWEEN ? AND ?`,
      [from, to]
    );

    const lookupOk = num(ev.lookup_ok);
    res.json({
      period: { from, to, timezone: 'Asia/Bangkok' },
      การใช้งาน: {
        เซสชัน: num(ev.sessions),
        คลิปที่อัด: num(ev.clips),
        ลูกค้าเปิดดู: lookupOk,
        กรอกPINผิด: num(ev.lookup_fail),
        เปิดดูพรีวิว: num(ev.previews),
      },
      การขาย: {
        สั่งซื้อ: num(ev.orders),
        จ่ายแล้ว: num(pay.paid),
        รายได้: num(pay.revenue),
        ดาวน์โหลด: num(ev.downloads),
        อัตราการซื้อ: lookupOk ? +(num(pay.paid) / lookupOk * 100).toFixed(1) : 0,
      },
      ระบบ: {
        อัปโหลดรวม_GB: +(num(ev.upload_bytes) / 1024 ** 3).toFixed(2),
        ดาวน์โหลดรวม_GB: +(num(ev.download_bytes) / 1024 ** 3).toFixed(2),
        ทำลายน้ำเฉลี่ย_วินาที: +(num(ev.avg_preview_ms) / 1000).toFixed(1),
        เรนเดอร์เฉลี่ย_วินาที: +(num(ev.avg_render_ms) / 1000).toFixed(1),
        ทำลายน้ำล้มเหลว: num(ev.preview_failed),
        เรนเดอร์ล้มเหลว: num(ev.render_failed),
      },
    });
  } catch (e) { next(e); }
});

/** กราฟตามเวลา — bucket=hour|day (default day) */
admin.get('/timeseries', async (req, res, next) => {
  try {
    const [from, to] = range(req);
    const hour = req.query.bucket === 'hour';
    const fmt = hour ? '%Y-%m-%d %H:00' : '%Y-%m-%d';

    const evRows = await all(
      `SELECT DATE_FORMAT(${TH}, ?) AS t,
              SUM(type='video.uploaded')   AS clips,
              SUM(type='customer.lookup')  AS lookups,
              SUM(type='order.download')   AS downloads,
              COALESCE(SUM(CASE WHEN type='order.download' THEN bytes END),0) AS download_bytes
       FROM events WHERE created_at BETWEEN ? AND ?
       GROUP BY t ORDER BY t`,
      [fmt, from, to]
    );
    const payRows = await all(
      `SELECT DATE_FORMAT(${TH}, ?) AS t,
              COUNT(*) AS paid, COALESCE(SUM(amount),0) AS revenue
       FROM payments WHERE status='paid' AND created_at BETWEEN ? AND ?
       GROUP BY t ORDER BY t`,
      [fmt, from, to]
    );

    const merged = new Map();
    const slot = (t) => {
      if (!merged.has(t)) {
        merged.set(t, { t, clips: 0, lookups: 0, downloads: 0, download_bytes: 0, paid: 0, revenue: 0 });
      }
      return merged.get(t);
    };
    for (const r of evRows) Object.assign(slot(r.t), {
      clips: num(r.clips), lookups: num(r.lookups),
      downloads: num(r.downloads), download_bytes: num(r.download_bytes),
    });
    for (const r of payRows) Object.assign(slot(r.t), {
      paid: num(r.paid), revenue: num(r.revenue),
    });

    res.json({
      bucket: hour ? 'hour' : 'day',
      timezone: 'Asia/Bangkok',
      points: [...merged.values()].sort((a, b) => a.t.localeCompare(b.t)),
    });
  } catch (e) { next(e); }
});

/** แยกตามฟิลเตอร์ / ความเร็ว / เลน / ชั่วโมงของวัน / วันในสัปดาห์ */
admin.get('/breakdown', async (req, res, next) => {
  try {
    const [from, to] = range(req);
    const P = "WHERE status='paid' AND created_at BETWEEN ? AND ?";

    const [byFilter, bySpeed, byLane, byHour, byWeekday] = await Promise.all([
      all(`SELECT filter AS \`key\`, COUNT(*) AS n, SUM(amount) AS revenue
           FROM payments ${P} GROUP BY 1 ORDER BY n DESC`, [from, to]),
      all(`SELECT CAST(speed AS CHAR) AS \`key\`, COUNT(*) AS n, SUM(amount) AS revenue
           FROM payments ${P} GROUP BY 1 ORDER BY n DESC`, [from, to]),
      all(`SELECT CAST(lane AS CHAR) AS \`key\`, COUNT(*) AS n, SUM(amount) AS revenue
           FROM payments ${P} GROUP BY 1 ORDER BY \`key\``, [from, to]),
      all(`SELECT HOUR(${TH}) AS \`key\`, COUNT(*) AS n
           FROM events WHERE type='video.uploaded' AND created_at BETWEEN ? AND ?
           GROUP BY 1 ORDER BY \`key\``, [from, to]),
      all(`SELECT WEEKDAY(${TH}) AS \`key\`, COUNT(*) AS n
           FROM events WHERE type='video.uploaded' AND created_at BETWEEN ? AND ?
           GROUP BY 1 ORDER BY \`key\``, [from, to]),
    ]);

    const clean = (rows) => rows.map((r) => ({ key: r.key, n: num(r.n), revenue: num(r.revenue) }));
    const DAYS = ['จันทร์', 'อังคาร', 'พุธ', 'พฤหัส', 'ศุกร์', 'เสาร์', 'อาทิตย์'];  // WEEKDAY(): จันทร์=0

    res.json({
      ตามฟิลเตอร์: clean(byFilter),
      ตามความเร็ว: clean(bySpeed),
      ตามเลน: clean(byLane),
      ตามชั่วโมง: clean(byHour),                                    // 0-23 น. คนใช้เยอะช่วงไหน
      ตามวัน: clean(byWeekday).map((r) => ({ ...r, key: DAYS[r.key] })),
    });
  } catch (e) { next(e); }
});

/** รายการโอนเงินทั้งหมด */
admin.get('/payments', async (req, res, next) => {
  try {
    const [from, to] = range(req);
    const limit = Math.min(Number(req.query.limit) || 100, 1000);
    const offset = Number(req.query.offset) || 0;

    const rows = await all(
      `SELECT * FROM payments WHERE created_at BETWEEN ? AND ?
       ORDER BY created_at DESC LIMIT ? OFFSET ?`,
      [from, to, limit, offset]
    );
    const t = await one(
      `SELECT COUNT(*) AS n, COALESCE(SUM(CASE WHEN status='paid' THEN amount END),0) AS revenue
       FROM payments WHERE created_at BETWEEN ? AND ?`,
      [from, to]
    );
    res.json({ total: num(t.n), revenue: num(t.revenue), limit, offset, rows: parseJson(rows, 'raw') });
  } catch (e) { next(e); }
});

/** log ดิบทั้งหมด — กรองด้วย ?type= ได้ */
admin.get('/events', async (req, res, next) => {
  try {
    const [from, to] = range(req);
    const limit = Math.min(Number(req.query.limit) || 200, 2000);
    const offset = Number(req.query.offset) || 0;
    const type = req.query.type || null;

    const rows = await all(
      `SELECT * FROM events
       WHERE created_at BETWEEN ? AND ? AND (? IS NULL OR type = ?)
       ORDER BY id DESC LIMIT ? OFFSET ?`,
      [from, to, type, type, limit, offset]
    );
    const t = await one(
      `SELECT COUNT(*) AS n FROM events
       WHERE created_at BETWEEN ? AND ? AND (? IS NULL OR type = ?)`,
      [from, to, type, type]
    );
    res.json({ total: num(t.n), limit, offset, rows: parseJson(rows, 'meta') });
  } catch (e) { next(e); }
});

/*
 * ยืนยันการชำระเงินด้วยมือ — สำหรับกรณีลูกค้าจ่ายแล้วแต่ระบบไม่รู้
 *
 * ใช้เมื่อไร: webhook จาก gateway หายไป (เน็ตล่ม เซิร์ฟเวอร์รีสตาร์ต gateway มีปัญหา)
 * พนักงานตรวจสลิปของลูกค้าแล้วกดปลดล็อคให้ — บันทึกไว้ว่าใครอนุมัติ ตรวจย้อนหลังได้
 *
 *   POST /api/admin/orders/:id/approve
 *   body: { note, ref }   ← ref = เลขอ้างอิงในสลิป
 */
admin.post('/orders/:id/approve', async (req, res, next) => {
  try {
    const o = await one(
      `SELECT o.*, v.sub_no, s.code, s.lane FROM orders o
       JOIN videos v ON v.id = o.video_id
       JOIN sessions s ON s.id = v.session_id
       WHERE o.id = ?`,
      [Number(req.params.id)]
    );
    if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
    if (o.status !== 'pending') {
      return res.json({ order_id: o.id, status: o.status, note: 'ปลดล็อคไปแล้ว' });
    }

    const ref = String(req.body?.ref || '').trim() || `MANUAL-${o.id}-${Date.now()}`;
    const note = String(req.body?.note || '').slice(0, 300);

    await q(
      `INSERT INTO payments (order_id, session_code, lane, sub_no, filter, speed,
                             amount, method, provider_ref, status, raw)
       VALUES (?,?,?,?,?,?,?,'manual',?,'paid',?)`,
      [o.id, o.code, o.lane, o.sub_no, o.filter, o.speed, o.amount, ref,
       JSON.stringify({ note, approved_at: new Date().toISOString() })]
    );
    await q("UPDATE orders SET status='rendering', paid_at=NOW(3) WHERE id=?", [o.id]);

    logEvent('order.paid', {
      session_code: o.code, lane: o.lane, video_id: o.video_id, order_id: o.id,
      amount: o.amount, meta: { method: 'manual', ref, note },
    });

    // สั่ง render ผ่าน endpoint ของฝั่งลูกค้า (ใช้ตรรกะเดียวกัน ไม่ซ้ำโค้ด)
    startRender(o);

    res.json({ order_id: o.id, status: 'rendering', method: 'manual', ref });
  } catch (e) { next(e); }
});

/** ออเดอร์ที่ยังค้างจ่าย — พนักงานเปิดดูเพื่อตรวจกับสลิป */
admin.get('/pending-orders', async (_req, res, next) => {
  try {
    const rows = await all(
      `SELECT o.id, o.amount, o.filter, o.speed, o.created_at,
              v.sub_no, s.code, s.lane
       FROM orders o
       JOIN videos v ON v.id = o.video_id
       JOIN sessions s ON s.id = v.session_id
       WHERE o.status='pending'
       ORDER BY o.created_at DESC LIMIT 50`
    );
    res.json({
      count: rows.length,
      orders: rows.map((o) => ({
        order_id: o.id, session: o.code, lane: o.lane, clip: o.sub_no,
        filter: o.filter, speed: o.speed, amount: o.amount,
        created_at: new Date(o.created_at).getTime(),
      })),
    });
  } catch (e) { next(e); }
});

/** สถานะ ณ ตอนนี้ */
admin.get('/live', async (req, res, next) => {
  try {
    const s = await one(`
      SELECT
        (SELECT COUNT(*) FROM sessions WHERE expires_at > NOW(3))            AS active_sessions,
        (SELECT COUNT(*) FROM videos   WHERE status='processing')            AS processing,
        (SELECT COUNT(*) FROM videos   WHERE status='ready')                 AS ready,
        (SELECT COUNT(*) FROM orders   WHERE status='rendering')             AS rendering,
        (SELECT COUNT(*) FROM events)                                        AS total_events,
        (SELECT COUNT(*) FROM payments WHERE status='paid')                  AS total_payments,
        (SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='paid')   AS total_revenue
    `);
    res.json({
      เซสชันที่ยังไม่หมดอายุ: num(s.active_sessions),
      คลิปกำลังทำลายน้ำ: num(s.processing),
      คลิปพร้อมขาย: num(s.ready),
      กำลังเรนเดอร์: num(s.rendering),
      สะสมทั้งหมด: {
        เหตุการณ์: num(s.total_events),
        รายการที่ขายได้: num(s.total_payments),
        รายได้รวม: num(s.total_revenue),
      },
    });
  } catch (e) { next(e); }
});
