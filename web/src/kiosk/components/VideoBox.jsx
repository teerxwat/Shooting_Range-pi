import { useApp } from '@/shared/AppContext';
import { streamUrl } from '@/kiosk/api';
import aimSilhouette from '@/shared/assets/aim-silhouette.png';

const mono = { fontFamily: "'IBM Plex Mono', monospace" };

function Overlay({ children, bg = 'rgba(24,24,26,.62)' }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        background: bg,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '20px',
        color: '#fff',
        textAlign: 'center',
        padding: '24px'
      }}
    >
      {children}
    </div>
  );
}

function BigSpinner() {
  return (
    <div
      style={{
        width: '72px',
        height: '72px',
        border: '5px solid rgba(255,255,255,.25)',
        borderTopColor: '#fff',
        borderRadius: '50%',
        animation: 'spin .9s linear infinite'
      }}
    />
  );
}

// รูปคนยืนเล็งปืน (silhouette ขาว พื้นโปร่งใส) ประกอบ popup "เตรียมท่ายิง"
function AimFigure() {
  return (
    <img
      src={aimSilhouette}
      alt=""
      style={{
        height: 'clamp(100px, 14vw, 170px)',
        width: 'auto',
        display: 'block',
        filter: 'drop-shadow(0 2px 8px rgba(0,0,0,.35))'
      }}
    />
  );
}

// ตัวหนังสือสถานะ — ใหญ่พิเศษ อ่านได้จากระยะไกล (kiosk)
const bigTitle = { fontSize: 'clamp(32px, 5vw, 60px)', fontWeight: 700, lineHeight: 1.15 };
const bigNumber = { ...mono, fontSize: 'clamp(110px, 18vw, 220px)', fontWeight: 700, lineHeight: 1 };
const subText = { fontSize: 'clamp(18px, 2.4vw, 28px)', color: 'rgba(255,255,255,.88)' };

// กล่องวิดีโอ Live View
// fill = โหมดเต็มจอ (camera app): วิดีโอเป็น background layer, object-fit cover
// state: IDLE (+preview สด) | PREPARING | DETECTING | COUNTDOWN | RECORDING | DOWNLOADING | DONE | ERROR
export default function VideoBox({ laneId, state, session, preview = false, fill = false }) {
  const { t } = useApp();
  const idleish = ['IDLE', 'DONE', 'ERROR'].includes(state);
  const showStream = state === 'DETECTING' || (preview && idleish);

  const outerStyle = fill
    ? {
        position: 'absolute',
        inset: 0,
        background: 'repeating-linear-gradient(45deg, #1c1e22 0 18px, #16181b 18px 36px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      }
    : {
        position: 'relative',
        flex: 1,
        minHeight: 0,
        width: '100%',
        borderRadius: '16px',
        overflow: 'hidden',
        border: '1px solid var(--border)',
        background: 'repeating-linear-gradient(45deg, var(--stripe1) 0 16px, var(--stripe2) 16px 32px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center'
      };

  return (
    <div style={outerStyle}>
      {/* MJPEG stream จาก server.py */}
      {showStream ? (
        <img
          src={streamUrl(laneId)}
          alt="live"
          style={{
            position: 'absolute',
            inset: 0,
            width: '100%',
            height: '100%',
            objectFit: fill ? 'cover' : 'contain',
            background: '#111'
          }}
        />
      ) : (
        <div
          style={{
            ...mono,
            fontSize: '15px',
            color: fill ? 'rgba(255,255,255,.45)' : 'var(--muted)',
            textAlign: 'center',
            padding: '20px'
          }}
        >
          {t.camHint}
        </div>
      )}

      {/* popup ใหญ่ "เตรียมท่ายิง!" ระหว่าง detect — อ่านได้จากระยะไกล */}
      {state === 'DETECTING' && (
        <div
          style={{
            position: 'absolute',
            top: fill ? '13%' : '7%',
            left: '50%',
            transform: 'translateX(-50%)',
            background: 'rgba(20,20,20,.8)',
            borderRadius: '26px',
            padding: 'clamp(16px, 2.5vw, 30px) clamp(24px, 4vw, 48px)',
            display: 'flex',
            alignItems: 'center',
            gap: 'clamp(16px, 2.5vw, 30px)',
            color: '#fff',
            maxWidth: '94%',
            boxShadow: '0 12px 40px rgba(0,0,0,.4)'
          }}
        >
          <AimFigure />
          <div style={{ textAlign: 'left' }}>
            <div style={bigTitle}>{t.getReady}</div>
            <div style={subText}>{t.detectHint}</div>
          </div>
        </div>
      )}

      {state === 'PREPARING' && (
        <Overlay>
          <BigSpinner />
          <div style={bigTitle}>{t.preparing}</div>
        </Overlay>
      )}

      {state === 'COUNTDOWN' && (
        <Overlay bg="rgba(24,24,26,.7)">
          <div style={bigTitle}>{t.countdownMsg}</div>
          <div style={bigNumber}>{session?.countdown ?? ''}</div>
        </Overlay>
      )}

      {state === 'RECORDING' && (
        <Overlay bg="rgba(24,24,26,.55)">
          <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
            <span
              style={{
                width: 'clamp(18px, 2vw, 26px)',
                height: 'clamp(18px, 2vw, 26px)',
                borderRadius: '50%',
                background: '#e0524a',
                display: 'inline-block',
                animation: 'pulse 1.4s infinite'
              }}
            />
            <span style={bigTitle}>REC · {t.recording}</span>
          </div>
          <div style={bigNumber}>{session?.recordRemaining ?? ''}</div>
        </Overlay>
      )}

      {state === 'DOWNLOADING' && (
        <Overlay>
          <BigSpinner />
          <div style={bigTitle}>{t.downloading}</div>
        </Overlay>
      )}

      {state === 'DONE' && (
        <Overlay bg="rgba(24,24,26,.55)">
          <div style={bigTitle}>✓ {t.doneMsg}</div>
        </Overlay>
      )}

      {state === 'ERROR' && (
        <Overlay bg="rgba(60,20,20,.72)">
          <div style={{ ...bigTitle, fontSize: 'clamp(24px, 3.5vw, 44px)' }}>⚠ {session?.error || 'Error'}</div>
        </Overlay>
      )}
    </div>
  );
}
