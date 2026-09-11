"""
Smoke test against the LianLian sandbox.

Usage:
    pip install -r requirements.txt
    python try_sandbox.py               # Thai QR (default)
    python try_sandbox.py wechat        # WeChat QR
    python try_sandbox.py alipay        # Alipay QR

It loads credentials from .env, creates a QR payment, prints the result, and:
  - Thai QR  -> saves the returned base64 PNG to qr_thai.png
  - WeChat/Alipay -> renders the returned link into qr_<channel>.png (needs `qrcode`)
Then polls payment status once so you can see the query flow.
"""

import base64
import sys

from dotenv import load_dotenv

load_dotenv()

from lianlian import LianLianClient, LianLianConfig, LianLianError  # noqa: E402


def save_png_from_base64(b64: str, path: str) -> None:
    with open(path, "wb") as fh:
        fh.write(base64.b64decode(b64))
    print(f"  saved QR image -> {path}")


def save_png_from_text(text: str, path: str) -> None:
    try:
        import qrcode
    except ImportError:
        print("  (install `qrcode[pil]` to render this link as an image: "
              "pip install 'qrcode[pil]')")
        return
    qrcode.make(text).save(path)
    print(f"  rendered QR image -> {path}")


def main() -> None:
    channel = (sys.argv[1] if len(sys.argv) > 1 else "thai").lower()
    amount = sys.argv[2] if len(sys.argv) > 2 else "1.00"
    order_id = sys.argv[3] if len(sys.argv) > 3 else None  # custom merchant_order_id

    try:
        client = LianLianClient(LianLianConfig.from_env())
    except Exception as exc:  # config/env problems
        print(f"[config error] {exc}")
        sys.exit(1)

    print(f"Gateway : {client.config.gateway_url}")
    print(f"Merchant: {client.config.merchant_id}")
    print(f"Creating {channel} QR for {amount} THB ...\n")

    try:
        customer = {"merchant_user_id": "U1", "full_name": "Test User"}
        if channel == "wechat":
            p = client.create_wechat_qr(order_amount=amount, order_desc="sandbox test",
                                        merchant_order_id=order_id, customer=customer)
        elif channel == "alipay":
            p = client.create_alipay_qr(order_amount=amount, order_desc="sandbox test",
                                        merchant_order_id=order_id, customer=customer)
        else:
            p = client.create_thai_qr(order_amount=amount, order_desc="sandbox test",
                                      merchant_order_id=order_id, customer=customer)
    except LianLianError as exc:
        print(f"[gateway error] {exc}")
        print(f"  code={exc.code}  trace_id={exc.trace_id}")
        if exc.raw:
            print(f"  raw={exc.raw}")
        sys.exit(2)

    print("Success!")
    print(f"  order_id          : {p.order_id}")
    print(f"  merchant_order_id : {p.merchant_order_id}")
    print(f"  order_status      : {p.order_status}")
    print(f"  amount            : {p.order_amount} {p.order_currency}")
    if p.expire_seconds:
        print(f"  expires in        : {p.expire_seconds} sec")

    if p.qr_image_base64:
        # LianLian returns the QR as a base64 PNG (Thai QR).
        print(f"\n  qr_image_base64 (len={len(p.qr_image_base64)}):")
        print(f"  {p.qr_image_base64[:80]}...{p.qr_image_base64[-20:]}")
        with open("qr_thai.b64.txt", "w") as fh:
            fh.write(p.qr_image_base64)
        print("  full base64 saved -> qr_thai.b64.txt")
        save_png_from_base64(p.qr_image_base64, "qr_thai.png")
    elif p.qr_content:
        print(f"  qr content        : {p.qr_content}")
        save_png_from_text(p.qr_content, f"qr_{p.channel}.png")

    print("\nQuerying status back ...")
    try:
        status = client.query_payment(p.merchant_order_id)
        print(f"  order_status      : {status.get('order_status')}")
    except LianLianError as exc:
        print(f"  [query error] {exc}  (code={exc.code})")


if __name__ == "__main__":
    main()
