/*
 * ธงชาติวาดด้วย SVG ไม่ใช้ emoji
 * emoji ธงไม่แสดงผลบน Windows และ Linux หลายรุ่น (ขึ้นเป็นตัวอักษร TH / GB แทน)
 * ซึ่งจอ kiosk ที่สนามใช้ Linux — วาดเองเลยชัวร์กว่าและคมทุกขนาด
 */

const frame = {
  borderRadius: '4px',
  boxShadow: '0 0 0 1px rgba(0,0,0,.12)',
  display: 'block',
  flexShrink: 0,
};

/** ธงไทย — แถบแดง ขาว น้ำเงิน ขาว แดง (น้ำเงินหนาเป็น 2 เท่า) */
export function FlagTH({ size = 34 }) {
  return (
    <svg width={size} height={size * 2 / 3} viewBox="0 0 90 60" style={frame} aria-hidden="true">
      <rect width="90" height="60" fill="#A51931" />
      <rect y="10" width="90" height="40" fill="#F4F5F8" />
      <rect y="20" width="90" height="20" fill="#2D2A4A" />
    </svg>
  );
}

/** ธงสหราชอาณาจักร — ใช้แทนภาษาอังกฤษ */
export function FlagEN({ size = 34 }) {
  return (
    <svg width={size} height={size * 2 / 3} viewBox="0 0 60 40" style={frame} aria-hidden="true">
      <rect width="60" height="40" fill="#012169" />
      {/* กากบาททแยงขาว แล้วซ้อนแดงบาง ๆ ทับ */}
      <path d="M0,0 L60,40 M60,0 L0,40" stroke="#FFF" strokeWidth="8" />
      <path d="M0,0 L60,40" stroke="#C8102E" strokeWidth="3" clipPath="url(#uk-a)" />
      <path d="M60,0 L0,40" stroke="#C8102E" strokeWidth="3" clipPath="url(#uk-b)" />
      <clipPath id="uk-a"><path d="M30,20 L60,20 L60,40 Z M30,20 L0,20 L0,0 Z" /></clipPath>
      <clipPath id="uk-b"><path d="M30,20 L60,20 L60,0 Z M30,20 L0,20 L0,40 Z" /></clipPath>
      {/* กางเขนตรง */}
      <path d="M30,0 V40 M0,20 H60" stroke="#FFF" strokeWidth="13" />
      <path d="M30,0 V40 M0,20 H60" stroke="#C8102E" strokeWidth="8" />
    </svg>
  );
}

/** ธงจีน — ดาวใหญ่ 1 ดวง ดาวเล็ก 4 ดวงเรียงโค้งรอบ */
export function FlagZH({ size = 34 }) {
  const star = (cx, cy, r, rot = 0) => {
    const pts = [];
    for (let i = 0; i < 5; i += 1) {
      const outer = ((i * 72 - 90 + rot) * Math.PI) / 180;
      const inner = (((i * 72) + 36 - 90 + rot) * Math.PI) / 180;
      pts.push(`${cx + r * Math.cos(outer)},${cy + r * Math.sin(outer)}`);
      pts.push(`${cx + r * 0.382 * Math.cos(inner)},${cy + r * 0.382 * Math.sin(inner)}`);
    }
    return <polygon points={pts.join(' ')} fill="#FFDE00" />;
  };

  return (
    <svg width={size} height={size * 2 / 3} viewBox="0 0 90 60" style={frame} aria-hidden="true">
      <rect width="90" height="60" fill="#EE1C25" />
      {star(15, 15, 9)}
      {star(30, 6, 3, 25)}
      {star(36, 14, 3, 46)}
      {star(36, 24, 3, 70)}
      {star(30, 32, 3, 20)}
    </svg>
  );
}

export const FLAGS = { th: FlagTH, en: FlagEN, zh: FlagZH };

/** ชื่อภาษาเขียนด้วยภาษานั้นเอง — คนอ่านออกโดยไม่ต้องรู้ภาษาปัจจุบันของหน้าจอ */
export const LANG_LIST = [
  { code: 'th', name: 'ไทย', sub: 'Thai' },
  { code: 'en', name: 'English', sub: 'อังกฤษ' },
  { code: 'zh', name: '中文', sub: 'Chinese' },
];
