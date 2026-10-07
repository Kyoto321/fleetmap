# Distributed B2B Fleet Management & Telemetry Platform
## Master Implementation Blueprint

> **Document Status**: Implementation Plan — Awaiting Engineering Review & Approval  
> **Prepared by**: Principal Architecture Review  
> **Target Scale**: 10,000+ vehicles · Millions of telemetry events/day · Thousands of concurrent users · Hundreds of tenants

---

## 1. Executive Summary

### What the Platform Does

This platform is a **multi-tenant, enterprise-grade B2B SaaS fleet management and telemetry system** designed for logistics and field-service companies. It provides three core capabilities:

1. **Isolated Tenant Workspaces** — Each subscribing company receives a fully isolated, branded workspace reachable via dedicated subdomain (`company-a.app.com`). Their data, users, configurations, and branding are cryptographically and architecturally separated from all other tenants.

2. **Offline-First Driver PWA** — Field workers operate in environments with intermittent or zero connectivity (warehouses, rural roads, underground facilities). The driver app functions completely offline using local-first data storage (IndexedDB), queuing mutations for synchronisation the moment connectivity resumes, with a deterministic conflict-resolution algorithm protecting data integrity.

3. **High-Throughput Telemetry Pipeline** — Vehicles and IoT devices continuously stream GPS coordinates, speed, battery state, and diagnostics at high frequency. A purpose-built ingestion microservice accepts this "firehose" of data, immediately acknowledges it (HTTP 202), routes it through Apache Kafka, processes it via a stateless consumer, caches the latest state in Redis GeoHashes, and performs batched writes to the time-series database — all without touching the core business application.

### Business Value

| Stakeholder | Value Delivered |
|---|---|
| Fleet Operators | Real-time situational awareness across 100s of vehicles on a single map |
| Dispatchers | Instant re-routing based on live telemetry without page refresh |
| Field Drivers | App continues functioning in dead zones; no job loss, no manual re-entry |
| Platform Owner | SaaS economics — one codebase, unlimited tenants, isolated billing |
| Engineering Leadership | Demonstrates mastery of distributed systems, microservice extraction, and offline-first design |

### Users Involved

- **Tenant Admin** — Onboards vehicles, manages users, configures company branding
- **Dispatcher** — Assigns jobs, monitors live fleet map, re-routes in real-time
- **Driver** — Receives assignments on PWA, operates offline, syncs completed work

### Core Technical Challenges

| Challenge | Description | Solution |
|---|---|---|
| **Data Isolation** | Tenant A must never see Tenant B data | PostgreSQL RLS + JWT tenant claims + Middleware context binding |
| **The Firehose Problem** | 10,000 GPS pings/sec must not slow invoicing | Kafka decoupling + dedicated ingestion microservice |
| **The Split-Brain Problem** | Offline edit vs. online edit same record simultaneously | LWW conflict resolution with server-authoritative timestamps |
| **Real-Time at Scale** | 1,000s of WebSocket connections across 100s of tenants | Redis Pub/Sub tenant channels + SSE fallback |
| **Progressive Degradation** | App must function when offline | Service Worker + Workbox + IndexedDB + Background Sync |

### Why This Architecture Is Appropriate

The architecture deliberately starts as a **modular monolith** (Milestone 1–4) and extracts microservices only where there is proven operational stress (Milestone 5 — Strangler Fig). This avoids premature distribution while building toward horizontal scalability. The telemetry pipeline is isolated from day one using the message broker as the architectural seam, meaning the monolith is never in the hot path of high-frequency IoT data.

---

## 2. System Architecture Overview

### 2.1 Frontend Layer

**Next.js Application (App Router, TypeScript)**  
The management dashboard is a Next.js 14+ application using the App Router paradigm. Each page is server-rendered by default (RSC), falling back to client-side interactivity only where needed (map, WebSocket consumers).

- **Tenant Routing**: A Next.js middleware file intercepts every request at the edge, extracts the subdomain from the `Host` header, validates it against a cached tenant registry (Redis TTL-backed), and injects `tenant_id` into request headers for downstream server components.
- **Dashboard Architecture**: Modular route groups — `/(auth)` for login/logout, `/(dashboard)` for dispatch views, `/(admin)` for tenant management. Shared layouts handle navigation, branding injection (CSS custom properties from tenant config), and WebSocket initialisation.
- **Authentication Flow**: Login form POSTs to `/api/v1/auth/login` on the monolith. The returned JWT is stored in an `httpOnly`, `Secure`, `SameSite=Strict` cookie. Middleware reads and validates the JWT on every request server-side. No client-side token exposure.
- **Driver PWA**: A separate Vite/React application (not Next.js) optimised for mobile form factors with Workbox service worker, installable on Android/iOS.

### 2.2 Backend Layer

**Monolith (FastAPI, Python)**  
Owns all core business logic: tenant management, user auth, vehicle CRUD, job lifecycle, billing hooks. Connects to PostgreSQL with RLS-enforced connections. Exposes REST APIs prefixed `/api/v1/{auth,tenants,users,vehicles,jobs}`.

**Telemetry Microservice (Go or FastAPI + asyncio)**  
A completely stateless, horizontally scalable ingestion service. Its only responsibilities:
1. Validate incoming telemetry payloads
2. Publish to Kafka `telemetry.raw`
3. Return HTTP 202

The Kafka consumer within the same service (or a separate consumer pod) reads from `telemetry.raw`, writes to Redis GeoHash, and batch-inserts to PostgreSQL timeseries table.

**API Gateway (Nginx)**  
Single ingress point. Routes by path prefix — core business routes go to monolith, `/api/v1/telemetry/*` routes to telemetry microservice. Handles TLS termination, rate limiting, and upstream health checks.

### 2.3 Data Layer

| Store | Role |
|---|---|
| **PostgreSQL** | Source of truth for all business data. RLS enforces tenant isolation. TimescaleDB extension for telemetry time-series. |
| **Redis** | Hot cache for latest vehicle positions (GeoHash), Pub/Sub broker for tenant WebSocket channels, session/JWT blacklist |
| **Kafka** | Durable event log for raw telemetry. Decouples ingestion throughput from write throughput. Replay capability. |
| **IndexedDB** | In-browser persistent storage in the Driver PWA for offline job cache and mutations queue |

### 2.4 Infrastructure Layer

- **Docker**: Every service is containerised. Multi-stage builds minimise image sizes.
- **Docker Compose**: Local development and staging. Single file brings up postgres, redis, kafka, zookeeper, monolith, telemetry service, nginx.
- **GitHub Actions**: CI pipeline on every PR — lint → test → build → push image. CD pipeline on `main` merge — deploy to staging, run smoke tests, promote to production.
- **Reverse Proxy (Nginx)**: Wildcard subdomain routing (`*.app.com`), upstream health balancing, WebSocket upgrade headers, gzip compression.

---

### 2.5 Architecture Diagrams

#### High-Level System Topology

```mermaid
graph TB
    subgraph Internet
        DRV[Driver Device<br/>PWA/Mobile]
        MGR[Manager Browser<br/>Next.js Dashboard]
        VEH[Vehicle IoT Device<br/>GPS Tracker]
    end

    subgraph "Nginx API Gateway"
        GW[Reverse Proxy<br/>*.company.app.com]
    end

    subgraph "Core Monolith (FastAPI)"
        AUTH[Auth Service]
        TENANTS[Tenant API]
        JOBS[Jobs API]
        VEHICLES[Vehicle API]
        WS[WebSocket Hub]
    end

    subgraph "Telemetry Microservice (Go)"
        INGEST[Ingestion Endpoint<br/>POST /telemetry]
        CONSUMER[Kafka Consumer<br/>Worker]
    end

    subgraph "Message Broker"
        KAFKA[Apache Kafka<br/>telemetry.raw topic]
    end

    subgraph "Data Stores"
        PG[(PostgreSQL<br/>+ TimescaleDB)]
        REDIS[(Redis<br/>GeoHash + PubSub)]
    end

    subgraph "Driver App Storage"
        IDB[(IndexedDB<br/>Offline Cache)]
        SW[Service Worker<br/>Background Sync]
    end

    DRV -->|HTTPS| GW
    MGR -->|HTTPS / WSS| GW
    VEH -->|HTTPS POST telemetry| GW

    GW -->|/api/v1/auth,jobs,vehicles| AUTH & JOBS & VEHICLES
    GW -->|/api/v1/telemetry| INGEST
    GW -->|WSS /ws| WS

    AUTH & JOBS & VEHICLES -->|SQL + RLS| PG
    INGEST -->|Produce| KAFKA
    CONSUMER -->|Consume| KAFKA
    CONSUMER -->|GeoHash SET| REDIS
    CONSUMER -->|Batch INSERT| PG

    WS -->|Subscribe pubsub:tenant:{id}| REDIS
    CONSUMER -->|PUBLISH pubsub:tenant:{id}| REDIS

    DRV <-->|Offline Cache| IDB
    DRV <-->|Sync| SW
    SW -->|Background Sync| GW
```

#### Request Lifecycle — Telemetry Ingestion

```mermaid
sequenceDiagram
    participant VEH as Vehicle/IoT
    participant GW as Nginx Gateway
    participant TS as Telemetry Service
    participant KF as Kafka
    participant CS as Consumer Worker
    participant RD as Redis
    participant PG as PostgreSQL
    participant WS as WebSocket Hub
    participant UI as Dispatcher Dashboard

    VEH->>GW: POST /api/v1/telemetry {lat,lng,speed,ts}
    GW->>TS: Forward request
    TS->>TS: Validate payload, extract tenant from JWT
    TS->>KF: PRODUCE telemetry.raw {tenant_id, vehicle_id, ...}
    TS->>GW: 202 Accepted (instant return)
    GW->>VEH: 202 Accepted

    KF->>CS: CONSUME message
    CS->>RD: GEOADD tenant:{id}:vehicles lng lat vehicle:{id}
    CS->>CS: Buffer in-memory (5-10s window)
    CS->>PG: Batch INSERT telemetry_events (bulk)
    CS->>RD: PUBLISH pubsub:tenant:{tenant_id} {vehicle_id, lat, lng}
    RD->>WS: Push message to tenant channel
    WS->>UI: WebSocket PUSH {vehicle_id, lat, lng}
    UI->>UI: Update map marker (throttled 500ms)
```

---

## 3. Complete Folder Structure

