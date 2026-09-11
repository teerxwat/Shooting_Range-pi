#!/usr/bin/env python3
"""
ทดสอบดึง live preview stream จาก GoPro ch1 มาแสดงด้วย OpenCV (ผ่าน USB)

หลักการ:
  1. enable wired control
  2. สั่ง /gopro/camera/stream/start  -> กล้องส่ง UDP MPEG-TS มาที่พอร์ต 8554
  3. ส่ง keep-alive คู่ขนาน (ไม่งั้นสตรีมจะหยุดเอง)
  4. OpenCV เปิด udp://@0.0.0.0:8554 แล้ว imshow

ติดตั้ง:
  pip install opencv-python requests python-dotenv
  (ใช้ opencv-python ไม่ใช่ headless เพราะต้องเปิดหน้าต่างแสดงผล)

กด q ที่หน้าต่างวิดีโอเพื่อออก
"""
import os
import time
import threading

import requests
from dotenv import load_dotenv

# ---- ตั้ง ffmpeg ให้ latency ต่ำ (ต้องทำก่อน import cv2) ----
os.environ["OPENCV_FFMPEG_CAPTURE_OPTIONS"] = "fflags;nobuffer|flags;low_delay"
import cv2

# ---- config ----
load_dotenv()
IP = os.getenv("CH1_CAM1_IP", "172.21.168.51")
PORT = 8080
BASE = f"http://{IP}:{PORT}"
STREAM_PORT = 8554
# @0.0.0.0 = ฟัง UDP ที่เข้ามาทุก interface; param ท้าย url กัน buffer ล้น
STREAM_URL = f"udp://@0.0.0.0:{STREAM_PORT}?overrun_nonfatal=1&fifo_size=50000000"


def http_get(path, timeout=5):
    try:
        r = requests.get(BASE + path, timeout=timeout)
        return r.status_code
    except requests.exceptions.RequestException as e:
        print(f"  [ERR] {path}: {e}")
        return None


def keep_alive_loop(stop_event):
    """ส่ง keep-alive ทุก 2.5 วิ กันสตรีมหยุด"""
    while not stop_event.is_set():
        http_get("/gopro/camera/keep_alive")
        stop_event.wait(2.5)


def main():
    print(f"กล้อง: {BASE}")

    # 1) enable wired control
    print("[1] enable wired control:", http_get("/gopro/camera/control/wired_usb?p=1"))

    # 2) หยุดสตรีมเก่า (เผื่อค้าง) แล้วเริ่มใหม่
    http_get("/gopro/camera/stream/stop")
    time.sleep(0.5)
    code = http_get("/gopro/camera/stream/start")
    print("[2] stream start:", code)
    if code != 200:
        print("    เริ่มสตรีมไม่สำเร็จ — เช็ค IP / สาย / โหมดกล้อง")
        return

    # 3) keep-alive thread
    stop_event = threading.Event()
    threading.Thread(target=keep_alive_loop, args=(stop_event,), daemon=True).start()

    # 4) เปิดสตรีมด้วย OpenCV (อาจใช้เวลา 2-5 วิ กว่าจะจับ packet ได้)
    print("[3] กำลังเปิดสตรีม... (รอสักครู่)")
    cap = cv2.VideoCapture(STREAM_URL, cv2.CAP_FFMPEG)
    t0 = time.time()
    while not cap.isOpened() and time.time() - t0 < 10:
        time.sleep(0.5)
        cap.open(STREAM_URL, cv2.CAP_FFMPEG)

    if not cap.isOpened():
        print("    เปิดสตรีมไม่ได้ (ดูวิธีแก้ท้ายไฟล์)")
        stop_event.set()
        http_get("/gopro/camera/stream/stop")
        return

    print("[4] แสดงผลแล้ว — กด q ที่หน้าต่างเพื่อออก")
    fail = 0
    while True:
        ok, frame = cap.read()
        if not ok:
            fail += 1
            if fail > 200:
                print("    อ่านเฟรมไม่ได้ต่อเนื่อง — สตรีมหลุด")
                break
            continue
        fail = 0
        cv2.imshow("GoPro ch1 - live preview (q=quit)", frame)
        if cv2.waitKey(1) & 0xFF == ord("q"):
            break

    # 5) cleanup
    stop_event.set()
    cap.release()
    cv2.destroyAllWindows()
    http_get("/gopro/camera/stream/stop")
    print("[5] หยุดสตรีมแล้ว")


if __name__ == "__main__":
    main()

# ──────────────────────────────────────────────────────────
# ถ้าหน้าต่างไม่ขึ้น / จอดำ ลองไล่ตามนี้:
#
# 1) ทดสอบสตรีมด้วย ffplay ตรงๆ ก่อน (แยกว่าปัญหาอยู่ที่สตรีมหรือ OpenCV):
#      curl "http://<IP>:8080/gopro/camera/control/wired_usb?p=1"
#      curl "http://<IP>:8080/gopro/camera/stream/start"
#      ffplay -fflags nobuffer -f mpegts -i "udp://@0.0.0.0:8554"
#    ถ้า ffplay เห็นภาพแต่ OpenCV ไม่เห็น = ปัญหาที่ฝั่ง OpenCV/ffmpeg backend
#    ถ้า ffplay ก็ไม่เห็น = ปัญหาที่สตรีม/เน็ตเวิร์ก/ไฟร์วอลล์
#
# 2) macOS firewall อาจบล็อก UDP ขาเข้า:
#    System Settings → Network → Firewall → ปิดชั่วคราว หรืออนุญาต Python/Terminal
#
# 3) GoPro บางรุ่นสตรีม preview ผ่าน wired ไม่เสถียร ลองสลับไปต่อ WiFi แล้วใช้ IP 10.5.5.9
# ──────────────────────────────────────────────────────────