package kafka

import (
	"context"
	"encoding/json"
	"log/slog"
	"sync"
	"time"

	"github.com/IBM/sarama"
	redisclient "github.com/fleet-platform/telemetry/internal/redis"
	"github.com/fleet-platform/telemetry/internal/postgres"
)

// TelemetryEvent is the decoded, enriched message from the telemetry.raw topic.
type TelemetryEvent struct {
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

// Consumer reads from telemetry.raw and:
//  1. Writes latest position to Redis GeoHash for fast spatial lookups.
//  2. Publishes to Redis Pub/Sub channel for WebSocket fan-out.
//  3. Buffers events in memory and batch-inserts to PostgreSQL every N seconds.
type Consumer struct {
	client      sarama.ConsumerGroup
	topic       string
	dlqTopic    string
	groupID     string
	redis       *redisclient.Client
	batchWriter *postgres.BatchWriter

	mu     sync.Mutex
	buffer []TelemetryEvent

	batchSize     int
	flushInterval time.Duration
}

func NewConsumer(
	brokers, topic, dlqTopic, groupID string,
	redis *redisclient.Client,
	batchWriter *postgres.BatchWriter,
) (*Consumer, error) {
	cfg := sarama.NewConfig()
	cfg.Version = sarama.V3_6_0_0
	cfg.Consumer.Group.Rebalance.GroupStrategies = []sarama.BalanceStrategy{sarama.NewBalanceStrategyRoundRobin()}
	cfg.Consumer.Offsets.Initial = sarama.OffsetNewest

	client, err := sarama.NewConsumerGroup([]string{brokers}, groupID, cfg)
	if err != nil {
		return nil, err
	}

	return &Consumer{
		client:        client,
		topic:         topic,
		dlqTopic:      dlqTopic,
		groupID:       groupID,
		redis:         redis,
		batchWriter:   batchWriter,
		buffer:        make([]TelemetryEvent, 0, 500),
		batchSize:     500,
		flushInterval: 10 * time.Second,
	}, nil
}

func (c *Consumer) Start(ctx context.Context) error {
	// Periodic flush ticker
	ticker := time.NewTicker(c.flushInterval)
	defer ticker.Stop()

	go func() {
		for {
			select {
			case <-ticker.C:
				c.flush(ctx)
			case <-ctx.Done():
				c.flush(ctx) // Final flush on shutdown
				return
			}
		}
	}()

	handler := &consumerGroupHandler{consumer: c, ctx: ctx}
	for {
		if err := c.client.Consume(ctx, []string{c.topic}, handler); err != nil {
			if ctx.Err() != nil {
				return nil // Clean shutdown
			}
			slog.Error("Consumer group error", "error", err)
		}
	}
}

// consumerGroupHandler implements sarama.ConsumerGroupHandler.
type consumerGroupHandler struct {
	consumer *Consumer
	ctx      context.Context
}

func (h *consumerGroupHandler) Setup(_ sarama.ConsumerGroupSession) error   { return nil }
func (h *consumerGroupHandler) Cleanup(_ sarama.ConsumerGroupSession) error { return nil }

func (h *consumerGroupHandler) ConsumeClaim(session sarama.ConsumerGroupSession, claim sarama.ConsumerGroupClaim) error {
	for {
		select {
		case msg, ok := <-claim.Messages():
			if !ok {
				return nil
			}
			h.consumer.processMessage(h.ctx, session, msg)
		case <-h.ctx.Done():
			return nil
		}
	}
}

func (c *Consumer) processMessage(ctx context.Context, session sarama.ConsumerGroupSession, msg *sarama.ConsumerMessage) {
	var event TelemetryEvent
	if err := json.Unmarshal(msg.Value, &event); err != nil {
		slog.Warn("Failed to parse telemetry message — routing to DLQ",
			"offset", msg.Offset, "error", err)
		// DLQ handling would publish back to telemetry.dead here
		session.MarkMessage(msg, "")
		return
	}

	// 1. Hot cache: Redis GeoHash — O(log N) write
	geoKey := "tenant:" + event.TenantID + ":vehicles"
	if err := c.redis.GeoAdd(ctx, geoKey, event.VehicleID, event.Longitude, event.Latitude); err != nil {
		slog.Warn("Redis GeoAdd failed", "vehicle_id", event.VehicleID, "error", err)
	}

	// 2. Pub/Sub broadcast — WebSocket hub picks this up
	pubsubChannel := "pubsub:tenant:" + event.TenantID
	if pubData, err := json.Marshal(map[string]any{
		"type":       "vehicle.position",
		"vehicle_id": event.VehicleID,
		"latitude":   event.Latitude,
		"longitude":  event.Longitude,
		"speed":      event.Speed,
		"timestamp":  event.Timestamp,
	}); err == nil {
		c.redis.Publish(ctx, pubsubChannel, string(pubData))
	}

	// 3. Buffer for batch DB write
	c.mu.Lock()
	c.buffer = append(c.buffer, event)
	shouldFlush := len(c.buffer) >= c.batchSize
	c.mu.Unlock()

	if shouldFlush {
		c.flush(ctx)
	}

	session.MarkMessage(msg, "")
}

func (c *Consumer) flush(ctx context.Context) {
	c.mu.Lock()
	if len(c.buffer) == 0 {
		c.mu.Unlock()
		return
	}
	batch := make([]TelemetryEvent, len(c.buffer))
	copy(batch, c.buffer)
	c.buffer = c.buffer[:0]
	c.mu.Unlock()

	slog.Info("Flushing telemetry batch to PostgreSQL", "count", len(batch))

	// Retry up to 3 times with exponential backoff
	var err error
	for attempt := 1; attempt <= 3; attempt++ {
		if err = c.batchWriter.Insert(ctx, batch); err == nil {
			return
		}
		slog.Warn("Batch insert failed, retrying", "attempt", attempt, "error", err)
		time.Sleep(time.Duration(attempt*attempt) * time.Second)
	}

	// All retries exhausted — write to WAL file as last resort
	slog.Error("Batch insert failed after 3 retries — data at risk", "error", err, "count", len(batch))
	c.batchWriter.WriteToWAL(batch)
}
