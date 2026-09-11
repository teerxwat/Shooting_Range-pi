/*
 * ตรวจสอบการชำระเงินกับ payment API (LianLian) แบบ server-to-server
 *
 * ทำไมต้องมีไฟล์นี้
 *   เดิมหน้าเว็บเป็นคนบอกเซิร์ฟเวอร์ว่า "จ่ายแล้ว" ซึ่งเชื่อไม่ได้เลย —
 *   ใครเปิด devtools แล้วยิง /orders/:id/pay เองก็ได้วิดีโอฟรี
 *   ตอนนี้เซิร์ฟเวอร์จะไปถาม payment API เองว่าจ่ายจริงไหม ยอดตรงไหม
 *
 * API key อยู่ใน .env ฝั่งเซิร์ฟเวอร์เท่านั้น ไม่เคยออกไปถึง browser
 */
import { config } from './config.js';

/** เปิดโหมดตรวจสอบจริงหรือยัง — เว้น PAYGW_URL ว่าง = โหมดทดสอบ */
export const paymentEnabled = () => !!config.paygwUrl;

// ชื่อสถานะที่ถือว่า "จ่ายแล้ว" — เผื่อ gateway ใช้คำต่างกัน
const PAID = ['paid', 'success', 'succeeded', 'completed', 'trade_success', 'finished'];

/** ดึงค่าจาก object โดยลองหลายชื่อ (แต่ละ gateway ตั้งชื่อ field ไม่เหมือนกัน) */
const pick = (obj, ...keys) => {
  for (const k of keys) {
    if (obj?.[k] !== undefined && obj[k] !== null && obj[k] !== '') return obj[k];
  }
  return undefined;
};

/**
 * สร้างรายการชำระเงิน (QR) — ทำฝั่งเซิร์ฟเวอร์ ไม่ให้หน้าเว็บเรียกเอง
 * ยอดเงินมาจากฐานข้อมูล หน้าเว็บกำหนดไม่ได้
 *
 * @returns {{ok:boolean, reason?:string, data?:object}}
 */
/*
 * ข้อความจาก payment gateway เขียนไว้ให้โปรแกรมเมอร์อ่าน ไม่ใช่ลูกค้า
 * ปล่อยไปถึงหน้าเว็บตรงๆ ลูกค้าจะเห็น {"code":401001} แล้วไม่รู้จะทำยังไงต่อ
 * แปลงเป็นข้อความที่บอกว่า "ควรทำอะไรต่อ" แล้วเก็บของจริงไว้ใน log ฝั่งเซิร์ฟเวอร์
 */
const PAY_ERRORS = {
  401001: 'ระบบชำระเงินยังตั้งค่าไม่เสร็จ กรุณาแจ้งพนักงานเพื่อชำระเงินที่เคาน์เตอร์',
  404002: 'ระบบชำระเงินยังตั้งค่าไม่เสร็จ กรุณาแจ้งพนักงานเพื่อชำระเงินที่เคาน์เตอร์',
  431004: 'ยอดชำระต่ำกว่าขั้นต่ำที่ระบบรองรับ กรุณาแจ้งพนักงาน',
};

function friendlyPayError(json, status) {
  const code = Number(json?.detail?.code ?? json?.code);
  if (PAY_ERRORS[code]) return PAY_ERRORS[code];
  if (status === 401 || status === 403) {
    return 'ระบบชำระเงินปฏิเสธคำขอ กรุณาแจ้งพนักงาน';
  }
  return 'สร้าง QR ชำระเงินไม่สำเร็จ กรุณาลองใหม่ หรือแจ้งพนักงาน';
}

export async function createTransfer({ ref, amount, channel, desc, userId, clientIp }) {
  try {
    const r = await fetch(`${config.paygwUrl}/transfer`, {
      method: 'POST',
      headers: { 'X-API-Key': config.paygwKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: Number(amount).toFixed(2),
        channel: channel || 'thai_qr',
        order_desc: desc,
        merchant_order_id: ref,
        expire_seconds: 600,
        // LianLian บังคับส่ง customer — เราไม่เก็บข้อมูลลูกค้า ใช้เลขเซสชันแทน
        customer: { merchant_user_id: userId || 'UNKNOWN', full_name: 'Shooting Range Customer' },
        // WeChat H5 บังคับส่ง IP จริงของลูกค้า ไม่งั้นสร้างรายการไม่ผ่าน
        client_ip: clientIp || undefined,
      }),
      signal: AbortSignal.timeout(30000),
    });

    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const tech = j?.detail?.message || j?.error || `HTTP ${r.status}`;
      const code = j?.detail?.code ?? j?.code ?? '';
      console.error(`[pay] สร้าง QR ไม่สำเร็จ (${ref}): ${tech} ${code}`);
      return { ok: false, reason: friendlyPayError(j, r.status) };
    }
    return { ok: true, data: j?.data ?? j };
  } catch (e) {
    console.error(`[pay] ต่อ payment API ไม่ได้: ${e.message}`);
    return { ok: false, reason: 'ต่อระบบชำระเงินไม่ได้' };
  }
}

/**
 * ถาม payment API ว่ารายการนี้จ่ายแล้วจริงไหม
 * @param {string} ref        merchant_order_id ที่ได้ตอนสร้าง QR
 * @param {number} expect     ยอดที่ต้องได้รับ (บาท) — เอามาจากฐานข้อมูล ไม่ใช่จากหน้าเว็บ
 * @returns {{ok:boolean, reason?:string, method?:string, raw?:object}}
 */
export async function verifyPayment(ref, expect) {
  if (!ref) return { ok: false, reason: 'ไม่มีเลขอ้างอิงการชำระเงิน' };

  let json;
  try {
    const r = await fetch(`${config.paygwUrl}/transfer/${encodeURIComponent(ref)}`, {
      headers: { 'X-API-Key': config.paygwKey },
      signal: AbortSignal.timeout(15000),
    });
    if (!r.ok) {
      console.error(`[pay] ถาม gateway ไม่สำเร็จ ${r.status} (ref=${ref})`);
      return { ok: false, reason: 'ตรวจสอบการชำระเงินไม่สำเร็จ' };
    }
    json = await r.json();
  } catch (e) {
    console.error(`[pay] ต่อ payment API ไม่ได้: ${e.message}`);
    return { ok: false, reason: 'ต่อระบบชำระเงินไม่ได้' };
  }

  const d = json?.data ?? json;
  const status = String(pick(d, 'status', 'trade_status', 'state') ?? '').toLowerCase();

  if (!PAID.includes(status)) {
    return { ok: false, reason: `ยังไม่ได้รับชำระเงิน (สถานะ: ${status || 'ไม่ทราบ'})` };
  }

  // ยอดต้องไม่น้อยกว่าราคาจริงในฐานข้อมูล — กันคนแก้ราคาฝั่งหน้าเว็บ
  const amount = Number(pick(d, 'amount', 'order_amount', 'paid_amount', 'total_amount') ?? 0);
  if (!(amount + 0.001 >= expect)) {
    console.error(`[pay] ยอดไม่ตรง ref=${ref} ได้ ${amount} ต้องการ ${expect}`);
    return { ok: false, reason: 'ยอดชำระไม่ถูกต้อง' };
  }

  return {
    ok: true,
    method: String(pick(d, 'channel', 'payment_method', 'method') ?? 'lianlian'),
    raw: json,
  };
}
