"""
FastAPI server: LianLian Pay (Thailand) transfer API with per-project DB logging.

Flow
----
1. A project calls  POST /transfer  with its API key (header X-API-Key), the amount,
   and how long the transfer session should stay open (expire_seconds).
2. We create the QR payment at LianLian, insert a `pending` transaction row tagged
   with the project, and return the QR to the caller.
3. When the payer completes payment, LianLian calls POST /webhook/lianlian. We verify
   the signature, mark the matching transaction `paid`, and record the payload.
   -> This is the "successful transfer" logged to the database.

All transfer logs from every project live in ONE payment-gateway database
(DATABASE_URL), separated by the `project_id` column.

Run:
    pip install -r requirements.txt
    cp .env.example .env            # fill credentials + DATABASE_URL
    python manage_projects.py create "shot24"   # get an API key
    uvicorn app:app --host 0.0.0.0 --port 8000
"""

from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path
from datetime import timedelta
from typing import Any, Optional

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request, Header, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from lianlian import LianLianClient, LianLianConfig, LianLianError
from lianlian import db

log = logging.getLogger("paygw")
from lianlian.db import SessionLocal, Transaction, Project, _utcnow

"""
load_dotenv() with no argument searches upward from the *current working
directory*, so a second copy of this project on the same box can silently win.
Pin it to the .env sitting next to this file — the folder you edited is the
folder that takes effect.
"""
_APP_DIR = Path(__file__).resolve().parent
_ENV_FILE = _APP_DIR / ".env"
load_dotenv(_ENV_FILE, override=True)

app = FastAPI(title="LianLian Pay Transfer API", version="2.0.0")

_config = LianLianConfig.from_env()
client = LianLianClient(_config)

# Ensure the payment-gateway tables exist before serving any request.
db.init_db()


# --------------------------------------------------------------------------- #
# DB session + project auth dependencies
# --------------------------------------------------------------------------- #
def get_session():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def require_project(x_api_key: str = Header(..., alias="X-API-Key"),
                    session=Depends(get_session)) -> Project:
    project = db.get_project_by_api_key(session, x_api_key)
    if not project:
        raise HTTPException(status_code=401, detail="Invalid or inactive API key")
    return project


# --------------------------------------------------------------------------- #
# Models
# --------------------------------------------------------------------------- #
class Customer(BaseModel):
    merchant_user_id: Optional[str] = None
    full_name: Optional[str] = None
    email: Optional[str] = None
    phone: Optional[str] = None


class TransferRequest(BaseModel):
    amount: str = Field(..., examples=["100.00"], description="Transfer amount, up to 2 decimals")
    channel: str = Field("thai_qr", description="thai_qr | wechat | alipay")
    expire_seconds: int = Field(480, ge=30, le=86400,
                                description="How long the transfer session stays open")
    order_desc: str = "Transfer"
    merchant_order_id: Optional[str] = None
    order_currency: str = "THB"
    customer: Optional[Customer] = None
    client_ip: Optional[str] = None   # IP จริงของลูกค้า — WeChat H5 บังคับ


class TransferResponse(BaseModel):
    transfer_id: int
    project: str
    channel: str
    merchant_order_id: str
    lianlian_order_id: str
    status: str
    amount: str
    currency: str
    expires_at: Optional[str] = None
    qr_image_base64: Optional[str] = None   # thai_qr
    qr_content: Optional[str] = None        # wechat / alipay


