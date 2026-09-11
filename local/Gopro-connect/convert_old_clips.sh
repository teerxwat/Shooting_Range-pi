#!/bin/bash
# แปลงคลิปเก่าที่เป็น HEVC → H.264 1080p (เล่นบน Android ได้)
# ใช้ครั้งเดียวกับคลิปที่อัดไว้ก่อนอัปเดต — คลิปใหม่ระบบแปลงให้อัตโนมัติแล้ว
# วิธีรัน:  bash convert_old_clips.sh
cd "$(dirname "$0")/downloads/clips" || exit 1

for f in ch*/S*.mp4 ch*/S*.MP4; do
  [ -f "$f" ] || continue
  codec=$(ffprobe -v error -select_streams v:0 -show_entries stream=codec_name -of csv=p=0 "$f")
  if [ "$codec" = "hevc" ]; then
    echo "แปลง: $f"
    mkdir -p "$(dirname "$f")/originals"
    ffmpeg -y -v error -i "$f" -vf scale=-2:1080 -c:v libx264 -preset veryfast -crf 22 \
      -pix_fmt yuv420p -movflags +faststart -an "$f.tmp.mp4" \
      && mv "$f" "$(dirname "$f")/originals/$(basename "$f")" \
      && mv "$f.tmp.mp4" "$f" \
      && echo "  เสร็จ ✓"
  fi
done
echo "แปลงครบทุกไฟล์แล้ว"
