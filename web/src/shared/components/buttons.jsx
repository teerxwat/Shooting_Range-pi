// ปุ่มมาตรฐานของระบบ — primary 58px, back 46px ตาม design tokens

export function BackButton({ onClick, children }) {
  return (
    <button
      onClick={onClick}
      style={{
        minHeight: '46px',
        padding: '0 18px',
        borderRadius: '10px',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        color: 'var(--text)',
        fontFamily: 'inherit',
        fontSize: '15px',
        cursor: 'pointer'
      }}
    >
      ← {children}
    </button>
  );
}

export function PrimaryButton({ onClick, disabled = false, style = {}, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: '58px',
        padding: '0 30px',
        borderRadius: '12px',
        border: 'none',
        background: 'var(--accent)',
        color: '#fff',
        fontFamily: 'inherit',
        fontSize: '17px',
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '10px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.55 : 1,
        ...style
      }}
    >
      {children}
    </button>
  );
}

export function SecondaryButton({ onClick, disabled = false, children }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{
        minHeight: '58px',
        padding: '0 26px',
        borderRadius: '12px',
        border: '1px solid var(--border)',
        background: 'var(--surface)',
        color: 'var(--text)',
        fontFamily: 'inherit',
        fontSize: '16.5px',
        fontWeight: 600,
        display: 'inline-flex',
        alignItems: 'center',
        gap: '10px',
        cursor: disabled ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1
      }}
    >
      {children}
    </button>
  );
}

export function Spinner({ size = 18 }) {
  return (
    <span
      style={{
        width: size + 'px',
        height: size + 'px',
        border: '2.5px solid rgba(255,255,255,.35)',
        borderTopColor: '#fff',
        borderRadius: '50%',
        display: 'inline-block',
        animation: 'spin .8s linear infinite'
      }}
    />
  );
}
