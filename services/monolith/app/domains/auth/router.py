"""
Auth domain — login, refresh, logout, health.
"""
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db, get_tenant_session
from app.core.redis import get_redis
from app.core.security import (
    TokenClaims,
    create_access_token,
    create_refresh_token,
    decode_token,
    get_current_user,
    hash_password,
    verify_password,
)
from app.models import Tenant, User

router = APIRouter(prefix="/auth", tags=["Authentication"])


# ── Schemas ───────────────────────────────────────────────────────────────────

class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class LoginResponse(BaseModel):
    message: str
    user: dict


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    subdomain: str        # Tenant subdomain to register under
    tenant_name: str | None = None   # Only if creating a new tenant


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/login", response_model=LoginResponse)
async def login(
    body: LoginRequest,
    request: Request,
    response: Response,
    db: AsyncSession = Depends(get_db),
    redis=Depends(get_redis),
):
    # 1. Resolve tenant from subdomain header (set by Nginx / Next.js middleware)
    subdomain = request.headers.get("X-Subdomain", "")
    if not subdomain:
        raise HTTPException(status_code=400, detail="Missing tenant subdomain")

    tenant = (await db.execute(
        select(Tenant).where(Tenant.subdomain == subdomain, Tenant.is_active.is_(True))
    )).scalar_one_or_none()

    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    # 2. Fetch user (tenant-scoped email lookup)
    user = (await db.execute(
        select(User).where(User.tenant_id == tenant.id, User.email == body.email, User.is_active.is_(True))
    )).scalar_one_or_none()

    if not user or not verify_password(body.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    # 3. Role → permissions mapping
    role_permissions: dict[str, list[str]] = {
        "admin":      ["*"],
        "dispatcher": ["jobs:read", "jobs:write", "vehicles:read", "users:read"],
        "driver":     ["jobs:read", "jobs:update_status"],
    }

    # 4. Generate tokens
    access_token  = create_access_token(
        user_id=str(user.id),
        tenant_id=str(tenant.id),
        role=user.role,
        subdomain=subdomain,
        permissions=role_permissions.get(user.role, []),
    )
    refresh_token = create_refresh_token(str(user.id), str(tenant.id))

    # 5. Update last_login_at
    await db.execute(
        update(User).where(User.id == user.id).values(last_login_at=datetime.now(UTC))
    )

    # 6. Set httpOnly cookies
    cookie_kwargs = dict(httponly=True, samesite="strict", secure=settings.environment != "development")
    response.set_cookie("access_token",  access_token,  max_age=settings.jwt_access_token_expire_seconds,  **cookie_kwargs)
    response.set_cookie("refresh_token", refresh_token, max_age=settings.jwt_refresh_token_expire_seconds, **cookie_kwargs)

    return LoginResponse(
        message="Login successful",
        user={
            "id":        str(user.id),
            "email":     user.email,
            "full_name": user.full_name,
            "role":      user.role,
            "tenant": {
                "id":        str(tenant.id),
                "name":      tenant.name,
                "subdomain": tenant.subdomain,
                "branding":  tenant.branding,
            },
        },
    )


@router.post("/logout")
async def logout(
    response: Response,
    user: TokenClaims = Depends(get_current_user),
    redis=Depends(get_redis),
):
    # Blacklist the JTI so the token cannot be reused even before expiry
    await redis.setex(
        f"blacklist:{user.jti}",
        settings.jwt_access_token_expire_seconds,
        "1",
    )
    response.delete_cookie("access_token")
    response.delete_cookie("refresh_token")
    return {"message": "Logged out successfully"}


@router.get("/me")
async def get_me(
    user: TokenClaims = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(User).where(User.id == uuid.UUID(user.user_id)))
    db_user = result.scalar_one_or_none()
    if not db_user:
        raise HTTPException(status_code=404, detail="User not found")
    return {
        "id":         str(db_user.id),
        "email":      db_user.email,
        "full_name":  db_user.full_name,
        "role":       db_user.role,
        "tenant_id":  str(db_user.tenant_id),
    }


@router.get("/drivers")
async def list_drivers(
    user: TokenClaims = Depends(get_current_user),
):
    """
    List active drivers for the authenticated dispatcher's tenant.
    Enforces tenant isolation using RLS.
    """
    async with get_tenant_session(user.tenant_id) as db:
        result = await db.execute(
            select(User).where(
                User.tenant_id == uuid.UUID(user.tenant_id),
                User.role == "driver",
                User.is_active.is_(True)
            )
        )
        drivers = result.scalars().all()
        return {
            "data": [
                {
                    "id": str(d.id),
                    "email": d.email,
                    "full_name": d.full_name,
                }
                for d in drivers
            ]
        }
