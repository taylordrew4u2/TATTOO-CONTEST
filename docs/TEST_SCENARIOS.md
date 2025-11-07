# Test Scenarios & Validation Checklist

## Quick Start

Run tests locally:

```bash
# Install dev dependencies
npm install --save-dev axios socket.io-client

# Unit/Integration Tests
npm test

# Load Testing (50 concurrent users, 60s duration)
TEST_URL=http://localhost:3000 npm run load-test

# With spike test
npm run load-test -- --spike

# Memory leak detection (5 minutes)
npm run load-test -- --memory
```

---

## Test Suites

### 1. Integration Tests (`tests/integration.test.js`)

**Categories:**

- GET /categories.json returns valid array ✓
- Categories have required fields (id, name) ✓
- Admin can add/update categories ✓

**Submissions:**

- POST /api/submit requires category ✓
- GET /api/feed returns public feed ✓
- GET /api/submissions requires admin auth ✓

**Admin Authentication:**

- Wrong password rejected ✓
- Correct password accepted ✓
- Session grants API access ✓

**Winners Management:**

- GET /api/winners returns object ✓
- Limit enforced (max 2 per category) ✓
- Only admin can save winners ✓

**Real-time Events:**

- Socket.io connects successfully ✓
- newSubmission events broadcast ✓
- winnersUpdated events broadcast ✓

**Data Persistence:**

- Submissions persist after reload ✓
- Winners persist across requests ✓

**Error Handling:**

- Invalid categories return 400 ✓
- Missing auth returns 401 ✓
- Proper error messages in response ✓

**Run:**

```bash
TEST_URL=https://tattoo-contest.fly.dev npm run test:integration
```

### 2. Load Testing (`tests/load-test.js`)

**Stress Test:**

- 50 concurrent users for 60 seconds
- Measures: throughput, response times, success rate
- Metrics tracked:
  - Average response time < 500ms
  - P95 response time < 1000ms
  - Error rate < 5%
  - Socket connections stable

**Spike Test:**

- 10x traffic surge (500 concurrent users)
- Validates auto-recovery
- Failure rate threshold: < 10%

**Memory Leak Test:**

- 5-minute sustained load
- Monitors memory growth
- Detects resource leaks

**Run:**

```bash
# Basic stress test
TEST_URL=http://localhost:3000 \
  CONCURRENT_USERS=50 \
  DURATION=60 \
  npm run load-test

# With spike test
npm run load-test -- --spike

# Memory test
npm run load-test -- --memory
```

---

## Manual Test Scenarios

### Scenario 1: Happy Path - Complete Submission Flow

**Steps:**

1. Open <https://tattoo-contest.fly.dev>
2. Select a category (e.g., "Best Tattoo")
3. Upload a photo file
4. Fill in caption, name, phone
5. Click "Submit"
6. Verify:
   - Success message appears
   - Submission appears in live feed
   - Form resets
   - Socket.io event received

**Expected Results:**

- ✓ Submission saved to server
- ✓ Image uploaded to Cloudinary
- ✓ Real-time update to all viewers
- ✓ Submission persists on page refresh

---

### Scenario 2: Admin Flow - Login & Select Winners

**Steps:**

1. Go to <https://tattoo-contest.fly.dev/admin>
2. Enter password: `pins2025lol`
3. Click "Login"
4. Click "Refresh Submissions"
5. Verify submissions appear in grid
6. For each category, select 2 top submissions
7. Click "Save Winners"
8. Navigate to <https://tattoo-contest.fly.dev/winners>
9. Verify 2 winners per category displayed

**Expected Results:**

- ✓ Admin dashboard loads
- ✓ Can authenticate with password
- ✓ Submissions grid populates
- ✓ Can select winners (max 2)
- ✓ Winners saved and persistent
- ✓ Public winners page updated

---

### Scenario 3: Real-time Sync Test

**Prerequisites:** 2+ browsers/devices

**Steps:**

1. Device A: Open <https://tattoo-contest.fly.dev>
2. Device B: Open admin panel, submit new tattoo
3. Verify Device A shows new submission within 1 second
4. Device C: Open winners page
5. Device B: Select winners and save
6. Verify Device C updates winners within 1 second

**Expected Results:**

- ✓ Real-time updates via Socket.io
- ✓ < 1s latency for new submissions
- ✓ All clients synchronized
- ✓ No page refresh needed

---

### Scenario 4: Category Management

**Steps:**

1. Go to admin panel
2. In category editor, enter:
   - Name: "Most Painful"
   - ID: "painful"
3. Click "Add"
4. Verify new category in list
5. Click X to delete test category
6. Confirm deletion
7. Go to public page
8. Verify category appears (or is removed)

**Expected Results:**

- ✓ Categories persist
- ✓ Public form updates immediately
- ✓ New submissions can use new category
- ✓ Deletions work correctly

---

### Scenario 5: Error Handling - Wrong Password

**Steps:**

1. Go to admin panel
2. Enter wrong password
3. Click "Login"
4. Verify error message

**Expected Results:**

- ✗ Login fails (401)
- ✓ Error message displayed
- ✓ Form remains visible for retry
- ✓ No sensitive data leaked

---

### Scenario 6: Network Resilience

**Setup:** Browser DevTools Network Throttling

**Steps:**

