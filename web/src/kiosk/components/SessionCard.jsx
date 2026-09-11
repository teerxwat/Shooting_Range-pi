import { useApp } from '@/shared/AppContext';
import { qrUrl } from '@/kiosk/api';

/*
 * การ์ดบอกลูกค้าว่าไปโหลดคลิปที่ไหน — แสดงในหน้ารายการคลิป
 * ลูกค้าถ่ายรูปการ์ดนี้ไว้ แล้วเดินออกจากสนามได้เลย ไม่ต้องยืนรอ
 */
export default function SessionCard({ code, pin, site, pending = 0 }) {
  const { t } = useApp();
  if (!code) return null;

  const url = site ? `${site}/?s=${encodeURIComponent(code)}` : '';

  const big = {
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '30px',
    fontWeight: 800,
    letterSpacing: '2px',
  };

  return (
    <div
      style={{
        display: 'flex', gap: '24px', alignItems: 'center', flexWrap: 'wrap',
        background: 'var(--surface)', border: '1px solid var(--border)',
        borderRadius: '16px', padding: '20px 24px', marginBottom: '20px',
      }}
    >
      {url && (
        <div style={{ background: '#fff', padding: '10px', borderRadius: '10px', lineHeight: 0 }}>
          {/* QR จริง สร้างจาก backend (qrcode ของ Python) */}
          <img src={qrUrl(url)} alt="QR" width="132" height="132" />
        </div>
      )}

      <div style={{ flex: 1, minWidth: '230px' }}>
        <div style={{ fontSize: '17px', fontWeight: 700, marginBottom: '4px' }}>
          {t.takePhotoTitle}
        </div>
        <div style={{ fontSize: '14.5px', color: 'var(--muted)', marginBottom: '14px', lineHeight: 1.5 }}>
          {t.takePhotoHelp}
        </div>

        <div style={{ display: 'flex', gap: '34px', flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>{t.sessionCode}</div>
            <div style={big}>{code}</div>
          </div>
          <div>
            <div style={{ fontSize: '13px', color: 'var(--muted)' }}>PIN</div>
            <div style={big}>{pin || '— — — —'}</div>
          </div>
        </div>

        {site && (
          <div style={{ fontSize: '13.5px', color: 'var(--muted)', marginTop: '12px' }}>
            {site.replace(/^https?:\/\//, '')}
          </div>
        )}

        {pending > 0 && (
          <div style={{ fontSize: '13.5px', color: 'var(--accent)', marginTop: '8px' }}>
            ⏳ {t.uploading} ({pending})
          </div>
        )}
      </div>
    </div>
  );
}
