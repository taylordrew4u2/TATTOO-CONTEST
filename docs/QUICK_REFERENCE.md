# Quick Reference - Testing & Validation

## 🚀 Quick Start

```bash
# Run all integration tests locally
npm test

# Run against production
TEST_URL=https://tattoo-contest.fly.dev npm run test:integration

# Run load tests
npm run load-test

# Check app health
curl https://tattoo-contest.fly.dev/health | jq
```

## 📊 What Gets Tested

| Test | Command | Time | Coverage |
|------|---------|------|----------|
| Integration | `npm test` | ~30s | 50+ scenarios |
| Stress Load | `npm run load-test` | 60s | 50 concurrent users |
| Spike Test | `npm run load-test -- --spike` | 5m | 500 concurrent users |
| Memory | `npm run load-test -- --memory` | 5m | Resource leaks |

## ✅ Performance Targets

- **Response Time**: < 200ms avg (alert if > 1s)
- **Error Rate**: < 0.1% (alert if > 5%)
- **Uptime**: > 99.5%
- **Memory**: < 200MB (alert if > 500MB)

## 🏥 Health Endpoints

```bash
# Basic health check (always succeeds)
curl https://tattoo-contest.fly.dev/health

# Readiness check (503 if initializing)
curl https://tattoo-contest.fly.dev/ready

# Detailed metrics (admin only, requires cookie)
curl https://tattoo-contest.fly.dev/api/metrics \
  -H "Cookie: session-cookie"
```

## 📋 Manual Test Checklist

- [ ] **Public Submission**: Go to app, submit tattoo → appears in feed
- [ ] **Admin Login**: Login with `pins2025lol` → see submissions
- [ ] **Winner Selection**: Select 2 winners per category → appears on winners page
- [ ] **Real-time Sync**: Open 2 windows → submit from admin → appears in public < 1s
- [ ] **Category Management**: Add/delete categories → verify persist
- [ ] **Offline Mode**: Disconnect network → reconnect → auto-syncs
- [ ] **High Load**: Run `npm run load-test` → metrics within targets

## 🔍 Troubleshooting

### Tests failing locally

```bash
# Make sure server is running
npm start

# In another terminal
npm test
```

### Tests failing on production

```bash
# Check app is up
curl https://tattoo-contest.fly.dev/health

# Verify admin password
curl https://tattoo-contest.fly.dev/admin
```

### Load test poor performance

```bash
# Check server resources
flyctl ssh console -a tattoo-contest
free -h
top -b -n 1
exit

# Restart if needed
flyctl machines restart <id> -a tattoo-contest
```

### Real-time events delayed

```bash
# Check browser console for Socket.io errors
console.log(socket.connected);

# Verify WebSocket in DevTools > Network tab
# Look for WebSocket connection
```

## 📚 Documentation

| Document | Purpose | Length |
|----------|---------|--------|
| `TESTING_GUIDE.md` | Complete testing guide | 420 lines |
| `TEST_SCENARIOS.md` | Manual procedures | 580 lines |
| `DISASTER_RECOVERY.md` | Recovery runbook | 470 lines |
| `IMPLEMENTATION_SUMMARY.md` | Overview | 379 lines |

## 🚨 Alert Thresholds

```javascript
{
  "response_time_avg > 1000ms": "warning",
  "error_rate > 5%": "critical",
  "memory_usage > 500MB": "warning",
  "socket_errors > 100": "warning",
  "health_check_fail": "critical"
}
```

## 📈 Daily Checks

```bash
# Morning health check
curl https://tattoo-contest.fly.dev/health | jq '.status'

# Weekly full test
TEST_URL=https://tattoo-contest.fly.dev npm run test:integration

# Monthly load test
npm run load-test
```

## 🔧 Common Commands

```bash
# View server logs
flyctl logs -a tattoo-contest --limit 100

# SSH into server
flyctl ssh console -a tattoo-contest

# Restart app
flyctl machines restart <id> -a tattoo-contest

# View metrics
curl https://tattoo-contest.fly.dev/api/metrics

# Test categories
curl https://tattoo-contest.fly.dev/categories.json | jq

# Test feed
curl https://tattoo-contest.fly.dev/api/feed | jq

# Test winners
curl https://tattoo-contest.fly.dev/api/winners | jq
```

## 🎯 Key Test Scenarios

1. **Happy Path**: Submit photo → appears in feed → select as winner → appears on winners page
2. **Concurrent Users**: Load test with 50+ users simultaneously
3. **Spike**: Handle 10x surge (500 users) gracefully
4. **Data Persistence**: Submit → restart → data survives
5. **Real-time Sync**: Multi-device updates within 1 second
6. **Error Handling**: Wrong password → 401 error message
7. **Cloudinary**: Images upload to Cloudinary cloud storage
8. **Network Issues**: Offline/online transitions handled gracefully

## 📞 Support

- **Questions?** Check `TESTING_GUIDE.md` or `TEST_SCENARIOS.md`
- **Failures?** See `DISASTER_RECOVERY.md`
- **Metrics?** Check `/api/metrics` endpoint
- **Logs?** `flyctl logs -a tattoo-contest`

---

**Last Updated**: November 7, 2025
**Status**: ✅ All systems operational and tested
