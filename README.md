# Fleet Platform — Distributed B2B Fleet Management & Telemetry

Enterprise-grade, multi-tenant fleet management platform built with a **modular monolith + microservice extraction (Strangler Fig)** architecture. Supports 10,000+ vehicles, offline-first driver apps, and real-time GPS telemetry at scale.

---

## Architecture

```
IoT Devices → Nginx → Telemetry Service (Go) → Kafka → Consumer → Redis + PostgreSQL
Browser     → Nginx → Monolith (FastAPI)     → PostgreSQL (RLS)
WebSocket   → Nginx → Monolith WebSocket Hub → Redis Pub/Sub
Driver PWA  ↔ IndexedDB (offline) → Background Sync → Monolith
```

## Quick Start

### Prerequisites
- Docker Desktop
- Node.js 20+
- Python 3.12+
- Go 1.22+

### 1. Configure environment

```bash
cp .env.example .env
# Edit .env with your values
# Generate JWT keys:
openssl genrsa -out private.pem 2048
openssl rsa -in private.pem -pubout -out public.pem
```

### 2. Start all services

```bash
cd infra/docker
docker compose up -d
```

Services available at:
| Service | URL |
|---|---|
| Nginx Gateway | http://localhost:80 |
| Monolith API | http://localhost:8000 |
| Telemetry Service | http://localhost:8080 |
| Grafana | http://localhost:3001 |
| Prometheus | http://localhost:9090 |

### 3. Run migrations + seed

```bash
cd services/monolith
pip install -r requirements.txt
DATABASE_URL=postgresql+asyncpg://postgres:postgres@localhost:5432/fleetdb alembic upgrade head
python ../../infra/scripts/seed-db.py
```

### 4. Start web dashboard

```bash
cd apps/web
npm install
npm run dev   # http://acme.localhost:3000
```

### 5. Start driver PWA

```bash
cd apps/driver-pwa
npm install
npm run dev   # http://localhost:3001
```

---

## Multi-Tenant Access (Development)

| Tenant | URL | Admin Login |
|---|---|---|
| ACME Logistics | http://acme.localhost:3000 | admin@acme.demo / demo1234 |
| Beta Freight   | http://beta-freight.localhost:3000 | admin@beta-freight.demo / demo1234 |

---

## Testing

```bash
# Monolith unit + integration + security tests
cd services/monolith && pytest tests/ -v

# Tenant isolation security tests specifically
pytest tests/security/ -v -s

# Go telemetry service tests
cd services/telemetry && go test ./... -race

# Load test (requires K6 installed)
k6 run load-tests/k6/mixed-scenario.js \
  -e TELEMETRY_URL=http://localhost:80 \
  -e MONOLITH_URL=http://localhost:80 \
  -e TENANT_JWT=<your-jwt>
```

---

## Project Structure

```
fleet-platform/
├── apps/
│   ├── web/          # Next.js management dashboard
│   └── driver-pwa/   # Vite/React offline-first driver app
├── services/
│   ├── monolith/     # FastAPI core backend (auth, jobs, vehicles)
│   └── telemetry/    # Go telemetry microservice (ingest + consumer)
├── infra/
│   ├── docker/       # Docker Compose + Nginx config
│   ├── monitoring/   # Prometheus + Grafana + Loki
│   └── scripts/      # DB seed, tenant creation utilities
├── load-tests/       # K6 load test scripts
└── .github/
    └── workflows/    # CI/CD pipelines
```

---

## Architecture Decisions

See [docs/architecture/adr/](docs/architecture/adr/) for Architecture Decision Records covering:
- JWT RS256 key strategy
- LWW vs state merge conflict resolution
- Mapbox vs Leaflet for fleet mapping
- Go vs FastAPI for telemetry service
- Strangler Fig extraction timeline

---

## Milestones

| # | Milestone | Status |
|---|---|---|
| 1 | Multi-Tenant Control Plane | ✅ Complete |
| 2 | Offline-First Driver PWA | ✅ Complete |
| 3 | High-Throughput IoT Ingestion | ✅ Complete |
| 4 | Real-Time Dashboard | ✅ Complete |
| 5 | Strangler Fig Extraction | ✅ Complete |
| 6 | Platform Engineering & Load Tests | ✅ Complete |

---

## License

Proprietary — All rights reserved.
