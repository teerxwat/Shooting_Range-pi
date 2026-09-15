/*
 * ฐานข้อมูล = MySQL / MariaDB
 *
 * ตั้งค่าใน .env:
 *   DATABASE_URL=mysql://shooting:รหัสผ่าน@localhost:3306/shooting
 *
 * เวลาทั้งหมดเก็บเป็น UTC (session time_zone = +00:00)
 * แล้วค่อยแปลงเป็นเวลาไทยตอนทำสถิติ — กันปัญหาเวลาเพี้ยนตอนย้ายเครื่อง
 *
 * ตารางแบ่ง 2 กลุ่ม
 *   ชั่วคราว (ลบเมื่อไฟล์หมดอายุ) : sessions, videos, orders
 *   ถาวร (ไม่ลบเลย)              : payments, events, staff, session_ends, commission_payouts
 */
import mysql from 'mysql2/promise';
import { config, ensureDirs } from './config.js';

let pool = null;

export async function initDb() {
  ensureDirs();

  if (!config.databaseUrl) {
    throw new Error('ยังไม่ได้ตั้ง DATABASE_URL ใน .env — ดูตัวอย่างใน .env.example');
  }

  pool = mysql.createPool({
    uri: config.databaseUrl,
    connectionLimit: 10,
    timezone: 'Z',              // แปลง Date ของ JS เป็น UTC
    charset: 'utf8mb4_general_ci',
    namedPlaceholders: false,
  });
  pool.on('connection', (c) => c.query("SET time_zone = '+00:00'"));

  const [[row]] = await pool.query('SELECT VERSION() AS v');
  console.log(`  ฐานข้อมูล: MySQL ${row.v}`);

  await migrate();
}

/** คืน { rows, insertId, affected } */
export async function q(sql, params = []) {
  const [res] = await pool.query(sql, params);
  return Array.isArray(res)
    ? { rows: res, insertId: 0, affected: res.length }
    : { rows: [], insertId: res.insertId, affected: res.affectedRows };
}

export const all = async (sql, params) => (await q(sql, params)).rows;
export const one = async (sql, params) => (await q(sql, params)).rows[0] ?? null;
export const insert = async (sql, params) => (await q(sql, params)).insertId;

