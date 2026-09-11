"""
LianLian Pay (Thailand) request signing and verification.

Signature algorithm per official docs (https://doc.lianlianpay.co.th/docs/signature):
  - Algorithm: SHA1withRSA, result base64-encoded.
  - Build a canonical "sign string" from the request:
      * POST -> the JSON body
      * GET  -> the query parameters
  - Sorting rules:
      * Top-level keys sorted ascending (lexicographic).
      * When a value is a JSON object, its own keys are expanded (the parent key
        name is NOT emitted) and sorted ascending.
      * When a value is a JSON array of objects, each element's keys are expanded
        and sorted ascending, in array order.
      * Scalars are emitted as "key=value".
  - Empty / None values are skipped.
  - Fragments are joined with "&".
"""

from __future__ import annotations

import base64
from typing import Any, Iterable

from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding
from cryptography.exceptions import InvalidSignature


# --------------------------------------------------------------------------- #
# Canonical sign-string construction
# --------------------------------------------------------------------------- #
def _is_empty(value: Any) -> bool:
    return value is None or value == ""


def _flatten(key: str, value: Any) -> list[str]:
    """Return a list of 'k=v' fragments for a single key/value pair."""
    if isinstance(value, dict):
        out: list[str] = []
        for k in sorted(value.keys()):
            out.extend(_flatten(k, value[k]))
        return out

    if isinstance(value, (list, tuple)):
        out = []
        for item in value:
            if isinstance(item, dict):
                for k in sorted(item.keys()):
                    out.extend(_flatten(k, item[k]))
            elif not _is_empty(item):
                out.append(f"{key}={item}")
        return out

    if _is_empty(value):
        return []

    if isinstance(value, bool):
        value = "true" if value else "false"

    return [f"{key}={value}"]


def build_sign_string(params: dict[str, Any]) -> str:
    """
    Build the canonical string to be signed from a dict of request params
    (body for POST, query for GET). `sign` and `sign_type` are always excluded.
    """
    fragments: list[str] = []
    for key in sorted(params.keys()):
        if key in ("sign", "sign_type"):
            continue
        fragments.extend(_flatten(key, params[key]))
    return "&".join(fragments)


# --------------------------------------------------------------------------- #
# Key loading helpers
# --------------------------------------------------------------------------- #
_PEM_HEADER = "-----BEGIN"


def _wrap_pem(body: str, label: str) -> bytes:
    wrapped = "\n".join(body[i : i + 64] for i in range(0, len(body), 64))
    return f"-----BEGIN {label}-----\n{wrapped}\n-----END {label}-----\n".encode("utf-8")


def load_private_key(key_material: str):
    """
    Load an RSA private key supplied as a full PEM block, a bare base64 body,
    PKCS#8 ("PRIVATE KEY") or PKCS#1 ("RSA PRIVATE KEY"), or raw DER base64.
    """
    key_material = key_material.strip()
    if _PEM_HEADER in key_material:
        return serialization.load_pem_private_key(key_material.encode("utf-8"), password=None)

    body = "".join(key_material.split())
    errors = []
    for label in ("PRIVATE KEY", "RSA PRIVATE KEY"):
        try:
            return serialization.load_pem_private_key(_wrap_pem(body, label), password=None)
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{label}: {exc}")
    try:
        return serialization.load_der_private_key(base64.b64decode(body), password=None)
    except Exception as exc:  # noqa: BLE001
        errors.append(f"DER: {exc}")
    raise ValueError("Could not load private key. Tried " + " | ".join(errors))


def load_public_key(key_material: str):
    """
    Load an RSA public key supplied as a full PEM block, a bare base64 body,
    X.509 SubjectPublicKeyInfo ("PUBLIC KEY") or PKCS#1 ("RSA PUBLIC KEY"),
    or raw DER base64.
    """
    key_material = key_material.strip()
    if _PEM_HEADER in key_material:
        return serialization.load_pem_public_key(key_material.encode("utf-8"))

    body = "".join(key_material.split())
    errors = []
    for label in ("PUBLIC KEY", "RSA PUBLIC KEY"):
        try:
            return serialization.load_pem_public_key(_wrap_pem(body, label))
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{label}: {exc}")
    try:
        return serialization.load_der_public_key(base64.b64decode(body))
    except Exception as exc:  # noqa: BLE001
        errors.append(f"DER: {exc}")
    raise ValueError("Could not load public key. Tried " + " | ".join(errors))


# --------------------------------------------------------------------------- #
# Sign / verify
# --------------------------------------------------------------------------- #
def sign(params: dict[str, Any], private_key_material: str) -> str:
    """Sign the params with the merchant private key. Returns base64 signature."""
    private_key = load_private_key(private_key_material)
    message = build_sign_string(params).encode("utf-8")
    signature = private_key.sign(message, padding.PKCS1v15(), hashes.SHA1())
    return base64.b64encode(signature).decode("ascii")


def verify(params: dict[str, Any], signature_b64: str, public_key_material: str) -> bool:
    """Verify a base64 signature against params using LianLian's public key."""
    public_key = load_public_key(public_key_material)
    message = build_sign_string(params).encode("utf-8")
    try:
        public_key.verify(
            base64.b64decode(signature_b64),
            message,
            padding.PKCS1v15(),
            hashes.SHA1(),
        )
        return True
    except (InvalidSignature, ValueError):
        return False
