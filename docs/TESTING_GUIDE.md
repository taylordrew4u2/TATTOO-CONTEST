# Testing & Validation Guide - Tattoo Contest App

Complete guide to testing, monitoring, and validating the tattoo contest application across local, staging, and production environments.

## Quick Start

### Run Integration Tests

```bash
# Against local server
npm test

# Against deployed app
TEST_URL=https://tattoo-contest.fly.dev npm run test:integration
```

### Run Load Tests

```bash
# Default: 50 users, 60 seconds
npm run load-test

# Custom parameters
CONCURRENT_USERS=100 DURATION=120 npm run load-test

# With spike test
npm run load-test -- --spike

# With memory leak detection
npm run load-test -- --memory
```

---

## Test Infrastructure

### Files

| File | Purpose |
|------|---------|
| `tests/integration.test.js` | API and real-time functionality tests |
| `tests/load-test.js` | Concurrent user simulation and performance testing |
| `lib/performance-monitor.js` | Real-time metrics collection |
| `docs/TEST_SCENARIOS.md` | Manual test procedures |
| `docs/DISASTER_RECOVERY.md` | Recovery procedures for failures |

### Health Check Endpoints

```bash
# Basic health check
curl https://tattoo-contest.fly.dev/health

# Readiness check (for K8s deployment)
curl https://tattoo-contest.fly.dev/ready

# Detailed metrics (admin only)
curl https://tattoo-contest.fly.dev/api/metrics \
  -H "Cookie: session-cookie-here"
```

---

## Integration Test Suite

Comprehensive automated testing of all API endpoints and real-time features.

### What It Tests

**✓ Categories**

- Fetch categories endpoint
- Field validation (id, name required)
- Admin can add/update categories
- Categories persist

**✓ Submissions**

- Category validation (400 on invalid)
- Public feed returns correct structure
- Admin-only access control (401 on unauthorized)
- Submission data persistence

**✓ Authentication**

- Password validation
- Session management
- Authorization checks on protected endpoints

**✓ Winners**

- Winners retrieval (public endpoint)
- Admin-only save (401 unauthorized)
- 2-winner limit per category enforced
- Data persistence

**✓ Real-time Events**

- Socket.io connection established
- newSubmission events broadcast
- winnersUpdated events broadcast
- Proper event payloads

**✓ Error Handling**

- Invalid input rejected (400)
- Unauthorized access blocked (401)
- Proper error messages
- No information leakage

### Run Tests

```bash
# Local server
npm test

# Production server
TEST_URL=https://tattoo-contest.fly.dev npm run test:integration

# With verbose output
DEBUG=* npm test 2>&1 | head -100
```

### Test Results Interpretation

```
✓ Test passed - feature working correctly
✗ Test failed - investigate error message
→ Check logs for detailed error context
```

---

## Load Testing

Simulate realistic traffic patterns and stress test the system.

### Stress Test (Default)

Simulates peak concurrent users with realistic behavior:

- Category fetches
- Live feed polls (every 3-8 seconds)
- Periodic submissions (based on SUBMISSION_RATE)
- Socket.io event handling

**Metrics Collected:**

- Total requests
- Success/failure rate
- Average response time
- P95 response time (95th percentile)
- Max response time
- Requests per second

**Pass Criteria:**

- ✓ Avg response time < 500ms
- ✓ P95 response time < 1000ms
- ✓ Error rate < 5%
- ✓ No socket connection errors

### Spike Test

10x traffic surge to test auto-recovery:

- Rapid concurrent connections
- Measures system behavior under extreme load
- Validates graceful degradation

**Pass Criteria:**

- ✓ Failure rate < 10%
- ✓ No cascade failures
- ✓ System recovers after spike

### Memory Leak Test

5-minute sustained load to detect memory leaks:

- Continuous user sessions
- Periodic data updates
- Monitors for unbounded growth

**What to Monitor:**

```bash
# In separate terminal during test
watch -n 1 'ps aux | grep node | grep -v grep'
```

**Pass Criteria:**

- ✓ Memory usage stable
- ✓ No increasing growth trend
- ✓ GC events reduce spikes

### Run Load Tests

```bash
# Basic stress test
npm run load-test

# Stress + Spike test
npm run load-test -- --spike

# Stress + Memory test
npm run load-test -- --memory

# Stress + both spike and memory
npm run load-test -- --spike --memory

# Custom load parameters
CONCURRENT_USERS=200 DURATION=300 npm run load-test

# High-volume spike test
CONCURRENT_USERS=500 npm run load-test -- --spike
```

### Interpreting Results

```
✓ PASSED: All metrics within acceptable ranges
✗ FAILED: One or more metrics exceeded thresholds

Investigate failures with:
  - flyctl logs -a tattoo-contest (server errors)
  - Check network conditions (latency, bandwidth)
  - Review Cloudinary quota/rate limits
  - Check Fly.io machine specifications
```

---

## Manual Test Scenarios

See `docs/TEST_SCENARIOS.md` for detailed manual testing procedures.

### Quick Tests

**Public Submission Flow**

```bash
1. Go to https://tattoo-contest.fly.dev
2. Select category
3. Upload image
4. Fill form
5. Click Submit
→ Verify: Success message, live feed update, Socket.io event
```

**Admin Login & Winners**

```bash
1. Go to https://tattoo-contest.fly.dev/admin
2. Enter password: pins2025lol
3. Click Refresh Submissions
4. Select 2 winners per category
5. Click Save Winners
6. View winners page
→ Verify: Winners appear with images
```

**Real-time Sync**

