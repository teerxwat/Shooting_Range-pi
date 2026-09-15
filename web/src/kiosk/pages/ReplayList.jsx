import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '@/shared/AppContext';
import { getClips, getStatus, getUploadStatus, BUSY_STATES } from '@/kiosk/api';
import { usePoll } from '@/shared/hooks/usePoll';
import { useOccupy } from '@/kiosk/useOccupy';
import Main from '@/shared/components/Main';
import ClipCard from '@/kiosk/components/ClipCard';
import SessionCard from '@/kiosk/components/SessionCard';
import EndSessionModal from '@/kiosk/components/EndSessionModal';
import { BackButton } from '@/shared/components/buttons';

export default function ReplayList() {
  const { id } = useParams();
  const laneId = Number(id);
  const navigate = useNavigate();
  const { t } = useApp();

  const { data: clips, error } = usePoll(() => getClips(laneId), 3000, [laneId]);
  const { data: status } = usePoll(() => getStatus(laneId), 5000, [laneId]);
  const { data: up } = usePoll(() => getUploadStatus().catch(() => null), 5000, []);
  useOccupy(laneId);   // ยังถือว่าใช้งานช่องอยู่ขณะดูคลิป
  const list = clips || [];

  // ปุ่ม "จบการใช้งาน" — ถ่ายรูปเลขเซสชัน/PIN ใน SessionCard ไว้แล้วก็จบเองได้เลย
  // เปิด popup เลือกผู้ดูแล (ค่าคอมมิชชั่น) → เลนนี้ว่างให้คนต่อไปทันที ไม่ต้องรอ heartbeat หมดอายุ
  const [endOpen, setEndOpen] = useState(false);

  return (
    <Main>
      <section>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '18px' }}>
          <BackButton onClick={() => navigate(`/lane/${laneId}`)}>{t.back}</BackButton>
          <h1 style={{ margin: 0, fontSize: 'clamp(22px, 2.6vw, 28px)', fontWeight: 700 }}>
            {t.replays} · {t.lane} {laneId}
          </h1>
          <span style={{ fontSize: '13.5px', color: 'var(--muted)' }}>{t.replayHint}</span>
        </div>

        {/* เลขเซสชัน + PIN + QR — ลูกค้าถ่ายรูปเก็บไว้แล้วไปโหลดที่บ้าน */}
        <SessionCard
          code={status?.sessionCode}
          pin={status?.pin}
          site={status?.downloadSite}
          pending={up?.pending || 0}
        />

        {!!status?.sessionCode && !BUSY_STATES.includes(status?.state) && (
          <button
            onClick={() => setEndOpen(true)}
            style={{
              display: 'block',
              marginBottom: '20px',
              minHeight: '48px',
              padding: '0 22px',
              borderRadius: '10px',
              border: '1px solid var(--border)',
              background: 'transparent',
              color: 'var(--muted)',
              fontFamily: 'inherit',
              fontSize: '15px',
              fontWeight: 600,
              cursor: 'pointer'
            }}
          >
            ⏹ {t.endSession}
          </button>
        )}

        {/* คลิปที่ยังแปลงไฟล์อยู่เบื้องหลัง — จะโผล่ในรายการเองเมื่อเสร็จ */}
        {status?.processing?.count > 0 && (
          <div style={{ fontSize: '14.5px', color: 'var(--accent)', marginBottom: '14px' }}>
            ⏳ {t.preparingVideo}
            {status.processing.count > 1 ? ` (${status.processing.count})` : ''}
            {status.processing.progress != null ? ` · ${status.processing.progress}%` : ''}
          </div>
        )}

        {error && <div style={{ color: 'var(--warn)', marginBottom: '14px' }}>⚠ {t.apiDown}</div>}
        {!error && list.length === 0 && !(status?.processing?.count > 0) && (
          <div style={{ color: 'var(--muted)', fontSize: '15px' }}>{t.noClips}</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '18px' }}>
          {list.map((clip, i) => (
            <ClipCard key={clip.path} clip={clip} n={i + 1} onOpen={() => navigate(`/lane/${laneId}/clips/${i}`)} />
          ))}
        </div>
      </section>

      <EndSessionModal
        open={endOpen}
        laneId={laneId}
        sessionCode={status?.sessionCode}
        onClose={() => setEndOpen(false)}
        onEnded={() => navigate('/')}
      />
    </Main>
  );
}
