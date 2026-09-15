"""
recorder.py — แบ่งเป็น 2 phase เพื่อให้ countdown เป็น 'final delay' เท่านั้น

Flow ที่ถูกต้อง:
  TRIGGER
    → prepare_cycle()   ← prime กล้อง + snapshot ก่อน countdown เริ่ม
    → countdown 10 วิ   ← กล้องพร้อมแล้ว แค่นับรอ
    → record_cycle()    ← START RECORD ทันทีที่ countdown ถึง 0
    → download
"""
import time

import config
import save
import display
from channel import run_parallel

SETTLE_AFTER_STOP   = 6.0   # รอกล้อง finalize ไฟล์ก่อนเริ่มหาไฟล์ใหม่
KEEPALIVE_EVERY     = 3     # ส่ง keep-alive ทุกกี่วินาทีระหว่าง record
PREP_SETTLE         = 1.0   # รอหลัง prime_stream + preset ให้ kick in
ENCODING_CHECK_WAIT = 2.0   # รอหลัง start_recording ก่อนตรวจ encoding state
ENCODING_RETRY_MAX  = 2     # จำนวนครั้ง retry ถ้า encoding ไม่ผ่าน


# ─── Helpers ─────────────────────────────────────────────────────────────────

def _prep_cam(cam, log=print):
    """
    เตรียมกล้องก่อน record:
      1. enable_wired_control
      2. prime_stream  ← start+stop stream สั้นๆ (activate HTTP API เหมือน cam1)
      3. enable_wired_control อีกรอบ
      4. load_preset
    """
    ok = cam.enable_wired_control()
    if not ok:
        log(f"  [!] {cam.name}: enable_wired_control FAILED")

    cam.prime_stream(log=log)
    cam.enable_wired_control()

    if config.PRESET_ID:
        pl = cam.load_preset(config.PRESET_ID)
        if not pl:
            log(f"  [!] {cam.name}: load_preset({config.PRESET_ID}) FAILED")

    # ตั้งความละเอียดก่อน fps (เช่น 4K/240 → 1080/240 เป็นคู่ที่ถูกต้องทุกขั้น)
    for setting_id, option, label in ((2, config.VIDEO_RES_CODE, "resolution"),
                                      (3, config.VIDEO_FPS_CODE, "fps")):
        if option is None:
            continue
        cam.wait_ready(timeout=4)
        if not cam.apply_setting(setting_id, option):
            log(f"  [!] {cam.name}: ตั้ง {label} (setting {setting_id}={option}) ไม่สำเร็จ "
                f"— กล้องอาจไม่รองรับ จะอัดตามค่าของ preset")

    # รอกล้องสลับ preset เสร็จ (busy=0) ก่อนถึงเวลากด shutter
    if not cam.wait_ready(timeout=6):
        log(f"  [!] {cam.name}: กล้องยัง busy หลังโหลด preset")


def _cam_state_summary(cam) -> dict:
    """อ่าน state กล้อง คืน dict สรุป"""
    state = cam.get_state(timeout=4, retries=1)
    if not state:
        return {}
    status   = state.get("status",   {})
    settings = state.get("settings", {})
    return {
        "encoding": bool(status.get("10", 0)),
        "mode":     settings.get("2"),
        "fps":      settings.get("3"),
        "battery":  status.get("70"),
    }


def _verify_encoding(cam, log=print):
    """ตรวจว่ากล้องกำลัง encode จริง (status.10=1) — คืน None ถ้าอ่าน state ไม่ได้"""
    summary = _cam_state_summary(cam)
    if not summary:
        log(f"  [!] {cam.name}: ไม่สามารถอ่าน state")
        return None
    enc = summary.get("encoding", False)
    log(f"  {cam.name}: state → encoding={enc}, "
        f"mode={summary.get('mode')}, batt={summary.get('battery')}")
    return enc


# ─── Phase 1: เตรียมกล้อง (ก่อน countdown) ──────────────────────────────────

def prepare_cycle(channel, log=print, ch_index: int = 0):
    """
    เตรียมกล้องให้พร้อม record ก่อนที่ countdown จะเริ่ม:
      - prime_stream + enable_wired_control + load_preset
      - snapshot รายการไฟล์ปัจจุบัน (before)
    คืน before_snapshot สำหรับส่งต่อให้ record_cycle()
    """
    cams = channel.active_cameras

    log(f"{channel.name}: เตรียมกล้อง (prime + control)...")
    run_parallel(cams, lambda c: _prep_cam(c, log))
    time.sleep(PREP_SETTLE)

    log(f"{channel.name}: ตรวจ state ก่อน countdown")
    for cam in cams:
        s = _cam_state_summary(cam)
        if s:
            log(f"  {cam.name}: mode={s.get('mode')}, fps={s.get('fps')}, "
                f"encoding={s.get('encoding')}, batt={s.get('battery')}")
        else:
            log(f"  [!] {cam.name}: อ่าน state ไม่ได้")

    before = channel.snapshot_media()
    log(f"{channel.name}: กล้องพร้อม ✓ — เริ่ม countdown ได้เลย")
    return before


