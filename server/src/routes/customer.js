/*
 * /api/customer/*  — เว็บดาวน์โหลดของลูกค้า
 *   lookup(code+PIN) → token → รายการคลิป → preview ลายน้ำ
 *   → สั่งซื้อ (ฟิลเตอร์+ความเร็ว) → จ่าย (mock) → render → ดาวน์โหลดซ้ำได้จนหมดอายุ
 *
 * ทุกขั้นตอนถูกบันทึกลงตาราง events / payments (ดู db.js)
 */
import express from 'express';
import fs from 'node:fs';
import QRCode from 'qrcode';
import { q, all, one, insert, logEvent } from '../db.js';
import { config, masterPath, renderPath, previewPath } from '../config.js';
import {
  makeCustomerToken, makeDownloadToken, customerSessionId, downloadOrderId,
} from '../auth.js';
import { FILTERS, renderOrder } from '../media.js';
import { paymentEnabled, verifyPayment, createTransfer } from '../payment.js';
import { startRender } from '../render.js';

export const customer = express.Router();

/*
 * LianLian ไม่รับรายการที่ยอดต่ำกว่า 7.50 บาท (error 431004)
 * ตั้งราคาต่ำกว่านี้ = ลูกค้ากดซื้อแล้วสร้าง QR ไม่ได้ เจอ error ที่อธิบายไม่ถูก
 */
const MIN_PRICE = 7.5;

if (config.price < MIN_PRICE) {
  console.warn(
    `\n  ⚠️  PRICE_PER_CLIP=${config.price} ต่ำกว่าขั้นต่ำของ LianLian (${MIN_PRICE} บาท)`
    + `\n     ลูกค้าจะสร้าง QR ไม่ได้ — แก้ใน .env แล้ว restart\n`
  );
}

// กันเดา PIN: 5 ครั้ง/นาที ต่อเลขเซสชัน
const attempts = new Map();
function rateLimit(code) {
  const t = Date.now();
  const list = (attempts.get(code) || []).filter((x) => t - x < 60_000);
  list.push(t);
  attempts.set(code, list);
  return list.length <= 5;
}

/*
 * ค่าตั้งที่หน้าเว็บต้องรู้ — ราคาเป็นแหล่งความจริงเดียว อยู่ที่ .env ฝั่งเซิร์ฟเวอร์
 * หน้าเว็บดึงไปแสดง ไม่ได้กำหนดเอง (ถ้าให้หน้าเว็บกำหนด แก้ราคาในเบราว์เซอร์ได้)
 */
customer.get('/config', (_req, res) => {
  res.json({ price: config.price, currency: 'THB', min_price: MIN_PRICE });
});

customer.post('/lookup', async (req, res, next) => {
  try {
    const code = String(req.body.code || '').trim().toUpperCase();
    const pin = String(req.body.pin || '').trim();

    if (!rateLimit(code)) {
      logEvent('customer.lookup', { session_code: code, ok: false, meta: { reason: 'rate_limit' } });
      return res.status(429).json({ error: 'ลองผิดหลายครั้งเกินไป รอ 1 นาที' });
    }

    const sess = await one('SELECT * FROM sessions WHERE code = ?', [code]);
    if (!sess || sess.pin !== pin) {
      logEvent('customer.lookup', {
        session_code: code, ok: false,
        meta: { reason: sess ? 'wrong_pin' : 'not_found' },
      });
      return res.status(404).json({ error: 'ไม่พบเซสชัน หรือ PIN ไม่ถูกต้อง' });
    }
    if (new Date(sess.expires_at) < new Date()) {
      logEvent('customer.lookup', { session_code: code, ok: false, meta: { reason: 'expired' } });
      return res.status(410).json({ error: 'เซสชันหมดอายุแล้ว' });
    }

    const videos = await all(
      'SELECT id, sub_no, status, duration_s, created_at FROM videos WHERE session_id=? ORDER BY sub_no',
      [sess.id]
    );
    logEvent('customer.lookup', {
      session_code: code, lane: sess.lane, ok: true, meta: { videos: videos.length },
    });

    res.json({
      token: makeCustomerToken(sess.id),
      code: sess.code,
      expires_at: new Date(sess.expires_at).getTime(),
      videos: videos.map((v) => ({
        id: v.id, sub_no: v.sub_no, label: `${sess.code}-${v.sub_no}`,
        status: v.status, duration_s: v.duration_s,
        created_at: new Date(v.created_at).getTime(),
      })),
    });
  } catch (e) { next(e); }
});

