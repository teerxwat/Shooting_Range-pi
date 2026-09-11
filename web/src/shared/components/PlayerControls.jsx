import { fmt } from '@/shared/utils/format';

export default function PlayerControls({ playing, tpos, dur, onTogglePlay, onSeek }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '16px',
        marginTop: '16px',
        background: 'var(--surface)',
        border: '1px solid var(--border)',
        borderRadius: '14px',
        padding: '12px 18px'
      }}
    >
      <button
        onClick={onTogglePlay}
        style={{
          width: '54px',
          height: '54px',
          borderRadius: '50%',
          border: 'none',
          background: 'var(--accent)',
          color: '#fff',
          fontSize: '19px',
          cursor: 'pointer',
          flex: 'none',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {playing ? '❚❚' : '▶'}
      </button>
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px', color: 'var(--muted)', flex: 'none' }}>
        {fmt(tpos)}
      </div>
      <input
        type="range"
        min="0"
        max={dur}
        step="0.5"
        value={tpos}
        onChange={(e) => onSeek(parseFloat(e.target.value))}
        style={{ flex: 1, height: '34px', cursor: 'pointer' }}
      />
      <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '14px', color: 'var(--muted)', flex: 'none' }}>
        {fmt(dur)}
      </div>
    </div>
  );
}
