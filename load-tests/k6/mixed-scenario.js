/**
 * K6 Mixed Load Test — The Critical Proof of Architecture
 *
 * This script simultaneously:
 *   1. Floods the Telemetry Microservice with 500 virtual users
 *   2. Runs normal business API operations with 50 virtual users
 *
 * Success criterion (Definition of Done):
 *   - Telemetry: P99 latency < 500ms at 1,000+ req/s
 *   - Business API: P99 latency < 300ms WHILE telemetry flood is running
 *   - Business API error rate < 0.5% during flood
 *
 * This proves the decoupled architecture isolates telemetry load
 * from core business operations.
 */

import http from 'k6/http'
import { check, sleep } from 'k6'
import { Counter, Trend, Rate } from 'k6/metrics'

// ── Custom metrics ────────────────────────────────────────────────────────────
const telemetryErrors     = new Counter('telemetry_errors_total')
const businessErrors      = new Counter('business_errors_total')
const telemetryDuration   = new Trend('telemetry_latency_ms', true)
const businessDuration    = new Trend('business_api_latency_ms', true)
const businessSuccessRate = new Rate('business_success_rate')

// ── Test Configuration ────────────────────────────────────────────────────────
export const options = {
  scenarios: {
    // HIGH-FREQUENCY telemetry flood
    telemetry_flood: {
      executor:   'ramping-vus',
      exec:       'telemetryScenario',
      startVUs:   0,
      stages: [
        { duration: '30s', target: 200  },   // Ramp up to 200
        { duration: '2m',  target: 1000 },   // Ramp to 1,000
        { duration: '5m',  target: 1000 },   // Sustain at 1,000
        { duration: '30s', target: 0    },   // Ramp down
      ],
    },

    // CONCURRENT business operations — must not be impacted
    business_operations: {
      executor:   'constant-vus',
      exec:       'businessScenario',
      vus:        50,
      duration:   '8m',
      startTime:  '30s',  // Start 30s after telemetry begins
    },
  },

  thresholds: {
    // Telemetry service thresholds
    'telemetry_latency_ms':             ['p(99)<500', 'p(95)<200'],
    'http_req_failed{scenario:telemetry_flood}': ['rate<0.01'],  // <1% error

    // Business API thresholds — MUST hold during telemetry flood
    'business_api_latency_ms':          ['p(99)<300', 'p(95)<150'],
    'business_success_rate':            ['rate>0.995'],           // >99.5% success
    'http_req_failed{scenario:business_operations}': ['rate<0.005'],
  },
}

const TELEMETRY_URL = __ENV.TELEMETRY_URL || 'http://localhost:80'
const MONOLITH_URL  = __ENV.MONOLITH_URL  || 'http://localhost:80'
const TENANT_JWT    = __ENV.TENANT_JWT    || 'dev-test-token'  // Pre-issued test JWT

// ── Scenario 1: Telemetry Flood ───────────────────────────────────────────────
export function telemetryScenario() {
  const vehicleId = `vehicle-${__VU % 500}`  // Simulate 500 distinct vehicles
  const lat = 51.5074 + (Math.random() - 0.5) * 0.5
  const lng = -0.1278 + (Math.random() - 0.5) * 0.5

  const payload = JSON.stringify({
    vehicle_id:    vehicleId,
    lat:           lat,
    lng:           lng,
    spd:           Math.random() * 130,
    bat:           Math.random(),
    eng:           true,
    ts:            new Date().toISOString(),
  })

  const start = Date.now()
  const res = http.post(
    `${TELEMETRY_URL}/api/v1/telemetry`,
    payload,
    {
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${TENANT_JWT}`,
      },
      timeout: '10s',
      tags: { scenario: 'telemetry_flood' },
    }
  )
  telemetryDuration.add(Date.now() - start)

  const ok = check(res, {
    'telemetry: status is 202': (r) => r.status === 202,
    'telemetry: response < 500ms': (r) => r.timings.duration < 500,
  })
  if (!ok) telemetryErrors.add(1)

  sleep(0.05)  // 50ms between requests per VU → ~20 req/s per VU
}

// ── Scenario 2: Business API Operations ──────────────────────────────────────
export function businessScenario() {
  const headers = {
    'Content-Type':  'application/json',
    'Authorization': `Bearer ${TENANT_JWT}`,
  }

  // Simulate realistic dispatcher workflow
  const scenarios = [listJobs, listVehicles, getJob]
  const fn = scenarios[Math.floor(Math.random() * scenarios.length)]

  const start = Date.now()
  const res = fn(headers)
  businessDuration.add(Date.now() - start)

  const ok = check(res, {
    'business: status is 200': (r) => r.status === 200 || r.status === 201,
    'business: response < 300ms': (r) => r.timings.duration < 300,
  })
  businessSuccessRate.add(ok ? 1 : 0)
  if (!ok) businessErrors.add(1)

  sleep(0.5 + Math.random())  // 0.5–1.5s between business operations (realistic pacing)
}

function listJobs(headers) {
  return http.get(
    `${MONOLITH_URL}/api/v1/jobs?status=pending&page=1&per_page=20`,
    { headers, tags: { endpoint: 'list_jobs' } }
  )
}

function listVehicles(headers) {
  return http.get(
    `${MONOLITH_URL}/api/v1/vehicles`,
    { headers, tags: { endpoint: 'list_vehicles' } }
  )
}

function getJob(headers) {
  // Use a pre-seeded job ID for consistent load testing
  const jobId = __ENV.TEST_JOB_ID || '00000000-0000-0000-0000-000000000001'
  return http.get(
    `${MONOLITH_URL}/api/v1/jobs/${jobId}`,
    { headers, tags: { endpoint: 'get_job' } }
  )
}

// ── Summary Handler ───────────────────────────────────────────────────────────
export function handleSummary(data) {
  const telP99  = data.metrics['telemetry_latency_ms']?.values?.['p(99)'] ?? 'N/A'
  const bizP99  = data.metrics['business_api_latency_ms']?.values?.['p(99)'] ?? 'N/A'
  const telRPS  = data.metrics['http_reqs']?.values?.rate ?? 0

  const report = `
╔══════════════════════════════════════════════════════════════╗
║            FLEET PLATFORM — LOAD TEST REPORT                ║
╠══════════════════════════════════════════════════════════════╣
║  Telemetry P99 Latency  : ${String(telP99).padEnd(8)} ms  (threshold: <500ms) ║
║  Business API P99       : ${String(bizP99).padEnd(8)} ms  (threshold: <300ms) ║
║  Total RPS              : ${String(telRPS.toFixed(1)).padEnd(10)}                   ║
║  Telemetry Errors       : ${data.metrics['telemetry_errors_total']?.values?.count ?? 0}                               ║
║  Business Errors        : ${data.metrics['business_errors_total']?.values?.count ?? 0}                               ║
╚══════════════════════════════════════════════════════════════╝
`
  return {
    stdout: report,
    'load-test-results.json': JSON.stringify(data, null, 2),
  }
}