/** คืนวิดีโอ + เซสชัน ถ้า token เป็นเจ้าของจริง */
async function ownVideo(token, videoId) {
  const sid = customerSessionId(token);
  if (!sid) return null;
  return one(
    `SELECT v.*, s.code, s.lane, s.expires_at FROM videos v
     JOIN sessions s ON s.id = v.session_id
     WHERE v.id = ? AND v.session_id = ?`,
    [Number(videoId), sid]
  );
}

async function ownOrder(token, orderId) {
  const sid = customerSessionId(token);
  if (!sid) return null;
  return one(
    `SELECT o.*, v.sub_no, s.code, s.lane, s.id AS session_id, s.expires_at FROM orders o
     JOIN videos v ON v.id = o.video_id
     JOIN sessions s ON s.id = v.session_id
     WHERE o.id = ? AND s.id = ?`,
    [Number(orderId), sid]
  );
}

customer.get('/preview/:id', async (req, res, next) => {
  try {
    const v = await ownVideo(req.query.token, req.params.id);
    if (!v) return res.status(404).json({ error: 'ไม่พบวิดีโอ' });

    const p = previewPath(v.code, v.sub_no);
    if (!fs.existsSync(p)) return res.status(404).json({ error: 'preview ยังไม่พร้อม' });

    // นับเฉพาะตอนเริ่มเล่น (ไม่นับทุก chunk ที่เบราว์เซอร์ขอเพิ่ม)
    if (!req.headers.range || req.headers.range.startsWith('bytes=0-')) {
      logEvent('customer.preview', { session_code: v.code, lane: v.lane, video_id: v.id });
    }
    res.sendFile(p);       // express รองรับ Range request → เลื่อนวิดีโอได้
  } catch (e) { next(e); }
});

customer.post('/orders', async (req, res, next) => {
  try {
    const { token, video_id, filter = 'original' } = req.body;
    const speed = Math.min(Math.max(Number(req.body.speed) || 1, 0.05), 1);
    if (!(filter in FILTERS)) return res.status(400).json({ error: 'ไม่รู้จักฟิลเตอร์' });

    const v = await ownVideo(token, video_id);
    if (!v) return res.status(404).json({ error: 'ไม่พบวิดีโอ' });

    // ชุดเดิมที่จ่ายไปแล้ว → ใช้ออเดอร์เดิม ไม่คิดเงินซ้ำ
    const paid = await one(
      `SELECT * FROM orders WHERE video_id=? AND filter=? AND speed=?
       AND status IN ('rendering','ready') LIMIT 1`,
      [v.id, filter, speed]
    );
    if (paid) return res.json({ order_id: paid.id, status: paid.status, amount: paid.amount });

    // กันไม่ให้สร้างออเดอร์ที่จ่ายเงินไม่ได้ตั้งแต่แรก
    if (config.price < MIN_PRICE) {
      return res.status(503).json({
        error: `ระบบชำระเงินยังไม่พร้อม (ราคาต้องไม่ต่ำกว่า ${MIN_PRICE} บาท)`,
      });
    }

    const id = await insert(
      'INSERT INTO orders (video_id, filter, speed, amount) VALUES (?,?,?,?)',
      [v.id, filter, speed, config.price]
    );
    logEvent('order.created', {
      session_code: v.code, lane: v.lane, video_id: v.id, order_id: id,
      amount: config.price, meta: { filter, speed },
    });
    res.json({ order_id: id, status: 'pending', amount: config.price });
  } catch (e) { next(e); }
});

/*
 * ขอ QR ชำระเงินของออเดอร์นี้
 *
 * 1 ออเดอร์ = QR ใบเดียว — กดซ้ำ/รีเฟรช/เปลี่ยนเครื่อง ก็ได้ใบเดิมตราบใดที่ยังไม่หมดอายุ
 * แก้ปัญหาลูกค้าเห็น QR หลายใบค้างบนจอแล้วสแกนผิดใบ หรือจ่ายซ้ำ 2 รอบ
 *
 * สร้างจากฝั่งเซิร์ฟเวอร์ — ยอดเงินมาจากฐานข้อมูล หน้าเว็บกำหนดเองไม่ได้
 */
