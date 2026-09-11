import { Routes, Route, Navigate } from 'react-router-dom';
import { useApp } from '@/shared/AppContext';
import Header from '@/shared/components/Header';
import Lookup from './pages/Lookup';
import Videos from './pages/Videos';
import Studio from './pages/Studio';
import { getToken } from './api';

/** ต้อง lookup (เซสชัน+PIN) ก่อนถึงเข้าหน้าอื่นได้ */
function Guard({ children }) {
  return getToken() ? children : <Navigate to="/" replace />;
}

/** แอปหน้าดาวน์โหลดของลูกค้า — เสิร์ฟจาก cloud (มือถือ/ที่บ้าน) */
export default function CustomerApp() {
  const { themeVars } = useApp();

  return (
    <div
      style={{
        ...themeVars,
        minHeight: '100vh',
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
        <Route path="/" element={<Lookup />} />
        <Route path="/videos" element={<Guard><Videos /></Guard>} />
        <Route path="/videos/:videoId" element={<Guard><Studio /></Guard>} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </div>
  );
}
