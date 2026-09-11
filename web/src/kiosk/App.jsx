import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useApp } from '@/shared/AppContext';
import Header from '@/shared/components/Header';
import LaneSelect from './pages/LaneSelect';
import LiveView from './pages/LiveView';
import ReplayList from './pages/ReplayList';
import Playback from './pages/Playback';

/** แอปหน้าจอที่สนามยิงปืน — คุยกับ server.py ใน LAN (ทำงานได้แม้เน็ตล่ม) */
export default function KioskApp() {
  const { themeVars } = useApp();

  // กัน scrollbar ที่ระดับหน้าเบราว์เซอร์เด็ดขาด — ตัว div ข้างล่างกะขนาดให้พอดี
  // จออยู่แล้ว (100dvh + overflow hidden) แต่ถ้ามีปัดเศษพลาดไปสัก 1px (ฟอนต์โหลดช้า,
  // ความต่างเล็กน้อยระหว่าง browser) จะได้ไม่โผล่เป็น scrollbar ให้เห็นที่ html/body เอง
  // ทำเฉพาะฝั่ง kiosk เท่านั้น (ไม่กระทบหน้าเว็บลูกค้าที่ต้อง scroll ยาวได้ปกติ)
  useEffect(() => {
    const { style: htmlStyle } = document.documentElement;
    const { style: bodyStyle } = document.body;
    const prevHtml = htmlStyle.overflow;
    const prevBody = bodyStyle.overflow;
    htmlStyle.overflow = 'hidden';
    bodyStyle.overflow = 'hidden';
    return () => {
      htmlStyle.overflow = prevHtml;
      bodyStyle.overflow = prevBody;
    };
  }, []);

  return (
    <div
      style={{
        ...themeVars,
        // dvh แทน vh — กัน scrollbar เกินโดยไม่มีอะไรให้เลื่อนตอนเปิดผ่านเบราว์เซอร์ปกติ
        // (มีแถบ URL/toolbar กินพื้นที่) ไม่ใช่ Chromium --kiosk เต็มจอแบบเดิม ซึ่ง vh กับพื้นที่จริง
        // ไม่เท่ากันพอดีอีกต่อไป — dvh คำนวณจากพื้นที่ที่เห็นจริงเสมอ
        height: '100dvh',
        overflow: 'hidden',
        background: 'var(--bg)',
        color: 'var(--text)',
        fontFamily: "'IBM Plex Sans Thai', sans-serif",
        display: 'flex',
        flexDirection: 'column',
        transition: 'background .25s, color .25s'
      }}
    >
      <Header />
      <Routes>
        <Route path="/" element={<LaneSelect />} />
        <Route path="/lane/:id" element={<LiveView />} />
        <Route path="/lane/:id/clips" element={<ReplayList />} />
        <Route path="/lane/:id/clips/:clipId" element={<Playback />} />
      </Routes>
    </div>
  );
}
