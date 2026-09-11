import { useEffect, useRef } from 'react';

// QR placeholder: 25×25 modules, seeded pseudo-random 52% fill + 3 finder squares
export default function QRCanvas({ seed, size = 220 }) {
  const ref = useRef(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const n = 25;
    const s = canvas.width / n;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    let r = (seed * 2654435761) % 2147483648;
    const rnd = () => {
      r = (r * 1103515245 + 12345) % 2147483648;
      return r / 2147483648;
    };
    ctx.fillStyle = '#1c1b1a';
    const inFinder = (x, y) => (x < 8 && y < 8) || (x >= n - 8 && y < 8) || (x < 8 && y >= n - 8);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        if (!inFinder(x, y) && rnd() > 0.52) ctx.fillRect(x * s, y * s, s - 0.5, s - 0.5);
      }
    const finder = (fx, fy) => {
      ctx.fillStyle = '#1c1b1a';
      ctx.fillRect(fx * s, fy * s, 7 * s, 7 * s);
      ctx.fillStyle = '#fff';
      ctx.fillRect((fx + 1) * s, (fy + 1) * s, 5 * s, 5 * s);
      ctx.fillStyle = '#1c1b1a';
      ctx.fillRect((fx + 2) * s, (fy + 2) * s, 3 * s, 3 * s);
    };
    finder(0, 0);
    finder(n - 7, 0);
    finder(0, n - 7);
  }, [seed]);

  return (
    <div
      style={{
        display: 'inline-block',
        background: '#fff',
        border: '1px solid var(--border)',
        borderRadius: '14px',
        padding: '14px'
      }}
    >
      <canvas ref={ref} width={size} height={size} style={{ display: 'block' }} />
    </div>
  );
}