```
fleet-platform/
│
├── apps/
│   ├── web/                          # Next.js Management Dashboard
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── (auth)/
│   │   │   │   │   ├── login/
│   │   │   │   │   │   └── page.tsx
│   │   │   │   │   └── layout.tsx
│   │   │   │   ├── (dashboard)/
│   │   │   │   │   ├── map/
│   │   │   │   │   │   └── page.tsx   # Live fleet map
│   │   │   │   │   ├── jobs/
│   │   │   │   │   │   ├── page.tsx
│   │   │   │   │   │   └── [id]/
│   │   │   │   │   │       └── page.tsx
│   │   │   │   │   ├── vehicles/
│   │   │   │   │   │   └── page.tsx
│   │   │   │   │   └── layout.tsx
│   │   │   │   ├── (admin)/
│   │   │   │   │   ├── users/
│   │   │   │   │   ├── settings/
│   │   │   │   │   └── layout.tsx
│   │   │   │   ├── api/
│   │   │   │   │   └── [...proxy]/   # API proxy route (optional)
│   │   │   │   └── layout.tsx        # Root layout with font/metadata
│   │   │   ├── components/
│   │   │   │   ├── map/
│   │   │   │   │   ├── FleetMap.tsx
│   │   │   │   │   ├── VehicleMarker.tsx
│   │   │   │   │   └── MapControls.tsx
│   │   │   │   ├── jobs/
│   │   │   │   ├── vehicles/
│   │   │   │   ├── ui/               # Design system components
│   │   │   │   └── providers/
│   │   │   │       ├── TenantProvider.tsx
│   │   │   │       └── WebSocketProvider.tsx
│   │   │   ├── hooks/
│   │   │   │   ├── useVehicleStream.ts
│   │   │   │   ├── useTenantBranding.ts
│   │   │   │   └── useWebSocket.ts
│   │   │   ├── lib/
│   │   │   │   ├── api-client.ts
│   │   │   │   ├── auth.ts
│   │   │   │   └── tenant.ts
│   │   │   ├── middleware.ts          # Subdomain tenant routing
│   │   │   └── types/
│   │   │       └── index.ts
│   │   ├── public/
│   │   ├── next.config.ts
│   │   ├── tsconfig.json
│   │   └── package.json
│   │
│   └── driver-pwa/                   # Vite + React PWA
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── sw.ts                 # Service Worker (Workbox)
│       │   ├── pages/
│       │   │   ├── JobList.tsx       # Offline-capable job list
│       │   │   ├── JobDetail.tsx     # Individual job + signature capture
│       │   │   └── Scan.tsx          # Barcode scanner
│       │   ├── db/
│       │   │   ├── index.ts          # Dexie.js setup
│       │   │   ├── jobs-store.ts     # jobs_cache store
│       │   │   └── mutations-store.ts # mutations_queue store
│       │   ├── sync/
│       │   │   ├── background-sync.ts
│       │   │   └── conflict-resolver.ts
│       │   ├── hooks/
│       │   │   ├── useOfflineJobs.ts
│       │   │   └── useNetworkStatus.ts
│       │   └── components/
│       ├── public/
│       │   └── manifest.json
│       ├── vite.config.ts
│       ├── tsconfig.json
│       └── package.json
│
├── services/
│   ├── monolith/                     # FastAPI Core Backend
│   │   ├── app/
│   │   │   ├── main.py               # FastAPI app factory
│   │   │   ├── core/
│   │   │   │   ├── config.py         # Pydantic settings
│   │   │   │   ├── security.py       # JWT creation/validation
│   │   │   │   ├── database.py       # SQLAlchemy async engine
│   │   │   │   └── middleware.py     # Tenant context middleware
│   │   │   ├── domains/
│   │   │   │   ├── auth/
│   │   │   │   │   ├── router.py
│   │   │   │   │   ├── service.py
│   │   │   │   │   └── schemas.py
│   │   │   │   ├── tenants/
│   │   │   │   │   ├── router.py
│   │   │   │   │   ├── service.py
│   │   │   │   │   ├── repository.py # Repository Pattern
│   │   │   │   │   └── schemas.py
│   │   │   │   ├── users/
│   │   │   │   ├── vehicles/
│   │   │   │   └── jobs/
│   │   │   ├── websocket/
│   │   │   │   ├── hub.py            # WebSocket connection manager
│   │   │   │   └── router.py
│   │   │   └── models/               # SQLAlchemy ORM models
│   │   │       ├── tenant.py
│   │   │       ├── user.py
│   │   │       ├── vehicle.py
│   │   │       ├── job.py
│   │   │       └── audit_log.py
│   │   ├── alembic/                  # Database migrations
│   │   │   ├── env.py
│   │   │   └── versions/
│   │   ├── tests/
│   │   │   ├── unit/
│   │   │   ├── integration/
│   │   │   └── conftest.py
│   │   ├── Dockerfile
│   │   ├── requirements.txt
│   │   └── pyproject.toml
│   │
│   └── telemetry/                    # Go Telemetry Microservice
│       ├── cmd/
│       │   └── server/
│       │       └── main.go           # Entrypoint
│       ├── internal/
│       │   ├── handler/
│       │   │   └── ingest.go         # HTTP handler (POST /telemetry)
│       │   ├── kafka/
│       │   │   ├── producer.go       # Kafka producer
│       │   │   └── consumer.go       # Kafka consumer worker
│       │   ├── redis/
│       │   │   └── geo.go            # GeoHash write + PubSub publish
│       │   ├── postgres/
│       │   │   └── batch_writer.go   # Buffered batch INSERT
│       │   ├── validator/
│       │   │   └── telemetry.go      # Payload validation
│       │   └── middleware/
│       │       └── auth.go           # JWT tenant extraction
│       ├── Dockerfile
│       ├── go.mod
│       └── go.sum
│
├── infra/
│   ├── docker/
│   │   ├── docker-compose.yml        # Full local stack
│   │   ├── docker-compose.prod.yml   # Production overrides
│   │   └── nginx/
│   │       ├── nginx.conf            # Main proxy config
│   │       └── conf.d/
│   │           ├── monolith.conf
│   │           └── telemetry.conf
│   ├── k8s/                          # Future Kubernetes manifests
│   │   ├── deployments/
│   │   ├── services/
│   │   └── ingress/
│   ├── monitoring/
│   │   ├── prometheus/
│   │   │   └── prometheus.yml
│   │   ├── grafana/
│   │   │   └── dashboards/
│   │   └── loki/
│   │       └── loki-config.yaml
│   └── scripts/
│       ├── seed-db.sh
│       └── create-tenant.sh
│
├── load-tests/
│   ├── k6/
│   │   ├── telemetry-flood.js        # 1000+ concurrent telemetry senders
│   │   ├── business-api.js           # Baseline monolith responsiveness
│   │   └── mixed-scenario.js         # Both simultaneously
│   └── artillery/
│       └── config.yaml
│
├── .github/
│   └── workflows/
│       ├── ci.yml                    # Lint + Test on PR
│       ├── build.yml                 # Docker build + push on main
│       └── deploy.yml                # Deploy to staging/prod
│
├── docs/
│   ├── architecture/
│   │   ├── adr/                      # Architecture Decision Records
│   │   └── diagrams/
│   └── api/
│       └── openapi.yaml
│
└── README.md
```

---

## 4. Database Design

### 4.1 PostgreSQL Schema

```sql
-- ============================================================
-- EXTENSIONS
-- ============================================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS postgis;       -- for geometry types (optional)
-- TimescaleDB for telemetry time-series
CREATE EXTENSION IF NOT EXISTS timescaledb;

-- ============================================================
-- TENANTS
-- ============================================================
CREATE TABLE tenants (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name            VARCHAR(255) NOT NULL,
    subdomain       VARCHAR(63)  NOT NULL UNIQUE,
    plan            VARCHAR(50)  NOT NULL DEFAULT 'free',
    branding        JSONB        NOT NULL DEFAULT '{}',  -- {logo_url, primary_color, ...}
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenants_subdomain ON tenants(subdomain);

-- ============================================================
-- USERS
-- ============================================================
CREATE TABLE users (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    email           VARCHAR(255) NOT NULL,
    password_hash   VARCHAR(255) NOT NULL,
    role            VARCHAR(50)  NOT NULL CHECK (role IN ('admin', 'dispatcher', 'driver')),
    full_name       VARCHAR(255) NOT NULL,
    is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
    last_login_at   TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, email)
);

CREATE INDEX idx_users_tenant_id   ON users(tenant_id);
CREATE INDEX idx_users_email       ON users(email);

-- ============================================================
-- VEHICLES
-- ============================================================
CREATE TABLE vehicles (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    registration    VARCHAR(20)  NOT NULL,
    make            VARCHAR(100),
    model           VARCHAR(100),
    year            SMALLINT,
    status          VARCHAR(50)  NOT NULL DEFAULT 'idle'
                        CHECK (status IN ('idle', 'en_route', 'offline', 'maintenance')),
    assigned_driver UUID         REFERENCES users(id) ON DELETE SET NULL,
    metadata        JSONB        NOT NULL DEFAULT '{}',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    UNIQUE (tenant_id, registration)
);

CREATE INDEX idx_vehicles_tenant_id ON vehicles(tenant_id);
CREATE INDEX idx_vehicles_status    ON vehicles(status);

-- ============================================================
-- JOBS
-- ============================================================
CREATE TABLE jobs (
    id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    vehicle_id      UUID         REFERENCES vehicles(id) ON DELETE SET NULL,
    driver_id       UUID         REFERENCES users(id)    ON DELETE SET NULL,
    title           VARCHAR(255) NOT NULL,
    description     TEXT,
    status          VARCHAR(50)  NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','assigned','in_progress','completed','failed','cancelled')),
    priority        SMALLINT     NOT NULL DEFAULT 3 CHECK (priority BETWEEN 1 AND 5),
    scheduled_at    TIMESTAMPTZ,
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ,
    pickup_address  JSONB,       -- {street, city, lat, lng}
    delivery_address JSONB,
    -- Conflict resolution fields
    version         BIGINT       NOT NULL DEFAULT 1,     -- Optimistic locking
    last_modified_by UUID        REFERENCES users(id),
    client_updated_at TIMESTAMPTZ,                       -- Client-side timestamp for LWW
    server_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    metadata        JSONB        NOT NULL DEFAULT '{}',  -- signatures, barcodes, etc.
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_jobs_tenant_id   ON jobs(tenant_id);
CREATE INDEX idx_jobs_driver_id   ON jobs(driver_id);
CREATE INDEX idx_jobs_vehicle_id  ON jobs(vehicle_id);
CREATE INDEX idx_jobs_status      ON jobs(status);
CREATE INDEX idx_jobs_scheduled   ON jobs(scheduled_at);

-- ============================================================
-- TELEMETRY EVENTS (TimescaleDB hypertable)
-- ============================================================
CREATE TABLE telemetry_events (
    time            TIMESTAMPTZ  NOT NULL,
    tenant_id       UUID         NOT NULL,
    vehicle_id      UUID         NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    latitude        DOUBLE PRECISION NOT NULL,
    longitude       DOUBLE PRECISION NOT NULL,
    speed           REAL,                          -- km/h
    heading         REAL,                          -- degrees 0-360
    battery_level   REAL,                          -- 0.0 - 1.0
    engine_on       BOOLEAN,
    raw_payload     JSONB        NOT NULL DEFAULT '{}',
    PRIMARY KEY (time, vehicle_id)
);

-- Convert to hypertable (partitioned by time, weekly chunks)
SELECT create_hypertable('telemetry_events', 'time', chunk_time_interval => INTERVAL '1 week');

-- Automatic compression after 7 days
ALTER TABLE telemetry_events SET (
    timescaledb.compress,
    timescaledb.compress_segmentby = 'vehicle_id',
    timescaledb.compress_orderby   = 'time DESC'
);
SELECT add_compression_policy('telemetry_events', INTERVAL '7 days');

CREATE INDEX idx_telemetry_tenant_vehicle ON telemetry_events(tenant_id, vehicle_id, time DESC);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE audit_logs (
    id              UUID         PRIMARY KEY DEFAULT uuid_generate_v4(),
    tenant_id       UUID         NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    user_id         UUID         REFERENCES users(id) ON DELETE SET NULL,
    action          VARCHAR(100) NOT NULL,    -- e.g. 'job.status_changed'
    resource_type   VARCHAR(100) NOT NULL,    -- e.g. 'job'
    resource_id     UUID,
    old_value       JSONB,
    new_value       JSONB,
    ip_address      INET,
    user_agent      TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_audit_tenant_id    ON audit_logs(tenant_id);
CREATE INDEX idx_audit_user_id      ON audit_logs(user_id);
CREATE INDEX idx_audit_created_at   ON audit_logs(created_at DESC);
CREATE INDEX idx_audit_resource     ON audit_logs(resource_type, resource_id);
```

### 4.2 Row-Level Security Design

**Strategy**: PostgreSQL RLS policies intercept all data access at the database engine level. No application-layer filtering can accidentally bypass this. We use a session-level variable `app.current_tenant_id` set by the connection pool before every query.

**Tenant Isolation Guarantee**: Even if application code contains a bug that omits a `WHERE tenant_id = ...` clause, the RLS policy silently appends the filter. Data from other tenants becomes invisible — it is not returned, not counted, and not error-raised.

