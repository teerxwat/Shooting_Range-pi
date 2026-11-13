import { useEffect, useState } from 'react';

/** true เมื่อ media query ตรง เช่น useMedia('(max-width: 900px)') — อัปเดตเองตอนหมุนจอ/ย่อหน้าต่าง */
export function useMedia(query) {
  const [match, setMatch] = useState(
    () => typeof window !== 'undefined' && window.matchMedia(query).matches
  );

  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = (e) => setMatch(e.matches);
    setMatch(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [query]);

  return match;
}

/** true เมื่อจอแคบกว่าที่กำหนด — ใช้สลับ layout ระหว่างมือถือกับจอใหญ่ */
export const useIsMobile = (maxWidth = 560) => useMedia(`(max-width: ${maxWidth}px)`);

/** true เมื่อจอเตี้ย (มือถือแนวนอน) */
export const useIsShort = (maxHeight = 500) => useMedia(`(max-height: ${maxHeight}px)`);
