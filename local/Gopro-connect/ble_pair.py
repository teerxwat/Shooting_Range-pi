#!/usr/bin/env python3
# open_gopro WiFi driver ต้องการ locale en_US (ก่อน import อื่นๆ)
import os
os.environ["LANG"]   = "en_US.UTF-8"   # force override ค่าเดิม
os.environ["LC_ALL"] = "en_US.UTF-8"

"""
ble_pair.py — เชื่อม GoPro กับ WiFi Router ผ่าน Bluetooth
════════════════════════════════════════════════════════════
รันด้วย:  python ble_pair.py

สิ่งที่ทำ:
  1. เชื่อม Bluetooth กับกล้อง 1 ตัว
  2. ส่ง WiFi credentials → กล้องเชื่อม router
  3. บันทึก IP + password ลง gopro_auth.json (keyed by IP)
     → gopro.py จะอ่าน password อัตโนมัติเวลายิง HTTP request

ทำครั้งเดียวต่อกล้อง แล้วอัปเดต IP ใน .env
"""

import asyncio
import json
import os

from open_gopro import WirelessGoPro

# ─── ใส่ข้อมูล WiFi Router ──────────────────────────────────────
WIFI_SSID     = "thanita_5Ghz"
WIFI_PASSWORD = "aaoy2425"
# ────────────────────────────────────────────────────────────────

AUTH_FILE = os.path.join(os.path.dirname(__file__), "gopro_auth.json")


def load_auth() -> dict:
    """โหลด auth ที่มีอยู่แล้ว (ถ้ามี) — keyed by IP"""
    if os.path.exists(AUTH_FILE):
        try:
            return json.load(open(AUTH_FILE))
        except Exception:
            pass
    return {}


def save_auth(auth: dict):
    with open(AUTH_FILE, "w") as f:
        json.dump(auth, f, indent=2, ensure_ascii=False)


async def pair_camera():
    W = 52
    print("\n" + "━" * W)
    print("  🔵  GoPro BLE Pair Setup")
    print("━" * W)
    print()
    print("  ก่อนรัน:")
    print("  1. เปิดกล้อง")
    print("  2. กล้อง → Connections → Connect Device → GoPro Quik")
    print("  3. Bluetooth บน Mac เปิดอยู่")
    print()
    input("  กด Enter เมื่อพร้อม...")
    print()

    print("  🔍 กำลังค้นหากล้อง GoPro ผ่าน Bluetooth...")
    print("     (อาจใช้เวลา 10–30 วินาที)\n")

    try:
        # enable_wifi=False → ไม่แตะ WiFi ของ Mac เลย (หลีกเลี่ยง locale bug)
        # เราแค่ต้องการ password จาก BLE เท่านั้น
        async with WirelessGoPro(target=None, enable_wifi=False) as gopro:

            cam_id = gopro.identifier
            password = gopro.password

            print(f"  ✅ พบกล้อง : {cam_id}")
            print(f"  🔑 Password: {password}")
            print()

            # ─── ส่ง WiFi credentials เข้ากล้อง ────────────────
            print(f"  📡 กำลังส่ง WiFi credentials: '{WIFI_SSID}' เข้ากล้อง...")
            try:
                ble = gopro.ble_command
                # ลองทุก method ที่อาจมีใน open_gopro เวอร์ชันต่างๆ
                connect_fn = (
                    getattr(ble, "request_wifi_connect", None) or
                    getattr(ble, "connect_provisioned_network", None) or
                    getattr(ble, "wifi_connect", None)
                )
                if connect_fn:
                    result = await connect_fn(ssid=WIFI_SSID, password=WIFI_PASSWORD)
                    print(f"  ✅ ส่ง WiFi สำเร็จ: {result}")
                    await asyncio.sleep(3)
                else:
                    print("  ⚠️  ไม่พบ wifi connect command")
                    print("      → เชื่อม WiFi ผ่าน GoPro Quik บนมือถือแทนได้")
            except Exception as wifi_err:
                print(f"  ⚠️  ส่ง WiFi ไม่สำเร็จ: {wifi_err}")
                print("      → เชื่อม WiFi ผ่าน GoPro Quik บนมือถือแทนได้")

            # ─── รับ IP (กรอกเอง หรือจาก Router admin) ─────────
            print()
            print("  📋 หา IP กล้องได้จาก:")
            print("     - Router admin page (ดูรายการ DHCP clients)")
            print("     - หน้าจอกล้อง: Connections → Camera Info → IP Address")
            print()
            ip = input("  ใส่ IP ของกล้องตัวนี้ (Enter = ข้าม): ").strip()
            if not ip:
                ip = f"CAMERA_{cam_id.replace(' ', '_')}"
                print(f"  ⚠️  ข้ามการใส่ IP — บันทึกชั่วคราวเป็น '{ip}'")
                print("      แก้ไขใน gopro_auth.json ภายหลังได้")

            # ─── บันทึก auth (keyed by IP) ──────────────────────
            all_auth = load_auth()
            all_auth[ip] = {
                "camera_id": cam_id,
                "password":  password,
                "ssid":      WIFI_SSID,
            }
            save_auth(all_auth)

            print()
            print("  💾 บันทึก auth ที่: gopro_auth.json")
            print()
            print(f"  Password สำหรับกล้องนี้: {password}")
            print()
            print("  ─── ขั้นตอนต่อไป ───────────────────────────────────")
            print(f"  1. ให้กล้องเชื่อม WiFi router ผ่าน GoPro Quik (ถ้ายังไม่ได้)")
            print(f"  2. เปิด .env → ใส่ IP ของกล้องนี้: {ip}")
            print(f"     เช่น: CH1_CAM1_IP={ip}")
            print(f"  3. รัน python main.py")
            print("  ────────────────────────────────────────────────────")

    except Exception as e:
        print(f"\n  ❌ Error: {type(e).__name__}: {e}")
        print()
        print("  วิธีแก้:")
        print("  - เปิด Bluetooth บน Mac")
        print("  - ที่กล้อง: Connections → Connect Device → GoPro Quik")
        print("  - อยู่ใกล้กล้องไม่เกิน 1 เมตร")
        print("  - รอหน้าจอกล้องแสดง QR code แล้วค่อยกด Enter")

    print("━" * W)


if __name__ == "__main__":
    asyncio.run(pair_camera())
