"""คลาสควบคุมกล้อง GoPro 1 ตัวผ่าน HTTP (รองรับทั้ง USB และ WiFi STA mode)"""
import os
import json
import time
import requests

# =============================================================================
# BLE Auth — อ่าน password จาก gopro_auth.json (สร้างโดย ble_pair.py)
# รูปแบบ: { "192.168.1.128": {"camera_id": "...", "password": "..."}, ... }
# ถ้าไม่มีไฟล์ = AP mode หรือ USB (ไม่ต้อง password)
# =============================================================================
_AUTH_FILE = os.path.join(os.path.dirname(__file__), "gopro_auth.json")
_auth_cache: dict | None = None


def _load_auth() -> dict:
    global _auth_cache
    if _auth_cache is not None:
        return _auth_cache
    if os.path.exists(_AUTH_FILE):
        try:
            _auth_cache = json.load(open(_AUTH_FILE))
        except Exception:
            _auth_cache = {}
    else:
        _auth_cache = {}
    return _auth_cache


def get_password_for(ip: str) -> str | None:
    """คืน HTTP API password ของกล้อง IP นี้ (ถ้ามี)"""
    return _load_auth().get(ip, {}).get("password")


# Session ที่ไม่ผ่าน proxy ใดๆ
_session = requests.Session()
_session.trust_env = False


