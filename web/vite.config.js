import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/*
 * โค้ดชุดเดียว build ได้ 2 แอป:
 *   npm run build:kiosk     → dist/kiosk     (เสิร์ฟจาก Mac ที่สนาม — คุย API ใน LAN)
 *   npm run build:customer  → dist/customer  (เสิร์ฟจาก cloud — หน้าดาวน์โหลดของลูกค้า)
 * โหมด dev:  npm run dev  (kiosk)  |  VITE_APP=customer npm run dev
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const app = mode === 'customer' ? 'customer' : env.VITE_APP || 'kiosk';

  return {
    plugins: [react()],
    define: { __APP__: JSON.stringify(app) },
    resolve: { alias: { '@': path.resolve(process.cwd(), 'src') } },
    server: {
      host: true,
      // customer: พอร์ต 5174 + ส่ง /api ไปที่ server (Node) ที่ 8080 ให้อัตโนมัติ
      // kiosk:    พอร์ต 5173 + คุยกับ server.py ที่ :8000 ตรงๆ (ดู src/kiosk/api.js)
      port: app === 'customer' ? 5174 : 5173,
      proxy:
        app === 'customer'
          ? { '/api': env.VITE_API_URL || 'http://localhost:8080' }
          : undefined,
    },
  };
});