```sql
-- ============================================================
-- ENABLE RLS ON ALL TENANT-SCOPED TABLES
-- ============================================================
ALTER TABLE users     ENABLE ROW LEVEL SECURITY;
ALTER TABLE vehicles  ENABLE ROW LEVEL SECURITY;
ALTER TABLE jobs      ENABLE ROW LEVEL SECURITY;
ALTER TABLE telemetry_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- CREATE RESTRICTED APP USER (no superuser access)
-- ============================================================
CREATE ROLE app_user LOGIN PASSWORD 'strong_password_here';

-- Grant only DML on business tables (NOT tenants table — managed by migrations user)
GRANT SELECT, INSERT, UPDATE, DELETE
    ON users, vehicles, jobs, telemetry_events, audit_logs
    TO app_user;

-- Grant SELECT on tenants for middleware validation only
GRANT SELECT ON tenants TO app_user;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Users table
CREATE POLICY tenant_isolation_users ON users
    FOR ALL TO app_user
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Vehicles table
CREATE POLICY tenant_isolation_vehicles ON vehicles
    FOR ALL TO app_user
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Jobs table
CREATE POLICY tenant_isolation_jobs ON jobs
    FOR ALL TO app_user
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Telemetry events
CREATE POLICY tenant_isolation_telemetry ON telemetry_events
    FOR ALL TO app_user
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- Audit logs
CREATE POLICY tenant_isolation_audit ON audit_logs
    FOR ALL TO app_user
    USING (tenant_id = current_setting('app.current_tenant_id')::UUID);

-- ============================================================
-- APPLICATION USAGE PATTERN (per-request context binding)
-- ============================================================
-- In application code (Python/SQLAlchemy async):
-- async with engine.connect() as conn:
--     await conn.execute(
--         text("SET LOCAL app.current_tenant_id = :tid"),
--         {"tid": str(tenant_id)}
--     )
--     result = await conn.execute(select(User))  # RLS auto-filters
```

**Security Guarantees**:
- `app_user` cannot execute DDL or bypass RLS (no `BYPASSRLS` privilege)
- `SET LOCAL app.current_tenant_id` is scoped to the current transaction only
- The middleware validates the tenant exists before setting the context variable
- Superuser operations (migrations) use a separate database role with RLS bypassed, never the app role

---

## 5. Authentication & Authorization Design

### 5.1 JWT Structure

```json
{
  "header": {
    "alg": "RS256",
    "typ": "JWT",
    "kid": "key-rotation-id-v1"
  },
  "payload": {
    "sub": "usr_3f9a2b1c",
    "user_id": "3f9a2b1c-0000-0000-0000-000000000001",
    "tenant_id": "a1b2c3d4-0000-0000-0000-000000000001",
    "role": "dispatcher",
    "permissions": ["jobs:read", "jobs:write", "vehicles:read"],
    "subdomain": "acme-logistics",
    "iat": 1719235200,
    "exp": 1719321600,
    "jti": "unique-token-id-for-blacklisting"
  }
}
```

**Key design decisions**:
- **RS256** (asymmetric) — Private key held only by auth service; other services validate with public key without needing the secret
- **Short-lived access tokens** — 24h expiry with refresh token (7 day, httpOnly cookie)
- **`jti` claim** — Enables server-side token blacklisting on logout (stored in Redis with TTL matching token expiry)
- **Key rotation** — `kid` header supports rotating signing keys without invalidating existing tokens

### 5.2 Authentication Flows

```mermaid
sequenceDiagram
    participant B as Browser (company-a.app.com)
    participant NX as Next.js Middleware
    participant GW as Nginx Gateway
    participant M as Monolith Auth API
    participant PG as PostgreSQL
    participant RD as Redis

    Note over B,RD: LOGIN FLOW
    B->>GW: POST /api/v1/auth/login {email, password}
    GW->>M: Forward
    M->>PG: SELECT user WHERE tenant=company-a AND email=...
    PG-->>M: User record (with password_hash)
    M->>M: bcrypt.verify(password, hash)
    M->>M: generate JWT (RS256, user_id, tenant_id, role)
    M->>M: generate refresh_token (opaque, 64-byte random)
    M->>RD: SET refresh:{token_hash} user_id EX 604800
    M-->>B: Set-Cookie: access_token=JWT; refresh_token=<opaque>; HttpOnly; Secure; SameSite=Strict
    B->>B: Store nothing in JS (cookies only)

    Note over B,RD: SUBSEQUENT REQUEST FLOW
    B->>GW: GET /api/v1/jobs (Cookie: access_token=JWT)
    GW->>NX: Next.js middleware intercepts
    NX->>NX: Extract subdomain → 'company-a'
    NX->>NX: Verify JWT signature (public key)
    NX->>NX: Verify JWT.tenant_id matches subdomain tenant
    NX->>GW: Forward with X-Tenant-ID, X-User-ID, X-Role headers
    GW->>M: Forward enriched request
    M->>PG: SET LOCAL app.current_tenant_id = X-Tenant-ID
    M->>PG: SELECT * FROM jobs (RLS filters automatically)

    Note over B,RD: LOGOUT FLOW
    B->>GW: POST /api/v1/auth/logout
    M->>RD: SET blacklist:{jti} 1 EX {remaining_ttl}
    M-->>B: Clear-Cookie: access_token, refresh_token
```

### 5.3 Role-Based Authorization

```python
# services/monolith/app/core/security.py

from enum import Enum
from functools import wraps
from fastapi import HTTPException, Depends, status

class Role(str, Enum):
    ADMIN      = "admin"
    DISPATCHER = "dispatcher"
    DRIVER     = "driver"

ROLE_HIERARCHY = {
    Role.ADMIN:      3,
    Role.DISPATCHER: 2,
    Role.DRIVER:     1,
}

def require_role(*roles: Role):
    """Dependency factory for route-level role enforcement."""
    async def dependency(current_user = Depends(get_current_user)):
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role}' is not permitted for this resource."
            )
        return current_user
    return dependency

# Usage on routes:
@router.delete("/vehicles/{id}")
async def delete_vehicle(
    id: UUID,
    user = Depends(require_role(Role.ADMIN))
):
    ...
```

---

## 6. Multi-Tenant Architecture

### 6.1 Subdomain Routing

| Request Host | Resolved Tenant | Action |
|---|---|---|
| `company-a.app.com` | `company-a` | Bind tenant context, serve dashboard |
| `company-b.app.com` | `company-b` | Bind different tenant context |
| `app.com` | None | Redirect to marketing page |
| `unknown.app.com` | Not found | Return 404 |

### 6.2 Next.js Middleware Flow

```typescript
// apps/web/src/middleware.ts
import { NextRequest, NextResponse } from 'next/server';
import { verifyJWT }  from '@/lib/auth';

export async function middleware(request: NextRequest) {
    const host     = request.headers.get('host') ?? '';
    const rootDomain = process.env.ROOT_DOMAIN!;       // 'app.com'
    const subdomain  = host.replace(`.${rootDomain}`, '').split(':')[0];

    // Pass-through for root domain (landing page)
    if (subdomain === rootDomain || subdomain === 'www') {
        return NextResponse.next();
    }

    // Validate tenant exists (Redis-cached lookup, 5min TTL)
    const tenant = await resolveTenant(subdomain);
    if (!tenant) {
        return NextResponse.rewrite(new URL('/404', request.url));
    }

    // Clone request and inject tenant context into headers
    const response = NextResponse.next();
    response.headers.set('X-Tenant-ID',  tenant.id);
    response.headers.set('X-Subdomain',  subdomain);

    // Validate JWT if present
    const token = request.cookies.get('access_token')?.value;
    if (token) {
        const claims = await verifyJWT(token);
        if (!claims || claims.tenant_id !== tenant.id) {
            // Token for wrong tenant — clear and redirect to login
            const loginUrl = new URL(`/login`, request.url);
            const res = NextResponse.redirect(loginUrl);
            res.cookies.delete('access_token');
            return res;
        }
        response.headers.set('X-User-ID', claims.user_id);
        response.headers.set('X-Role',    claims.role);
    } else if (!request.nextUrl.pathname.startsWith('/login')) {
        return NextResponse.redirect(new URL('/login', request.url));
    }

    return response;
}

export const config = {
    matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
```

### 6.3 Tenant Resolution Sequence

```mermaid
sequenceDiagram
    participant B as Browser
    participant MW as Next.js Middleware
    participant RC as Redis Cache
    participant PG as PostgreSQL

    B->>MW: GET https://acme.app.com/dashboard
    MW->>MW: Extract subdomain: 'acme'
    MW->>RC: GET tenant:subdomain:acme
    
    alt Cache HIT
        RC-->>MW: {id, name, branding, is_active}
        MW->>MW: Bind tenant context
    else Cache MISS
        RC-->>MW: nil
        MW->>PG: SELECT * FROM tenants WHERE subdomain='acme'
        PG-->>MW: Tenant record
        MW->>RC: SET tenant:subdomain:acme {...} EX 300
        MW->>MW: Bind tenant context
    end

    MW->>MW: Validate JWT tenant_id matches resolved tenant
    MW-->>B: Forward request with X-Tenant-ID header
```

---

## 7. Milestone-by-Milestone Implementation Plan

### Milestone 1: The Multi-Tenant Control Plane

**Goal**: Establish bulletproof tenancy isolation at routing and database layers.

**Deliverables**:
- PostgreSQL schema with RLS policies active
- Next.js middleware with subdomain routing
- JWT auth with tenant claims
- Basic CRUD for tenants, users, vehicles, jobs
- Branded login page per tenant

**Development Tasks**:
1. Init PostgreSQL with TimescaleDB and UUID extensions
2. Write and apply all schema migrations (Alembic)
3. Implement RLS policies and `app_user` role
4. Build FastAPI auth domain (login, refresh, logout)
5. Implement AsyncLocalStorage tenant context propagation
6. Build Next.js middleware with Redis-cached tenant lookup
7. Build login page with `useTenantBranding` hook (reads CSS vars from tenant config)
8. Write repository layer for all core entities (RLS-aware)
9. Build admin pages for tenant/user management

**Risks**:
- RLS misconfiguration can silently expose data — requires explicit security tests per endpoint
- Redis unavailability could block all tenant lookups — implement Postgres fallback with aggressive caching

**Testing Strategy**:
- Unit: JWT generation/validation, subdomain extraction logic
- Integration: Create two test tenants, verify query from Tenant A never returns Tenant B data
- Security: Attempt cross-tenant API calls with valid-but-wrong-tenant JWTs → expect 403

**Definition of Done**:
- [ ] Two browser windows on different subdomains see isolated data
- [ ] RLS blocks all cross-tenant queries at DB level
- [ ] Login page renders correct branding per subdomain
- [ ] All CRUD APIs require valid tenant-scoped JWT

---

### Milestone 2: The Driver's Offline-First PWA

**Goal**: Driver app functions with zero connectivity.

**Deliverables**:
- Vite/React PWA installable on mobile
- Workbox service worker with cache strategies
- IndexedDB schema (jobs_cache, mutations_queue)
- Background Sync with offline queue drain
- Conflict resolution algorithm on backend

**Development Tasks**:
1. Scaffold Vite React app with PWA plugin
2. Configure Workbox with CacheFirst (static) + NetworkFirst (routes/jobs)
3. Install Dexie.js, define IndexedDB schema
4. Build job list and detail screens (read from IndexedDB when offline)
5. Intercept `fetch` calls in service worker — write to mutations_queue when offline
6. Implement sync event handler that drains queue on connectivity restore
7. Build conflict resolution endpoint on monolith (`PATCH /jobs/{id}/sync`)
8. Implement LWW algorithm using `client_updated_at` vs `server_updated_at`

**Risks**:
- iOS Safari Service Worker limitations (limited Background Sync support) — fallback to `visibilitychange` event polling
- IndexedDB quota limits on low-end Android devices — implement LRU eviction for old completed jobs
- Sync ordering: mutations_queue must drain in chronological order to avoid re-applying stale state

**Testing Strategy**:
- Offline: Load app, disconnect network (Chrome DevTools offline mode), perform job status updates, reconnect, verify server state
- Conflict: Simulate dispatcher editing a job online while driver has it cached offline, verify LWW resolves correctly
- iOS: Test background sync fallback on Safari

**Definition of Done**:
- [ ] App is installable (passes PWA audit)
- [ ] Job list renders from IndexedDB when network is offline
- [ ] All offline mutations replay correctly on reconnection
- [ ] Conflict resolution preserves most recent valid state

---

### Milestone 3: High-Throughput IoT Ingestion

**Goal**: Decouple telemetry from core business operations.

**Deliverables**:
- Kafka cluster (Docker)
- Telemetry ingestion endpoint (202 pattern)
- Kafka consumer with Redis GeoHash writer
- Batch PostgreSQL inserter (5–10s windows)

**Development Tasks**:
1. Add Kafka + Zookeeper to Docker Compose
2. Create `telemetry.raw` topic (10 partitions for parallelism)
3. Build Go telemetry ingestion service (chi router + confluent-kafka-go)
4. Kafka producer with async publish (no blocking on ACK)
5. Kafka consumer group reading `telemetry.raw`
6. Redis `GEOADD` writer for latest position cache
7. In-memory ring buffer + ticker-based batch INSERT to PostgreSQL
8. Dead letter queue for malformed messages (`telemetry.dead`)

