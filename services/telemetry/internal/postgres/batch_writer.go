package postgres

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"os"
	"strings"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// BatchWriter buffers TelemetryEvents and bulk-inserts them into PostgreSQL.
// Uses pgx COPY protocol for maximum throughput.
type BatchWriter struct {
	pool *pgxpool.Pool
}

// TelemetryRow mirrors the telemetry_events table columns for the batch insert.
type TelemetryRow interface {
	GetTenantID() string
	GetVehicleID() string
	GetLatitude() float64
	GetLongitude() float64
	GetSpeed() float64
	GetBatteryLevel() float64
	GetEngineOn() bool
	GetTimestamp() string
}

func NewBatchWriter(dsn string, batchSize int, flushInterval time.Duration) (*BatchWriter, error) {
	config, err := pgxpool.ParseConfig(dsn)
	if err != nil {
		return nil, fmt.Errorf("pgxpool config parse error: %w", err)
	}
	config.MaxConns = 10
	config.MinConns = 2

	pool, err := pgxpool.NewWithConfig(context.Background(), config)
	if err != nil {
		return nil, fmt.Errorf("pgxpool creation error: %w", err)
	}

	return &BatchWriter{pool: pool}, nil
}

// Insert performs a bulk INSERT of telemetry events using pgx batch.
// Uses unnest() pattern for efficient multi-row insert.
func (w *BatchWriter) Insert(ctx context.Context, events any) error {
	// Use reflection-free approach: marshal to typed slice
	data, err := json.Marshal(events)
	if err != nil {
		return err
	}

	var rows []struct {
		TenantID     string  `json:"tenant_id"`
		VehicleID    string  `json:"vehicle_id"`
		Latitude     float64 `json:"latitude"`
		Longitude    float64 `json:"longitude"`
		Speed        float64 `json:"speed"`
		BatteryLevel float64 `json:"battery_level"`
		EngineOn     bool    `json:"engine_on"`
		Timestamp    string  `json:"timestamp"`
	}

	if err := json.Unmarshal(data, &rows); err != nil {
		return err
	}

	if len(rows) == 0 {
		return nil
	}

	// Build bulk INSERT using unnest() — single round-trip for N rows
	var (
		tenantIDs     []string
		vehicleIDs    []string
		latitudes     []float64
		longitudes    []float64
		speeds        []float64
		batteryLevels []float64
		engineOns     []bool
		timestamps    []time.Time
	)

	for _, r := range rows {
		ts, err := time.Parse(time.RFC3339Nano, r.Timestamp)
		if err != nil {
			ts = time.Now().UTC()
		}
		tenantIDs = append(tenantIDs, r.TenantID)
		vehicleIDs = append(vehicleIDs, r.VehicleID)
		latitudes = append(latitudes, r.Latitude)
		longitudes = append(longitudes, r.Longitude)
		speeds = append(speeds, r.Speed)
		batteryLevels = append(batteryLevels, r.BatteryLevel)
		engineOns = append(engineOns, r.EngineOn)
		timestamps = append(timestamps, ts)
	}

	_, err = w.pool.Exec(ctx, `
		INSERT INTO telemetry_events
			(time, tenant_id, vehicle_id, latitude, longitude, speed, battery_level, engine_on)
		SELECT
			UNNEST($1::timestamptz[]),
			UNNEST($2::uuid[]),
			UNNEST($3::uuid[]),
			UNNEST($4::float8[]),
			UNNEST($5::float8[]),
			UNNEST($6::float4[]),
			UNNEST($7::float4[]),
			UNNEST($8::boolean[])
		ON CONFLICT DO NOTHING
	`,
		timestamps, tenantIDs, vehicleIDs,
		latitudes, longitudes, speeds, batteryLevels, engineOns,
	)

	if err != nil {
		return fmt.Errorf("batch insert error: %w", err)
	}

	slog.Info("Telemetry batch inserted", "count", len(rows))
	return nil
}

// WriteToWAL writes failed batch data to a local file as a last-resort recovery mechanism.
func (w *BatchWriter) WriteToWAL(events any) {
	data, _ := json.Marshal(events)
	filename := fmt.Sprintf("/tmp/telemetry_wal_%d.json", time.Now().UnixNano())
	if err := os.WriteFile(filename, data, 0600); err != nil {
		slog.Error("CRITICAL: Failed to write WAL file", "error", err)
		return
	}
	slog.Warn("Batch written to WAL file for manual recovery", "file", filename)
}

func (w *BatchWriter) Close() {
	w.pool.Close()
}

// placeholders builds $1,$2,...,$n for SQL queries (helper).
func placeholders(n int) string {
	parts := make([]string, n)
	for i := range parts {
		parts[i] = fmt.Sprintf("$%d", i+1)
	}
	return strings.Join(parts, ",")
}
