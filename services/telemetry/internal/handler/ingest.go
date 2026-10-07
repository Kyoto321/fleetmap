package handler

import (
	"encoding/json"
	"log/slog"
	"net/http"
	"strings"
	"time"

	"github.com/fleet-platform/telemetry/internal/kafka"
	"github.com/fleet-platform/telemetry/internal/validator"
)

// IngestHandler handles POST /api/v1/telemetry.
// Design: validate → publish to Kafka → immediately return 202.
// No database operations on the hot path.
type IngestHandler struct {
	producer     *kafka.Producer
	jwtPublicKey string
}

func NewIngestHandler(producer *kafka.Producer, jwtPublicKey string) *IngestHandler {
	return &IngestHandler{producer: producer, jwtPublicKey: jwtPublicKey}
}

// TelemetryPayload is the inbound IoT message — kept minimal to reduce bandwidth.
type TelemetryPayload struct {
	VehicleID    string  `json:"vehicle_id"`
	Latitude     float64 `json:"lat"`
	Longitude    float64 `json:"lng"`
	Speed        float64 `json:"spd"`
	BatteryLevel float64 `json:"bat"`
	EngineOn     bool    `json:"eng"`
	Timestamp    string  `json:"ts"`
}

// KafkaMessage is the enriched message published to telemetry.raw.
type KafkaMessage struct {
	SchemaVersion string  `json:"schema_version"`
	MessageID     string  `json:"message_id"`
	TenantID      string  `json:"tenant_id"`
	VehicleID     string  `json:"vehicle_id"`
	Latitude      float64 `json:"latitude"`
	Longitude     float64 `json:"longitude"`
	Speed         float64 `json:"speed"`
	BatteryLevel  float64 `json:"battery_level"`
	EngineOn      bool    `json:"engine_on"`
	Timestamp     string  `json:"timestamp"`
	ReceivedAt    string  `json:"received_at"`
}

func (h *IngestHandler) Handle(w http.ResponseWriter, r *http.Request) {
	// 1. Extract tenant from JWT
	tenantID, err := extractTenantFromJWT(r.Header.Get("Authorization"), h.jwtPublicKey)
	if err != nil {
		http.Error(w, `{"error":"unauthorized"}`, http.StatusUnauthorized)
		return
	}

	// 2. Decode payload
	var payload TelemetryPayload
	if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
		http.Error(w, `{"error":"invalid_json"}`, http.StatusBadRequest)
		return
	}

	// 3. Validate
	if errs := validator.ValidateTelemetry(payload.VehicleID, payload.Latitude, payload.Longitude); len(errs) > 0 {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusBadRequest)
		json.NewEncoder(w).Encode(map[string]any{"error": "validation_failed", "fields": errs})
		return
	}

	// 4. Publish to Kafka — async, non-blocking on ACK
	msg := KafkaMessage{
		SchemaVersion: "1.0",
		MessageID:     generateID(),
		TenantID:      tenantID,
		VehicleID:     payload.VehicleID,
		Latitude:      payload.Latitude,
		Longitude:     payload.Longitude,
		Speed:         payload.Speed,
		BatteryLevel:  payload.BatteryLevel,
		EngineOn:      payload.EngineOn,
		Timestamp:     payload.Timestamp,
		ReceivedAt:    time.Now().UTC().Format(time.RFC3339Nano),
	}

	if err := h.producer.Publish(r.Context(), tenantID, msg); err != nil {
		slog.Error("Failed to publish to Kafka", "vehicle_id", payload.VehicleID, "error", err)
		http.Error(w, `{"error":"service_unavailable"}`, http.StatusServiceUnavailable)
		return
	}

	// 5. Immediate 202 — do not wait for DB write
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusAccepted)
	w.Write([]byte(`{"accepted":true}`))
}

func extractTenantFromJWT(authHeader, publicKey string) (string, error) {
	token := strings.TrimPrefix(authHeader, "Bearer ")
	if token == "" {
		return "", http.ErrNoCookie
	}
	// In production: validate RS256 JWT and extract tenant_id claim.
	// For simplicity here — real implementation uses golang-jwt/jwt/v5
	claims, err := validator.ParseJWTClaims(token, publicKey)
	if err != nil {
		return "", err
	}
	return claims.TenantID, nil
}

func generateID() string {
	// Simple UUID v4 generation using crypto/rand
	return validator.NewUUID()
}
