"""โหลดค่าจาก .env แล้วแปลงเป็น object ของ channel/camera (จุดเดียวที่แก้ค่า)"""
import os
from dataclasses import dataclass
from dotenv import load_dotenv
from typing import Optional

ENV_PATH = os.path.join(os.path.dirname(__file__), ".env")
load_dotenv(ENV_PATH)


def _as_bool(value, default=False):
    if value is None:
        return default
    return value.strip().lower() in ("1", "true", "yes", "on")


# ----- UDP ports -----
UDP_LISTEN_PORT  = int(os.getenv("UDP_LISTEN_PORT",  "12344"))  # รับจาก ESP32
UDP_DISPLAY_PORT = int(os.getenv("UDP_DISPLAY_PORT", "12345"))  # ส่งไป ESP32

# ----- lane / station id -----
# ระบุว่าเครื่องนี้อยู่ "เลนไหน" — ใช้เป็นเลขนำหน้า session code (เช่น LANE_ID=2 → S2-0001, S2-0002, ...)
# ต้องตั้งไม่ซ้ำกันทุกเครื่องที่อัปโหลดขึ้นคลาวด์เดียวกัน (shot24.shop) ไม่งั้น session code จะชนกัน
# (ต่างจาก NUM_CHANNELS/ch ด้านล่าง ซึ่งเป็นเลขช่องกล้อง*ภายใน*เครื่องเดียว ไม่ใช่เลขเลนจริง)
LANE_ID = os.getenv("LANE_ID", "1").strip() or "1"

# ----- global settings -----
PORT = int(os.getenv("PORT", "8080"))
PRESET_ID = int(os.getenv("PRESET_ID", "262144"))
RECORD_SECONDS = int(os.getenv("RECORD_SECONDS", "10"))
DOWNLOAD_ROOT = os.getenv("DOWNLOAD_ROOT", "downloads")
DOWNLOAD_WAIT = int(os.getenv("DOWNLOAD_WAIT", "30"))   # รอ finalize สูงสุด 30s
NUM_CHANNELS = int(os.getenv("NUM_CHANNELS", "4"))
CAMS_PER_CHANNEL = int(os.getenv("CAMS_PER_CHANNEL", "2"))


@dataclass
class CameraConfig:
    name: str          # เช่น "ch1_cam1"
    ip: str
    enabled: bool
    channel_index: int
    cam_index: int


@dataclass
class ChannelConfig:
    name: str          # เช่น "channel-1"
    index: int
    cameras: list      # list[CameraConfig]


def load_channels():
    """อ่านทุก channel/camera จาก .env"""
    channels = []
    for ch in range(1, NUM_CHANNELS + 1):
        cams = []
        for cam in range(1, CAMS_PER_CHANNEL + 1):
            ip = (os.getenv(f"CH{ch}_CAM{cam}_IP") or "").strip()
            if not ip:
                continue
            cams.append(CameraConfig(
                name=f"ch{ch}_cam{cam}",
                ip=ip,
                enabled=_as_bool(os.getenv(f"CH{ch}_CAM{cam}_ENABLED")),
                channel_index=ch,
                cam_index=cam,
            ))
        channels.append(ChannelConfig(name=f"channel-{ch}", index=ch, cameras=cams))
    return channels


def mac_to_channel(mac: str) -> Optional[int]:
    """แปลง MAC address ของ ESP32 → channel index (1-based), None ถ้าไม่รู้จัก"""
    mac_upper = mac.strip().upper()
    for ch in range(1, NUM_CHANNELS + 1):
        stored = os.getenv(f"ESP32_CH{ch}_MAC", "").strip().upper()
        if stored and stored == mac_upper:
            return ch
    return None


def get_esp_mac(channel_index: int) -> Optional[str]:
    """คืน MAC address ของ ESP32 สำหรับ channel นั้น"""
    return os.getenv(f"ESP32_CH{channel_index}_MAC", "").strip().upper() or None


def get_detect_ip(channel_index: int) -> str:
    """คืน IP กล้องตัวแรกของ channel สำหรับใช้ detect (stream)"""
    ip = (os.getenv(f"CH{channel_index}_CAM1_IP") or "").strip()
    return ip


def set_camera_enabled(channel_index, cam_index, enabled):
    """เปิด/ปิดกล้องแบบถาวร (แก้บรรทัดใน .env ให้) = ปุ่มเปิด/ปิดรายกล้อง"""
    key = f"CH{channel_index}_CAM{cam_index}_ENABLED"
    new_val = "true" if enabled else "false"
    lines = open(ENV_PATH, encoding="utf-8").read().splitlines()
    found = False
    for i, line in enumerate(lines):
        if line.strip().startswith(key + "="):
            lines[i] = f"{key}={new_val}"
            found = True
            break
    if not found:
        lines.append(f"{key}={new_val}")
    open(ENV_PATH, "w", encoding="utf-8").write("\n".join(lines) + "\n")
    return found