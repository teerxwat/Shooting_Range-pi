// จุดเชื่อม cloud API — เว็บถูกเสิร์ฟจากโดเมนเดียวกับ API (Caddy) จึงใช้ path ตรงๆ
export const API_BASE = import.meta.env.VITE_API_URL || '';

/*
 * ── ทำไมใช้ localStorage ไม่ใช่ sessionStorage ──────────────
 * sessionStorage ผูกกับ "แท็บ" ตัวเดียว หายทันทีเมื่อ:
 *   - ลูกค้าออกไปแอปธนาคารเพื่อจ่ายเงิน แล้ว iOS ทิ้งแท็บทิ้งเพราะหน่วยความจำไม่พอ
 *   - สแกน QR แล้วเปิดเป็นแท็บใหม่ หรือเปิดคนละเบราว์เซอร์กับที่เคยเข้า
 * ทั้งสองกรณีเกิดขึ้นตลอดใน flow ของเรา ลูกค้าเลยหลุดออกจากระบบกลางคัน
 * localStorage อยู่ข้ามแท็บและข้ามการปิดเบราว์เซอร์ — หมดอายุพร้อมเซสชันจริง
 */
const AUTH_KEY = 'sr.auth';
const VIDEOS_KEY = 'sr.videos';

function readAuth() {
  try {
    const a = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null');
    if (!a) return {};
    if (a.expires_at && a.expires_at < Date.now()) { clearAuth(); return {}; }
    return a;
  } catch { return {}; }
}

export const getToken = () => readAuth().token || '';
export const getCode = () => readAuth().code || '';

export const saveAuth = (token, code, expiresAt) => {
  try {
    localStorage.setItem(AUTH_KEY, JSON.stringify({ token, code, expires_at: expiresAt || 0 }));
  } catch { /* โหมดส่วนตัวของ Safari เขียนไม่ได้ */ }
};

export const clearAuth = () => {
  try {
    localStorage.removeItem(AUTH_KEY);
    localStorage.removeItem(VIDEOS_KEY);
    localStorage.removeItem(PENDING_KEY);
  } catch { /* ignore */ }
};

/** รายการวิดีโอที่ได้ตอน lookup — เก็บไว้ให้รีเฟรชแล้วไม่ต้องกรอก PIN ใหม่ */
export const saveVideos = (data) => {
  try { localStorage.setItem(VIDEOS_KEY, JSON.stringify(data)); } catch { /* ignore */ }
};
export const getVideos = () => {
  try { return JSON.parse(localStorage.getItem(VIDEOS_KEY) || 'null'); } catch { return null; }
};

/*
 * ── ออเดอร์ที่ค้างจ่ายอยู่ ────────────────────────────────
 * ลูกค้ากดจ่าย → ออกไปแอปธนาคาร → กลับมาแล้วหน้าเว็บโหลดใหม่
 * ถ้าไม่จำไว้ ออเดอร์ที่เพิ่งจ่ายจะหายไปเฉยๆ ทั้งที่เงินออกจากบัญชีแล้ว
 * จำไว้ 30 นาที (นานกว่าอายุ QR) พอกลับมาเปิดหน้าเดิมต่อได้เลย
 */
const PENDING_KEY = 'sr.pending';
const PENDING_TTL = 30 * 60 * 1000;

export const savePendingOrder = (o) => {
  try { localStorage.setItem(PENDING_KEY, JSON.stringify({ ...o, at: Date.now() })); }
  catch { /* ignore */ }
};

export const getPendingOrder = () => {
  try {
    const p = JSON.parse(localStorage.getItem(PENDING_KEY) || 'null');
    if (!p || Date.now() - p.at > PENDING_TTL) return null;
    return p;
  } catch { return null; }
};

export const clearPendingOrder = () => {
  try { localStorage.removeItem(PENDING_KEY); } catch { /* ignore */ }
};

/*
 * ── รายการเซสชันที่เคยเข้า (ปุ่มลัดหน้าแรก) ──────────────
 * เก็บแค่ "เลขเซสชัน"
 * ไม่เก็บ PIN และไม่เก็บ token — ลูกค้าต้องกด PIN ใหม่ทุกครั้งเสมอ
 * เลขเซสชันอย่างเดียวเปิดดูอะไรไม่ได้ ต่อให้มือถือหาย
 */
const RECENT_KEY = 'sr.recent';

export function getRecentSessions() {
  try {
    const list = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    const now = Date.now();
    return list
      .filter((s) => !s.expires_at || s.expires_at > now)   // ตัดอันที่หมดอายุทิ้ง
      .sort((a, b) => b.last_used - a.last_used)
      .slice(0, 5);
  } catch {
    return [];
  }
}

export function rememberSession(code, expiresAt) {
  try {
    const list = getRecentSessions().filter((s) => s.code !== code);
    list.unshift({ code, expires_at: expiresAt || 0, last_used: Date.now() });
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 5)));
  } catch { /* โหมดส่วนตัวของ Safari เขียนไม่ได้ — ข้ามไป ไม่ให้พัง */ }
}

