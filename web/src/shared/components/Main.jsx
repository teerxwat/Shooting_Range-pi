// Shared <main> wrapper — Live View ใช้ fixed (ไม่มี page scroll), หน้าอื่น scroll ได้
export default function Main({ fixed = false, children }) {
  const base = {
    flex: 1,
    width: '100%',
    maxWidth: '1440px',
    margin: '0 auto',
    padding: 'clamp(16px, 4vw, 28px)',   // มือถือขอบบางลง จอใหญ่ขอบกว้างเท่าเดิม
    boxSizing: 'border-box'
  };
  const style = fixed
    ? { ...base, minHeight: 0, height: '100%', overflow: 'hidden', display: 'flex', flexDirection: 'column' }
    : { ...base, overflowY: 'auto' };

  return <main style={style}>{children}</main>;
}
