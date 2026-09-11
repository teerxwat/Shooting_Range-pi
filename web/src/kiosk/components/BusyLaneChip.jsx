import { useApp } from '@/shared/AppContext';

export default function BusyLaneChip({ lane }) {
  const { t } = useApp();

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '7px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '99px',
        padding: '7px 14px'
      }}
    >
      <span
        style={{
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          background: 'var(--warn)',
          display: 'inline-block'
        }}
      />
      {t.lane} {lane.id} — {t.inUse}
    </span>
  );
}
