"""
Async SQLAlchemy engine and session factory.
Sets PostgreSQL RLS context variable on every connection checkout.
"""
from collections.abc import AsyncGenerator
from contextlib import asynccontextmanager

from sqlalchemy import event, text
from sqlalchemy.ext.asyncio import (
    AsyncEngine,
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.core.config import settings


class Base(DeclarativeBase):
    pass


def _create_engine() -> AsyncEngine:
    return create_async_engine(
        settings.database_url,
        pool_size=settings.db_pool_size,
        max_overflow=settings.db_max_overflow,
        pool_timeout=settings.db_pool_timeout,
        pool_pre_ping=True,
        echo=settings.debug,
    )


engine: AsyncEngine = _create_engine()

AsyncSessionFactory = async_sessionmaker(
    engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)


@asynccontextmanager
async def get_tenant_session(tenant_id: str) -> AsyncGenerator[AsyncSession, None]:
    """
    Yield an AsyncSession with the RLS tenant context pre-set.
    All queries executed within this session are automatically filtered
    by PostgreSQL Row-Level Security policies to the given tenant.
    """
    async with AsyncSessionFactory() as session:
        async with session.begin():
            # SET LOCAL — scoped to this transaction only, using set_config function to allow parameterization
            await session.execute(
                text("SELECT set_config('app.current_tenant_id', :tid, true)"),
                {"tid": str(tenant_id)},
            )

            try:
                yield session
            except Exception:
                await session.rollback()
                raise


async def get_db() -> AsyncGenerator[AsyncSession, None]:
    """
    Plain session dependency for non-tenant-scoped routes (e.g. tenant lookup).
    """
    async with AsyncSessionFactory() as session:
        async with session.begin():
            yield session
