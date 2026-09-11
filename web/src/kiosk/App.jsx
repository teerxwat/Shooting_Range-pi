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

  return (
    <div
      style={{
        ...themeVars,
        height: '100vh',
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
