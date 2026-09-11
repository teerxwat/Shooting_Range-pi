import { useEffect } from 'react';
import { occupyLane } from './api';

// จองช่องขณะอยู่บนหน้าของช่องนั้น (live / replay / playback)
// ส่ง heartbeat ทุก 5 วิ — ปิดเบราว์เซอร์/ออกจากหน้า → backend ปลดจองเองใน 15 วิ
export function useOccupy(laneId) {
  useEffect(() => {
    if (!laneId) return;
    const ping = () => occupyLane(laneId).catch(() => {});
    ping();
    const timer = setInterval(ping, 5000);
    return () => clearInterval(timer);
  }, [laneId]);
}
