#!/usr/bin/env python3
"""ลบไฟล์วิดีโอเก่าใน downloads/ ที่อายุเกิน DOWNLOAD_RETENTION_DAYS (ดีฟอลต์ 7 วัน จาก .env)

รันเองทุกวันผ่าน cron (ติดตั้งด้วย setup-cleanup-cron.sh) หรือรันมือได้:
    .venv/bin/python cleanup_downloads.py            ลบจริง
    .venv/bin/python cleanup_downloads.py --dry-run  แสดงรายการที่จะลบ ไม่ลบจริง

ลบเฉพาะไฟล์ในเครื่อง Pi นี้ (downloads/clips/chN/*.mp4 + originals/) — ไม่แตะคลิปบนคลาวด์
(shot24.shop) ซึ่งคุมอายุแยกกันเองด้วย RETENTION_DAYS ฝั่ง server
หลังลบไฟล์แล้วจะเก็บกวาดโฟลเดอร์ว่างเปล่าทิ้งด้วย (scratch dir ต่อเซสชันที่เหลือค้างจากการย้ายไฟล์
ตอนบันทึกคลิป — ดู server.py จุดที่ shutil.move ออกจากมันไป)
"""
import os
import sys
import time

import config

ROOT = os.path.abspath(config.DOWNLOAD_ROOT)


def human_size(n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024:
            return f"{n:.1f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def main() -> None:
    dry_run = "--dry-run" in sys.argv
    days = config.DOWNLOAD_RETENTION_DAYS

    if not os.path.isdir(ROOT):
        print(f"[cleanup] ไม่พบโฟลเดอร์ {ROOT} — ข้าม")
        return

    cutoff = time.time() - days * 86400
    deleted, freed = 0, 0

    for dirpath, _dirnames, filenames in os.walk(ROOT):
        for fn in filenames:
            fp = os.path.join(dirpath, fn)
            try:
                st = os.stat(fp)
            except OSError:
                continue
            if st.st_mtime >= cutoff:
                continue
            freed += st.st_size
            deleted += 1
            if dry_run:
                age_days = (time.time() - st.st_mtime) / 86400
                print(f"[dry-run] จะลบ ({age_days:.1f} วัน, {human_size(st.st_size)}): {fp}")
            else:
                try:
                    os.remove(fp)
                except OSError as e:
                    print(f"[!] ลบไม่สำเร็จ {fp}: {e}")

    # เก็บกวาดโฟลเดอร์ว่างเปล่าที่เหลือค้าง (bottom-up กันโฟลเดอร์แม่เพิ่งว่างจากรอบนี้หลุดไป)
    removed_dirs = 0
    for dirpath, _dirnames, _filenames in os.walk(ROOT, topdown=False):
        if dirpath == ROOT:
            continue
        try:
            if not os.listdir(dirpath):
                if dry_run:
                    print(f"[dry-run] จะลบโฟลเดอร์ว่าง: {dirpath}")
                else:
                    os.rmdir(dirpath)
                    removed_dirs += 1
        except OSError:
            pass

    tag = "[dry-run]" if dry_run else "[cleanup]"
    print(f"{tag} {time.strftime('%Y-%m-%d %H:%M:%S')} — "
          f"ลบไฟล์ {deleted} ไฟล์ ({human_size(freed)}) + โฟลเดอร์ว่าง {removed_dirs} โฟลเดอร์ "
          f"— เก็บไฟล์ที่ใหม่กว่า {days} วันไว้")


if __name__ == "__main__":
    main()
