"""
Tests for the canonical sign-string builder, validated against the two examples
in the official LianLian signature doc:
https://doc.lianlianpay.co.th/docs/signature
"""

import base64
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lianlian import signing  # noqa: E402


def test_nested_ordering_example():
    """Complex nested example from the docs -> a=100&a=1&b=2&c=3&a=4&b=5&c=6&a=10&b=11"""
    body = {
        "c": {"b": "11", "a": "10"},
        "a": "100",
        "b": [{"c": "3", "b": "2", "a": "1"}, {"c": "6", "b": "5", "a": "4"}],
    }
    expected = "a=100&a=1&b=2&c=3&a=4&b=5&c=6&a=10&b=11"
    assert signing.build_sign_string(body) == expected


def test_checkout_example():
    """Checkout body example -> the documented 'extracted request body' string."""
    body = {
        "version": "v1",
        "service": "llpth.checkout.apply",
        "merchant_id": "142023010100009001",
        "merchant_order_id": "ORDER_202301010001",
        "order_amount": "88.99",
        "order_currency": "THB",
        "order_desc": "display your order info",
        "payment_method": "WAP_PAYMENT",
        "customer": {"merchant_user_id": "USER_0001", "full_name": "Bruce Lee"},
        "notify_url": "https://www.lianlianpay.co.th/sample/callback",
        "redirect_url": "https://www.lianlianpay.co.th/sample/redirect",
    }
    expected = (
        "full_name=Bruce Lee&merchant_user_id=USER_0001"
        "&merchant_id=142023010100009001"
        "&merchant_order_id=ORDER_202301010001"
        "&notify_url=https://www.lianlianpay.co.th/sample/callback"
        "&order_amount=88.99&order_currency=THB"
        "&order_desc=display your order info"
        "&payment_method=WAP_PAYMENT"
        "&redirect_url=https://www.lianlianpay.co.th/sample/redirect"
        "&service=llpth.checkout.apply&version=v1"
    )
    assert signing.build_sign_string(body) == expected


def test_empty_values_skipped():
    body = {"a": "1", "b": "", "c": None, "store_id": ""}
    assert signing.build_sign_string(body) == "a=1"


def test_sign_verify_roundtrip():
    """Generate a keypair, sign a body, and verify with the public key."""
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa

    priv = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    priv_b64 = base64.b64encode(
        priv.private_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PrivateFormat.PKCS8,
            encryption_algorithm=serialization.NoEncryption(),
        )
    ).decode()
    pub_b64 = base64.b64encode(
        priv.public_key().public_bytes(
            encoding=serialization.Encoding.DER,
            format=serialization.PublicFormat.SubjectPublicKeyInfo,
        )
    ).decode()

    body = {"version": "v1", "merchant_id": "142023010100009001", "order_amount": "10.00"}
    sig = signing.sign(body, priv_b64)
    assert signing.verify(body, sig, pub_b64) is True
    # Tampered body must fail.
    assert signing.verify({**body, "order_amount": "9999"}, sig, pub_b64) is False


if __name__ == "__main__":
    test_nested_ordering_example()
    test_checkout_example()
    test_empty_values_skipped()
    test_sign_verify_roundtrip()
    print("All signing tests passed.")
