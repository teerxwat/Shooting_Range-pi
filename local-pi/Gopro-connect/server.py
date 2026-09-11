#!/usr/bin/env python3
"""
server.py — HTTP API bridge: หน้าเว็บ React ↔ ระบบกล้อง GoPro
════════════════════════════════════════════════════════════════
แทนที่ปุ่ม ESP32 + หน้าต่าง cv2 ด้วย web API
จอ LCD (ESP32) เป็น optional — display.py จะข้ามให้เองถ้าหาอุปกรณ์ไม่เจอ

รัน:
    pip install -r requirements.txt
    python server.py                     # port 8000

Endpoints:
    GET  /api/channels                   สถานะทุกช่อง (enabled / online / state)
    POST /api/channels/{ch}/process      เริ่ม session (แทนการกดปุ่ม ESP32)
                                          body: {"skipDetect": true}  → ข้าม AI detect, เข้า countdown ทันที
    POST /api/channels/{ch}/cancel       ยกเลิกช่วง detect
    GET  /api/channels/{ch}/status       สถานะ session ละเอียด (ให้เว็บ poll ทุก 1s)
    GET  /api/channels/{ch}/stream       MJPEG ภาพสด (ช่วง DETECTING)
    GET  /api/channels/{ch}/clips        คลิปทั้งหมดของช่องนี้ (ตั้งแต่เปิด server)
    GET  /api/qr?data=...                QR code เป็น PNG
    GET  /videos/...                     ไฟล์วิดีโอที่ดาวน์โหลดจากกล้องแล้ว

Session state machine:
    IDLE → PREPARING → DETECTING → COUNTDOWN → RECORDING → DOWNLOADING → DONE
                                                                        ↘ ERROR
"""
import io
import json
import os
import queue
import shutil
import subprocess
import threading
import time
import traceback

# ตั้ง ffmpeg low-latency ก่อน import cv2 (เหมือน stream.py / detect_stream.py)
os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "fflags;nobuffer|flags;low_delay")
import cv2
import qrcode
import uvicorn
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

import config
import display
import detect_stream
import recorder
import uploader
from gopro import GoProCamera
from channel import Channel, run_parallel

SERVER_PORT = int(os.getenv("WEB_API_PORT", "8000"))
# เว็บที่ลูกค้าเอาไปโหลดคลิป (โชว์เป็น QR บนจอที่เลน)
DOWNLOAD_SITE = (os.getenv("CLOUD_URL") or "").rstrip("/")
COUNTDOWN_SECONDS = 10
BUSY_STATES = ("PREPARING", "DETECTING", "COUNTDOWN", "RECORDING", "DOWNLOADING")

# idle preview: ภาพสดตอนเข้าหน้าช่อง (ก่อนกดประมวลผล)
PREVIEW_IDLE_TIMEOUT = 15.0   # ไม่มี heartbeat จากหน้าเว็บนานเท่านี้ → หยุด stream เอง


def stream_port(ch: int) -> int:
    """พอร์ต UDP รับ stream แยกต่อช่อง (ch1→8554, ch2→8555, …) → เปิดหลายช่องพร้อมกันได้"""
    return 8554 + (ch - 1)

# ═══ Session code (ไม่ซ้ำ) + คลังคลิปแบบไฟล์จริง ═══════════════════════════════
# session = running number ต่อช่อง เก็บใน counter file → ไม่ซ้ำแม้รีสตาร์ท server
# ไฟล์วิดีโอ = {session}_{YYYYMMDD_HHMMSS}.mp4 ใน downloads/clips/ch{N}/

COUNTER_FILE = os.path.join(os.path.dirname(__file__), ".session", "web_counter.json")
_counter_lock = threading.Lock()
VIDEO_EXTS = (".mp4", ".360", ".mov")


