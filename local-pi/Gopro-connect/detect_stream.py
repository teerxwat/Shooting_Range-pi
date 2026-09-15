#!/usr/bin/env python3
"""
detect_stream.py — ตรวจจับท่าเล็ง + object ผ่าน GoPro stream
═══════════════════════════════════════════════════════════════
ใช้แบบ module:  detect_stream.run(camera_ip, on_trigger, stop_event)
ใช้แบบ standalone:  python detect_stream.py

Logic (มุมกล้องด้านข้าง + รองรับเห็นครึ่งตัวบน):
  (1) แขนเหยียดตรง (มุมข้อศอก > ARM_STRAIGHT_DEG)
  (2) แขนชี้แนวนอน (เบนจากแนวนอน < HORIZ_TOL_DEG)
  (3) มีวัตถุเป้าหมาย (cell phone แทนปืน) ใกล้ข้อมือเล็ง
  (4) เงื่อนไข (1)+(2)+(3) ค้างนิ่งครบ STABLE_SECONDS → TRIGGER
"""
import os
import time
import math
import select
import threading
import subprocess
from typing import Callable, Optional

import numpy as np
import cv2
import requests
import torch
from dotenv import load_dotenv
from ultralytics import YOLO

load_dotenv()

# ── password helper (อ่านจาก gopro_auth.json) ────────────────────────────────
from gopro import get_password_for as _get_password

# Session ที่ไม่ผ่าน proxy (เหมือน gopro.py)
_detect_session = requests.Session()
_detect_session.trust_env = False

# ─── Config ──────────────────────────────────────────────────────────────────
PORT       = 8554
WIDTH, HEIGHT = 848, 480
FRAME_SIZE = WIDTH * HEIGHT * 3
FIRST_FRAME_TIMEOUT = 12
CONF   = 0.4
IMGSZ  = 416
DET_EVERY   = 2
DET_MODEL    = "yolo11n.pt"
TARGET_CLASS = "cell phone"

def _env_num(key, default):
    """อ่านค่าจูนจาก .env — คืนค่า default ถ้าไม่ได้ตั้งหรือรูปแบบผิด"""
    try:
        return type(default)(float(os.getenv(key, default)))
    except (TypeError, ValueError):
        return default


def _env_bool(key, default=False):
    v = os.getenv(key)
    if v is None:
        return default
    return v.strip().lower() in ("1", "true", "yes", "on")


# ── ตัวแปรเปิด/ปิดโมเดลตรวจจับปืน ──────────────────────────────────────────
# True  = ต้องตรวจพบวัตถุ (cell phone / ปืน) ใกล้ข้อมือ + ท่าแขน → trigger
# False = ท่าแขนอย่างเดียวพอ (ไม่โหลด det_model → เร็วกว่า, ทดสอบง่ายกว่า)
USE_GUN_DETECTOR = _env_bool("DETECT_USE_GUN", False)

DEBUG_OVERLAY = True

RECONNECT_MAX        = 3
RECONNECT_GAP        = 2.0
STREAM_STALE_TIMEOUT = 5.0
WAKE_RETRIES         = 20
WAKE_DELAY           = 1.5
WAKE_TIMEOUT         = 2

# preset ที่โหลดเมื่อกล้องแจ้งว่ายังส่ง preview ไม่ได้ (status 55 = 0)
# อาการ: stream/start ตอบ 200 แต่ไม่มี UDP มาเลย — โหลด preset แล้วกล้องกลับมาส่งภาพ
LIVE_PRESET_ID = _env_num("LIVE_PRESET_ID", 0)

# ═══ ค่าจูนการตรวจจับท่ายิง — override ได้จาก .env (แก้แล้วรีสตาร์ท server) ═══
STABLE_SECONDS   = _env_num("DETECT_STABLE_SECONDS", 3.0)    # ค้างท่ากี่วิถึง trigger
COOLDOWN         = _env_num("DETECT_COOLDOWN", 5.0)
ARM_STRAIGHT_DEG = _env_num("DETECT_ARM_STRAIGHT_DEG", 150)  # ปืนสั้น: ข้อศอกเหยียดขั้นต่ำ
HORIZ_TOL_DEG    = _env_num("DETECT_HORIZ_TOL_DEG", 25)      # ปืนสั้น: เบนจากแนวนอนได้ไม่เกิน

