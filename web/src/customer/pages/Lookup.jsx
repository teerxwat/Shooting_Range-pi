import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useApp } from '@/shared/AppContext';
import Main from '@/shared/components/Main';
import { PrimaryButton, Spinner } from '@/shared/components/buttons';
import { BackspaceIcon, ArrowLeftIcon, ArrowRightIcon } from '@/shared/components/icons';
import { lookup, saveAuth, saveVideos, getRecentSessions, rememberSession, forgetSession } from '../api';

/*
 * หน้าแรกของลูกค้า — ออกแบบสำหรับมือถือเป็นหลัก
 *   ขั้น 1  กรอกเลขเซสชันอย่างเดียว (สแกน QR จากจอที่สนามจะข้ามมาขั้น 2 ให้เลย)
 *   ขั้น 2  แป้นกด PIN ปุ่มกลม กดง่ายด้วยนิ้วโป้งข้างเดียว
 */
export default function Lookup() {
  const { t } = useApp();
  const navigate = useNavigate();
  const [params] = useSearchParams();

  /*
   * ลูกค้าไม่ต้องจำเลขเซสชัน — มาจาก 2 ทาง
   *   1. สแกน QR จากจอที่สนาม  → ?s=S1-0036
   *   2. เคยเข้าเว็บนี้มาแล้ว    → จำไว้ใน localStorage
   * ทั้งสองทางยังต้องกด PIN ยืนยันเสมอ
   */
  const fromQr = (params.get('s') || '').toUpperCase();
  const [recent, setRecent] = useState(getRecentSessions);

  /*
   * ข้ามไปหน้า PIN ให้เฉพาะตอนสแกน QR เท่านั้น เพราะเลขเซสชันมากับลิงก์แน่นอนแล้ว
   * เซสชันที่จำไว้จะโผล่เป็นปุ่มลัดในขั้น 1 ให้กดเลือกเอง — ไม่ลากไปหน้า PIN เอง
   * ไม่งั้นคนที่เข้ามาเพื่อกรอกเลขใหม่จะงงว่าทำไมโดนถาม PIN ของเซสชันเก่า
   */
  const [step, setStep] = useState(fromQr ? 2 : 1);
  const [code, setCode] = useState(fromQr);
  const [pin, setPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const PIN_LEN = 4;
  const full = pin.length === PIN_LEN;

  const goPin = (e) => {
    e?.preventDefault();
    if (!code.trim()) return;
    setErr('');
    setPin('');
    setStep(2);
  };

  const submit = async (value) => {
    setErr('');
    setBusy(true);
    try {
      const res = await lookup(code.trim().toUpperCase(), value);
      saveAuth(res.token, res.code, res.expires_at);
      rememberSession(res.code, res.expires_at);   // ครั้งหน้าไม่ต้องกรอกเลขอีก
      saveVideos(res);
      navigate('/videos');
    } catch (e) {
      setErr(e.message);
      setPin('');
    } finally {
      setBusy(false);
    }
  };

  const press = (d) => {
    if (busy || pin.length >= PIN_LEN) return;
    setErr('');
    setPin(pin + d);
  };

  const backspace = () => {
    if (busy) return;
    setErr('');
    setPin((p) => p.slice(0, -1));
  };

  // รับจากคีย์บอร์ดจริงได้ด้วย แต่**เฉพาะตัวเลข** — ตัวอักษรอื่นไม่มีผล
  useEffect(() => {
    if (step !== 2) return;
    const onKey = (e) => {
      if (e.key >= '0' && e.key <= '9') { e.preventDefault(); press(e.key); }
      else if (e.key === 'Backspace') { e.preventDefault(); backspace(); }
      else if (e.key === 'Enter' && full) { e.preventDefault(); submit(pin); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── สไตล์ ────────────────────────────────────────────
  const field = {
    width: '100%', minHeight: '58px', padding: '0 18px',
    borderRadius: '14px', border: '1px solid var(--border)',
    background: 'var(--surface)', color: 'var(--text)',
    fontFamily: "'IBM Plex Mono', monospace",
    fontSize: '18px',          // ≥16px กัน iOS ซูมอัตโนมัติตอนโฟกัส
    letterSpacing: '1px', boxSizing: 'border-box',
  };

  /** ปุ่มบน keypad — สี่เหลี่ยมมุมมน สูงเท่ากันทุกปุ่ม */
  const key = (soft = false) => ({
    height: 'clamp(52px, 13vw, 62px)',
    width: '100%',
    borderRadius: '12px',
    border: 'none',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: busy ? 'default' : 'pointer',
    fontFamily: 'inherit',
    fontSize: 'clamp(21px, 5.5vw, 24px)',
    fontWeight: 500,
    color: soft ? 'var(--muted)' : 'var(--text)',
    background: soft ? 'transparent' : 'var(--surface)',
    boxShadow: soft ? 'none' : '0 1px 2px rgba(0,0,0,.07)',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',
    transition: 'transform .1s ease',
  });

  const errBox = err && (
    <div
      style={{
        padding: '11px 16px', borderRadius: '12px',
        background: 'var(--surface)', border: '1px solid var(--warn)',
        color: 'var(--warn)', fontSize: '14.5px', textAlign: 'center',
      }}
    >
      {err}
    </div>
  );

  // ── ขั้น 1: เลขเซสชัน ─────────────────────────────────
  if (step === 1) {
    return (
      <Main>
        <section style={{ maxWidth: '420px', margin: '4vh auto 0' }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 'clamp(23px, 6.5vw, 31px)', fontWeight: 700, lineHeight: 1.3 }}>
            {t.dlTitle}
          </h1>
          <p style={{ margin: '0 0 24px', fontSize: '15px', color: 'var(--muted)', lineHeight: 1.6 }}>
            {t.dlStep1}
          </p>

          {/* เซสชันที่เคยเข้ามาแล้ว — แตะแล้วข้ามไปกด PIN ได้เลย */}
          {recent.length > 0 && (
            <div style={{ marginBottom: '26px' }}>
              <div style={{ fontSize: '14px', fontWeight: 600, color: 'var(--muted)', marginBottom: '10px' }}>
                {t.recentSessions}
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '9px' }}>
                {recent.map((s) => (
                  <div key={s.code} style={{ display: 'flex', gap: '8px' }}>
                    <button
                      type="button"
                      onClick={() => { setCode(s.code); setErr(''); setPin(''); setStep(2); }}
                      style={{
                        flex: 1, minHeight: '56px', padding: '0 16px',
                        borderRadius: '13px', border: '1px solid var(--border)',
                        background: 'var(--surface)', color: 'var(--text)',
                        fontFamily: "'IBM Plex Mono', monospace", fontSize: '17px',
                        fontWeight: 600, cursor: 'pointer', textAlign: 'left',
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                      }}
                    >
                      {s.code}
                      <ArrowRightIcon size={17} />
                    </button>
                    <button
                      type="button"
                      aria-label={t.forget}
                      title={t.forget}
                      onClick={() => { forgetSession(s.code); setRecent(getRecentSessions()); }}
                      style={{
                        width: '48px', borderRadius: '13px',
                        border: '1px solid var(--border)', background: 'transparent',
                        color: 'var(--muted)', fontSize: '18px', cursor: 'pointer',
                      }}
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          <form onSubmit={goPin} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--muted)' }}>
                {recent.length > 0 ? t.orEnterCode : t.sessionCode}
              </span>
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="S1-0021"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck="false"
                autoFocus
                required
                style={field}
              />
            </label>

            {errBox}

            <PrimaryButton
              onClick={goPin}
              style={{ width: '100%', marginTop: '4px', gap: '8px', minHeight: '54px' }}
            >
              {t.next}
              <ArrowRightIcon size={18} />
            </PrimaryButton>
          </form>

          <p style={{ marginTop: '20px', fontSize: '13px', color: 'var(--muted)', lineHeight: 1.6 }}>
            {t.dlHint}
          </p>
        </section>
      </Main>
    );
  }

  // ── ขั้น 2: แป้นกด PIN ────────────────────────────────
  return (
    <Main>
      <section
        style={{
          width: '100%', maxWidth: '340px',
          margin: '3vh auto 0', textAlign: 'center',
        }}
      >
        <h1 style={{ margin: '0 0 6px', fontSize: 'clamp(20px, 5.5vw, 25px)', fontWeight: 700 }}>
          {t.pinVerify}
        </h1>
        <p style={{ margin: '0 0 22px', fontSize: '14.5px', color: 'var(--muted)' }}>
          {t.sessionCode}{' '}
          <b style={{ fontFamily: "'IBM Plex Mono', monospace", color: 'var(--text)' }}>{code}</b>
        </p>

        {/* ช่องแสดงตัวเลขที่กด */}
        <div
          style={{
            display: 'flex', justifyContent: 'center',
            gap: 'clamp(10px, 3vw, 14px)', marginBottom: '16px',
          }}
        >
          {Array.from({ length: PIN_LEN }).map((_, i) => {
            const active = i === pin.length && !busy;
            return (
              <div
                key={i}
                style={{
                  width: 'clamp(56px, 17vw, 68px)', height: 'clamp(62px, 19vw, 74px)',
                  borderRadius: '14px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 'clamp(24px, 7vw, 28px)', fontWeight: 600,
                  fontFamily: "'IBM Plex Mono', monospace",
                  background: 'var(--surface2)',
                  color: 'var(--text)',
                  border: `2px solid ${active ? 'var(--accent)' : 'transparent'}`,
                  transition: 'border-color .15s',
                }}
              >
                {pin[i] || ''}
              </div>
            );
          })}
        </div>

        <div style={{ minHeight: '32px', marginBottom: '10px' }}>
          {busy ? (
            <span style={{ color: 'var(--muted)', fontSize: '14.5px', display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <Spinner size={16} /> {t.checking}
            </span>
          ) : err ? (
            errBox
          ) : (
            <button
              type="button"
              onClick={() => { setStep(1); setErr(''); }}
              style={{
                border: 'none', background: 'transparent', color: 'var(--muted)',
                fontFamily: 'inherit', fontSize: '14.5px', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: '6px',
                WebkitTapHighlightColor: 'transparent',
              }}
            >
              <ArrowLeftIcon size={16} />
              {t.changeCode}
            </button>
          )}
        </div>

        {/* ปุ่มยืนยัน — อยู่เหนือแป้นตัวเลข */}
        <button
          type="button"
          disabled={busy || !full}
          onClick={() => submit(pin)}
          style={{
            width: '100%', minHeight: '54px', borderRadius: '13px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'inherit', fontSize: '17px', fontWeight: 600,
            cursor: full && !busy ? 'pointer' : 'default',
            background: full ? 'var(--accent)' : 'var(--surface2)',
            color: full ? '#fff' : 'var(--muted)',
            border: 'none',
            WebkitTapHighlightColor: 'transparent',
            transition: 'background .15s, color .15s',
          }}
        >
          {t.confirm}
        </button>

        {/* แป้นตัวเลข — กดได้เฉพาะตัวเลข ไม่มีคีย์บอร์ดระบบโผล่มากวน */}
        <div
          style={{
            marginTop: '22px',
            padding: 'clamp(10px, 3vw, 14px)',
            borderRadius: '16px',
            background: 'var(--surface2)',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 'clamp(8px, 2.5vw, 11px)',
          }}
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
            <button key={d} type="button" style={key()} disabled={busy} onClick={() => press(String(d))}>
              {d}
            </button>
          ))}

          <div />  {/* ช่องว่างซ้ายล่าง */}

          <button type="button" style={key()} disabled={busy} onClick={() => press('0')}>
            0
          </button>

          <button
            type="button"
            aria-label={t.delete}
            style={key(true)}
            disabled={busy || !pin}
            onClick={backspace}
          >
            <BackspaceIcon size={25} />
          </button>
        </div>
      </section>
    </Main>
  );
}
