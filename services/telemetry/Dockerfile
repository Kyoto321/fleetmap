# Multi-stage Dockerfile for Go Telemetry Microservice
# Stage 1: Build
FROM golang:1.22-alpine AS builder

WORKDIR /build

# Cache dependencies first (layer caching optimization)
COPY go.mod go.sum ./
RUN go mod download

# Build binary with stripped debug symbols for minimal image size
COPY . .
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 \
    go build -ldflags="-w -s" -trimpath \
    -o /telemetry-service ./cmd/server

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Distroless runtime (no shell, no OS, minimal attack surface)
FROM gcr.io/distroless/static:nonroot AS runtime

COPY --from=builder /telemetry-service /telemetry-service

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["/telemetry-service", "-health-check"]

ENTRYPOINT ["/telemetry-service"]