# ── ท่าปืนยาว (rifle): มือทั้งคู่ยื่นไปทางเป้า ยกระดับอก แขนหลังงอ มือแยกห่างกัน ──
RIFLE_FRONT_MIN_DEG = _env_num("DETECT_RIFLE_FRONT_MIN_DEG", 60)   # แค่กันแขนพับสุด (รองรับท่า compact)
RIFLE_HORIZ_TOL     = _env_num("DETECT_RIFLE_HORIZ_TOL", 45)
RIFLE_REAR_MAX_DEG  = _env_num("DETECT_RIFLE_REAR_MAX_DEG", 130)
RIFLE_REAR_RAISE_R  = _env_num("DETECT_RIFLE_REAR_RAISE_R", 0.7)
RIFLE_MIN_SEP_R     = _env_num("DETECT_RIFLE_MIN_SEP_R", 0.25)     # มือ 2 ข้างต้องห่างกันขั้นต่ำ (×ความยาวแขน)

HAND_DIST_TOL_R  = _env_num("DETECT_HAND_DIST_TOL_R", 1.0)
MOVE_TOL_R       = _env_num("DETECT_MOVE_TOL_R", 0.5)        # ขยับได้แค่ไหนไม่รีเซ็ตเวลานับ
KP_CONF          = _env_num("DETECT_KP_CONF", 0.3)           # ความมั่นใจขั้นต่ำของ keypoint
AIM_DIR          = _env_num("DETECT_AIM_DIR", 1)             # 1=หันขวา, -1=หันซ้าย, 0=ได้ทั้งสอง

L_SH, R_SH, L_EL, R_EL, L_WR, R_WR = 5, 6, 7, 8, 9, 10

if torch.backends.mps.is_available():
    DEVICE = "mps"
elif torch.cuda.is_available():
    DEVICE = "cuda"
else:
    DEVICE = "cpu"

_FALLBACK_DEVICE = "cpu"   # ใช้เมื่อ DEVICE หลักล้มเหลว

# รันบน CPU (Pi): เว้น core ไว้ให้ ffmpeg decode ภาพ + web server ไม่งั้นภาพสดดีเลย์สะสม
if DEVICE == "cpu":
    torch.set_num_threads(max(1, _env_num("DETECT_TORCH_THREADS", (os.cpu_count() or 4) - 1)))

FONT = cv2.FONT_HERSHEY_SIMPLEX

# ─── Models (โหลดครั้งเดียว, ใช้ร่วมกันทุก channel) ─────────────────────────
_pose_model: Optional[YOLO] = None
_det_model:  Optional[YOLO] = None
_model_lock = threading.Lock()


def _load_models():
    global _pose_model, _det_model
    with _model_lock:
        if _pose_model is None:
            print(f"  [Detect] โหลด pose model (device={DEVICE})...")
            _pose_model = YOLO("yolo11n-pose.pt")
            if USE_GUN_DETECTOR:
                print(f"  [Detect] โหลด gun detector ({DET_MODEL})...")
                _det_model = YOLO(DET_MODEL)
            else:
                print(f"  [Detect] USE_GUN_DETECTOR=False — ข้าม gun detector")
            print("  [Detect] โหลดโมเดลเสร็จ")
    return _pose_model, _det_model


# ─── Logic ───────────────────────────────────────────────────────────────────
def angle(a, b, c):
    ba, bc = a - b, c - b
    cos = np.dot(ba, bc) / (np.linalg.norm(ba) * np.linalg.norm(bc) + 1e-6)
    return math.degrees(math.acos(max(-1.0, min(1.0, cos))))


def _arm_metrics(kp, kc, sh, el, wr):
    if min(kc[sh], kc[el], kc[wr]) < KP_CONF:
        return None
    arm_len = np.linalg.norm(kp[sh] - kp[el]) + np.linalg.norm(kp[el] - kp[wr])
    if arm_len < 1:
        return None
    elbow = angle(kp[sh], kp[el], kp[wr])
    v = kp[wr] - kp[sh]
    horiz = math.degrees(math.atan2(abs(v[1]), abs(v[0]) + 1e-6))
    return {"wrist": kp[wr], "sh": kp[sh], "arm_len": float(arm_len), "elbow": elbow,
            "horiz": horiz, "vx": float(v[0]), "conf": float(min(kc[sh], kc[el], kc[wr]))}


