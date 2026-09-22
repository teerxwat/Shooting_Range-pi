import { useEffect } from 'react';
import { occupyLane } from './api';

// จองช่องขณะอยู่บนหน้าของช่องนั้น (live / replay / playback) — ส่ง heartbeat ทุก 5 วิ
//
// จอแท็บเล็ตดับหรือสลับแอป = หน้าเว็บถูกซ่อน → เบราว์เซอร์บีบ setInterval เหลือ ~1 ครั้ง/นาที
// (background throttling) heartbeat จึงขาดช่วงโดยที่ลูกค้ายังอยู่ที่เลน
// จึงยิงทันทีตอนกลับมาเห็นจอ ไม่ต้องรอ tick ถัดไป — ฝั่ง backend มี VISIT_TTL รองอีกชั้น
export function useOccupy(laneId) {
  useEffect(() => {
    if (!laneId) return;
    const ping = () => occupyLane(laneId).catch(() => {});
    ping();
    const timer = setInterval(ping, 5000);
    const onVisible = () => {
      if (document.visibilityState === 'visible') ping();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [laneId]);
}
