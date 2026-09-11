import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '@/shared/AppContext';
import { getClips, getStatus, getUploadStatus } from '@/kiosk/api';
import { usePoll } from '@/shared/hooks/usePoll';
import { useOccupy } from '@/kiosk/useOccupy';
import Main from '@/shared/components/Main';
import ClipCard from '@/kiosk/components/ClipCard';
import SessionCard from '@/kiosk/components/SessionCard';
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

        {error && <div style={{ color: 'var(--warn)', marginBottom: '14px' }}>⚠ {t.apiDown}</div>}
        {!error && list.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: '15px' }}>{t.noClips}</div>
        )}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '18px' }}>
          {list.map((clip, i) => (
            <ClipCard key={clip.path} clip={clip} n={i + 1} onOpen={() => navigate(`/lane/${laneId}/clips/${i}`)} />
          ))}
        </div>
      </section>
    </Main>
  );
}
