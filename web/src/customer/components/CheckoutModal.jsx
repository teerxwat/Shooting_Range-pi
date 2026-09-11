import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/shared/AppContext';
import SaveVideo from './SaveVideo';
import { PayMark, BRAND } from '@/shared/components/paylogos';
import {
  createOrder, fullUrl, orderStatus, getOrderQr, getPayStatus, qrImageUrl,
  savePendingOrder, getPendingOrder, clearPendingOrder
} from '../api';

/*
 * ขั้นตอนซื้อ (LianLian Pay — พร้อมเพย์ / Alipay / WeChat):
 *   choose  → เลือกช่องทางชำระเงิน
 *   qr      → QR จ่ายเงินจริง + เช็คสถานะอัตโนมัติทุก 3 วิ
 *   verify  → จ่ายสำเร็จ → server render ไฟล์ (ฟิลเตอร์+slow ที่เลือก)
 *   ready   → ปุ่มดาวน์โหลด (กลับมาโหลดซ้ำได้จนไฟล์หมดอายุ)
 */
const CHANNELS = ['thai_qr', 'alipay', 'wechat'];
const MERCHANT = '700 SHOOTING RANGE';

const pad = (n) => String(n).padStart(2, '0');
const fmtDateTime = (d) =>
  d ? `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}` : '';

