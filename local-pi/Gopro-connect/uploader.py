"""
uploader.py — สะพานเชื่อมสนาม → คลาวด์

ทำงานเป็นเธรดเบื้องหลัง: อัดคลิปเสร็จ → โยนเข้าคิว → อัปขึ้นเซิร์ฟเวอร์
ลูกค้าไม่ต้องยืนรอที่เลน เดินออกไปแล้วค่อยเปิดเว็บโหลดทีหลังได้เลย

จุดสำคัญ
  • ยิงออกทางเดียว — คลาวด์ไม่เคยเรียกกลับมาที่ Mac (Mac ไม่มี public IP อยู่แล้ว)
  • คิวถูกบันทึกลงไฟล์ ปิดโปรแกรมกลางคันแล้วเปิดใหม่ ของค้างจะอัปต่อเอง
  • เน็ตล่ม = ระบบที่สนามยังทำงานปกติ คิวจะค้างไว้แล้วส่งเมื่อเน็ตกลับมา

ตั้งค่าใน .env
  CLOUD_URL=https://dl.yourdomain.com
  CLOUD_API_KEY=<API_KEY เดียวกับใน .env ของ server>
  CLOUD_UPLOAD=1
  DELETE_AFTER_UPLOAD=1   # อัปคลาวด์สำเร็จแล้ว → ลบไฟล์ต้นฉบับบนกล้อง GoPro กันเมมเต็ม
"""
import json
import os
import queue
import threading
import time

import requests

from gopro import GoProCamera

CLOUD_URL = (os.getenv("CLOUD_URL") or "").rstrip("/")
API_KEY = os.getenv("CLOUD_API_KEY", "")
ENABLED = os.getenv("CLOUD_UPLOAD", "1").lower() in ("1", "true", "yes")
DELETE_AFTER_UPLOAD = os.getenv("DELETE_AFTER_UPLOAD", "1").lower() in ("1", "true", "yes")
TIMEOUT = int(os.getenv("CLOUD_TIMEOUT", "180"))
RETRY_MAX_WAIT = 60   # วินาที — เว้นช่วงลองอัปใหม่นานสุดตอนเน็ตหลุด
QUEUE_FILE = os.path.join(os.path.dirname(__file__), ".session", "upload_queue.json")

_q: "queue.Queue[dict]" = queue.Queue()
_pending: list[dict] = []          # สำเนาไว้บันทึกลงไฟล์
_registered: set[str] = set()      # เซสชันที่ลงทะเบียนกับคลาวด์แล้ว (กันยิงซ้ำทุกคลิป)
_lock = threading.Lock()
_started = False
_on_uploaded = None                # callback(job) หลังอัปสำเร็จ — server.py ใช้ลบไฟล์ในเครื่อง


def set_on_uploaded(callback):
    """ลงทะเบียน callback(job) ที่ถูกเรียกหลังคลิปอัปขึ้นคลาวด์สำเร็จแล้วเท่านั้น"""
    global _on_uploaded
    _on_uploaded = callback


def enabled() -> bool:
    return bool(ENABLED and CLOUD_URL and API_KEY)


def _headers():
    return {"X-API-Key": API_KEY}


# ── บันทึก/โหลดคิวลงดิสก์ ────────────────────────────────────────────────

def _save_queue():
    try:
        os.makedirs(os.path.dirname(QUEUE_FILE), exist_ok=True)
        with _lock:
            data = list(_pending)
        tmp = QUEUE_FILE + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)
        os.replace(tmp, QUEUE_FILE)
    except Exception as e:
        print(f"  [upload] บันทึกคิวไม่ได้: {e}")


def _load_queue():
    if not os.path.exists(QUEUE_FILE):
        return
    try:
        with open(QUEUE_FILE, encoding="utf-8") as f:
            items = json.load(f)
        for it in items:
            if os.path.exists(it.get("path", "")):
                _push(it)
        if items:
            print(f"  [upload] พบงานค้างจากรอบก่อน {len(items)} ชิ้น — จะอัปต่อให้")
    except Exception as e:
        print(f"  [upload] อ่านคิวเดิมไม่ได้: {e}")


def _push(job: dict):
    with _lock:
        _pending.append(job)
    _q.put(job)


def _done(job: dict):
    with _lock:
        if job in _pending:
            _pending.remove(job)
    _save_queue()


# ── งานที่ยิงไปคลาวด์ ────────────────────────────────────────────────────

def register_session(code: str, pin: str, lane: int) -> bool:
    """ลงทะเบียนเซสชันบนคลาวด์ (ต้องทำก่อนอัปคลิปแรก) — เรียกซ้ำได้"""
    if not enabled():
        return False
    try:
        r = requests.post(
            f"{CLOUD_URL}/api/ingest/sessions",
            headers=_headers(), json={"code": code, "pin": pin, "lane": lane},
            timeout=20,
        )
        if r.ok:
            _registered.add(code)
            print(f"  [upload] ลงทะเบียนเซสชัน {code} บนคลาวด์แล้ว")
            return True
        print(f"  [upload] ลงทะเบียน {code} ไม่สำเร็จ: {r.status_code} {r.text[:120]}")
    except Exception as e:
        print(f"  [upload] ต่อคลาวด์ไม่ได้: {e}")
    return False


