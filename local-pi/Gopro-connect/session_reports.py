"""
session_reports.py — รายงานจบเซสชัน + ผู้ดูแลที่ได้ค่าคอมมิชชั่น → ส่งขึ้นคลาวด์เบื้องหลัง

ใช้กับ popup "จบการใช้งาน" ที่จอ kiosk (ดูสเปก API/payload ทั้งหมดใน server/STAFF_COMMISSION_API.md)

จุดสำคัญ
  • ทุกรายงานบันทึกลงไฟล์ในเครื่องก่อนเสมอ (.session/session_reports.jsonl)
    เน็ตล่ม / คลาวด์ยังไม่มี API นี้ → ข้อมูลไม่หาย ส่งต่อให้เองเมื่อพร้อม
  • เธรดเบื้องหลังส่งรายงานที่ยังไม่ขึ้นคลาวด์ทุก SESSION_REPORT_SYNC วินาที
    แยกจากคิวอัปคลิป (uploader.py) — รายงานค้างไม่ทำให้คลิปค้าง
  • คลาวด์ตอบ 2xx หรือ 409 (มี report_id นี้แล้ว) = ส่งสำเร็จ
  • รายชื่อผู้ดูแล: คลาวด์ (GET /api/ingest/staff) → cache ล่าสุดในเครื่อง → staff.json (สำรอง)

ตั้งค่าใน .env (ไม่ใส่ก็ได้)
  STAFF_FILE=staff.json          # ไฟล์รายชื่อสำรอง ใช้ตอนคลาวด์ยังไม่มี API รายชื่อ
  SESSION_REPORT_SYNC=60         # ลองส่งรายงานที่ค้างทุกกี่วินาที
"""
import json
import os
import socket
import threading
import time
import traceback
import uuid
from datetime import datetime
from urllib.parse import quote

import requests

import config
import uploader

BASE = os.path.dirname(os.path.abspath(__file__))
REPORT_FILE = os.path.join(BASE, ".session", "session_reports.jsonl")
STAFF_CACHE = os.path.join(BASE, ".session", "staff_cache.json")
STAFF_FILE = os.path.join(BASE, os.getenv("STAFF_FILE") or "staff.json")
SYNC_INTERVAL = int(os.getenv("SESSION_REPORT_SYNC", "60"))
STAFF_TIMEOUT = 3      # รอคลาวด์ตอบรายชื่อได้นานสุด — popup ต้องขึ้นเร็ว
REPORT_TIMEOUT = 10

_lock = threading.Lock()
_wake = threading.Event()
_started = False
_last_staff: list[dict] = []
_warned: set[str] = set()   # report_id ที่แจ้ง error ไปแล้ว — กัน log ซ้ำทุกนาที


def _iso(ts: float) -> str:
    """เวลาไทยแบบ ISO 8601 พร้อม offset เช่น 2026-09-15T01:05:40+07:00"""
    return datetime.fromtimestamp(ts).astimezone().isoformat(timespec="seconds")


