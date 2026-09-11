import { useApp } from '@/shared/AppContext';
import { qrUrl } from '@/kiosk/api';

// Modal แสดง QR ดาวน์โหลดวิดีโอ (ข้ามขั้นตอนจ่ายเงินไปก่อน — เสียบ PaymentModal กลับมาทีหลังได้)
export default function DownloadModal({ open, videoUrl, fileName, onClose }) {
  const { t } = useApp();

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(18,18,20,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        zIndex: 50
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--surface)',
          color: 'var(--text)',
          borderRadius: '20px',
          padding: '34px 34px 28px',
          width: 'min(440px, 100%)',
          textAlign: 'center',
          boxShadow: '0 24px 60px rgba(0,0,0,.3)'
        }}
      >
        <div
          style={{
            width: '58px',
            height: '58px',
            margin: '6px auto 14px',
            borderRadius: '50%',
            background: 'var(--okbg)',
            color: 'var(--ok)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '26px',
            fontWeight: 700
          }}
        >
          ✓
        </div>
        <h2 style={{ margin: '0 0 4px', fontSize: '21px', fontWeight: 700 }}>{t.download}</h2>
        <div style={{ fontSize: '15px', color: 'var(--muted)', marginBottom: '18px' }}>{t.scanDownload}</div>

        <div
          style={{
            display: 'inline-block',
            background: '#fff',
            border: '1px solid var(--border)',
            borderRadius: '14px',
            padding: '14px'
          }}
        >
          <img src={qrUrl(videoUrl)} alt="download qr" width="220" height="220" style={{ display: 'block' }} />
        </div>

        <div
          style={{
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '12.5px',
            color: 'var(--muted)',
            marginTop: '10px',
            wordBreak: 'break-all'
          }}
        >
          {fileName}
        </div>

        <a
          href={videoUrl}
          download
          style={{
            display: 'block',
            marginTop: '18px',
            width: '100%',
            minHeight: '54px',
            lineHeight: '54px',
            borderRadius: '12px',
            border: 'none',
            background: 'var(--accent)',
            color: '#fff',
            fontFamily: 'inherit',
            fontSize: '16px',
            fontWeight: 600,
            cursor: 'pointer',
            textDecoration: 'none',
            boxSizing: 'border-box'
          }}
        >
          ⬇ {t.download}
        </a>
        <button
          onClick={onClose}
          style={{
            marginTop: '10px',
            width: '100%',
            minHeight: '46px',
            borderRadius: '12px',
            border: '1px solid var(--border)',
            background: 'transparent',
            color: 'var(--muted)',
            fontFamily: 'inherit',
            fontSize: '15px',
            cursor: 'pointer'
          }}
        >
          {t.close}
        </button>
      </div>
    </div>
  );
}
