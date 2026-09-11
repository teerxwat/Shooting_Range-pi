/*
 * ไอคอน SVG — เส้นบาง สไตล์เดียวกันทั้งระบบ ไม่ใช้ emoji
 * สีวิ่งตาม currentColor → เปลี่ยนสีด้วย CSS color ของตัวแม่ได้เลย
 */
const base = (size) => ({
  width: size, height: size, display: 'block',
  fill: 'none', stroke: 'currentColor',
  strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round',
});

export function EyeIcon({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" style={base(size)} aria-hidden="true">
      <path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" />
      <circle cx="12" cy="12" r="2.8" />
    </svg>
  );
}

export function EyeOffIcon({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" style={base(size)} aria-hidden="true">
      <path d="M9.9 5.7A9.9 9.9 0 0 1 12 5.5c6.4 0 10 6.5 10 6.5a17 17 0 0 1-3.3 4.1M6.2 7.4A16.6 16.6 0 0 0 2 12s3.6 6.5 10 6.5c1.6 0 3-.4 4.3-1" />
      <path d="M10.1 10.2a2.8 2.8 0 0 0 3.8 4M3 3l18 18" />
    </svg>
  );
}

export function BackspaceIcon({ size = 24 }) {
  return (
    <svg viewBox="0 0 24 24" style={base(size)} aria-hidden="true">
      <path d="M9 5h10a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H9l-6-7 6-7z" />
      <path d="M17 9.5l-5 5M12 9.5l5 5" />
    </svg>
  );
}

export function CheckIcon({ size = 22 }) {
  return (
    <svg viewBox="0 0 24 24" style={base(size)} aria-hidden="true">
      <path d="M4.5 12.5l5 5 10-11" />
    </svg>
  );
}

export function SunIcon({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" style={base(size)} aria-hidden="true">
      <circle cx="12" cy="12" r="4.2" />
      <path d="M12 2.5v2.2M12 19.3v2.2M4.2 4.2l1.6 1.6M18.2 18.2l1.6 1.6M2.5 12h2.2M19.3 12h2.2M4.2 19.8l1.6-1.6M18.2 5.8l1.6-1.6" />
    </svg>
  );
}

export function MoonIcon({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" style={base(size)} aria-hidden="true">
      <path d="M20.5 14.3A8.5 8.5 0 1 1 9.7 3.5a6.8 6.8 0 0 0 10.8 10.8z" />
    </svg>
  );
}

export function DownloadIcon({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" style={base(size)} aria-hidden="true">
      <path d="M12 3v12M7.5 10.5L12 15l4.5-4.5" />
      <path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" style={base(size)} aria-hidden="true">
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </svg>
  );
}

export function ArrowRightIcon({ size = 20 }) {
  return (
    <svg viewBox="0 0 24 24" style={base(size)} aria-hidden="true">
      <path d="M5 12h14M13 6l6 6-6 6" />
    </svg>
  );
}
