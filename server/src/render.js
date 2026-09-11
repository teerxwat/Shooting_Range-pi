/*
 * สั่ง render ไฟล์ขาย — แยกออกมาเพราะมี 2 ทางที่เรียกใช้
 *   1. ลูกค้าจ่ายเงินผ่าน QR สำเร็จ
 *   2. พนักงานกดยืนยันด้วยมือ (กรณี webhook หาย)
 */
import fs from 'node:fs';
import { q, logEvent } from './db.js';
import { masterPath, renderPath } from './config.js';
import { renderOrder } from './media.js';

/**
 * @param {{id:number, code:string, lane:number, sub_no:number, filter:string, speed:number}} o
 */
export function startRender(o) {
  const out = renderPath(o.code, o.sub_no, o.filter, o.speed);
  const t0 = Date.now();

  const done = async () => {
    await q(
      "UPDATE orders SET status='ready', render_file=?, ready_at=NOW(3), render_ms=? WHERE id=?",
      [out, Date.now() - t0, o.id]
    );
    logEvent('order.render_done', {
      session_code: o.code, lane: o.lane, order_id: o.id,
      ok: true, ms: Date.now() - t0,
      bytes: fs.existsSync(out) ? fs.statSync(out).size : null,
      meta: { filter: o.filter, speed: o.speed },
    });
  };

  if (fs.existsSync(out)) return done();          // เคย render ชุดนี้แล้ว ใช้ซ้ำ

  renderOrder(masterPath(o.code, o.sub_no), out, o.filter, o.speed)
    .then(done)
    .catch(async (e) => {
      console.error(`[render] order ${o.id} ไม่สำเร็จ:`, e.message);
      await q("UPDATE orders SET status='failed' WHERE id=?", [o.id]);
      logEvent('order.render_failed', {
        session_code: o.code, lane: o.lane, order_id: o.id,
        ok: false, ms: Date.now() - t0, meta: { error: e.message.slice(0, 300) },
      });
    });
}
