import { useState, useEffect } from 'react';

export function useClock(lang) {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  const locale = lang === 'th' ? 'th-TH' : lang === 'zh' ? 'zh-CN' : 'en-GB';
  return now.toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
