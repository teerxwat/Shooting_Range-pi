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
import { q, all, one, insert, logEvent } from '../db.js';
import { startRender } from '../render.js';
import { config } from '../config.js';
import {
  ACTIONS, PAYOUT_STATUSES, REVENUE_JOIN, COMMISSION_EXPR,
  periodRange, validateStaff, percentTooHigh, staffOut, parseJsonCol, round2,
} from '../staff.js';

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

/*
 * ═══════════ ผู้ดูแล + ค่าคอมมิชชั่น (STAFF_COMMISSION_API.md หัวข้อ 5) ═══════════
 *
 * ช่วงเวลา from/to แบบ YYYY-MM-DD = ทั้งวันตามเวลาไทย (ดู periodRange ใน staff.js)
 * ค่าคอมคิดสดจากยอดขายจริงทุกครั้ง (ลูกค้าซื้อผ่านเว็บหลังจบเซสชันได้) จนกว่าจะปิดยอด (commission_payouts)
 */

const pageArgs = (req, def = 100) => ({
  limit: Math.min(Math.max(Number(req.query.limit) || def, 1), 1000),
  offset: Math.max(Number(req.query.offset) || 0, 0),
});
const idParam = (req) => (/^\d+$/.test(req.params.id) ? Number(req.params.id) : null);
/** query ที่ต้องเป็นเลขจำนวนเต็ม — ไม่ส่ง = null, ผิดรูปแบบ = undefined (ตอบ 400) */
const intQuery = (v) => (v == null || v === '' ? null : /^\d+$/.test(String(v)) ? Number(v) : undefined);
const isTrue = (v) => ['1', 'true'].includes(String(v));
const has = (o, k) => Object.prototype.hasOwnProperty.call(o || {}, k);

// ── 5.1 รายชื่อผู้ดูแล ──────────────────────────────────────────────

admin.get('/staff', async (req, res, next) => {
  try {
    const rows = await all(
      `SELECT * FROM staff ${isTrue(req.query.active) ? 'WHERE active = 1' : ''}
       ORDER BY active DESC, name`
    );
    res.json({ items: rows.map(staffOut) });
  } catch (e) { next(e); }
});

