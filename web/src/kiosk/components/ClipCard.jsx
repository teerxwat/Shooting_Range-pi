import { useApp } from '@/shared/AppContext';
import { videoUrl } from '@/kiosk/api';

// clip จาก backend: { name, path, url, session, time }
export default function ClipCard({ clip, n, onOpen }) {
  const { t } = useApp();

  return (
    <div
      className="clip-card"
      onClick={onOpen}
      style={{
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '14px',
        overflow: 'hidden',
        cursor: 'pointer'
      }}
    >
      <div
        style={{
          position: 'relative',
          aspectRatio: '16/9',
          background: '#111',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {/* thumbnail = เฟรมจริงจากวิดีโอ (#t=0.5 ดึงภาพที่วินาที 0.5) */}
        <video
          src={videoUrl(clip.url) + '#t=0.5'}
          preload="metadata"
          muted
          playsInline
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
        />
        <div
          style={{
            position: 'relative',
            width: '52px',
            height: '52px',
            borderRadius: '50%',
            background: 'rgba(20,20,20,.72)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: '19px'
          }}
        >
          ▶
        </div>
        <div
          style={{
            position: 'absolute',
            bottom: '8px',
            right: '8px',
            fontFamily: "'IBM Plex Mono', monospace",
            fontSize: '12px',
            background: 'rgba(20,20,20,.72)',
            color: '#fff',
            borderRadius: '6px',
            padding: '3px 8px'
          }}
        >
          {clip.name}
        </div>
      </div>
      <div
        style={{
          padding: '12px 14px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: '8px'
        }}
      >
        <div style={{ fontWeight: 600, fontSize: '16px' }}>
          {t.clip} {n}
        </div>
        <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color: 'var(--muted)' }}>
          {clip.time}
        </div>
      </div>
    </div>
  );
}
