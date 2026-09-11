"""
Database layer for the payment-gateway transfer log.

This is a dedicated database that stores ONLY payment-gateway transfer records.
Multiple projects share the same database; every row is tagged with `project_id`,
so logs from different projects live together but are always separable.

Engine is chosen by the DATABASE_URL environment variable, e.g.
    sqlite:///payment_gateway.db                       (default, zero-setup)
    postgresql+psycopg2://user:pass@host:5432/paygw     (production)
    mysql+pymysql://user:pass@host:3306/paygw
"""

from __future__ import annotations
from dotenv import load_dotenv as _ld; _ld()

import os
import secrets
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import (
    String, Text, DateTime, ForeignKey, Numeric, create_engine, func, select,
)
from sqlalchemy.orm import (
    DeclarativeBase, Mapped, mapped_column, relationship, sessionmaker, Session,
)

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///payment_gateway.db")

# check_same_thread is a SQLite-only concern under a threaded web server.
_connect_args = {"check_same_thread": False} if DATABASE_URL.startswith("sqlite") else {}
engine = create_engine(DATABASE_URL, echo=False, future=True, connect_args=_connect_args)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class Project(Base):
    """A project/tenant that uses the payment gateway. Identified by an API key."""
    __tablename__ = "projects"

    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(100), unique=True)
    api_key: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)

    transactions: Mapped[list["Transaction"]] = relationship(back_populates="project")

    @staticmethod
    def new_api_key() -> str:
        return "pk_" + secrets.token_urlsafe(32)


class Transaction(Base):
    """One payment/transfer, from creation through to paid/expired/failed."""
    __tablename__ = "transactions"

    id: Mapped[int] = mapped_column(primary_key=True)
    project_id: Mapped[int] = mapped_column(ForeignKey("projects.id"), index=True)

    channel: Mapped[str] = mapped_column(String(16))            # thai_qr | wechat | alipay
    merchant_order_id: Mapped[str] = mapped_column(String(64), unique=True, index=True)
    lianlian_order_id: Mapped[Optional[str]] = mapped_column(String(32), index=True)

    amount: Mapped[float] = mapped_column(Numeric(12, 2))
    currency: Mapped[str] = mapped_column(String(3), default="THB")
    order_desc: Mapped[Optional[str]] = mapped_column(String(256))

    # pending | paid | expired | failed
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)

    expire_seconds: Mapped[Optional[int]] = mapped_column()
    expires_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))

    qr_content: Mapped[Optional[str]] = mapped_column(Text)      # link (wechat/alipay)
    # qr_image_base64 is large; store it if you want, else regenerate on demand.
    qr_image_base64: Mapped[Optional[str]] = mapped_column(Text)

    raw_create: Mapped[Optional[str]] = mapped_column(Text)      # JSON of create response
    raw_notify: Mapped[Optional[str]] = mapped_column(Text)      # JSON of webhook payload
    raw_query: Mapped[Optional[str]] = mapped_column(Text)       # JSON of last status query

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=_utcnow)
    paid_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True))
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow
    )

    project: Mapped["Project"] = relationship(back_populates="transactions")

    def to_dict(self) -> dict:
        return {
            "id": self.id,
            "project": self.project.name if self.project else None,
            "channel": self.channel,
            "merchant_order_id": self.merchant_order_id,
            "lianlian_order_id": self.lianlian_order_id,
            "amount": str(self.amount),
            "currency": self.currency,
            "order_desc": self.order_desc,
            "status": self.status,
            "expire_seconds": self.expire_seconds,
            "expires_at": self.expires_at.isoformat() if self.expires_at else None,
            "qr_content": self.qr_content,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "paid_at": self.paid_at.isoformat() if self.paid_at else None,
        }


def init_db() -> None:
    """Create tables if they don't exist, then add any columns added later."""
    Base.metadata.create_all(engine)

    """
    create_all() never alters an existing table, so columns added after the
    first deploy need a nudge. Ask SQLAlchemy for the column list rather than
    querying the catalogue directly — this runs on both MySQL and SQLite.
    A failure here must not take the whole service down: the new column is only
    used for diagnostics, so log it and carry on.
    """
    try:
        from sqlalchemy import inspect as _inspect

        existing = {c["name"] for c in _inspect(engine).get_columns("transactions")}
        if "raw_query" not in existing:
            with engine.begin() as conn:
                conn.exec_driver_sql(
                    "ALTER TABLE transactions ADD COLUMN raw_query TEXT"
                )
    except Exception as exc:                                   # noqa: BLE001
        import logging

        logging.getLogger("paygw").warning(
            "migrate transactions.raw_query skipped: %s", exc
        )


# --------------------------------------------------------------------------- #
# Repository helpers
# --------------------------------------------------------------------------- #
def get_project_by_api_key(session: Session, api_key: str) -> Optional[Project]:
    return session.scalar(
        select(Project).where(Project.api_key == api_key, Project.is_active == True)  # noqa: E712
    )


def create_project(session: Session, name: str) -> Project:
    project = Project(name=name, api_key=Project.new_api_key())
    session.add(project)
    session.commit()
    session.refresh(project)
    return project


def get_transaction(session: Session, merchant_order_id: str) -> Optional[Transaction]:
    return session.scalar(
        select(Transaction).where(Transaction.merchant_order_id == merchant_order_id)
    )


def list_transactions(session: Session, project_id: int, limit: int = 100,
                      status: Optional[str] = None) -> list[Transaction]:
    stmt = select(Transaction).where(Transaction.project_id == project_id)
    if status:
        stmt = stmt.where(Transaction.status == status)
    stmt = stmt.order_by(Transaction.created_at.desc()).limit(limit)
    return list(session.scalars(stmt))
