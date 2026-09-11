import { useState } from 'react';
import { useApp } from '@/shared/AppContext';
import { setLanePin } from '@/kiosk/api';

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
    height: '78px',
    fontSize: '30px',
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
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}
    >
      <div
        style={{
          background: 'var(--bg)', color: 'var(--text)',
          borderRadius: '20px', padding: '32px 34px',
          width: 'min(420px, 92vw)', textAlign: 'center',
          border: '1px solid var(--border)',
        }}
      >
        <div style={{ fontSize: '25px', fontWeight: 800 }}>{t.pinTitle}</div>
        <div style={{ fontSize: '15.5px', color: 'var(--muted)', marginTop: '8px', lineHeight: 1.55 }}>
          {t.pinHelp}
        </div>

        {/* ช่องแสดง 4 หลัก */}
        <div style={{ display: 'flex', justifyContent: 'center', gap: '14px', margin: '26px 0 18px' }}>
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                width: '54px', height: '66px', borderRadius: '12px',
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '12px', marginTop: '10px' }}>
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
