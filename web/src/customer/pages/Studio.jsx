import { useEffect, useRef, useState, useCallback } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useApp } from '@/shared/AppContext';
import Main from '@/shared/components/Main';
import { CheckIcon, DownloadIcon } from '@/shared/components/icons';
import { BackButton } from '@/shared/components/buttons';
import { fmt } from '@/shared/utils/format';
import CheckoutModal from '../components/CheckoutModal';
import SaveVideo from '../components/SaveVideo';
import { getCode, getConfig, getPurchases, getVideos, getPendingOrder, previewUrl } from '../api';

const FALLBACK_PRICE = Number(import.meta.env.VITE_PRICE || 100);

// พรีวิวฟิลเตอร์บนเว็บ (CSS) — ให้ใกล้เคียงผลจริงจาก ffmpeg ฝั่ง server
const FILTER_CSS = {
  original: 'none',
  cinema: 'contrast(1.18) saturate(1.18) brightness(0.97)',
  mono: 'grayscale(1) contrast(1.28) brightness(0.97)'
};

const SPEEDS = [0.1, 0.25, 0.5, 1];
const FILTERS = ['original', 'cinema', 'mono'];

/** ดู preview (มีลายน้ำ) + เลือกฟิลเตอร์/ความช้า แล้วซื้อเพื่อดาวน์โหลดไฟล์จริง */
export default function Studio() {
  const { videoId } = useParams();
  const vid = Number(videoId);
  const navigate = useNavigate();
  const { t } = useApp();

  const videoRef = useRef(null);
  const frameRef = useRef(null);
  const hideTimer = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [tpos, setTpos] = useState(0);
  const [dur, setDur] = useState(0);
  const [muted, setMuted] = useState(true);        // ต้อง muted ตอนแรกเพื่อให้เล่นเองได้
  const [showBar, setShowBar] = useState(true);    // แถบคอนโทรลแบบ YouTube (ลอยในเฟรม)
  const [rate, setRate] = useState(0.25);           // คลิป ~200fps → เริ่มที่ slow-mo
  const [filter, setFilter] = useState('original');
  const [checkout, setCheckout] = useState(false);
  const [resume, setResume] = useState(false);       // เปิดต่อจากออเดอร์ที่ค้างจ่าย
  const [owned, setOwned] = useState([]);
  const [price, setPrice] = useState(FALLBACK_PRICE);   // ราคาจริงมาจากเซิร์ฟเวอร์

  const cached = getVideos() || {};
  const meta = (cached.videos || []).find((v) => v.id === vid);
  const label = meta?.label || `${getCode()}-?`;
  const showFx = filter !== 'original';

  // ชุดที่จ่ายไปแล้วของคลิปนี้ — โหลดซ้ำได้ฟรี ไม่ต้องซื้อใหม่
  const loadOwned = () =>
    getPurchases()
      .then((r) => setOwned((r.items || []).filter((o) => o.video_id === vid)))
      .catch(() => {});

  useEffect(() => { loadOwned(); }, [vid]);

  /*
   * กลับมาจากแอปธนาคารแล้วหน้าโหลดใหม่ — เปิดหน้าจ่ายเงินต่อให้อัตโนมัติ
   * ถ้าไม่ทำ ลูกค้าจะเห็นแค่หน้าเลือกฟิลเตอร์ ไม่รู้ว่าเงินที่จ่ายไปอยู่ไหน
   */
  useEffect(() => {
    const p = getPendingOrder();
    if (p && p.video_id === vid) {
      if (p.filter) setFilter(p.filter);
      if (p.speed) setRate(p.speed);
      setResume(true);
      setCheckout(true);
    }
  }, [vid]);
  useEffect(() => { getConfig().then((c) => c?.price && setPrice(c.price)).catch(() => {}); }, []);

  // ── ครอบครองแล้วหรือยัง ──────────────────────────────
  const ready = owned.filter((o) => o.status === 'ready');
  const current = ready.find(
    (o) => o.filter === filter && Math.abs(o.speed - rate) < 0.001
  );
  const speedOwned = (r) => ready.some((o) => Math.abs(o.speed - r) < 0.001);
  const filterOwned = (key) => ready.some((o) => o.filter === key && Math.abs(o.speed - rate) < 0.001);

  // ── คอนโทรลวิดีโอ ────────────────────────────────────
  const togglePlay = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play(); else v.pause();
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

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  };

  const toggleFull = () => {
    const el = frameRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  // แสดงแถบคอนโทรลเมื่อขยับเมาส์ แล้วซ่อนเองหลัง 2.2 วิ (เฉพาะตอนเล่นอยู่)
  const wakeBar = useCallback(() => {
    setShowBar(true);
    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => {
      if (videoRef.current && !videoRef.current.paused) setShowBar(false);
    }, 2200);
  }, []);
  useEffect(() => () => clearTimeout(hideTimer.current), []);

  const barVisible = showBar || !playing;

  // ── สไตล์ปุ่มเลือก (กระชับ) ──────────────────────────
  const segWrap = {
    display: 'flex', gap: '5px', flex: 1, minWidth: 0,
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: '10px', padding: '4px'
  };
  const segBtn = (on) => ({
    flex: 1, minHeight: '40px', padding: '0 6px', borderRadius: '7px',
    border: 'none', cursor: 'pointer', fontFamily: 'inherit',
    fontSize: '14px', fontWeight: 600, whiteSpace: 'nowrap',
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '5px',
    background: on ? 'var(--accent)' : 'transparent',
    color: on ? '#fff' : 'var(--muted)'
  });
  const ownDot = (on) => ({
    display: 'inline-flex', color: on ? '#fff' : 'var(--ok)'
  });

  const roundBtn = {
    width: '38px', height: '38px', flex: 'none', borderRadius: '50%',
    border: 'none', background: 'rgba(255,255,255,.16)', color: '#fff',
    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
    fontSize: '15px'
  };

  return (
    <Main>
      <section>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '12px', marginBottom: '14px' }}>
          <BackButton onClick={() => navigate('/videos')}>{t.back}</BackButton>
          <h1 style={{ margin: 0, fontSize: 'clamp(20px, 2.4vw, 26px)', fontWeight: 700 }}>
            {t.clip} {meta?.sub_no ?? ''}
          </h1>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px',
              background: 'var(--surface2)', border: '1px solid var(--border)',
              borderRadius: '8px', padding: '6px 11px', color: 'var(--muted)'
            }}
          >
            {label}
          </span>
        </div>

        {/* ── เฟรมวิดีโอ + คอนโทรลลอยในเฟรมแบบ YouTube ── */}
        <div
          ref={frameRef}
          onMouseMove={wakeBar}
          onMouseLeave={() => playing && setShowBar(false)}
          style={{
            position: 'relative', width: '100%', aspectRatio: '16/9',
            maxHeight: '68vh', borderRadius: '16px', overflow: 'hidden',
            border: '1px solid var(--border)', background: '#000',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
        >
          <video
            ref={videoRef}
            src={previewUrl(vid)}
            autoPlay
            muted
            loop
            playsInline
            preload="auto"
            onClick={togglePlay}
            style={{ width: '100%', height: '100%', objectFit: 'contain', filter: FILTER_CSS[filter], cursor: 'pointer' }}
            onPlay={() => { setPlaying(true); wakeBar(); }}
            onPause={() => { setPlaying(false); setShowBar(true); }}
            onVolumeChange={(e) => setMuted(e.target.muted)}
            onTimeUpdate={(e) => setTpos(e.target.currentTime)}
            onLoadedMetadata={(e) => { setDur(e.target.duration || 0); e.target.playbackRate = rate; }}
          />

          {/* letterbox + vignette สำหรับโทนหนัง */}
          {showFx && (
            <>
              <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: '11%', background: '#000', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', bottom: 0, left: 0, right: 0, height: '11%', background: '#000', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none', background: 'radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,.45) 100%)' }} />
            </>
          )}

          {/* ปุ่มเล่นใหญ่กลางจอ (ตอนหยุด) */}
          {!playing && (
            <button
              onClick={togglePlay}
              aria-label="play"
              style={{
                position: 'absolute', width: '84px', height: '84px', borderRadius: '50%',
                border: 'none', background: 'rgba(15,15,17,.62)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: '30px', paddingLeft: '6px', cursor: 'pointer'
              }}
            >▶</button>
          )}

          {/* แถบคอนโทรลลอยด้านล่างเฟรม */}
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              position: 'absolute', left: 0, right: 0, bottom: 0,
              padding: '26px 14px 12px',
              background: 'linear-gradient(to top, rgba(0,0,0,.72), rgba(0,0,0,0))',
              opacity: barVisible ? 1 : 0, transition: 'opacity .2s',
              pointerEvents: barVisible ? 'auto' : 'none'
            }}
          >
            <input
              type="range" min="0" max={dur || 0} step="0.05" value={tpos}
              onChange={(e) => seek(parseFloat(e.target.value))}
              aria-label="seek"
              style={{ width: '100%', height: '22px', cursor: 'pointer', accentColor: 'var(--accent)' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '2px' }}>
              <button onClick={togglePlay} style={roundBtn} aria-label="play/pause">
                {playing ? '❚❚' : '▶'}
              </button>
              <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '13px', color: '#fff' }}>
                {fmt(tpos)} / {fmt(dur)}
              </div>
              <div style={{ flex: 1 }} />
              <button onClick={toggleMute} style={roundBtn} aria-label="mute">
                {muted ? '🔇' : '🔊'}
              </button>
              <button onClick={toggleFull} style={roundBtn} aria-label="fullscreen">⛶</button>
            </div>
          </div>
        </div>

        <div style={{ fontSize: '12.5px', color: 'var(--muted)', marginTop: '8px', textAlign: 'center' }}>
          {t.watermarkNote}
        </div>

        {/* ── ความเร็ว + ฟิลเตอร์ (กระชับ · มี icon ดาวน์โหลดบนชุดที่เคยซื้อ) ── */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '14px', color: 'var(--muted)', fontWeight: 600, minWidth: '66px' }}>{t.speed}</span>
            <div style={segWrap}>
              {SPEEDS.map((r) => {
                const on = rate === r;
                return (
                  <button key={r} onClick={() => setSpeed(r)} style={segBtn(on)}>
                    {r}x
                    {speedOwned(r) && <span style={ownDot(on)}><DownloadIcon size={13} /></span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span style={{ fontSize: '14px', color: 'var(--muted)', fontWeight: 600, minWidth: '66px' }}>{t.filterLabel}</span>
            <div style={segWrap}>
              {[['original', t.fOriginal], ['cinema', t.fCinema], ['mono', t.fMono]].map(([key, lb]) => {
                const on = filter === key;
                return (
                  <button key={key} onClick={() => setFilter(key)} style={segBtn(on)}>
                    {lb}
                    {filterOwned(key) && <span style={ownDot(on)}><DownloadIcon size={13} /></span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── CTA: เคยซื้อชุดนี้แล้ว → ปุ่มดาวน์โหลด · ยังไม่ซื้อ → ปุ่มจ่ายเงิน ── */}
        {current ? (
          <div
            style={{
              marginTop: '18px', padding: '14px', borderRadius: '14px',
              background: 'var(--okbg)', border: '1px solid var(--ok)'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '7px', color: 'var(--ok)', fontWeight: 700, fontSize: '14.5px', marginBottom: '10px' }}>
              <CheckIcon size={16} />
              {t.alreadyOwned} · {filter} · {rate}x
            </div>
            <SaveVideo url={current.download_url} filename={`${label}_${filter}_${rate}x.mp4`} />
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '12px', marginTop: '18px' }}>
            <button
              onClick={() => { videoRef.current?.pause(); setResume(false); setCheckout(true); }}
              style={{
                flex: '1 1 220px', minHeight: '52px', borderRadius: '12px', border: 'none',
                background: 'var(--accent)', color: '#fff', fontFamily: 'inherit',
                fontSize: '16px', fontWeight: 600, cursor: 'pointer'
              }}
            >
              {t.pay}
            </button>
            <div style={{ fontSize: '14px', color: 'var(--muted)' }}>
              {price} {t.baht} {t.perClip} · {rate}x · {filter}
            </div>
          </div>
        )}
      </section>

      <CheckoutModal
        open={checkout}
        videoId={vid}
        label={label}
        filter={filter}
        speed={rate}
        price={price}
        resume={resume}
        onClose={() => {
          setCheckout(false);
          setResume(false);
          loadOwned();          // ปิดหน้าจ่ายเงิน → ดึงรายการที่ซื้อแล้วใหม่ ป้ายจะขึ้นทันที
        }}
      />
    </Main>
  );
}