export default function CheckoutModal({ open, videoId, label, filter, speed, price, resume, onClose }) {
  const { t } = useApp();
  const [step, setStep] = useState('choose');   // choose | qr | verify | ready
  const [order, setOrder] = useState(null);
  const [pay, setPay] = useState(null);         // { merchant_order_id, qr_image_base64, qr_content }
  const [channel, setChannel] = useState('thai_qr');
  const [paidAt, setPaidAt] = useState(null);
  const [dl, setDl] = useState('');
  const [err, setErr] = useState('');
  const [busyChannel, setBusyChannel] = useState('');
  const [left, setLeft] = useState(0);          // วินาทีที่เหลือของ QR
  const [checking, setChecking] = useState(false);
  const poll = useRef(null);
  const tick = useRef(null);

  // เปิด modal → สร้างออเดอร์ทันที (ถ้าเคยจ่ายชุดเดิมแล้ว → ข้ามไปหน้าโหลดเลย)
  useEffect(() => {
    if (!open) return;
    setStep('choose');
    setPay(null);
    setDl('');
    setErr('');
    setBusyChannel('');
    setPaidAt(null);
    /*
     * ถ้ากลับมาจากแอปธนาคารแล้วหน้าโหลดใหม่ ให้ใช้ออเดอร์เดิมที่ค้างอยู่
     * ห้ามสร้างใหม่เด็ดขาด ไม่งั้นเงินที่จ่ายไปแล้วจะผูกกับออเดอร์ที่ไม่มีใครดู
     */
    const pending = resume ? getPendingOrder() : null;
    if (pending?.channel) setChannel(pending.channel);
    const boot = pending
      ? orderStatus(pending.order_id).then((st) => ({ ...pending, ...st }))
      : createOrder(videoId, filter, speed);

    boot
      .then((o) => {
        setOrder(o);
        if (o.status !== 'pending') {
          setPaidAt(new Date());
          setStep('verify');
          startRenderPolling(o.order_id);
        } else if (pending) {
          // ออเดอร์เดิมยังไม่จ่าย → ขอ QR ใบเดิมกลับมาแสดงพร้อมเวลาที่เหลือ
          resumeQr(pending);
        }
      })
      .catch(() => {
        clearPendingOrder();
        setErr('');
      });
    return () => { clearInterval(poll.current); clearInterval(tick.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, videoId, filter, speed]);

  // ── เลือกช่องทาง → สร้าง QR จริง แล้วเริ่มเช็คสถานะ ──────────────
  const choose = async (ch) => {
    if (!order || busyChannel) return;
    setBusyChannel(ch);
    setChannel(ch);
    setErr('');
    try {
      // เซิร์ฟเวอร์เป็นคนสร้าง QR — 1 ออเดอร์ได้ใบเดียว กดซ้ำก็ใบเดิม
      const p = await getOrderQr(order.order_id, ch);
      // จ่ายไปแล้ว (กดซ้ำ / จ่ายค้างจากรอบก่อน) → ให้เซิร์ฟเวอร์บันทึกแล้ว render เลย
      if (p.already_paid || p.paid) { clearPendingOrder(); await checkPaid(); return; }
      setPay(p);
      setStep('qr');
      savePendingOrder({ order_id: order.order_id, video_id: videoId, channel: ch, filter, speed });
      startCountdown(p.expires_at);
      startPaymentPolling();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusyChannel('');
    }
  };

  /** ดึง QR ใบเดิมของออเดอร์ที่ค้างกลับมาแสดง (ไม่สร้างใบใหม่) */
  const resumeQr = async (pending) => {
    try {
      const ch = pending.channel || 'thai_qr';
      setChannel(ch);
      const p = await getOrderQr(pending.order_id, ch);
      if (p.already_paid || p.paid) { clearPendingOrder(); await checkPaid(); return; }
      setPay(p);
      setStep('qr');
      startCountdown(p.expires_at);
      startPaymentPolling();
    } catch {
      clearPendingOrder();   // QR หมดอายุไปแล้ว ให้เลือกช่องทางใหม่
    }
  };

  // นับถอยหลังอายุ QR — หมดแล้วหยุด poll แล้วให้กดสร้างใบใหม่
  const startCountdown = (expiresAt) => {
    clearInterval(tick.current);
    const update = () => {
      const s = Math.max(0, Math.floor((expiresAt - Date.now()) / 1000));
      setLeft(s);
      if (s === 0) { clearInterval(tick.current); clearInterval(poll.current); }
    };
    update();
    tick.current = setInterval(update, 1000);
  };

  /*
   * เช็คว่าจ่ายหรือยัง — เซิร์ฟเวอร์ถาม gateway เอง
   * ถ้าจ่ายแล้ว เซิร์ฟเวอร์จะบันทึกและสั่ง render ให้ในคำขอเดียว
   */
  const checkPaid = async ({ manual = false } = {}) => {
    if (manual) setChecking(true);
    try {
      const st = await getPayStatus(order.order_id);
      if (st.paid) {
        clearInterval(poll.current);
        clearInterval(tick.current);
        clearPendingOrder();
        setPaidAt(new Date());
        setStep('verify');
        startRenderPolling(order.order_id);
        return true;
      }
      if (manual) setErr('');
      return false;
    } catch (e) {
      if (manual) setErr(e.message);
      return false;
    } finally {
      if (manual) setChecking(false);
    }
  };

  const startPaymentPolling = () => {
    clearInterval(poll.current);
    poll.current = setInterval(() => { checkPaid(); }, 3000);
  };

  // poll สถานะการ "render" ทุก 2 วิ → พร้อม → โชว์ปุ่มดาวน์โหลด
  const startRenderPolling = (orderId) => {
    clearInterval(poll.current);
    poll.current = setInterval(async () => {
      try {
        const st = await orderStatus(orderId);
        if (st.status === 'ready') {
          clearInterval(poll.current);
          setDl(fullUrl(st.download_url));
          setStep('ready');
        } else if (st.status === 'failed') {
          clearInterval(poll.current);
          setErr('render failed');
        }
      } catch (e) {
        clearInterval(poll.current);
        setErr(e.message);
      }
    }, 2000);
  };

  if (!open) return null;

  const b = BRAND[channel] || BRAND.thai_qr;
  const amount = order?.amount ?? price;
  const refNo = pay?.ref || order?.merchant_order_id || order?.order_id || '';

  const ghostBtn = {
    marginTop: '10px', width: '100%', minHeight: '46px', borderRadius: '12px',
    border: '1px solid var(--border)', background: 'transparent',
    color: 'var(--muted)', fontFamily: 'inherit', fontSize: '15px', cursor: 'pointer'
  };
  const row = (k, v) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', padding: '9px 0', fontSize: '14px' }}>
      <span style={{ color: 'var(--muted)' }}>{k}</span>
      <span style={{ fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>{v}</span>
    </div>
  );

  const paid = step === 'verify' || step === 'ready';

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(18,18,20,.55)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      padding: '20px', zIndex: 50
    }}>
      <div style={{
        background: 'var(--surface)', color: 'var(--text)', borderRadius: '22px',
        width: 'min(430px, 100%)', textAlign: 'center', overflow: 'hidden',
        boxShadow: '0 24px 60px rgba(0,0,0,.32)'
      }}>
        {err && (
          <div style={{ padding: '32px' }}>
            <h2 style={{ margin: '0 0 12px', fontSize: '19px', fontWeight: 700, color: 'var(--warn)' }}>⚠ {err}</h2>
            <button onClick={onClose} style={{ ...ghostBtn, marginTop: 0 }}>{t.close}</button>
          </div>
        )}

        {/* ── 1) เลือกช่องทางชำระเงิน ── */}
        {!err && step === 'choose' && (
          <div style={{ padding: '30px 28px 24px' }}>
            <h2 style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: 700 }}>{t.choosePayMethod}</h2>
            <div style={{ fontSize: '14px', color: 'var(--muted)', marginBottom: '20px' }}>
              {t.amount}: <b style={{ color: 'var(--text)' }}>{amount} {t.baht}</b>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {CHANNELS.map((id) => {
                const br = BRAND[id];
                const busy = busyChannel === id;
                return (
                  <button
                    key={id}
                    onClick={() => choose(id)}
                    disabled={!order || !!busyChannel}
                    style={{
                      minHeight: '64px', borderRadius: '14px', border: '1px solid var(--border)',
                      background: 'var(--surface)', color: 'var(--text)', fontFamily: 'inherit',
                      cursor: order && !busyChannel ? 'pointer' : 'default',
                      display: 'flex', alignItems: 'center', gap: '14px', padding: '0 16px',
                      opacity: order && !busyChannel ? 1 : 0.55, textAlign: 'left'
                    }}
                  >
                    <PayMark channel={id} size={40} />
                    <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                      <span style={{ fontSize: '16px', fontWeight: 700 }}>{br.name}</span>
                      <span style={{ fontSize: '12.5px', color: 'var(--muted)' }}>{br.nameLocal}</span>
                    </span>
                    <span style={{ flex: 1 }} />
                    <span style={{ color: 'var(--muted)', fontSize: '18px' }}>{busy ? '…' : '›'}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={onClose} style={ghostBtn}>{t.cancel}</button>
          </div>
        )}

        {/* ── 2) หน้าจ่ายเงิน — ธีมตามช่องทาง ── */}
        {!err && step === 'qr' && pay && (
          <>
            {/* หัวแบรนด์ */}
            <div style={{ background: b.color, color: b.fg, padding: '18px 22px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px' }}>
              <PayMark channel={channel} size={26} />
              <span style={{ fontWeight: 700, fontSize: '17px' }}>{b.name}</span>
            </div>

            <div style={{ padding: '22px 26px 24px' }}>
              {/* การ์ดแคชเชียร์ */}
              <div style={{ border: '1px solid var(--border)', borderRadius: '16px', padding: '18px', textAlign: 'left' }}>
                {row(t.merchant, MERCHANT)}
                <div style={{ borderTop: '1px solid var(--border)' }} />
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '12px 0 4px' }}>
                  <span style={{ color: 'var(--muted)', fontSize: '14px' }}>{t.amount}</span>
                  <span style={{ fontWeight: 800, fontSize: '30px', color: b.color, letterSpacing: '-.5px' }}>
                    ฿{amount}
                  </span>
                </div>
              </div>

              {pay.qr_image_base64 ? (
                /* พร้อมเพย์ — สแกน QR จริง */
                <>
                  <div style={{ display: 'inline-block', background: '#fff', border: '1px solid var(--border)', borderRadius: '16px', padding: '14px', marginTop: '18px' }}>
                    <img
                      src={`data:image/png;base64,${pay.qr_image_base64}`}
                      alt="payment QR" width={216} height={216}
                      style={{ display: 'block', imageRendering: 'pixelated' }}
                    />
                  </div>
                  <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '10px' }}>{t.scanQrThai}</div>
                </>
              ) : (
                /*
                 * Alipay / WeChat ส่ง "ลิงก์" มา ไม่ใช่รูป QR
                 * ปุ่ม = ลูกค้าถือมือถือเครื่องเดียว กดเปิดแอปเลย
                 * รูป QR = เผื่อ weixin:// ที่กดบนเครื่องเดียวกันไม่ทำงาน ให้อีกเครื่องสแกนได้
                 */
                <>
                <div style={{ background: '#fff', padding: '12px', borderRadius: '14px', display: 'inline-block' }}>
                  <img
                    src={qrImageUrl(pay.qr_content)}
                    alt="payment QR" width={200} height={200}
                    style={{ display: 'block' }}
                  />
                </div>
                <a
                  href={pay.qr_content} target="_blank" rel="noreferrer"
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px',
                    marginTop: '18px', minHeight: '54px', borderRadius: '27px',
                    background: b.color, color: b.fg, fontSize: '17px', fontWeight: 700,
                    textDecoration: 'none'
                  }}
                >
                  <PayMark channel={channel} size={24} />
                  {channel === 'alipay' ? t.openAlipay : channel === 'wechat' ? t.openWechat : t.openPayApp}
                </a>
                </>
              )}

              {/* สถานะ / นับถอยหลัง */}
              {left > 0 ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '13px', color: 'var(--muted)', marginTop: '16px' }}>
                  <span style={{ width: '14px', height: '14px', border: '2px solid var(--border)', borderTopColor: b.color, borderRadius: '50%', animation: 'spin .9s linear infinite' }} />
                  {t.verifying} · {t.qrExpiresIn} {Math.floor(left / 60)}:{pad(left % 60)}
                </div>
              ) : (
                <div style={{ fontSize: '14px', color: 'var(--warn)', marginTop: '16px' }}>{t.qrExpired}</div>
              )}

              {refNo && (
                <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '11.5px', color: 'var(--muted)', marginTop: '8px' }}>
                  {refNo}
                </div>
              )}

              {left > 0 ? (
                <button
                  onClick={() => checkPaid({ manual: true })}
                  disabled={checking}
                  style={{ marginTop: '16px', width: '100%', minHeight: '52px', borderRadius: '12px', border: 'none', background: b.color, color: b.fg, fontFamily: 'inherit', fontSize: '16px', fontWeight: 700, cursor: 'pointer' }}
                >
                  {checking ? t.checking : t.iHavePaid}
                </button>
              ) : (
                <button
                  onClick={() => choose(channel)}
                  style={{ marginTop: '16px', width: '100%', minHeight: '52px', borderRadius: '12px', border: 'none', background: b.color, color: b.fg, fontFamily: 'inherit', fontSize: '16px', fontWeight: 700, cursor: 'pointer' }}
                >
                  {t.newQr}
                </button>
              )}

              <button
                onClick={() => { clearInterval(poll.current); clearInterval(tick.current); setStep('choose'); setPay(null); }}
                style={ghostBtn}
              >
                {t.cancel}
              </button>
            </div>
          </>
        )}

        {/* ── 3+4) ใบเสร็จ: จ่ายสำเร็จ → กำลังเตรียมไฟล์ / พร้อมดาวน์โหลด ── */}
        {!err && paid && (
          <>
            <div style={{ height: '6px', background: b.color }} />
            <div style={{ padding: '26px 28px 24px' }}>
              <div style={{
                width: '58px', height: '58px', margin: '0 auto 14px', borderRadius: '50%',
                background: 'var(--okbg)', color: 'var(--ok)', display: 'flex',
                alignItems: 'center', justifyContent: 'center', fontSize: '28px', fontWeight: 800
              }}>✓</div>
              <h2 style={{ margin: '0 0 2px', fontSize: '21px', fontWeight: 800 }}>{t.paySuccess}</h2>
              <div style={{ fontSize: '30px', fontWeight: 800, letterSpacing: '-.5px', margin: '6px 0 18px' }}>
                ฿{amount}
              </div>

              {/* ใบเสร็จ */}
              <div style={{ border: '1px dashed var(--border)', borderRadius: '16px', padding: '6px 18px 12px', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', padding: '9px 0', fontSize: '14px' }}>
                  <span style={{ color: 'var(--muted)' }}>{t.payMethod}</span>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '7px', fontWeight: 600 }}>
                    <PayMark channel={channel} size={18} /> {b.name}
                  </span>
                </div>
                <div style={{ borderTop: '1px solid var(--border)' }} />
                {row(t.merchant, MERCHANT)}
                <div style={{ borderTop: '1px solid var(--border)' }} />
                {row(t.paidAt, fmtDateTime(paidAt))}
                <div style={{ borderTop: '1px solid var(--border)' }} />
                {row(t.clip, `${label} · ${filter} · ${speed}x`)}
                {refNo && (
                  <>
                    <div style={{ borderTop: '1px solid var(--border)' }} />
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '14px', padding: '9px 0', fontSize: '13px' }}>
                      <span style={{ color: 'var(--muted)' }}>{t.refNo}</span>
                      <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12px', wordBreak: 'break-all', textAlign: 'right' }}>{refNo}</span>
                    </div>
                  </>
                )}
              </div>

              {/* ล่างใบเสร็จ: กำลังเตรียม / ปุ่มดาวน์โหลด */}
              {step === 'verify' ? (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', marginTop: '18px', fontSize: '14.5px', color: 'var(--muted)' }}>
                  <span style={{ width: '18px', height: '18px', border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin .9s linear infinite' }} />
                  {t.rendering}
                </div>
              ) : (
                <>
                  <div style={{ marginTop: '18px' }}>
                    <SaveVideo url={dl} filename={`${label}_${filter}_${speed}x.mp4`} />
                  </div>
                  <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginTop: '10px', lineHeight: 1.55 }}>
                    {t.reDownloadHint}
                  </div>
                </>
              )}

              <button onClick={onClose} style={ghostBtn}>{t.close}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
