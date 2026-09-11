/*
 * /api/ingest/*  — ใช้โดยเครื่องที่สนาม (Mac uploader) เท่านั้น ต้องมี header X-API-Key
 */
import express from 'express';
import multer from 'multer';
import fs from 'node:fs';
import { q, one, insert, logEvent } from '../db.js';
import { config, DIRS, masterPath, previewPath } from '../config.js';
import { requireApiKey } from '../auth.js';
import { makePreview } from '../media.js';

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