1. Open public page
2. Set Network: "Slow 3G"
3. Submit a tattoo photo
4. Verify submit still works
5. Set Network: "Offline"
6. Try to fetch feed (will fail)
7. Set Network: "Online"
8. Verify connection auto-recovers
9. Feed loads

**Expected Results:**

- ✓ Works on slow networks
- ✓ Graceful offline handling
- ✓ Auto-reconnect when online
- ✓ No data loss

---

### Scenario 7: Data Persistence - Server Restart

**Steps:**

1. Submit a tattoo from public page
2. Note submission ID
3. SSH into server: `flyctl ssh console -a tattoo-contest`
4. Verify data.json exists: `ls -l data.json`
5. Restart app: `exit` then `flyctl machines restart <id> -a tattoo-contest`
6. Wait 30 seconds for restart
7. Go to public page
8. Verify original submission still visible

**Expected Results:**

- ✓ data.json created on first submission
- ✓ Submissions survive server restart
- ✓ No data loss after restart
- ✓ Admin can view persisted submissions

---

### Scenario 8: Cloudinary Integration

**Steps:**

1. Submit tattoo photo
2. SSH into server
3. Check submission in data.json: `cat data.json | jq '.submissions'`
4. Verify imageUrl is Cloudinary URL (contains `cloudinary.com`)
5. Copy URL, paste in browser
6. Verify image displays

**Expected Results:**

- ✓ Image uploaded to Cloudinary
- ✓ Secure URL returned
- ✓ Image accessible publicly
- ✓ No CORS errors

---

### Scenario 9: High Volume Submissions

**Setup:** Run load test

**Steps:**

1. `npm run load-test` with 100+ concurrent users
2. Monitor metrics
3. Check /health endpoint
4. Verify response times stay under 1000ms
5. Check error rate < 5%

**Expected Results:**

- ✓ System handles 100+ concurrent users
- ✓ Average response time < 500ms
- ✓ P95 response time < 1000ms
- ✓ No memory leaks
- ✓ Error rate < 5%

---

### Scenario 10: File Upload Edge Cases

**Test Cases:**

| Case | File | Expected |
|------|------|----------|
| Large file | 10MB JPG | Upload succeeds (Cloudinary handles) |
| Wrong format | .txt file | Upload fails (no image validation) |
| No file | Submit without photo | Success with null image |
| Corrupted | Damaged JPG | Cloudinary rejects gracefully |
| Duplicate | Same file 2x | Both upload (different IDs) |

---

## Health Check Endpoints

### /health

```bash
curl https://tattoo-contest.fly.dev/health
```

Returns: Basic health status, uptime, memory usage

### /ready

```bash
curl https://tattoo-contest.fly.dev/ready
```

Returns: 200 if ready, 503 if not fully initialized

### /api/metrics (Admin only)

```bash
curl https://tattoo-contest.fly.dev/api/metrics \
  -H "Cookie: <session-cookie>"
```

Returns: Detailed metrics for last hour/day

---

## Performance Baselines

| Metric | Target | Alert |
|--------|--------|-------|
| Avg Response Time | < 200ms | > 1000ms |
| P95 Response Time | < 500ms | > 2000ms |
| P99 Response Time | < 1000ms | > 5000ms |
| Error Rate | < 0.1% | > 5% |
| Uptime | > 99.5% | Any downtime |
| Socket.io Connections | N/A | Growing only |
| Memory Usage | < 200MB | > 500MB |

---

## Monitoring Alerts

Configure these thresholds in monitoring system:

```javascript
// Alert conditions
{
  avgResponseTime > 1000ms: "warning",
  errorRate > 5%: "critical",
  memoryUsage > 80%: "warning",
  uptimePercentage < 99%: "critical",
  socketErrors > 100: "warning"
}
```

---

## Continuous Integration

Run tests on every push:

```yaml
# .github/workflows/test.yml
on: [push, pull_request]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-node@v2
      - run: npm install
      - run: npm test
      - run: npm run test:integration
      - uses: codecov/codecov-action@v2
```

---

## Maintenance Schedule

**Daily:**

- [ ] Check /health endpoint (automated)
- [ ] Review error logs
- [ ] Verify data.json size reasonable

**Weekly:**

- [ ] Run full integration test suite
- [ ] Review performance metrics
- [ ] Check certificate expiry
- [ ] Verify backups exist

**Monthly:**

- [ ] Run load test with 100+ users
- [ ] Test disaster recovery procedures
- [ ] Review and update this document
- [ ] Analyze usage patterns

---

## Known Issues & Workarounds

### Issue: Submissions not appearing in admin

**Cause:** Session cookie not persisted
**Fix:** Ensure cookies enabled, try incognito mode

### Issue: Cloudinary uploads failing

**Cause:** API credentials expired or rate limited
**Fix:** Check .env file, verify API key valid

### Issue: Socket.io events delayed

**Cause:** Connection quality or network congestion
**Fix:** Normal 1-3s delay acceptable, check network quality

### Issue: Winners limit not enforced

**Cause:** Client-side validation failure
**Fix:** Backend enforces max 2, refresh page

---

## Test Reporting

After running tests, generate report:

```bash
# Generate HTML report
npm run test -- --reporter html

# Generate coverage report
npm run test -- --coverage

# Export metrics
curl https://tattoo-contest.fly.dev/api/metrics > metrics_$(date +%s).json
```