def upload_clip(path: str, code: str, sub_no: int, pin: str = "", lane: int = 0,
                duration_s: float = 0, gopro_ip: str = "", gopro_port: int = 8080,
                gopro_directory: str = "", gopro_filename: str = ""):
    """
    โยนคลิปเข้าคิว — คืนทันที ไม่บล็อกการทำงานที่สนาม
    gopro_* (ถ้าให้มา): ไฟล์ต้นฉบับบนกล้อง — ใช้ลบทิ้งอัตโนมัติหลังอัปคลาวด์สำเร็จ
    (ดู DELETE_AFTER_UPLOAD ด้านบน)
    """
    if not enabled():
        return
    _push({
        "path": os.path.abspath(path), "code": code, "sub_no": sub_no,
        "pin": pin, "lane": lane, "duration_s": duration_s, "tries": 0,
        "gopro_ip": gopro_ip, "gopro_port": gopro_port,
        "gopro_directory": gopro_directory, "gopro_filename": gopro_filename,
    })
    _save_queue()
    print(f"  [upload] เข้าคิว {code}-{sub_no} ({os.path.basename(path)})")


def _upload_one(job: dict) -> bool:
    path = job["path"]
    if not os.path.exists(path):
        print(f"  [upload] ข้าม — ไม่พบไฟล์ {path}")
        return True                     # ไม่ต้องลองใหม่ ไฟล์หายไปแล้ว

    # เผื่อกรณีเซสชันยังไม่ถูกลงทะเบียน (เช่นเน็ตล่มตอนตั้ง PIN หรือเพิ่งรีสตาร์ตโปรแกรม)
    if job.get("pin") and job["code"] not in _registered:
        register_session(job["code"], job["pin"], job.get("lane", 0))

    try:
        with open(path, "rb") as f:
            r = requests.post(
                f"{CLOUD_URL}/api/ingest/videos",
                headers=_headers(),
                data={
                    "code": job["code"], "sub_no": job["sub_no"],
                    "filename": os.path.basename(path),
                    "duration_s": job.get("duration_s", 0),
                },
                files={"file": (os.path.basename(path), f, "video/mp4")},
                timeout=TIMEOUT,
            )
        if r.ok:
            mb = os.path.getsize(path) / 1024 ** 2
            print(f"  [upload] ✅ {job['code']}-{job['sub_no']} ({mb:.1f} MB)")
            _delete_from_gopro(job)
            if _on_uploaded:
                try:
                    _on_uploaded(job)
                except Exception as e:
                    print(f"  [upload] จัดการไฟล์ในเครื่องหลังอัปไม่สำเร็จ: {e}")
            return True
        # 404 = ไม่มีเซสชันนี้บนคลาวด์ / 400 = ไฟล์เสีย → ลองใหม่ก็ไม่ช่วย
        if r.status_code in (400, 404):
            print(f"  [upload] ❌ {job['code']}-{job['sub_no']} ทิ้งงาน: {r.text[:120]}")
            return True
        print(f"  [upload] ล้มเหลว {r.status_code} — จะลองใหม่")
    except Exception as e:
        print(f"  [upload] ส่งไม่สำเร็จ ({e}) — จะลองใหม่")
    return False


def _delete_from_gopro(job: dict):
    """
    ลบไฟล์ต้นฉบับบนตัวกล้อง GoPro — เรียกทันทีหลังคลิปนี้อัปขึ้นคลาวด์สำเร็จแล้วเท่านั้น
    ป้องกันกล้องเมมเต็ม (คลิปยิงหลายรอบ/วัน ไม่มีใครไปลบมือ)
    ล้มเหลวได้โดยไม่กระทบงานอัป — กล้องอาจปิดไปแล้วตอนนี้ ไม่ต้อง retry ไม่ต้องเข้าคิว
    """
    if not DELETE_AFTER_UPLOAD:
        return
    ip = job.get("gopro_ip")
    directory = job.get("gopro_directory")
    filename = job.get("gopro_filename")
    if not (ip and directory and filename):
        return
    try:
        cam = GoProCamera(name=ip, ip=ip, port=job.get("gopro_port") or 8080, timeout=10)
        cam.delete_media(directory, filename)
    except Exception as e:
        print(f"  [upload] ลบไฟล์บนกล้อง {ip} ไม่สำเร็จ (เก็บไว้ในกล้องต่อไป): {e}")


def _worker():
    while True:
        job = _q.get()
        while not _upload_one(job):
            job["tries"] += 1
            _save_queue()
            # หน่วงเพิ่มขึ้นเรื่อยๆ (20 → 40 → 60 วิ) สูงสุด RETRY_MAX_WAIT
            # ไม่ให้นานกว่านี้ — เน็ตกลับมาแล้วคิวต้องเริ่มส่งย้อนหลังภายในไม่เกิน 1 นาที
            wait = min(10 * 2 ** min(job["tries"], 3), RETRY_MAX_WAIT)
            print(f"  [upload] รอ {wait} วิ แล้วลองใหม่ (ครั้งที่ {job['tries']})")
            time.sleep(wait)
        _done(job)
        _q.task_done()


def start():
    """เรียกครั้งเดียวตอน server.py เริ่มทำงาน"""
    global _started
    if _started:
        return
    _started = True

    if not enabled():
        print("  [upload] ปิดอยู่ — คลิปจะเก็บไว้ในเครื่องอย่างเดียว")
        print("            (ตั้ง CLOUD_URL + CLOUD_API_KEY ใน .env เพื่อเปิด)")
        return

    threading.Thread(target=_worker, daemon=True, name="uploader").start()
    _load_queue()
    print(f"  [upload] พร้อมส่งขึ้น {CLOUD_URL}")


def status() -> dict:
    with _lock:
        return {"enabled": enabled(), "cloud": CLOUD_URL, "pending": len(_pending)}
