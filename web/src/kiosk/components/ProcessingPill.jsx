import { useApp } from '@/shared/AppContext';

const mono = { fontFamily: "'IBM Plex Mono', monospace" };

/*
 * แถบโหลดเล็กๆ แทนหน้าจอโหลดเต็มจอ
 * saving     = กำลังดาวน์โหลดจากกล้อง (ไม่รู้ % → แถบวิ่ง)
 * processing = { count, progress } จาก status — คลิปของเซสชันนี้ที่กำลังแปลงไฟล์เบื้องหลัง
 */
export default function ProcessingPill({ saving = false, processing, style }) {
  const { t } = useApp();
  const count = processing?.count || 0;
  if (!saving && count === 0) return null;

  const pct = saving ? null : processing?.progress ?? null;

  return (
    <div
      role="status"
      style={{
        background: 'rgba(20,20,22,.55)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        border: '1px solid rgba(255,255,255,.28)',
        borderRadius: '14px',
        color: '#fff',
        padding: '10px 14px',
        boxSizing: 'border-box',
        pointerEvents: 'none',
        ...style
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', fontWeight: 600 }}>
        <span
          style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            background: '#fff',
            flexShrink: 0,
            animation: 'pulse 1.4s infinite'
          }}
        />
        <span style={{ flex: 1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {saving ? t.savingVideo : t.preparingVideo}
          {!saving && count > 1 ? ` (${count})` : ''}
        </span>
        {pct !== null && <span style={mono}>{pct}%</span>}
      </div>

      <div
        style={{
          marginTop: '8px',
          height: '4px',
          borderRadius: '99px',
          background: 'rgba(255,255,255,.22)',
          overflow: 'hidden'
        }}
      >
        <div
          style={
            pct !== null
              ? { width: `${Math.max(3, pct)}%`, height: '100%', background: '#fff', transition: 'width .8s ease' }
              : { width: '35%', height: '100%', background: '#fff', animation: 'indeterminate 1.3s ease-in-out infinite' }
          }
        />
      </div>
    </div>
  );
}
