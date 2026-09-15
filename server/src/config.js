import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const config = {
  port: Number(process.env.PORT || 8080),
  databaseUrl: process.env.DATABASE_URL || '',   // mysql://user:pass@localhost:3306/shooting
  apiKey: process.env.API_KEY || 'devkey',
  adminKey: process.env.ADMIN_KEY || 'devadmin',
  // payment API (LianLian) — เว้นว่าง = โหมดทดสอบ ปลดล็อคได้โดยไม่ต้องจ่ายจริง
  paygwUrl: (process.env.PAYGW_URL || '').replace(/\/$/, ''),
  paygwKey: process.env.PAYGW_API_KEY || '',
  secret: process.env.JWT_SECRET || 'devsecret',
  retentionDays: Number(process.env.RETENTION_DAYS || 7),
  price: Number(process.env.PRICE_PER_CLIP || 250),
  watermark: process.env.WATERMARK_TEXT || 'SHOOTING RANGE',
  ffmpeg: process.env.FFMPEG || 'ffmpeg',
  dataDir: path.resolve(ROOT, process.env.DATA_DIR || 'data'),
  webDist: path.resolve(ROOT, '../web/dist/customer'), // ถ้า build แล้วจะเสิร์ฟให้เลย
};

// data/masters = ต้นฉบับ · previews = 720p ลายน้ำ (ดูฟรี) · renders = ไฟล์ขาย
export const DIRS = {
  masters: path.join(config.dataDir, 'masters'),
  previews: path.join(config.dataDir, 'previews'),
  renders: path.join(config.dataDir, 'renders'),
  tmp: path.join(config.dataDir, 'tmp'),
};

export function ensureDirs() {
  for (const d of Object.values(DIRS)) fs.mkdirSync(d, { recursive: true });
}

const sub = (root, code) => {
  const d = path.join(root, code);
  fs.mkdirSync(d, { recursive: true });
  return d;
};

export const masterPath = (code, subNo) => path.join(sub(DIRS.masters, code), `${subNo}.mp4`);
export const previewPath = (code, subNo) => path.join(sub(DIRS.previews, code), `${subNo}.mp4`);
export const renderPath = (code, subNo, filter, speed) =>
  path.join(sub(DIRS.renders, code), `${subNo}_${filter}_${speed}x.mp4`);
