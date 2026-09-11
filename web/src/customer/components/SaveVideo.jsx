import { useState } from 'react';
import { useApp } from '@/shared/AppContext';
import { DownloadIcon } from '@/shared/components/icons';
import { fullUrl } from '../api';

/*
 * ปุ่มบันทึกวิดีโอ
 *
 * เว็บเขียนไฟล์ลงคลังภาพของมือถือโดยตรงไม่ได้ (ไม่มี API ให้ทำ — เป็นข้อจำกัดด้านความปลอดภัย)
 * ทางที่ใกล้เคียงที่สุดคือ Web Share API: โหลดไฟล์มาแล้วเรียกแผงแชร์ของระบบ
 * ผู้ใช้กด "บันทึกวิดีโอ" ในแผงนั้น → ไฟล์เข้าคลังภาพจริง (iOS 15+ / Android Chrome)
 *
 * เครื่องที่ไม่รองรับ → ดาวน์โหลดลงโฟลเดอร์ตามปกติ
 */
export default function SaveVideo({ url, filename, style, children }) {
  const { t } = useApp();
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState('');

  const canShare = typeof navigator !== 'undefined' && !!navigator.canShare;

  const plainDownload = () => {
    const a = document.createElement('a');
    a.href = fullUrl(url);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  };

  const save = async () => {
    if (busy) return;

    if (!canShare) return plainDownload();

    setBusy(true);
    setHint('');
    try {
      const res = await fetch(fullUrl(url));
      if (!res.ok) throw new Error('fetch failed');
      const blob = await res.blob();
      const file = new File([blob], filename, { type: blob.type || 'video/mp4' });

      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file] });   // ผู้ใช้เลือก "บันทึกวิดีโอ" เอง
        setHint(t.savedHint);
      } else {
        plainDownload();
      }
    } catch (e) {
      // ผู้ใช้กดยกเลิกแผงแชร์ = ไม่ใช่ error จริง ไม่ต้องรบกวน
      if (e?.name !== 'AbortError') plainDownload();
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={save}
        disabled={busy}
        style={{
          width: '100%',
          minHeight: '54px',
          borderRadius: '12px',
          border: 'none',
          background: 'var(--accent)',
          color: '#fff',
          fontFamily: 'inherit',
          fontSize: '16px',
          fontWeight: 600,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '9px',
          boxSizing: 'border-box',
          ...style,
        }}
      >
        <DownloadIcon size={19} />
        {busy ? t.preparingFile : children || t.saveVideo}
      </button>

      {hint && (
        <div style={{ fontSize: '13px', color: 'var(--muted)', marginTop: '8px', lineHeight: 1.5 }}>
          {hint}
        </div>
      )}
    </>
  );
}
