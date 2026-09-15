/*
 * /api/ingest/*  — ใช้โดยเครื่องที่สนาม (Mac uploader) เท่านั้น ต้องมี header X-API-Key
 */
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { q, one, all, insert, logEvent } from '../db.js';
import { config, DIRS, masterPath, previewPath } from '../config.js';
import { requireApiKey } from '../auth.js';
import { makePreview } from '../media.js';
import { ACTIONS, isoToDate, laneAllowed } from '../staff.js';

export const ingest = express.Router();
ingest.use(requireApiKey);

const upload = multer({ dest: DIRS.tmp, limits: { fileSize: 2 * 1024 ** 3 } });

/** ลงทะเบียนเซสชันใหม่ (เรียกซ้ำได้ ไม่พัง) */
ingest.post('/sessions', async (req, res, next) => {
  try {
    const { code, pin, lane } = req.body;
    if (!code || !pin) return res.status(400).json({ error: 'ต้องมี code และ pin' });

    const existing = await one('SELECT id FROM sessions WHERE code = ?', [code]);
    if (existing) return res.json({ ok: true, session_id: existing.id, existing: true });

    const id = await insert(
      `INSERT INTO sessions (code, pin, lane, expires_at)
       VALUES (?, ?, ?, DATE_ADD(NOW(3), INTERVAL ? DAY))`,
      [code, String(pin), Number(lane) || 0, config.retentionDays]
    );
    logEvent('session.created', { session_code: code, lane: Number(lane) || 0 });
    res.json({ ok: true, session_id: id, existing: false });
  } catch (e) { next(e); }
});

/** อัปคลิป 1 ไฟล์ + สั่งทำ preview ลายน้ำเบื้องหลัง */
ingest.post('/videos', upload.single('file'), async (req, res, next) => {
  try {
    const { code, sub_no, filename, duration_s } = req.body;
    const subNo = Number(sub_no);

    const sess = await one('SELECT * FROM sessions WHERE code = ?', [code]);
    if (!sess) {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(404).json({ error: `ไม่พบเซสชัน ${code} — ต้องลงทะเบียนก่อน` });
    }
    if (!req.file?.size) return res.status(400).json({ error: 'ไฟล์ว่าง' });

    const dest = masterPath(code, subNo);
    fs.renameSync(req.file.path, dest);

    // อัปซ้ำคลิปเดิมได้ (ทับของเก่า)
    await q(
      `INSERT INTO videos (session_id, sub_no, filename, status, duration_s, size_bytes)
       VALUES (?,?,?,'processing',?,?)
       ON DUPLICATE KEY UPDATE
         filename = VALUES(filename), status = 'processing',
         duration_s = VALUES(duration_s), size_bytes = VALUES(size_bytes)`,
      [sess.id, subNo, filename || `${code}-${subNo}.mp4`, Number(duration_s) || 0, req.file.size]
    );
    const v = await one('SELECT id FROM videos WHERE session_id = ? AND sub_no = ?',
      [sess.id, subNo]);

    logEvent('video.uploaded', {
      session_code: code, lane: sess.lane, video_id: v.id,
      bytes: req.file.size, meta: { sub_no: subNo, duration_s: Number(duration_s) || 0 },
    });

    // ทำ preview เบื้องหลัง — ตอบ client กลับไปก่อน ไม่ต้องรอ ffmpeg
    const t0 = Date.now();
    makePreview(dest, previewPath(code, subNo), `${code}-${subNo}`)
      .then(async () => {
        await q("UPDATE videos SET status='ready' WHERE id=?", [v.id]);
        logEvent('video.preview_ready', {
          session_code: code, lane: sess.lane, video_id: v.id, ok: true, ms: Date.now() - t0,
        });
      })
      .catch(async (e) => {
        console.error(`[preview] ${code}-${subNo} ไม่สำเร็จ:`, e.message);
        await q("UPDATE videos SET status='failed' WHERE id=?", [v.id]);
        logEvent('video.preview_failed', {
          session_code: code, lane: sess.lane, video_id: v.id, ok: false,
          ms: Date.now() - t0, meta: { error: e.message.slice(0, 300) },
        });
      });

    res.json({ ok: true, video_id: v.id, size: req.file.size, status: 'processing' });
  } catch (e) { next(e); }
});

/*
 * ─────────── ผู้ดูแล + ค่าคอมมิชชั่น (ดู STAFF_COMMISSION_API.md หัวข้อ 4) ───────────
 */

