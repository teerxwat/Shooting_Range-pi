/*
 * โทเคนแบบง่าย: payload.signature (HMAC-SHA256) — ไม่ต้องใช้ไลบรารี JWT
 *   customer token : ใช้เรียก API ของเซสชันตัวเอง อายุ 2 ชม.
 *   download token : ฝังใน URL ดาวน์โหลด อายุเท่ากับวันหมดอายุของไฟล์
 */
import crypto from 'node:crypto';
import { config } from './config.js';

const b64 = (s) => Buffer.from(s).toString('base64url');
const sign = (data) =>
  crypto.createHmac('sha256', config.secret).update(data).digest('base64url');

function make(payload) {
  const body = b64(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

function verify(token) {
  if (typeof token !== 'string' || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expect = sign(body);
  if (sig.length !== expect.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expect))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (p.exp && Date.now() > p.exp) return null;
    return p;
  } catch {
    return null;
  }
}

export const makeCustomerToken = (sessionId) =>
  make({ sid: sessionId, exp: Date.now() + 2 * 3600_000 });

export const makeDownloadToken = (orderId, exp) => make({ oid: orderId, exp });

export function customerSessionId(token) {
  const p = verify(token);
  return p?.sid ?? null;
}

export function downloadOrderId(token) {
  const p = verify(token);
  return p?.oid ?? null;
}

/** middleware: ฝั่ง Mac uploader ต้องส่ง header X-API-Key */
export function requireApiKey(req, res, next) {
  if (req.get('X-API-Key') !== config.apiKey) {
    return res.status(401).json({ error: 'API key ไม่ถูกต้อง' });
  }
  next();
}