def next_session_code(ch: int) -> str:
    """คืนรหัสเซสชันไม่ซ้ำ เช่น S1-0001, S1-0002 (นับต่อจากเดิมเสมอ)
    เลขนำหน้า = config.LANE_ID (ตั้งใน .env) ไม่ใช่ ch — กัน code ชนกันตอนมีหลาย Pi
    อัปคลิปขึ้นคลาวด์เดียวกัน (แต่ละ Pi นับ ch1 เป็นเลนของตัวเองเหมือนกันหมด ถ้าใช้ ch
    ตรงๆ เป็นเลขนำหน้า ทุกเครื่องจะได้ S1-0001 ซ้ำกัน แล้วชนกันบน uq_code ฝั่งคลาวด์)"""
    with _counter_lock:
        os.makedirs(os.path.dirname(COUNTER_FILE), exist_ok=True)
        data = {}
        if os.path.exists(COUNTER_FILE):
            try:
                with open(COUNTER_FILE, encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                data = {}
        n = int(data.get(str(ch), 0)) + 1
        data[str(ch)] = n
        with open(COUNTER_FILE, "w", encoding="utf-8") as f:
            json.dump(data, f)
        return f"S{config.LANE_ID}-{n:04d}"


def clips_dir(ch: int) -> str:
    d = os.path.join(config.DOWNLOAD_ROOT, "clips", f"ch{ch}")
    os.makedirs(d, exist_ok=True)
    return d


def transcode_web(src: str, log=print) -> str:
    """
    แปลงไฟล์จากกล้อง (HEVC 4K) → H.264 1080p ที่เล่นได้ทุกเบราว์เซอร์/Android
    ต้นฉบับ HEVC ย้ายเก็บใน originals/ ข้างๆ — คืน path ไฟล์ใหม่ (หรือไฟล์เดิมถ้าแปลงไม่สำเร็จ)
    """
    if not src.lower().endswith((".mp4", ".mov")):
        return src
    tmp = src + ".web.tmp.mp4"
    cmd = ["ffmpeg", "-y", "-i", src,
           "-vf", "scale=-2:1080", "-c:v", "libx264", "-preset", "veryfast",
           "-crf", "22", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an", tmp]
    try:
        r = subprocess.run(cmd, capture_output=True, timeout=900)
        if r.returncode != 0:
            raise RuntimeError(r.stderr.decode(errors="ignore")[-200:])
        orig_dir = os.path.join(os.path.dirname(src), "originals")
        os.makedirs(orig_dir, exist_ok=True)
        shutil.move(src, os.path.join(orig_dir, os.path.basename(src)))
        os.replace(tmp, src)   # ไฟล์หลักกลายเป็น H.264 ชื่อเดิม
        return src
    except Exception as e:
        log(f"  [!] แปลง H.264 ไม่สำเร็จ ({e}) — ใช้ไฟล์เดิม")
        try:
            os.remove(tmp)
        except OSError:
            pass
        return src


def scan_clips(ch: int, session_code: str | None = None) -> list[dict]:
    """
    อ่านรายการคลิปจากไฟล์จริงในโฟลเดอร์ (เก่า→ใหม่)
    session_code ระบุ = กรองเฉพาะคลิปของเซสชันนั้น (ผู้ใช้เห็นแค่คลิปของตัวเอง)
    """
    d = clips_dir(ch)
    root = os.path.abspath(config.DOWNLOAD_ROOT)
    items = []
    try:
        files = [
            os.path.join(d, f) for f in os.listdir(d)
            if f.lower().endswith(VIDEO_EXTS)
        ]
    except OSError:
        return []
    for p in sorted(files, key=os.path.getmtime):
        name = os.path.basename(p)
        if session_code and not name.startswith(session_code + "_"):
            continue
        rel = os.path.relpath(os.path.abspath(p), root).replace(os.sep, "/")
        mt = time.localtime(os.path.getmtime(p))
        items.append({
            "name": name,
            "path": rel,
            "url": f"/videos/{rel}",
            "session": name.split("_", 1)[0],   # ดึงรหัสเซสชันจากชื่อไฟล์
            "time": time.strftime("%d/%m · %H:%M", mt),
        })
    return items


# ═══ FrameStore: เก็บ JPEG frame ล่าสุดของแต่ละช่อง ═══════════════════════════

class FrameStore:
    """รับ numpy frame จาก detect_stream (ผ่าน queue) → encode JPEG เก็บตัวล่าสุด"""

    def __init__(self):
        self.queue: queue.Queue = queue.Queue(maxsize=2)
        self._jpeg: bytes | None = None
        self._ts = 0.0
        self._lock = threading.Lock()
        threading.Thread(target=self._consume, daemon=True).start()

    def _consume(self):
        while True:
            frame = self.queue.get()
            if frame is None:  # sentinel จาก detect_stream = stream จบ
                with self._lock:
                    self._jpeg = None
                continue
            ok, buf = cv2.imencode(".jpg", frame, [cv2.IMWRITE_JPEG_QUALITY, 70])
            if ok:
                with self._lock:
                    self._jpeg = buf.tobytes()
                    self._ts = time.time()

    def latest(self):
        with self._lock:
            return self._jpeg, self._ts


# ═══ PreviewWorker: ภาพสดตอน idle (เข้าหน้าช่องแล้วเห็นกล้องทันที) ═══════════════

class PreviewWorker(threading.Thread):
    """
    เปิด GoPro preview stream → อ่าน frame → ส่งเข้า FrameStore
    หยุดเองเมื่อ: ถูกสั่ง stop / ไม่มี heartbeat จากหน้าเว็บเกิน PREVIEW_IDLE_TIMEOUT
    หมายเหตุ: GoPro ทุกตัวยิง UDP เข้าพอร์ต 8554 เดียวกัน → เปิด preview ได้ทีละช่อง
    """

    def __init__(self, ch: int, cam, frames: FrameStore):
        super().__init__(daemon=True, name=f"preview-ch{ch}")
        self.ch = ch
        self.cam = cam
        self.frames = frames
        self.active = False
        # ห้ามใช้ชื่อ _stop — จะไปทับเมธอดภายในของ threading.Thread
        self._stop_evt = threading.Event()
        self._last_heartbeat = time.time()

    def heartbeat(self):
        self._last_heartbeat = time.time()

    def stop(self):
        self._stop_evt.set()

    def _expired(self) -> bool:
        return time.time() - self._last_heartbeat > PREVIEW_IDLE_TIMEOUT

    def run(self):
        # ใช้ pipeline เดียวกับ detect_stream (ffmpeg subprocess) — เสถียรกว่า cv2.VideoCapture
        base = f"http://{self.cam.ip}:{self.cam.port}"
        ka_stop = threading.Event()
        proc = grabber = None
        try:
            pipeline = detect_stream._connect(base, detect_stream.RECONNECT_MAX, stream_port(self.ch))
            if pipeline is None:
                print(f"  [preview ch{self.ch}] เชื่อมต่อ stream ไม่สำเร็จ")
                return
            proc, grabber = pipeline

            threading.Thread(
                target=detect_stream._keep_alive, args=(base, ka_stop), daemon=True
            ).start()

            print(f"  [preview ch{self.ch}] เริ่มภาพสด")
            self.active = True
            while not self._stop_evt.is_set() and not self._expired():
                frame = grabber.read()
                if frame is not None:
                    try:
                        self.frames.queue.put_nowait(frame)
                    except queue.Full:
                        pass
                if not grabber.running or grabber.stale_for() > 6.0:
                    print(f"  [preview ch{self.ch}] stream หลุด")
                    break
                time.sleep(1 / 20)
        finally:
            self.active = False
            ka_stop.set()
            try:
                detect_stream._stop_pipeline(proc, grabber, base)
            except Exception:
                pass
            # เคลียร์ภาพค้างบนหน้าเว็บ
            try:
                self.frames.queue.put_nowait(None)
            except queue.Full:
                pass
            print(f"  [preview ch{self.ch}] หยุดแล้ว")


# ═══ WebSession: 1 รอบการทำงาน (แทน ChannelSession ของ main.py) ═══════════════

class WebSession(threading.Thread):

    def __init__(self, ch_index: int, channel: Channel, frames: FrameStore, code: str,
                 pin: str = "", skip_detect: bool = False):
        super().__init__(daemon=True, name=f"web-session-ch{ch_index}")
        self.ch = ch_index
        self.channel = channel
        self.frames = frames
        self.code = code   # รหัสเซสชันของ "ผู้ใช้คนปัจจุบัน" (visit) — อัดหลายรอบใช้เลขเดิม
        self.pin = pin     # PIN ที่ลูกค้าตั้งไว้ — ใช้ตอนอัปขึ้นคลาวด์
        self.skip_detect = skip_detect  # true = กดปุ่ม "ข้าม AI" → ไม่รอ trigger, เข้า countdown ทันที
        self.state = "PREPARING"
        self.countdown: int | None = None
        self.record_remaining: int | None = None
        self.error: str | None = None
        self.done_at: float | None = None
        self.clips: list[str] = []  # relative paths ใต้ DOWNLOAD_ROOT
        self._trigger = threading.Event()
        self._detect_stop = threading.Event()

    # ── public ──────────────────────────────────────────────────────────────

    def cancel(self):
        """ยกเลิกได้เฉพาะช่วง detect (ช่วงอัด/ดาวน์โหลดปล่อยให้จบเอง)"""
        self._detect_stop.set()

    def is_busy(self) -> bool:
        return self.is_alive() and self.state in BUSY_STATES

    def _log(self, msg: str):
        print(f"  [ch{self.ch}] {msg}")

    # ── main flow ───────────────────────────────────────────────────────────

    def run(self):
        try:
            self._run()
        except Exception as e:
            self.error = str(e)
            self.state = "ERROR"
            traceback.print_exc()
            display.show_error(self.ch, str(e))
        finally:
            if self.state not in ("DONE", "ERROR"):
                self.state = "IDLE"
            display.ready(self.ch)

    def _run(self):
        display.waiting(self.ch)

        cam_ip = config.get_detect_ip(self.ch)
        if not cam_ip:
            raise RuntimeError(f"ไม่พบ IP กล้องสำหรับ ch{self.ch} (เช็ค .env)")

        cams = self.channel.active_cameras
        if not cams:
            raise RuntimeError(f"ch{self.ch} ไม่มีกล้องที่ enabled")

        # กล้องตัวไหน enabled ใน .env แต่ต่อไม่ติดจริง → ข้าม (ปิดชั่วคราวจนกว่าจะ restart server)
        # กันอาการค้างที่ PREPARING เพราะรอ timeout กล้องที่ไม่ได้เสียบ
        if len(cams) > 1:
            results = run_parallel(cams, lambda c: bool(c.keep_alive()))
            for cam, ok in zip(cams, results):
                if not ok:
                    self._log(f"[!] {cam.name} ({cam.ip}) ต่อไม่ติด — ข้ามกล้องนี้")
                    cam.enabled = False
            cams = self.channel.active_cameras
            if not cams:
                raise RuntimeError(f"ch{self.ch} ไม่มีกล้องที่ต่อติดเลย")

        # ── 1) ปลุกกล้อง + keep-alive background (เหมือน main.py) ───────────
        wake_stop = threading.Event()

        def _keep_alive_loop(cam):
            tick = 0
            while not wake_stop.wait(timeout=2.0):
                cam.keep_alive()
                tick += 1
                if tick % 5 == 0:
                    cam.enable_wired_control()

        for c in cams:
            threading.Thread(target=_keep_alive_loop, args=(c,), daemon=True).start()

        self._log("เตรียมกล้อง (prime + wired control)...")

        def _activate(cam):
            cam.enable_wired_control()
            cam.prime_stream()
            cam.enable_wired_control()

        run_parallel(cams, _activate)
        self._log("กล้องพร้อม ✓ → เริ่ม detect")

        # ── 2) DETECTING — frame ถูกส่งเข้า FrameStore → เว็บดูผ่าน MJPEG ────
        self.state = "DETECTING"

        if self.skip_detect:
            # ปุ่ม "ข้าม AI" — ไม่ต้องรอท่าเล็ง เข้า countdown ทันที
            self._log("ข้าม AI detect (สั่งจากปุ่ม skip) → เข้า countdown ทันที")
            self._trigger.set()
        else:
            detect_stream.run(
                camera_ip=cam_ip,
                on_trigger=self._trigger.set,
                stop_event=self._detect_stop,
                show_window=False,
                frame_queue=self.frames.queue,
                on_ready=lambda: display.detecting(self.ch),
                stream_port=stream_port(self.ch),
            )
        wake_stop.set()

        if not self._trigger.is_set():
            self._log("detect ถูกยกเลิก / หยุดโดยไม่มี trigger")
            self.state = "IDLE"
            return

        self._log("TRIGGER!")

        # ── 3) COUNTDOWN + prepare กล้องพร้อมกัน ─────────────────────────────
        self.state = "COUNTDOWN"
        before_result: list = [None]
        prepare_done = threading.Event()

        def _run_prepare():
            try:
                before_result[0] = recorder.prepare_cycle(
                    self.channel, log=self._log, ch_index=self.ch
                )
            except Exception as e:
                self._log(f"[!] prepare_cycle error: {e}")
            finally:
                prepare_done.set()

        threading.Thread(target=_run_prepare, daemon=True).start()

        for n in range(COUNTDOWN_SECONDS, -1, -1):
            self.countdown = n
            display.countdown_tick(self.ch, n)
            if n > 0:
                time.sleep(1)

        if not prepare_done.wait(timeout=8.0) or before_result[0] is None:
            raise RuntimeError("เตรียมกล้องไม่สำเร็จ (prepare failed)")

        # ── 4) RECORDING → DOWNLOADING (สถานะอัปเดตผ่าน on_phase) ────────────
        self.state = "RECORDING"
        self.record_remaining = config.RECORD_SECONDS

        def _on_phase(phase, remaining):
            if phase == "recording":
                self.state = "RECORDING"
                self.record_remaining = remaining
            elif phase == "downloading":
                self.state = "DOWNLOADING"

        saved = recorder.record_cycle(
            self.channel, before_result[0],
            log=self._log, ch_index=self.ch, on_phase=_on_phase,
        )
        if not saved:
            raise RuntimeError("ไม่ได้ไฟล์วิดีโอจากกล้อง (download failed)")

        # ── 5) เปลี่ยนชื่อไฟล์เป็น {session}_{datetime} แล้วย้ายเข้าคลังคลิปของช่อง ──
        stamp = time.strftime("%Y%m%d_%H%M%S")
        dest_dir = clips_dir(self.ch)
        self.clips = []
        # คลิปที่มีอยู่แล้วของเซสชันนี้ → เลขคลิปถัดไปเริ่มจากตรงนี้ (S1-0021-1, -2, ...)
        next_sub = len(scan_clips(self.ch, self.code)) + 1
        for i, p in enumerate(saved):
            ext = os.path.splitext(p)[1].lower() or ".mp4"
            suffix = "" if len(saved) == 1 else f"_{i + 1}"
            dest = os.path.join(dest_dir, f"{self.code}_{stamp}{suffix}{ext}")
            try:
                shutil.move(p, dest)
            except Exception as e:
                self._log(f"[!] ย้ายไฟล์ไม่สำเร็จ ({e}) — ใช้ตำแหน่งเดิม")
                dest = p
            # แปลงเป็น H.264 1080p ให้เล่นได้ทุกอุปกรณ์ (Android เล่น HEVC ไม่ได้)
            self._log("กำลังแปลงไฟล์เป็น H.264 สำหรับเล่นบนเว็บ...")
            dest = transcode_web(dest, log=self._log)
            self.clips.append(os.path.basename(dest))
            self._log(f"บันทึกคลิป → {os.path.basename(dest)}")

            # ส่งขึ้นคลาวด์เบื้องหลัง — ไม่บล็อก ลูกค้าเดินออกได้เลย
            uploader.upload_clip(
                dest, code=self.code, sub_no=next_sub + i,
                pin=self.pin, lane=self.ch, duration_s=config.RECORD_SECONDS,
            )

        self.state = "DONE"
        self.done_at = time.time()
        display.show_qr(self.ch)
        self._log(f"เสร็จสิ้น — ได้ {len(self.clips)} คลิป")


# ═══ LaneManager: ทุกช่อง + online monitor ═══════════════════════════════════

class LaneManager:

    def __init__(self):
        self.channels: dict[int, Channel] = {}
        self.frames: dict[int, FrameStore] = {}
        self.sessions: dict[int, WebSession] = {}
        self.previews: dict[int, PreviewWorker] = {}
        self.online: dict[int, bool] = {}
        # occupancy: หน้าเว็บที่เปิดช่องอยู่ส่ง heartbeat ต่ออายุ — หมดอายุเอง = ปิดเบราว์เซอร์ไปแล้ว
        self.occupied_until: dict[int, float] = {}
        # visit = การใช้งานของลูกค้า 1 คน: {code, started} — จบเมื่อออกจากช่อง (heartbeat หมดอายุ)
        self.visits: dict[int, dict | None] = {}
        self._lock = threading.Lock()

        for ch_cfg in config.load_channels():
            cams = [GoProCamera.from_config(c, config.PORT) for c in ch_cfg.cameras]
            self.channels[ch_cfg.index] = Channel(name=ch_cfg.name, cameras=cams)
            self.frames[ch_cfg.index] = FrameStore()
            self.online[ch_cfg.index] = False

        print(f"  โหลด {len(self.channels)} channel(s)")
        threading.Thread(target=self._online_monitor, daemon=True).start()

    # ── online check ทุก 5 วิ (ข้ามช่องที่กำลังทำงาน — ไม่รบกวนกล้อง) ────────

    def _online_monitor(self):
        """
        เช็ค online + ทำหน้าที่ camera warmer ไปพร้อมกัน:
        ส่ง keep_alive ทุก 5 วิ (กันกล้องหลับ → เชื่อม preview/detect ได้ทันทีไม่ต้องปลุก)
        และย้ำ enable_wired_control ทุก ~30 วิ ให้ HTTP API ตื่นพร้อมใช้เสมอ
        """
        tick = 0
        while True:
            tick += 1
            for ch, channel in self.channels.items():
                cams = channel.active_cameras
                if not cams:
                    self.online[ch] = False
                    continue
                sess = self.sessions.get(ch)
                if (sess and sess.is_busy()) or self.preview_active(ch):
                    self.online[ch] = True   # กำลังใช้งาน = ออนไลน์แน่นอน ไม่ต้องยุ่งกับกล้อง
                    continue
                try:
                    ok = bool(cams[0].keep_alive())   # keep_alive = เช็ค online + กันหลับ ในคำสั่งเดียว
                    if ok and tick % 6 == 1:
                        cams[0].enable_wired_control()
                    self.online[ch] = ok
                except Exception:
                    self.online[ch] = False
            time.sleep(5)

    # ── preview (ภาพสดตอน idle) ──────────────────────────────────────────────

    def preview_active(self, ch: int) -> bool:
        w = self.previews.get(ch)
        return bool(w and w.is_alive() and w.active)

    def start_preview(self, ch: int) -> dict:
        channel = self.channels.get(ch)
        if channel is None:
            raise HTTPException(404, f"ไม่พบช่อง {ch}")
        sess = self.sessions.get(ch)
        if sess and sess.is_busy():
            return {"ok": False, "reason": "busy"}
        # กลับเข้าหน้าช่องหลัง session จบ → เคลียร์เป็น IDLE
        # (DONE ต้องพ้น 6 วิก่อน เพื่อให้หน้าเว็บทันเห็นและเด้งไปเปิดวิดีโอ)
        if sess and not sess.is_alive():
            if sess.state == "ERROR" or (
                sess.state == "DONE" and sess.done_at and time.time() - sess.done_at > 6
            ):
                sess.state = "IDLE"
        cams = channel.active_cameras
        if not cams:
            return {"ok": False, "reason": "no_camera"}

        with self._lock:
            w = self.previews.get(ch)
            if w and w.is_alive():
                w.heartbeat()   # ต่ออายุ preview เดิม
                return {"ok": True, "active": w.active}
            # แต่ละช่องใช้พอร์ต stream ของตัวเอง → เปิด preview พร้อมกันหลายช่องได้
            w = PreviewWorker(ch, cams[0], self.frames[ch])
            self.previews[ch] = w
        w.start()
        return {"ok": True, "active": False}

    def stop_preview(self, ch: int, wait: bool = False):
        w = self.previews.get(ch)
        if w and w.is_alive():
            w.stop()
            if wait:
                w.join(timeout=5)

    # ── actions ──────────────────────────────────────────────────────────────

    # ── occupancy (มีคนเปิดหน้าช่องนี้อยู่ไหม) ────────────────────────────────

    OCCUPY_TTL = 15.0   # ไม่มี heartbeat นานเท่านี้ = ถือว่าออกจากช่องแล้ว (ระบบเคลียร์เอง)

    def current_visit(self, ch: int, create: bool = False):
        """
        คืน visit (เซสชันของลูกค้าคนปัจจุบัน) ของช่องนี้
        - ถ้าลูกค้าคนก่อนออกไปแล้ว (ไม่ occupied) → ปิด visit เดิมทิ้ง
        - create=True → เปิด visit ใหม่พร้อมรันเลขเซสชันใหม่
        """
        v = self.visits.get(ch)
        if v and not self.is_occupied(ch):
            print(f"  [ch{ch}] จบเซสชัน {v['code']} (ผู้ใช้ออกจากช่อง)")
            self.visits[ch] = None
            v = None
        if v is None and create:
            v = {"code": next_session_code(ch), "started": time.time(), "pin": None}
            self.visits[ch] = v
            print(f"  [ch{ch}] เริ่มเซสชันใหม่ {v['code']}")
        return v

    def set_pin(self, ch: int, pin: str) -> dict:
        """ลูกค้าตั้ง PIN 4 หลักบนจอ — ตั้งได้ครั้งเดียวต่อ visit แล้วลงทะเบียนบนคลาวด์เลย"""
        pin = (pin or "").strip()
        if not (pin.isdigit() and len(pin) == 4):
            raise HTTPException(400, "PIN ต้องเป็นตัวเลข 4 หลัก")
        self.touch_occupancy(ch)
        v = self.current_visit(ch, create=True)
        if v.get("pin"):
            return {"ok": True, "code": v["code"], "existing": True}
        v["pin"] = pin
        # ลงทะเบียนกับคลาวด์ทันที ถ้าเน็ตล่มไม่เป็นไร ตอนอัปคลิปจะลองใหม่ให้
        # lane ที่ส่งขึ้นคลาวด์ = LANE_ID จริงของเครื่องนี้ (ไม่ใช่ ch ภายใน) ให้ตรงกับเลขใน code
        try:
            lane_num = int(config.LANE_ID)
        except ValueError:
            lane_num = ch
        uploader.register_session(v["code"], pin, lane_num)
        print(f"  [ch{ch}] ตั้ง PIN ให้เซสชัน {v['code']} แล้ว")
        return {"ok": True, "code": v["code"], "existing": False}

    def touch_occupancy(self, ch: int):
        if ch in self.channels:
            # เช็ค visit เก่าหมดอายุก่อนต่ออายุ occupancy (ลำดับสำคัญ)
            v = self.current_visit(ch)
            self.occupied_until[ch] = time.time() + self.OCCUPY_TTL
            if v is None:
                self.current_visit(ch, create=True)

    def is_occupied(self, ch: int) -> bool:
        sess = self.sessions.get(ch)
        if sess and sess.is_busy():
            return True                      # กำลัง detect/อัด/โหลด = ใช้งานแน่นอน
        if self.preview_active(ch):
            return True                      # เปิดภาพสดอยู่ = มีคนอยู่หน้าช่อง
        return time.time() < self.occupied_until.get(ch, 0)

    def start_process(self, ch: int, skip_detect: bool = False) -> WebSession:
        channel = self.channels.get(ch)
        if channel is None:
            raise HTTPException(404, f"ไม่พบช่อง {ch}")
        if not channel.active_cameras:
            raise HTTPException(409, f"ช่อง {ch} ไม่มีกล้อง enabled")
        if not self.online.get(ch):
            raise HTTPException(409, f"กล้องช่อง {ch} ออฟไลน์")

        # หยุด idle preview ก่อน — detect_stream จะเปิด stream ของมันเอง (พอร์ต UDP เดียวกัน)
        self.stop_preview(ch, wait=True)

        with self._lock:
            existing = self.sessions.get(ch)
            if existing and existing.is_busy():
                raise HTTPException(409, f"ช่อง {ch} กำลังทำงาน (state={existing.state})")
            self.touch_occupancy(ch)
            visit = self.current_visit(ch, create=True)
            if uploader.enabled() and not visit.get("pin"):
                raise HTTPException(409, "ยังไม่ได้ตั้ง PIN สำหรับดาวน์โหลดคลิป")
            session = WebSession(ch, channel, self.frames[ch],
                                 visit["code"], visit.get("pin") or "",
                                 skip_detect=skip_detect)
            self.sessions[ch] = session

        session.start()
        print(f"  [ch{ch}] session {session.code} เริ่มต้น (จากหน้าเว็บ)")
        return session

    def status(self, ch: int) -> dict:
        if ch not in self.channels:
            raise HTTPException(404, f"ไม่พบช่อง {ch}")
        sess = self.sessions.get(ch)
        visit = self.current_visit(ch)
        vcode = visit["code"] if visit else None
        # เห็นเฉพาะคลิปของเซสชันตัวเอง — คนใหม่เข้ามาไม่เห็นคลิปคนก่อน
        clips = scan_clips(ch, vcode) if vcode else []
        state = sess.state if sess else "IDLE"
        # DONE หมดอายุใน 6 วิ → กลับเป็น IDLE (กัน overlay "เสร็จแล้ว" ค้างเมื่อกลับมาหน้าช่อง)
        if state == "DONE" and sess.done_at and time.time() - sess.done_at > 6:
            state = "IDLE"
        return {
            "channel": ch,
            "online": self.online.get(ch, False),
            "enabled": bool(self.channels[ch].active_cameras),
            "preview": self.preview_active(ch),
            "occupied": self.is_occupied(ch),
            "sessionCode": vcode,
            "pin": (visit or {}).get("pin"),
            # ต้องให้ลูกค้าตั้ง PIN ก่อนถึงจะเริ่มอัดได้ (เฉพาะตอนเปิดใช้คลาวด์)
            "needsPin": uploader.enabled() and not (visit or {}).get("pin"),
            "downloadSite": DOWNLOAD_SITE,
            "state": state,
            "session": {
                "code": sess.code,
                "countdown": sess.countdown,
                "recordRemaining": sess.record_remaining,
                "recordSeconds": config.RECORD_SECONDS,
                "error": sess.error,
                "clips": sess.clips,
            } if sess else None,
            "clipCount": len(clips),
            "latestClip": clips[-1] if clips else None,
        }


manager = LaneManager()

# ═══ FastAPI app ══════════════════════════════════════════════════════════════

app = FastAPI(title="Shooting Range Web API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

os.makedirs(config.DOWNLOAD_ROOT, exist_ok=True)
app.mount("/videos", StaticFiles(directory=config.DOWNLOAD_ROOT), name="videos")


@app.get("/api/channels")
def list_channels():
    return [manager.status(ch) for ch in sorted(manager.channels)]


@app.post("/api/channels/{ch}/process")
def start_process(ch: int, body: dict | None = None):
    """body: {"skipDetect": true} → ปุ่ม "ข้าม AI" ข้ามการตรวจจับท่า เข้า countdown ทันที"""
    skip_detect = bool((body or {}).get("skipDetect"))
    session = manager.start_process(ch, skip_detect=skip_detect)
    return {"ok": True, "code": session.code, "state": session.state}


@app.post("/api/channels/{ch}/occupy")
def occupy(ch: int):
    """heartbeat จองช่อง — หน้าเว็บ (live/replay/playback) เรียกทุก ~5 วิ"""
    if ch not in manager.channels:
        raise HTTPException(404, f"ไม่พบช่อง {ch}")
    manager.touch_occupancy(ch)
    return {"ok": True}


@app.post("/api/channels/{ch}/pin")
def set_pin(ch: int, body: dict):
    """ลูกค้าตั้ง PIN 4 หลักบนจอที่เลน ก่อนเริ่มอัดคลิปแรก"""
    if ch not in manager.channels:
        raise HTTPException(404, f"ไม่พบช่อง {ch}")
    return manager.set_pin(ch, str(body.get("pin", "")))


@app.get("/api/upload/status")
def upload_status():
    """ดูว่ามีคลิปค้างคิวรออัปขึ้นคลาวด์กี่ชิ้น"""
    return uploader.status()


@app.post("/api/channels/{ch}/preview/start")
def preview_start(ch: int):
    """เริ่ม/ต่ออายุภาพสดตอน idle — หน้าเว็บเรียกซ้ำทุก ~4 วิเป็น heartbeat"""
    return manager.start_preview(ch)


@app.post("/api/channels/{ch}/preview/stop")
def preview_stop(ch: int):
    manager.stop_preview(ch)
    return {"ok": True}


@app.post("/api/channels/{ch}/cancel")
def cancel(ch: int):
    sess = manager.sessions.get(ch)
    if sess and sess.is_busy():
        sess.cancel()
    return {"ok": True}


@app.get("/api/channels/{ch}/status")
def channel_status(ch: int):
    return manager.status(ch)


@app.get("/api/channels/{ch}/clips")
def channel_clips(ch: int):
    if ch not in manager.channels:
        raise HTTPException(404, f"ไม่พบช่อง {ch}")
    visit = manager.current_visit(ch)
    return scan_clips(ch, visit["code"]) if visit else []


@app.get("/api/channels/{ch}/stream")
def mjpeg_stream(ch: int):
    if ch not in manager.frames:
        raise HTTPException(404, f"ไม่พบช่อง {ch}")
    store = manager.frames[ch]

    def gen():
        while True:
            jpeg, ts = store.latest()
            if jpeg is not None and time.time() - ts < 3.0:
                yield (b"--frame\r\n"
                       b"Content-Type: image/jpeg\r\n\r\n" + jpeg + b"\r\n")
            time.sleep(1 / 15)  # ~15 fps

    return StreamingResponse(gen(), media_type="multipart/x-mixed-replace; boundary=frame")


# ═══ Render: อบ slow-mo + ฟิลเตอร์ ลงไฟล์จริงด้วย ffmpeg ═══════════════════════
# ผลลัพธ์เก็บใน downloads/renders/ (cache — ชุดค่าเดิมไม่ต้อง render ซ้ำ)

from pydantic import BaseModel

LETTERBOX = (
    "drawbox=x=0:y=0:w=iw:h=ih*0.12:color=black:t=fill,"
    "drawbox=x=0:y=ih-ih*0.12:w=iw:h=ih*0.12:color=black:t=fill"
)
RENDER_FILTERS = {
    "original": None,
    # โทนหนัง: คอนทราสต์+สีจัดขึ้น + ขอบมืด + แถบดำบนล่าง
    "cinema": f"eq=contrast=1.18:saturation=1.18:brightness=-0.02,vignette=PI/4.5,{LETTERBOX}",
    # ขาวดำคอนทราสต์สูง + ขอบมืด + แถบดำบนล่าง
    "mono": f"hue=s=0,eq=contrast=1.28:brightness=-0.02,vignette=PI/4.5,{LETTERBOX}",
}
_render_jobs: dict[str, dict] = {}
_render_lock = threading.Lock()


def renders_dir() -> str:
    d = os.path.join(config.DOWNLOAD_ROOT, "renders")
    os.makedirs(d, exist_ok=True)
    return d


class RenderReq(BaseModel):
    path: str                 # path คลิปต้นฉบับ (relative ใต้ DOWNLOAD_ROOT)
    rate: float = 1.0         # 0.1–1.0 (slow motion)
    filter: str = "original"  # original | cinema | mono


@app.post("/api/render")
def render_video(req: RenderReq):
    if req.filter not in RENDER_FILTERS:
        raise HTTPException(400, f"ไม่รู้จักฟิลเตอร์ {req.filter}")
    rate = min(max(req.rate, 0.05), 1.0)

    root = os.path.abspath(config.DOWNLOAD_ROOT)
    src = os.path.abspath(os.path.join(root, req.path))
    if not src.startswith(root) or not os.path.isfile(src):
        raise HTTPException(404, "ไม่พบไฟล์ต้นฉบับ")

    stem = os.path.splitext(os.path.basename(src))[0]
    name = f"{stem}_{req.filter}_{rate:g}x.mp4"
    out = os.path.join(renders_dir(), name)
    url = f"/videos/renders/{name}"

    with _render_lock:
        job = _render_jobs.get(name)
        if job and job["status"] == "running":
            return {"name": name, "status": "running", "url": url}
        if os.path.exists(out):
            return {"name": name, "status": "done", "url": url}
        _render_jobs[name] = {"status": "running", "error": None}

    def _work():
        vf = []
        if rate < 0.999:
            vf.append(f"setpts={1.0 / rate:.4f}*PTS")   # ยืดเวลา = slow motion ถาวร
        if RENDER_FILTERS[req.filter]:
            vf.append(RENDER_FILTERS[req.filter])
        cmd = ["ffmpeg", "-y", "-i", src]
        if vf:
            cmd += ["-vf", ",".join(vf)]
        cmd += ["-r", "30", "-an", "-c:v", "libx264", "-preset", "veryfast",
                "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", out]
        print(f"  [render] เริ่ม → {name}")
        try:
            r = subprocess.run(cmd, capture_output=True, timeout=600)
            if r.returncode != 0:
                raise RuntimeError(r.stderr.decode(errors="ignore")[-300:])
            _render_jobs[name] = {"status": "done", "error": None}
            print(f"  [render] เสร็จ ✓ {name}")
        except Exception as e:
            _render_jobs[name] = {"status": "error", "error": str(e)}
            try:
                os.remove(out)
            except OSError:
                pass
            print(f"  [render] ล้มเหลว: {e}")

    threading.Thread(target=_work, daemon=True).start()
    return {"name": name, "status": "running", "url": url}


@app.get("/api/render/status")
def render_status(name: str):
    url = f"/videos/renders/{name}"
    job = _render_jobs.get(name)
    if job is None:
        if os.path.exists(os.path.join(renders_dir(), name)):
            return {"status": "done", "url": url, "error": None}
        raise HTTPException(404, "ไม่พบงาน render")
    return {"status": job["status"], "url": url, "error": job["error"]}


@app.get("/api/qr")
def qr_png(data: str):
    img = qrcode.make(data, box_size=8, border=2)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return Response(content=buf.getvalue(), media_type="image/png")


if __name__ == "__main__":
    print("=" * 50)
    print("  Shooting Range — Web API Server")
    print(f"  http://0.0.0.0:{SERVER_PORT}")
    print("=" * 50)
    uploader.start()
    uvicorn.run(app, host="0.0.0.0", port=SERVER_PORT)
