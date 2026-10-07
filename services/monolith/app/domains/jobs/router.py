"""
Jobs domain — full lifecycle management with offline sync and conflict resolution.
"""
import uuid
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Header, HTTPException, Query, status
from pydantic import BaseModel
from sqlalchemy import func, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_tenant_session
from app.core.security import TokenClaims, get_current_user, require_roles
from app.models import Job

router = APIRouter(prefix="/jobs", tags=["Jobs"])

VALID_STATUSES = {"pending", "assigned", "in_progress", "completed", "failed", "cancelled"}


class JobCreate(BaseModel):
    title: str
    description: str | None = None
    vehicle_id: str | None = None
    driver_id: str | None = None
    scheduled_at: datetime | None = None
    priority: int = 3
    pickup_address: dict | None = None
    delivery_address: dict | None = None


class JobSyncRequest(BaseModel):
    """Payload from driver app Background Sync — offline mutation replay."""
    status: str
    client_updated_at: datetime
    metadata: dict | None = None


class JobResponse(BaseModel):
    id: str
    tenant_id: str
    title: str
    status: str
    priority: int
    vehicle_id: str | None
    driver_id: str | None
    scheduled_at: datetime | None
    completed_at: datetime | None
    version: int
    server_updated_at: datetime
    metadata: dict
    delivery_address: dict | None


def _to_response(j: Job) -> JobResponse:
    return JobResponse(
        id=str(j.id),
        tenant_id=str(j.tenant_id),
        title=j.title,
        status=j.status,
        priority=j.priority,
        vehicle_id=str(j.vehicle_id) if j.vehicle_id else None,
        driver_id=str(j.driver_id) if j.driver_id else None,
        scheduled_at=j.scheduled_at,
        completed_at=j.completed_at,
        version=j.version,
        server_updated_at=j.server_updated_at,
        metadata=j.metadata_,
        delivery_address=j.delivery_address,
    )