// ── โครงสร้างตาราง ─────────────────────────────────────
const TABLES = [
  `CREATE TABLE IF NOT EXISTS sessions (
     id          BIGINT AUTO_INCREMENT PRIMARY KEY,
     code        VARCHAR(64)  NOT NULL,
     pin         VARCHAR(16)  NOT NULL,
     lane        INT          NOT NULL,
     created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     expires_at  DATETIME(3)  NOT NULL,
     UNIQUE KEY uq_code (code),
     KEY idx_exp (expires_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS videos (
     id          BIGINT AUTO_INCREMENT PRIMARY KEY,
     session_id  BIGINT       NOT NULL,
     sub_no      INT          NOT NULL,
     filename    VARCHAR(255) NOT NULL,
     status      VARCHAR(20)  NOT NULL DEFAULT 'processing',
     duration_s  FLOAT,
     size_bytes  BIGINT,
     created_at  DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     UNIQUE KEY uq_video (session_id, sub_no),
     CONSTRAINT fk_video_session FOREIGN KEY (session_id)
       REFERENCES sessions(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  `CREATE TABLE IF NOT EXISTS orders (
     id           BIGINT AUTO_INCREMENT PRIMARY KEY,
     video_id     BIGINT       NOT NULL,
     filter       VARCHAR(20)  NOT NULL,
     speed        FLOAT        NOT NULL,
     amount       INT          NOT NULL,
     status       VARCHAR(20)  NOT NULL DEFAULT 'pending',
     render_file  VARCHAR(512),
     downloads    INT          NOT NULL DEFAULT 0,
     created_at   DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     paid_at      DATETIME(3),
     ready_at     DATETIME(3),
     render_ms    INT,
     KEY idx_video (video_id),
     CONSTRAINT fk_order_video FOREIGN KEY (video_id)
       REFERENCES videos(id) ON DELETE CASCADE
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ─────────── ถาวร ไม่ถูกลบพร้อมวิดีโอ ───────────

  // ทุกครั้งที่มีเงินเข้า (ไว้กระทบยอดกับ payment gateway)
  `CREATE TABLE IF NOT EXISTS payments (
     id            BIGINT AUTO_INCREMENT PRIMARY KEY,
     order_id      BIGINT,                 -- ไม่ผูก FK เพราะ order หายตามอายุไฟล์
     session_code  VARCHAR(64)  NOT NULL,
     lane          INT,
     sub_no        INT,
     filter        VARCHAR(20)  NOT NULL,
     speed         FLOAT        NOT NULL,
     amount        INT          NOT NULL,  -- บาท
     method        VARCHAR(32)  NOT NULL DEFAULT 'mock',
     provider_ref  VARCHAR(128),           -- เลขอ้างอิงจากธนาคาร/gateway
     status        VARCHAR(20)  NOT NULL,  -- paid | failed | refunded
     raw           JSON,                   -- payload ดิบที่ gateway ส่งมา
     created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     KEY idx_pay_at (created_at),
     KEY idx_pay_sess (session_code)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ─────────── ผู้ดูแล + ค่าคอมมิชชั่น (ดู STAFF_COMMISSION_API.md) ───────────

  // รายชื่อผู้ดูแล + เรทค่าคอม — ห้ามลบแถว (ลาออก = active 0) ประวัติค่าคอมผูก id ไว้
  `CREATE TABLE IF NOT EXISTS staff (
     id                BIGINT AUTO_INCREMENT PRIMARY KEY,
     name              VARCHAR(100)  NOT NULL,
     phone             VARCHAR(32),
     commission_type   VARCHAR(10)   NOT NULL DEFAULT 'fixed',  -- fixed | percent
     commission_value  DECIMAL(10,2) NOT NULL DEFAULT 0,        -- fixed = บาท/เซสชัน, percent = % ยอดขายเซสชัน
     lanes             JSON,                                    -- NULL = ทุกเลน, [1,2] = เฉพาะเลน
     active            TINYINT(1)    NOT NULL DEFAULT 1,
     note              VARCHAR(255),
     created_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     updated_at        DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
     KEY idx_staff_active (active)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // รายงานจบเซสชันจากจอที่เลน (ถาวร) — snapshot ชื่อ/เรทไว้ แก้ตาราง staff ทีหลังไม่กระทบย้อนหลัง
  `CREATE TABLE IF NOT EXISTS session_ends (
     id             BIGINT AUTO_INCREMENT PRIMARY KEY,
     report_id      VARCHAR(36)   NOT NULL,           -- UUID จาก Pi กันส่งซ้ำ
     session_code   VARCHAR(64)   NOT NULL,
     lane           INT,
     channel        INT,
     device         VARCHAR(64),
     started_at     DATETIME(3),
     ended_at       DATETIME(3)   NOT NULL,
     duration_s     INT,
     clip_count     INT           NOT NULL DEFAULT 0,
     action         VARCHAR(10)   NOT NULL,           -- confirm | skip
     staff_id       BIGINT,                           -- NULL = skip หรือหา id ไม่เจอ
     staff_name     VARCHAR(100),
     rate_type      VARCHAR(10),
     rate_value     DECIMAL(10,2),
     staff_matched  TINYINT(1)    NOT NULL DEFAULT 0,
     raw            JSON,
     received_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     UNIQUE KEY uq_report (report_id),
     KEY idx_se_code (session_code),
     KEY idx_se_staff (staff_id, ended_at),
     KEY idx_se_ended (ended_at)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // ปิดยอดจ่ายค่าคอม (ถาวร) — detail เก็บ snapshot รายการเซสชัน/ยอดขาย/เรทที่ใช้คิด
  `CREATE TABLE IF NOT EXISTS commission_payouts (
     id            BIGINT AUTO_INCREMENT PRIMARY KEY,
     staff_id      BIGINT        NOT NULL,
     period_from   DATETIME(3)   NOT NULL,
     period_to     DATETIME(3)   NOT NULL,
     sessions      INT           NOT NULL,
     revenue       INT           NOT NULL,
     amount        DECIMAL(12,2) NOT NULL,
     status        VARCHAR(12)   NOT NULL DEFAULT 'pending', -- pending | paid | void
     detail        JSON,
     note          VARCHAR(255),
     created_at    DATETIME(3)   NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     paid_at       DATETIME(3),
     KEY idx_payout_staff (staff_id, period_from)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,

  // log ทุกเหตุการณ์ในระบบ
  `CREATE TABLE IF NOT EXISTS events (
     id            BIGINT AUTO_INCREMENT PRIMARY KEY,
     type          VARCHAR(48)  NOT NULL,
     session_code  VARCHAR(64),
     lane          INT,
     video_id      BIGINT,
     order_id      BIGINT,
     amount        INT,
     ok            TINYINT(1),
     ms            INT,                    -- ใช้เวลากี่มิลลิวินาที (งาน ffmpeg ฯลฯ)
     bytes         BIGINT,
     meta          JSON,
     created_at    DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
     KEY idx_ev_at (created_at),
     KEY idx_ev_type (type, created_at),
     KEY idx_ev_sess (session_code)
   ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
];

async function migrate() {
  for (const sql of TABLES) await pool.query(sql);

  /*
   * เลขอ้างอิงจาก payment gateway ต้องไม่ซ้ำ — กันคนเอาเลขเดิมมายิงซ้ำ
   * เพื่อปลดล็อคหลายออเดอร์จากการจ่ายครั้งเดียว
   * MySQL ไม่มี CREATE INDEX IF NOT EXISTS เลยต้องลองแล้วกลืน error ตอนมีอยู่แล้ว
   */
  try {
    await pool.query('CREATE UNIQUE INDEX uq_pay_ref ON payments (provider_ref)');
    console.log('  เพิ่ม unique index บน payments.provider_ref แล้ว');
  } catch (e) {
    if (e.errno !== 1061) console.error('  [migrate]', e.message);   // 1061 = index มีอยู่แล้ว
  }

  /*
   * จำ QR ที่สร้างไว้กับออเดอร์ — 1 ออเดอร์มี QR ใบเดียว
   * กดปุ่มซ้ำก็ได้ใบเดิม ลูกค้าจะไม่มีทางสแกนผิดใบแล้วจ่ายซ้ำ
   */
  for (const sql of [
    'ALTER TABLE orders ADD COLUMN pay_ref VARCHAR(64)',
    'ALTER TABLE orders ADD COLUMN pay_expires_at DATETIME(3)',
  ]) {
    try {
      await pool.query(sql);
      console.log('  เพิ่มคอลัมน์:', sql.split('COLUMN ')[1]);
    } catch (e) {
      if (e.errno !== 1060) console.error('  [migrate]', e.message);  // 1060 = คอลัมน์มีแล้ว
    }
  }
}

/*
 * บันทึกเหตุการณ์ — เรียกได้ทุกที่ ไม่ต้อง await (ไม่ให้ log ทำให้ request ช้าหรือพัง)
 *
 * ชนิดเหตุการณ์ที่ระบบบันทึก
 *   session.created         สนามเปิดเซสชันใหม่
 *   video.uploaded          คลิปถูกอัปขึ้นมา
 *   video.preview_ready     ทำลายน้ำเสร็จ
 *   video.preview_failed    ทำลายน้ำไม่สำเร็จ
 *   customer.lookup         ลูกค้ากรอกเลข+PIN (ok = 1/0)
 *   customer.preview        ลูกค้าเปิดดูคลิปลายน้ำ
 *   order.created           กดสั่งซื้อ
 *   order.paid              จ่ายเงินสำเร็จ
 *   order.render_done       เรนเดอร์ไฟล์ขายเสร็จ
 *   order.render_failed     เรนเดอร์ไม่สำเร็จ
 *   order.download          กดดาวน์โหลด (นับซ้ำได้)
 *   session.expired         ถูกลบเพราะหมดอายุ
 *   session.ended           จอที่เลนรายงานจบเซสชัน (+ ผู้ดูแล)
 *   session.staff_changed   แอดมินแก้ผู้ดูแลของเซสชัน
 *   staff.created / staff.updated               จัดการรายชื่อผู้ดูแล
 *   commission.payout_created / _paid / _void   ปิดยอด / จ่าย / ยกเลิกค่าคอม
 */
export function logEvent(type, f = {}) {
  q(
    `INSERT INTO events (type, session_code, lane, video_id, order_id, amount, ok, ms, bytes, meta)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    [type, f.session_code ?? null, f.lane ?? null, f.video_id ?? null, f.order_id ?? null,
     f.amount ?? null, f.ok === undefined ? null : (f.ok ? 1 : 0),
     f.ms ?? null, f.bytes ?? null, f.meta ? JSON.stringify(f.meta) : null]
  ).catch((e) => console.error('[log]', type, e.message));
}
