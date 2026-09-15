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

    def _status(self) -> dict:
        """status ของกล้อง ({} ถ้าอ่านไม่ได้)"""
        return (self.get_state(timeout=3, retries=0) or {}).get("status", {})

    def wait_ready(self, timeout=8.0):
        """
        รอจนกล้องว่าง: status 8 (busy) = 0 และ status 10 (encoding) = 0
        กล้องตอบ shutter/start ไม่สำเร็จถ้ายังโหลด preset / เขียนไฟล์ค้างอยู่
        """
        end = time.time() + timeout
        while time.time() < end:
            s = self._status()
            if s.get("8") == 0 and s.get("10") == 0:
                return True
            time.sleep(0.3)
        print(f"  [{self.name}] wait_ready: กล้องยังไม่ว่างหลัง {timeout:.0f}s")
        return False

    # ---- commands ----
    # timeout สั้น (4s) — ถ้ากล้องค้าง จะได้ไม่กินเวลาเตรียมกล้องจนเกิน countdown
    def enable_wired_control(self):
        return self._get("/gopro/camera/control/wired_usb?p=1", timeout=4, retries=2) is not None

    def load_preset(self, preset_id):
        return self._get(f"/gopro/camera/presets/load?id={preset_id}", timeout=4, retries=2) is not None

    def apply_setting(self, setting_id, option):
        """ตั้งค่ากล้อง เช่น resolution (setting 2), fps (setting 3) — กล้องตอบ error ถ้าไม่รองรับค่านั้น"""
        return self._get(f"/gopro/camera/setting?setting={setting_id}&option={option}",
                         timeout=4, retries=1) is not None

    def start_recording(self, attempts=3):
        """
        รอกล้องว่างก่อนกด shutter + ลองใหม่เมื่อกล้องตอบ error (เดิม retry เฉพาะตอนต่อไม่ติด)
        ถ้า request ก่อนหน้าหมดเวลาแต่กล้องเริ่มอัดไปแล้ว → ถือว่าสำเร็จ ไม่กดซ้ำ
        """
        for attempt in range(1, attempts + 1):
            if attempt > 1 and self._status().get("10") == 1:
                return True
            self.wait_ready()
            if self._get("/gopro/camera/shutter/start", timeout=5) is not None:
                return True
            if attempt < attempts:
                time.sleep(0.7)
        return False

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
        self._get("/gopro/camera/stream/stop", timeout=4, silent=True)
        time.sleep(0.3)
        ok = self._get("/gopro/camera/stream/start", timeout=4) is not None
        if ok:
            time.sleep(0.5)
            self._get("/gopro/camera/stream/stop", timeout=4, silent=True)
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

    # รอข้อมูลก้อนถัดไปได้นานสุด (วินาที) — ปกติไหล ~35 MB/s แต่กล้องชอบค้างส่ง 0.1-0.2 MB สุดท้าย
    # (log จริง: ค้างจนครบ 45s แล้ว resume เสร็จทันที) → ตั้งสั้นให้ resume เร็ว ไม่ต้องรอเกือบนาที
    DOWNLOAD_READ_TIMEOUT = 6
    DOWNLOAD_RETRY_WAIT = 1.0

    def download(self, directory, filename, dest_folder, retries=5):
        """
        ดาวน์โหลดไฟล์วิดีโอจาก GoPro พร้อม progress log + retry
        - timeout=(15, DOWNLOAD_READ_TIMEOUT): connect 15s, ข้อมูลเงียบเกินกำหนด → resume ต่อ
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

                with _session.get(url, stream=True, timeout=(15, self.DOWNLOAD_READ_TIMEOUT),
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

                # กล้องปิดการเชื่อมต่อก่อนส่งครบ → อย่านับว่าสำเร็จ (เดิมได้ไฟล์ไม่ครบแต่ขึ้น ✓)
                if total and written < total:
                    raise requests.exceptions.ConnectionError(
                        f"ได้ไม่ครบ {written/(1024*1024):.1f}/{total_mb:.1f} MB")

                print(f"  [{self.name}] download ✓ ({written/(1024*1024):.1f} MB)")
                return dest

            except requests.exceptions.RequestException as e:
                short = str(e).split("\n")[0][:80]
                print(f"  [{self.name}] download error (ครั้ง {attempt}/{retries}): {short}")

                if attempt < retries:
                    print(f"  [{self.name}]   ปลุกกล้อง + รอ {self.DOWNLOAD_RETRY_WAIT:g}s แล้วลองใหม่...")
                    # ปลุกกล้องก่อน retry — ป้องกันกล้องหลับระหว่าง download
                    try:
                        self.keep_alive()
                        self.enable_wired_control()
                    except Exception:
                        pass
                    time.sleep(self.DOWNLOAD_RETRY_WAIT)

        # ล้างไฟล์ที่โหลดไม่สมบูรณ์
        if os.path.exists(dest):
            try:
                os.remove(dest)
            except OSError:
                pass
        print(f"  [{self.name}] download ล้มเหลวทั้ง {retries} ครั้ง — ข้ามไฟล์นี้")
        return None

    def delete_media(self, directory, filename, retries=2):
        """
        ลบไฟล์ต้นฉบับบนตัวกล้อง (เรียกหลังอัปคลิปขึ้นคลาวด์สำเร็จแล้วเท่านั้น)
        กันเมมกล้องเต็ม — ตัดสินใจลบง่ายๆ: ขึ้นคลาวด์แล้ว = ไม่ต้องเก็บซ้ำในกล้องอีก
        """
        path = f"{directory}/{filename}"
        # ใส่ path ใน URL ตรงๆ ตามรูปแบบในเอกสาร Open GoPro (?path=100GOPRO/GX010001.MP4)
        # ไม่ผ่าน params ของ requests ที่จะเข้ารหัส "/" เป็น %2F
        url = f"{self.base}/gopro/media/delete/file?path={path}"
        for attempt in range(retries + 1):
            try:
                r = _session.get(url, params=self._params(), timeout=self.timeout)
                if r.status_code == 200:
                    print(f"  [{self.name}] ลบไฟล์บนกล้องแล้ว: {path}")
                    return True
                print(f"  [{self.name}] ลบไฟล์บนกล้องไม่สำเร็จ HTTP {r.status_code}: {path}")
                return False
            except requests.exceptions.RequestException as e:
                if attempt < retries:
                    time.sleep(1.5)
                else:
                    print(f"  [{self.name}] ลบไฟล์บนกล้องไม่สำเร็จ: {e}")
        return False

    @classmethod
    def from_config(cls, cam_config, port, timeout=10):
        return cls(name=cam_config.name, ip=cam_config.ip, port=port,
                   enabled=cam_config.enabled, timeout=timeout)