**Risks**:
- Kafka single-node failure in dev → use `min.insync.replicas=1` for dev, `2` for prod
- Consumer lag can grow under heavy load → monitor via `kafka-consumer-groups --describe`
- Batch INSERT failure loses buffered data → use write-ahead local file buffer as fallback

**Testing Strategy**:
- Load: Fire 10,000 telemetry events, verify all land in PostgreSQL within 15s
- Isolation: Run telemetry flood simultaneously with business API calls, verify P99 latency of business API < 200ms

**Definition of Done**:
- [ ] Ingestion endpoint returns 202 within 50ms under load
- [ ] All telemetry events visible in PostgreSQL within 10s
- [ ] Redis GeoHash reflects latest position within 2s of vehicle transmit

---

### Milestone 4: Real-Time Streaming & UI Optimization

**Goal**: Sub-second dashboard updates with no UI lag.

**Deliverables**:
- WebSocket hub with tenant channel isolation
- Kafka→Redis→WebSocket pipeline
- Mapbox/Leaflet fleet map with WebGL rendering
- Throttled coordinate updates (500ms)

**Development Tasks**:
1. Build WebSocket hub in FastAPI (or Go) with per-tenant connection pools
2. Subscribe hub to Redis Pub/Sub `pubsub:tenant:{id}` channels
3. On JWT validate on upgrade, join correct tenant pool
4. Consumer publishes to Redis on each processed telemetry event
5. Build `FleetMap` React component using Mapbox GL JS
6. Implement `useVehicleStream` hook with throttle (lodash.throttle, 500ms)
7. Use Mapbox GeoJSON source + symbol layer (WebGL) instead of DOM markers
8. Implement reconnect logic (exponential backoff, max 5 retries)

**Risks**:
- WebSocket server becomes a bottleneck at 10,000 connections → plan to extract to dedicated service
- Memory leaks from stale connections → implement heartbeat ping/pong with 30s timeout cleanup
- Mapbox API key exposure — must be restricted to specific domains in Mapbox dashboard

**Testing Strategy**:
- Load: 500 concurrent WebSocket connections subscribed to same tenant, verify all receive updates
- Performance: Chrome DevTools Performance profiler — map frame rate must stay > 30fps during flood
- Reconnect: Kill WebSocket server, verify all clients reconnect within 30s

**Definition of Done**:
- [ ] Map markers update within 1s of vehicle transmitting new coordinates
- [ ] 500 concurrent connections stable for 10 minutes under load
- [ ] Frame rate stays above 30fps during telemetry flood

---

### Milestone 5: The Strangler Fig Architecture

**Goal**: Extract telemetry into isolated, independently scalable microservice.

**Deliverables**:
- Standalone Go telemetry microservice
- Updated Nginx routing rules
- Monolith no longer handles any telemetry traffic
- API contract documentation between services

**Development Tasks**:
1. Extract ingestion handler + Kafka producer from monolith (if started there) into Go service
2. Move consumer worker into same Go process (separate goroutine)
3. Define OpenAPI spec for telemetry service endpoints
4. Update Nginx `upstream` blocks to separate pools
5. Configure health checks for both services independently
6. Feature flag rollout: route 10% → 50% → 100% telemetry traffic to new service
7. Remove telemetry code from monolith after 100% migration
8. Implement circuit breaker (Sony Gobreaker) in Go service for Redis/Kafka unavailability

**Risks**:
- Network latency introduced between services → measure with distributed tracing
- Duplicate message processing during cutover → use idempotency keys on Kafka messages
- Rollback: Nginx feature flag can instantly redirect traffic back to monolith

**Testing Strategy**:
- Contract: Ensure Go service accepts same payload schema as monolith previously did
- Shadow traffic: Run both services in parallel, compare outputs
- Chaos: Kill Go service, verify Nginx health check routes to fallback within 5s

**Definition of Done**:
- [ ] All telemetry traffic handled by Go service
- [ ] Monolith P99 latency unchanged or improved post-extraction
- [ ] Nginx routes correctly by path prefix
- [ ] Circuit breaker trips and recovers correctly under chaos testing

---

### Milestone 6: Platform Engineering & Validation

**Goal**: Containerise, automate CI/CD, and stress-test the full distributed platform.

**Deliverables**:
- Multi-stage Dockerfiles for all services
- Master `docker-compose.yml`
- GitHub Actions CI/CD workflows
- K6 load test with proof of architecture correctness

**Development Tasks**:
1. Write multi-stage Dockerfiles (builder → runtime) for monolith and telemetry service
2. Write optimised `docker-compose.yml` with health checks, dependency ordering, named volumes
3. Implement secret injection via Docker secrets / `.env` files (never hardcoded)
4. Write GitHub Actions `ci.yml` (lint + test on every PR)
5. Write `build.yml` (build + push images to GHCR on `main`)
6. Write `deploy.yml` (deploy to staging → smoke test → promote)
7. Write K6 `telemetry-flood.js` (1,000+ concurrent virtual users to telemetry endpoint)
8. Write K6 `business-api.js` (run simultaneously against monolith)
9. Analyse results: prove telemetry flood does not degrade business API P99

**Risks**:
- Docker image build time growth → use layer caching in GitHub Actions
- Secrets in CI → use GitHub Encrypted Secrets, never env vars in workflow YAML
- Load test environment !== production → document environment assumptions

**Testing Strategy**:
- Run full K6 mixed scenario, assert: telemetry throughput > 1,000 req/s, business API P99 < 300ms simultaneously

**Definition of Done**:
- [ ] `docker compose up` brings up full stack in < 3 minutes
- [ ] CI pipeline runs green on all PRs
- [ ] K6 report shows telemetry flood does not push business API P99 above 300ms
- [ ] All Dockerfiles use non-root users, multi-stage builds

---

## 8. Offline-First PWA Design

### 8.1 Service Worker Architecture

```javascript
// apps/driver-pwa/src/sw.ts (Workbox)
import { registerRoute, Route } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';
import { BackgroundSyncPlugin } from 'workbox-background-sync';

const CACHE_VERSION = 'v1';

// STRATEGY 1: CacheFirst for static assets
// Rationale: Static JS/CSS/HTML never changes without a new deploy
registerRoute(
    ({ request }) => request.destination === 'script'
        || request.destination === 'style'
        || request.destination === 'document',
    new CacheFirst({
        cacheName: `static-assets-${CACHE_VERSION}`,
        plugins: [
            new ExpirationPlugin({ maxAgeSeconds: 7 * 24 * 60 * 60 })
        ]
    })
);

// STRATEGY 2: NetworkFirst for job data
// Rationale: Jobs must be fresh when online; IndexedDB is the true offline store
registerRoute(
    ({ url }) => url.pathname.startsWith('/api/v1/jobs'),
    new NetworkFirst({
        cacheName: `api-jobs-${CACHE_VERSION}`,
        networkTimeoutSeconds: 3,
        plugins: [
            new ExpirationPlugin({ maxAgeSeconds: 60 * 60 }) // 1h
        ]
    })
);

// STRATEGY 3: Background Sync for mutations
const mutationQueue = new BackgroundSyncPlugin('mutations-queue', {
    maxRetentionTime: 72 * 60, // 72 hours in minutes
});

registerRoute(
    ({ url, request }) => url.pathname.startsWith('/api/v1/jobs')
        && ['POST', 'PATCH', 'PUT'].includes(request.method),
    new NetworkFirst({ plugins: [mutationQueue] }),
    'POST'
);
```

### 8.2 IndexedDB Schema (Dexie.js)

```typescript
// apps/driver-pwa/src/db/index.ts
import Dexie, { Table } from 'dexie';

export interface CachedJob {
    id: string;
    tenant_id: string;
    title: string;
    status: string;
    scheduled_at: string;
    delivery_address: object;
    version: number;
    server_updated_at: string;
    synced_at: string;
}

export interface PendingMutation {
    id?: number;           // Auto-increment local ID
    tracking_uuid: string; // Client-generated UUID
    method: 'POST' | 'PATCH' | 'DELETE';
    endpoint: string;
    payload: object;
    client_timestamp: string;
    retry_count: number;
    created_at: string;
}

class FleetDB extends Dexie {
    jobs_cache!: Table<CachedJob, string>;
    mutations_queue!: Table<PendingMutation, number>;

    constructor() {
        super('FleetPlatformDB');
        this.version(1).stores({
            jobs_cache:       'id, tenant_id, status, scheduled_at, synced_at',
            mutations_queue:  '++id, tracking_uuid, created_at, retry_count'
        });
    }
}

export const db = new FleetDB();
```

### 8.3 Background Sync & Mutation Drain

```typescript
// apps/driver-pwa/src/sync/background-sync.ts

export async function drainMutationsQueue(authToken: string): Promise<void> {
    const pending = await db.mutations_queue
        .orderBy('created_at')
        .toArray();

    for (const mutation of pending) {
        try {
            const response = await fetch(mutation.endpoint, {
                method:  mutation.method,
                headers: {
                    'Authorization': `Bearer ${authToken}`,
                    'Content-Type':  'application/json',
                    'X-Tracking-UUID': mutation.tracking_uuid,  // Idempotency key
                },
                body: JSON.stringify(mutation.payload),
            });

            if (response.ok || response.status === 409) {
                // 409 = server handled conflict → still remove from queue
                await db.mutations_queue.delete(mutation.id!);
            } else if (response.status >= 500) {
                // Server error — increment retry, leave in queue
                await db.mutations_queue.update(mutation.id!, {
                    retry_count: mutation.retry_count + 1
                });
            }
        } catch (networkError) {
            // Network still unavailable — stop draining, try again later
            break;
        }
    }
}
```

### 8.4 Conflict Resolution: Last Write Wins vs State Merge

| Strategy | Description | Pros | Cons |
|---|---|---|---|
| **Last Write Wins (LWW)** | The operation with the more recent `client_updated_at` timestamp wins | Simple to implement, predictable | Clock skew on device can cause wrong winner; data loss possible |
| **State Merge** | Merge field-by-field: take the latest value per individual field | Preserves more data, granular | Complex to implement, requires field-level conflict tracking |

**Recommendation**: **Hybrid LWW with field-level granularity**

```python
# services/monolith/app/domains/jobs/service.py

async def sync_job_from_driver(
    job_id: UUID,
    driver_update: JobSyncSchema,
    current_server_state: Job,
    tenant_id: UUID,
) -> Job:
    """
    LWW per field with server as authority for specific fields.
    
    Rules:
    - status: Driver wins only if client_updated_at > server_updated_at
    - metadata (signatures, barcodes): MERGE — never overwrite, append
    - completed_at: Server-generated on 'completed' transition
    - route/address: Server (dispatcher) always wins — driver cannot change route
    """
    
    server_ts = current_server_state.server_updated_at
    client_ts = driver_update.client_updated_at

    merged = {}

    # Status: LWW — driver wins only if more recent
    if client_ts > server_ts:
        merged['status'] = driver_update.status
        merged['client_updated_at'] = client_ts
        merged['server_updated_at'] = datetime.utcnow()
    
    # Metadata: always merge (union of keys)
    existing_meta = current_server_state.metadata or {}
    new_meta = driver_update.metadata or {}
    merged['metadata'] = {**existing_meta, **new_meta}

    if driver_update.status == 'completed' and merged.get('status') == 'completed':
        merged['completed_at'] = datetime.utcnow()

    return await job_repository.update(job_id, merged, tenant_id)
```

### 8.5 Offline Data Flow

```mermaid
flowchart TD
    A[Driver opens app] --> B{Network available?}
    B -- Yes --> C[Fetch jobs from API]
    C --> D[Store in IndexedDB jobs_cache]
    D --> E[Render job list]
    B -- No --> F[Load from IndexedDB jobs_cache]
    F --> E

    E --> G[Driver taps 'Mark Complete']
    G --> H{Online?}
    H -- Yes --> I[POST /api/v1/jobs/:id → 200 OK]
    I --> J[Update IndexedDB]
    H -- No --> K[Write to mutations_queue with UUID + timestamp]
    K --> L[Show 'Queued for sync' badge]

    M[Service Worker detects online] --> N[Background Sync fires]
    N --> O[Drain mutations_queue chronologically]
    O --> P{Server responds 200/409?}
    P -- Yes --> Q[Remove from queue, update cache]
    P -- 409 Conflict --> R[Apply server conflict resolution]
    R --> Q
    P -- 5xx --> S[Increment retry_count, leave in queue]
```

