import { useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '@/shared/AppContext';
import { getClips, videoUrl } from '@/kiosk/api';
import { usePoll } from '@/shared/hooks/usePoll';
import { useOccupy } from '@/kiosk/useOccupy';
import Main from '@/shared/components/Main';
import SessionChip from '@/shared/components/SessionChip';
import PlayerControls from '@/shared/components/PlayerControls';
import { BackButton } from '@/shared/components/buttons';

/*
 * หน้านี้ดูรีเพลย์อย่างเดียว — ไม่มีการซื้อ/ดาวน์โหลดที่เลนแล้ว
 * ลูกค้าเอาเลขเซสชัน + PIN ไปโหลดเองทีหลังที่เว็บดาวน์โหลด (ดูการ์ดในหน้ารายการคลิป)
 * ความเร็ว/ฟิลเตอร์ตรงนี้เป็นแค่พรีวิวให้ดูสนุก ของจริงเลือกอีกทีตอนซื้อ
 */

// พรีวิวฟิลเตอร์บนเว็บ (CSS) — ให้ใกล้เคียงผลจริงจาก ffmpeg ฝั่ง server
const FILTER_CSS = {
  original: 'none',
  cinema: 'contrast(1.18) saturate(1.18) brightness(0.97)',
  mono: 'grayscale(1) contrast(1.28) brightness(0.97)'
};

export default function Playback() {
  const { id, clipId } = useParams();
  const laneId = Number(id);
  const clipIdx = Number(clipId);
  const navigate = useNavigate();
  const { t } = useApp();

  const videoRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [tpos, setTpos] = useState(0);
  const [dur, setDur] = useState(0);
  const [rate, setRate] = useState(0.25);          // คลิป ~200fps → เริ่มที่ slow-mo 0.25x
  const [filter, setFilter] = useState('original'); // original | cinema | mono

  const { data: clips } = usePoll(() => getClips(laneId), 5000, [laneId]);
  useOccupy(laneId);
  const clip = clips ? clips[clipIdx] : null;

  if (!clip) {
    return (
      <Main>
        <BackButton onClick={() => navigate(`/lane/${laneId}/clips`)}>{t.back}</BackButton>
        <div style={{ marginTop: '20px', color: 'var(--muted)' }}>{t.noClips}</div>
      </Main>
    );
  }

  const src = videoUrl(clip.url);
  const showFx = filter !== 'original';

  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  };

  const seek = (val) => {
    const v = videoRef.current;
    if (v) v.currentTime = val;
    setTpos(val);
  };

  const setSpeed = (r) => {
    setRate(r);
    if (videoRef.current) videoRef.current.playbackRate = r;
  };

  const segBtn = (on) => ({
    minHeight: '40px',
    padding: '0 16px',
    borderRadius: '7px',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '15px',
    fontWeight: 600,
    background: on ? 'var(--accent)' : 'transparent',
    color: on ? '#fff' : 'var(--muted)'
  });

  const segWrap = {
    display: 'flex',
    gap: '6px',
    background: 'var(--surface2)',
    border: '1px solid var(--border)',
    borderRadius: '10px',
    padding: '4px'
  };

  return (
    <Main>
      <section>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '18px' }}>
          <BackButton onClick={() => navigate(`/lane/${laneId}/clips`)}>{t.back}</BackButton>
          <h1 style={{ margin: 0, fontSize: 'clamp(22px, 2.6vw, 28px)', fontWeight: 700 }}>
            {t.clip} {clipIdx + 1} · {t.lane} {laneId}
          </h1>
          <SessionChip code={clip.session} />
        </div>

        {/* วิดีโอ + พรีวิวฟิลเตอร์ (CSS) */}
        <div
          onClick={togglePlay}
          style={{
            position: 'relative',
            width: '100%',
            aspectRatio: '16/9',
            maxHeight: '66vh',
            borderRadius: '16px',
            overflow: 'hidden',
            border: '1px solid var(--border)',
            background: '#111',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            cursor: 'pointer'
          }}
        >
          <video
            ref={videoRef}
            src={src}
            playsInline
            preload="metadata"
            style={{ width: '100%', height: '100%', objectFit: 'contain', filter: FILTER_CSS[filter] }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(e) => setTpos(e.target.currentTime)}
            onLoadedMetadata={(e) => {
              setDur(e.target.duration || 0);
              e.target.playbackRate = rate;
            }}
            onEnded={() => setPlaying(false)}
          />

          {/* letterbox + vignette ของฟิลเตอร์โทนหนัง/ขาวดำ */}
          {showFx && (
            <>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '12%', background: '#000', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '12%', background: '#000', pointerEvents: 'none' }} />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.45) 100%)'
                }}
              />
            </>
          )}

          {!playing && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(24,24,26,.28)'
              }}
            >
              <div
                style={{
                  width: '88px',
                  height: '88px',
                  borderRadius: '50%',
                  background: 'rgba(20,20,20,.78)',
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontSize: '32px',
                  paddingLeft: '6px',
                  boxSizing: 'border-box'
                }}
              >
                ▶
              </div>
            </div>
          )}
        </div>

        <PlayerControls playing={playing} tpos={tpos} dur={dur} onTogglePlay={togglePlay} onSeek={seek} />

        {/* ความเร็ว + ฟิลเตอร์ */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '22px', marginTop: '14px', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '15px', color: 'var(--muted)', fontWeight: 600 }}>🐢 {t.speed}</span>
            <div style={segWrap}>
              {[0.1, 0.25, 0.5, 1].map((r) => (
                <button key={r} onClick={() => setSpeed(r)} style={segBtn(rate === r)}>
                  {r}x
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '15px', color: 'var(--muted)', fontWeight: 600 }}>🎨 {t.filterLabel}</span>
            <div style={segWrap}>
              {[
                ['original', t.fOriginal],
                ['cinema', t.fCinema],
                ['mono', t.fMono]
              ].map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)} style={segBtn(filter === key)}>
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '14px', marginTop: '20px' }}>
          <div style={{ fontSize: '15px', color: 'var(--muted)' }}>
            📱 {t.buyOnPhone}
          </div>
          <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color: 'var(--muted)' }}>
            {clip.name}
          </div>
        </div>
      </section>
    </Main>
  );
}
