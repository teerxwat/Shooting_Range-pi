import { useEffect, useState } from 'react';

/** true เมื่อจอแคบกว่าที่กำหนด — ใช้สลับ layout ระหว่างมือถือกับจอใหญ่ */
export function useIsMobile(maxWidth = 560) {
  const query = `(max-width: ${maxWidth}px)`;
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
