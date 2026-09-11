# LianLian Pay (Thailand) — QR Payment Integration

Python client + FastAPI REST endpoints for LianLian Pay Direct API, covering the
three QR payment channels:

| Channel   | Service (`service`)          | `payment_method` | Result field                                   |
|-----------|------------------------------|------------------|------------------------------------------------|
| Thai QR   | `llpth.thaiqr.pay`           | `THAI_QR`        | `qr_code` — base64 PNG image + `qr_code_expire_sec` |
| WeChat QR | `llpth.wechatpay.pay`        | `DYNAMIC_CODE`   | `link_url` — `weixin://…` string to render as QR |
| Alipay QR | `llpth.alipay.offline.pay`   | `DYNAMIC_CODE`   | `link_url` — `https://qr.alipay.com/…` to render as QR |

Also includes payment status **query** and a signed **webhook** receiver.

## Layout

```
lianlian/
  signing.py    # SHA1withRSA canonical sign-string, sign & verify
  client.py     # LianLianClient: create_thai_qr / create_wechat_qr / create_alipay_qr / query_payment / verify_callback
  config.py     # LianLianConfig.from_env()
app.py          # FastAPI endpoints
tests/
  test_signing.py   # validated against the official signature-doc examples
requirements.txt
.env.example
```

## Setup

```bash
pip install -r requirements.txt
cp .env.example .env      # fill in merchant_id + keys
uvicorn app:app --reload --port 8000
```

Open Swagger UI at http://localhost:8000/docs.

## Credentials

You need three things from your LianLian merchant onboarding:

1. **Merchant ID** (`LIANLIAN_MERCHANT_ID`)
2. **Your RSA private key** (`LIANLIAN_PRIVATE_KEY`) — used to sign every request.
3. **LianLian's RSA public key** (`LIANLIAN_PUBLIC_KEY`) — used to verify webhook signatures.

Keys may be pasted as the bare base64 body (like the docs show) or supplied as a
PEM file via `LIANLIAN_PRIVATE_KEY_FILE` / `LIANLIAN_PUBLIC_KEY_FILE`.

## Usage — library

```python
from lianlian import LianLianClient, LianLianConfig

client = LianLianClient(LianLianConfig.from_env())

# Thai QR → base64 PNG
p = client.create_thai_qr(order_amount="100.00", order_desc="Order #123")
print(p.order_id, p.qr_image_base64, p.expire_seconds)

# WeChat QR → weixin:// string (render as a QR image on your frontend)
w = client.create_wechat_qr(order_amount="169.00")
print(w.qr_content)

# Alipay QR → https://qr.alipay.com/... (render as a QR image)
a = client.create_alipay_qr(order_amount="3.00",
                            customer={"merchant_user_id": "U1", "full_name": "Bruce Lee"})
print(a.qr_content)

# Status
print(client.query_payment(p.merchant_order_id)["order_status"])
```

## Usage — REST

```bash
# Thai QR
curl -X POST localhost:8000/payments/thai-qr \
  -H 'Content-Type: application/json' \
  -d '{"order_amount":"100.00","order_desc":"Order #123"}'

# WeChat QR
curl -X POST localhost:8000/payments/wechat-qr \
  -H 'Content-Type: application/json' -d '{"order_amount":"169.00"}'

# Alipay QR
curl -X POST localhost:8000/payments/alipay-qr \
  -H 'Content-Type: application/json' \
  -d '{"order_amount":"3.00","customer":{"merchant_user_id":"U1","full_name":"Bruce Lee"}}'

# Query
curl localhost:8000/payments/ORDER_202301010001
```

Thai QR response `qr_image_base64` is a base64 PNG — render directly:
`<img src="data:image/png;base64,{qr_image_base64}">`. For WeChat/Alipay, take
`qr_content` and render it as a QR code (e.g. with `qrcode` on the backend or a JS
QR library on the frontend).

## Webhook

Point `notify_url` (env `LIANLIAN_NOTIFY_URL`) at `POST /webhook/lianlian`.

- The endpoint verifies the `sign` header against LianLian's public key before
  acting. Unverified callbacks return HTTP 400 and are **not** acknowledged.
- On success you must return `{"code": 200000, "message": "Success"}`; otherwise
  LianLian retries up to 13 times, every 10 minutes.
- Payment notifications carry `order_status = "PS"`; refund notifications carry
  `refund_status = "RS"`. Handle them idempotently in the marked section of
  `app.py`. Treating the async notification (or a fresh `query_payment`) as the
  authoritative status is recommended over the browser redirect.

## Signing

Implemented in `lianlian/signing.py` exactly per the docs: keys sorted ascending,
nested objects expanded with their own sorted keys (parent key dropped), array
elements expanded in order, empty values skipped, then `SHA1withRSA` +
base64. `tests/test_signing.py` asserts the builder reproduces both worked
examples from the official signature page.

```bash
python tests/test_signing.py     # or: pytest tests/
```

## Notes / TODO before production

- Gateways: sandbox `https://sandbox-th.lianlianpay-inc.com/gateway`,
  production `https://api.lianlianpay.co.th/gateway`. Set `LIANLIAN_ENV=production`
  when going live.
- Get credentials from the Merchant Portal
  (sandbox: https://sandbox-th-merchant.lianlianpay-inc.com/user/login).
  You generate your own RSA keypair, upload the public key to the portal, and
  download LianLian's public key from there. Onboarding: support-thaipay@lianlianpay.com.
- Refund creation (`llpth.refund.apply`) is not included here; the same
  `_post` + signing pattern applies if you need it.
- The three QR channels may require specific product/customer fields to be
  enabled on your merchant account — check with LianLian if a channel returns a
  config error.
```