---

## 9. Event-Driven Architecture Design

### 9.1 Kafka Topic Design

| Topic | Partitions | Retention | Description |
|---|---|---|---|
| `telemetry.raw` | 24 (scale with vehicle count) | 7 days | Raw incoming telemetry from all vehicles |
| `telemetry.processed` | 12 | 24 hours | Validated, enriched telemetry (post-consumer) |
| `telemetry.dead` | 3 | 30 days | Malformed or unprocessable messages |
| `jobs.events` | 6 | 30 days | Job state transition events for audit/analytics |
| `notifications.dispatch` | 6 | 24 hours | Push notifications to drivers |

**Partition strategy**: Partition `telemetry.raw` by `vehicle_id` hash — ensures all events for a single vehicle are processed in order by the same consumer.

### 9.2 Message Schema

```json
// telemetry.raw message (Avro or JSON)
{
  "schema_version": "1.0",
  "message_id": "uuid-idempotency-key",
  "tenant_id": "a1b2c3d4-...",
  "vehicle_id": "v9z8y7x6-...",
  "device_id": "iot-device-001",
  "latitude": 51.5074,
  "longitude": -0.1278,
  "speed": 45.2,
  "heading": 127.0,
  "battery_level": 0.87,
  "engine_on": true,
  "timestamp": "2026-06-24T15:30:00.000Z",
  "received_at": "2026-06-24T15:30:00.050Z"
}
```

### 9.3 Full Message Flow

```mermaid
graph LR
    subgraph Vehicle
        V[IoT Device]
    end

    subgraph API Gateway
        GW[Nginx]
    end

    subgraph Telemetry Service
        ING[Ingestion Handler]
        PROD[Kafka Producer]
        CON[Consumer Worker]
    end

    subgraph Message Broker
        KF[(Kafka<br/>telemetry.raw)]
        DLQ[(Kafka<br/>telemetry.dead)]
    end

    subgraph Cache Layer
        RD[(Redis<br/>GeoHash + PubSub)]
    end

    subgraph Database
        PG[(PostgreSQL<br/>telemetry_events)]
    end

    subgraph Dashboard
        WS[WebSocket Hub]
        UI[Dispatcher Map]
    end

    V -->|POST /telemetry JWT| GW
    GW --> ING
    ING -->|Validate| PROD
    ING -->|Invalid| DLQ
    PROD -->|Produce| KF
    ING -->|202 Accepted| GW
    GW -->|202| V

    KF -->|Consume| CON
    CON -->|GEOADD + PUBLISH| RD
    CON -->|Batch INSERT 5-10s| PG
    CON -->|Unprocessable| DLQ

    RD -->|PubSub Message| WS
    WS -->|Push tenant channel| UI
    UI -->|Throttle 500ms| UI
```

### 9.4 Redis Pub/Sub Integration

```python
# WebSocket hub subscribes to Redis channels on connection upgrade
# services/monolith/app/websocket/hub.py

import aioredis
import asyncio
from collections import defaultdict

class TenantWebSocketHub:
    def __init__(self, redis_url: str):
        self.redis = aioredis.from_url(redis_url)
        self.connections: dict[str, set] = defaultdict(set)

    async def connect(self, websocket, tenant_id: str):
        self.connections[tenant_id].add(websocket)
        await websocket.accept()

    async def disconnect(self, websocket, tenant_id: str):
        self.connections[tenant_id].discard(websocket)

    async def subscribe_to_redis(self):
        """Long-running task: forward Redis pubsub messages to WebSocket clients."""
        pubsub = self.redis.pubsub()
        await pubsub.psubscribe('pubsub:tenant:*')

        async for message in pubsub.listen():
            if message['type'] == 'pmessage':
                # Extract tenant_id from channel name
                channel = message['channel'].decode()
                tenant_id = channel.split(':')[-1]
                data = message['data']

                # Broadcast to all connected clients of this tenant
                dead = set()
                for ws in self.connections.get(tenant_id, set()):
                    try:
                        await ws.send_text(data)
                    except Exception:
                        dead.add(ws)
                self.connections[tenant_id] -= dead
```

---

## 10. Telemetry Pipeline Design

### 10.1 Full Pipeline Stages

```mermaid
flowchart TD
    A[IoT Device sends POST] --> B[Nginx Gateway<br/>Rate limit: 100 req/s per device]
    B --> C[Go Ingestion Handler]
    C --> D{Validate Payload}
    D -- Invalid --> E[Return 400 Bad Request]
    D -- Valid --> F[Extract tenant from JWT]
    F --> G[Kafka Producer.Produce async]
    G --> H[Return 202 Accepted immediately]

    G --> I[(Kafka telemetry.raw)]
    I --> J[Consumer Group Worker]
    J --> K{Parse & Enrich}
    K -- Malformed --> L[(Kafka telemetry.dead)]
    K -- Valid --> M[Redis GEOADD + PUBLISH]
    M --> N[In-Memory Ring Buffer]
    N --> O{Buffer Full OR 10s elapsed?}
    O -- No --> N
    O -- Yes --> P[Batch INSERT to PostgreSQL]
    P --> Q{Insert Success?}
    Q -- Yes --> R[Clear buffer]
    Q -- No --> S[Retry 3x with backoff]
    S --> T{Still failing?}
    T -- Yes --> U[Write buffer to local file WAL]
    T -- No --> R
```

### 10.2 Go Consumer Implementation Pattern

```go
// services/telemetry/internal/kafka/consumer.go

type TelemetryConsumer struct {
    consumer      *kafka.Consumer
    redisClient   *redis.Client
    pgWriter      *BatchWriter
    buffer        []TelemetryEvent
    bufferMu      sync.Mutex
    flushInterval time.Duration
    batchSize     int
}

func (c *TelemetryConsumer) Start(ctx context.Context) {
    // Start batch flush ticker
    ticker := time.NewTicker(c.flushInterval) // 5-10 seconds
    defer ticker.Stop()

    go func() {
        for {
            select {
            case <-ticker.C:
                c.flushBuffer(ctx)
            case <-ctx.Done():
                c.flushBuffer(ctx) // Final flush on shutdown
                return
            }
        }
    }()

    for {
        msg, err := c.consumer.ReadMessage(100 * time.Millisecond)
        if err != nil { continue }

        var event TelemetryEvent
        if err := json.Unmarshal(msg.Value, &event); err != nil {
            c.publishToDLQ(msg) // Dead letter queue
            continue
        }

        // 1. Hot cache write (synchronous, fast)
        c.redisClient.GeoAdd(ctx,
            fmt.Sprintf("tenant:%s:vehicles", event.TenantID),
            &redis.GeoLocation{
                Name:      event.VehicleID,
                Longitude: event.Longitude,
                Latitude:  event.Latitude,
            },
        )

        // 2. Pub/Sub broadcast to WebSocket hub
        payload, _ := json.Marshal(event)
        c.redisClient.Publish(ctx,
            fmt.Sprintf("pubsub:tenant:%s", event.TenantID),
            payload,
        )

        // 3. Buffer for batch PostgreSQL write
        c.bufferMu.Lock()
        c.buffer = append(c.buffer, event)
        shouldFlush := len(c.buffer) >= c.batchSize
        c.bufferMu.Unlock()

        if shouldFlush {
            c.flushBuffer(ctx)
        }

        c.consumer.CommitMessage(msg)
    }
}

func (c *TelemetryConsumer) flushBuffer(ctx context.Context) {
    c.bufferMu.Lock()
    batch := c.buffer
    c.buffer = make([]TelemetryEvent, 0, c.batchSize)
    c.bufferMu.Unlock()

    if len(batch) == 0 { return }

    if err := c.pgWriter.BatchInsert(ctx, batch); err != nil {
        // Retry with exponential backoff
        for attempt := 1; attempt <= 3; attempt++ {
            time.Sleep(time.Duration(attempt*attempt) * time.Second)
            if err = c.pgWriter.BatchInsert(ctx, batch); err == nil {
                return
            }
        }
        // Write to WAL file as last resort
        c.writeToWAL(batch)
    }
}
```

### 10.3 Dead Letter Queue Strategy

```
telemetry.dead message envelope:
{
  "original_message": { ...raw kafka message bytes... },
  "failure_reason": "JSON parse error: unexpected character at position 42",
  "failure_timestamp": "2026-06-24T15:30:05Z",
  "consumer_group": "telemetry-consumer-v1",
  "partition": 7,
  "offset": 1048576,
  "retry_count": 0
}
```

**DLQ Processing**: A separate low-priority consumer monitors `telemetry.dead`. Operations team can inspect, fix, and replay messages. Automated retry logic re-publishes to `telemetry.raw` after manual approval for critical data recovery scenarios.

### 10.4 Scaling Considerations

| Dimension | Current (MVP) | Target Scale |
|---|---|---|
| Kafka partitions `telemetry.raw` | 10 | 24–48 |
| Consumer instances | 1 | 12–24 (match partition count) |
| Batch insert size | 100–500 events | 1,000–5,000 events |
| Flush interval | 10 seconds | 5 seconds |
| Redis cluster | Standalone | Redis Cluster (3 master + 3 replica) |
| PostgreSQL | Single node | TimescaleDB multi-node or Citus |

---

## 11. Real-Time Dashboard Architecture

### 11.1 WebSocket vs SSE Comparison

| Aspect | WebSocket | Server-Sent Events (SSE) |
|---|---|---|
| Direction | Full duplex | Server → Client only |
| Browser support | Universal | Universal (IE11 excluded) |
| HTTP/2 compatibility | Requires upgrade | Native |
| Reconnect | Manual implementation | Browser-native auto-reconnect |
| Firewall friendliness | Can be blocked | HTTP-based, rarely blocked |
| Complexity | Higher | Lower |
| Use case fit | Bidirectional (chat, control) | Push-only (telemetry feed) |

**Recommendation**: **WebSocket** — Dispatchers may need to send commands back through the same connection in future (e.g., "send message to driver"). The bidirectionality investment is worth it. Implement SSE as a fallback for environments where WebSocket is blocked.

### 11.2 WebSocket Connection Lifecycle

```mermaid
stateDiagram-v2
    [*] --> Connecting: Dashboard loads, initiates WSS
    Connecting --> Authenticating: Connection established
    Authenticating --> Connected: JWT validated, tenant pool joined
    Authenticating --> Closed: Invalid JWT → close(4001)
    Connected --> Receiving: Server broadcasts telemetry
    Receiving --> Connected: Message processed
    Connected --> Reconnecting: Connection lost (network)
    Reconnecting --> Connecting: Exponential backoff retry (1s, 2s, 4s, 8s, max 30s)
    Connected --> Closed: User navigates away
    Closed --> [*]
```

### 11.3 Mapbox vs Leaflet Comparison

| Aspect | Mapbox GL JS | Leaflet |
|---|---|---|
| Rendering | WebGL (60fps at 10,000+ markers) | DOM/SVG (degrades at 1,000+ markers) |
| Performance at scale | Excellent | Poor above 1,000 vehicles |
| Custom vector tiles | Yes, native | Requires plugins |
| Offline maps | Paid SDK feature | Plugin-based |
| Cost | Usage-based (free tier generous) | Completely free |
| Bundle size | ~700KB | ~40KB |
| TypeScript support | Excellent | Good |

**Recommendation**: **Mapbox GL JS** — At 10,000+ vehicles, WebGL rendering is non-negotiable. DOM/SVG-based Leaflet would create significant jank. The cost is justified for enterprise B2B pricing.

### 11.4 Map Rendering Optimization

