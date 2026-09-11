#!/usr/bin/env python3
"""
test_wake.py — ทดสอบปลุกกล้อง GoPro ผ่าน BLE พร้อมกันหลายตัว
══════════════════════════════════════════════════════════════════

รัน:  python test_wake.py

วิธีทำงาน:
  1. อ่าน camera_id จาก gopro_auth.json (บันทึกตอน ble_pair.py)
  2. เปิด BLE connection ไปหาแต่ละกล้องพร้อมกัน (asyncio.gather)
     → กล้องที่นอนหลับจะตื่นขึ้นมาทันทีที่ BLE connect สำเร็จ
  3. เช็ค HTTP ping เพื่อยืนยันว่ากล้องออนไลน์บน WiFi แล้ว
  4. แสดงผลสรุป

หมายเหตุ:
  - Mac Bluetooth รองรับ ~7 BLE connection พร้อมกัน
  - กล้องต้องถูก pair ไว้แล้ว (ผ่าน ble_pair.py)
  - กล้องต้องอยู่ในระยะ Bluetooth (~10 เมตร)
"""

import asyncio
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor

import requests
from dotenv import load_dotenv
from open_gopro import WirelessGoPro

load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))

AUTH_FILE = os.path.join(os.path.dirname(__file__), "gopro_auth.json")
HTTP_PORT = int(os.getenv("PORT", "8080"))
HTTP_TIMEOUT = 8   # วิ รอ HTTP หลังปลุก

W = 56

# ─── โหลด auth ────────────────────────────────────────────────────────────────

def load_auth() -> dict:
    if not os.path.exists(AUTH_FILE):
        print("  ❌ ไม่พบ gopro_auth.json — รัน ble_pair.py ก่อน")
        return {}
    try:
        return json.load(open(AUTH_FILE))
    except Exception as e:
        print(f"  ❌ อ่าน gopro_auth.json ไม่ได้: {e}")
        return {}


# ─── ปลุกกล้อง 1 ตัวผ่าน BLE ─────────────────────────────────────────────────

async def wake_one(ip: str, info: dict, results: dict):
    """
    เชื่อม BLE → กล้องตื่น → ตัดการเชื่อมต่อ
    results[ip] = "ok" | "ble_fail" | "http_fail" | "no_id"
    """
    cam_id  = info.get("camera_id", "")
    pw      = info.get("password", "")
    label   = f"{cam_id} ({ip})"

    if not cam_id:
        print(f"  ⚠️  {ip} — ไม่มี camera_id ใน gopro_auth.json")
        results[ip] = "no_id"
        return

    print(f"  🔵 [{label}] กำลัง connect BLE...")
    t0 = time.time()

    try:
        async with WirelessGoPro(target=cam_id, enable_wifi=False) as gopro:
            elapsed_ble = time.time() - t0
            print(f"  ✅ [{label}] BLE connected ({elapsed_ble:.1f}s) — กล้องตื่นแล้ว")
            # ไม่ต้องทำอะไรใน context → แค่ connect ก็ปลุกได้
            # (ถ้าต้องการ ส่ง keep_alive หรือเปลี่ยน preset ก็ทำที่นี่)

    except Exception as e:
        print(f"  ❌ [{label}] BLE fail: {e}")
        results[ip] = "ble_fail"
        return

    # ── เช็ค HTTP ──────────────────────────────────────────────────────────────
    print(f"  🌐 [{label}] เช็ค HTTP...")
    params = {"password": pw} if pw else {}
    url    = f"http://{ip}:{HTTP_PORT}/gopro/camera/state"
    sess   = requests.Session()
    sess.trust_env = False

    try:
        r = sess.get(url, params=params, timeout=HTTP_TIMEOUT)
        if r.status_code == 200:
            elapsed_total = time.time() - t0
            print(f"  ✅ [{label}] HTTP OK — รวม {elapsed_total:.1f}s")
            results[ip] = "ok"
        else:
            print(f"  ⚠️  [{label}] HTTP {r.status_code}")
            results[ip] = "http_fail"
    except Exception as e:
        print(f"  ❌ [{label}] HTTP fail: {e}")
        results[ip] = "http_fail"


# ─── ปลุกทุกกล้องพร้อมกัน ────────────────────────────────────────────────────

async def wake_all(auth: dict):
    results: dict[str, str] = {}

    # กรองเฉพาะกล้องที่มี camera_id
    cameras = {ip: info for ip, info in auth.items() if info.get("camera_id")}
    if not cameras:
        print("  ❌ ไม่พบกล้องใน gopro_auth.json")
        return results

    print(f"\n  พบ {len(cameras)} กล้องใน auth file")
    print(f"  กำลังปลุกพร้อมกัน...\n")

    # รัน wake_one ทุกตัวพร้อมกัน
    await asyncio.gather(*(wake_one(ip, info, results) for ip, info in cameras.items()))

    return results


# ─── รายงานผล ─────────────────────────────────────────────────────────────────

def print_summary(auth: dict, results: dict):
    print()
    print("━" * W)
    print("  สรุปผล")
    print("━" * W)

    ok       = [ip for ip, r in results.items() if r == "ok"]
    ble_fail = [ip for ip, r in results.items() if r == "ble_fail"]
    http_fail= [ip for ip, r in results.items() if r == "http_fail"]
    no_id    = [ip for ip, r in results.items() if r == "no_id"]

    for ip in ok:
        cam_id = auth.get(ip, {}).get("camera_id", ip)
        print(f"  ✅  {cam_id} ({ip})  — ออนไลน์")
    for ip in ble_fail:
        cam_id = auth.get(ip, {}).get("camera_id", ip)
        print(f"  ❌  {cam_id} ({ip})  — BLE ไม่ได้ (กล้องปิดอยู่/ไม่อยู่ในระยะ)")
    for ip in http_fail:
        cam_id = auth.get(ip, {}).get("camera_id", ip)
        print(f"  ⚠️   {cam_id} ({ip})  — BLE OK แต่ HTTP ไม่ตอบ (ยังเชื่อม WiFi อยู่?)")
    for ip in no_id:
        print(f"  ⚠️   {ip}  — ไม่มี camera_id (ต้อง pair ใหม่)")

    print("━" * W)
    print(f"  OK {len(ok)} / {len(results)} กล้อง")
    print("━" * W)


# ─── Main ──────────────────────────────────────────────────────────────────────

async def main():
    print()
    print("━" * W)
    print("  🔵  GoPro BLE Wake Test")
    print("━" * W)

    auth = load_auth()
    if not auth:
        return

    # แสดงรายชื่อที่จะปลุก
    print(f"\n  กล้องทั้งหมดใน gopro_auth.json:")
    for ip, info in auth.items():
        print(f"    • {info.get('camera_id', '?')}  →  {ip}")

    print()
    input("  กด Enter เพื่อเริ่มปลุกทุกตัวพร้อมกัน...")

    t_start = time.time()
    results = await wake_all(auth)
    elapsed = time.time() - t_start

    print(f"\n  เวลารวม: {elapsed:.1f}s")
    print_summary(auth, results)


if __name__ == "__main__":
    asyncio.run(main())
