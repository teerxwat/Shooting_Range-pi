import { useState } from 'react';
import { useApp } from '@/shared/AppContext';
import { setLanePin } from '@/kiosk/api';
import { useMedia } from '@/shared/hooks/useMedia';

/*
 * แป้นกด PIN 4 หลัก — ลูกค้าตั้งเองก่อนเริ่มใช้เลน
 * PIN นี้คู่กับเลขเซสชัน ใช้เปิดดู/ซื้อคลิปที่เว็บดาวน์โหลดทีหลัง
 * ปุ่มใหญ่พิเศษ เพราะกดบนแท็บเล็ตด้วยมือที่อาจใส่ถุงมือยิงปืน
 */
export default function PinPad({ lane, open, onDone }) {
  const { t } = useApp();
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // จอเตี้ย (มือถือ/แท็บเล็ตแนวนอน): หัวข้อ + ช่อง PIN ซ้าย, แป้นตัวเลขขวา
  const short = useMedia('(max-height: 560px) and (min-width: 560px)');
  // จอเล็ก/เตี้ย: ปุ่มเตี้ยลงให้กล่องพอดีจอ
  const small = useMedia('(max-width: 400px), (max-height: 700px)');

  if (!open) return null;

  const push = (d) => {
    setErr('');
    if (pin.length < 4) setPin(pin + d);
  };

  const submit = async (value) => {
    setBusy(true);
    setErr('');
    try {
      await setLanePin(lane, value);
      onDone(value);
    } catch (e) {
      setErr(e.message || 'ตั้ง PIN ไม่สำเร็จ');
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const keyBtn = {
    height: short ? 'clamp(44px, 14vh, 64px)' : small ? '62px' : '78px',
    fontSize: small || short ? '26px' : '30px',
    fontWeight: 700,
    fontFamily: 'inherit',
    borderRadius: '14px',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)',
    cursor: 'pointer',
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 60,
        background: 'rgba(0,0,0,.72)',
        display: 'flex', alignItems: 'safe center', justifyContent: 'center',
        // จอเตี้ยกว่ากล่อง → เลื่อนดูได้ (เดิมหัวข้อ/ปุ่มล่างถูกตัด)
        overflowY: 'auto',
        padding: 'max(10px, env(safe-area-inset-top)) max(10px, env(safe-area-inset-right)) max(10px, env(safe-area-inset-bottom)) max(10px, env(safe-area-inset-left))',
      }}
    >
      <div
        style={{
          background: 'var(--bg)', color: 'var(--text)',
          borderRadius: '20px',
          padding: short ? '18px 22px' : small ? '22px 18px' : '32px 34px',
          width: short ? 'min(760px, 100%)' : 'min(420px, 100%)', textAlign: 'center',
          border: '1px solid var(--border)',
          margin: 'auto 0',
          display: short ? 'grid' : 'block',
          gridTemplateColumns: short ? '1fr 1.1fr' : undefined,
          gap: short ? '22px' : undefined,
          alignItems: 'center',
        }}
      >
        <div>
        <div style={{ fontSize: small || short ? '21px' : '25px', fontWeight: 800 }}>{t.pinTitle}</div>
        <div style={{ fontSize: small || short ? '14px' : '15.5px', color: 'var(--muted)', marginTop: '8px', lineHeight: 1.5 }}>
          {t.pinHelp}
        </div>

        {/* ช่องแสดง 4 หลัก */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: small ? '10px' : '14px', margin: short ? '16px 0 8px' : small ? '18px 0 12px' : '26px 0 18px' }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                width: small || short ? '48px' : '54px', height: small || short ? '56px' : '66px', borderRadius: '12px',
                border: `2px solid ${i === pin.length ? 'var(--accent)' : 'var(--border)'}`,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '32px', fontWeight: 800,
              }}
            >
              {pin[i] ? '●' : ''}
            </div>
          ))}
        </div>

        <div style={{ minHeight: '22px', color: '#ef4444', fontSize: '14.5px' }}>{err}</div>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: small || short ? '8px' : '12px', marginTop: short ? 0 : '10px' }}>
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
            <button key={d} style={keyBtn} disabled={busy} onClick={() => push(String(d))}>
              {d}
            </button>
          ))}
          <button style={{ ...keyBtn, fontSize: '19px' }} disabled={busy} onClick={() => setPin('')}>
            {t.clear}
          </button>
          <button style={keyBtn} disabled={busy} onClick={() => push('0')}>0</button>
          <button
            style={{
              ...keyBtn,
              background: pin.length === 4 ? 'var(--accent)' : 'var(--surface)',
              color: pin.length === 4 ? '#fff' : 'var(--muted)',
              fontSize: '19px',
            }}
            disabled={busy || pin.length !== 4}
            onClick={() => submit(pin)}
          >
            {busy ? '...' : t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