```typescript
// apps/web/src/components/map/FleetMap.tsx
import mapboxgl from 'mapbox-gl';
import { throttle } from 'lodash';

// Vehicle positions stored as GeoJSON FeatureCollection
let vehicleData: GeoJSON.FeatureCollection = {
    type: 'FeatureCollection',
    features: []
};

// Throttled state updater — prevents React re-render on every WebSocket message
const updateMapThrottled = throttle((map: mapboxgl.Map, updates: VehiclePosition[]) => {
    updates.forEach(pos => {
        const existing = vehicleData.features.find(
            f => f.properties?.vehicle_id === pos.vehicle_id
        );
        if (existing && existing.geometry.type === 'Point') {
            existing.geometry.coordinates = [pos.longitude, pos.latitude];
            existing.properties!.speed = pos.speed;
        } else {
            vehicleData.features.push({
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [pos.longitude, pos.latitude] },
                properties: { vehicle_id: pos.vehicle_id, speed: pos.speed }
            });
        }
    });

    // Single source update — Mapbox batches into one WebGL draw call
    (map.getSource('vehicles') as mapboxgl.GeoJSONSource).setData(vehicleData);
}, 500); // 500ms throttle
```

---

## 12. Microservice Extraction Strategy (Strangler Fig)

### 12.1 The Strangler Fig Pattern

The **Strangler Fig** pattern allows extracting functionality from a monolith incrementally by:
1. Building the new service in parallel
2. Routing a percentage of traffic to the new service via the API gateway
3. Gradually increasing the percentage
4. Decommissioning the monolith implementation when 100% migrated

```mermaid
gantt
    title Telemetry Service Extraction Timeline
    dateFormat YYYY-MM-DD
    section Preparation
    Build Go service (parallel)     :a1, 2026-08-01, 14d
    Write contract tests            :a2, 2026-08-01, 7d
    section Shadow Mode
    Route 0% to Go, log comparison  :b1, 2026-08-15, 7d
    Fix discrepancies               :b2, 2026-08-22, 5d
    section Gradual Rollout
    Route 10% to Go service         :c1, 2026-08-27, 3d
    Route 50% to Go service         :c2, 2026-08-30, 3d
    Route 100% to Go service        :c3, 2026-09-02, 3d
    section Cleanup
    Remove monolith telemetry code  :d1, 2026-09-05, 5d
    Archive old tests               :d2, 2026-09-10, 2d
```

### 12.2 Nginx Routing Configuration

```nginx
# infra/docker/nginx/conf.d/telemetry.conf

upstream monolith {
    server monolith:8000;
    keepalive 64;
}

upstream telemetry_service {
    server telemetry:8080;
    keepalive 128;
    # Higher keepalive for telemetry service (IoT devices send frequent requests)
}

server {
    listen 80;
    server_name *.app.com;

    # Telemetry microservice — isolated path
    location /api/v1/telemetry/ {
        proxy_pass         http://telemetry_service;
        proxy_set_header   X-Real-IP $remote_addr;
        proxy_set_header   X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_connect_timeout 5s;
        proxy_read_timeout    10s;

        # Rate limiting for IoT devices (per device IP)
        limit_req zone=telemetry_zone burst=50 nodelay;
    }

    # Core monolith — all other API routes
    location /api/v1/ {
        proxy_pass         http://monolith;
        proxy_set_header   Host $host;
        proxy_set_header   X-Tenant-Subdomain $subdomain;
    }

    # WebSocket upgrade
    location /ws/ {
        proxy_pass              http://monolith;
        proxy_http_version      1.1;
        proxy_set_header        Upgrade $http_upgrade;
        proxy_set_header        Connection "upgrade";
        proxy_read_timeout      86400s;  # 24h WebSocket keepalive
    }
}

# Rate limiting zones
limit_req_zone $binary_remote_addr zone=telemetry_zone:10m rate=100r/s;
```

### 12.3 Migration Risk & Rollback

| Risk | Mitigation | Rollback |
|---|---|---|
| Go service has bugs | Run in shadow mode first, compare outputs | Nginx weight `go_service weight=0` |
| Performance regression | Load test both services before cutover | Instant Nginx weight adjustment |
| Schema drift | Contract tests enforced in CI | Deploy previous Go image |
| Kafka producer incompatibility | Use same Avro schema registry | Revert producer config |

---

## 13. Security Architecture

### 13.1 Multi-Tenant Security Defence in Depth

```
Layer 1: Network — Nginx enforces HTTPS, blocks non-subdomain traffic
Layer 2: Middleware — Subdomain → tenant_id binding, JWT tenant claim validation
Layer 3: Application — Repository layer sets `app.current_tenant_id` per request
Layer 4: Database — RLS policies silently filter all queries
Layer 5: Audit — All data mutations logged to audit_logs with user and tenant context
```

### 13.2 OWASP Top 10 Mitigations

| OWASP Risk | Mitigation |
|---|---|
| **A01 Broken Access Control** | RLS + middleware tenant isolation + RBAC on every route |
| **A02 Cryptographic Failures** | RS256 JWT, bcrypt passwords (cost 12), TLS everywhere |
| **A03 Injection** | SQLAlchemy ORM parameterised queries, no string interpolation |
| **A04 Insecure Design** | Threat model per milestone, security review before merge |
| **A05 Security Misconfiguration** | Docker non-root users, no default credentials, secret rotation |
| **A06 Vulnerable Components** | Dependabot + `pip audit` + `go audit` in CI |
| **A07 Auth Failures** | httpOnly cookies, short JWT TTL, refresh rotation, jti blacklist |
| **A08 Software Integrity** | Docker image signing (cosign), pinned base image digests |
| **A09 Logging Failures** | Structured JSON audit logs, Loki aggregation, 90-day retention |
| **A10 SSRF** | No user-controlled URL fetching; strict allowlist for external calls |

### 13.3 Secrets Management

```yaml
# .github/workflows/deploy.yml — secrets injected at runtime
env:
  DATABASE_URL:      ${{ secrets.DATABASE_URL }}
  JWT_PRIVATE_KEY:   ${{ secrets.JWT_PRIVATE_KEY }}
  REDIS_URL:         ${{ secrets.REDIS_URL }}
  KAFKA_BROKERS:     ${{ secrets.KAFKA_BROKERS }}
  MAPBOX_TOKEN:      ${{ secrets.MAPBOX_TOKEN }}

# docker-compose.prod.yml — secrets via Docker secrets (file-based)
secrets:
  db_password:
    file: ./secrets/db_password.txt
  jwt_key:
    file: ./secrets/jwt_private_key.pem
```

**Production Recommendation**: Migrate to HashiCorp Vault or AWS Secrets Manager for dynamic secret rotation without redeployment.

### 13.4 Rate Limiting Strategy

```nginx
# Nginx rate limit zones
limit_req_zone $binary_remote_addr zone=api_zone:10m      rate=60r/m;   # Business API
limit_req_zone $binary_remote_addr zone=auth_zone:1m      rate=5r/m;    # Login endpoint
limit_req_zone $binary_remote_addr zone=telemetry_zone:10m rate=100r/s; # IoT telemetry
```

```python
# Application-level rate limiting via Redis (sliding window)
# Protects against distributed attacks that bypass Nginx
import redis.asyncio as redis

async def check_rate_limit(user_id: str, window: int = 60, limit: int = 100):
    key = f"rate:{user_id}:{int(time.time() // window)}"
    count = await redis_client.incr(key)
    if count == 1:
        await redis_client.expire(key, window * 2)
    if count > limit:
        raise HTTPException(status_code=429, detail="Too many requests")
```

---

## 14. DevOps & CI/CD Design

### 14.1 Docker Architecture

```dockerfile
# services/monolith/Dockerfile — Multi-stage build
FROM python:3.12-slim AS builder
WORKDIR /build
COPY requirements.txt .
RUN pip install --no-cache-dir --prefix=/install -r requirements.txt

FROM python:3.12-slim AS runtime
# Security: run as non-root
RUN groupadd -r appuser && useradd -r -g appuser appuser
WORKDIR /app
COPY --from=builder /install /usr/local
COPY --chown=appuser:appuser app/ ./app/
USER appuser
EXPOSE 8000
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "4"]
```

```dockerfile
# services/telemetry/Dockerfile — Go multi-stage
FROM golang:1.22-alpine AS builder
WORKDIR /build
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 GOOS=linux go build -ldflags="-w -s" -o telemetry-service ./cmd/server

FROM gcr.io/distroless/static:nonroot AS runtime
COPY --from=builder /build/telemetry-service /telemetry-service
EXPOSE 8080
ENTRYPOINT ["/telemetry-service"]
```

### 14.2 Docker Compose

```yaml
# infra/docker/docker-compose.yml
version: '3.9'

services:
  postgres:
    image: timescale/timescaledb:latest-pg16
    environment:
      POSTGRES_DB: fleetdb
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init.sql:/docker-entrypoint-initdb.d/init.sql:ro
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    ports: ["5432:5432"]

  redis:
    image: redis:7-alpine
    command: redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "-a", "${REDIS_PASSWORD}", "ping"]
      interval: 10s
    ports: ["6379:6379"]

  zookeeper:
    image: confluentinc/cp-zookeeper:7.6.0
    environment:
      ZOOKEEPER_CLIENT_PORT: 2181
    volumes: [zookeeper_data:/var/lib/zookeeper/data]

  kafka:
    image: confluentinc/cp-kafka:7.6.0
    depends_on: [zookeeper]
    environment:
      KAFKA_BROKER_ID: 1
      KAFKA_ZOOKEEPER_CONNECT: zookeeper:2181
      KAFKA_ADVERTISED_LISTENERS: PLAINTEXT://kafka:9092
      KAFKA_AUTO_CREATE_TOPICS_ENABLE: 'false'
      KAFKA_LOG_RETENTION_HOURS: 168
    volumes: [kafka_data:/var/lib/kafka/data]
    ports: ["9092:9092"]

  monolith:
    build:
      context: ../../services/monolith
      dockerfile: Dockerfile
    depends_on:
      postgres: { condition: service_healthy }
      redis:    { condition: service_healthy }
      kafka:    { condition: service_started }
    environment:
      DATABASE_URL:  postgresql+asyncpg://app_user:${APP_DB_PASSWORD}@postgres:5432/fleetdb
      REDIS_URL:     redis://:${REDIS_PASSWORD}@redis:6379/0
      KAFKA_BROKERS: kafka:9092
      JWT_PRIVATE_KEY: ${JWT_PRIVATE_KEY}
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:8000/health"]
      interval: 30s

  telemetry:
    build:
      context: ../../services/telemetry
      dockerfile: Dockerfile
    depends_on: [kafka, redis, postgres]
    environment:
      KAFKA_BROKERS: kafka:9092
      REDIS_ADDR:    redis:6379
      REDIS_PASSWORD: ${REDIS_PASSWORD}
      DATABASE_URL:  postgres://app_user:${APP_DB_PASSWORD}@postgres:5432/fleetdb
    ports: ["8080:8080"]

  nginx:
    image: nginx:1.25-alpine
    depends_on: [monolith, telemetry]
    volumes:
      - ./nginx/nginx.conf:/etc/nginx/nginx.conf:ro
      - ./nginx/conf.d:/etc/nginx/conf.d:ro
    ports: ["80:80", "443:443"]

  prometheus:
    image: prom/prometheus:v2.51.0
    volumes: [./monitoring/prometheus/prometheus.yml:/etc/prometheus/prometheus.yml:ro]
    ports: ["9090:9090"]

  grafana:
    image: grafana/grafana:10.4.0
    depends_on: [prometheus]
    volumes: [grafana_data:/var/lib/grafana]
    ports: ["3001:3000"]

volumes:
  postgres_data:
  redis_data:
  kafka_data:
  zookeeper_data:
  grafana_data:
```

### 14.3 GitHub Actions CI/CD

```yaml
# .github/workflows/ci.yml
name: CI — Lint, Test, Build

on:
  pull_request:
    branches: [main, develop]

jobs:
  lint-monolith:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: services/monolith } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install ruff mypy
      - run: ruff check app/ && mypy app/

  test-monolith:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: timescale/timescaledb:latest-pg16
        env:
          POSTGRES_PASSWORD: testpass
          POSTGRES_DB: testdb
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-python@v5
        with: { python-version: '3.12' }
      - run: pip install -r requirements.txt pytest pytest-asyncio
        working-directory: services/monolith
      - run: pytest tests/ -v --cov=app --cov-report=xml
        working-directory: services/monolith
        env:
          DATABASE_URL: postgresql+asyncpg://postgres:testpass@localhost:5432/testdb

  lint-test-telemetry:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: services/telemetry } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-go@v5
        with: { go-version: '1.22' }
      - run: go vet ./...
      - run: go test ./... -race -coverprofile=coverage.out

  lint-test-web:
    runs-on: ubuntu-latest
    defaults: { run: { working-directory: apps/web } }
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '20' }
      - run: npm ci
      - run: npm run lint && npm run typecheck && npm run test

  build-images:
    needs: [lint-monolith, test-monolith, lint-test-telemetry, lint-test-web]
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main'
    steps:
      - uses: actions/checkout@v4
      - uses: docker/setup-buildx-action@v3
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - name: Build monolith
        uses: docker/build-push-action@v5
        with:
          context: services/monolith
          push: true
          tags: ghcr.io/${{ github.repository }}/monolith:${{ github.sha }}
          cache-from: type=gha
          cache-to: type=gha,mode=max
      - name: Build telemetry service
        uses: docker/build-push-action@v5
        with:
          context: services/telemetry
          push: true
          tags: ghcr.io/${{ github.repository }}/telemetry:${{ github.sha }}
```