admin.post('/staff', async (req, res, next) => {
  try {
    const { values, error } = validateStaff(req.body);
    if (error) return res.status(400).json({ error });
    if (percentTooHigh(values.commission_type, values.commission_value)) {
      return res.status(400).json({ error: 'commission_value แบบ percent ต้องไม่เกิน 100' });
    }
    const cols = Object.keys(values);   // ชื่อคอลัมน์มาจาก validateStaff เท่านั้น (ไม่ใช่จาก client ตรงๆ)
    const id = await insert(
      `INSERT INTO staff (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      cols.map((c) => values[c])
    );
    logEvent('staff.created', { meta: { staff_id: id, ...values } });
    res.status(201).json({ ok: true, id });
  } catch (e) { next(e); }
});

admin.patch('/staff/:id', async (req, res, next) => {
  try {
    const id = idParam(req);
    const cur = id && await one('SELECT * FROM staff WHERE id = ?', [id]);
    if (!cur) return res.status(404).json({ error: 'ไม่พบผู้ดูแล' });

    const { values, error } = validateStaff(req.body, { partial: true });
    if (error) return res.status(400).json({ error });
    const cols = Object.keys(values);
    if (!cols.length) return res.status(400).json({ error: 'ไม่มี field ที่จะแก้' });
    if (percentTooHigh(values.commission_type ?? cur.commission_type,
                       values.commission_value ?? cur.commission_value)) {
      return res.status(400).json({ error: 'commission_value แบบ percent ต้องไม่เกิน 100' });
    }

    await q(
      `UPDATE staff SET ${cols.map((c) => `${c} = ?`).join(', ')} WHERE id = ?`,
      [...cols.map((c) => values[c]), id]
    );
    logEvent('staff.updated', { meta: { staff_id: id, changes: values } });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── 5.2 รายการเซสชันที่จบแล้ว ──────────────────────────────────────

admin.get('/session-ends', async (req, res, next) => {
  try {
    const period = periodRange(req.query);
    if (period.error) return res.status(400).json({ error: period.error });
    const { limit, offset } = pageArgs(req);
    const lane = intQuery(req.query.lane);
    const staffId = intQuery(req.query.staff_id);
    if (lane === undefined || staffId === undefined) {
      return res.status(400).json({ error: 'lane / staff_id ต้องเป็นตัวเลข' });
    }

    const where = ['se.ended_at BETWEEN ? AND ?'];
    const params = [period.from, period.to];
    if (lane) { where.push('se.lane = ?'); params.push(lane); }
    if (staffId) { where.push('se.staff_id = ?'); params.push(staffId); }
    if (req.query.action) {
      if (!ACTIONS.includes(req.query.action)) {
        return res.status(400).json({ error: 'action ต้องเป็น confirm หรือ skip' });
      }
      where.push('se.action = ?'); params.push(req.query.action);
    }
    if (isTrue(req.query.unmatched)) where.push("se.action = 'confirm' AND se.staff_matched = 0");
    const W = where.join(' AND ');

    const rows = await all(
      `SELECT se.id, se.report_id, se.session_code, se.lane, se.channel, se.device,
              se.started_at, se.ended_at, se.duration_s, se.clip_count, se.action,
              se.staff_id, se.staff_name, se.staff_matched, se.rate_type, se.rate_value, se.received_at,
              COALESCE(p.revenue, 0) AS revenue, ${COMMISSION_EXPR} AS commission
       FROM session_ends se ${REVENUE_JOIN}
       WHERE ${W}
       ORDER BY se.ended_at DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const t = await one(`SELECT COUNT(*) AS n FROM session_ends se WHERE ${W}`, params);

    res.json({
      period: { from: period.from, to: period.to, timezone: 'Asia/Bangkok' },
      total: num(t.n), limit, offset,
      items: rows.map((r) => ({
        ...r,
        id: num(r.id),
        staff_id: r.staff_id == null ? null : num(r.staff_id),
        staff_matched: !!r.staff_matched,
        rate_value: r.rate_value == null ? null : num(r.rate_value),
        revenue: num(r.revenue),
        commission: round2(r.commission),
      })),
    });
  } catch (e) { next(e); }
});

// ── 5.3 แก้ผู้ดูแลของเซสชัน (กดผิด / ข้ามแล้วอยากเพิ่ม / id จาก staff.json ไม่ตรง) ──

admin.patch('/session-ends/:id', async (req, res, next) => {
  try {
    const id = idParam(req);
    const se = id && await one('SELECT * FROM session_ends WHERE id = ?', [id]);
    if (!se) return res.status(404).json({ error: 'ไม่พบรายการเซสชัน' });

    const b = req.body || {};
    if (!has(b, 'staff_id')) return res.status(400).json({ error: 'ต้องส่ง staff_id (ตัวเลข หรือ null)' });

    let staff = null;
    if (b.staff_id !== null) {
      if (!/^\d+$/.test(String(b.staff_id))) return res.status(400).json({ error: 'staff_id ต้องเป็นตัวเลข หรือ null' });
      staff = await one(
        'SELECT id, name, commission_type, commission_value FROM staff WHERE id = ?',
        [Number(b.staff_id)]
      );
      if (!staff) return res.status(400).json({ error: 'ไม่พบผู้ดูแล' });
    }

    // อยู่ในงวดที่ปิดยอดแล้ว (pending/paid) → ห้ามแก้ ยอดใน payout จะไม่ตรง
    const involved = [se.staff_id, staff?.id].filter((x) => x != null);
    if (involved.length) {
      const locked = await one(
        `SELECT id, status FROM commission_payouts
         WHERE status IN ('pending', 'paid') AND staff_id IN (?) AND ? BETWEEN period_from AND period_to
         LIMIT 1`,
        [involved, se.ended_at]
      );
      if (locked) {
        return res.status(409).json({
          error: `เซสชันนี้อยู่ในงวดค่าคอม #${locked.id} (${locked.status}) — ` +
                 (locked.status === 'pending' ? 'void งวดนั้นก่อนแล้วค่อยแก้' : 'จ่ายไปแล้ว แก้ไม่ได้'),
        });
      }
    }

    await q(
      `UPDATE session_ends
       SET action = ?, staff_id = ?, staff_name = ?, rate_type = ?, rate_value = ?, staff_matched = ?
       WHERE id = ?`,
      [staff ? 'confirm' : 'skip', staff?.id ?? null, staff?.name ?? null,
       staff?.commission_type ?? null, staff?.commission_value ?? null, staff ? 1 : 0, id]
    );
    logEvent('session.staff_changed', {
      session_code: se.session_code, lane: se.lane,
      meta: {
        session_end_id: id,
        from_staff_id: se.staff_id == null ? null : num(se.staff_id), from_staff_name: se.staff_name,
        to_staff_id: staff ? num(staff.id) : null, to_staff_name: staff?.name ?? null,
        note: b.note ? String(b.note).slice(0, 255) : null,
      },
    });
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── 5.4 สรุปค่าคอมมิชชั่น ────────────────────────────────────────────

admin.get('/commissions', async (req, res, next) => {
  try {
    const period = periodRange(req.query);
    if (period.error) return res.status(400).json({ error: period.error });
    const lane = intQuery(req.query.lane);
    if (lane === undefined) return res.status(400).json({ error: 'lane ต้องเป็นตัวเลข' });
    const laneSql = lane ? ' AND se.lane = ?' : '';
    const params = [period.from, period.to, ...(lane ? [lane] : [])];

    const totals = await one(
      `SELECT COUNT(*) AS ended,
              SUM(se.action = 'confirm' AND se.staff_id IS NOT NULL) AS confirmed,
              SUM(se.action = 'skip')                                AS skipped,
              SUM(se.action = 'confirm' AND se.staff_id IS NULL)     AS unmatched,
              COALESCE(SUM(p.revenue), 0)                            AS revenue,
              COALESCE(SUM(${COMMISSION_EXPR}), 0)                   AS commission
       FROM session_ends se ${REVENUE_JOIN}
       WHERE se.ended_at BETWEEN ? AND ?${laneSql}`,
      params
    );

    const rows = await all(
      `SELECT se.staff_id,
              COALESCE(MAX(st.name), MAX(se.staff_name)) AS staff_name,
              COUNT(*)                                   AS sessions,
              COALESCE(SUM(se.clip_count), 0)            AS clips,
              COALESCE(SUM(p.revenue), 0)                AS revenue,
              COALESCE(SUM(${COMMISSION_EXPR}), 0)       AS commission
       FROM session_ends se ${REVENUE_JOIN}
       LEFT JOIN staff st ON st.id = se.staff_id
       WHERE se.action = 'confirm' AND se.staff_id IS NOT NULL
         AND se.ended_at BETWEEN ? AND ?${laneSql}
       GROUP BY se.staff_id
       ORDER BY commission DESC`,
      params
    );

    // จ่ายไปแล้ว = งวดที่ status=paid และอยู่ในช่วงที่ถามทั้งงวด
    const paid = await all(
      `SELECT staff_id, COALESCE(SUM(amount), 0) AS paid_out FROM commission_payouts
       WHERE status = 'paid' AND period_from >= ? AND period_to <= ?
       GROUP BY staff_id`,
      [period.from, period.to]
    );
    const paidMap = new Map(paid.map((r) => [num(r.staff_id), num(r.paid_out)]));

    res.json({
      period: { from: period.from, to: period.to, timezone: 'Asia/Bangkok' },
      totals: {
        sessions_ended: num(totals.ended),
        sessions_confirmed: num(totals.confirmed),
        sessions_skipped: num(totals.skipped),
        unmatched: num(totals.unmatched),
        revenue: num(totals.revenue),
        commission: round2(totals.commission),
      },
      items: rows.map((r) => {
        const commission = round2(r.commission);
        const paidOut = round2(paidMap.get(num(r.staff_id)) || 0);
        return {
          staff_id: num(r.staff_id), staff_name: r.staff_name,
          sessions: num(r.sessions), clips: num(r.clips), revenue: num(r.revenue),
          commission, paid_out: paidOut, outstanding: round2(commission - paidOut),
        };
      }),
    });
  } catch (e) { next(e); }
});

// ── 5.5 ปิดยอด / จ่ายค่าคอม ─────────────────────────────────────────

admin.post('/commission-payouts', async (req, res, next) => {
  try {
    const b = req.body || {};
    if (!/^\d+$/.test(String(b.staff_id ?? ''))) return res.status(400).json({ error: 'staff_id ต้องเป็นตัวเลข' });
    const staff = await one('SELECT id, name FROM staff WHERE id = ?', [Number(b.staff_id)]);
    if (!staff) return res.status(404).json({ error: 'ไม่พบผู้ดูแล' });

    const period = periodRange(b, { required: true });
    if (period.error) return res.status(400).json({ error: period.error });

    const overlap = await one(
      `SELECT id, status FROM commission_payouts
       WHERE staff_id = ? AND status <> 'void' AND period_from <= ? AND period_to >= ?
       LIMIT 1`,
      [staff.id, period.to, period.from]
    );
    if (overlap) {
      return res.status(409).json({
        error: `ช่วงเวลานี้ซ้อนกับงวด #${overlap.id} (${overlap.status}) — void งวดเดิมก่อนถ้าจะคิดใหม่`,
      });
    }

    const rows = await all(
      `SELECT se.id, se.session_code, se.lane, se.ended_at, se.clip_count, se.rate_type, se.rate_value,
              COALESCE(p.revenue, 0) AS revenue, ${COMMISSION_EXPR} AS commission
       FROM session_ends se ${REVENUE_JOIN}
       WHERE se.staff_id = ? AND se.action = 'confirm' AND se.ended_at BETWEEN ? AND ?
       ORDER BY se.ended_at`,
      [staff.id, period.from, period.to]
    );
    if (!rows.length) return res.status(400).json({ error: 'ไม่มีเซสชันของผู้ดูแลคนนี้ในช่วงเวลานี้' });

    const sessions = rows.map((r) => ({
      session_end_id: num(r.id), session_code: r.session_code, lane: r.lane, ended_at: r.ended_at,
      clip_count: num(r.clip_count), revenue: num(r.revenue), rate_type: r.rate_type,
      rate_value: r.rate_value == null ? null : num(r.rate_value), commission: round2(r.commission),
    }));
    const revenue = sessions.reduce((s, r) => s + r.revenue, 0);
    const amount = round2(sessions.reduce((s, r) => s + r.commission, 0));
    const note = b.note ? String(b.note).slice(0, 255) : null;

    const id = await insert(
      `INSERT INTO commission_payouts
         (staff_id, period_from, period_to, sessions, revenue, amount, status, detail, note)
       VALUES (?,?,?,?,?,?,'pending',?,?)`,
      [staff.id, period.from, period.to, sessions.length, revenue, amount,
       JSON.stringify({ computed_at: new Date().toISOString(), staff_name: staff.name, sessions }), note]
    );
    logEvent('commission.payout_created', {
      amount: Math.round(amount),
      meta: { payout_id: id, staff_id: num(staff.id), sessions: sessions.length, revenue, amount },
    });

    res.status(201).json({
      ok: true, id, staff_id: num(staff.id), staff_name: staff.name,
      period_from: period.from, period_to: period.to,
      sessions: sessions.length, revenue, amount, status: 'pending',
    });
  } catch (e) { next(e); }
});

admin.get('/commission-payouts', async (req, res, next) => {
  try {
    const { limit, offset } = pageArgs(req);
    const staffId = intQuery(req.query.staff_id);
    if (staffId === undefined) return res.status(400).json({ error: 'staff_id ต้องเป็นตัวเลข' });
    const where = ['1 = 1'];
    const params = [];
    if (staffId) { where.push('cp.staff_id = ?'); params.push(staffId); }
    if (req.query.status) {
      if (!PAYOUT_STATUSES.includes(req.query.status)) {
        return res.status(400).json({ error: 'status ต้องเป็น pending, paid หรือ void' });
      }
      where.push('cp.status = ?'); params.push(req.query.status);
    }
    const W = where.join(' AND ');

    const rows = await all(
      `SELECT cp.id, cp.staff_id, st.name AS staff_name, cp.period_from, cp.period_to, cp.sessions,
              cp.revenue, cp.amount, cp.status, cp.note, cp.created_at, cp.paid_at
       FROM commission_payouts cp LEFT JOIN staff st ON st.id = cp.staff_id
       WHERE ${W}
       ORDER BY cp.id DESC LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    const t = await one(`SELECT COUNT(*) AS n FROM commission_payouts cp WHERE ${W}`, params);
    res.json({
      total: num(t.n), limit, offset,
      items: rows.map((r) => ({
        ...r, id: num(r.id), staff_id: num(r.staff_id), revenue: num(r.revenue), amount: num(r.amount),
      })),
    });
  } catch (e) { next(e); }
});

admin.get('/commission-payouts/:id', async (req, res, next) => {
  try {
    const id = idParam(req);
    const r = id && await one(
      `SELECT cp.*, st.name AS staff_name FROM commission_payouts cp
       LEFT JOIN staff st ON st.id = cp.staff_id WHERE cp.id = ?`,
      [id]
    );
    if (!r) return res.status(404).json({ error: 'ไม่พบงวดค่าคอม' });
    res.json({
      ...r, id: num(r.id), staff_id: num(r.staff_id), revenue: num(r.revenue),
      amount: num(r.amount), detail: parseJsonCol(r.detail),
    });
  } catch (e) { next(e); }
});

/** body: { status: "paid" | "void", note } — เปลี่ยนได้เฉพาะงวดที่ยัง pending */
admin.patch('/commission-payouts/:id', async (req, res, next) => {
  try {
    const id = idParam(req);
    const cur = id && await one('SELECT id, staff_id, amount, status FROM commission_payouts WHERE id = ?', [id]);
    if (!cur) return res.status(404).json({ error: 'ไม่พบงวดค่าคอม' });

    const b = req.body || {};
    const sets = [];
    const params = [];
    if (has(b, 'status')) {
      if (!['paid', 'void'].includes(b.status)) {
        return res.status(400).json({ error: 'status ต้องเป็น paid หรือ void' });
      }
      if (cur.status !== 'pending') {
        return res.status(409).json({ error: `งวดนี้เป็น ${cur.status} แล้ว เปลี่ยนสถานะไม่ได้` });
      }
      sets.push('status = ?'); params.push(b.status);
      if (b.status === 'paid') sets.push('paid_at = NOW(3)');
    }
    if (has(b, 'note')) {
      sets.push('note = ?'); params.push(b.note ? String(b.note).slice(0, 255) : null);
    }
    if (!sets.length) return res.status(400).json({ error: 'ต้องส่ง status หรือ note' });

    await q(`UPDATE commission_payouts SET ${sets.join(', ')} WHERE id = ?`, [...params, id]);
    if (has(b, 'status')) {
      logEvent(`commission.payout_${b.status}`, {
        amount: Math.round(num(cur.amount)),
        meta: { payout_id: id, staff_id: num(cur.staff_id), note: b.note ?? null },
      });
    }
    res.json({ ok: true });
  } catch (e) { next(e); }
});
