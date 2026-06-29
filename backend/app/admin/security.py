import base64
import hashlib
import hmac
import json
import os
import time
from typing import Any, Dict, Optional

from .config import ADMIN_TOKEN_EXPIRE_SECONDS, ADMIN_TOKEN_SECRET


PASSWORD_ITERATIONS = 260000


def _b64url_encode(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(data: str) -> bytes:
    padding = "=" * (-len(data) % 4)
    return base64.urlsafe_b64decode(data + padding)


def hash_password(password: str) -> str:
    salt = os.urandom(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        salt,
        PASSWORD_ITERATIONS,
    )
    return "pbkdf2_sha256${}${}${}".format(
        PASSWORD_ITERATIONS,
        _b64url_encode(salt),
        _b64url_encode(digest),
    )


def verify_password(password: str, password_hash: str) -> bool:
    try:
        algorithm, iterations, salt_value, digest_value = password_hash.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        salt = _b64url_decode(salt_value)
        expected = _b64url_decode(digest_value)
        actual = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            salt,
            int(iterations),
        )
        return hmac.compare_digest(actual, expected)
    except Exception:
        return False


def create_access_token(user_id: int, username: str) -> str:
    now = int(time.time())
    header = {"alg": "HS256", "typ": "JWT"}
    payload = {
        "sub": str(user_id),
        "username": username,
        "iat": now,
        "exp": now + ADMIN_TOKEN_EXPIRE_SECONDS,
    }
    signing_input = "{}.{}".format(
        _b64url_encode(json.dumps(header, separators=(",", ":")).encode("utf-8")),
        _b64url_encode(json.dumps(payload, separators=(",", ":")).encode("utf-8")),
    )
    signature = hmac.new(
        ADMIN_TOKEN_SECRET.encode("utf-8"),
        signing_input.encode("ascii"),
        hashlib.sha256,
    ).digest()
    return "{}.{}".format(signing_input, _b64url_encode(signature))


def decode_access_token(token: str) -> Optional[Dict[str, Any]]:
    try:
        header_value, payload_value, signature_value = token.split(".", 2)
        signing_input = f"{header_value}.{payload_value}"
        expected_signature = hmac.new(
            ADMIN_TOKEN_SECRET.encode("utf-8"),
            signing_input.encode("ascii"),
            hashlib.sha256,
        ).digest()
        if not hmac.compare_digest(_b64url_decode(signature_value), expected_signature):
            return None
        payload = json.loads(_b64url_decode(payload_value).decode("utf-8"))
        if int(payload.get("exp", 0)) < int(time.time()):
            return None
        return payload
    except Exception:
        return None
