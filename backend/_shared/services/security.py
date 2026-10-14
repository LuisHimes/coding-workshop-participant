"""
Password hashing and JWT access tokens.

Passwords are hashed with scrypt from Python's standard library, so there is no
compiled dependency to match to the Lambda's Python version. Hashes are stored
as "scrypt$n$r$p$salt$hash" so the cost parameters can be raised later without
breaking existing passwords.
"""

import base64
import hashlib
import hmac
import secrets
from datetime import UTC, datetime, timedelta

import jwt

from config import settings

# scrypt cost: 16 MiB of memory and ~50 ms per hash
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2**14, 8, 1


def _b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def hash_password(password: str) -> str:
    """Hashes a password with scrypt and a random salt, in the "scrypt$n$r$p$salt$hash" format."""
    salt = secrets.token_bytes(16)
    digest = hashlib.scrypt(password.encode(), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return f"scrypt${SCRYPT_N}${SCRYPT_R}${SCRYPT_P}${_b64(salt)}${_b64(digest)}"


def verify_password(password: str, stored_hash: str) -> bool:
    """Checks a password against a stored hash in constant time."""
    try:
        scheme, n, r, p, salt, digest = stored_hash.split("$")
        if scheme != "scrypt":
            return False
        expected = base64.b64decode(digest)
        actual = hashlib.scrypt(password.encode(), salt=base64.b64decode(salt),
                                n=int(n), r=int(r), p=int(p), dklen=len(expected))
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(actual, expected)


# Checked when a login names an unknown user, so the response takes as long as
# a real password check and does not reveal which emails exist
DUMMY_HASH = hash_password(secrets.token_urlsafe(16))


def create_access_token(user_id: str, role: str) -> tuple[str, int]:
    """Returns a signed token for the user and its lifetime in seconds."""
    lifetime = timedelta(minutes=settings.jwt_access_token_expire_minutes)
    now = datetime.now(UTC)
    claims = {"sub": user_id, "role": role, "iss": settings.jwt_issuer, "iat": now, "exp": now + lifetime}
    return jwt.encode(claims, settings.jwt_secret, algorithm=settings.jwt_algorithm), int(lifetime.total_seconds())


def decode_access_token(token: str) -> dict:
    """Verifies a token's signature, expiry and issuer. Raises jwt.InvalidTokenError if it fails."""
    return jwt.decode(token, settings.jwt_secret, algorithms=[settings.jwt_algorithm],
                      issuer=settings.jwt_issuer, options={"require": ["sub", "exp", "iat", "iss"]})
