/*
 * เรียก ffmpeg ผ่าน child_process (ต้องมี ffmpeg ในเครื่อง: brew install ffmpeg)
 *   makePreview  — 720p + ลายน้ำกลางจอ ให้ลูกค้าดูฟรี
 *   renderOrder  — ไฟล์ขายจริง: อบฟิลเตอร์ + slow-mo ถาวร ไม่มีลายน้ำ
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { config } from './config.js';

// หา font สำหรับ drawtext (mac / linux)
const FONT_CANDIDATES = [
  '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
  '/System/Library/Fonts/Helvetica.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf',
];
const FONT = FONT_CANDIDATES.find((f) => fs.existsSync(f));

// ฟิลเตอร์ 3 แบบ — ต้องตรงกับปุ่มบนหน้าเว็บ
const LETTERBOX =
  'drawbox=x=0:y=0:w=iw:h=ih*0.12:color=black:t=fill,' +
  'drawbox=x=0:y=ih-ih*0.12:w=iw:h=ih*0.12:color=black:t=fill';

export const FILTERS = {
  original: null,
  cinema: `eq=contrast=1.18:saturation=1.18:brightness=-0.02,vignette=PI/4.5,${LETTERBOX}`,
  mono: `hue=s=0,eq=contrast=1.28:brightness=-0.02,vignette=PI/4.5,${LETTERBOX}`,
};

function run(args) {
  return new Promise((resolve, reject) => {
    const p = spawn(config.ffmpeg, args);
    let err = '';
    p.stderr.on('data', (d) => (err += d));
    p.on('error', (e) =>
      reject(new Error(`เรียก ffmpeg ไม่ได้ (${e.message}) — ติดตั้งด้วย: brew install ffmpeg`))
    );
    p.on('close', (code) =>
      code === 0 ? resolve() : reject(new Error(err.slice(-400)))
    );
  });
}

export function makePreview(master, out, label) {
  const text = `${config.watermark}  ·  ${label}`.replace(/['\\:]/g, '');
  const font = FONT ? `fontfile=${FONT.replace(/ /g, '\\ ')}:` : '';
  const draw =
    `drawtext=${font}text='${text}':fontsize=h/14:fontcolor=white@0.35:` +
    `borderw=2:bordercolor=black@0.25:x=(w-text_w)/2:y=(h-text_h)/2`;
  return run([
    '-y', '-i', master,
    '-vf', `scale=-2:720,${draw}`,
    '-r', '30', '-an',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26',
    '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out,
  ]);
}

export function renderOrder(master, out, filter, speed) {
  const vf = [];
  if (speed < 0.999) vf.push(`setpts=${(1 / speed).toFixed(4)}*PTS`);
  if (FILTERS[filter]) vf.push(FILTERS[filter]);
  const args = ['-y', '-i', master];
  if (vf.length) args.push('-vf', vf.join(','));
  args.push('-r', '30', '-an', '-c:v', 'libx264', '-preset', 'veryfast',
    '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', out);
  return run(args);
}