class GoProCamera:
    def __init__(self, name, ip, port=8080, enabled=True, timeout=10):
        self.name = name
        self.ip = ip
        self.port = port
        self.enabled = enabled
        self.timeout = timeout
        self.base = f"http://{ip}:{port}"

    def _params(self, extra: dict | None = None) -> dict | None:
        """สร้าง query params พร้อม password (ถ้ามี) สำหรับ STA mode"""
        pw = get_password_for(self.ip)
        params = {}
        if pw:
            params["password"] = pw
        if extra:
            params.update(extra)
        return params or None

    # ---- low-level ----
    def _get(self, path, timeout=None, retries=0, retry_wait=1.0, silent=False,
             extra_params: dict | None = None):
        """
        ยิง GET; รองรับ timeout เฉพาะ call + retry เวลาเจอ connection error ชั่วคราว
        แนบ ?password= อัตโนมัติถ้ามี gopro_auth.json (STA mode)
        คืน dict (อาจว่าง) ถ้าสำเร็จ, None ถ้าล้มเหลว
        """
        # แยก query string ที่ติดมากับ path ออกมาใส่ params แทน
        # เช่น "/gopro/camera/control/wired_usb?p=1" → path="/...", params={"p":"1"}
        base_path = path
        inline_params: dict = {}
        if "?" in path:
            base_path, qs = path.split("?", 1)
            for part in qs.split("&"):
                if "=" in part:
                    k, v = part.split("=", 1)
                    inline_params[k] = v

        params = self._params({**inline_params, **(extra_params or {})})
        url = self.base + base_path

        last_err = None
        for attempt in range(retries + 1):
            try:
                r = _session.get(url, timeout=timeout or self.timeout, params=params)
                if r.status_code == 200:
                    try:
                        return r.json()
                    except ValueError:
                        return {}
                if not silent:
                    print(f"  [{self.name}] HTTP {r.status_code} {base_path}")
                return None
            except requests.exceptions.RequestException as e:
                last_err = e
                if attempt < retries:
                    time.sleep(retry_wait)      # รอแล้วลองใหม่
        if not silent:
            print(f"  [{self.name}] ERR {base_path}: {last_err}")
        return None

    def ping(self, timeout=4):
        data = self._get("/gopro/camera/state", timeout=timeout, silent=True)
        if data:
            return data.get("status", {}).get("70")
        return None

    def get_state(self, timeout=4, retries=2):
        return self._get("/gopro/camera/state", timeout=timeout,
                         retries=retries, silent=True)

    # ---- commands ----
    def enable_wired_control(self):
        return self._get("/gopro/camera/control/wired_usb?p=1", retries=2) is not None

    def load_preset(self, preset_id):
        return self._get(f"/gopro/camera/presets/load?id={preset_id}", retries=2) is not None

    def start_recording(self):
        return self._get("/gopro/camera/shutter/start", retries=2) is not None

    def stop_recording(self):
        return self._get("/gopro/camera/shutter/stop", retries=3, retry_wait=1.5) is not None

    def keep_alive(self):
        return self._get("/gopro/camera/keep_alive", timeout=3, silent=True) is not None

    def prime_stream(self, log=None):
        """
        ทำ stream start→stop สั้นๆ เพื่อ activate HTTP API กล้องให้พร้อม record
        (เลียนแบบสิ่งที่ detect_stream ทำกับ cam1 — ทำให้ทุก cam ผ่าน state เดียวกัน)
        คืน True ถ้า stream/start สำเร็จ
        """
        # หยุด stream เก่าก่อน (ถ้ามีค้างอยู่)
        self._get("/gopro/camera/stream/stop", silent=True)
        time.sleep(0.3)
        ok = self._get("/gopro/camera/stream/start") is not None
        if ok:
            time.sleep(0.5)
            self._get("/gopro/camera/stream/stop", silent=True)
            time.sleep(0.3)
        if log:
            log(f"  {self.name}: prime_stream → {'activated ✓' if ok else 'skip (stream/start failed)'}")
        return ok

    # ---- media ----
    def list_media(self, retries=2):
        data = self._get("/gopro/media/list", timeout=8, retries=retries, silent=True)
        files = set()
        if data:
            for d in data.get("media", []):
                directory = d.get("d", "")
                for f in d.get("fs", []):
                    files.add((directory, f.get("n", "")))
        return files

    def download(self, directory, filename, dest_folder, retries=5):
        """
        ดาวน์โหลดไฟล์วิดีโอจาก GoPro พร้อม progress log + retry
        - timeout=(15, 45): connect 15s, รอ chunk สูงสุด 45s
        - ก่อน retry ทุกครั้ง: ส่ง keep_alive + enable_wired_control ปลุกกล้อง
        - รองรับ HTTP Range (resume ต่อจากที่ค้างไว้)
        """
        os.makedirs(dest_folder, exist_ok=True)
        url = f"{self.base}/videos/DCIM/{directory}/{filename}"
        dest = os.path.join(dest_folder, filename)
        params = self._params()

        total = 0
        total_mb = 0.0
        written = 0       # ใช้ resume ต่อจากที่โหลดไปแล้ว
        last_pct = -1

        for attempt in range(1, retries + 1):
            try:
                # ถ้าโหลดค้างไปแล้ว → ขอ Range ต่อจากตรงนั้น
                headers = {}
                if written > 0:
                    headers["Range"] = f"bytes={written}-"
                    print(f"  [{self.name}]   resume จาก {written/(1024*1024):.1f} MB...")

                with _session.get(url, stream=True, timeout=(15, 45),
                                  params=params, headers=headers) as r:
                    # 206 = Partial Content (server รองรับ resume), 200 = ไม่รองรับ → เริ่มใหม่
                    if written > 0 and r.status_code == 200:
                        print(f"  [{self.name}]   server ไม่รองรับ resume → เริ่มใหม่")
                        written = 0
                        last_pct = -1

                    r.raise_for_status()

                    if written == 0:
                        total = int(r.headers.get("Content-Length", 0))
                        total_mb = total / (1024 * 1024) if total else 0
                        print(f"  [{self.name}] downloading {filename} "
                              f"({total_mb:.1f} MB)...")

                    mode = "ab" if written > 0 else "wb"
                    with open(dest, mode) as fp:
                        for chunk in r.iter_content(chunk_size=512 * 1024):
                            if not chunk:
                                break
                            fp.write(chunk)
                            written += len(chunk)
                            if total:
                                pct = written * 100 // total
                                if pct // 25 > last_pct // 25:
                                    last_pct = pct
                                    print(f"  [{self.name}]   {pct}% "
                                          f"({written/(1024*1024):.1f}/{total_mb:.1f} MB)")
                            if total and written >= total:
                                break

                print(f"  [{self.name}] download ✓ ({written/(1024*1024):.1f} MB)")
                return dest

            except requests.exceptions.RequestException as e:
                short = str(e).split("\n")[0][:80]
                print(f"  [{self.name}] download error (ครั้ง {attempt}/{retries}): {short}")

                if attempt < retries:
                    print(f"  [{self.name}]   ปลุกกล้อง + รอ 3s แล้วลองใหม่...")
                    # ปลุกกล้องก่อน retry — ป้องกันกล้องหลับระหว่าง download
                    try:
                        self.keep_alive()
                        self.enable_wired_control()
                    except Exception:
                        pass
                    time.sleep(3)

        # ล้างไฟล์ที่โหลดไม่สมบูรณ์
        if os.path.exists(dest):
            try:
                os.remove(dest)
            except OSError:
                pass
        print(f"  [{self.name}] download ล้มเหลวทั้ง {retries} ครั้ง — ข้ามไฟล์นี้")
        return None

    @classmethod
    def from_config(cls, cam_config, port, timeout=10):
        return cls(name=cam_config.name, ip=cam_config.ip, port=port,
                   enabled=cam_config.enabled, timeout=timeout)
