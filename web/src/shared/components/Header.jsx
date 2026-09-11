import { useNavigate } from 'react-router-dom';
import { useApp } from '@/shared/AppContext';
import { useClock } from '@/shared/hooks/useClock';
import LanguageSwitcher from './LanguageSwitcher';
import ThemeToggle from './ThemeToggle';

export default function Header() {
  const { t, lang } = useApp();
  const navigate = useNavigate();
  const clock = useClock(lang);

  return (
    <header
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 'clamp(8px, 2.5vw, 14px)',
        padding: 'clamp(12px, 3vw, 16px) clamp(14px, 4vw, 28px)',
        borderBottom: '1px solid var(--border)',
        background: 'var(--surface)'
      }}
    >
      <div
        style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer' }}
        onClick={() => navigate('/')}
      >
        <div
          style={{
            width: '44px',
            height: '44px',
            borderRadius: '10px',
            background: 'var(--accent)',
            color: '#fff',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontWeight: 700,
            fontSize: '15px',
            letterSpacing: '.5px'
          }}
        >
          700
        </div>
        <div>
          <div style={{ fontSize: 'clamp(15px, 4vw, 18px)', fontWeight: 700, lineHeight: 1.2 }}>
            {t.appName}
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--muted)' }} className="hide-sm">
            {t.subtitle}
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {/* นาฬิกาเป็นของประดับ — จอมือถือแคบซ่อนไว้ให้ปุ่มมีที่หายใจ */}
      <div
        className="hide-sm"
        style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px', color: 'var(--muted)' }}
      >
        {clock}
      </div>

      <LanguageSwitcher />
      <ThemeToggle />
    </header>
  );
}
