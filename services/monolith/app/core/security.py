"""
JWT creation, validation, and bcrypt password utilities.
Uses RS256 asymmetric signing — private key signs, public key verifies.
Other services can validate tokens using only the public key.
"""
import uuid
from datetime import UTC, datetime, timedelta
from typing import Any

import bcrypt
import jwt
from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings


# ── Password Hashing ─────────────────────────────────────────────────────────

def hash_password(plain: str) -> str:
    return bcrypt.hashpw(
        plain.encode("utf-8"),
        bcrypt.gensalt(rounds=settings.bcrypt_rounds),
    ).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


# ── JWT ───────────────────────────────────────────────────────────────────────

# Strip quotes and replace literal \n with actual newlines
_private_key = settings.jwt_private_key.replace(r"\n", "\n").replace('"', '').strip() if settings.jwt_private_key else ""
_public_key = settings.jwt_public_key.replace(r"\n", "\n").replace('"', '').strip() if settings.jwt_public_key else ""


def create_access_token(
    user_id: str,
    tenant_id: str,
    role: str,
    subdomain: str,
    permissions: list[str] | None = None,
) -> str:
    now = datetime.now(UTC)
    jti = str(uuid.uuid4())
    payload: dict[str, Any] = {
        "sub":        user_id,
        "user_id":    user_id,
        "tenant_id":  tenant_id,
        "role":       role,
        "subdomain":  subdomain,
        "permissions": permissions or [],
        "jti":        jti,
        "iat":        now,
        "exp":        now + timedelta(seconds=settings.jwt_access_token_expire_seconds),
        "type":       "access",
    }
    return jwt.encode(payload, _private_key, algorithm=settings.jwt_algorithm)


def create_refresh_token(user_id: str, tenant_id: str) -> str:
    now = datetime.now(UTC)
    payload: dict[str, Any] = {
        "sub":       user_id,
        "user_id":   user_id,
        "tenant_id": tenant_id,
        "jti":       str(uuid.uuid4()),
        "iat":       now,
        "exp":       now + timedelta(seconds=settings.jwt_refresh_token_expire_seconds),
        "type":      "refresh",
    }
    return jwt.encode(payload, _private_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any]:
    try:
        return jwt.decode(
            token,
            _public_key,
            algorithms=[settings.jwt_algorithm],
        )
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except jwt.InvalidTokenError as exc:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {exc}",
        )


# ── FastAPI dependency ────────────────────────────────────────────────────────

class TokenClaims:
    def __init__(
        self,
        user_id: str,
        tenant_id: str,
        role: str,
        subdomain: str,
        jti: str,
        permissions: list[str],
    ):
        self.user_id = user_id
        self.tenant_id = tenant_id
        self.role = role
        self.subdomain = subdomain
        self.jti = jti
        self.permissions = permissions


async def get_current_user(
    access_token: str | None = Cookie(default=None),
) -> TokenClaims:
    if not access_token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    payload = decode_token(access_token)
    if payload.get("type") != "access":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token type")
    return TokenClaims(
        user_id=payload["user_id"],
        tenant_id=payload["tenant_id"],
        role=payload["role"],
        subdomain=payload.get("subdomain", ""),
        jti=payload["jti"],
        permissions=payload.get("permissions", []),
    )


def require_roles(*roles: str):
    """Dependency factory — restricts route to specified roles."""
    async def _check(user: TokenClaims = Depends(get_current_user)) -> TokenClaims:
        if user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{user.role}' is not authorised for this action.",
            )
        return user
    return _check
