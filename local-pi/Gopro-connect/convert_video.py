# -*- coding: utf-8 -*-
"""
แปลงวิดีโอทั้งโฟลเดอร์เป็น slow motion 25 fps
ตรวจ fps ต้นฉบับอัตโนมัติ (200/400/800 หรืออื่นๆ) แล้วยืดความยาวตามสัดส่วน
ต้องติดตั้ง ffmpeg ก่อน: https://ffmpeg.org (หรือ `brew install ffmpeg` บน Mac)

วิธีใช้:
    python slowmotion_converter.py <โฟลเดอร์วิดีโอ>
    python slowmotion_converter.py <โฟลเดอร์วิดีโอ> -o <โฟลเดอร์ผลลัพธ์>
"""

import argparse
import subprocess
import sys
from pathlib import Path

TARGET_FPS = 25
VIDEO_EXTS = {".mp4", ".mov", ".avi", ".mkv", ".m4v", ".mts", ".webm"}


def get_fps(video_path: Path) -> float:
    """อ่าน fps ของวิดีโอด้วย ffprobe"""
    result = subprocess.run(
        [
            "ffprobe", "-v", "error",
            "-select_streams", "v:0",
            "-show_entries", "stream=r_frame_rate",
            "-of", "default=noprint_wrappers=1:nokey=1",
            str(video_path),
        ],
        capture_output=True, text=True, check=True,
    )
    num, _, den = result.stdout.strip().partition("/")
    return float(num) / float(den or 1)


def convert(video_path: Path, out_dir: Path) -> None:
    src_fps = get_fps(video_path)
    factor = src_fps / TARGET_FPS  # เช่น 800/25 = ช้าลง 32 เท่า

    if factor <= 1:
        print(f"ข้าม {video_path.name} (fps={src_fps:.0f} ต่ำกว่า/เท่ากับ {TARGET_FPS} แล้ว)")
        return

    out_path = out_dir / f"{video_path.stem}_slowmo_{TARGET_FPS}fps.mp4"
    print(f"กำลังแปลง {video_path.name}: {src_fps:.0f} fps → {TARGET_FPS} fps (ช้าลง {factor:.0f} เท่า)")

    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(video_path),
            "-vf", f"setpts={factor}*PTS",
            "-r", str(TARGET_FPS),
            "-an",  # ตัดเสียงทิ้ง (สโลว์ 8-32 เท่า เสียงใช้ไม่ได้อยู่แล้ว)
            "-c:v", "libx264", "-crf", "18", "-preset", "medium",
            str(out_path),
        ],
        check=True,
    )
    print(f"เสร็จ → {out_path.name}\n")


def main():
    parser = argparse.ArgumentParser(description="แปลงวิดีโอทั้งโฟลเดอร์เป็น slow motion 25 fps")
    parser.add_argument("folder", help="โฟลเดอร์ที่มีไฟล์วิดีโอ")
    parser.add_argument("-o", "--output", help="โฟลเดอร์ผลลัพธ์ (ค่าเริ่มต้น: <folder>/slowmo)")
    args = parser.parse_args()

    in_dir = Path(args.folder).expanduser()
    if not in_dir.is_dir():
        sys.exit(f"ไม่พบโฟลเดอร์: {in_dir}")

    out_dir = Path(args.output).expanduser() if args.output else in_dir / "slowmo"
    out_dir.mkdir(parents=True, exist_ok=True)

    videos = sorted(p for p in in_dir.iterdir() if p.suffix.lower() in VIDEO_EXTS)
    if not videos:
        sys.exit(f"ไม่พบไฟล์วิดีโอใน {in_dir}")

    print(f"พบวิดีโอ {len(videos)} ไฟล์\n")
    ok, failed = 0, []
    for v in videos:
        try:
            convert(v, out_dir)
            ok += 1
        except subprocess.CalledProcessError as e:
            failed.append(v.name)
            print(f"ผิดพลาดกับ {v.name}: {e}\n")

    print(f"สำเร็จ {ok}/{len(videos)} ไฟล์ | ผลลัพธ์อยู่ที่: {out_dir}")
    if failed:
        print(f"ล้มเหลว: {', '.join(failed)}")


if __name__ == "__main__":
    main()