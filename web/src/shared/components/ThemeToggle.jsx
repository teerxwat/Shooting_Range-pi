import { useApp } from '@/shared/AppContext';
import { useIsMobile } from '@/shared/hooks/useMedia';
import { SunIcon, MoonIcon } from '@/shared/components/icons';

/*
 * จอใหญ่ → ไอคอน + ข้อความ
 * มือถือ → ไอคอนล้วน ปุ่มจัตุรัส 40px (ขนาดที่นิ้วกดไม่พลาด)
 */
export default function ThemeToggle() {
  const { theme, toggleTheme, t } = useApp();
  const isMobile = useIsMobile();
  const label = theme === 'light' ? t.dark : t.light;

  return (
    <button
      onClick={toggleTheme}
      aria-label={label}
      title={label}
      style={{
        height: '40px',
        width: isMobile ? '40px' : 'auto',
        padding: isMobile ? 0 : '0 14px',
        borderRadius: '10px',
        border: '1px solid var(--border)',
        background: 'var(--surface2)',
        color: 'var(--text)',
        fontFamily: 'inherit',
        fontSize: '14px',
        fontWeight: 500,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '8px'
      }}
    >
      {theme === 'light' ? <MoonIcon size={19} /> : <SunIcon size={19} />}
      {!isMobile && label}
    </button>
  );
}
