#!/usr/bin/env python3
"""
Shooting Range — Master Controller
════════════════════════════════════
รับสัญญาณปุ่มจาก ESP32 ผ่าน UDP แล้วควบคุมระบบทั้งหมด

Flow ต่อ 1 ช็อต:
  1. ESP32 กดปุ่ม  →  "BUTTON|MAC"  →  main รู้ว่าเป็น ch ไหน
  2. เริ่ม detect_stream + ปลุก GoPro พร้อมกัน
  3. ท่าเล็งค้าง 3 วิ  →  TRIGGER
  4. countdown 30 วิ (ระหว่างนี้กล้องพร้อมอยู่แล้ว)
  5. บันทึก 10 วิ  →  หยุด  →  download
  6. แสดง QR code 2 นาที
  7. กดปุ่มอีกครั้ง → ข้ามไป detect ใหม่ทันที
"""

import threading
import time
import sys
import os
import traceback
import queue

import cv2
import numpy as np

import config
import display
import detect_stream
import recorder
from gopro import GoProCamera
from channel import Channel, run_parallel

# ─── Helper: placeholder frame แสดงสถานะ ────────────────────────────────────

def _status_frame(line1: str, line2: str = "",
                  color=(80, 80, 80), size=(480, 848)):
    """สร้าง numpy frame แสดงข้อความ 2 บรรทัด (ส่งเข้า frame_queue ได้เลย)"""
    h, w = size
    img = np.zeros((h, w, 3), dtype=np.uint8)
    cv2.rectangle(img, (30, 30), (w - 30, h - 30), (30, 30, 30), 1)
    font = cv2.FONT_HERSHEY_SIMPLEX
    for text, y, scale in [(line1, h // 2 - 30, 1.1), (line2, h // 2 + 20, 0.75)]:
        if not text:
            continue
        (tw, th), _ = cv2.getTextSize(text, font, scale, 2)
        cv2.putText(img, text, ((w - tw) // 2, y), font, scale, color, 2)
    return img

# ─── ChannelSession: จัดการ 1 เลน ตั้งแต่กดปุ่มจนจบ ─────────────────────────

class ChannelSession(threading.Thread):
    """1 session = ตั้งแต่กดปุ่มจนถึง QR หมดเวลา (หรือกดใหม่)"""

    def __init__(self, ch_index: int, channel: Channel,
                 frame_queue: "queue.Queue | None" = None):
        super().__init__(daemon=True, name=f"session-ch{ch_index}")
        self.ch           = ch_index
        self.channel      = channel
        self.frame_queue  = frame_queue
        self.state        = "IDLE"     # IDLE / DETECTING / COUNTDOWN / RECORDING / QR
        self._qr_interrupt = threading.Event()
        self._trigger      = threading.Event()
        self._detect_stop  = threading.Event()

    # ── สาธารณะ ───────────────────────────────────────────────────────────────

    def interrupt_qr(self):
        """เรียกเมื่อกดปุ่มระหว่างหน้า QR → ข้ามทันที"""
        if self.state == "QR":
            self._qr_interrupt.set()

    def is_busy(self) -> bool:
        return self.is_alive() and self.state != "IDLE"

    # ── Internal ──────────────────────────────────────────────────────────────

    def _send(self, cmd: str):
        display.send_to_channel(self.ch, cmd)

    def _log(self, msg: str):
        print(f"  [ch{self.ch}] {msg}")

    def run(self):
        try:
            self._session()
        except Exception as e:
            self._log(f"ERROR: {e}")
            traceback.print_exc()          # แสดง stack trace เต็มๆ
            display.show_error(self.ch, str(e))
        finally:
            self.state = "IDLE"
            display.ready(self.ch)

    def _session(self):
        # ── 1. WAIT → กล้องพร้อม → DETECTING ────────────────────────────────
        self.state = "DETECTING"
        display.waiting(self.ch)        # ← แสดง "PLEASE WAIT" ก่อน

        self._trigger.clear()
        self._detect_stop.clear()

        cam_ip = config.get_detect_ip(self.ch)
        if not cam_ip:
            raise RuntimeError(f"ไม่พบ IP กล้องสำหรับ ch{self.ch}")

        # ── ปลุกกล้องทุกตัวใน channel และ keep-alive ตลอด จนถึงหลัง prepare ──
        _cam_wake_stop = threading.Event()

        def _bg_wake_cams():
            cams = self.channel.active_cameras
            if not cams:
                return
            self._log(f"ปลุกกล้อง {len(cams)} ตัว: {[c.name for c in cams]}")

            def _keep_alive_loop(cam):
                """
                Ping ทุก 2 วิ + ส่ง enable_wired_control ทุก ~10 วิ
                เพื่อให้กล้องทุกตัวอยู่ในสถานะ HTTP API พร้อมใช้งานตั้งแต่ต้น
                """
                reported = False
                tick = 0
                while not _cam_wake_stop.wait(timeout=2.0):
                    ok = cam.keep_alive()
                    tick += 1
                    # ส่ง wired control ทุก 5 tick (= ~10 วิ) เพื่อ activate API
                    if tick % 5 == 0:
                        cam.enable_wired_control()
                    if ok and not reported:
                        self._log(f"{cam.name}: ออนไลน์แล้ว ✓")
                        reported = True
                    elif not ok and reported:
                        self._log(f"{cam.name}: [!] keep_alive หลุด (จะลองต่อ)")
                        reported = False

            threads = [
                threading.Thread(target=_keep_alive_loop, args=(c,), daemon=True)
                for c in cams
            ]
            for t in threads:
                t.start()
            for t in threads:
                t.join()

        wake_thread = threading.Thread(target=_bg_wake_cams, daemon=True,
                                       name=f"wake-ch{self.ch}")
        wake_thread.start()

        # ── Prime กล้องทุกตัวก่อน detect เริ่ม ──────────────────────────────
        # ทำ parallel → cam1 + cam2 พร้อมพร้อมกัน ก่อนที่จะเริ่มยิง detect stream
        # ผู้ใช้จะยืนรอแค่ช่วงนี้ (~2-3 วิ) ไม่ใช่รอตอนจะ record
        self._log("เตรียมกล้องทุกตัวก่อน detect...")

        def _activate_cam(cam):
            cam.enable_wired_control()
            cam.prime_stream()
            cam.enable_wired_control()

        run_parallel(self.channel.active_cameras, _activate_cam)
        self._log("กล้องพร้อมแล้ว ✓ → เริ่ม detect")

        # ── แสดง placeholder ขณะโหลดโมเดล / เชื่อมต่อ stream ─────────────────
        if self.frame_queue is not None:
            # เคลียร์ frame เก่าจาก session ก่อนหน้าออกก่อน
            while True:
                try:
                    self.frame_queue.get_nowait()
                except queue.Empty:
                    break
            # ใส่ placeholder "Connecting..."
            try:
                self.frame_queue.put_nowait(
                    _status_frame("Connecting camera...",
                                  f"ch{self.ch}  {cam_ip}",
                                  color=(70, 70, 70))
                )
            except Exception:
                pass

        def _on_cam_ready():
            """เรียกตอนกล้อง connect สำเร็จและได้ frame แรก → เปลี่ยนจอเป็น DETECTING"""
            self._log("กล้องพร้อม → เริ่ม detect")
            display.detecting(self.ch)

        detect_stream.run(
            camera_ip=cam_ip,
            on_trigger=self._trigger.set,
            stop_event=self._detect_stop,
            show_window=False,
            frame_queue=self.frame_queue,
            on_ready=_on_cam_ready,
        )

        if not self._trigger.is_set():
            _cam_wake_stop.set()
            self._log("detect หยุดโดยไม่มี trigger")
            return

        self._log("TRIGGER!")
        _cam_wake_stop.set()   # หยุด wake thread ทันที

        # ── 2. COUNTDOWN + prepare พร้อมกัน ───────────────────────────────
        # - countdown เริ่มทันที (ผู้ใช้เห็น 10,9,8... ทันทีหลัง trigger)
        # - prepare_cycle รันใน background พร้อมกัน (~3-4 วิ จบก่อน countdown)
        # - พอ countdown ถึง 0 = START RECORD ได้เลย ไม่มีการรอเพิ่ม
        self.state = "COUNTDOWN"

        _before_result: list = [None]
        _prepare_done  = threading.Event()

        def _run_prepare():
            try:
                _before_result[0] = recorder.prepare_cycle(
                    self.channel, log=self._log, ch_index=self.ch
                )
            except Exception as e:
                self._log(f"[!] prepare_cycle error: {e}")
            finally:
                _prepare_done.set()

        threading.Thread(target=_run_prepare, daemon=True,
                         name=f"prepare-ch{self.ch}").start()

        for n in range(10, 0, -1):
            display.countdown_tick(self.ch, n)
            self._log(f"countdown: {n}...")
            time.sleep(1)
        display.countdown_tick(self.ch, 0)
        self._log("countdown: 0 → เริ่ม record!")

        # รอ prepare เสร็จ (ถ้ายังไม่เสร็จ ซึ่งปกติจะเสร็จตั้งแต่ n=6-7 แล้ว)
        if not _prepare_done.wait(timeout=8.0):
            self._log("[!] prepare_cycle timeout — ดำเนินต่อ")

        before = _before_result[0]
        if before is None:
            self._log("[!] prepare ล้มเหลว — ยกเลิก session")
            display.show_error(self.ch, "prepare failed")
            return

        # ── 3. RECORDING — เริ่มทันทีที่ countdown ถึง 0 ─────────────────
        self.state = "RECORDING"
        self._log(f"เริ่มบันทึก {config.RECORD_SECONDS} วิ")

        try:
            recorder.record_cycle(
                self.channel,
                before,
                log=self._log,
                ch_index=self.ch,
            )
        except Exception as e:
            display.show_error(self.ch, f"record fail: {e}")
            raise

        # ── 4. QR CODE ────────────────────────────────────────────────────────
        self.state = "QR"
        display.show_qr(self.ch)
        self._log("แสดง QR code (2 นาที)")

        self._qr_interrupt.clear()
        interrupted = self._qr_interrupt.wait(timeout=120)

        if interrupted:
            self._log("กดปุ่มระหว่าง QR → เริ่ม session ใหม่")
            # SessionManager จะสร้าง session ใหม่จาก button event



# ─── SessionManager: ดูแลทุก channel ────────────────────────────────────────

class SessionManager:

    def __init__(self, frame_queue: "queue.Queue | None" = None):
        self.channels: dict[int, Channel] = {}   # ch_index → Channel
        self.sessions: dict[str, ChannelSession] = {}  # mac → session
        self._lock = threading.Lock()
        self._frame_queue = frame_queue
        self._build_channels()

    def _build_channels(self):
        for ch_cfg in config.load_channels():
            cams = [GoProCamera.from_config(c, config.PORT) for c in ch_cfg.cameras]
            self.channels[ch_cfg.index] = Channel(
                name=ch_cfg.name, cameras=cams
            )
        print(f"  โหลด {len(self.channels)} channel(s)")

    def button_pressed(self, mac: str):
        ch_index = config.mac_to_channel(mac)
        if ch_index is None:
            print(f"  [!] ไม่รู้จัก MAC: {mac} — เพิ่มใน .env ก่อน")
            return

        channel = self.channels.get(ch_index)
        if channel is None:
            print(f"  [!] ไม่พบ channel {ch_index} ใน config")
            return

        # ตรวจสถานะ session ปัจจุบัน (lock แค่ช่วง read)
        with self._lock:
            existing = self.sessions.get(mac)
            if existing and existing.state == "QR":
                existing.interrupt_qr()
                threading.Timer(0.5, self._start_session, args=(mac, ch_index, channel)).start()
                return
            if existing and existing.is_busy():
                print(f"  [!] ch{ch_index} กำลังทำงาน (state={existing.state})")
                return
        # ← ปล่อย lock ก่อนแล้วค่อยสร้าง session (ป้องกัน deadlock)
        self._start_session(mac, ch_index, channel)

    def _start_session(self, mac: str, ch_index: int, channel: Channel):
        session = ChannelSession(ch_index, channel, frame_queue=self._frame_queue)
        with self._lock:                  # lock แค่ตอน write
            self.sessions[mac] = session
        session.start()
        print(f"  [ch{ch_index}] session เริ่มต้น")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    print("=" * 50)
    print("  Shooting Range — Master Controller")
    print("=" * 50)

    # frame queue → main thread แสดง cv2 window (macOS ต้องการ main thread)
    fq: queue.Queue = queue.Queue(maxsize=2)
    manager = SessionManager(frame_queue=fq)

    # ลงทะเบียน button callback → display.py จัดการ UDP ให้ทั้งหมด
    display.set_button_callback(manager.button_pressed)

    # ส่ง READY ไปทุก ESP32 ที่รู้จัก (ถ้าออนไลน์แล้ว)
    display.ready()

    print()
    print("  รอสัญญาณจาก ESP32...")
    print("  (กด Ctrl+C เพื่อหยุด | กด q ในหน้าต่าง detect เพื่อหยุด detect)")
    print()

    _detect_window_open = False   # ติดตามว่าหน้าต่าง Detect เปิดอยู่ไหม

    try:
        while True:
            # ── จัดการ frame จาก detect thread (main thread เท่านั้น) ─────────
            try:
                frame = fq.get_nowait()
                if frame is None:
                    # sentinel → ปิดหน้าต่าง Detect
                    if _detect_window_open:
                        cv2.destroyWindow("Detect")
                        _detect_window_open = False
                else:
                    cv2.imshow("Detect", frame)
                    _detect_window_open = True
            except queue.Empty:
                pass

            key = cv2.waitKey(1) & 0xFF
            if key == ord("q"):
                print("  [Detect] กด q → หยุด detect")
                for s in manager.sessions.values():
                    if s.state == "DETECTING":
                        s._detect_stop.set()

            time.sleep(0.01)
    except KeyboardInterrupt:
        cv2.destroyAllWindows()
        print("\n  หยุดโปรแกรม")
        sys.exit(0)


if __name__ == "__main__":
    main()
