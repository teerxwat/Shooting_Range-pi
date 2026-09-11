// จุดเชื่อมต่อ backend (Gopro-connect/server.py)
// default: host เดียวกับหน้าเว็บ พอร์ต 8000 — override ได้ด้วย VITE_API_URL
export const API_BASE =
  import.meta.env.VITE_API_URL || `http://${window.location.hostname}:8000`;

async function req(path, options) {
  const r = await fetch(`${API_BASE}${path}`, options);
  if (!r.ok) {
    let detail = r.statusText;
    try {
      detail = (await r.json()).detail || detail;
    } catch { /* ignore */ }
    throw new Error(detail);
  }
  return r.json();
}

// true = ปุ่มหลัก "ข้าม AI" ทำงานเดี่ยว (ไม่มีปุ่มรอง AI detect ให้เลือก)
// false = โชว์ทั้ง 2 ปุ่ม (ข้าม AI เป็นปุ่มหลัก + ตรวจจับ AI เป็นปุ่มรอง)
// override ได้ด้วย VITE_SKIP_AI_ONLY=true ตอน build (ไม่ต้องแก้โค้ด)
export const SKIP_AI_ONLY = import.meta.env.VITE_SKIP_AI_ONLY === 'true';

export const getChannels = () => req('/api/channels');
export const getStatus = (ch) => req(`/api/channels/${ch}/status`);
export const getClips = (ch) => req(`/api/channels/${ch}/clips`);
// skipDetect: true → ข้ามตรวจจับท่าด้วย AI, เข้า countdown ทันที (ปุ่ม "เริ่มบันทึกทันที")
export const startProcess = (ch, { skipDetect = false } = {}) =>
  req(`/api/channels/${ch}/process`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ skipDetect })
  });
export const cancelProcess = (ch) => req(`/api/channels/${ch}/cancel`, { method: 'POST' });
export const startPreview = (ch) => req(`/api/channels/${ch}/preview/start`, { method: 'POST' });
export const stopPreview = (ch) => req(`/api/channels/${ch}/preview/stop`, { method: 'POST' });
export const occupyLane = (ch) => req(`/api/channels/${ch}/occupy`, { method: 'POST' });

// ลูกค้าตั้ง PIN 4 หลักก่อนเริ่มใช้เลน → ระบบลงทะเบียนเซสชันบนคลาวด์ให้ทันที
export const setLanePin = (ch, pin) =>
  req(`/api/channels/${ch}/pin`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pin })
  });

// มีคลิปค้างคิวรออัปขึ้นคลาวด์กี่ชิ้น
export const getUploadStatus = () => req('/api/upload/status');

// render slow-mo + filter ลงไฟล์จริง (ffmpeg ฝั่ง server)
export const renderVideo = (payload) =>
  req('/api/render', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
export const renderStatus = (name) => req(`/api/render/status?name=${encodeURIComponent(name)}`);

export const streamUrl = (ch) => `${API_BASE}/api/channels/${ch}/stream`;
export const videoUrl = (path) => `${API_BASE}${path}`;
export const qrUrl = (data) => `${API_BASE}/api/qr?data=${encodeURIComponent(data)}`;

export const BUSY_STATES = ['PREPARING', 'DETECTING', 'COUNTDOWN', 'RECORDING', 'DOWNLOADING'];
