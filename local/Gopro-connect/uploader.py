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
"""
import json
import os
import queue
import threading
import time

import requests

CLOUD_URL = (os.getenv("CLOUD_URL") or "").rstrip("/")
API_KEY = os.getenv("CLOUD_API_KEY", "")
ENABLED = os.getenv("CLOUD_UPLOAD", "1").lower() in ("1", "true", "yes")
TIMEOUT = int(os.getenv("CLOUD_TIMEOUT", "180"))
QUEUE_FILE = os.path.join(os.path.dirname(__file__), ".session", "upload_queue.json")

_q: "queue.Queue[dict]" = queue.Queue()
_pending: list[dict] = []          # สำเนาไว้บันทึกลงไฟล์
_registered: set[str] = set()      # เซสชันที่ลงทะเบียนกับคลาวด์แล้ว (กันยิงซ้ำทุกคลิป)
_lock = threading.Lock()
_started = False


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
                duration_s: float = 0):
    """โยนคลิปเข้าคิว — คืนทันที ไม่บล็อกการทำงานที่สนาม"""
    if not enabled():
        return
    _push({
        "path": os.path.abspath(path), "code": code, "sub_no": sub_no,
        "pin": pin, "lane": lane, "duration_s": duration_s, "tries": 0,
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
            return True
        # 404 = ไม่มีเซสชันนี้บนคลาวด์ / 400 = ไฟล์เสีย → ลองใหม่ก็ไม่ช่วย
        if r.status_code in (400, 404):
            print(f"  [upload] ❌ {job['code']}-{job['sub_no']} ทิ้งงาน: {r.text[:120]}")
            return True
        print(f"  [upload] ล้มเหลว {r.status_code} — จะลองใหม่")
    except Exception as e:
        print(f"  [upload] ส่งไม่สำเร็จ ({e}) — จะลองใหม่")
    return False


def _worker():
    while True:
        job = _q.get()
        while not _upload_one(job):
            job["tries"] += 1
            _save_queue()
            # หน่วงเพิ่มขึ้นเรื่อยๆ สูงสุด 5 นาที (เน็ตล่มยาวก็ไม่ถล่มเซิร์ฟเวอร์)
            wait = min(10 * 2 ** min(job["tries"], 5), 300)
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
