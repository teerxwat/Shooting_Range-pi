import { createContext, useContext, useState, useEffect } from 'react';
import { I18N } from '@/shared/i18n/translations';
import { THEMES } from '@/shared/theme/themes';
import LanguagePicker from '@/shared/components/LanguagePicker';

// Global state เหลือแค่ ภาษา + ธีม
// สถานะช่อง/กล้อง/session ทั้งหมดมาจาก backend (src/api.js) แล้ว
const AppContext = createContext(null);

export function AppProvider({ children }) {
  const [lang, setLang] = useState(() => localStorage.getItem('lang') || 'th');
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'light');

  /*
   * ต่างจาก 'lang' ตรงที่ค่านี้บอกว่า "ผู้ใช้เลือกเองแล้วหรือยัง"
   * ถ้าดูแค่ 'lang' จะแยกไม่ออกระหว่างค่าเริ่มต้น th กับคนที่ตั้งใจเลือกไทย
   * ป๊อปอัปเลยจะเด้งซ้ำทุกครั้งที่เลือกไทย
   */
  const [langAsked, setLangAsked] = useState(() => !!localStorage.getItem('lang.asked'));

  useEffect(() => localStorage.setItem('lang', lang), [lang]);
  useEffect(() => localStorage.setItem('theme', theme), [theme]);

  const confirmLang = (code) => {
    setLang(code);
    setLangAsked(true);
    localStorage.setItem('lang.asked', '1');
  };

  const value = {
    lang,
    setLang,
    langAsked,
    confirmLang,
    theme,
    toggleTheme: () => setTheme((t) => (t === 'light' ? 'dark' : 'light')),
    t: I18N[lang],
    themeVars: THEMES[theme]
  };

  return (
    <AppContext.Provider value={value}>
      {children}
      <LanguagePicker />
    </AppContext.Provider>
  );
}

export const useApp = () => useContext(AppContext);
