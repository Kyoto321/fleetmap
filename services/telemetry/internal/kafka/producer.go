package kafka

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/IBM/sarama"
)

// Producer wraps a Sarama async producer for fire-and-forget Kafka publishing.
// Messages are published to the telemetry.raw topic keyed by tenant_id
// to ensure ordering per tenant while distributing load across partitions.
type Producer struct {
	client sarama.AsyncProducer
	topic  string
}

func NewProducer(brokers, topic string) (*Producer, error) {
	cfg := sarama.NewConfig()
	cfg.Version = sarama.V3_6_0_0
	cfg.Producer.Return.Successes = false   // fire-and-forget — no blocking on ACK
	cfg.Producer.Return.Errors = true
	cfg.Producer.RequiredAcks = sarama.WaitForLocal  // acks=1 for throughput
	cfg.Producer.Compression = sarama.CompressionSnappy
	cfg.Producer.Flush.Frequency = 50 * time.Millisecond  // micro-batch

	client, err := sarama.NewAsyncProducer([]string{brokers}, cfg)
	if err != nil {
		return nil, err
	}

	p := &Producer{client: client, topic: topic}

	// Drain error channel in background to prevent blocking
	go func() {
		for err := range client.Errors() {
			slog.Error("Kafka producer error", "error", err.Err, "topic", err.Msg.Topic)
		}
	}()

	return p, nil
}

// Publish encodes the message as JSON and enqueues it on the async producer.
// Keyed by tenant_id to ensure partition locality per tenant.
func (p *Producer) Publish(ctx context.Context, partitionKey string, payload any) error {
	data, err := json.Marshal(payload)
	if err != nil {
		return err
	}

	select {
	case p.client.Input() <- &sarama.ProducerMessage{
		Topic: p.topic,
		Key:   sarama.StringEncoder(partitionKey),
		Value: sarama.ByteEncoder(data),
	}:
		return nil
	case <-ctx.Done():
		return ctx.Err()
	}
}

func (p *Producer) Close() {
	p.client.AsyncClose()
}
