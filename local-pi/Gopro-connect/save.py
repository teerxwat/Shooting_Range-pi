"""จัดการการบันทึกไฟล์: หาไฟล์ใหม่หลังถ่าย + ดาวน์โหลดแยกโฟลเดอร์
รองรับหลายเลนทำงานพร้อมกัน (แต่ละกล้องเขียนคนละโฟลเดอร์ จึงไม่ชนกัน)

โครงสร้างโฟลเดอร์ปลายทาง:
  downloads/<session_stamp>/<channel-name>/<cam_name>/<file>
"""
import os
import time
import json
from datetime import datetime
from concurrent.futures import ThreadPoolExecutor

STATE_DIR = os.path.join(os.path.dirname(__file__), ".session")

# ดาวน์โหลดเฉพาะไฟล์วิดีโอ (ข้าม thumbnail .THM / proxy .LRV)
VIDEO_EXTS = (".mp4", ".360")


def _is_video(filename):
    return filename.lower().endswith(VIDEO_EXTS)


def session_stamp():
    return datetime.now().strftime("%Y%m%d_%H%M%S")


# ---- state สำหรับ record/stop ที่แยกคนละคำสั่ง (คนละ process) ----
def save_snapshot(channel_name, snapshot, stamp):
    """เก็บ snapshot ไฟล์ + stamp ลงดิสก์ เพื่อให้คำสั่ง stop ตามมาอ่านได้"""
    os.makedirs(STATE_DIR, exist_ok=True)
    payload = {
        "stamp": stamp,
        "media": {cam: sorted(list(files)) for cam, files in snapshot.items()},
    }
    path = os.path.join(STATE_DIR, f"{channel_name}.json")
    with open(path, "w", encoding="utf-8") as f:
        json.dump(payload, f)


def load_snapshot(channel_name):
    path = os.path.join(STATE_DIR, f"{channel_name}.json")
    if not os.path.exists(path):
        return None, None
    with open(path, encoding="utf-8") as f:
        payload = json.load(f)
    media = {cam: set(tuple(x) for x in files) for cam, files in payload["media"].items()}
    return payload["stamp"], media


def clear_snapshot(channel_name):
    path = os.path.join(STATE_DIR, f"{channel_name}.json")
    if os.path.exists(path):
        os.remove(path)


# ---- หาไฟล์ใหม่ + ดาวน์โหลด ----
def download_new_files(channel, before, download_root, stamp, wait=12):
    """
    หาไฟล์ที่เพิ่งเกิดใหม่ของแต่ละกล้องในเลน แล้วดาวน์โหลดพร้อมกัน
    before: {cam_name: set(files)} จาก snapshot ก่อนถ่าย
    คืน {cam_name: [{"path", "cam", "directory", "filename"}, ...]}
    """
    cams = {c.name: c for c in channel.active_cameras}
    new_map = {}                     # cam_name -> (camera, set(new_files))
    pending = dict(cams)
    deadline = time.time() + wait
    poll_count = {name: 0 for name in cams}

    # poll จนเจอไฟล์ใหม่ของแต่ละกล้อง (หรือหมดเวลา)
    while pending and time.time() < deadline:
        time.sleep(1)
        for name, cam in list(pending.items()):
            poll_count[name] += 1
            media = cam.list_media(retries=3)  # retry มากขึ้นตอน download
            before_set = before.get(name, set())

            # debug: ถ้ายังไม่เจอ แสดงจำนวนไฟล์ที่ list ได้
            if poll_count[name] <= 3 or poll_count[name] % 5 == 0:
                print(f"  [save] {name}: list_media={len(media)} files, "
                      f"before={len(before_set)}, elapsed={poll_count[name]}s")

            new_files = {f for f in (media - before_set) if _is_video(f[1])}
            if new_files:
                print(f"  [save] {name}: พบ {len(new_files)} ไฟล์ใหม่ ✓")
                new_map[name] = (cam, new_files)
                del pending[name]

    # เตรียม task ดาวน์โหลด (ทุกกล้อง/ทุกไฟล์)
    tasks = []
    for name, (cam, new_files) in new_map.items():
        dest = os.path.join(download_root, stamp, channel.name, name)
        for directory, filename in sorted(new_files):
            tasks.append((cam, directory, filename, dest))

    results = {name: [] for name in cams}

    def _do(task):
        cam, directory, filename, dest = task
        path = cam.download(directory, filename, dest)
        return cam.name, path, cam, directory, filename

    if tasks:
        with ThreadPoolExecutor(max_workers=len(tasks)) as pool:
            for cam_name, path, cam, directory, filename in pool.map(_do, tasks):
                if path:
                    # เก็บ cam/directory/filename ติดไปด้วย — ใช้ลบไฟล์ต้นฉบับบนกล้อง
                    # ทีหลัง หลังคลิปนี้อัปขึ้นคลาวด์สำเร็จแล้ว (ดู uploader.py)
                    results[cam_name].append({
                        "path": path, "cam": cam,
                        "directory": directory, "filename": filename,
                    })

    # กล้องที่ไม่เจอไฟล์ใหม่ = ยังอยู่ใน pending
    for name in pending:
        print(f"  [!] {name}: ไม่พบไฟล์ใหม่หลัง {wait}s "
              f"(list_media ล่าสุด={poll_count[name]} ครั้ง)")

    return results