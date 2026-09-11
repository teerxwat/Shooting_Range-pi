import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '@/shared/AppContext';
import { getStatus, startProcess, cancelProcess, startPreview, stopPreview, BUSY_STATES, SKIP_AI_ONLY } from '@/kiosk/api';
import { usePoll } from '@/shared/hooks/usePoll';
import { useOccupy } from '@/kiosk/useOccupy';
import VideoBox from '@/kiosk/components/VideoBox';
import PinPad from '@/kiosk/components/PinPad';
import { Spinner } from '@/shared/components/buttons';

const mono = { fontFamily: "'IBM Plex Mono', monospace" };

// frosted-glass pill (ตาม design ใหม่)
const frost = {
  background: 'rgba(20,20,22,.55)',
  backdropFilter: 'blur(10px)',
  WebkitBackdropFilter: 'blur(10px)',
  border: '1px solid rgba(255,255,255,.28)',
  color: '#fff',
  borderRadius: '99px',
  fontFamily: 'inherit',
  cursor: 'pointer'
};

// Live View แบบ camera app เต็มจอ — ซ่อน header, วิดีโอเป็น background layer
export default function LiveView() {
  const { id } = useParams();
  const laneId = Number(id);
  const navigate = useNavigate();
  const { t } = useApp();

  const { data: status, error } = usePoll(() => getStatus(laneId), 1000, [laneId]);
  useOccupy(laneId);   // จองช่องนี้ขณะเปิดหน้าอยู่

  // ลูกค้าใหม่เข้าเลน → ต้องตั้ง PIN ก่อนถึงจะเริ่มอัดได้
  const needsPin = !!status?.needsPin;

  const state = status?.state || 'IDLE';
  const session = status?.session;
  const clipCount = status?.clipCount || 0;
  const online = status?.online;
  const busy = BUSY_STATES.includes(state);
  const showStream = state === 'DETECTING' || (status?.preview && ['IDLE', 'DONE', 'ERROR'].includes(state));

  // idle preview: เข้าหน้านี้ → เปิดภาพสดทันที + heartbeat ทุก 4 วิ (backend หยุดเองถ้าไม่มี heartbeat)
  useEffect(() => {
    const ping = () => startPreview(laneId).catch(() => {});
    ping();
    const timer = setInterval(ping, 4000);
    return () => {
      clearInterval(timer);
      stopPreview(laneId).catch(() => {});
    };
  }, [laneId]);

  // เมื่อบันทึกเสร็จ (DONE) → เปิดวิดีโอล่าสุดอัตโนมัติ "ครั้งเดียวต่อรอบอัด"
  // (visit เดียวอัดได้หลายรอบ → ผูก key กับจำนวนคลิปด้วย ให้เด้งทุกรอบใหม่)
  useEffect(() => {
    if (state !== 'DONE' || !session?.code || clipCount === 0) return;
    const key = `done-navigated-${session.code}-${clipCount}`;
    if (sessionStorage.getItem(key)) return;
    sessionStorage.setItem(key, '1');
    const timer = setTimeout(
      () => navigate(`/lane/${laneId}/clips/${Math.max(0, clipCount - 1)}`),
      1200
    );
    return () => clearTimeout(timer);
  }, [state, session, clipCount, laneId, navigate]);

  // skipDetect=true → ปุ่มหลัก "เริ่มบันทึกทันที" (ข้าม AI)
  // skipDetect=false → ปุ่มรอง "ตรวจจับท่า AI" (ซ่อนได้ด้วย VITE_SKIP_AI_ONLY=true)
  const onProcess = async (skipDetect) => {
    try {
      await startProcess(laneId, { skipDetect });
    } catch (e) {
      alert(e.message);
    }
  };

  return (
    <section
      data-screen-label="Live view"
      style={{ position: 'fixed', inset: 0, background: '#0e0f11', zIndex: 40, overflow: 'hidden' }}
    >
      {/* วิดีโอเต็มจอ (background layer) + state overlays */}
      <VideoBox laneId={laneId} state={state} session={session} preview={status?.preview} fill />

      {/* ── top overlay bar ── */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: 'calc(14px + env(safe-area-inset-top)) 18px 44px',
          background: 'linear-gradient(180deg, rgba(10,10,12,.68), transparent)',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: '12px'
        }}
      >
        <button
          onClick={() => navigate('/')}
          style={{ ...frost, minHeight: '46px', padding: '0 20px', fontSize: '15px' }}
        >
          ← {t.backLanes}
        </button>
        <div style={{ fontSize: '18px', fontWeight: 700, color: '#fff', textShadow: '0 1px 6px rgba(0,0,0,.6)' }}>
          {t.lane} {laneId}
        </div>
        <div style={{ ...frost, ...mono, cursor: 'default', fontSize: '13px', padding: '8px 14px' }}>
          {t.session}: {status?.sessionCode || session?.code || '—'}
        </div>

        <div style={{ flex: 1 }} />

        {showStream && (
          <>
            <div
              style={{
                ...frost,
                cursor: 'default',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '9px 16px',
                fontSize: '14px',
                fontWeight: 600,
                letterSpacing: '.5px'
              }}
            >
              <span
                style={{
                  width: '10px',
                  height: '10px',
                  borderRadius: '50%',
                  background: '#e0524a',
                  display: 'inline-block',
                  animation: 'pulse 1.4s infinite'
                }}
              />
              {t.live}
            </div>
            <div style={{ ...frost, ...mono, cursor: 'default', fontSize: '13px', padding: '9px 14px' }}>
              CAM-{laneId} · 1080p
            </div>
          </>
        )}
        {!online && !error && (
          <div style={{ ...frost, cursor: 'default', fontSize: '14px', padding: '9px 16px', color: '#c9a25e' }}>
            ● {t.offline}
          </div>
        )}
        {error && (
          <div style={{ ...frost, cursor: 'default', fontSize: '14px', padding: '9px 16px', color: '#c9a25e' }}>
            ⚠ {t.apiDown}
          </div>
        )}
      </div>

      {/* ── bottom overlay: hint + control row ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '46px 18px calc(18px + env(safe-area-inset-bottom))',
          background: 'linear-gradient(0deg, rgba(10,10,12,.72), transparent)'
        }}
      >
        <div
          style={{
            textAlign: 'center',
            fontSize: '13.5px',
            color: 'rgba(255,255,255,.75)',
            marginBottom: '14px',
            textShadow: '0 1px 4px rgba(0,0,0,.5)'
          }}
        >
          {t.processHint}
        </div>

        <div
          style={{
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            minHeight: '72px'
          }}
        >
          {/* วิดีโอย้อนหลัง — ชิดซ้าย */}
          <button
            onClick={() => clipCount && navigate(`/lane/${laneId}/clips`)}
            disabled={clipCount === 0}
            style={{
              ...frost,
              position: 'absolute',
              left: 0,
              minHeight: '62px',
              padding: '0 24px',
              fontSize: '15.5px',
              fontWeight: 600,
              opacity: clipCount ? 1 : 0.5,
              cursor: clipCount ? 'pointer' : 'default'
            }}
          >
            ▶ {t.replays} ({clipCount})
          </button>

          {/* กลางจอ: ปุ่มหลัก "เริ่มบันทึกทันที" (ข้าม AI) + ปุ่มรอง "ตรวจจับท่า AI" (ซ่อน/โชว์ได้ด้วย VITE_SKIP_AI_ONLY) */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
            {/* ปุ่มชัตเตอร์หลัก — ข้าม AI, เข้า countdown ทันที */}
            <button
              onClick={() => onProcess(true)}
              disabled={busy || !online}
              style={{
                minHeight: '72px',
                borderRadius: '99px',
                padding: '0 48px',
                fontSize: '20px',
                fontWeight: 700,
                fontFamily: 'inherit',
                color: '#fff',
                background: 'linear-gradient(180deg, #e0524a, #c73e37)',
                border: '2px solid rgba(255,255,255,.85)',
                boxShadow: '0 8px 30px rgba(224,82,74,.5), 0 4px 14px rgba(0,0,0,.4)',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '12px',
                cursor: busy || !online ? 'default' : 'pointer',
                opacity: busy || !online ? 0.55 : 1
              }}
            >
              {busy && <Spinner size={20} />}
              {busy ? t.processing : t.processSkip}
            </button>

            {/* ปุ่มรอง — ให้ AI ตรวจจับท่าเล็งก่อนนับถอยหลัง (ปิดได้ทั้งหมดด้วย VITE_SKIP_AI_ONLY=true ตอน build) */}
            {!SKIP_AI_ONLY && !busy && online && (
              <button
                onClick={() => onProcess(false)}
                style={{ ...frost, minHeight: '38px', padding: '0 18px', fontSize: '13px', fontWeight: 600, opacity: 0.9 }}
              >
                ◎ {t.processAi}
              </button>
            )}
          </div>

          {/* ยกเลิก detect — ชิดขวา */}
          {state === 'DETECTING' && (
            <button
              onClick={() => cancelProcess(laneId)}
              style={{ ...frost, position: 'absolute', right: 0, minHeight: '62px', padding: '0 24px', fontSize: '15.5px', fontWeight: 600 }}
            >
              ✕ {t.cancel}
            </button>
          )}
        </div>
      </div>

      {/* ตั้ง PIN ก่อนเริ่มใช้เลน — สถานะจะอัปเดตเองจาก poll ทุก 1 วิ */}
      <PinPad lane={laneId} open={needsPin} onDone={() => {}} />
    </section>
  );
}
