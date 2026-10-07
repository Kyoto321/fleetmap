package validator

import (
	"crypto/rand"
	"errors"
	"fmt"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

// Claims represents the fleet platform JWT payload.
type Claims struct {
	TenantID string `json:"tenant_id"`
	UserID   string `json:"user_id"`
	Role     string `json:"role"`
	jwt.RegisteredClaims
}

// ParseJWTClaims validates an RS256 JWT and extracts platform claims.
func ParseJWTClaims(tokenString, publicKeyPEM string) (*Claims, error) {
	if publicKeyPEM == "" {
		// Development mode — skip validation (NEVER in production)
		claims := &Claims{}
		token, _, err := jwt.NewParser().ParseUnverified(tokenString, claims)
		if err != nil {
			return nil, err
		}
		if c, ok := token.Claims.(*Claims); ok {
			return c, nil
		}
		return nil, errors.New("invalid claims type")
	}

	// Format key: replace literal \n and quotes
	formattedKey := strings.ReplaceAll(publicKeyPEM, `\n`, "\n")
	formattedKey = strings.ReplaceAll(formattedKey, `"`, "")
	formattedKey = strings.TrimSpace(formattedKey)

	pubKey, err := jwt.ParseRSAPublicKeyFromPEM([]byte(formattedKey))
	if err != nil {
		return nil, fmt.Errorf("invalid public key: %w", err)
	}

	claims := &Claims{}
	token, err := jwt.ParseWithClaims(tokenString, claims, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodRSA); !ok {
			return nil, fmt.Errorf("unexpected signing method: %v", t.Header["alg"])
		}
		return pubKey, nil
	})

	if err != nil || !token.Valid {
		return nil, fmt.Errorf("invalid token: %w", err)
	}

	return claims, nil
}

// ValidateTelemetry checks the most critical fields of an inbound telemetry payload.
func ValidateTelemetry(vehicleID string, lat, lng float64) []string {
	var errs []string
	if vehicleID == "" {
		errs = append(errs, "vehicle_id: required")
	}
	if lat < -90 || lat > 90 {
		errs = append(errs, "lat: must be between -90 and 90")
	}
	if lng < -180 || lng > 180 {
		errs = append(errs, "lng: must be between -180 and 180")
	}
	return errs
}

// NewUUID generates a random UUID v4.
func NewUUID() string {
	b := make([]byte, 16)
	rand.Read(b)
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%08x-%04x-%04x-%04x-%012x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}
