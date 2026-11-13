import { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '@/shared/AppContext';
import { getStatus, startProcess, cancelProcess, startPreview, stopPreview, BUSY_STATES, SKIP_AI_ONLY } from '@/kiosk/api';
import { usePoll } from '@/shared/hooks/usePoll';
import { useOccupy } from '@/kiosk/useOccupy';
import VideoBox from '@/kiosk/components/VideoBox';
import ProcessingPill from '@/kiosk/components/ProcessingPill';
import PinPad from '@/kiosk/components/PinPad';
import EndSessionModal from '@/kiosk/components/EndSessionModal';
import ZoomSlider from '@/kiosk/components/ZoomSlider';
import { Spinner } from '@/shared/components/buttons';
import { useMedia } from '@/shared/hooks/useMedia';

const mono = { fontFamily: "'IBM Plex Mono', 'IBM Plex Sans Thai', monospace" };

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

  // คลิปแปลงไฟล์เบื้องหลังเสร็จ → ไม่เด้งไปหน้าดูวิดีโอ ให้อยู่หน้าเดิม
  // ลูกค้าเห็นว่าพร้อมจากแถบโหลดที่หายไป + ตัวเลขบนปุ่ม "วิดีโอย้อนหลัง" ที่นับเพิ่ม แล้วกดดูเองได้

  // skipDetect=true → ปุ่มหลัก "เริ่มบันทึกทันที" (ข้าม AI)
  // skipDetect=false → ปุ่มรอง "ตรวจจับท่า AI" (ซ่อนได้ด้วย VITE_SKIP_AI_ONLY=true)
  const onProcess = async (skipDetect) => {
    try {
      await startProcess(laneId, { skipDetect });
    } catch (e) {
      alert(e.message);
    }
  };

  // ปุ่ม "จบการใช้งาน" → popup เลือกผู้ดูแล (ค่าคอมมิชชั่น) แล้วจบเซสชันทันที ไม่ต้องรอ heartbeat หมดอายุ
  // (เลนว่างให้คนต่อไปทันที + คนต่อไปไม่เห็นคลิปของคนก่อน)
  const [endOpen, setEndOpen] = useState(false);

  // ── responsive ──
  // stacked = จอแคบแนวตั้ง (≤900px): ปุ่มล่างเรียงลงมา แถบโหลด → เริ่มบันทึก → AI / วิดีโอย้อนหลัง
  // short   = จอเตี้ย (มือถือแนวนอน): ซ่อนคำอธิบาย ลดระยะ ปุ่ม AI ย้ายไปขวา ให้เหลือแถวเดียว
  const compact = useMedia('(max-width: 900px)');
  const short = useMedia('(max-height: 500px)');
  const tiny = useMedia('(max-width: 420px)');
  const stacked = compact && !short;
  const gutter = short ? 12 : 18;

  const canStart = !busy && online;
  const showAi = !SKIP_AI_ONLY && !busy && online;
  const detecting = state === 'DETECTING';

  // ── ปุ่ม ──
  const recordBtn = (
    <button
      onClick={() => onProcess(true)}
      disabled={!canStart}
      style={{
        minHeight: short ? '56px' : stacked ? '64px' : '72px',
        width: stacked ? '100%' : 'auto',
        borderRadius: '99px',
        padding: short ? '0 28px' : '0 48px',
        fontSize: short || tiny ? '17px' : '20px',
        fontWeight: 700,
        fontFamily: 'inherit',
        color: '#fff',
        background: 'linear-gradient(180deg, #e0524a, #c73e37)',
        border: '2px solid rgba(255,255,255,.85)',
        boxShadow: '0 8px 30px rgba(224,82,74,.5), 0 4px 14px rgba(0,0,0,.4)',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '12px',
        whiteSpace: 'nowrap',
        cursor: canStart ? 'pointer' : 'default',
        opacity: canStart ? 1 : 0.55
      }}
    >
      {busy && <Spinner size={20} />}
      {busy ? t.processing : t.processSkip}
    </button>
  );

  const aiBtn = showAi && (
    <button
      onClick={() => onProcess(false)}
      style={{
        ...frost,
        minHeight: stacked ? '48px' : short ? '48px' : '38px',
        padding: '0 18px',
        fontSize: '13px',
        fontWeight: 600,
        opacity: 0.9,
        whiteSpace: 'nowrap',
        flex: stacked ? '1 1 0' : undefined
      }}
    >
      ◎ {t.processAi}
    </button>
  );

  const cancelBtn = detecting && (
    <button
      onClick={() => cancelProcess(laneId)}
      style={{
        ...frost,
        minHeight: stacked || short ? '48px' : '62px',
        padding: short ? '0 16px' : '0 24px',
        fontSize: short ? '14px' : '15.5px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        flex: stacked ? '1 1 0' : undefined
      }}
    >
      ✕ {t.cancel}
    </button>
  );

  const replaysBtn = (
    <button
      onClick={() => clipCount && navigate(`/lane/${laneId}/clips`)}
      disabled={clipCount === 0}
      style={{
        ...frost,
        minHeight: stacked || short ? '48px' : '62px',
        padding: short || stacked ? '0 16px' : '0 24px',
        fontSize: short || tiny ? '14px' : '15.5px',
        fontWeight: 600,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        minWidth: 0,
        flex: stacked ? '1 1 0' : undefined,
        opacity: clipCount ? 1 : 0.5,
        cursor: clipCount ? 'pointer' : 'default'
      }}
    >
      ▶ {t.replays} ({clipCount})
    </button>
  );

  // แถบโหลดเล็กๆ — บันทึก/แปลงวิดีโอเบื้องหลัง ไม่บังภาพสด
  const pill = (
    <ProcessingPill
      saving={state === 'DOWNLOADING'}
      processing={status?.processing}
      style={{ width: stacked ? '100%' : '270px', maxWidth: '100%' }}
    />
  );

  const hint = !short && (
    <div
      style={{
        textAlign: 'center',
        fontSize: stacked ? '12.5px' : '13.5px',
        lineHeight: 1.45,
        color: 'rgba(255,255,255,.75)',
        textShadow: '0 1px 4px rgba(0,0,0,.5)'
      }}
    >
      {t.processHint}
    </div>
  );

  const chip = { ...frost, cursor: 'default', whiteSpace: 'nowrap', flexShrink: 0 };

  return (
    <section
      data-screen-label="Live view"
      style={{ position: 'fixed', inset: 0, background: '#0e0f11', zIndex: 40, overflow: 'hidden' }}
    >
      {/* วิดีโอเต็มจอ (background layer) + state overlays */}
      <VideoBox laneId={laneId} state={state} session={session} preview={status?.preview} fill />

      {/* ── top overlay bar — แถวเดียวเสมอ (จอแคบ: ย่อปุ่มกลับ ซ่อนป้าย CAM) ── */}
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          padding: `calc(${short ? 8 : 14}px + env(safe-area-inset-top)) calc(${gutter}px + env(safe-area-inset-right)) ${short ? 24 : 44}px calc(${gutter}px + env(safe-area-inset-left))`,
          background: 'linear-gradient(180deg, rgba(10,10,12,.68), transparent)',
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'nowrap',
          gap: compact ? '8px' : '12px',
          minWidth: 0
        }}
      >
        <button
          onClick={() => navigate('/')}
          aria-label={t.backLanes}
          style={{
            ...frost,
            minHeight: short ? '40px' : '46px',
            minWidth: short ? '40px' : '46px',
            padding: compact ? '0 14px' : '0 20px',
            fontSize: '15px',
            flexShrink: 0
          }}
        >
          ←{!compact && ` ${t.backLanes}`}
        </button>
        <div
          style={{
            fontSize: compact ? '16px' : '18px',
            fontWeight: 700,
            color: '#fff',
            textShadow: '0 1px 6px rgba(0,0,0,.6)',
            whiteSpace: 'nowrap',
            flexShrink: 0
          }}
        >
          {t.lane} {laneId}
        </div>
        <div
          style={{
            ...chip,
            ...mono,
            fontSize: compact ? '12px' : '13px',
            padding: compact ? '7px 11px' : '8px 14px',
            flexShrink: 1,
            minWidth: 0,
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {!tiny && `${t.session}: `}
          {status?.sessionCode || session?.code || '—'}
        </div>

        {!!status?.sessionCode && !busy && (
          <button
            onClick={() => setEndOpen(true)}
            aria-label={t.endSession}
            style={{
              ...frost,
              minHeight: short ? '40px' : '46px',
              padding: compact ? '0 12px' : '0 18px',
              fontSize: compact ? '13px' : '14px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              flexShrink: 0
            }}
          >
            ⏹{!tiny && ` ${t.endSession}`}
          </button>
        )}

        <div style={{ flex: 1, minWidth: 0 }} />

        {showStream && (
          <>
            <div
              style={{
                ...chip,
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: compact ? '7px 12px' : '9px 16px',
                fontSize: compact ? '12.5px' : '14px',
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
              {!tiny && t.live}
            </div>
            {!compact && (
              <div style={{ ...chip, ...mono, fontSize: '13px', padding: '9px 14px' }}>
                CAM-{laneId} · 1080p
              </div>
            )}
          </>
        )}
        {!online && !error && (
          <div style={{ ...chip, fontSize: compact ? '12.5px' : '14px', padding: compact ? '7px 12px' : '9px 16px', color: '#c9a25e' }}>
            ●{!tiny && ` ${t.offline}`}
          </div>
        )}
        {error && (
          <div style={{ ...chip, fontSize: compact ? '12.5px' : '14px', padding: compact ? '7px 12px' : '9px 16px', color: '#c9a25e' }}>
            ⚠{!tiny && ` ${t.apiDown}`}
          </div>
        )}
      </div>

      {/* ── slider ซูมกล้อง (ชิดขวากลางจอ) — โชว์เฉพาะตอนมีภาพสด ช่วงอัด/เตรียมกล้องซ่อนไว้ ── */}
      {showStream && online && (
        <ZoomSlider
          laneId={laneId}
          compact={short || stacked}
          style={{
            position: 'absolute',
            right: `calc(${short ? 10 : 14}px + env(safe-area-inset-right))`,
            // จอแคบแนวตั้ง: ยกขึ้นเหนือกลุ่มปุ่มล่างที่สูงกว่าปกติ
            top: stacked ? '40%' : '50%',
            transform: 'translateY(-50%)',
            zIndex: 2
          }}
        />
      )}

      {/* ── bottom overlay ── */}
      <div
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: `${short ? 22 : 46}px calc(${gutter}px + env(safe-area-inset-right)) calc(${short ? 10 : 18}px + env(safe-area-inset-bottom)) calc(${gutter}px + env(safe-area-inset-left))`,
          background: 'linear-gradient(0deg, rgba(10,10,12,.72), transparent)'
        }}
      >
        {stacked ? (
          // จอแคบแนวตั้ง: เรียงลงมาเป็นคอลัมน์เดียว
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: '10px', maxWidth: '480px', margin: '0 auto' }}>
            {hint}
            {pill}
            {recordBtn}
            <div style={{ display: 'flex', gap: '10px' }}>
              {cancelBtn || aiBtn}
              {replaysBtn}
            </div>
          </div>
        ) : (
          <>
            {/* แถวบน: แถบโหลด (ซ้าย) | คำอธิบาย (กลาง) — แยกช่องกัน ไม่ทับกัน */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr minmax(0, 560px) 1fr',
                alignItems: 'end',
                gap: '12px',
                marginBottom: short ? '8px' : '14px'
              }}
            >
              <div style={{ minWidth: 0 }}>{pill}</div>
              <div>{hint}</div>
              <div />
            </div>

            {/* แถวปุ่ม: วิดีโอย้อนหลัง (ซ้าย) | เริ่มบันทึก (+AI ใต้ปุ่ม) (กลาง) | ยกเลิก/AI (ขวา) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr auto 1fr',
                alignItems: 'center',
                gap: '12px',
                minHeight: short ? '56px' : '72px'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'flex-start', minWidth: 0 }}>{replaysBtn}</div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '10px' }}>
                {recordBtn}
                {/* จอเตี้ย: ปุ่ม AI ย้ายไปช่องขวา ให้เหลือแถวเดียว */}
                {!short && aiBtn}
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', minWidth: 0 }}>
                {cancelBtn || (short && aiBtn)}
              </div>
            </div>
          </>
        )}
      </div>

      {/* ตั้ง PIN ก่อนเริ่มใช้เลน — สถานะจะอัปเดตเองจาก poll ทุก 1 วิ */}
      <PinPad lane={laneId} open={needsPin} onDone={() => {}} />

      <EndSessionModal
        open={endOpen}
        laneId={laneId}
        sessionCode={status?.sessionCode}
        onClose={() => setEndOpen(false)}
        onEnded={() => navigate('/')}
      />
    </section>
  );
}
