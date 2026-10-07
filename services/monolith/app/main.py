"""
FastAPI application factory — wires all domains, middleware, and lifespan events.
"""
import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.core.config import settings
from app.core.database import engine
from app.core.redis import close_redis, get_redis
from app.domains.auth.router import router as auth_router
from app.domains.jobs.router import router as jobs_router
from app.domains.tenants.router import router as tenants_router
from app.domains.vehicles.router import router as vehicles_router
from app.domains.users.router import router as users_router
from app.websocket.hub import hub, router as ws_router

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup and shutdown lifecycle management."""
    logger.info("Starting Fleet Platform Monolith...")

    # Start Redis Pub/Sub listener in background
    redis = await get_redis()
    pubsub_task = asyncio.create_task(hub.start_redis_listener(redis))
    logger.info("WebSocket Redis Pub/Sub listener started")

    yield

    # Graceful shutdown
    logger.info("Shutting down...")
    pubsub_task.cancel()
    try:
        await pubsub_task
    except asyncio.CancelledError:
        pass
    await close_redis()
    await engine.dispose()
    logger.info("Shutdown complete")


def create_app() -> FastAPI:
    app = FastAPI(
        title=settings.app_name,
        version="1.0.0",
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
        lifespan=lifespan,
    )

    # ── CORS ────────────────────────────────────────────────────────────────
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=r"https?://localhost(:[0-9]+)?",
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # ── Routes ──────────────────────────────────────────────────────────────
    prefix = settings.api_v1_prefix
    app.include_router(auth_router,     prefix=prefix)
    app.include_router(tenants_router,  prefix=prefix)
    app.include_router(vehicles_router, prefix=prefix)
    app.include_router(users_router,    prefix=prefix)
    app.include_router(jobs_router,     prefix=prefix)
    app.include_router(ws_router)   # WebSocket — no prefix (mounted at /ws)

    # ── Health Check ─────────────────────────────────────────────────────────
    @app.get("/health", tags=["Health"])
    async def health():
        return {"status": "ok", "service": settings.app_name}

    # ── Global Exception Handler ──────────────────────────────────────────────
    @app.exception_handler(Exception)
    async def unhandled_exception_handler(request: Request, exc: Exception):
        logger.exception("Unhandled exception: %s", exc)
        return JSONResponse(
            status_code=500,
            content={"error": "internal_server_error", "message": "An unexpected error occurred"},
        )

    return app


app = create_app()
