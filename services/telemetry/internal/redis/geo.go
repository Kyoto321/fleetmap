package redis

import (
	"context"
	"fmt"

	"github.com/redis/go-redis/v9"
)

// Client wraps go-redis for GeoHash operations and Pub/Sub.
type Client struct {
	rdb *redis.Client
}

func NewClient(addr, password string) (*Client, error) {
	rdb := redis.NewClient(&redis.Options{
		Addr:     addr,
		Password: password,
		DB:       0,
		PoolSize: 20,
	})

	ctx := context.Background()
	if err := rdb.Ping(ctx).Err(); err != nil {
		return nil, fmt.Errorf("redis ping failed: %w", err)
	}

	return &Client{rdb: rdb}, nil
}

// GeoAdd writes a vehicle's latest position to a Redis Geospatial index.
// Key format: tenant:{tenant_id}:vehicles
// Allows GEODIST, GEOSEARCH, GEOPOS queries for spatial operations.
func (c *Client) GeoAdd(ctx context.Context, key, memberName string, longitude, latitude float64) error {
	return c.rdb.GeoAdd(ctx, key, &redis.GeoLocation{
		Name:      memberName,
		Longitude: longitude,
		Latitude:  latitude,
	}).Err()
}

// Publish broadcasts a message to a Redis Pub/Sub channel.
// The WebSocket hub subscribes to these channels and fans out to connected clients.
func (c *Client) Publish(ctx context.Context, channel, message string) error {
	return c.rdb.Publish(ctx, channel, message).Err()
}

// GeoPos retrieves the latest [lng, lat] for a vehicle from the GeoHash index.
func (c *Client) GeoPos(ctx context.Context, key, memberName string) (float64, float64, error) {
	positions, err := c.rdb.GeoPos(ctx, key, memberName).Result()
	if err != nil || len(positions) == 0 || positions[0] == nil {
		return 0, 0, fmt.Errorf("position not found: %w", err)
	}
	return positions[0].Longitude, positions[0].Latitude, nil
}

func (c *Client) Close() error {
	return c.rdb.Close()
}
