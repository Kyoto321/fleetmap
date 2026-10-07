"""
Vehicles domain — CRUD for tenant vehicles.
All queries run inside a tenant-scoped RLS session.
"""
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_tenant_session
from app.core.redis import get_redis
from app.core.security import TokenClaims, get_current_user, require_roles
from app.models import Vehicle

router = APIRouter(prefix="/vehicles", tags=["Vehicles"])

VALID_STATUSES = {"idle", "en_route", "offline", "maintenance"}


class VehicleCreate(BaseModel):
    registration: str
    make: str | None = None
    model: str | None = None
    year: int | None = None


class VehicleUpdate(BaseModel):
    status: str | None = None
    assigned_driver_id: str | None = None
    make: str | None = None
    model: str | None = None


class VehicleResponse(BaseModel):
    id: str
    tenant_id: str
    registration: str
    make: str | None
    model: str | None
    year: int | None
    status: str
    assigned_driver_id: str | None


def _to_response(v: Vehicle) -> VehicleResponse:
    return VehicleResponse(
        id=str(v.id),
        tenant_id=str(v.tenant_id),
        registration=v.registration,
        make=v.make,
        model=v.model,
        year=v.year,
        status=v.status,
        assigned_driver_id=str(v.assigned_driver_id) if v.assigned_driver_id else None,
    )


@router.get("/")
async def list_vehicles(
    status_filter: str | None = Query(None, alias="status"),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    user: TokenClaims = Depends(get_current_user),
    redis=Depends(get_redis),
):
    async with get_tenant_session(user.tenant_id) as db:
        q = select(Vehicle)
        if status_filter:
            q = q.where(Vehicle.status == status_filter)
        total_q = select(func.count()).select_from(q.subquery())
        total = (await db.execute(total_q)).scalar_one()

        q = q.offset((page - 1) * per_page).limit(per_page)
        vehicles = (await db.execute(q)).scalars().all()

        # Enrich with latest position from Redis GeoHash
        items = []
        for v in vehicles:
            item = _to_response(v).__dict__
            pos = await redis.geopos(f"tenant:{user.tenant_id}:vehicles", str(v.id))
            if pos and pos[0]:
                item["last_position"] = {"longitude": pos[0][0], "latitude": pos[0][1]}
            else:
                item["last_position"] = None
            items.append(item)

        return {
            "data": items,
            "pagination": {"page": page, "per_page": per_page, "total": total, "pages": -(-total // per_page)},
        }


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_vehicle(
    body: VehicleCreate,
    user: TokenClaims = Depends(require_roles("admin")),
):
    async with get_tenant_session(user.tenant_id) as db:
        existing = (await db.execute(
            select(Vehicle).where(Vehicle.registration == body.registration)
        )).scalar_one_or_none()
        if existing:
            raise HTTPException(status_code=409, detail=f"Vehicle '{body.registration}' already exists")

        vehicle = Vehicle(
            tenant_id=uuid.UUID(user.tenant_id),
            registration=body.registration.upper(),
            make=body.make,
            model=body.model,
            year=body.year,
        )
        db.add(vehicle)
        await db.flush()
        return {"data": _to_response(vehicle)}


@router.get("/{vehicle_id}")
async def get_vehicle(
    vehicle_id: uuid.UUID,
    user: TokenClaims = Depends(get_current_user),
):
    async with get_tenant_session(user.tenant_id) as db:
        vehicle = (await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))).scalar_one_or_none()
        if not vehicle:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        return {"data": _to_response(vehicle)}


@router.patch("/{vehicle_id}")
async def update_vehicle(
    vehicle_id: uuid.UUID,
    body: VehicleUpdate,
    user: TokenClaims = Depends(require_roles("admin", "dispatcher")),
):
    if body.status and body.status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid status. Must be one of {VALID_STATUSES}")

    async with get_tenant_session(user.tenant_id) as db:
        vehicle = (await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))).scalar_one_or_none()
        if not vehicle:
            raise HTTPException(status_code=404, detail="Vehicle not found")

        updates: dict = {"updated_at": datetime.now(UTC)}
        if body.status is not None:
            updates["status"] = body.status
        if body.assigned_driver_id is not None:
            updates["assigned_driver_id"] = uuid.UUID(body.assigned_driver_id)
        if body.make is not None:
            updates["make"] = body.make
        if body.model is not None:
            updates["model"] = body.model

        await db.execute(update(Vehicle).where(Vehicle.id == vehicle_id).values(**updates))
        return {"data": _to_response(vehicle)}


@router.delete("/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_vehicle(
    vehicle_id: uuid.UUID,
    user: TokenClaims = Depends(require_roles("admin")),
):
    async with get_tenant_session(user.tenant_id) as db:
        vehicle = (await db.execute(select(Vehicle).where(Vehicle.id == vehicle_id))).scalar_one_or_none()
        if not vehicle:
            raise HTTPException(status_code=404, detail="Vehicle not found")
        await db.delete(vehicle)
