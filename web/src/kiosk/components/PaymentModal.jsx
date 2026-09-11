import { useEffect, useRef, useState } from 'react';
import { useApp } from '@/shared/AppContext';
import QRCanvas from '@/shared/components/QRCanvas';
import { qrUrl } from '@/kiosk/api';

/*
 * Payment flow (3 ขั้น):
 *   qr      → แสดง QR จ่ายเงิน (mock PromptPay — INTEGRATION POINT: แทนด้วย payment gateway API)
 *   verify  → loading ตรวจสอบการชำระเงิน (mock 2.2s) + รอไฟล์ render เสร็จไปพร้อมกัน
 *   success → QR ดาวน์โหลดวิดีโอ (สแกนด้วยมือถือเท่านั้น — แท็บเล็ตไม่เปิดไฟล์เอง)
 *
 * prepareFile: async () => ({url, name}) — ถูกเรียกทันทีที่เปิด modal
 *              เพื่อให้ render slow-mo/ฟิลเตอร์วิ่งไประหว่างลูกค้าจ่ายเงิน
 */
export default function PaymentModal({ open, refCode, priceLabel, prepareFile, onClose, onFinish }) {
  const { t } = useApp();
  const [step, setStep] = useState('qr');
  const [file, setFile] = useState(null);
  const filePromise = useRef(null);
  const verifyT = useRef(null);

  useEffect(() => {
    if (open) {
      setStep('qr');
      setFile(null);
      // เริ่ม render ทันที — ทำงานเบื้องหลังระหว่างลูกค้าสแกนจ่าย
      filePromise.current = prepareFile();
      filePromise.current.catch(() => {});
    }
    return () => clearTimeout(verifyT.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const confirmPaid = async () => {
    setStep('verify');
    try {
      // รอทั้ง mock ตรวจการชำระเงิน (2.2s) และไฟล์ render เสร็จ
      const [f] = await Promise.all([
        filePromise.current,
        new Promise((r) => (verifyT.current = setTimeout(r, 2200)))
      ]);
      setFile(f);
      setStep('success');
    } catch (e) {
      alert(e.message || 'render failed');
      onClose();
    }
  };

  const primaryBtn = {
    marginTop: '18px',
    width: '100%',
    minHeight: '54px',
    borderRadius: '12px',
    border: 'none',
    background: 'var(--accent)',
    color: '#fff',
    fontFamily: 'inherit',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer'
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(18,18,20,.55)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '20px',
        zIndex: 50
      }}
    >
      <div
        style={{
          background: 'var(--surface)',
          color: 'var(--text)',
          borderRadius: '20px',
          padding: '34px 34px 28px',
          width: 'min(440px, 100%)',
          textAlign: 'center',
          boxShadow: '0 24px 60px rgba(0,0,0,.3)'
        }}
      >
        {step === 'qr' && (
          <>
            <h2 style={{ margin: '0 0 6px', fontSize: '21px', fontWeight: 700 }}>{t.scanPay}</h2>
            <div style={{ fontSize: '15px', color: 'var(--muted)', marginBottom: '18px' }}>
              {t.amount}: <b style={{ color: 'var(--text)' }}>{priceLabel}</b>
            </div>
            {/* INTEGRATION POINT: แทน QR mock ด้วย QR จริงจาก payment gateway API */}
            <QRCanvas seed={42} />
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: '12.5px',
                color: 'var(--muted)',
                marginTop: '10px'
              }}
            >
              PromptPay · {refCode}
            </div>
            <button onClick={confirmPaid} style={primaryBtn}>
              {t.paidDemo}
            </button>
            <button
              onClick={onClose}
              style={{
                marginTop: '10px',
                width: '100%',
                minHeight: '46px',
                borderRadius: '12px',
                border: '1px solid var(--border)',
                background: 'transparent',
                color: 'var(--muted)',
                fontFamily: 'inherit',
                fontSize: '15px',
                cursor: 'pointer'
              }}
            >
              {t.cancel}
            </button>
          </>
        )}

        {step === 'verify' && (
          <>
            <div
              style={{
                width: '56px',
                height: '56px',
                margin: '14px auto 20px',
                border: '4px solid var(--border)',
                borderTopColor: 'var(--accent)',
                borderRadius: '50%',
                animation: 'spin .9s linear infinite'
              }}
            />
            <h2 style={{ margin: '0 0 6px', fontSize: '20px', fontWeight: 700 }}>{t.verifying}</h2>
            <div style={{ fontSize: '14.5px', color: 'var(--muted)' }}>{t.verifyHint}</div>
          </>
        )}

        {step === 'success' && file && (
          <>
            <div
              style={{
                width: '58px',
                height: '58px',
                margin: '6px auto 14px',
                borderRadius: '50%',
                background: 'var(--okbg)',
                color: 'var(--ok)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '26px',
                fontWeight: 700
              }}
            >
              ✓
            </div>
            <h2 style={{ margin: '0 0 4px', fontSize: '21px', fontWeight: 700 }}>{t.paySuccess}</h2>
            <div style={{ fontSize: '15px', color: 'var(--muted)', marginBottom: '18px' }}>{t.scanDownload}</div>
            <div
              style={{
                display: 'inline-block',
                background: '#fff',
                border: '1px solid var(--border)',
                borderRadius: '14px',
                padding: '14px'
              }}
            >
              <img src={qrUrl(file.url)} alt="download qr" width="220" height="220" style={{ display: 'block' }} />
            </div>
            <div
              style={{
                fontFamily: "'IBM Plex Mono', monospace",
                fontSize: '12.5px',
                color: 'var(--muted)',
                marginTop: '10px',
                wordBreak: 'break-all'
              }}
            >
              {file.name}
            </div>
            {/* ไม่มีปุ่มโหลดบนแท็บเล็ต — ให้สแกน QR ด้วยมือถือเท่านั้น */}
            <button onClick={onFinish} style={primaryBtn}>
              {t.finish}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
