import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '@/shared/AppContext';
import Main from '@/shared/components/Main';
import { BackButton } from '@/shared/components/buttons';
import { CheckIcon } from '@/shared/components/icons';
import SaveVideo from '../components/SaveVideo';
import { clearAuth, getCode, getPurchases, getVideos, previewUrl } from '../api';

/** รายการวิดีโอของเซสชัน (sub 1,2,3…) */
export default function Videos() {
  const { t } = useApp();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [bought, setBought] = useState([]);
  const [err, setErr] = useState('');

  // ใช้ข้อมูลที่ lookup ไว้ (เก็บใน sessionStorage ตอนเข้า) — refresh หน้าแล้วยังอยู่
  useEffect(() => {
    const cached = getVideos();
    if (!cached) {
      setErr('session-missing');
      return;
    }
    setData(cached);
    // ของที่เคยจ่ายแล้ว — โหลดซ้ำได้ฟรีจนไฟล์หมดอายุ
    getPurchases()
      .then((r) => setBought(r.items || []))
      .catch(() => {});
  }, []);

  const logout = () => {
    clearAuth();
    navigate('/');
  };

  if (err === 'session-missing') {
    return (
      <Main>
        <BackButton onClick={logout}>{t.back}</BackButton>
        <div style={{ marginTop: '20px', color: 'var(--muted)' }}>{t.sessionExpired}</div>
      </Main>
    );
  }

  const videos = data?.videos || [];

  return (
    <Main>
      <section>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: '14px', marginBottom: '6px' }}>
          <BackButton onClick={logout}>{t.dlOtherSession}</BackButton>
          <h1 style={{ margin: 0, fontSize: 'clamp(22px, 3vw, 28px)', fontWeight: 700 }}>
            {t.yourVideos}
          </h1>
          <span
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '14px',
              background: 'var(--surface2)',
              border: '1px solid var(--border)',
              borderRadius: '8px',
              padding: '7px 12px',
              color: 'var(--muted)'
            }}
          >
            {getCode()}
          </span>
        </div>

        {data?.expires_at && (
          <p style={{ margin: '0 0 20px', fontSize: '14px', color: 'var(--muted)' }}>
            {t.availableUntil}: {new Date(data.expires_at).toLocaleString('th-TH')}
          </p>
        )}

        {/* ── ซื้อไปแล้ว: โหลดซ้ำได้ฟรีจนไฟล์หมดอายุ ── */}
        {bought.length > 0 && (
          <div
            style={{
              background: 'var(--surface)',
              border: '1px solid var(--border)',
              borderRadius: '14px',
              padding: 'clamp(14px, 4vw, 18px)',
              marginBottom: '24px',
            }}
          >
            <div style={{ fontSize: '16.5px', fontWeight: 700, marginBottom: '4px' }}>
              {t.purchased}
            </div>
            <div style={{ fontSize: '13.5px', color: 'var(--muted)', marginBottom: '14px', lineHeight: 1.55 }}>
              {t.purchasedHint}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              {bought.map((o) => (
                <div
                  key={o.order_id}
                  style={{
                    display: 'flex', flexWrap: 'wrap', alignItems: 'center',
                    gap: '10px', paddingTop: '12px', borderTop: '1px solid var(--border)',
                  }}
                >
                  <div style={{ flex: '1 1 160px', minWidth: 0 }}>
                    <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14.5px', fontWeight: 600 }}>
                      {o.label}
                    </div>
                    <div style={{ fontSize: '13px', color: 'var(--muted)' }}>
                      {o.filter} · {o.speed}x
                      {o.downloads > 0 && ` · ${t.downloadedTimes} ${o.downloads}`}
                    </div>
                  </div>

                  {o.status === 'ready' ? (
                    <SaveVideo
                      url={o.download_url}
                      filename={`${o.label}_${o.filter}_${o.speed}x.mp4`}
                      style={{ flex: '1 1 180px', width: 'auto', minHeight: '46px', fontSize: '15px' }}
                    />
                  ) : (
                    <span style={{ fontSize: '14px', color: 'var(--muted)' }}>{t.rendering}</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {videos.length === 0 && (
          <div style={{ color: 'var(--muted)', fontSize: '15px' }}>{t.noClips}</div>
        )}

        {/* มือถือ 1 คอลัมน์ · จอกว้างขึ้นค่อยแตกเป็นหลายคอลัมน์ */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))', gap: '16px' }}>
          {videos.map((v) => {
            const ready = v.status === 'ready';
            const owned = bought.filter((o) => o.video_id === v.id);
            return (
              <div
                key={v.id}
                className="clip-card"
                onClick={() => ready && navigate(`/videos/${v.id}`)}
                style={{
                  background: 'var(--surface)',
                  border: '1px solid var(--border)',
                  borderRadius: '14px',
                  overflow: 'hidden',
                  cursor: ready ? 'pointer' : 'default',
                  opacity: ready ? 1 : 0.6
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
                  {ready ? (
                    <video
                      src={previewUrl(v.id) + '#t=0.5'}
                      preload="metadata"
                      muted
                      playsInline
                      style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <span style={{ color: '#999', fontSize: '14px' }}>{t.processingVideo}</span>
                  )}
                  {ready && (
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
                  )}

                  {/* ป้ายบอกว่าคลิปนี้จ่ายเงินไปแล้ว */}
                  {owned.length > 0 && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '10px',
                        left: '10px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: '5px',
                        padding: '5px 10px',
                        borderRadius: '99px',
                        background: 'var(--ok)',
                        color: '#fff',
                        fontSize: '12.5px',
                        fontWeight: 700
                      }}
                    >
                      <CheckIcon size={13} />
                      {t.ownedBadge}
                      {owned.length > 1 && ` ×${owned.length}`}
                    </div>
                  )}
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
                    {t.clip} {v.sub_no}
                  </div>
                  <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '12.5px', color: 'var(--muted)' }}>
                    {new Date(v.created_at).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </Main>
  );
}
