import { useNavigate } from 'react-router-dom';
import { useApp } from '@/shared/AppContext';
import { getChannels } from '@/kiosk/api';
import { usePoll } from '@/shared/hooks/usePoll';
import Main from '@/shared/components/Main';
import { Spinner } from '@/shared/components/buttons';

// จอเริ่มต้นของเลน — Pi 1 ตัวต่อกล้อง 1 ตัวแล้ว จึงมีช่องเดียวเสมอ ไม่ต้องมีหน้าเลือกช่องยิงอีก
// กดปุ่มใหญ่นี้ → เข้า Live View ของช่องตัวเอง ซึ่งจะเด้งให้ตั้ง PIN ก่อนเริ่มใช้งานอัตโนมัติ
export default function LaneSelect() {
  const { t } = useApp();
  const navigate = useNavigate();
  const { data: channels, error } = usePoll(getChannels, 3000);

  const cam = (channels || [])[0];
  const laneId = cam?.channel ?? 1;
  const online = cam?.online ?? false;
  const ready = !!cam; // โหลดสถานะช่องมาแล้วอย่างน้อยหนึ่งรอบ

  return (
    <Main>
      <section
        style={{
          minHeight: 'calc(100vh - 130px)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          textAlign: 'center',
          gap: '30px'
        }}
      >
        <div>
          <h1 style={{ margin: '0 0 10px', fontSize: 'clamp(26px, 4vw, 38px)', fontWeight: 700 }}>{t.appName}</h1>
          <div style={{ fontSize: '16px', color: 'var(--muted)' }}>{t.startHint}</div>
        </div>

        {error && (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: '12px',
              border: '1px solid var(--warn)',
              color: 'var(--warn)',
              fontSize: '15px'
            }}
          >
            ⚠ {t.apiDown}
          </div>
        )}

        {!error && ready && !online && (
          <div
            style={{
              padding: '14px 18px',
              borderRadius: '12px',
              border: '1px solid var(--warn)',
              color: 'var(--warn)',
              fontSize: '15px'
            }}
          >
            ● {t.offline}
          </div>
        )}

        <button
          onClick={() => navigate(`/lane/${laneId}`)}
          disabled={ready && !online}
          style={{
            minHeight: '104px',
            padding: '0 84px',
            borderRadius: '99px',
            fontSize: '28px',
            fontWeight: 700,
            fontFamily: 'inherit',
            color: '#fff',
            background:
              ready && !online ? 'var(--border)' : 'linear-gradient(180deg, #e0524a, #c73e37)',
            border: '2px solid rgba(255,255,255,.8)',
            boxShadow:
              ready && !online
                ? 'none'
                : '0 10px 36px rgba(224,82,74,.45), 0 4px 16px rgba(0,0,0,.3)',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '14px',
            cursor: ready && !online ? 'default' : 'pointer',
            opacity: ready && !online ? 0.6 : 1
          }}
        >
          {!ready && !error && <Spinner size={22} />}
          {t.startButton}
        </button>
      </section>
    </Main>
  );
}