def evaluate(pose_res, obj_centers):
    info = {"cond": False, "aiming": False, "has_object": False,
            "point": None, "scale": None, "dbg": None, "stance": None}
    if pose_res.keypoints is None or pose_res.keypoints.xy is None:
        return info
    xy = pose_res.keypoints.xy.cpu().numpy()
    cf = pose_res.keypoints.conf
    cf = cf.cpu().numpy() if cf is not None else np.ones(xy.shape[:2])

    for p in range(xy.shape[0]):
        kp, kc = xy[p], cf[p]
        best = None
        stance = None
        seen = []
        for sh, el, wr in [(L_SH, L_EL, L_WR), (R_SH, R_EL, R_WR)]:
            m = _arm_metrics(kp, kc, sh, el, wr)
            if m is None:
                continue
            seen.append(m)
            # ── (1) ท่าปืนสั้น: แขนเหยียดตรง + แนวนอน ──
            extended   = m["elbow"] > ARM_STRAIGHT_DEG
            horizontal = m["horiz"] < HORIZ_TOL_DEG
            dir_ok     = (AIM_DIR == 0) or (np.sign(m["vx"]) == AIM_DIR)
            if extended and horizontal and dir_ok:
                if best is None or m["conf"] > best["conf"]:
                    best = m
                    stance = "pistol"

        # ── (2) ท่าปืนยาว: ต้องเห็น 2 แขน (รองรับทั้งแขนหน้าเหยียดและท่า compact แขนงอ)
        #     เงื่อนไข: มือทั้งคู่ยื่นไปทางเป้า + ยกระดับอก + แขนหลังงอ + มือแยกห่างกัน
        if best is None and len(seen) == 2:
            d = AIM_DIR if AIM_DIR != 0 else (1 if (seen[0]["vx"] + seen[1]["vx"]) >= 0 else -1)
            # แขนหน้า = ข้างที่ข้อมือยื่นไปทางเป้ามากกว่า
            front, rear = ((seen[0], seen[1])
                           if seen[0]["vx"] * d >= seen[1]["vx"] * d
                           else (seen[1], seen[0]))
            avg_len = (front["arm_len"] + rear["arm_len"]) / 2.0
            sep = abs(float(front["wrist"][0]) - float(rear["wrist"][0]))

            front_ok = (front["vx"] * d > 0.3 * avg_len            # มือหน้ายื่นไปทางเป้าจริง
                        and front["horiz"] < RIFLE_HORIZ_TOL
                        and front["elbow"] > RIFLE_FRONT_MIN_DEG)  # กันแค่แขนพับสุด
            rear_ok = (rear["elbow"] < RIFLE_REAR_MAX_DEG          # แขนหลังงอจับด้าม
                       and rear["vx"] * d > 0                      # มือหลังอยู่ฝั่งเป้าเช่นกัน
                       and rear["wrist"][1] < rear["sh"][1] + RIFLE_REAR_RAISE_R * rear["arm_len"])
            if front_ok and rear_ok and sep > RIFLE_MIN_SEP_R * avg_len:
                best = front
                stance = "rifle"

        if info["dbg"] is None and seen:
            info["dbg"] = max(seen, key=lambda d: d["conf"])

        if best is None:
            continue

        info["aiming"] = True
        info["stance"] = stance
        info["point"]  = best["wrist"]
        info["scale"]  = best["arm_len"]
        info["dbg"]    = best

        near = any(
            np.linalg.norm(np.array(oc) - best["wrist"]) < HAND_DIST_TOL_R * best["arm_len"]
            for oc in obj_centers
        )
        info["has_object"] = near
        # USE_GUN_DETECTOR=False → ท่าแขนอย่างเดียวพอ ไม่ต้องตรวจวัตถุ
        info["cond"] = near if USE_GUN_DETECTOR else True
        if info["cond"]:
            return info
    return info