customer.post('/orders/:id/qr', async (req, res, next) => {
  try {
    const o = await ownOrder(req.query.token, req.params.id);
    if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
    if (o.status !== 'pending') {
      return res.json({ order_id: o.id, status: o.status, already_paid: true });
    }
    if (!paymentEnabled()) {
      return res.status(503).json({ error: 'ยังไม่ได้ตั้งค่าระบบชำระเงิน' });
    }

    const channel = ['thai_qr', 'alipay', 'wechat'].includes(req.body?.channel)
      ? req.body.channel : 'thai_qr';

    // มีใบเดิมที่ยังไม่หมดอายุ → ใช้ใบเดิม ไม่สร้างใหม่
    if (o.pay_ref && o.pay_expires_at && new Date(o.pay_expires_at) > new Date()) {
      const cur = await verifyPayment(o.pay_ref, o.amount);
      if (cur.ok) return res.json({ order_id: o.id, ref: o.pay_ref, paid: true });

      const again = await createTransfer({
        ref: o.pay_ref, amount: o.amount, channel,
        desc: `${o.code}-${o.sub_no}`, userId: o.code, clientIp: req.ip,
      });
      if (again.ok) {
        return res.json({
          order_id: o.id, ref: o.pay_ref, reused: true, channel,
          qr_image_base64: again.data.qr_image_base64 ?? null,
          qr_content: again.data.qr_content ?? null,
          expires_at: new Date(o.pay_expires_at).getTime(),
          amount: o.amount,
        });
      }
      // สร้างซ้ำด้วย ref เดิมไม่ได้ → ตกไปสร้างใบใหม่ข้างล่าง
    }

    const ref = `SR${o.id}-${Date.now().toString(36).toUpperCase()}`;
    const r = await createTransfer({
      ref, amount: o.amount, channel,
      desc: `${o.code}-${o.sub_no}`, userId: o.code, clientIp: req.ip,
    });
    if (!r.ok) return res.status(502).json({ error: r.reason });

    const expiresAt = r.data.expires_at ? new Date(r.data.expires_at) : new Date(Date.now() + 600_000);
    await q('UPDATE orders SET pay_ref=?, pay_expires_at=? WHERE id=?', [ref, expiresAt, o.id]);

    logEvent('order.qr_created', {
      session_code: o.code, lane: o.lane, order_id: o.id, amount: o.amount,
      meta: { ref, channel, lianlian_order_id: r.data.lianlian_order_id ?? null },
    });

    res.json({
      order_id: o.id, ref, channel,
      qr_image_base64: r.data.qr_image_base64 ?? null,
      qr_content: r.data.qr_content ?? null,
      expires_at: expiresAt.getTime(),
      amount: o.amount,
    });
  } catch (e) { next(e); }
});

/*
 * เช็คว่าจ่ายหรือยัง — เซิร์ฟเวอร์ถาม payment gateway เอง
 * จ่ายแล้ว → บันทึก + สั่ง render ให้เลยในคำขอเดียว ไม่ต้องรอ webhook
 * (ปุ่ม "ฉันจ่ายแล้ว" บนหน้าเว็บก็เรียก endpoint นี้)
 */
customer.get('/orders/:id/pay-status', async (req, res, next) => {
  try {
    const o = await ownOrder(req.query.token, req.params.id);
    if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });
    if (o.status !== 'pending') return res.json({ order_id: o.id, status: o.status, paid: true });
    if (!o.pay_ref) return res.json({ order_id: o.id, status: 'pending', paid: false });

    const v = await verifyPayment(o.pay_ref, o.amount);
    if (!v.ok) {
      const expired = o.pay_expires_at && new Date(o.pay_expires_at) < new Date();
      return res.json({
        order_id: o.id, status: 'pending', paid: false,
        expired: !!expired, reason: v.reason,
      });
    }

    await markPaid(o, v.method, o.pay_ref, v.raw);
    res.json({ order_id: o.id, status: 'rendering', paid: true });
  } catch (e) { next(e); }
});

