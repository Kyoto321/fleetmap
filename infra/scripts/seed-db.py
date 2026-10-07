#!/usr/bin/env python3
"""
Database seed script — creates demo tenants, users, vehicles, and jobs
for local development and testing.

Usage: python infra/scripts/seed-db.py
Requires: DATABASE_URL environment variable
"""
import asyncio
import os
import sys
import uuid
from datetime import UTC, datetime, timedelta

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "../../services/monolith"))

from app.core.security import hash_password
from app.models import Tenant, User, Vehicle, Job


TENANTS = [
    {
        "subdomain": "acme",
        "name": "ACME Logistics",
        "branding": {"primary_color": "#3B82F6", "logo_url": ""},
        "plan": "pro",
    },
    {
        "subdomain": "beta-freight",
        "name": "Beta Freight Co.",
        "branding": {"primary_color": "#8B5CF6", "logo_url": ""},
        "plan": "free",
    },
]

USERS_PER_TENANT = [
    {"email": "admin@{subdomain}.demo",      "role": "admin",      "full_name": "Admin User",      "password": "demo1234"},
    {"email": "dispatch@{subdomain}.demo",   "role": "dispatcher", "full_name": "Sam Dispatcher",  "password": "demo1234"},
    {"email": "driver1@{subdomain}.demo",    "role": "driver",     "full_name": "Alex Driver",     "password": "demo1234"},
    {"email": "driver2@{subdomain}.demo",    "role": "driver",     "full_name": "Jordan Wheels",   "password": "demo1234"},
]

VEHICLES = [
    {"registration": "AB12 CDE", "make": "Ford",      "model": "Transit",   "year": 2022},
    {"registration": "XY99 ZAB", "make": "Mercedes",  "model": "Sprinter",  "year": 2023},
    {"registration": "LM45 QRS", "make": "Volkswagen","model": "Crafter",   "year": 2021},
]


async def seed():
    db_url = os.environ.get("DATABASE_URL", "postgresql+asyncpg://postgres:postgres@localhost:5432/fleetdb")
    engine = create_async_engine(db_url, echo=False)
    Session = async_sessionmaker(engine, expire_on_commit=False)

    async with Session() as session:
        async with session.begin():
            for t_data in TENANTS:
                tenant = Tenant(
                    id=uuid.uuid4(),
                    name=t_data["name"],
                    subdomain=t_data["subdomain"],
                    plan=t_data["plan"],
                    branding=t_data["branding"],
                )
                session.add(tenant)
                await session.flush()

                print(f"✓ Tenant: {tenant.name} ({tenant.subdomain})")

                users = []
                for u_data in USERS_PER_TENANT:
                    user = User(
                        tenant_id=tenant.id,
                        email=u_data["email"].replace("{subdomain}", t_data["subdomain"]),
                        password_hash=hash_password(u_data["password"]),
                        role=u_data["role"],
                        full_name=u_data["full_name"],
                    )
                    session.add(user)
                    users.append(user)

                await session.flush()

                drivers = [u for u in users if u.role == "driver"]

                for i, v_data in enumerate(VEHICLES):
                    vehicle = Vehicle(
                        tenant_id=tenant.id,
                        registration=v_data["registration"],
                        make=v_data["make"],
                        model=v_data["model"],
                        year=v_data["year"],
                        status="idle",
                        assigned_driver_id=drivers[i % len(drivers)].id if drivers else None,
                    )
                    session.add(vehicle)
                    await session.flush()

                    # Create 2 demo jobs per vehicle
                    for j in range(2):
                        job = Job(
                            tenant_id=tenant.id,
                            vehicle_id=vehicle.id,
                            driver_id=vehicle.assigned_driver_id,
                            title=f"Delivery #{uuid.uuid4().hex[:6].upper()}",
                            status="assigned",
                            priority=j + 1,
                            scheduled_at=datetime.now(UTC) + timedelta(hours=j + 1),
                            delivery_address={
                                "street": f"{100 + j * 50} Example Road",
                                "city": "London",
                                "latitude": 51.5074 + (j * 0.01),
                                "longitude": -0.1278 + (j * 0.01),
                            },
                        )
                        session.add(job)

                print(f"  ↳ {len(USERS_PER_TENANT)} users, {len(VEHICLES)} vehicles, {len(VEHICLES) * 2} jobs")

    print("\n🎉 Database seeded successfully!")
    print("\nDemo login credentials:")
    for t in TENANTS:
        print(f"\n  {t['name']} ({t['subdomain']}.localhost:3000)")
        for u in USERS_PER_TENANT:
            print(f"    {u['email'].replace('{subdomain}', t['subdomain'])} / {u['password']}")

    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(seed())