# --------------------------------------------------------------------------- #
# Create a transfer
# --------------------------------------------------------------------------- #
@app.post("/transfer", response_model=TransferResponse)
def create_transfer(req: TransferRequest,
                    project: Project = Depends(require_project),
                    session=Depends(get_session)):
    customer = req.customer.model_dump(exclude_none=True) if req.customer else None
    channel = req.channel.lower()

    try:
        if channel == "wechat":
            payment = client.create_wechat_qr(
                order_amount=req.amount, order_desc=req.order_desc,
                merchant_order_id=req.merchant_order_id,
                order_currency=req.order_currency, customer=customer,
                remote_ip=req.client_ip,
            )
        elif channel == "alipay":
            payment = client.create_alipay_qr(
                order_amount=req.amount, order_desc=req.order_desc,
                merchant_order_id=req.merchant_order_id,
                order_currency=req.order_currency, customer=customer,
            )
        elif channel in ("thai_qr", "thai", "thaiqr"):
            channel = "thai_qr"
            payment = client.create_thai_qr(
                order_amount=req.amount, order_desc=req.order_desc,
                merchant_order_id=req.merchant_order_id,
                order_currency=req.order_currency, customer=customer,
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unknown channel: {req.channel}")
    except LianLianError as exc:
        raise HTTPException(status_code=502, detail={"message": str(exc), "code": exc.code})

    tx = Transaction(
        project_id=project.id,
        channel=payment.channel,
        merchant_order_id=payment.merchant_order_id,
        lianlian_order_id=payment.order_id,
        amount=req.amount,
        currency=payment.order_currency,
        order_desc=req.order_desc,
        status="pending",
        expire_seconds=req.expire_seconds,
        expires_at=_utcnow() + timedelta(seconds=req.expire_seconds),
        qr_content=payment.qr_content,
        qr_image_base64=payment.qr_image_base64,
        raw_create=json.dumps(payment.raw, ensure_ascii=False),
    )
    session.add(tx)
    session.commit()
    session.refresh(tx)

    return TransferResponse(
        transfer_id=tx.id,
        project=project.name,
        channel=tx.channel,
        merchant_order_id=tx.merchant_order_id,
        lianlian_order_id=tx.lianlian_order_id or "",
        status=tx.status,
        amount=str(tx.amount),
        currency=tx.currency,
        expires_at=tx.expires_at.isoformat() if tx.expires_at else None,
        qr_image_base64=tx.qr_image_base64,
        qr_content=tx.qr_content,
    )


# --------------------------------------------------------------------------- #
# Read transfers (scoped to the calling project)
# --------------------------------------------------------------------------- #
@app.get("/transfer/{merchant_order_id}")
def get_transfer(merchant_order_id: str,
                 project: Project = Depends(require_project),
                 session=Depends(get_session)) -> dict[str, Any]:
    tx = db.get_transaction(session, merchant_order_id)
    if not tx or tx.project_id != project.id:
        raise HTTPException(status_code=404, detail="Transfer not found")

    """
    Webhooks can be delayed or lost, so a row that still looks unpaid is not
    proof that the customer did not pay. Ask LianLian directly before answering.
    A query failure is not fatal here: we just return what we already have.
    """
    if tx.status not in ("paid", "failed", "expired"):
        try:
            q = client.query_payment(merchant_order_id)
            data = q.get("data") if isinstance(q.get("data"), dict) else q
            order_status = (data or {}).get("order_status")

            tx.raw_query = json.dumps(q, ensure_ascii=False)
            if order_status == "PS" and tx.status != "paid":
                tx.status = "paid"
                tx.paid_at = _utcnow()
                if not tx.lianlian_order_id:
                    tx.lianlian_order_id = (data or {}).get("order_id")
            elif order_status == "PF":
                tx.status = "failed"
            elif order_status == "PE":
                tx.status = "expired"
            session.commit()
        except Exception as exc:                       # noqa: BLE001
            log.warning("query_payment failed for %s: %s", merchant_order_id, exc)

    return tx.to_dict()


@app.get("/transfers")
def list_transfers(status: Optional[str] = None, limit: int = 100,
                   project: Project = Depends(require_project),
                   session=Depends(get_session)) -> dict[str, Any]:
    rows = db.list_transactions(session, project.id, limit=limit, status=status)
    return {"project": project.name, "count": len(rows), "transfers": [r.to_dict() for r in rows]}


# --------------------------------------------------------------------------- #
# Webhook — logs the successful transfer
# --------------------------------------------------------------------------- #
@app.post("/webhook/lianlian")
async def lianlian_webhook(request: Request, sign: str = Header(default=""),
                           session=Depends(get_session)):
    body = await request.json()
    if not sign or not client.verify_callback(body, sign):
        """
        A silent 400 here looks identical to 'LianLian never called us', which
        is exactly the dead end we hit before. Log enough to tell the two apart.
        """
        log.error(
            "webhook signature verification FAILED for merchant_order_id=%s "
            "(sign header %s) — เช็คว่า LIANLIANPAY_PUBLIC_KEY ตรงกับ "
            "environment ที่ใช้อยู่หรือยัง body=%s",
            body.get("merchant_order_id"),
            "missing" if not sign else "present",
            json.dumps(body, ensure_ascii=False)[:600],
        )
        raise HTTPException(status_code=400, detail="Invalid signature")

    log.info("webhook ok: %s -> %s",
             body.get("merchant_order_id"), body.get("order_status"))

    merchant_order_id = body.get("merchant_order_id")
    tx = db.get_transaction(session, merchant_order_id) if merchant_order_id else None

    if tx:
        tx.raw_notify = json.dumps(body, ensure_ascii=False)
        if body.get("order_status") == "PS" and tx.status != "paid":
            tx.status = "paid"
            tx.paid_at = _utcnow()
            if not tx.lianlian_order_id:
                tx.lianlian_order_id = body.get("order_id")
        session.commit()
    # Always ack so LianLian stops retrying, even if we didn't find the row.
    return JSONResponse({"code": 200000, "message": "Success"})


@app.get("/health")
def health() -> dict[str, str]:
    """Report enough identity for 'which copy is actually running?' to be answerable."""
    key = "".join(_config.lianlianpay_public_key.split())
    return {
        "status": "ok",
        "environment": "production" if "sandbox" not in _config.gateway_url else "sandbox",
        "gateway": _config.gateway_url,
        # /health ไม่ได้ป้องกันด้วย API key — ปิดกลางเลขไว้ แต่ยังเหลือ 4 ตัวท้าย
        # ให้พอแยกออกว่าเป็นบัญชีไหน
        "merchant_id": _config.merchant_id[:6] + "*" * 8 + _config.merchant_id[-4:],
        "store_id": _config.store_id or "(ไม่ได้ตั้ง)",
        "public_key_fp": hashlib.sha256(key.encode()).hexdigest()[:12],
        "app_dir": str(_APP_DIR),
        "env_file": str(_ENV_FILE),
        "env_file_exists": str(_ENV_FILE.exists()),
        "database": db.DATABASE_URL.split("://")[0],
    }
