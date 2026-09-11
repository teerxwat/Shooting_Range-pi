"""Configuration for the LianLian Pay client, loaded from environment variables.

Variable names map 1:1 to what you see in the LianLian merchant portal:

    MERCHANT_ID              -> your merchant id (Home / account info)
    MERCHANT_PRIVATE_KEY     -> the PRIVATE key you generated yourself
                                (its public half is the "Merchant public key" in the portal)
    LIANLIANPAY_PUBLIC_KEY   -> the "LianLianPay public key" shown in Dev config
"""

from __future__ import annotations

import hashlib
import os
from dataclasses import dataclass


SANDBOX_GATEWAY = "https://sandbox-th.lianlianpay-inc.com/gateway"
PRODUCTION_GATEWAY = "https://api.lianlianpay.co.th/gateway"

# ลายนิ้วมือของ "LianLianPay public key" ฝั่ง sandbox
# เอาไว้จับกรณีตั้ง LIANLIANPAY_ENV=production แต่ลืมเปลี่ยนคีย์
# ถ้าปล่อยผ่าน: สร้าง QR ได้ ลูกค้าจ่ายเงินจริงได้ แต่ verify webhook ไม่ผ่าน
# → ระบบไม่รู้ว่าจ่ายแล้ว ลูกค้าเสียเงินฟรี ซึ่งแย่กว่าแอปไม่ยอมสตาร์ทมาก
SANDBOX_PUBLIC_KEY_SHA256 = (
    "b2602edf2370df46f36613a971cbefa60338e6ef17b04af6923a9ea1aff378a8"
)


@dataclass
class LianLianConfig:
    merchant_id: str
    merchant_private_key: str      # YOUR RSA private key (used to sign requests)
    lianlianpay_public_key: str    # LianLianPay public key (used to verify callbacks)
    gateway_url: str = SANDBOX_GATEWAY
    store_id: str | None = None
    # "online"  -> llpth.alipay.pay + WAP_PAYMENT  (ลูกค้าจ่ายบนมือถือตัวเอง เด้งเข้าแอปแล้วกลับมา)
    # "offline" -> llpth.alipay.offline.pay + DYNAMIC_CODE (ร้านโชว์ QR ให้ลูกค้าอีกเครื่องสแกน)
    # ค่าเริ่มต้นเป็น offline เพื่อไม่ให้พฤติกรรมเปลี่ยนเองตอนอัปโค้ด — ต้องตั้งใจเปิดใน .env
    alipay_mode: str = "offline"
    # "h5"      -> H5_PAYMENT   (ลูกค้ากดบนมือถือตัวเอง เด้งเข้าแอป WeChat — ต้องส่ง remote_ip)
    # "dynamic" -> DYNAMIC_CODE (ได้ weixin:// สำหรับทำเป็นรูป QR ให้อีกเครื่องสแกน)
    wechat_mode: str = "dynamic"
    default_notify_url: str | None = None
    default_redirect_url: str | None = None

    @classmethod
    def from_env(cls) -> "LianLianConfig":
        env = os.environ.get("LIANLIANPAY_ENV", "sandbox").lower()
        gateway = PRODUCTION_GATEWAY if env == "production" else SANDBOX_GATEWAY

        merchant_id = _required("MERCHANT_ID")
        public_key = _read_key("LIANLIANPAY_PUBLIC_KEY")
        if env == "production":
            _check_production(merchant_id, public_key)

        return cls(
            merchant_id=merchant_id,
            merchant_private_key=_read_key("MERCHANT_PRIVATE_KEY"),
            lianlianpay_public_key=public_key,
            gateway_url=os.environ.get("GATEWAY_URL", gateway),
            store_id=os.environ.get("MERCHANT_STORE_ID") or None,
            alipay_mode=os.environ.get("ALIPAY_MODE", "offline").strip().lower(),
            wechat_mode=os.environ.get("WECHAT_MODE", "dynamic").strip().lower(),
            default_notify_url=os.environ.get("NOTIFY_URL") or None,
            default_redirect_url=os.environ.get("REDIRECT_URL") or None,
        )


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def _read_key(name: str) -> str:
    """A key may be provided inline, or via <NAME>_FILE pointing at a PEM file."""
    file_var = os.environ.get(f"{name}_FILE")
    if file_var:
        with open(file_var, "r", encoding="utf-8") as fh:
            return fh.read()
    return _required(name)


def _check_production(merchant_id: str, public_key: str) -> None:
    """
    Refuse to start on a half-migrated production config.

    Every failure here is one that would otherwise be discovered only after a
    real customer had already been charged, so failing loudly at boot is the
    cheaper outcome.
    """
    problems: list[str] = []

    key = "".join(public_key.split())
    if key.startswith("-----BEGIN"):                       # PEM wrapper is fine
        key = "".join(
            line for line in public_key.splitlines() if not line.startswith("-----")
        ).strip()

    if not key or key.startswith("PASTE_"):
        problems.append(
            "LIANLIANPAY_PUBLIC_KEY ยังไม่ได้ตั้งค่า "
            "— ไปเอาจาก Dev config ของ https://merchant.lianlianpay.co.th"
        )
    elif hashlib.sha256(key.encode()).hexdigest() == SANDBOX_PUBLIC_KEY_SHA256:
        problems.append(
            "LIANLIANPAY_PUBLIC_KEY ยังเป็นคีย์ของ sandbox อยู่ "
            "— verify ลายเซ็น webhook จะไม่ผ่าน ลูกค้าจ่ายเงินแล้วระบบจะไม่รู้"
        )

    if not merchant_id.startswith("14") or len(merchant_id) != 18:
        problems.append(
            f"MERCHANT_ID ผิดรูปแบบ: {merchant_id!r} "
            "— ต้องเป็นตัวเลข 18 หลัก ขึ้นต้นด้วย 14"
        )

    store_id = os.environ.get("MERCHANT_STORE_ID", "").strip()
    if store_id and not store_id.startswith(merchant_id[:10]):
        problems.append(
            f"MERCHANT_STORE_ID ({store_id}) ดูไม่ใช่ร้านของ MERCHANT_ID นี้ "
            "— ถ้าไม่แน่ใจให้ลบบรรทัดนี้ทิ้ง เพราะไม่ใช่ค่าบังคับ"
        )

    if problems:
        raise RuntimeError(
            "ตั้งค่า production ไม่ครบ ไม่ยอมสตาร์ท:\n  - "
            + "\n  - ".join(problems)
        )
