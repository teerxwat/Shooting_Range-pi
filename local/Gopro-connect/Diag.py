#!/usr/bin/env python3
"""
Diagnostic: ดูว่ากล้องทำอะไรตอนอัด (reachable? busy? encoding? ได้ไฟล์ไหม)

ใช้:
  python diag.py                # โหมด VIDEO มาตรฐาน (id=0) อัด 5 วิ  <- ลองตัวนี้ก่อน
  python diag.py 262144 5       # โหมด Burst Slo-Mo อัด 5 วิ
  python diag.py 0 8            # VIDEO มาตรฐาน อัด 8 วิ

อ่านผล:
  - reachable=False ระหว่างอัด = USB link หลุด (ปัญหาฮาร์ดแวร์/โหมด)
  - busy(8)/encoding(10) = สถานะกล้อง (1=กำลังทำงาน)
  - ถ้า 'new files' ว่าง = ไม่ได้บันทึกไฟล์จริง
"""
import os
import sys
import time

import config
from gopro import GoProCamera

PRESET_ID = int(sys.argv[1]) if len(sys.argv) > 1 else 0       # 0 = standard video
SECONDS = int(sys.argv[2]) if len(sys.argv) > 2 else 5

# ใช้ IP กล้องตัวแรกของเลน 1 จาก .env
ip = os.getenv("CH1_CAM1_IP", "172.21.168.51")
cam = GoProCamera(name="diag", ip=ip, port=config.PORT, timeout=5)

print(f"=== DIAG  ip={ip}  preset={PRESET_ID}  seconds={SECONDS} ===\n")

print("[1] enable wired control:", cam.enable_wired_control())

st = cam.get_state()
print("[2] state ok:", st is not None,
      "| battery:", st.get("status", {}).get("70") if st else "n/a")

print(f"[3] load preset {PRESET_ID}:", cam.load_preset(PRESET_ID))
time.sleep(1.5)

before = cam.list_media()
print(f"[4] media ก่อนถ่าย: {len(before)} ไฟล์")

print("[5] shutter START:", cam.start_recording())

print("[6] ตรวจสถานะระหว่างอัด (ทุก 1 วิ):")
for s in range(SECONDS):
    time.sleep(1)
    state = cam.get_state(timeout=3, retries=0)
    if state is None:
        print(f"    t={s+1}s  reachable=False  <-- กล้องหลุด!")
    else:
        st = state.get("status", {})
        print(f"    t={s+1}s  reachable=True  busy(8)={st.get('8')}  "
              f"encoding(10)={st.get('10')}")

print("[7] shutter STOP:", cam.stop_recording())

print("[8] รอ finalize + หาไฟล์ใหม่ (สูงสุด 20 วิ):")
new = set()
for i in range(20):
    time.sleep(1)
    new = cam.list_media() - before
    if new:
        break
    print(f"\r    waiting... {i+1}s", end="", flush=True)
print()

if new:
    print(f"[9] ✓ เจอไฟล์ใหม่ {len(new)} ไฟล์:")
    for d, n in sorted(new):
        print(f"      {d}/{n}")
else:
    print("[9] ✗ ไม่เจอไฟล์ใหม่เลย — กล้องไม่ได้บันทึก หรือ finalize ช้ามาก")