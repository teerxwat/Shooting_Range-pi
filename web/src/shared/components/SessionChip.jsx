import { useApp } from '@/shared/AppContext';

export default function SessionChip({ code }) {
  const { t } = useApp();

  return (
    <div
      style={{
        fontFamily: "'IBM Plex Mono', monospace",
        fontSize: '13.5px',
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: '8px',
        padding: '7px 12px',
        color: 'var(--muted)'
      }}
    >
      {t.session}: {code}
    </div>
  );
}
