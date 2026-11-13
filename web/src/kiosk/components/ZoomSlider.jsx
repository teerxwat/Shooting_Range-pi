import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/shared/AppContext';
import { getZoom, setZoom } from '@/kiosk/api';

const mono = { fontFamily: "'IBM Plex Mono', 'IBM Plex Sans Thai', monospace" };

const frost = {
  background: 'rgba(20,20,22,.55)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,.28)',
  color: '#fff'
};

const stepBtn = {
  ...frost,
  width: '48px',
  height: '48px',
  borderRadius: '50%',
  fontSize: '26px',
  lineHeight: 1,
  fontFamily: 'inherit',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 0
};

const SEND_EVERY_MS = 200;   // ระหว่างลาก ส่งค่าให้กล้องไม่ถี่กว่านี้ (ค่าสุดท้ายส่งเสมอ)
const STEP = 10;             // ปุ่ม + / −

// slider ซูมแนวตั้ง ชิดขวาของหน้า Live View — ปรับ digital zoom ของ GoPro (0-100%)
// compact = จอเล็ก/เตี้ย: ซ่อนปุ่ม + / − และย่อ slider ให้ไม่ชนแถบบน/ปุ่มล่าง
export default function ZoomSlider({ laneId, disabled = false, compact = false, style }) {
  const { t } = useApp();
  const [value, setValue] = useState(0);
  const touched = useRef(false);
  const lastSent = useRef(0);
  const trailing = useRef(null);
  const pending = useRef(null);

  // ค่าเริ่มต้น = ค่าซูมที่กล้องใช้อยู่จริง
  useEffect(() => {
    touched.current = false;
    getZoom(laneId)
      .then((r) => {
        if (!touched.current && typeof r?.zoom === 'number') setValue(r.zoom);
      })
      .catch(() => {});
    return () => clearTimeout(trailing.current);
  }, [laneId]);

  const flush = () => {
    clearTimeout(trailing.current);
    trailing.current = null;
    if (pending.current === null) return;
    const v = pending.current;
    pending.current = null;
    lastSent.current = Date.now();
    setZoom(laneId, v).catch(() => {});
  };

  // throttle: ส่งทันทีถ้าห่างจากครั้งก่อนพอ ไม่งั้นตั้งเวลาส่งค่าล่าสุดตามหลัง
  const change = (v) => {
    const n = Math.max(0, Math.min(100, Math.round(v)));
    touched.current = true;
    setValue(n);
    pending.current = n;
    const wait = SEND_EVERY_MS - (Date.now() - lastSent.current);
    if (wait <= 0) flush();
    else if (!trailing.current) trailing.current = setTimeout(flush, wait);
  };

  const off = disabled;

  return (
    <div
      style={{
        ...frost,
        borderRadius: '30px',
        padding: compact ? '10px 6px' : '12px 8px',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '10px',
        opacity: off ? 0.45 : 1,
        transition: 'opacity .2s',
        ...style
      }}
    >
      <div style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '.5px', color: 'rgba(255,255,255,.8)' }}>
        {t.zoom}
      </div>

      {!compact && (
        <button style={stepBtn} disabled={off} onClick={() => change(value + STEP)} aria-label="zoom in">
          +
        </button>
      )}

      {/* writing-mode แนวตั้ง + direction rtl → ค่ามากอยู่บน */}
      <input
        type="range"
        min={0}
        max={100}
        step={1}
        value={value}
        disabled={off}
        onChange={(e) => change(Number(e.target.value))}
        onPointerUp={flush}
        onKeyUp={flush}
        aria-label={t.zoom}
        style={{
          writingMode: 'vertical-lr',
          direction: 'rtl',
          width: '40px',
          height: compact ? 'clamp(110px, 30dvh, 220px)' : 'clamp(160px, 34vh, 300px)',
          margin: 0,
          accentColor: '#e0524a',
          cursor: off ? 'default' : 'pointer',
          touchAction: 'none'
        }}
      />

      {!compact && (
        <button style={stepBtn} disabled={off} onClick={() => change(value - STEP)} aria-label="zoom out">
          −
        </button>
      )}

      <button
        onClick={() => change(0)}
        disabled={off || value === 0}
        title={t.zoomReset}
        style={{
          ...mono,
          background: 'transparent',
          border: 'none',
          color: '#fff',
          fontSize: '14px',
          fontWeight: 600,
          padding: '4px 2px',
          cursor: off || value === 0 ? 'default' : 'pointer'
        }}
      >
        {value}%
      </button>
    </div>
  );
}