/** บันทึกการจ่าย + สั่ง render — ใช้ร่วมกันทั้งจ่ายเอง และพนักงานยืนยัน */
async function markPaid(o, method, ref, raw) {
  try {
    await q(
      `INSERT INTO payments (order_id, session_code, lane, sub_no, filter, speed,
                             amount, method, provider_ref, status, raw)
       VALUES (?,?,?,?,?,?,?,?,?,'paid',?)`,
      [o.id, o.code, o.lane, o.sub_no, o.filter, o.speed, o.amount,
       method, ref, JSON.stringify(raw ?? {})]
    );
  } catch (e) {
    if (e.errno !== 1062) throw e;    // ซ้ำ = บันทึกไปแล้ว ไม่เป็นไร
  }
  await q("UPDATE orders SET status='rendering', paid_at=NOW(3) WHERE id=? AND status='pending'", [o.id]);
  logEvent('order.paid', {
    session_code: o.code, lane: o.lane, video_id: o.video_id, order_id: o.id,
    amount: o.amount, meta: { filter: o.filter, speed: o.speed, method, ref },
  });
  startRender(o);
}

/*
 * เดิม: หน้าเว็บบอกว่าจ่ายแล้ว → ยังเก็บไว้เผื่อ client เก่า
 * ของใหม่ใช้ /orders/:id/pay-status แทน (เซิร์ฟเวอร์ตรวจเองทั้งหมด)
 */
customer.post('/orders/:id/pay', async (req, res, next) => {
  try {
    const o = await ownOrder(req.query.token, req.params.id);
    if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });

    if (o.status !== 'pending') {
      return res.json({ order_id: o.id, status: o.status });   // จ่ายไปแล้ว เรียกซ้ำไม่เป็นไร
    }

    const ref = String(req.body?.merchant_order_id || '').trim() || null;
    let method = 'mock';
    let raw = { note: 'โหมดทดสอบ — ยังไม่ได้ตั้ง PAYGW_URL' };

    // ── ถาม payment API เองว่าจ่ายจริงไหม ยอดตรงไหม ──────────────
    if (paymentEnabled()) {
      const v = await verifyPayment(ref, o.amount);
      if (!v.ok) {
        logEvent('order.pay_rejected', {
          session_code: o.code, lane: o.lane, order_id: o.id, ok: false,
          meta: { ref, reason: v.reason },
        });
        return res.status(402).json({ error: v.reason });
      }
      method = v.method;
      raw = v.raw;
    }

    /*
     * บันทึกการจ่ายก่อนปลดล็อค — provider_ref มี unique index
     * ใครเอาเลขอ้างอิงเดิมมายิงซ้ำเพื่อปลดล็อคออเดอร์อื่น จะติดตรงนี้
     */
    try {
      await q(
        `INSERT INTO payments (order_id, session_code, lane, sub_no, filter, speed,
                               amount, method, provider_ref, status, raw)
         VALUES (?,?,?,?,?,?,?,?,?,'paid',?)`,
        [o.id, o.code, o.lane, o.sub_no, o.filter, o.speed, o.amount,
         method, ref, JSON.stringify(raw)]
      );
    } catch (e) {
      if (e.errno === 1062) {                    // ER_DUP_ENTRY
        logEvent('order.pay_rejected', {
          session_code: o.code, order_id: o.id, ok: false,
          meta: { ref, reason: 'เลขอ้างอิงถูกใช้ไปแล้ว' },
        });
        return res.status(409).json({ error: 'เลขอ้างอิงนี้ถูกใช้ไปแล้ว' });
      }
      throw e;
    }

    await q("UPDATE orders SET status='rendering', paid_at=NOW(3) WHERE id=?", [o.id]);
    logEvent('order.paid', {
      session_code: o.code, lane: o.lane, video_id: o.video_id,
      order_id: o.id, amount: o.amount,
      meta: { filter: o.filter, speed: o.speed, method, ref },
    });

    startRender(o);
    res.json({ order_id: o.id, status: 'rendering' });
  } catch (e) { next(e); }
});

customer.get('/orders/:id', async (req, res, next) => {
  try {
    const o = await ownOrder(req.query.token, req.params.id);
    if (!o) return res.status(404).json({ error: 'ไม่พบออเดอร์' });

    const out = { order_id: o.id, status: o.status };
    if (o.status === 'ready') {
      const exp = new Date(o.expires_at).getTime();
      out.download_url = `/api/customer/download/${makeDownloadToken(o.id, exp)}`;
    }
    res.json(out);
  } catch (e) { next(e); }
});