# ─── Phase 2: record ทันทีหลัง countdown ─────────────────────────────────────

def record_cycle(channel, before, log=print, ch_index: int = 0, on_phase=None):
    """
    START recording ทันทีหลัง countdown จบ (ต้องเรียก prepare_cycle ก่อน)
    คืน list ของ {"path", "cam", "directory", "filename"} ที่ดาวน์โหลดได้
    (cam/directory/filename ใช้ลบไฟล์ต้นฉบับบนกล้องทีหลัง หลังอัปคลาวด์สำเร็จ)
    on_phase (optional): callback(phase, remaining) — phase = "recording"|"downloading"
                         ใช้ให้ web API รายงานสถานะแบบเรียลไทม์
    """
    cams = channel.active_cameras

    # ── 1) สั่ง start_recording ─────────────────────────────────────────────
    log(f"{channel.name}: START recording ({config.RECORD_SECONDS}s)")
    start_results = channel.start_recording()
    for cam, ok in zip(cams, start_results):
        log(f"  {cam.name}: shutter/start → {'OK' if ok else '[!] FAILED'}")

    if not any(start_results):
        log(f"{channel.name}: [!] ไม่มีกล้องตัวไหนตอบ — ยกเลิก")
        display.stop(ch_index)
        return []

    # ── 2) verify encoding ──────────────────────────────────────────────────
    time.sleep(ENCODING_CHECK_WAIT)
    log(f"{channel.name}: ตรวจ encoding state...")
    for cam in cams:
        encoding = _verify_encoding(cam, log)
        if encoding is None:
            # อ่าน state ไม่ได้ ≠ ไม่ได้อัด — อย่ากด shutter ซ้ำทันที อ่านใหม่อีกครั้งก่อน
            time.sleep(1.0)
            encoding = _verify_encoding(cam, log)
        if encoding is False:
            for retry in range(1, ENCODING_RETRY_MAX + 1):
                log(f"  {cam.name}: [retry {retry}/{ENCODING_RETRY_MAX}] "
                    f"enable_wired_control + start_recording")
                cam.enable_wired_control()
                time.sleep(0.5)
                ok = cam.start_recording()
                log(f"  {cam.name}: retry shutter/start → {'OK' if ok else 'FAILED'}")
                if ok:
                    time.sleep(1.5)
                    if _verify_encoding(cam, log):
                        log(f"  {cam.name}: encoding confirmed ✓")
                        break
                    log(f"  {cam.name}: ยัง encode ไม่ได้")

    # ── 3) นับเวลา + keep-alive ─────────────────────────────────────────────
    for sec in range(config.RECORD_SECONDS):
        remaining = config.RECORD_SECONDS - sec
        display.record_tick(ch_index, remaining)
        if on_phase:
            on_phase("recording", remaining)
        time.sleep(1)
        if (sec + 1) % KEEPALIVE_EVERY == 0:
            run_parallel(cams, lambda c: c.keep_alive())

    display.record_tick(ch_index, 0)

    # ── 4) หยุดอัด ──────────────────────────────────────────────────────────
    log(f"{channel.name}: STOP recording")
    channel.stop_recording()
    display.stop(ch_index)
    if on_phase:
        on_phase("downloading", None)

    # ── 5) รอ finalize + ดาวน์โหลด ──────────────────────────────────────────
    time.sleep(SETTLE_AFTER_STOP)
    stamp = save.session_stamp()
    log(f"{channel.name}: downloading...")
    result = save.download_new_files(
        channel, before, config.DOWNLOAD_ROOT, stamp, wait=config.DOWNLOAD_WAIT
    )
    saved = [item for items in result.values() for item in items]
    if saved:
        log(f"{channel.name}: saved {len(saved)} file(s) → "
            f"{config.DOWNLOAD_ROOT}/{stamp}/{channel.name}/")
    else:
        log(f"{channel.name}: [!] ไม่ได้ไฟล์")
    return saved


# ─── Convenience wrapper (ใช้เมื่อไม่ต้องการแยก phase) ──────────────────────

def run_cycle(channel, log=print, ch_index: int = 0):
    """prepare + record ในครั้งเดียว (backward compat)"""
    before = prepare_cycle(channel, log=log, ch_index=ch_index)
    return record_cycle(channel, before, log=log, ch_index=ch_index)
