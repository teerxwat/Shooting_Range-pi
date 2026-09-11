"""
display.py — ส่งคำสั่งแสดงผลไปยัง LED Matrix ผ่าน UDP (Multi-Channel)
═══════════════════════════════════════════════════════════════════════
ESP32 broadcast: "GOPRO_DISPLAY|AA:BB:CC:DD:EE:FF" ทุก 5 วินาที
Mac รับ → เก็บ MAC→IP map อัตโนมัติ

Commands (UDP port 12345):
  READY            → หน้า "กดปุ่มเพื่อเริ่ม" (เขียว)
  DETECTING        → หน้า "กำลังตรวจจับ..." (ฟ้า)
  CD:<n>           → countdown n วินาที (30..1)
  REC:<n>          → RECORD + n วินาที (10..0)
  STOP             → หยุดบันทึก
  QR               → แสดง QR code (google.com)
  ERR:<msg>        → แสดง error message
"""

import socket
import threading
import time
import os
from dotenv import load_dotenv
import config

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

CMD_PORT       = config.UDP_DISPLAY_PORT
BROADCAST_PORT = config.UDP_LISTEN_PORT

# ─── State: MAC → IP map + button callback ──────────────────────────────────
_mac_to_ip: dict[str, str] = {}   # "AA:BB:CC:DD:EE:FF" → "192.168.1.x"
_lock = threading.Lock()

_cmd_sock: socket.socket | None = None

# callback เมื่อกดปุ่ม: set โดย main.py ผ่าน set_button_callback()
_button_callback: "Callable[[str], None] | None" = None

from typing import Callable, Optional


def set_button_callback(cb: "Callable[[str], None]"):
    """ลงทะเบียน callback สำหรับ BUTTON event (mac: str)"""
    global _button_callback
    _button_callback = cb


# ─── Discovery + Button thread ───────────────────────────────────────────────

def _discovery_thread():
    """
    รับ UDP broadcast จาก ESP32 บน port BROADCAST_PORT:
      "GOPRO_DISPLAY|AA:BB:CC:DD:EE:FF"  → discovery (อัปเดต MAC→IP map)
      "BUTTON|AA:BB:CC:DD:EE:FF"          → เรียก _button_callback(mac)
    """
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    sock.settimeout(1.0)
    try:
        sock.bind(("", BROADCAST_PORT))
    except Exception as e:
        print(f"  [Display] ไม่สามารถเปิด port {BROADCAST_PORT}: {e}")
        return

    print(f"  [Display] Discovery listening on port {BROADCAST_PORT}")
    while True:
        try:
            data, addr = sock.recvfrom(256)
            msg = data.decode(errors="ignore").strip()

            if msg.startswith("GOPRO_DISPLAY|"):
                mac = msg.split("|", 1)[1].strip().upper()
                ip  = addr[0]
                with _lock:
                    if _mac_to_ip.get(mac) != ip:
                        _mac_to_ip[mac] = ip
                        ch = config.mac_to_channel(mac)
                        label = f"ch{ch}" if ch else "unknown"
                        print(f"  [Display] ESP32 [{label}] {mac} → {ip} ✅")

            elif msg.startswith("BUTTON|"):
                mac = msg.split("|", 1)[1].strip().upper()
                print(f"  [Button] MAC={mac} from {addr[0]}")
                cb = _button_callback
                if cb:
                    threading.Thread(target=cb, args=(mac,), daemon=True).start()

        except socket.timeout:
            pass
        except Exception:
            time.sleep(1)


_discovery_t = threading.Thread(target=_discovery_thread, daemon=True)
_discovery_t.start()


# ─── Sender ──────────────────────────────────────────────────────────────────

def _get_sock() -> socket.socket | None:
    global _cmd_sock
    if _cmd_sock is None:
        try:
            _cmd_sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        except Exception:
            pass
    return _cmd_sock


def send_to_mac(mac: str, cmd: str):
    """ส่ง command ไปยัง ESP32 ที่มี MAC นี้"""
    mac = mac.strip().upper()
    with _lock:
        ip = _mac_to_ip.get(mac)
    if not ip:
        return   # ยังหา ESP32 ไม่เจอ → เพิกเฉย
    s = _get_sock()
    if s:
        try:
            s.sendto(cmd.encode(), (ip, CMD_PORT))
        except Exception:
            pass


def send_to_channel(ch_index: int, cmd: str):
    """ส่ง command ไปยัง ESP32 ของ channel นั้น"""
    mac = config.get_esp_mac(ch_index)
    if mac:
        send_to_mac(mac, cmd)


def send_to_all(cmd: str):
    """ส่ง command ไปทุก ESP32 ที่รู้จัก"""
    with _lock:
        ips = list(_mac_to_ip.values())
    s = _get_sock()
    if s:
        for ip in ips:
            try:
                s.sendto(cmd.encode(), (ip, CMD_PORT))
            except Exception:
                pass


# ─── High-level helpers (per channel) ───────────────────────────────────────

def ready(ch: int | None = None):
    if ch:
        send_to_channel(ch, "READY")
    else:
        send_to_all("READY")


def waiting(ch: int):
    """กำลังรอกล้องพร้อม (ก่อนที่ detect stream จะเชื่อมสำเร็จ)"""
    send_to_channel(ch, "WAIT")


def detecting(ch: int):
    send_to_channel(ch, "DETECTING")


def countdown_tick(ch: int, n: int):
    send_to_channel(ch, f"CD:{n}")


def record_tick(ch: int, n: int):
    send_to_channel(ch, f"REC:{n}")


def stop(ch: int):
    send_to_channel(ch, "STOP")


def show_qr(ch: int):
    send_to_channel(ch, "QR")


def show_error(ch: int, msg: str):
    """แสดง error บนจอ (ตัดให้สั้นถ้ายาวเกิน)"""
    short = msg[:30].replace("\n", " ")
    send_to_channel(ch, f"ERR:{short}")


def wait_for_display(ch: int, timeout: float = 15.0) -> bool:
    """รอจน ESP32 ของ channel นั้นออนไลน์"""
    mac = config.get_esp_mac(ch)
    if not mac:
        return False
    deadline = time.time() + timeout
    while time.time() < deadline:
        with _lock:
            if mac in _mac_to_ip:
                return True
        time.sleep(0.5)
    return False