def _read_json(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def _write_json(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


# ── รายชื่อผู้ดูแล ───────────────────────────────────────────────────────

def _normalize_staff(data) -> list[dict]:
    """รับได้ทั้ง [...] และ {"staff": [...]} — คืน [{"id": "3", "name": "สมชาย"}] เฉพาะคนที่ active"""
    items = data.get("staff") if isinstance(data, dict) else data
    out = []
    for s in items or []:
        if not isinstance(s, dict) or s.get("active") is False:
            continue
        sid = s.get("id")
        name = str(s.get("name") or "").strip()
        if sid in (None, "") or not name:
            continue
        out.append({"id": str(sid), "name": name})
    return out


def get_staff() -> dict:
    """คืน {"source": "cloud"|"cache"|"local"|"none", "staff": [...]}"""
    global _last_staff
    source, staff = "none", []
    if uploader.enabled():
        try:
            r = requests.get(
                f"{uploader.CLOUD_URL}/api/ingest/staff",
                params={"lane": config.LANE_ID}, headers=uploader._headers(), timeout=STAFF_TIMEOUT,
            )
            if r.ok:
                staff = _normalize_staff(r.json())
                source = "cloud"
                _write_json(STAFF_CACHE, staff)
        except (requests.exceptions.RequestException, ValueError, OSError):
            pass
    if source == "none":
        for src, path in (("cache", STAFF_CACHE), ("local", STAFF_FILE)):
            data = _read_json(path)
            if data is not None:
                staff, source = _normalize_staff(data), src
                break
    _last_staff = staff
    return {"source": source, "staff": staff}


def find_staff(staff_id) -> dict | None:
    """หาผู้ดูแลจากรายชื่อที่หน้าเว็บเพิ่งดึงไป — ไม่เจอค่อยโหลดรายชื่อใหม่อีกรอบ"""
    if staff_id in (None, ""):
        return None
    sid = str(staff_id)
    for lst in (_last_staff, None):
        if lst is None:
            lst = get_staff()["staff"]
        hit = next((s for s in lst if s["id"] == sid), None)
        if hit:
            return dict(hit)
    return None


# ── รายงานจบเซสชัน ────────────────────────────────────────────────────────

def _lane_number():
    try:
        return int(config.LANE_ID)
    except ValueError:
        return None


def record_session_end(code: str, channel: int, started: float | None,
                       clip_count: int, action: str, staff: dict | None) -> dict:
    """บันทึกรายงานลงไฟล์ในเครื่องทันที แล้วปลุกเธรดให้ส่งขึ้นคลาวด์ — คืน payload ที่จะส่ง"""
    now = time.time()
    report = {
        "report_id": str(uuid.uuid4()),
        "session_code": code,
        "lane": _lane_number(),
        "channel": channel,
        "device": socket.gethostname(),
        "started_at": _iso(started) if started else None,
        "ended_at": _iso(now),
        "duration_s": int(now - started) if started else None,
        "clip_count": clip_count,
        "action": action,
        "staff": staff,
    }
    with _lock:
        os.makedirs(os.path.dirname(REPORT_FILE), exist_ok=True)
        with open(REPORT_FILE, "a", encoding="utf-8") as f:
            f.write(json.dumps({**report, "synced": False}, ensure_ascii=False) + "\n")
    _wake.set()
    return report


def _load_reports() -> list[dict]:
    try:
        with open(REPORT_FILE, encoding="utf-8") as f:
            return [json.loads(line) for line in f if line.strip()]
    except (OSError, ValueError):
        return []


def _sync_once():
    if not uploader.enabled():
        return
    with _lock:
        pending = [r for r in _load_reports() if not r.get("synced")]
    done = {}
    for rep in pending:
        body = {k: v for k, v in rep.items() if k not in ("synced", "synced_at")}
        url = f"{uploader.CLOUD_URL}/api/ingest/sessions/{quote(rep['session_code'], safe='')}/end"
        try:
            r = requests.post(url, json=body, headers=uploader._headers(), timeout=REPORT_TIMEOUT)
        except requests.exceptions.RequestException as e:
            if rep["report_id"] not in _warned:
                _warned.add(rep["report_id"])
                print(f"  [report] ต่อคลาวด์ไม่ได้ ({e.__class__.__name__}) — เก็บไว้ในเครื่อง จะส่งใหม่เอง")
            break   # เน็ตล่ม — รอรอบหน้าค่อยส่งทั้งหมด
        if r.status_code in (200, 201, 204, 409):
            done[rep["report_id"]] = _iso(time.time())
            who = (rep.get("staff") or {}).get("name") or "-"
            print(f"  [report] ✅ ส่งรายงานจบเซสชัน {rep['session_code']} ({rep['action']}, ผู้ดูแล: {who})")
        elif rep["report_id"] not in _warned:
            _warned.add(rep["report_id"])
            print(f"  [report] คลาวด์ตอบ {r.status_code} สำหรับ {rep['session_code']} "
                  f"— เก็บไว้ในเครื่อง จะลองส่งใหม่ทุก {SYNC_INTERVAL} วิ")
    if done:
        # โหลดไฟล์ใหม่อีกรอบก่อนเขียน — ระหว่างส่งอาจมีรายงานใหม่ต่อท้ายเข้ามา
        with _lock:
            rows = _load_reports()
            for row in rows:
                if row.get("report_id") in done:
                    row["synced"], row["synced_at"] = True, done[row["report_id"]]
            tmp = REPORT_FILE + ".tmp"
            with open(tmp, "w", encoding="utf-8") as f:
                for row in rows:
                    f.write(json.dumps(row, ensure_ascii=False) + "\n")
            os.replace(tmp, REPORT_FILE)


def _worker():
    while True:
        try:
            _sync_once()
        except Exception:
            traceback.print_exc()
        _wake.wait(SYNC_INTERVAL)
        _wake.clear()


def start():
    """เรียกครั้งเดียวตอน server.py เริ่มทำงาน"""
    global _started
    if _started:
        return
    _started = True
    threading.Thread(target=_worker, daemon=True, name="session-reports").start()


def status() -> dict:
    with _lock:
        rows = _load_reports()
    return {"total": len(rows), "pending": sum(1 for r in rows if not r.get("synced"))}