```bash
1. Open 2 browser windows
2. Window A: public page
3. Window B: admin panel
4. Submit from B
5. Watch A for auto-update (< 1 second)
→ Verify: Real-time sync working
```

**Category Management**

```bash
1. Admin panel
2. Add category (name: "Test", id: "test")
3. Click Add
4. Verify appears in category list
5. View public page
6. Verify new category available
7. Return to admin, delete test category
→ Verify: Changes persist and propagate
```

---

## Performance Monitoring

### Health Check Endpoint

```bash
curl https://tattoo-contest.fly.dev/health | jq '.'
```

Returns:

```json
{
  "status": "healthy",
  "timestamp": "2025-11-07T...",
  "uptime": 3600,
  "memory": {
    "rss": 45000000,
    "heapTotal": 30000000,
    "heapUsed": 15000000
  },
  "categories": 2,
  "submissions": 42,
  "winners": [
    { "category": "worst", "count": 2 },
    { "category": "best", "count": 1 }
  ]
}
```

### Performance Targets

| Metric | Target | Alert |
|--------|--------|-------|
| Avg Response Time | < 200ms | > 1000ms |
| P95 Response Time | < 500ms | > 2000ms |
| Error Rate | < 0.1% | > 5% |
| Uptime | > 99.5% | Any downtime |
| Memory Usage | < 200MB | > 500MB |

### Monitoring

**Daily:**

- Check `/health` endpoint
- Review error logs
- Monitor memory usage

**Weekly:**

- Run full integration test suite
- Run load test with 50+ users
- Review performance trends

**Monthly:**

- Spike test (10x surge)
- Memory leak test (5 minutes)
- Disaster recovery drill

---

## Troubleshooting

### Tests Fail Locally

```bash
# Make sure server is running
npm start

# In another terminal
npm test

# If connection refused:
# - Check server listening on :3000
# - Check no firewall blocking
# - Try with explicit URL
TEST_URL=http://localhost:3000 npm test
```

### Tests Fail Against Production

```bash
# Verify app is up
curl https://tattoo-contest.fly.dev/health

# Check for rate limiting
# If getting 429, reduce CONCURRENT_USERS

# Verify admin password
curl https://tattoo-contest.fly.dev/admin

# Check Cloudinary quota
flyctl ssh console -a tattoo-contest
curl -s -u "$CLOUDINARY_API_KEY:$CLOUDINARY_API_SECRET" \
  "https://api.cloudinary.com/v1_1/$CLOUDINARY_CLOUD_NAME/resources/image"
exit
```

### Load Test Performance Poor

```bash
# Check current machine specs
flyctl machines list -a tattoo-contest

# Check resource usage
flyctl ssh console -a tattoo-contest
top -b -n 1 | head -15
df -h
free -h
exit

# Potential fixes:
# 1. Increase machine size
# 2. Check for data.json growth (cleanup old submissions)
# 3. Review Cloudinary API limits
# 4. Check network connectivity
```

### Socket.io Events Not Arriving

```bash
# From browser console
console.log('Connected:', socket.connected);

# Check Socket.io version
window.io.protocol

# Verify WebSocket support
echo "Check Chrome DevTools > Network tab for WebSocket connections"

# If using old browser
echo "Try modern browser (Chrome/Firefox/Safari latest)"
```

---

## Continuous Monitoring

### Automated Daily Checks

```bash
#!/bin/bash
# Save as scripts/daily-check.sh

# Health check
HEALTH=$(curl -s https://tattoo-contest.fly.dev/health)
echo "Health: $HEALTH" >> /var/log/tattoo-daily.log

# Integration tests
TEST_URL=https://tattoo-contest.fly.dev npm test >> /var/log/tattoo-daily.log 2>&1

# Alert if any failures
if [ $? -ne 0 ]; then
  echo "ALERT: Tests failed" | mail -s "Tattoo Contest Failed" admin@example.com
fi
```

Setup cron:

```bash
# Run daily at 2 AM
0 2 * * * /home/user/scripts/daily-check.sh
```

---

## Alerting Thresholds

Configure these in your monitoring system:

```javascript
{
  "alerts": [
    {
      "name": "High Response Time",
      "condition": "avg_response_time > 1000ms",
      "severity": "warning"
    },
    {
      "name": "Error Rate Spike",
      "condition": "error_rate > 5%",
      "severity": "critical"
    },
    {
      "name": "Memory Leak Detected",
      "condition": "memory_usage growing > 10% per hour",
      "severity": "warning"
    },
    {
      "name": "Service Down",
      "condition": "health_check fails",
      "severity": "critical"
    }
  ]
}
```

---

## Recovery Procedures

See `docs/DISASTER_RECOVERY.md` for detailed procedures.

Quick recovery commands:

```bash
# Restart if unresponsive
flyctl machines restart <id> -a tattoo-contest

# View logs for errors
flyctl logs -a tattoo-contest --limit 100

# Rollback deployment if needed
flyctl releases rollback -a tattoo-contest

# Restore from backup
flyctl ssh console -a tattoo-contest
cp data.json.backup data.json
exit
flyctl machines restart <id> -a tattoo-contest
```

---

## Documentation

- **TEST_SCENARIOS.md**: Detailed manual test procedures
- **DISASTER_RECOVERY.md**: Complete recovery runbook
- **README.md**: Application overview and setup

---

## Questions?

For issues or questions about testing:

1. Check TEST_SCENARIOS.md for detailed procedures
2. Review DISASTER_RECOVERY.md for error scenarios
3. Check `/health` and `/api/metrics` endpoints
4. Review server logs: `flyctl logs -a tattoo-contest`
5. Run tests with DEBUG enabled: `DEBUG=* npm test`