export function forgetSession(code) {
  try {
    localStorage.setItem(
      RECENT_KEY,
      JSON.stringify(getRecentSessions().filter((s) => s.code !== code))
    );
  } catch { /* ignore */ }
}

async function req(path, options) {
  const r = await fetch(`${API_BASE}${path}`, options);

  if (!r.ok) {
    /*
     * ดึงข้อความ error ให้อ่านออกเสมอ — แต่ละระบบใช้ชื่อ field ไม่เหมือนกัน
     *   Node ของเรา    → { error: "..." }
     *   FastAPI (paygw) → { detail: "..." } หรือ { detail: [{...}] } ตอน validate ไม่ผ่าน
     * ถ้าไม่ดักดีๆ จะได้ "[object Object]" โผล่ให้ลูกค้าเห็น
     */
    let msg = '';
    try {
      const j = await r.json();
      const d = j.error ?? j.detail ?? j.message;
      if (typeof d === 'string') msg = d;
      else if (Array.isArray(d)) msg = d.map((x) => x?.msg || JSON.stringify(x)).join(', ');
      else if (d) msg = JSON.stringify(d);
    } catch { /* ตอบกลับมาไม่ใช่ JSON */ }

    if (!msg) {
      msg = r.status === 502 ? 'ระบบชำระเงินไม่ตอบสนอง กรุณาลองใหม่'
          : r.status === 402 ? 'ยังไม่ได้รับการชำระเงิน'
          : `เกิดข้อผิดพลาด (${r.status})`;
    }
    throw new Error(msg);
  }

  return r.json();
}

/** ค่าตั้งจากเซิร์ฟเวอร์ (ราคา) — แหล่งความจริงเดียวคือ .env ฝั่งเซิร์ฟเวอร์ */
export const getConfig = () => req('/api/customer/config');

/** กรอกเลขเซสชัน + PIN → token + รายการวิดีโอ */
export const lookup = (code, pin) =>
  req('/api/customer/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, pin })
  });

/** URL ไฟล์ preview (มีลายน้ำ) */
export const previewUrl = (videoId) =>
  `${API_BASE}/api/customer/preview/${videoId}?token=${encodeURIComponent(getToken())}`;

/** สร้างออเดอร์ (ถ้าเคยจ่ายค่าชุดเดิมแล้ว backend คืนออเดอร์เดิมให้เลย) */
export const createOrder = (videoId, filter, speed) =>
  req('/api/customer/orders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ token: getToken(), video_id: videoId, filter, speed })
  });

/** ยืนยันการชำระเงิน (mock — จะถูกแทนด้วย webhook จาก payment gateway จริง) */
export const payOrder = (orderId, merchantOrderId) =>
  req(`/api/customer/orders/${orderId}/pay?token=${encodeURIComponent(getToken())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    // เซิร์ฟเวอร์จะเอาเลขนี้ไปถาม payment API เองว่าจ่ายจริงไหม
    body: JSON.stringify({ merchant_order_id: merchantOrderId })
  });

/** สถานะออเดอร์ + ลิงก์ดาวน์โหลดเมื่อ render เสร็จ */
export const orderStatus = (orderId) =>
  req(`/api/customer/orders/${orderId}?token=${encodeURIComponent(getToken())}`);

/** รายการที่จ่ายแล้ว — กลับมาโหลดซ้ำได้ฟรีจนไฟล์หมดอายุ */
export const getPurchases = () =>
  req(`/api/customer/purchases?token=${encodeURIComponent(getToken())}`);

export const fullUrl = (path) => `${API_BASE}${path}`;

/** ให้เซิร์ฟเวอร์วาดข้อความเป็นรูป QR (WeChat/Alipay ส่งลิงก์มา ไม่ได้ส่งรูป) */
export const qrImageUrl = (data) =>
  `${API_BASE}/api/customer/qr?token=${encodeURIComponent(getToken())}&d=${encodeURIComponent(data)}`;

/* ── ชำระเงิน (LianLian Pay) ────────────────────────────────
 * เซิร์ฟเวอร์เป็นคนสร้าง QR และตรวจสถานะเอง — เว็บไม่ยุ่งกับ payment API โดยตรง
 * ทำให้ 1 ออเดอร์มี QR ใบเดียวเสมอ และแก้ยอดเงินจากเบราว์เซอร์ไม่ได้
 */
export const PAY_CHANNELS = ['thai_qr', 'alipay', 'wechat'];

/** ขอ QR ของออเดอร์ — กดซ้ำได้ ได้ใบเดิมตราบใดที่ยังไม่หมดอายุ */
export const getOrderQr = (orderId, channel) =>
  req(`/api/customer/orders/${orderId}/qr?token=${encodeURIComponent(getToken())}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel })
  });

/** เช็คว่าจ่ายหรือยัง — เซิร์ฟเวอร์ถาม gateway เอง จ่ายแล้วสั่ง render ให้ทันที */
export const getPayStatus = (orderId) =>
  req(`/api/customer/orders/${orderId}/pay-status?token=${encodeURIComponent(getToken())}`);
