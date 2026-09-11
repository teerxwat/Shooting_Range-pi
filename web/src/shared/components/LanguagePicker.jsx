import { useApp } from '@/shared/AppContext';
import { FLAGS, LANG_LIST } from './flags';

/*
 * ป๊อปอัปเลือกภาษา — เด้งครั้งแรกที่เข้าเว็บเท่านั้น
 *
 * เลือกแล้วจำไว้ใน localStorage จะไม่ถามซ้ำ เปลี่ยนทีหลังได้ที่แถบหัวเสมอ
 * ใช้ร่วมกันทั้งหน้าลูกค้าและจอ kiosk เพราะแขวนไว้ที่ AppProvider ที่เดียว
 *
 * ไม่มีปุ่มปิดหรือกดพื้นหลังเพื่อข้าม — ต้องเลือกภาษาก่อน
 * เพราะถ้าข้ามได้ นักท่องเที่ยวที่อ่านไทยไม่ออกจะเจอหน้าจอภาษาไทยแล้วไปต่อไม่ถูก
 */
export default function LanguagePicker() {
  const { lang, setLang, langAsked, confirmLang, themeVars } = useApp();

  if (langAsked) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Choose your language"
      style={{
        ...themeVars,
        position: 'fixed',
        inset: 0,
        zIndex: 200,
        background: 'rgba(18,18,20,.62)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        fontFamily: "'IBM Plex Sans Thai', sans-serif",
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          color: 'var(--text)',
          borderRadius: '22px',
          padding: '30px 26px 26px',
          width: 'min(420px, 100%)',
          boxShadow: '0 24px 60px rgba(0,0,0,.32)',
        }}
      >
        <h2 style={{ margin: '0 0 4px', fontSize: '20px', fontWeight: 700, textAlign: 'center' }}>
          เลือกภาษา
        </h2>
        <div
          style={{
            fontSize: '14.5px', color: 'var(--muted)',
            textAlign: 'center', marginBottom: '22px', lineHeight: 1.5,
          }}
        >
          Choose your language · 选择语言
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '11px' }}>
          {LANG_LIST.map((l) => {
            const Flag = FLAGS[l.code];
            const active = lang === l.code;
            return (
              <button
                key={l.code}
                type="button"
                onClick={() => confirmLang(l.code)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '15px',
                  width: '100%',
                  minHeight: '64px',
                  padding: '0 18px',
                  borderRadius: '14px',
                  border: `2px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                  background: 'var(--surface)',
                  color: 'var(--text)',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <Flag size={40} />
                <span style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.3 }}>
                  <span style={{ fontSize: '18px', fontWeight: 700 }}>{l.name}</span>
                  <span style={{ fontSize: '13px', color: 'var(--muted)' }}>{l.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
