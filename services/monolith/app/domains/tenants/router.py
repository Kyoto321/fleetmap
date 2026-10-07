"""
Tenants domain — CRUD for platform tenants (super-admin only).
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.security import TokenClaims, require_roles
from app.models import Tenant

router = APIRouter(prefix="/tenants", tags=["Tenants"])


class TenantCreate(BaseModel):
    name: str
    subdomain: str
    plan: str = "free"
    branding: dict = {}


class TenantResponse(BaseModel):
    id: str
    name: str
    subdomain: str
    plan: str
    branding: dict
    is_active: bool

    class Config:
        from_attributes = True


@router.get("/", response_model=list[TenantResponse])
async def list_tenants(
    db: AsyncSession = Depends(get_db),
    _user: TokenClaims = Depends(require_roles("admin")),
):
    result = await db.execute(select(Tenant).order_by(Tenant.created_at.desc()))
    return [
        TenantResponse(
            id=str(t.id), name=t.name, subdomain=t.subdomain,
            plan=t.plan, branding=t.branding, is_active=t.is_active,
        )
        for t in result.scalars().all()
    ]


@router.post("/", response_model=TenantResponse, status_code=status.HTTP_201_CREATED)
async def create_tenant(
    body: TenantCreate,
    db: AsyncSession = Depends(get_db),
    _user: TokenClaims = Depends(require_roles("admin")),
):
    # Check subdomain uniqueness
    existing = (await db.execute(
        select(Tenant).where(Tenant.subdomain == body.subdomain)
    )).scalar_one_or_none()
    if existing:
        raise HTTPException(status_code=409, detail=f"Subdomain '{body.subdomain}' already in use")

    tenant = Tenant(
        name=body.name,
        subdomain=body.subdomain.lower(),
        plan=body.plan,
        branding=body.branding,
    )
    db.add(tenant)
    await db.flush()
    return TenantResponse(
        id=str(tenant.id), name=tenant.name, subdomain=tenant.subdomain,
        plan=tenant.plan, branding=tenant.branding, is_active=tenant.is_active,
    )

@router.get("/resolve/{subdomain}", response_model=TenantResponse)
async def resolve_tenant(
    subdomain: str,
    db: AsyncSession = Depends(get_db),
):
    tenant = (await db.execute(
        select(Tenant).where(Tenant.subdomain == subdomain.lower(), Tenant.is_active.is_(True))
    )).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return TenantResponse(
        id=str(tenant.id), name=tenant.name, subdomain=tenant.subdomain,
        plan=tenant.plan, branding=tenant.branding, is_active=tenant.is_active,
    )


@router.get("/{tenant_id}", response_model=TenantResponse)
async def get_tenant(
    tenant_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    _user: TokenClaims = Depends(require_roles("admin")),
):
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")
    return TenantResponse(
        id=str(tenant.id), name=tenant.name, subdomain=tenant.subdomain,
        plan=tenant.plan, branding=tenant.branding, is_active=tenant.is_active,
    )


class TenantUpdate(BaseModel):
    name: str | None = None
    branding: dict | None = None


@router.patch("/{tenant_id}", response_model=TenantResponse)
async def update_tenant(
    tenant_id: uuid.UUID,
    body: TenantUpdate,
    db: AsyncSession = Depends(get_db),
    user: TokenClaims = Depends(require_roles("admin")),
):
    if uuid.UUID(user.tenant_id) != tenant_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not authorized to modify this tenant"
        )

    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(status_code=404, detail="Tenant not found")

    if body.name is not None:
        tenant.name = body.name
    if body.branding is not None:
        tenant.branding = body.branding

    await db.commit()
    return TenantResponse(
        id=str(tenant.id), name=tenant.name, subdomain=tenant.subdomain,
        plan=tenant.plan, branding=tenant.branding, is_active=tenant.is_active,
    )

