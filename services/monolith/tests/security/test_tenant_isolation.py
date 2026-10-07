"""
Critical security tests — tenant isolation via RLS.
These tests MUST pass before any customer data is onboarded.

Run with: pytest tests/security/ -v -s
"""
import uuid
from datetime import UTC, datetime
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import AsyncSessionFactory
from app.core.security import create_access_token, hash_password
from app.models import Tenant, User, Job, Vehicle


# ── Fixtures ───────────────────────────────────────────────────────────────────

@pytest.fixture
async def two_tenant_setup(async_session: AsyncSession):
    """Create two isolated tenants with users and jobs."""
    # Tenant A
    tenant_a = Tenant(name="ACME Logistics", subdomain="acme")
    tenant_b = Tenant(name="Beta Freight",   subdomain="beta")
    async_session.add_all([tenant_a, tenant_b])
    await async_session.flush()

    user_a = User(
        tenant_id=tenant_a.id, email="dispatch@acme.com",
        password_hash=hash_password("pass"), role="dispatcher", full_name="Alice A",
    )
    user_b = User(
        tenant_id=tenant_b.id, email="dispatch@beta.com",
        password_hash=hash_password("pass"), role="dispatcher", full_name="Bob B",
    )
    async_session.add_all([user_a, user_b])
    await async_session.flush()

    # Job owned by Tenant B — must NEVER be visible to Tenant A
    job_b = Job(
        tenant_id=tenant_b.id,
        title="Secret Beta Delivery",
        status="pending",
    )
    async_session.add(job_b)
    await async_session.flush()

    return {"tenant_a": tenant_a, "tenant_b": tenant_b, "user_a": user_a, "user_b": user_b, "job_b": job_b}


# ── Tests ─────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_tenant_a_cannot_list_tenant_b_jobs(
    async_client: AsyncClient,
    two_tenant_setup: dict,
):
    """
    CRITICAL: Tenant A's dispatcher must receive zero results when listing jobs,
    even though Tenant B has existing jobs in the database.
    RLS policy silently filters them.
    """
    setup = two_tenant_setup
    token = create_access_token(
        user_id=str(setup["user_a"].id),
        tenant_id=str(setup["tenant_a"].id),
        role="dispatcher",
        subdomain="acme",
    )

    response = await async_client.get(
        "/api/v1/jobs",
        cookies={"access_token": token},
        headers={"X-Subdomain": "acme", "X-Tenant-ID": str(setup["tenant_a"].id)},
    )

    assert response.status_code == 200
    data = response.json()
    job_ids = [j["id"] for j in data["data"]]

    # CRITICAL: Tenant B's job must NOT appear
    assert str(setup["job_b"].id) not in job_ids, (
        "🚨 SECURITY BREACH: Tenant B's job is visible to Tenant A!"
    )
    assert data["pagination"]["total"] == 0


@pytest.mark.asyncio
async def test_direct_job_id_access_cross_tenant_returns_404(
    async_client: AsyncClient,
    two_tenant_setup: dict,
):
    """
    Attempting to access Tenant B's job ID with Tenant A's token must return 404.
    The response MUST NOT be 403 (which would confirm the resource exists).
    Returning 404 prevents resource enumeration attacks.
    """
    setup = two_tenant_setup
    token = create_access_token(
        user_id=str(setup["user_a"].id),
        tenant_id=str(setup["tenant_a"].id),
        role="admin",
        subdomain="acme",
    )

    response = await async_client.get(
        f"/api/v1/jobs/{setup['job_b'].id}",
        cookies={"access_token": token},
        headers={"X-Subdomain": "acme", "X-Tenant-ID": str(setup["tenant_a"].id)},
    )

    assert response.status_code == 404, (
        f"Expected 404 for cross-tenant access, got {response.status_code}. "
        "Resource existence must not be revealed."
    )


@pytest.mark.asyncio
async def test_jwt_with_wrong_tenant_id_is_rejected(
    async_client: AsyncClient,
    two_tenant_setup: dict,
):
    """
    A JWT containing Tenant B's tenant_id used against Tenant A's subdomain
    must be rejected by the middleware.
    """
    setup = two_tenant_setup
    # Token claims Tenant B's ID but we're hitting Tenant A's subdomain
    token = create_access_token(
        user_id=str(setup["user_b"].id),
        tenant_id=str(setup["tenant_b"].id),  # Wrong tenant!
        role="admin",
        subdomain="beta",
    )

    response = await async_client.get(
        "/api/v1/jobs",
        cookies={"access_token": token},
        headers={"X-Subdomain": "acme", "X-Tenant-ID": str(setup["tenant_a"].id)},
    )

    # Middleware detects JWT tenant != subdomain tenant → reject
    assert response.status_code in (401, 403), (
        f"Cross-tenant JWT should be rejected, got {response.status_code}"
    )


@pytest.mark.asyncio
async def test_unauthenticated_request_returns_401(async_client: AsyncClient):
    """All protected endpoints must reject requests without a valid JWT."""
    response = await async_client.get("/api/v1/jobs")
    assert response.status_code == 401