/*
 * ของที่เซสชันนี้จ่ายเงินไปแล้ว — โหลดซ้ำได้ฟรีจนไฟล์หมดอายุ
 * ลูกค้าที่กลับมาทีหลังจะเห็นว่าเคยซื้อชุดไหนไว้ จะได้ไม่จ่ายซ้ำโดยไม่ตั้งใจ
 * รวม status ที่ยังไม่ ready ด้วย เพราะจ่ายแล้วแต่ระบบยังเรนเดอร์ไม่เสร็จก็ต้องเห็น
 */
/*
 * วาดข้อความเป็นรูป QR — ใช้กับ WeChat/Alipay ที่ส่งลิงก์มาแทนรูป
 * โดยเฉพาะ weixin:// ที่กดบนเครื่องเดียวกันไม่ทำงาน ต้องให้อีกเครื่องสแกน
 * จำกัดความยาวและต้องมี token กันคนเอาไปใช้วาด QR อะไรก็ได้ฟรีๆ
 */
customer.get('/qr', async (req, res, next) => {
  try {
    if (!customerSessionId(req.query.token)) {
      return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });
    }
    const data = String(req.query.d || '');
    if (!data || data.length > 512) {
      return res.status(400).json({ error: 'ข้อมูลไม่ถูกต้อง' });
    }
    const png = await QRCode.toBuffer(data, {
      type: 'png', width: 440, margin: 1,
      color: { dark: '#1c1b1a', light: '#ffffff' },
    });
    res.type('png').set('Cache-Control', 'no-store').send(png);
  } catch (e) { next(e); }
});

customer.get('/purchases', async (req, res, next) => {
  try {
    const sid = customerSessionId(req.query.token);
    if (!sid) return res.status(401).json({ error: 'ไม่ได้เข้าสู่ระบบ' });

    const rows = await all(
      `SELECT o.id, o.video_id, o.filter, o.speed, o.status, o.downloads,
              v.sub_no, s.code, s.expires_at
       FROM orders o
       JOIN videos v ON v.id = o.video_id
       JOIN sessions s ON s.id = v.session_id
       WHERE s.id = ? AND o.status <> 'pending'
       ORDER BY o.id DESC`,
      [sid]
    );

    res.json({
      items: rows.map((o) => {
        const item = {
          order_id: o.id,
          video_id: o.video_id,
          label: `${o.code}-${o.sub_no}`,
          filter: o.filter,
          speed: Number(o.speed),
          status: o.status,
          downloads: o.downloads || 0,
        };
        if (o.status === 'ready') {
          const exp = new Date(o.expires_at).getTime();
          item.download_url = `/api/customer/download/${makeDownloadToken(o.id, exp)}`;
        }
        return item;
      }),
    });
  } catch (e) { next(e); }
});

/** ลิงก์ดาวน์โหลดแบบเซ็นชื่อ — กดซ้ำได้จนไฟล์หมดอายุ */
customer.get('/download/:token', async (req, res, next) => {
  try {
    const oid = downloadOrderId(req.params.token);
    if (!oid) return res.status(403).json({ error: 'ลิงก์ไม่ถูกต้องหรือหมดอายุ' });

    const o = await one(
      `SELECT o.*, v.sub_no, s.code, s.lane FROM orders o
       JOIN videos v ON v.id = o.video_id JOIN sessions s ON s.id = v.session_id
       WHERE o.id = ?`,
      [oid]
    );
    if (!o || o.status !== 'ready' || !o.render_file || !fs.existsSync(o.render_file)) {
      return res.status(404).json({ error: 'ไฟล์ไม่พร้อมหรือถูกลบแล้ว' });
    }

    await q('UPDATE orders SET downloads = downloads + 1 WHERE id=?', [o.id]);
    logEvent('order.download', {
      session_code: o.code, lane: o.lane, order_id: o.id,
      bytes: fs.statSync(o.render_file).size,
      meta: { filter: o.filter, speed: o.speed, count: o.downloads + 1 },
    });

    res.download(o.render_file, `${o.code}-${o.sub_no}_${o.filter}_${o.speed}x.mp4`);
  } catch (e) { next(e); }
});
