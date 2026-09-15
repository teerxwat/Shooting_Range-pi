import { useEffect, useState } from 'react';
import { useApp } from '@/shared/AppContext';
import { getStaff, endSession } from '@/kiosk/api';

/*
 * popup "จบการใช้งาน" กลางจอ — เลือกผู้ดูแลของเซสชันนี้ (ใช้คิดค่าคอมมิชชั่นบนระบบหลัก)
 *   ย้อนกลับ = ปิด popup กลับไปใช้งานต่อ (ยังไม่จบเซสชัน ไม่เรียก API)
 *   ข้าม     = จบเซสชันโดยไม่ระบุผู้ดูแล      → POST /end { action: 'skip' }
 *   ยืนยัน   = จบเซสชัน + ส่งผู้ดูแลที่เลือก   → POST /end { action: 'confirm', staff_id }
 * สเปก API/payload ทั้งหมด: server/STAFF_COMMISSION_API.md
 */
export default function EndSessionModal({ open, laneId, sessionCode, onClose, onEnded }) {
  const { t } = useApp();
  const [staff, setStaff] = useState(null); // null = กำลังโหลดรายชื่อ
  const [staffId, setStaffId] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setStaff(null);
    setStaffId('');
    setErr('');
    setBusy(false);
    getStaff()
      .then((r) => alive && setStaff(r.staff || []))
      .catch(() => alive && setStaff([]));
    return () => {
      alive = false;
    };
  }, [open]);

  if (!open) return null;

  const submit = async (action) => {
    setBusy(true);
    setErr('');
    try {
      await endSession(laneId, action === 'confirm' ? { action, staff_id: staffId } : { action });
      onEnded();
    } catch (e) {
      setErr(e.message);
      setBusy(false);
    }
  };

  const loading = staff === null;
  const empty = !loading && staff.length === 0;

  const btn = {
    minHeight: '58px',
    borderRadius: '12px',
    fontFamily: 'inherit',
    fontSize: '17px',
    fontWeight: 700,
    cursor: 'pointer',
    border: '1px solid var(--border)',
    background: 'var(--surface)',
    color: 'var(--text)'
  };
  const canConfirm = !busy && !!staffId;

  return (
    <div
      role="dialog"
      aria-modal="true"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 70,
        background: 'rgba(0,0,0,.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px'
      }}
    >
      <div
        style={{
          background: 'var(--bg)',
          color: 'var(--text)',
          borderRadius: '20px',
          padding: '30px 32px',
          width: 'min(480px, 100%)',
          border: '1px solid var(--border)',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ fontSize: '25px', fontWeight: 800, textAlign: 'center' }}>{t.endSession}</div>
        {sessionCode && (
          <div
            style={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '15px',
              color: 'var(--muted)',
              textAlign: 'center',
              marginTop: '4px'
            }}
          >
            {t.session}: {sessionCode}
          </div>
        )}
        <div style={{ fontSize: '15.5px', color: 'var(--muted)', marginTop: '12px', lineHeight: 1.55, textAlign: 'center' }}>
          {t.endHelp}
        </div>

        <label style={{ display: 'block', fontSize: '14px', fontWeight: 600, margin: '22px 0 8px' }}>
          {t.staffLabel}
        </label>
        <select
          value={staffId}
          onChange={(e) => setStaffId(e.target.value)}
          disabled={busy || loading || empty}
          style={{
            width: '100%',
            minHeight: '60px',
            padding: '0 14px',
            borderRadius: '12px',
            border: `2px solid ${staffId ? 'var(--accent)' : 'var(--border)'}`,
            background: 'var(--surface)',
            color: 'var(--text)',
            fontFamily: 'inherit',
            fontSize: '18px'
          }}
        >
          <option value="">{loading ? t.staffLoading : t.staffPlaceholder}</option>
          {(staff || []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <div style={{ minHeight: '22px', marginTop: '10px', fontSize: '14.5px', color: err ? '#ef4444' : 'var(--muted)' }}>
          {err || (empty ? t.staffEmpty : busy ? t.endingSession : '')}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '10px', marginTop: '14px' }}>
          <button style={btn} disabled={busy} onClick={onClose}>
            {t.back}
          </button>
          <button style={btn} disabled={busy} onClick={() => submit('skip')}>
            {t.skip}
          </button>
          <button
            style={{
              ...btn,
              border: canConfirm ? '1px solid var(--accent)' : '1px solid var(--border)',
              background: canConfirm ? 'var(--accent)' : 'var(--surface)',
              color: canConfirm ? '#fff' : 'var(--muted)',
              cursor: canConfirm ? 'pointer' : 'default'
            }}
            disabled={!canConfirm}
            onClick={() => submit('confirm')}
          >
            {t.confirm}
          </button>
        </div>
      </div>
    </div>
  );
}