/**
 * รายชื่อผู้ดูแลสำหรับ dropdown ใน popup "จบการใช้งาน" ที่จอเลน
 * GET /api/ingest/staff?lane=2 → { staff: [{ id, name, active }] }
 * Pi รอได้ 3 วิ — query นี้ต้องเบา
 */
ingest.get('/staff', async (req, res, next) => {
  try {
    const lane = Number(req.query.lane) || null;
    const rows = await all('SELECT id, name, lanes FROM staff WHERE active = 1 ORDER BY name');
    res.json({
      staff: rows
        .filter((s) => laneAllowed(s.lanes, lane))
        .map((s) => ({ id: Number(s.id), name: s.name, active: true })),
    });
  } catch (e) { next(e); }
});

const str = (v, max) => (v == null ? null : String(v).slice(0, max));
const intOrNull = (v) => {
  const n = Number(v);
  return v === '' || v == null || !Number.isInteger(n) ? null : n;
};

/**
 * จอเลนรายงานจบเซสชัน (+ ผู้ดูแลที่ได้ค่าคอม)
 * POST /api/ingest/sessions/:code/end
 *
 * Pi ส่งซ้ำทุก 60 วิจนกว่าจะได้ 2xx หรือ 409 → กันซ้ำด้วย report_id
 * 201 = บันทึกแล้ว · 409 = มี report_id นี้แล้ว (Pi ถือว่าสำเร็จ) · 400 = payload เสีย (Pi จะลองใหม่)
 */
ingest.post('/sessions/:code/end', async (req, res, next) => {
  try {
    const b = req.body || {};
    const reportId = String(b.report_id || '').trim();
    const endedAt = isoToDate(b.ended_at);
    const startedAt = isoToDate(b.started_at);

    if (!reportId || reportId.length > 36) {
      return res.status(400).json({ error: 'report_id ต้องมี (UUID ไม่เกิน 36 ตัวอักษร)' });
    }
    if (!ACTIONS.includes(b.action)) {
      return res.status(400).json({ error: 'action ต้องเป็น confirm หรือ skip' });
    }
    if (!endedAt) return res.status(400).json({ error: 'ended_at ต้องเป็นวันเวลา ISO 8601' });
    if (startedAt === undefined) return res.status(400).json({ error: 'started_at รูปแบบไม่ถูกต้อง' });
    if (b.session_code !== req.params.code || req.params.code.length > 64) {
      return res.status(400).json({ error: 'session_code ไม่ตรงกับ URL' });
    }

    if (await one('SELECT id FROM session_ends WHERE report_id = ?', [reportId])) {
      return res.status(409).json({ ok: true, duplicate: true });
    }

    // confirm → หา staff จาก id ที่ Pi ส่งมา แล้ว snapshot ชื่อ + เรท ณ ตอนนี้
    // หาไม่เจอ (เช่นยังใช้ staff.json บน Pi) → ยังรับไว้ staff_matched = 0 ให้แอดมินแก้ทีหลัง
    let staff = null;
    const staffIdIn = b.staff?.id;
    if (b.action === 'confirm' && staffIdIn != null && /^\d+$/.test(String(staffIdIn))) {
      staff = await one(
        'SELECT id, name, commission_type, commission_value FROM staff WHERE id = ?',
        [Number(staffIdIn)]
      );
    }
    const staffName = staff?.name ?? (b.action === 'confirm' ? str(b.staff?.name, 100) : null);

    const id = await insert(
      `INSERT INTO session_ends
         (report_id, session_code, lane, channel, device, started_at, ended_at, duration_s,
          clip_count, action, staff_id, staff_name, rate_type, rate_value, staff_matched, raw)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [reportId, b.session_code, intOrNull(b.lane), intOrNull(b.channel), str(b.device, 64),
       startedAt, endedAt, intOrNull(b.duration_s), Math.max(0, intOrNull(b.clip_count) ?? 0),
       b.action, staff?.id ?? null, staffName,
       staff?.commission_type ?? null, staff?.commission_value ?? null,
       staff ? 1 : 0, JSON.stringify(b)]
    );

    logEvent('session.ended', {
      session_code: b.session_code, lane: intOrNull(b.lane),
      meta: {
        report_id: reportId, session_end_id: id, action: b.action,
        staff_id: staff ? Number(staff.id) : null, staff_name: staffName,
        staff_matched: !!staff, clip_count: intOrNull(b.clip_count), duration_s: intOrNull(b.duration_s),
      },
    });
    res.status(201).json({ ok: true, id, staff_matched: !!staff });
  } catch (e) {
    if (e.errno === 1062) return res.status(409).json({ ok: true, duplicate: true }); // ส่งซ้ำพร้อมกัน
    next(e);
  }
});
