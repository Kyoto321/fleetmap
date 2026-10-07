"""
Core configuration — reads from environment variables.
All secrets are sourced via environment; never hardcoded.
"""
from functools import lru_cache
from typing import Literal

from pydantic import AnyUrl, Field, PostgresDsn, RedisDsn
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # ── Application ────────────────────────────────────────────
    app_name: str = "Fleet Platform Monolith"
    environment: Literal["development", "staging", "production"] = "development"
    debug: bool = False
    root_domain: str = "localhost"       # e.g. "app.com" in production
    api_v1_prefix: str = "/api/v1"

    # ── Database ───────────────────────────────────────────────
    database_url: str = Field(
        default="postgresql+asyncpg://postgres:postgres@localhost:5432/fleetdb"
    )
    db_pool_size: int = 20
    db_max_overflow: int = 40
    db_pool_timeout: int = 30

    # ── Redis ──────────────────────────────────────────────────
    redis_url: str = Field(default="redis://localhost:6379/0")
    redis_tenant_cache_ttl: int = 300   # seconds

    # ── JWT ────────────────────────────────────────────────────
    jwt_private_key: str = Field(default="")    # RS256 PEM private key
    jwt_public_key: str = Field(default="")     # RS256 PEM public key
    jwt_algorithm: str = "RS256"
    jwt_access_token_expire_seconds: int = 86_400    # 24 hours
    jwt_refresh_token_expire_seconds: int = 604_800  # 7 days

    # ── Kafka ──────────────────────────────────────────────────
    kafka_brokers: str = Field(default="localhost:9092")
    kafka_topic_jobs: str = "jobs.events"
    kafka_topic_notifications: str = "notifications.dispatch"

    # ── CORS ───────────────────────────────────────────────────
    cors_origins: list[str] = ["http://localhost:3000"]

    # ── Bcrypt ─────────────────────────────────────────────────
    bcrypt_rounds: int = 12


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
