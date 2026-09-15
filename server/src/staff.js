/*
 * ของใช้ร่วมกันของระบบ "ผู้ดูแล + ค่าคอมมิชชั่น" (routes/ingest.js + routes/admin.js)
 * สเปกเต็ม: server/STAFF_COMMISSION_API.md
 */

export const COMMISSION_TYPES = ['fixed', 'percent'];
export const ACTIONS = ['confirm', 'skip'];
export const PAYOUT_STATUSES = ['pending', 'paid', 'void'];

/** MySQL คืน JSON เป็น object แต่ MariaDB คืนเป็น string — แปลงให้เหมือนกัน */
export function parseJsonCol(v) {
  if (v == null || typeof v !== 'string') return v ?? null;
  try { return JSON.parse(v); } catch { return null; }
}

/** lanes: NULL = ทุกเลน, [1,2] = เฉพาะเลน */
export function laneAllowed(lanesCol, lane) {
  const lanes = parseJsonCol(lanesCol);
  return !lane || !Array.isArray(lanes) || lanes.length === 0 || lanes.includes(lane);
}

export const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
export const num = (v) => Number(v ?? 0);

/** ISO 8601 → Date (null ถ้าไม่ส่ง, undefined ถ้ารูปแบบผิด) */
export function isoToDate(v) {
  if (v == null || v === '') return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * ช่วงเวลาสำหรับรายงานค่าคอม — วันที่แบบ YYYY-MM-DD คิดเป็น "ทั้งวันตามเวลาไทย"
 *   from=2026-09-01 → 2026-09-01 00:00:00.000 (+07:00)
 *   to=2026-09-30   → 2026-09-30 23:59:59.999 (+07:00)
 * ส่ง ISO เต็มมาก็ได้ · ไม่ส่ง = 30 วันล่าสุด (หรือ required=true → error)
 * คืน { from, to } หรือ { error }
 */
export function periodRange(query, { required = false } = {}) {
  const bound = (s, end) => {
    if (!s) return null;
    const str = String(s).trim();
    const d = DATE_ONLY.test(str)
      ? new Date(`${str}T${end ? '23:59:59.999' : '00:00:00.000'}+07:00`)
      : new Date(str);
    return Number.isNaN(d.getTime()) ? undefined : d;
  };
  const to = bound(query.to, true);
  const from = bound(query.from, false);
  if (to === undefined || from === undefined) return { error: 'รูปแบบวันที่ไม่ถูกต้อง (ใช้ YYYY-MM-DD หรือ ISO 8601)' };
  if (required && (!from || !to)) return { error: 'ต้องระบุ from และ to' };
  const toD = to || new Date();
  const fromD = from || new Date(toD.getTime() - 30 * 86400000);
  if (fromD > toD) return { error: 'from ต้องไม่หลัง to' };
  return { from: fromD, to: toD };
}

/**
 * ตรวจ body ของ POST/PATCH /api/admin/staff
 * partial=true (PATCH) → ส่งเฉพาะ field ที่แก้
 * คืน { values } (เฉพาะ field ที่ส่งมา, พร้อมเขียนลง DB) หรือ { error }
 */
export function validateStaff(body, { partial = false } = {}) {
  const b = body || {};
  const v = {};
  const has = (k) => Object.prototype.hasOwnProperty.call(b, k);

  if (has('name') || !partial) {
    const name = String(b.name ?? '').trim();
    if (!name || name.length > 100) return { error: 'name ต้องมี 1–100 ตัวอักษร' };
    v.name = name;
  }
  if (has('phone')) {
    const phone = b.phone == null ? null : String(b.phone).trim();
    if (phone && phone.length > 32) return { error: 'phone ยาวได้ไม่เกิน 32 ตัวอักษร' };
    v.phone = phone || null;
  }
  if (has('commission_type') || !partial) {
    if (!COMMISSION_TYPES.includes(b.commission_type)) return { error: 'commission_type ต้องเป็น fixed หรือ percent' };
    v.commission_type = b.commission_type;
  }
  if (has('commission_value') || !partial) {
    const val = Number(b.commission_value);
    if (b.commission_value === '' || b.commission_value == null || !Number.isFinite(val) || val < 0 || val > 99999999) {
      return { error: 'commission_value ต้องเป็นตัวเลข ≥ 0' };
    }
    v.commission_value = round2(val);
  }
  if (has('lanes')) {
    if (b.lanes === null) {
      v.lanes = null;
    } else if (Array.isArray(b.lanes) && b.lanes.every((n) => Number.isInteger(n) && n > 0)) {
      v.lanes = b.lanes.length ? JSON.stringify([...new Set(b.lanes)]) : null;
    } else {
      return { error: 'lanes ต้องเป็น null หรือ array ของเลขเลน เช่น [1,2]' };
    }
  }
  if (has('active')) {
    if (typeof b.active !== 'boolean') return { error: 'active ต้องเป็น true หรือ false' };
    v.active = b.active ? 1 : 0;
  }
  if (has('note')) {
    const note = b.note == null ? null : String(b.note).trim();
    if (note && note.length > 255) return { error: 'note ยาวได้ไม่เกิน 255 ตัวอักษร' };
    v.note = note || null;
  }
  return { values: v };
}

/** percent ต้องไม่เกิน 100 — เช็คหลังรวมค่าเดิม (PATCH อาจแก้แค่ type หรือ value อย่างเดียว) */
export function percentTooHigh(type, value) {
  return type === 'percent' && Number(value) > 100;
}

export function staffOut(s) {
  return {
    id: num(s.id),
    name: s.name,
    phone: s.phone,
    commission_type: s.commission_type,
    commission_value: num(s.commission_value),
    lanes: parseJsonCol(s.lanes),
    active: !!s.active,
    note: s.note,
    created_at: s.created_at,
    updated_at: s.updated_at,
  };
}

/*
 * ยอดขายต่อเซสชัน = ผลรวม payments ที่จ่ายแล้ว (ลูกค้าซื้อผ่านเว็บได้หลายวันหลังจบเซสชัน → คิดสดทุกครั้ง)
 * ใช้คู่กับ alias: session_ends = se
 */
export const REVENUE_JOIN = `
  LEFT JOIN (
    SELECT session_code, SUM(amount) AS revenue
    FROM payments WHERE status = 'paid'
    GROUP BY session_code
  ) p ON p.session_code = se.session_code`;

/** ค่าคอมของ 1 แถว session_ends (เรทที่ snapshot ไว้ตอนจบเซสชัน) */
export const COMMISSION_EXPR = `
  (CASE WHEN se.action = 'confirm' AND se.staff_id IS NOT NULL THEN
     CASE se.rate_type
       WHEN 'fixed'   THEN COALESCE(se.rate_value, 0)
       WHEN 'percent' THEN COALESCE(p.revenue, 0) * COALESCE(se.rate_value, 0) / 100
       ELSE 0 END
   ELSE 0 END)`;