---

## 15. Monitoring & Observability

### 15.1 Observability Stack

```mermaid
graph LR
    subgraph Services
        M[Monolith<br/>Python]
        T[Telemetry<br/>Go]
        N[Nginx]
        K[Kafka]
        PG[PostgreSQL]
        RD[Redis]
    end

    subgraph Collection
        OT[OpenTelemetry<br/>Collector]
        PA[Prometheus<br/>Scraper]
        LK[Loki<br/>Log Aggregator]
    end

    subgraph Visualisation
        GF[Grafana<br/>Dashboards + Alerts]
        JG[Jaeger<br/>Distributed Traces]
    end

    M -->|OTLP traces| OT
    M -->|/metrics| PA
    M -->|JSON logs| LK

    T -->|OTLP traces| OT
    T -->|/metrics| PA
    T -->|JSON logs| LK

    N -->|access logs| LK
    K -->|JMX metrics| PA
    PG -->|pg_stat| PA
    RD -->|INFO metrics| PA

    OT -->|Traces| JG
    PA --> GF
    LK --> GF
    GF -->|PagerDuty/Slack| ALERT[Alerts]
```

### 15.2 Key Metrics & Alerts

| Metric | Warning | Critical | Service |
|---|---|---|---|
| `telemetry_ingest_latency_p99` | > 100ms | > 500ms | Telemetry |
| `kafka_consumer_lag` | > 10,000 | > 100,000 | Telemetry |
| `business_api_latency_p99` | > 200ms | > 1,000ms | Monolith |
| `postgres_active_connections` | > 80% pool | > 95% pool | All |
| `redis_memory_used_percent` | > 70% | > 90% | Redis |
| `websocket_active_connections` | > 5,000 | > 9,000 | WebSocket |
| `error_rate_5xx` | > 0.1% | > 1% | All |

### 15.3 Structured Logging

```python
# Every log line is structured JSON
import structlog

logger = structlog.get_logger()

logger.info(
    "job.status_changed",
    tenant_id=str(tenant_id),
    job_id=str(job_id),
    old_status=old_status,
    new_status=new_status,
    user_id=str(user_id),
    request_id=request_id,  # Trace correlation ID
)
```

---

## 16. Testing Strategy

### 16.1 Test Pyramid

```
                    ┌─────────────┐
                    │  E2E Tests  │  ← Playwright (10–20 scenarios)
                  ┌─┴─────────────┴─┐
                  │ Integration Tests│  ← Pytest + TestContainers (100–200 tests)
                ┌─┴─────────────────┴─┐
                │    Contract Tests    │  ← Pact (service boundaries)
              ┌─┴─────────────────────┴─┐
              │      Unit Tests          │  ← Pytest, Go test, Vitest (1000+ tests)
              └──────────────────────────┘
```

### 16.2 Tenant Isolation Tests

```python
# services/monolith/tests/security/test_tenant_isolation.py

@pytest.mark.asyncio
async def test_tenant_a_cannot_see_tenant_b_jobs(async_client, db_session):
    """Critical security test: RLS must prevent cross-tenant data leakage."""
    
    # Create two tenants
    tenant_a = await create_tenant(db_session, subdomain="company-a")
    tenant_b = await create_tenant(db_session, subdomain="company-b")
    
    # Create a user and job for each tenant
    user_a = await create_user(db_session, tenant_id=tenant_a.id, role="dispatcher")
    user_b = await create_user(db_session, tenant_id=tenant_b.id, role="dispatcher")
    job_b  = await create_job(db_session, tenant_id=tenant_b.id, title="Secret Job B")
    
    # Authenticate as Tenant A's user
    token_a = create_jwt(user_id=user_a.id, tenant_id=tenant_a.id, role="dispatcher")
    
    # Attempt to access Tenant B's jobs
    response = await async_client.get(
        "/api/v1/jobs",
        headers={"Authorization": f"Bearer {token_a}"},
        headers_extra={"Host": "company-a.localhost"}
    )
    
    assert response.status_code == 200
    jobs = response.json()["data"]
    
    # CRITICAL ASSERTION: No jobs from Tenant B should appear
    job_ids = [j["id"] for j in jobs]
    assert str(job_b.id) not in job_ids, "SECURITY FAILURE: Cross-tenant data leakage detected!"
    assert len(jobs) == 0  # Tenant A has no jobs

@pytest.mark.asyncio
async def test_direct_job_id_access_cross_tenant_returns_404(async_client):
    """Attempt to access Tenant B's job using Tenant A's token and Tenant B's job ID."""
    ...
    # With RLS, the query returns 0 rows for the wrong tenant
    # Application raises 404 (not 403) to avoid leaking resource existence
    assert response.status_code == 404
```

### 16.3 Offline PWA Tests

```typescript
// apps/driver-pwa/src/tests/offline.test.ts
import { render, screen, waitFor } from '@testing-library/react';
import { db } from '../db';

describe('Offline job management', () => {
    beforeEach(async () => {
        // Seed IndexedDB with cached jobs
        await db.jobs_cache.bulkAdd([
            { id: 'job-1', title: 'Delivery to Warehouse A', status: 'assigned', ... },
            { id: 'job-2', title: 'Pickup from Depot B', status: 'pending', ... },
        ]);
    });

    it('renders job list from IndexedDB when offline', async () => {
        // Mock navigator.onLine = false
        Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
        
        render(<JobList />);
        
        await waitFor(() => {
            expect(screen.getByText('Delivery to Warehouse A')).toBeInTheDocument();
        });
        expect(screen.getByTestId('offline-banner')).toBeInTheDocument();
    });

    it('queues mutation to IndexedDB when offline status update attempted', async () => {
        Object.defineProperty(navigator, 'onLine', { value: false, writable: true });
        
        // Simulate marking job complete while offline
        await markJobComplete('job-1');
        
        const queue = await db.mutations_queue.toArray();
        expect(queue).toHaveLength(1);
        expect(queue[0].endpoint).toBe('/api/v1/jobs/job-1');
        expect(queue[0].payload.status).toBe('completed');
    });
});
```

---

## 17. Load Testing Strategy

### 17.1 K6 Test Scenarios

```javascript
// load-tests/k6/telemetry-flood.js
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const telemetryErrors    = new Counter('telemetry_errors');
const telemetryDuration  = new Trend('telemetry_duration', true);

export const options = {
    scenarios: {
        telemetry_flood: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: 200  },
                { duration: '2m',  target: 1000 },
                { duration: '5m',  target: 1000 },
                { duration: '30s', target: 0    },
            ],
        },
    },
    thresholds: {
        'http_req_duration{scenario:telemetry_flood}': ['p(99)<500'],
        'http_req_failed{scenario:telemetry_flood}':   ['rate<0.01'],
        'telemetry_errors': ['count<100'],
    },
};

export default function telemetryFlood() {
    const vehicleId = `vehicle-${__VU}-${__ITER % 100}`;
    const tenantJWT = __ENV.TENANT_JWT;

    const payload = JSON.stringify({
        vehicle_id:    vehicleId,
        latitude:      51.5074 + (Math.random() - 0.5) * 0.1,
        longitude:     -0.1278 + (Math.random() - 0.5) * 0.1,
        speed:         Math.random() * 120,
        battery_level: Math.random(),
        engine_on:     true,
        timestamp:     new Date().toISOString(),
    });

    const start = Date.now();
    const res = http.post(
        `${__ENV.TELEMETRY_URL}/api/v1/telemetry`,
        payload,
        {
            headers: {
                'Content-Type':  'application/json',
                'Authorization': `Bearer ${tenantJWT}`,
            },
            timeout: '10s',
        }
    );
    telemetryDuration.add(Date.now() - start);

    const ok = check(res, { 'status is 202': (r) => r.status === 202 });
    if (!ok) telemetryErrors.add(1);

    sleep(0.1); // 100ms between sends per virtual user
}
```

```javascript
// load-tests/k6/mixed-scenario.js — CRITICAL TEST
// Proves telemetry flood doesn't degrade business API
import { group } from 'k6';
import telemetryFlood from './telemetry-flood.js';
import businessApi    from './business-api.js';

export const options = {
    scenarios: {
        flood:    { executor: 'constant-vus', vus: 500, duration: '5m', exec: 'flood'    },
        business: { executor: 'constant-vus', vus: 50,  duration: '5m', exec: 'business' },
    },
    thresholds: {
        // Telemetry: high throughput OK
        'http_req_duration{scenario:flood}':    ['p(99)<500'],
        // Business API: MUST stay fast despite telemetry flood
        'http_req_duration{scenario:business}': ['p(99)<300'],
        'http_req_failed{scenario:business}':   ['rate<0.005'],
    },
};

export function flood()    { telemetryFlood(); }
export function business() { businessApi(); }
```

### 17.2 Success Thresholds

| Metric | Target |
|---|---|
| Telemetry P99 latency | < 500ms |
| Telemetry throughput | > 1,000 req/s sustained |
| Business API P99 (during flood) | < 300ms |
| Business API error rate (during flood) | < 0.5% |
| Kafka consumer lag (under load) | < 50,000 messages |
| WebSocket update delivery latency | < 2,000ms end-to-end |

---

## 18. API Design

### 18.1 Authentication API

```
POST /api/v1/auth/login
Content-Type: application/json

Request:
{
  "email": "dispatcher@acme.com",
  "password": "SecurePassword123!"
}

Response 200 OK:
{
  "message": "Login successful",
  "user": {
    "id": "3f9a2b1c-...",
    "email": "dispatcher@acme.com",
    "role": "dispatcher",
    "full_name": "Jane Smith",
    "tenant": { "id": "a1b2c3d4-...", "name": "ACME Logistics", "subdomain": "acme" }
  }
}
Set-Cookie: access_token=<JWT>; HttpOnly; Secure; SameSite=Strict; Max-Age=86400
Set-Cookie: refresh_token=<opaque>; HttpOnly; Secure; SameSite=Strict; Max-Age=604800

Response 401 Unauthorized:
{ "error": "invalid_credentials", "message": "Email or password is incorrect" }

Response 429 Too Many Requests:
{ "error": "rate_limited", "message": "Too many login attempts. Try again in 60 seconds." }

---

POST /api/v1/auth/refresh
(Uses refresh_token cookie automatically)

Response 200 OK:
{ "message": "Token refreshed" }
Set-Cookie: access_token=<new JWT>; ...

---

POST /api/v1/auth/logout

Response 200 OK:
{ "message": "Logged out successfully" }
Set-Cookie: access_token=; Max-Age=0
Set-Cookie: refresh_token=; Max-Age=0
```

### 18.2 Vehicles API

```
GET /api/v1/vehicles?status=en_route&page=1&per_page=20
Authorization: Bearer <JWT>

Response 200 OK:
{
  "data": [
    {
      "id": "v9z8y7x6-...",
      "registration": "AB12 CDE",
      "make": "Ford",
      "model": "Transit",
      "status": "en_route",
      "assigned_driver": {
        "id": "d1e2f3g4-...",
        "full_name": "John Driver"
      },
      "last_position": {
        "latitude": 51.5074,
        "longitude": -0.1278,
        "speed": 45.2,
        "recorded_at": "2026-06-24T15:30:00Z"
      }
    }
  ],
  "pagination": { "page": 1, "per_page": 20, "total": 87, "pages": 5 }
}

---

POST /api/v1/vehicles
Authorization: Bearer <JWT> (role: admin)

Request:
{
  "registration": "XY99 ZAB",
  "make": "Mercedes",
  "model": "Sprinter",
  "year": 2024
}

Response 201 Created:
{ "data": { "id": "...", "registration": "XY99 ZAB", ... } }

Response 409 Conflict:
{ "error": "duplicate_registration", "message": "Vehicle XY99 ZAB already exists in this tenant" }
```

