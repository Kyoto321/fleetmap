"""
Users domain — CRUD for tenant users.
All queries run inside a tenant-scoped RLS session.
"""
import uuid

from fastapi import APIRouter, Depends, HTTPException, Query, status
from pydantic import BaseModel, EmailStr
from sqlalchemy import func, select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_tenant_session
from app.core.security import TokenClaims, require_roles, hash_password
from app.models import User

router = APIRouter(prefix="/users", tags=["Users"])


class UserCreate(BaseModel):
    email: EmailStr
    password: str
    full_name: str
    role: str  # admin|dispatcher|driver


class UserUpdate(BaseModel):
    full_name: str | None = None
    role: str | None = None
    is_active: bool | None = None


class UserResponse(BaseModel):
    id: str
    tenant_id: str
    email: str
    role: str
    full_name: str
    is_active: bool


def _to_response(u: User) -> UserResponse:
    return UserResponse(
        id=str(u.id),
        tenant_id=str(u.tenant_id),
        email=u.email,
        role=u.role,
        full_name=u.full_name,
        is_active=u.is_active,
    )


@router.get("/")
async def list_users(
    role_filter: str | None = Query(None, alias="role"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    user: TokenClaims = Depends(require_roles("admin")),
):
    async with get_tenant_session(user.tenant_id) as db:
        q = select(User)
        if role_filter:
            q = q.where(User.role == role_filter)

        total_q = select(func.count()).select_from(q.subquery())
        total = (await db.execute(total_q)).scalar_one()

        q = q.offset((page - 1) * per_page).limit(per_page)
        users = (await db.execute(q)).scalars().all()

        return {
            "data": [_to_response(u) for u in users],
            "pagination": {
                "page": page,
                "per_page": per_page,
                "total": total,
                "pages": -(-total // per_page)
            },
        }


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_user(
    body: UserCreate,
    user: TokenClaims = Depends(require_roles("admin")),
):
    if body.role not in {"admin", "dispatcher", "driver"}:
        raise HTTPException(
            status_code=400,
            detail="Invalid role. Must be 'admin', 'dispatcher', or 'driver'"
        )

    async with get_tenant_session(user.tenant_id) as db:
        # Check email uniqueness within tenant
        existing = (await db.execute(
            select(User).where(
                User.tenant_id == uuid.UUID(user.tenant_id),
                User.email == body.email.lower()
            )
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(
                status_code=409,
                detail=f"User with email '{body.email}' already exists in this tenant"
            )

        new_user = User(
            tenant_id=uuid.UUID(user.tenant_id),
            email=body.email.lower(),
            password_hash=hash_password(body.password),
            role=body.role,
            full_name=body.full_name,
            is_active=True,
        )
        db.add(new_user)
        await db.flush()
        await db.commit()
        return _to_response(new_user)


@router.patch("/{user_id}")
async def update_user(
    user_id: uuid.UUID,
    body: UserUpdate,
    user: TokenClaims = Depends(require_roles("admin")),
):
    if body.role and body.role not in {"admin", "dispatcher", "driver"}:
        raise HTTPException(
            status_code=400,
            detail="Invalid role. Must be 'admin', 'dispatcher', or 'driver'"
        )

    async with get_tenant_session(user.tenant_id) as db:
        db_user = (await db.execute(
            select(User).where(User.id == user_id)
        )).scalar_one_or_none()
        if not db_user:
            raise HTTPException(status_code=404, detail="User not found")

        # Protect last admin from deactivation or demotion
        if db_user.id == uuid.UUID(user.user_id):
            if body.is_active is False or (body.role and body.role != "admin"):
                raise HTTPException(
                    status_code=400,
                    detail="You cannot deactivate or demote your own admin account"
                )

        updates = {}
        if body.full_name is not None:
            updates[User.full_name] = body.full_name
        if body.role is not None:
            updates[User.role] = body.role
        if body.is_active is not None:
            updates[User.is_active] = body.is_active

        if updates:
            await db.execute(
                update(User).where(User.id == user_id).values(updates)
            )
            await db.commit()

            # Re-fetch updated user
            db_user = (await db.execute(
                select(User).where(User.id == user_id)
            )).scalar_one_or_none()

        return _to_response(db_user)


@router.delete("/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_user(
    user_id: uuid.UUID,
    user: TokenClaims = Depends(require_roles("admin")),
):
    if user_id == uuid.UUID(user.user_id):
        raise HTTPException(
            status_code=400,
            detail="You cannot delete your own admin account"
        )

    async with get_tenant_session(user.tenant_id) as db:
        db_user = (await db.execute(
            select(User).where(User.id == user_id)
        )).scalar_one_or_none()
        if not db_user:
            raise HTTPException(status_code=404, detail="User not found")

        await db.execute(delete(User).where(User.id == user_id))
        await db.commit()