class AimTrigger:
    IDLE, CONFIRM, FIRED, COOL = "IDLE", "CONFIRMING", "TRIGGERED", "COOLDOWN"

    def __init__(self):
        self.state = self.IDLE
        self.t0 = None
        self.anchor = None
        self.cool_until = 0.0

    def update(self, cond, point, scale, now):
        if now < self.cool_until:
            self.state = self.COOL
            return self.state, None
        if cond:
            if self.state in (self.IDLE, self.COOL, self.FIRED):
                self.state = self.CONFIRM
                self.t0 = now
                self.anchor = point
                return self.state, STABLE_SECONDS
            if self.state == self.CONFIRM:
                if self.anchor is not None and point is not None and scale:
                    if np.linalg.norm(point - self.anchor) > MOVE_TOL_R * scale:
                        self.t0 = now
                        self.anchor = point
                held = now - self.t0
                if held >= STABLE_SECONDS:
                    self.state = self.FIRED
                    self.cool_until = now + COOLDOWN
                    return self.state, 0.0
                return self.state, STABLE_SECONDS - held
        else:
            self.state = self.IDLE
            self.t0 = None
            self.anchor = None
        return self.state, None


# ─── Draw ─────────────────────────────────────────────────────────────────────
def draw_status(img, state, remaining, info):
    col = {AimTrigger.IDLE: (160, 160, 160), AimTrigger.CONFIRM: (0, 165, 255),
           AimTrigger.FIRED: (0, 0, 255), AimTrigger.COOL: (0, 200, 0)}.get(state, (200, 200, 200))
    cv2.rectangle(img, (0, 0), (WIDTH, 34), (0, 0, 0), -1)
    cv2.putText(img, f"STATE: {state}", (10, 24), FONT, 0.7, col, 2)

    aim_c = (0, 255, 0) if info["aiming"] else (90, 90, 90)
    obj_c = (0, 255, 0) if info["has_object"] else (90, 90, 90)
    if info.get("stance"):
        cv2.putText(img, info["stance"].upper(), (WIDTH - 340, 24), FONT, 0.6, (0, 255, 255), 2)
    cv2.putText(img, "AIM", (WIDTH - 210, 24), FONT, 0.6, aim_c, 2)
    cv2.putText(img, TARGET_CLASS.upper(), (WIDTH - 150, 24), FONT, 0.6, obj_c, 2)

    if DEBUG_OVERLAY and info.get("dbg") is not None:
        d = info["dbg"]
        ec = (0, 255, 0) if d["elbow"] > ARM_STRAIGHT_DEG else (0, 0, 255)
        hc = (0, 255, 0) if d["horiz"] < HORIZ_TOL_DEG else (0, 0, 255)
        cv2.putText(img, f"elbow {d['elbow']:5.0f} (>{ARM_STRAIGHT_DEG})",
                    (10, 56), FONT, 0.55, ec, 2)
        cv2.putText(img, f"horiz {d['horiz']:5.0f} (<{HORIZ_TOL_DEG})",
                    (10, 78), FONT, 0.55, hc, 2)
        wx, wy = int(d["wrist"][0]), int(d["wrist"][1])
        cv2.line(img, (wx - 60, wy), (wx + 60, wy), (200, 200, 200), 1)

    if state == AimTrigger.CONFIRM and remaining is not None:
        cv2.putText(img, f"{max(remaining,0):.1f}", (WIDTH // 2 - 70, HEIGHT // 2),
                    FONT, 3.0, (0, 165, 255), 6)
        frac = 1 - remaining / STABLE_SECONDS
        cv2.rectangle(img, (40, HEIGHT - 40), (WIDTH - 40, HEIGHT - 22), (90, 90, 90), 2)
        cv2.rectangle(img, (40, HEIGHT - 40),
                      (40 + int((WIDTH - 80) * max(0, min(1, frac))), HEIGHT - 22),
                      (0, 165, 255), -1)

    if state == AimTrigger.FIRED:
        cv2.putText(img, "RECORD!", (WIDTH // 2 - 140, HEIGHT // 2), FONT, 2.0, (0, 0, 255), 6)

    if info["point"] is not None:
        x, y = int(info["point"][0]), int(info["point"][1])
        cv2.circle(img, (x, y), 12, (0, 165, 255), 3)


# ─── Stream / Wake ───────────────────────────────────────────────────────────
def _http_get(base: str, path: str, timeout=5, silent=False):
    """ยิง GET พร้อม ?password= (STA mode) และ trust_env=False (ไม่ผ่าน proxy)"""
    # แยก IP จาก base เพื่อ lookup password
    ip = base.split("//")[-1].split(":")[0]
    pw = _get_password(ip)
    params = {"password": pw} if pw else None
    try:
        r = _detect_session.get(base + path, timeout=timeout, params=params)
        return r.status_code
    except requests.exceptions.RequestException as e:
        if not silent:
            print(f"  [Detect] ERR {path}: {e}")
        return None


def _http_json(base: str, path: str, timeout=3) -> dict:
    """GET แล้วคืน JSON ({} ถ้าล้มเหลว)"""
    ip = base.split("//")[-1].split(":")[0]
    pw = _get_password(ip)
    params = {"password": pw} if pw else None
    try:
        r = _detect_session.get(base + path, timeout=timeout, params=params)
        return r.json() if r.status_code == 200 else {}
    except (requests.exceptions.RequestException, ValueError):
        return {}


def _preview_available(base: str, tries=6) -> bool:
    """
    status 55 = กล้องพร้อมส่ง preview — คืน False เฉพาะตอนกล้องบอกชัดว่า 0
    (อ่าน state ไม่ได้ / ไม่มี key → ไม่บล็อก ปล่อยให้ไปวัดจากเฟรมแรกแทน)
    """
    for i in range(tries):
        status = _http_json(base, "/gopro/camera/state").get("status")
        if not status or status.get("55", 1) != 0:
            return True
        if i < tries - 1:
            time.sleep(0.5)
    return False


def _keep_alive(base: str, stop_event: threading.Event):
    while not stop_event.is_set():
        _http_get(base, "/gopro/camera/keep_alive", timeout=3, silent=True)
        stop_event.wait(2.5)


def _cam_awake(base: str) -> bool:
    return _http_get(base, "/gopro/camera/keep_alive",
                     timeout=WAKE_TIMEOUT, silent=True) == 200


def _wake_camera(base: str, stop_event: Optional[threading.Event] = None) -> bool:
    if _cam_awake(base):
        return True
    print(f"  [Detect] ปลุกกล้อง {base}...")
    for i in range(1, WAKE_RETRIES + 1):
        if stop_event is not None and stop_event.is_set():
            return False
        _http_get(base, "/gopro/camera/keep_alive", timeout=WAKE_TIMEOUT, silent=True)
        _http_get(base, "/gopro/camera/control/wired_usb?p=1", timeout=WAKE_TIMEOUT, silent=True)
        if _cam_awake(base):
            print(f"  [Detect] กล้องตื่นแล้ว (ครั้งที่ {i})")
            time.sleep(1.0)
            return True
        time.sleep(WAKE_DELAY)
    print(f"  [Detect] ปลุกไม่สำเร็จ: {base}")
    return False


def _read_exact(stream, n):
    buf = b""
    while len(buf) < n:
        chunk = stream.read(n - len(buf))
        if not chunk:
            return None
        buf += chunk
    return buf


class FrameGrabber(threading.Thread):
    def __init__(self, proc, first_frame=None):
        super().__init__(daemon=True)
        self.proc = proc
        self.lock = threading.Lock()
        self.latest = first_frame
        self.last_update = time.time()
        self.running = True

    def run(self):
        while self.running:
            raw = _read_exact(self.proc.stdout, FRAME_SIZE)
            if raw is None:
                self.running = False
                break
            frame = np.frombuffer(raw, np.uint8).reshape((HEIGHT, WIDTH, 3))
            with self.lock:
                self.latest = frame
                self.last_update = time.time()

    def read(self):
        with self.lock:
            return None if self.latest is None else self.latest.copy()

    def stale_for(self):
        with self.lock:
            return time.time() - self.last_update


# log warning/error ของ ffmpeg (เช่น "corrupt decoded frame", "concealing errors" ตอน
# packet จากกล้องมาไม่ครบ, bind พอร์ตไม่ได้) — ดูตอนภาพเพี้ยน/ต่อ stream ไม่ได้
FFMPEG_LOG = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".session", "ffmpeg_stream.log")
FFMPEG_LOG_MAX = 5 * 1024 * 1024   # เกินนี้เริ่มไฟล์ใหม่ (log เต็ม SD card ไม่ได้)


def _open_ffmpeg_log(base: str, port: int):
    os.makedirs(os.path.dirname(FFMPEG_LOG), exist_ok=True)
    try:
        if os.path.getsize(FFMPEG_LOG) > FFMPEG_LOG_MAX:
            os.replace(FFMPEG_LOG, FFMPEG_LOG + ".old")
    except OSError:
        pass
    log = open(FFMPEG_LOG, "a", encoding="utf-8", errors="replace")
    log.write(f"\n── {time.strftime('%F %T')} เริ่ม pipeline {base} port={port} ──\n")
    log.flush()
    return log


def _start_pipeline(base: str, port: int = PORT,
                    stop_event: Optional[threading.Event] = None):
    def stopped():
        return stop_event is not None and stop_event.is_set()

    if not _wake_camera(base, stop_event) or stopped():
        return None
    _http_get(base, "/gopro/camera/control/wired_usb?p=1")
    _http_get(base, "/gopro/camera/stream/stop", silent=True)
    time.sleep(0.3)

    # กล้องบางสถานะตอบ stream/start 200 แต่ไม่ส่งภาพ (status 55 = 0) → โหลด preset ปกติก่อน
    if not _preview_available(base, tries=2):
        print(f"  [Detect] กล้องยังไม่พร้อมส่ง preview (status 55=0) → โหลด preset {LIVE_PRESET_ID}")
        _http_get(base, f"/gopro/camera/presets/load?id={LIVE_PRESET_ID}")
        if not _preview_available(base):
            print("  [Detect] โหลด preset แล้วกล้องก็ยังไม่พร้อมส่ง preview")
            return None
    if stopped():
        return None

    # ?port= ให้แต่ละกล้องยิง UDP มาคนละพอร์ต → เปิด stream หลายช่องพร้อมกันได้
    if _http_get(base, f"/gopro/camera/stream/start?port={port}") != 200:
        return None

    # - probesize/analyzeduration ต่ำ: stream มี track ที่ ffmpeg หา parameter ไม่เจอ (ac3 0 channel, data)
    #   ค่า default ทำให้รอ probe ~5 วิ แล้วเล่นภาพค้างใน buffer (วัดได้: เฟรมแรก 8.0s → 1.7s)
    # - fifo_size หน่วยเป็น packet 188 byte: 20000 ≈ 3.8 MB (เดิม 5000000 ≈ 940 MB → ดีเลย์สะสม)
    # - -map 0:v:0 ไม่ต้อง demux/decode เสียง
    # - discardcorrupt = ทิ้งเฟรมที่ decode พังไปเลย (ไม่ส่งภาพบล็อก/สีเพี้ยนออกมา)
    #   ignore_err กัน ffmpeg ตายเวลาเจอ NALU/packet เสียรัวๆ ตอนสาย USB หลุดสั้นๆ
    cmd = ["ffmpeg", "-nostdin", "-loglevel", "warning",
           "-fflags", "nobuffer+discardcorrupt", "-flags", "low_delay",
           "-err_detect", "ignore_err",
           "-probesize", "500000", "-analyzeduration", "500000",
           "-f", "mpegts", "-i", f"udp://@0.0.0.0:{port}?overrun_nonfatal=1&fifo_size=20000",
           "-map", "0:v:0", "-an", "-sn", "-dn",
           "-vf", f"scale={WIDTH}:{HEIGHT}:flags=fast_bilinear",
           "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
    log_path = FFMPEG_LOG
    # ffmpeg dup fd ของ log เก็บไว้ใช้เอง — ปิด handle ฝั่ง python ได้เลยหลัง Popen
    with _open_ffmpeg_log(base, port) as err_log:
        proc = subprocess.Popen(cmd, stdout=subprocess.PIPE,
                                stderr=err_log, bufsize=FRAME_SIZE)

    # รอเฟรมแรกเป็นช่วงสั้นๆ เพื่อให้ยกเลิกได้ระหว่างรอ
    deadline = time.time() + FIRST_FRAME_TIMEOUT
    ready = []
    while not ready and time.time() < deadline and not stopped():
        ready, _, _ = select.select([proc.stdout], [], [], 0.5)

    # select() คืน ready ตอน ffmpeg ตาย (EOF) ด้วย → ต้องได้ครบ 1 เฟรมจริงถึงนับว่าสำเร็จ
    raw = _read_exact(proc.stdout, FRAME_SIZE) if ready else None
    if raw is None:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
        _http_get(base, "/gopro/camera/stream/stop", silent=True)
        if ready:
            print(f"  [Detect] ffmpeg ปิดตัวเองก่อนได้เฟรมแรก — ดูสาเหตุใน {log_path}")
        elif not stopped():
            print(f"  [Detect] ไม่ได้ภาพภายใน {FIRST_FRAME_TIMEOUT}s (udp:{port})")
        return None

    first = np.frombuffer(raw, np.uint8).reshape((HEIGHT, WIDTH, 3))
    grabber = FrameGrabber(proc, first_frame=first)
    grabber.start()
    return proc, grabber


def _connect(base: str, max_tries: int, port: int = PORT,
             stop_event: Optional[threading.Event] = None):
    for attempt in range(1, max_tries + 1):
        if stop_event is not None and stop_event.is_set():
            return None
        print(f"  [Detect] เชื่อมต่อ {base} (udp:{port}) รอบที่ {attempt}/{max_tries}")
        pipeline = _start_pipeline(base, port, stop_event)
        if pipeline:
            return pipeline
        if attempt < max_tries:
            if stop_event is not None:
                stop_event.wait(RECONNECT_GAP)
            else:
                time.sleep(RECONNECT_GAP)
    return None


def _stop_pipeline(proc, grabber, base: str):
    if grabber:
        grabber.running = False
    if proc:
        proc.terminate()
        try:
            proc.wait(timeout=2)
        except subprocess.TimeoutExpired:
            proc.kill()
    _http_get(base, "/gopro/camera/stream/stop", silent=True)


# ─── Public API ──────────────────────────────────────────────────────────────

def run(camera_ip: str,
        on_trigger: Callable,
        stop_event: threading.Event,
        show_window: bool = False,
        frame_queue=None,
        on_ready: "Optional[Callable]" = None,
        stream_port: int = PORT):
    """
    รันการตรวจจับสำหรับกล้อง IP ที่กำหนด
    - camera_ip   : IP ของกล้องที่ใช้ stream
    - on_trigger  : callable() เรียกเมื่อตรวจจับท่าได้ → ระบบหยุด detect อัตโนมัติ
    - stop_event  : threading.Event → set จากภายนอกเพื่อยกเลิก
    - show_window : True = แสดงหน้าต่าง OpenCV (standalone เท่านั้น — main thread)
    - frame_queue : queue.Queue → ใส่ annotated frame เพื่อให้ main thread แสดงผล
    - on_ready    : callable() เรียกเมื่อกล้อง connect สำเร็จและได้ frame แรกแล้ว
    - stream_port : พอร์ต UDP รับ stream (แยกพอร์ตต่อกล้อง → หลายช่องพร้อมกันได้)
    """
    base = f"http://{camera_ip}:8080"
    pose_model, det_model = _load_models()

    # ตั้งค่า target class — เฉพาะเมื่อเปิดใช้ gun detector
    target_id = None
    if USE_GUN_DETECTOR:
        if det_model is None:
            print(f"  [Detect] USE_GUN_DETECTOR=True แต่ _det_model=None — reload")
            _, det_model = _load_models()
        ids = [i for i, n in det_model.names.items() if n == TARGET_CLASS]
        if not ids:
            print(f"  [Detect] ไม่พบ class: {TARGET_CLASS}")
            return
        target_id = ids[0]

    ka_stop = threading.Event()
    threading.Thread(target=_keep_alive, args=(base, ka_stop), daemon=True).start()

    pipeline = _connect(base, RECONNECT_MAX, stream_port, stop_event)
    if pipeline is None:
        print(f"  [Detect] เชื่อมต่อไม่สำเร็จ {RECONNECT_MAX} รอบ — หยุด")
        ka_stop.set()
        return
    proc, grabber = pipeline

    trigger = AimTrigger()
    t_prev = time.time()
    frame_idx = 0
    det_res = None
    _active_device = DEVICE    # local — เปลี่ยนได้โดยไม่กระทบ global
    _ready_fired = False       # เรียก on_ready ครั้งเดียวเมื่อได้ frame แรก

    try:
        while not stop_event.is_set():
            # ตรวจสตรีมหลุด
            if (not grabber.running) or grabber.stale_for() > STREAM_STALE_TIMEOUT:
                _stop_pipeline(proc, grabber, base)
                time.sleep(1.0)
                pipeline = _connect(base, RECONNECT_MAX, stream_port, stop_event)
                if pipeline is None:
                    break
                proc, grabber = pipeline
                t_prev = time.time()
                continue

            frame = grabber.read()
            if frame is None:
                time.sleep(0.005)
                continue

            # ── เรียก on_ready ครั้งแรกที่ได้ frame จริง ─────────────────────
            if not _ready_fired and on_ready is not None:
                _ready_fired = True
                try:
                    on_ready()
                except Exception:
                    pass

            # ── Inference พร้อม fallback MPS→CPU ────────────────────────────
            # ใช้ตัวแปร local `_active_device` แทน — ไม่แตะ global DEVICE
            try:
                pose_res = pose_model(frame, device=_active_device, conf=CONF,
                                      imgsz=IMGSZ, verbose=False)[0]
                if USE_GUN_DETECTOR and frame_idx % DET_EVERY == 0:
                    det_res = det_model(frame, device=_active_device, conf=CONF,
                                        classes=[target_id], imgsz=IMGSZ, verbose=False)[0]
            except Exception as infer_err:
                if _active_device != _FALLBACK_DEVICE:
                    print(f"  [Detect] {_active_device} error ({infer_err}) → fallback CPU")
                    _active_device = _FALLBACK_DEVICE
                    try:
                        pose_res = pose_model(frame, device=_active_device, conf=CONF,
                                              imgsz=IMGSZ, verbose=False)[0]
                        if USE_GUN_DETECTOR and frame_idx % DET_EVERY == 0:
                            det_res = det_model(frame, device=_active_device, conf=CONF,
                                                classes=[target_id], imgsz=IMGSZ, verbose=False)[0]
                    except Exception as e2:
                        print(f"  [Detect] CPU inference ก็ fail: {e2}")
                        continue
                else:
                    print(f"  [Detect] inference error: {infer_err}")
                    continue

            obj_centers = []
            if USE_GUN_DETECTOR and det_res is not None:
                for box in det_res.boxes:
                    x1, y1, x2, y2 = map(int, box.xyxy[0])
                    obj_centers.append(((x1 + x2) / 2, (y1 + y2) / 2))

            info = evaluate(pose_res, obj_centers)
            now = time.time()
            state, remaining = trigger.update(info["cond"], info["point"], info["scale"], now)

            # ── TRIGGER ──────────────────────────────────────────────────────
            if state == AimTrigger.FIRED:
                print(f"  [Detect] TRIGGER! → หยุด detect แล้วส่ง on_trigger")
                ka_stop.set()
                _stop_pipeline(proc, grabber, base)
                if show_window:
                    cv2.destroyAllWindows()
                on_trigger()   # ← เรียก callback → main.py จัดการต่อ
                return

            # ── Annotated frame (สำหรับ window หรือ queue) ───────────────────
            if show_window or frame_queue is not None:
                annotated = pose_res.plot()
                if USE_GUN_DETECTOR and det_res is not None:
                    for box in det_res.boxes:
                        x1, y1, x2, y2 = map(int, box.xyxy[0])
                        cv2.rectangle(annotated, (x1, y1), (x2, y2), (0, 0, 255), 2)
                draw_status(annotated, state, remaining, info)
                fps = 1.0 / (now - t_prev) if now > t_prev else 0.0
                cv2.putText(annotated, f"{_active_device} {fps:4.1f}fps",
                            (10, HEIGHT - 10), FONT, 0.5, (0, 255, 0), 1)

                # standalone: imshow ใน main thread ได้
                if show_window:
                    cv2.imshow(f"Detect [{camera_ip}]", annotated)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        stop_event.set()
                        break

                # ส่ง frame ไปแสดงใน main thread (ไม่ block ถ้า queue เต็ม)
                if frame_queue is not None:
                    try:
                        frame_queue.put_nowait(annotated)
                    except Exception:
                        pass

            t_prev = now
            frame_idx += 1

    finally:
        ka_stop.set()
        _stop_pipeline(proc, grabber, base)
        if show_window:
            cv2.destroyAllWindows()
        # ส่ง sentinel None → main thread ปิดหน้าต่าง Detect
        if frame_queue is not None:
            try:
                frame_queue.put(None, timeout=1)
            except Exception:
                pass


# ─── Standalone (python detect_stream.py) ────────────────────────────────────

def _standalone_trigger():
    print(f"\n🔴 [{time.strftime('%H:%M:%S')}] TRIGGER! → จะเริ่มอัด slo-mo\n")


def main():
    ip = os.getenv("CH1_CAM1_IP", "172.21.168.51")
    print(f"Standalone detect — กล้อง {ip} | กด q เพื่อออก")
    stop = threading.Event()
    run(camera_ip=ip, on_trigger=_standalone_trigger,
        stop_event=stop, show_window=True)


if __name__ == "__main__":
    main()