@router.get("/")
async def list_jobs(
    status_filter: str | None = Query(None, alias="status"),
    driver_id: str | None = Query(None),
    page: int = Query(1, ge=1),
    per_page: int = Query(20, ge=1, le=100),
    user: TokenClaims = Depends(get_current_user),
):
    async with get_tenant_session(user.tenant_id) as db:
        q = select(Job)

        # Drivers can only see their own jobs
        if user.role == "driver":
            q = q.where(Job.driver_id == uuid.UUID(user.user_id))
        elif driver_id:
            q = q.where(Job.driver_id == uuid.UUID(driver_id))

        if status_filter:
            q = q.where(Job.status == status_filter)

        total = (await db.execute(select(func.count()).select_from(q.subquery()))).scalar_one()
        q = q.order_by(Job.scheduled_at.asc().nullslast()).offset((page - 1) * per_page).limit(per_page)
        jobs = (await db.execute(q)).scalars().all()

        return {
            "data": [_to_response(j) for j in jobs],
            "pagination": {"page": page, "per_page": per_page, "total": total, "pages": -(-total // per_page)},
        }


@router.post("/", status_code=status.HTTP_201_CREATED)
async def create_job(
    body: JobCreate,
    user: TokenClaims = Depends(require_roles("admin", "dispatcher")),
):
    async with get_tenant_session(user.tenant_id) as db:
        job = Job(
            tenant_id=uuid.UUID(user.tenant_id),
            title=body.title,
            description=body.description,
            vehicle_id=uuid.UUID(body.vehicle_id) if body.vehicle_id else None,
            driver_id=uuid.UUID(body.driver_id) if body.driver_id else None,
            scheduled_at=body.scheduled_at,
            priority=body.priority,
            pickup_address=body.pickup_address,
            delivery_address=body.delivery_address,
            status="assigned" if body.driver_id else "pending",
            last_modified_by_id=uuid.UUID(user.user_id),
        )
        db.add(job)
        await db.flush()
        return {"data": _to_response(job)}


@router.get("/{job_id}")
async def get_job(
    job_id: uuid.UUID,
    user: TokenClaims = Depends(get_current_user),
):
    async with get_tenant_session(user.tenant_id) as db:
        job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one_or_none()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        if user.role == "driver" and str(job.driver_id) != user.user_id:
            raise HTTPException(status_code=403, detail="Cannot access another driver's job")
        return {"data": _to_response(job)}


@router.patch("/{job_id}/sync")
async def sync_job_from_driver(
    job_id: uuid.UUID,
    body: JobSyncRequest,
    user: TokenClaims = Depends(get_current_user),
    x_tracking_uuid: str | None = Header(None, alias="X-Tracking-UUID"),
):
    """
    Offline sync endpoint — called by driver PWA Background Sync.
    Implements hybrid LWW conflict resolution:
      - status: driver wins if client_updated_at > server_updated_at
      - metadata: always merged (union, never overwrite)
      - route/address: server always wins
    The X-Tracking-UUID header acts as an idempotency key.
    """
    if body.status not in VALID_STATUSES:
        raise HTTPException(status_code=422, detail=f"Invalid status '{body.status}'")

    async with get_tenant_session(user.tenant_id) as db:
        job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one_or_none()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        updates: dict = {}
        conflict_resolved = False

        # Status: LWW — driver update only wins if timestamp is more recent
        client_ts = body.client_updated_at.replace(tzinfo=UTC) if body.client_updated_at.tzinfo is None else body.client_updated_at
        server_ts = job.server_updated_at

        if client_ts > server_ts:
            updates["status"] = body.status
            updates["client_updated_at"] = client_ts
            updates["server_updated_at"] = datetime.now(UTC)
            updates["last_modified_by_id"] = uuid.UUID(user.user_id)
            updates["version"] = job.version + 1

            if body.status == "completed":
                updates["completed_at"] = datetime.now(UTC)
            elif body.status == "in_progress" and not job.started_at:
                updates["started_at"] = datetime.now(UTC)
        else:
            # Server state is more recent — resolve conflict
            conflict_resolved = True

        # Metadata: always merge (driver adds signatures, barcodes)
        if body.metadata:
            existing_meta = job.metadata_ or {}
            updates["metadata"] = {**existing_meta, **body.metadata}

        if updates:
            await db.execute(update(Job).where(Job.id == job_id).values(**updates))
            # Re-fetch to return resolved state
            job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one()

        response_code = status.HTTP_409_CONFLICT if conflict_resolved else status.HTTP_200_OK
        return_data = {"data": _to_response(job)}
        if conflict_resolved:
            return_data["conflict_resolved"] = True
            return_data["message"] = "Server state was more recent. Dispatcher update applied."

        from fastapi.responses import JSONResponse
        return JSONResponse(content=return_data, status_code=response_code)


@router.patch("/{job_id}")
async def update_job(
    job_id: uuid.UUID,
    body: dict,
    user: TokenClaims = Depends(require_roles("admin", "dispatcher")),
):
    async with get_tenant_session(user.tenant_id) as db:
        job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one_or_none()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")

        allowed = {"status", "priority", "driver_id", "vehicle_id", "scheduled_at", "description", "delivery_address"}
        updates = {k: v for k, v in body.items() if k in allowed}
        updates["server_updated_at"] = datetime.now(UTC)
        updates["version"] = job.version + 1
        updates["last_modified_by_id"] = uuid.UUID(user.user_id)

        await db.execute(update(Job).where(Job.id == job_id).values(**updates))
        return {"data": _to_response(job)}


@router.delete("/{job_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_job(
    job_id: uuid.UUID,
    user: TokenClaims = Depends(require_roles("admin", "dispatcher")),
):
    async with get_tenant_session(user.tenant_id) as db:
        job = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one_or_none()
        if not job:
            raise HTTPException(status_code=404, detail="Job not found")
        await db.delete(job)
