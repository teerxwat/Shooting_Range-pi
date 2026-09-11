import { useApp } from '@/shared/AppContext';
import { useIsMobile } from '@/shared/hooks/useMedia';

// ใช้ตัวย่อเหมือนกันทั้งจอใหญ่และมือถือ — สั้น อ่านออกทุกภาษา ไม่ต้องแปล
const LANGS = [
  { code: 'th', label: 'TH' },
  { code: 'en', label: 'EN' },
  { code: 'zh', label: '中文' }
];

/*
 * จอใหญ่  → ปุ่มเรียงให้เห็นครบทุกภาษา
 * มือถือ  → dropdown ตัวย่อ (TH / EN / 中文) ประหยัดที่บนแถบหัว
 */
export default function LanguageSwitcher() {
  const { lang, setLang } = useApp();
  const isMobile = useIsMobile();

  if (isMobile) {
    return (
      <select
        value={lang}
        onChange={(e) => setLang(e.target.value)}
        aria-label="Language"
        style={{
          height: '40px',
          padding: '0 26px 0 12px',
          borderRadius: '10px',
          border: '1px solid var(--border)',
          background: 'var(--surface2)',
          color: 'var(--text)',
          fontFamily: 'inherit',
          fontSize: '15px',
          fontWeight: 600,
          cursor: 'pointer',
          appearance: 'none',
          WebkitAppearance: 'none',
          // ลูกศรวาดเป็น SVG ฝังใน background — หน้าตาเหมือนกันทุกเครื่อง
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%236e6a64' stroke-width='2' stroke-linecap='round'><path d='M6 9l6 6 6-6'/></svg>\")",
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 7px center',
          backgroundSize: '15px'
        }}
      >
        {LANGS.map((l) => (
          <option key={l.code} value={l.code}>
            {l.label}
          </option>
        ))}
      </select>
    );
  }

  const btnStyle = (on) => ({
    minHeight: '38px',
    padding: '0 14px',
    borderRadius: '7px',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: '14px',
    fontWeight: 600,
    background: on ? 'var(--accent)' : 'transparent',
    color: on ? '#fff' : 'var(--muted)'
  });

  return (
    <div
      style={{
        display: 'flex',
        gap: '6px',
        background: 'var(--surface2)',
        border: '1px solid var(--border)',
        borderRadius: '10px',
        padding: '4px'
      }}
    >
      {LANGS.map((l) => (
        <button key={l.code} onClick={() => setLang(l.code)} style={btnStyle(lang === l.code)}>
          {l.label}
        </button>
      ))}
    </div>
  );
}