### 18.3 Jobs API

```
GET /api/v1/jobs?status=pending&driver_id=<uuid>&page=1
Response: paginated job list (same pattern)

---

POST /api/v1/jobs
Request:
{
  "title": "Delivery to Customer #4521",
  "vehicle_id": "v9z8y7x6-...",
  "driver_id": "d1e2f3g4-...",
  "scheduled_at": "2026-06-25T09:00:00Z",
  "priority": 2,
  "delivery_address": {
    "street": "123 Main St",
    "city": "London",
    "latitude": 51.5200,
    "longitude": -0.1000
  }
}
Response 201 Created: { "data": { "id": "...", "status": "assigned", ... } }

---

PATCH /api/v1/jobs/{id}/sync    ← Offline sync endpoint
Authorization: Bearer <JWT>
X-Tracking-UUID: <client-generated-uuid>  ← Idempotency key

Request:
{
  "status": "completed",
  "client_updated_at": "2026-06-24T14:22:00Z",
  "metadata": {
    "signature_data_url": "data:image/png;base64,...",
    "barcode_scanned": "PKG-0001234"
  }
}

Response 200 OK: { "data": { ...resolved job state... } }
Response 409 Conflict:
{
  "error": "conflict_resolved",
  "message": "Server state was more recent. Dispatcher update applied.",
  "resolved_state": { ...winning state... }
}
```

### 18.4 Telemetry API

```
POST /api/v1/telemetry
Authorization: Bearer <JWT>  ← Device JWT, tenant-scoped

Request (minimal, size-optimised):
{
  "vehicle_id": "v9z8y7x6-...",
  "lat": 51.5074,
  "lng": -0.1278,
  "spd": 45.2,
  "bat": 0.87,
  "eng": true,
  "ts": "2026-06-24T15:30:00.000Z"
}

Response 202 Accepted:
{ "accepted": true }

Response 400 Bad Request:
{ "error": "validation_failed", "fields": ["lat: must be between -90 and 90"] }

Response 429 Too Many Requests:
{ "error": "rate_limited" }

---

GET /api/v1/vehicles/{id}/telemetry?from=2026-06-24T00:00:00Z&to=2026-06-24T23:59:59Z&interval=5m
Response:
{
  "data": [
    { "time": "2026-06-24T09:00:00Z", "lat": 51.51, "lng": -0.12, "speed": 32.0 },
    { "time": "2026-06-24T09:05:00Z", "lat": 51.52, "lng": -0.11, "speed": 0.0 },
    ...
  ]
}

---

GET /api/v1/fleet/positions
Authorization: Bearer <JWT>  ← Returns latest position for all tenant vehicles from Redis GeoHash
Response:
{
  "data": [
    { "vehicle_id": "v9z8y7x6-...", "lat": 51.5074, "lng": -0.1278, "updated_at": "2026-06-24T15:30:00Z" }
  ]
}
```

### 18.5 WebSocket Protocol

```
WSS /ws?token=<JWT>

Client → Server: PING every 30s
{ "type": "ping" }

Server → Client: PONG
{ "type": "pong" }

Server → Client: VEHICLE_POSITION_UPDATE (on telemetry event)
{
  "type": "vehicle.position",
  "data": {
    "vehicle_id": "v9z8y7x6-...",
    "latitude": 51.5074,
    "longitude": -0.1278,
    "speed": 45.2,
    "heading": 127.0,
    "timestamp": "2026-06-24T15:30:00.123Z"
  }
}

Server → Client: JOB_UPDATED (on job sync from driver)
{
  "type": "job.updated",
  "data": { "job_id": "...", "status": "completed", "updated_at": "..." }
}

Connection close codes:
4001 - Invalid or expired JWT
4002 - Tenant not found
4003 - Server shutting down (expect reconnect)
```

---

## 19. Development Roadmap

### 19.1 Team Composition

| Role | Count | Primary Responsibility |
|---|---|---|
| **Principal Architect** | 1 | Technical direction, system design, ADRs, code reviews |
| **Senior Backend Engineer** | 2 | Monolith (FastAPI), Go telemetry service, database design |
| **Senior Frontend Engineer** | 1 | Next.js dashboard, Mapbox integration, WebSocket client |
| **Mobile/PWA Engineer** | 1 | Driver PWA, Workbox, IndexedDB, offline-first patterns |
| **DevOps / Platform Engineer** | 1 | Docker, CI/CD, Kafka setup, monitoring, Nginx |
| **QA Engineer** | 1 | Test strategy, integration tests, load tests, security tests |

### 19.2 Timeline Estimates

```mermaid
gantt
    title Fleet Platform Development Timeline
    dateFormat  YYYY-MM-DD
    section Milestone 1 — Multi-Tenant Foundation
    DB Schema + RLS                :m1a, 2026-07-01, 7d
    FastAPI Core + Auth            :m1b, 2026-07-01, 14d
    Next.js Middleware + Dashboard :m1c, 2026-07-08, 14d
    M1 Integration Testing         :m1t, 2026-07-15, 7d

    section Milestone 2 — Driver PWA
    PWA Scaffold + Workbox         :m2a, 2026-07-22, 7d
    IndexedDB + Offline Queue      :m2b, 2026-07-22, 10d
    Background Sync + Conflict     :m2c, 2026-08-01, 10d
    M2 Testing (offline scenarios)  :m2t, 2026-08-11, 7d

    section Milestone 3 — Telemetry Pipeline
    Kafka Setup + Docker           :m3a, 2026-08-01, 5d
    Go Ingestion Service           :m3b, 2026-08-01, 14d
    Consumer + Redis + Batch DB    :m3c, 2026-08-10, 10d
    M3 Load Testing                :m3t, 2026-08-18, 7d

    section Milestone 4 — Real-Time Dashboard
    WebSocket Hub                  :m4a, 2026-08-18, 10d
    Mapbox Fleet Map               :m4b, 2026-08-18, 10d
    Performance Optimization       :m4c, 2026-08-25, 7d

    section Milestone 5 — Strangler Fig
    Telemetry Service Extraction   :m5a, 2026-09-01, 14d
    Nginx Routing + Shadow Traffic  :m5b, 2026-09-08, 7d
    Full Cutover + Cleanup         :m5c, 2026-09-15, 7d

    section Milestone 6 — Platform Engineering
    Multi-stage Dockerfiles        :m6a, 2026-09-01, 7d
    CI/CD GitHub Actions           :m6b, 2026-09-08, 7d
    K6 Load Tests + Proof          :m6c, 2026-09-15, 10d
    Security Hardening             :m6d, 2026-09-22, 7d

    section MVP Launch
    Staging Deployment             :mvp, 2026-09-29, 5d
    UAT + Bug Fixes                :uat, 2026-10-01, 14d
    Production Launch              :prod, 2026-10-15, 1d
```

| Phase | Duration | Team Size |
|---|---|---|
| **MVP** (M1–M3 complete) | ~10 weeks | 6 engineers |
| **Production-Ready** (all 6 milestones) | ~16 weeks | 7 engineers |
| **Enterprise Hardening** (Kubernetes, multi-region) | +8 weeks | 8 engineers |

---

## 20. Final Technical Review

### 20.1 Strengths

1. **Rock-solid tenant isolation** — Defence in depth: middleware + JWT claims + RLS. Three independent layers must all fail simultaneously for a breach. This is enterprise-grade.

2. **Correct architectural seams** — The Kafka message broker creates a clean seam between IoT ingestion and business operations. The monolith is never in the telemetry hot path, eliminating the "firehose problem" by design.

3. **Offline-first is genuine, not cosmetic** — The combination of Workbox CacheFirst + IndexedDB + Background Sync creates a real offline experience, not just "graceful degradation." Drivers can operate for days without connectivity.

4. **Strangler Fig is low-risk** — By using Nginx as the routing arbiter, the microservice extraction can be done without any application code changes. Traffic percentages are adjusted in Nginx config, not code. Rollback is instantaneous.

5. **TimescaleDB choice is excellent** — Telemetry time-series data in a PostgreSQL-compatible extension means no additional infrastructure complexity while getting automatic time-based partitioning, compression, and time-series query optimisations.

### 20.2 Weaknesses & Risks

| Weakness | Risk Level | Mitigation |
|---|---|---|
| **Single Kafka broker in MVP** | HIGH | Add `min.insync.replicas=2` and a second broker by Milestone 6 |
| **WebSocket hub is stateful** | MEDIUM | Cannot horizontally scale without sticky sessions. Redis Pub/Sub partially solves this but WebSocket server itself needs sticky routing in Nginx (`ip_hash`) |
| **Background Sync iOS Safari** | MEDIUM | Background Sync API not fully supported. Implement `visibilitychange` + `online` event polling as fallback |
| **Clock skew in LWW** | MEDIUM | Mobile devices can have incorrect clocks. NTP check on app startup; use server `received_at` as tiebreaker |
| **Kafka consumer single point of failure** | MEDIUM | Consumer group with 2+ instances + partition rebalancing handles this automatically |
| **Redis as pub/sub hub** | LOW-MEDIUM | Redis single-threaded pub/sub saturates at ~50k messages/s. At scale, consider switching to NATS or dedicated event bus |

### 20.3 Scalability Concerns

| Scenario | Bottleneck | Solution Path |
|---|---|---|
| **10,000 vehicles × 1 ping/5s = 2,000 msg/s** | Kafka topic throughput | Increase partition count; add Kafka brokers |
| **1,000 concurrent WebSocket connections per tenant** | WebSocket server memory | Extract WebSocket hub to dedicated Go service with goroutine-per-connection model |
| **PostgreSQL write throughput at scale** | Single primary node | TimescaleDB multi-node OR read replicas + connection pooling (PgBouncer) |
| **Redis memory for 10,000 vehicle GeoHashes** | Redis RAM | GeoHash data is compact (~100 bytes/vehicle); 10,000 vehicles ≈ 1MB. Not a concern. |
| **Next.js server rendering under load** | Node.js single-threaded RSC rendering | Horizontal scaling with Kubernetes HPA; static generation for stable content |

### 20.4 Pre-Development Recommendations

> [!IMPORTANT]
> **Address these before writing the first line of application code**

1. **Define the Avro schema registry** for Kafka messages. Without a schema registry (Confluent Schema Registry or AWS Glue), schema drift between producer and consumer will cause silent data corruption.

2. **Establish ADR (Architecture Decision Record) practice** from day one. Start with ADRs for: (a) JWT key strategy, (b) LWW vs state merge, (c) Mapbox vs Leaflet, (d) Go vs FastAPI for telemetry service.

3. **Security review the RLS policies** before any data is in production. A penetration test specifically targeting the tenant isolation layer is non-negotiable before customer onboarding.

4. **Decide on Kubernetes migration timing**. Docker Compose works for up to ~5 services on a single server. At Milestone 5+, the distributed services require Kubernetes for proper health management, rolling deployments, and horizontal pod autoscaling.

5. **Plan the device JWT strategy** for IoT vehicles. Vehicles need long-lived credentials (they can't do OAuth browser flows). Consider per-device API keys stored in Redis, or short-lived device JWTs rotated via a device registration service.

6. **Establish the data retention policy** for telemetry events now. TimescaleDB compression after 7 days is configured, but deletion policy needs business input (GDPR implications, legal hold requirements for fleet data).

7. **Load test at 3× expected scale** before launch. If you expect 1,000 vehicles, load test at 3,000. Systems that perform well at expected load often fail non-linearly at modest overload.

---

> [!NOTE]
> **Open Questions Requiring Business Input Before Implementation**
>
> 1. Should the Driver PWA support iOS installation (PWA) or native iOS packaging (Capacitor/Expo)?
> 2. Is Mapbox acceptable given usage-based pricing? Budget approval needed for scale projections.
> 3. What is the required data retention period for telemetry events (compliance/legal)?
> 4. Does the platform need to support on-premise deployment (self-hosted Kafka/Redis) for regulated customers?
> 5. Is multi-region / geo-distributed deployment required in the production timeline or post-MVP?
