package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/fleet-platform/telemetry/internal/handler"
	"github.com/fleet-platform/telemetry/internal/kafka"
	"github.com/fleet-platform/telemetry/internal/postgres"
	"github.com/fleet-platform/telemetry/internal/redis"
)

func main() {
	healthCheckFlag := flag.Bool("health-check", false, "Run health check GET request and exit")
	flag.Parse()

	if *healthCheckFlag {
		cfg := loadConfig()
		resp, err := http.Get(fmt.Sprintf("http://localhost:%s/health", cfg.Port))
		if err != nil {
			os.Exit(1)
		}
		defer resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			os.Exit(0)
		}
		os.Exit(1)
	}

	logger := slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{Level: slog.LevelInfo}))
	slog.SetDefault(logger)

	cfg := loadConfig()

	// ── Kafka Producer ────────────────────────────────────────────────────────
	producer, err := kafka.NewProducer(cfg.KafkaBrokers, cfg.KafkaTopic)
	if err != nil {
		slog.Error("failed to create Kafka producer", "error", err)
		os.Exit(1)
	}
	defer producer.Close()

	// ── Redis Client ─────────────────────────────────────────────────────────
	redisClient, err := redis.NewClient(cfg.RedisAddr, cfg.RedisPassword)
	if err != nil {
		slog.Error("failed to connect to Redis", "error", err)
		os.Exit(1)
	}
	defer redisClient.Close()

	// ── PostgreSQL Batch Writer ───────────────────────────────────────────────
	batchWriter, err := postgres.NewBatchWriter(cfg.DatabaseURL, cfg.BatchSize, cfg.FlushInterval)
	if err != nil {
		slog.Error("failed to create PostgreSQL batch writer", "error", err)
		os.Exit(1)
	}
	defer batchWriter.Close()

	// ── Kafka Consumer ───────────────────────────────────────────────────────
	consumer, err := kafka.NewConsumer(
		cfg.KafkaBrokers,
		cfg.KafkaTopic,
		cfg.KafkaDLQ,
		cfg.KafkaGroupID,
		redisClient,
		batchWriter,
	)
	if err != nil {
		slog.Error("failed to create Kafka consumer", "error", err)
		os.Exit(1)
	}

	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	// Start consumer in background goroutine
	go func() {
		slog.Info("Starting Kafka consumer", "topic", cfg.KafkaTopic, "group", cfg.KafkaGroupID)
		if err := consumer.Start(ctx); err != nil && ctx.Err() == nil {
			slog.Error("Kafka consumer error", "error", err)
		}
	}()

	// ── HTTP Server ───────────────────────────────────────────────────────────
	ingestHandler := handler.NewIngestHandler(producer, cfg.JWTPublicKey)
	mux := http.NewServeMux()
	mux.HandleFunc("POST /api/v1/telemetry", ingestHandler.Handle)
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		fmt.Fprintf(w, `{"status":"ok","service":"telemetry"}`)
	})

	server := &http.Server{
		Addr:         fmt.Sprintf(":%s", cfg.Port),
		Handler:      mux,
		ReadTimeout:  10 * time.Second,
		WriteTimeout: 10 * time.Second,
		IdleTimeout:  60 * time.Second,
	}

	// Graceful shutdown
	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, syscall.SIGTERM, syscall.SIGINT)

	go func() {
		slog.Info("Telemetry service listening", "addr", server.Addr)
		if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			slog.Error("HTTP server error", "error", err)
			os.Exit(1)
		}
	}()

	<-sigCh
	slog.Info("Shutdown signal received")
	cancel()

	shutdownCtx, shutdownCancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer shutdownCancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("HTTP server shutdown error", "error", err)
	}
	slog.Info("Telemetry service stopped")
}

type Config struct {
	Port          string
	KafkaBrokers  string
	KafkaTopic    string
	KafkaDLQ      string
	KafkaGroupID  string
	RedisAddr     string
	RedisPassword string
	DatabaseURL   string
	JWTPublicKey  string
	BatchSize     int
	FlushInterval time.Duration
}

func loadConfig() Config {
	return Config{
		Port:          getEnv("PORT", "8080"),
		KafkaBrokers:  getEnv("KAFKA_BROKERS", "localhost:9092"),
		KafkaTopic:    getEnv("KAFKA_TOPIC", "telemetry.raw"),
		KafkaDLQ:      getEnv("KAFKA_DLQ", "telemetry.dead"),
		KafkaGroupID:  getEnv("KAFKA_GROUP_ID", "telemetry-consumer-v1"),
		RedisAddr:     getEnv("REDIS_ADDR", "localhost:6379"),
		RedisPassword: getEnv("REDIS_PASSWORD", ""),
		DatabaseURL:   getEnv("DATABASE_URL", "postgres://app_user:changeme@localhost:5432/fleetdb"),
		JWTPublicKey:  getEnv("JWT_PUBLIC_KEY", ""),
		BatchSize:     500,
		FlushInterval: 10 * time.Second,
	}
}

func getEnv(key, fallback string) string {
	if v, ok := os.LookupEnv(key); ok {
		return v
	}
	return fallback
}
