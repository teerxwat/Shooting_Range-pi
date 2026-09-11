"""
LianLian Pay (Thailand) Direct-API client.

Supports the three QR payment flows requested plus payment status query:

    * Thai QR   -> service "llpth.thaiqr.pay",         method "THAI_QR"
    * WeChat QR -> service "llpth.wechatpay.pay",      method "DYNAMIC_CODE"
    * Alipay QR -> service "llpth.alipay.offline.pay", method "DYNAMIC_CODE"

All requests are POSTed as JSON to the single gateway URL with headers:
    Content-Type: application/json
    sign-type:    RSA
    sign:         <base64 SHA1withRSA signature of the request body>

Docs: https://doc.lianlianpay.co.th/docs/direct-api
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass, field
from typing import Any, Optional

import requests

from .config import LianLianConfig
from . import signing

VERSION = "v1"



class LianLianError(Exception):
    """Raised when the gateway returns a non-success code or a transport error occurs."""

    def __init__(self, message: str, code: Optional[int] = None, trace_id: Optional[str] = None,
                 raw: Optional[dict] = None):
        super().__init__(message)
        self.code = code
        self.trace_id = trace_id
        self.raw = raw


@dataclass
class QRPayment:
    """Normalised result of a QR create call across the three channels."""
    channel: str                       # "thai_qr" | "wechat" | "alipay"
    order_id: str                      # LianLian bill id
    merchant_order_id: str
    order_status: str
    order_amount: str
    order_currency: str
    qr_image_base64: Optional[str] = None   # Thai QR: base64-encoded PNG
    qr_content: Optional[str] = None        # WeChat/Alipay: string to render as a QR / open
    expire_seconds: Optional[str] = None
    create_time: Optional[str] = None
    raw: dict[str, Any] = field(default_factory=dict)


class LianLianClient:
    def __init__(self, config: LianLianConfig, timeout: int = 30,
                 session: Optional[requests.Session] = None):
        self.config = config
        self.timeout = timeout
        self._session = session or requests.Session()

    # ------------------------------------------------------------------ #
    # Low-level request
    # ------------------------------------------------------------------ #
    def _post(self, body: dict[str, Any]) -> dict[str, Any]:
        # Drop keys with empty values so they aren't signed or sent.
        body = {k: v for k, v in body.items() if v not in (None, "")}
        print(f"  [lianlian] -> {body.get('service')} moid={body.get('merchant_order_id')}"
              f" method={body.get('payment_method')} amt={body.get('order_amount')}", flush=True)
        signature = signing.sign(body, self.config.merchant_private_key)
        headers = {
            "Content-Type": "application/json",
            "sign-type": "RSA",
            "sign": signature,
        }
        try:
            resp = self._session.post(
                self.config.gateway_url, json=body, headers=headers, timeout=self.timeout
            )
        except requests.RequestException as exc:
            raise LianLianError(f"Transport error: {exc}") from exc
        return self._handle_response(resp)

    def _get(self, params: dict[str, Any]) -> dict[str, Any]:
        params = {k: v for k, v in params.items() if v not in (None, "")}
        signature = signing.sign(params, self.config.merchant_private_key)
        headers = {
            "Content-Type": "application/json",
            "sign-type": "RSA",
            "sign": signature,
        }
        try:
            resp = self._session.get(
                self.config.gateway_url, params=params, headers=headers, timeout=self.timeout
            )
        except requests.RequestException as exc:
            raise LianLianError(f"Transport error: {exc}") from exc
        return self._handle_response(resp)

    @staticmethod
    def _handle_response(resp: requests.Response) -> dict[str, Any]:
        try:
            payload = resp.json()
        except ValueError:
            raise LianLianError(
                f"Non-JSON response (HTTP {resp.status_code}): {resp.text[:500]}"
            )
        code = payload.get("code")
        if code != 200000:
            raise LianLianError(
                payload.get("message", "Request failed"),
                code=code,
                trace_id=payload.get("trace_id"),
                raw=payload,
            )
        return payload.get("data", {})

    # ------------------------------------------------------------------ #
    # Helpers
    # ------------------------------------------------------------------ #
    def _base_body(self, service: str, merchant_order_id: str, order_amount: str,
                   order_currency: str, order_desc: str,
                   notify_url: Optional[str], redirect_url: Optional[str],
                   customer: Optional[dict], products: Optional[list]) -> dict[str, Any]:
        body: dict[str, Any] = {
            "version": VERSION,
            "service": service,
            "merchant_id": self.config.merchant_id,
            "merchant_order_id": merchant_order_id,
            "order_amount": str(order_amount),
            "order_currency": order_currency,
            "order_desc": order_desc,
            # Alipay/WeChat บังคับ order_info (400000 "order_info blank") ส่วน Thai QR ใช้ order_desc
            # เอกสารมีทั้งสองชื่อปนกันในแต่ละตัวอย่าง — ส่งทั้งคู่ ข้อความเดียวกัน
            "order_info": order_desc,
            "notify_url": notify_url or self.config.default_notify_url,
            "redirect_url": redirect_url or self.config.default_redirect_url,
        }
        if self.config.store_id:
            body["store_id"] = self.config.store_id
        if customer:
            body["customer"] = customer
        if products:
            body["products"] = products
        return body

    @staticmethod
    def _order_id(merchant_order_id: Optional[str]) -> str:
        return merchant_order_id or f"ORDER_{uuid.uuid4().hex[:24]}"

    # ------------------------------------------------------------------ #
    # Thai QR
    # ------------------------------------------------------------------ #
    def create_thai_qr(self, order_amount: str, order_desc: str = "Payment",
                       merchant_order_id: Optional[str] = None, order_currency: str = "THB",
                       customer: Optional[dict] = None, products: Optional[list] = None,
                       notify_url: Optional[str] = None) -> QRPayment:
        moid = self._order_id(merchant_order_id)
        body = self._base_body(
            "llpth.thaiqr.pay", moid, order_amount, order_currency, order_desc,
            notify_url, None, customer, products,
        )
        body["payment_method"] = "THAI_QR"
        # เอกสารระบุชื่อ payment_method แต่ gateway ตอบ "payment_type blank" (400000)
        # ซึ่งเป็นชื่อเดิมของฟิลด์เดียวกัน ส่งทั้งคู่ไปเลย ค่าตรงกันเสมอ
        body["payment_type"] = "THAI_QR"
        data = self._post(body)
        return QRPayment(
            channel="thai_qr",
            order_id=data.get("order_id", ""),
            merchant_order_id=data.get("merchant_order_id", moid),
            order_status=data.get("order_status", ""),
            order_amount=data.get("order_amount", str(order_amount)),
            order_currency=data.get("order_currency", order_currency),
            qr_image_base64=data.get("qr_code"),
            expire_seconds=data.get("qr_code_expire_sec"),
            create_time=data.get("create_time"),
            raw=data,
        )

    # ------------------------------------------------------------------ #
    # WeChat QR (DYNAMIC_CODE)
    # ------------------------------------------------------------------ #
    def create_wechat_qr(self, order_amount: str, order_desc: str = "Payment",
                         merchant_order_id: Optional[str] = None, order_currency: str = "THB",
                         customer: Optional[dict] = None, products: Optional[list] = None,
                         notify_url: Optional[str] = None,
                         redirect_url: Optional[str] = None,
                         remote_ip: Optional[str] = None) -> QRPayment:
        """
        h5      = ลูกค้าเปิดเว็บบนมือถือตัวเอง กดแล้วเข้าแอป WeChat จ่ายเสร็จเด้งกลับ
        dynamic = ได้ weixin:// ไว้ทำเป็นรูป QR ให้อีกเครื่องสแกน (เปิดบนเครื่องเดียวกันไม่ทำงาน)
        WeChat บังคับส่ง client.remote_ip เฉพาะโหมด h5
        """
        moid = self._order_id(merchant_order_id)
        h5 = self.config.wechat_mode == "h5"
        method = "H5_PAYMENT" if h5 else "DYNAMIC_CODE"

        body = self._base_body(
            "llpth.wechatpay.pay", moid, order_amount, order_currency, order_desc,
            notify_url, redirect_url if h5 else None, customer, products,
        )
        if h5:
            body["client"] = {"remote_ip": remote_ip or "1.1.1.1"}
        body["payment_method"] = method
        # เอกสารระบุชื่อ payment_method แต่ gateway ตอบ "payment_type blank" (400000)
        # ซึ่งเป็นชื่อเดิมของฟิลด์เดียวกัน ส่งทั้งคู่ไปเลย ค่าตรงกันเสมอ
        body["payment_type"] = method
        data = self._post(body)
        return QRPayment(
            channel="wechat",
            order_id=data.get("order_id", ""),
            merchant_order_id=data.get("merchant_order_id", moid),
            order_status=data.get("order_status", ""),
            order_amount=data.get("order_amount", str(order_amount)),
            order_currency=data.get("order_currency", order_currency),
            qr_content=data.get("link_url"),   # e.g. weixin://wxpay/bizpayurl?pr=...
            create_time=data.get("create_time"),
            raw=data,
        )

    # ------------------------------------------------------------------ #
    # Alipay QR (offline DYNAMIC_CODE)
    # ------------------------------------------------------------------ #
    def create_alipay_qr(self, order_amount: str, order_desc: str = "Payment",
                         merchant_order_id: Optional[str] = None, order_currency: str = "THB",
                         customer: Optional[dict] = None, products: Optional[list] = None,
                         notify_url: Optional[str] = None,
                         redirect_url: Optional[str] = None) -> QRPayment:
        moid = self._order_id(merchant_order_id)
        """
        online  = ลูกค้าเปิดเว็บบนมือถือตัวเอง กดแล้วเด้งเข้าแอป Alipay จ่ายเสร็จเด้งกลับ
        offline = ร้านโชว์ QR บนจอ ให้ลูกค้าเอาอีกเครื่องมาสแกน
        เลือกด้วย ALIPAY_MODE ใน .env — บัญชี merchant ต้องเปิดสิทธิ์ตัวที่เลือกไว้ด้วย
        """
        if self.config.alipay_mode == "online":
            service, method = "llpth.alipay.pay", "WAP_PAYMENT"
        else:
            service, method = "llpth.alipay.offline.pay", "DYNAMIC_CODE"

        body = self._base_body(
            service, moid, order_amount, order_currency, order_desc,
            notify_url, redirect_url, customer, products,
        )
        body["payment_method"] = method
        # เอกสารระบุชื่อ payment_method แต่ gateway ตอบ "payment_type blank" (400000)
        # ซึ่งเป็นชื่อเดิมของฟิลด์เดียวกัน ส่งทั้งคู่ไปเลย ค่าตรงกันเสมอ
        body["payment_type"] = method
        data = self._post(body)
        return QRPayment(
            channel="alipay",
            order_id=data.get("order_id", ""),
            merchant_order_id=data.get("merchant_order_id", moid),
            order_status=data.get("order_status", ""),
            order_amount=data.get("order_amount", str(order_amount)),
            order_currency=data.get("order_currency", order_currency),
            qr_content=data.get("link_url"),   # e.g. https://qr.alipay.com/...
            create_time=data.get("order_create_time") or data.get("create_time"),
            raw=data,
        )

    # ------------------------------------------------------------------ #
    # Payment status query
    # ------------------------------------------------------------------ #
    def query_payment(self, merchant_order_id: str) -> dict[str, Any]:
        params = {
            "version": VERSION,
            "service": "llpth.payment.query",
            "merchant_id": self.config.merchant_id,
            "merchant_order_id": merchant_order_id,
        }
        return self._get(params)

    # ------------------------------------------------------------------ #
    # Callback verification
    # ------------------------------------------------------------------ #
    def verify_callback(self, body: dict[str, Any], signature_b64: str) -> bool:
        """Verify an inbound webhook/redirect using LianLian's public key."""
        return signing.verify(body, signature_b64, self.config.lianlianpay_public_key)
