# Production Deployment Guide

## Overview

This guide covers deploying the Tattoo Contest application to Fly.io with enterprise-grade reliability, persistent storage, and zero-downtime deployments.

## Table of Contents

- [Pre-Deployment Checklist](#pre-deployment-checklist)
- [Fly.io Configuration](#flyio-configuration)
- [Volume Management](#volume-management)
- [Health Checks](#health-checks)
- [Graceful Shutdown](#graceful-shutdown)
- [Memory Management](#memory-management)
- [Auto-Scaling Configuration](#auto-scaling-configuration)
- [Monitoring & Alerting](#monitoring--alerting)
- [Deployment Procedures](#deployment-procedures)
- [Troubleshooting](#troubleshooting)

## Pre-Deployment Checklist

Before deploying to production:

- [ ] All tests pass locally (`npm test`)
- [ ] Load testing completed (`npm run load-test`)
- [ ] Atomic persistence verified
- [ ] Real-time connectivity verified
- [ ] Environment variables configured (ADMIN_USER, ADMIN_PASSWORD)
- [ ] Backup strategy in place
- [ ] Monitoring dashboard accessible
- [ ] Team notified of deployment
- [ ] Rollback plan documented
- [ ] Database backups current

## Fly.io Configuration

The enhanced `fly.toml` includes:

### Key Sections

```toml
# Graceful shutdown - 30 seconds to clean up
kill_timeout = 30
kill_signal = "SIGTERM"

# Persistent volumes for data
[[mounts]]
source = "contest_data"
destination = "/app/data"
initial_size = 1

[[mounts]]
source = "contest_backups"
destination = "/app/backups"
initial_size = 2

[[mounts]]
source = "contest_uploads"
destination = "/app/uploads"
initial_size = 5
```

### Configuration Details

#### Graceful Shutdown

- **kill_timeout**: 30 seconds for application cleanup
- **kill_signal**: SIGTERM triggers graceful shutdown in `server.js`

**How it works:**

1. Fly.io sends SIGTERM signal
2. Application receives signal → calls `realtime.shutdown()`
3. Real-time layer warns all connected clients
4. Closes all WebSocket connections gracefully
5. Atomic persistence saves final state
6. Process exits cleanly within 30 seconds

#### Persistent Volumes

**contest_data** (1 GB)

- Contains: `data.json` (submissions and winners)
- Survives app restarts and deployments
- Critical for data persistence

**contest_backups** (2 GB)

- Contains: Backup snapshots before modifications
- Contains: Write-ahead log (.wal) entries
- Enables crash recovery and rollback

**contest_uploads** (5 GB)

- Contains: User-uploaded images (local fallback)
- Survives app restarts
- Used when Cloudinary temporarily unavailable

### Volume Creation Commands

If volumes don't exist, create them:

```bash
# Create volumes (one-time setup)
fly volumes create contest_data --app tattoo-contest --size 1
fly volumes create contest_backups --app tattoo-contest --size 2
fly volumes create contest_uploads --app tattoo-contest --size 5

# List volumes
fly volumes list --app tattoo-contest

# Check volume usage
fly ssh console --app tattoo-contest
du -sh /app/data /app/backups /app/uploads
```

## Health Checks

Fly.io performs three health checks:

### 1. Readiness Check (`/ready`)

**Purpose**: Verifies application is ready to serve traffic

**Checks**:

- HTTP endpoint accessible
- Real-time service initialized
- Data persistence loaded
- Admin interface ready

**Configuration**:

```toml
[[services.http_checks]]
path = "/ready"
interval = "10s"
timeout = "5s"
grace_period = "10s"
success_threshold = 2
failure_threshold = 3
```

**What triggers unhealthy**:

- 3 consecutive failures (30 seconds total)
- Real-time service unavailable
- Data persistence errors

**Impact**: Instance removed from load balancer, replaced

### 2. Liveness Check (`/health`)

**Purpose**: Verifies application is still running and responsive

**Checks**:

- Express.js server responding
- Basic connectivity
- Memory usage reasonable

**Configuration**:

```toml
[[services.http_checks]]
path = "/health"
interval = "15s"
timeout = "5s"
grace_period = "30s"
success_threshold = 1
failure_threshold = 3
```

**Grace period**: 30 seconds after startup (app startup time)

**Impact**: Instance replaced if unresponsive

### 3. Real-Time Service Check (`/api/realtime-health`)

**Purpose**: Monitors Socket.io reliability layer

**Checks**:

- WebSocket connections active
- Heartbeat monitoring working
- Message queuing operational
- Client reconnection logic ready

**Configuration**:

```toml
[[services.http_checks]]
path = "/api/realtime-health"
interval = "10s"
timeout = "5s"
grace_period = "15s"
success_threshold = 2
failure_threshold = 2
```

**Response Example**:

```json
{
  "status": "healthy",
  "activeConnections": 42,
  "totalConnected": 128,
  "messageQueueSize": 156,
  "averageLatency": 45,
  "uptime": 3600000,
  "lastHeartbeat": 1234567890
}
```

### Monitoring Health Checks

```bash
# View current health status
fly status --app tattoo-contest

# View logs with health check details
fly logs --app tattoo-contest | grep health

# SSH into instance to check local metrics
fly ssh console --app tattoo-contest
curl http://localhost:3000/health
curl http://localhost:3000/ready
curl http://localhost:3000/api/realtime-health
```

## Graceful Shutdown

### How It Works

1. **Shutdown Signal Received**
   - SIGTERM from Fly.io or SIGINT from manual stop
   - Triggers handlers in `server.js` (lines 352-364)

2. **Real-Time Cleanup** (5 seconds)

   ```javascript
   realtime.shutdown();
   // - Notifies all clients of shutdown
   // - Closes message queues
   // - Stops heartbeat monitoring
   // - Disconnects all WebSocket clients
   ```

3. **Persistence Cleanup** (10 seconds)

   ```javascript
   atomicPersistence.saveTransaction();
   // - Saves final game state
   // - Writes atomic transaction
   // - Verifies file integrity
   // - Creates backup snapshot
   ```

4. **Server Close** (5 seconds)

   ```javascript
   server.close();
   // - Stops accepting new connections
   // - Waits for in-flight requests
   // - Closes HTTP server
   ```

5. **Process Exit** (≤30 seconds total)
   - Process exits cleanly
   - Fly.io confirms shutdown
   - New instance starts with restored data

### Testing Graceful Shutdown

```bash
# Start application
npm start

# In another terminal, trigger graceful shutdown
kill -TERM <pid>

# Verify logs show:
# - "Real-time service shutting down..."
# - "Saving final game state..."
# - "HTTP server closed"
# - "Application shutdown complete"

# Restart and verify data restored
npm start
# Check that submissions and winners are still there
```

## Memory Management

### Memory Monitoring

The application monitors memory usage:

```bash
# SSH into instance
fly ssh console --app tattoo-contest

# Check memory usage
free -h
top -b -n 1 | grep node

# Check specific processes
ps aux | grep node
```

### Memory Leak Prevention

**Built-in Safeguards**:

1. **Message Queue Cleanup**
   - Expires messages after 5 minutes
   - Max 1000 messages per offline client
   - Cleanup runs every 60 seconds

2. **Connection Cleanup**
   - Removes idle connections after timeout
   - Stops heartbeat monitoring on disconnect
   - Clears socket references

3. **Garbage Collection Tuning**

   ```bash
   # In Dockerfile (if needed)
   ENV NODE_OPTIONS="--max-old-space-size=512"
   ```

### Memory Limits in fly.toml

Fly.io default: 256 MB per instance

If memory issues occur:

```toml
[resources]
memory_mb = 512  # Increase to 512 MB
cpu_kind = "shared"  # Or "performance" for dedicated CPU
```

### Swap Configuration

```toml
[swap]
size_mb = 512  # Emergency swap space (helps prevent OOM)
```

## Auto-Scaling Configuration

### Current Configuration

Single instance (iad region) - manual scaling

### Scaling Up for High Traffic

```bash
# Scale to 2 instances (active/backup)
fly scale count 2 --app tattoo-contest

# Scale to 3 instances for high load
fly scale count 3 --app tattoo-contest

# Monitor instance status
fly status --app tattoo-contest
```

### Auto-Scaling Setup (Optional)

Fly.io does NOT have automatic scaling yet, but you can:

1. **Monitor metrics**

   ```bash
   fly metrics --app tattoo-contest
   ```

2. **Manual scaling based on load**

   ```bash
   # During peak hours
   fly scale count 2 --app tattoo-contest
   
   # During off-peak
   fly scale count 1 --app tattoo-contest
   ```

3. **Regional distribution** (for global deployment)

   ```bash
   fly regions add lhr  # London
   fly regions add syd  # Sydney
   fly regions add nrt  # Tokyo
   ```

## Monitoring & Alerting

### Metrics Available

Access via `/api/metrics`:

```bash
curl https://tattoo-contest.fly.dev/api/metrics
```

**Key Metrics**:

- Request count and latency
- Error rates
- WebSocket connection count
- Message queue size
- Real-time service health
- Memory usage
- CPU usage

### Real-Time Metrics

Access via `/api/realtime-metrics`:

```bash
curl https://tattoo-contest.fly.dev/api/realtime-metrics
```

**Data**:

- Active WebSocket connections
- Total connected clients
- Queued message count
- Average connection latency
- Reconnection attempts
- Heartbeat failures
- Service uptime

### Health Status

Access via `/api/realtime-health`:

```bash
curl https://tattoo-contest.fly.dev/api/realtime-health
```

**Status**: 200 if healthy, 503 if degraded

### Logging & Monitoring

**Fly.io Logs**:

```bash
# Stream live logs
fly logs --app tattoo-contest

# Search for errors
fly logs --app tattoo-contest | grep ERROR

# View last 100 lines
fly logs --app tattoo-contest -n 100
```

**Monitor Health Checks**:

```bash
# Watch status updates
watch fly status --app tattoo-contest
```

### Setting Up Alerts (External)

Use external monitoring services:

1. **Datadog**
   - Add Fly.io integration
   - Monitor `/api/metrics` endpoint
   - Alert on failures

2. **New Relic**
   - APM integration
   - Monitor Node.js performance
   - Custom dashboards

3. **PagerDuty**
   - Integrate with Datadog/New Relic
   - Page on-call engineers
   - Escalation policies

## Deployment Procedures

### Initial Deployment

```bash
# 1. Login to Fly.io
fly auth login

# 2. Create app (one-time)
fly launch --name tattoo-contest

# 3. Create persistent volumes
fly volumes create contest_data --app tattoo-contest --size 1
fly volumes create contest_backups --app tattoo-contest --size 2
fly volumes create contest_uploads --app tattoo-contest --size 5

# 4. Deploy application
fly deploy --app tattoo-contest

# 5. Verify deployment
fly status --app tattoo-contest
```

### Regular Deployments

```bash
# 1. Commit changes
git add .
git commit -m "Feature: Add production deployment optimization"

# 2. Deploy (with zero downtime)
fly deploy --app tattoo-contest

# 3. Monitor rollout
fly status --app tattoo-contest
fly logs --app tattoo-contest

# 4. Verify functionality
curl https://tattoo-contest.fly.dev/health
curl https://tattoo-contest.fly.dev/api/realtime-health
```

### Rollback Procedure

```bash
# 1. View recent releases
fly releases --app tattoo-contest

# 2. Rollback to previous version
fly releases rollback --app tattoo-contest

# 3. Verify restored functionality
fly status --app tattoo-contest
fly logs --app tattoo-contest
```

### Blue-Green Deployment

For critical updates with zero downtime:

```bash
# 1. Deploy to staging app
fly launch --name tattoo-contest-staging

# 2. Verify in staging
fly status --app tattoo-contest-staging

# 3. Swap DNS (if configured)
# Point DNS to new instance

# 4. Keep old instance as backup
# Monitor for 24 hours before cleanup
```

## Troubleshooting

### Issue: Health Checks Failing

**Symptoms**:

- Instance stuck in "restarting" loop
- Status shows "unhealthy"

**Diagnosis**:

```bash
# View logs for errors
fly logs --app tattoo-contest

# SSH into instance
fly ssh console --app tattoo-contest

# Test health endpoint locally
curl http://localhost:3000/health

# Check error logs
tail -f /app/data/error.log
```

**Solutions**:

- Increase grace_period if app startup is slow
- Check real-time service initialization
- Verify data persistence files readable
- Check available disk space

### Issue: Out of Memory (OOM)

**Symptoms**:

- Sudden instance restart
- "Cannot allocate memory" in logs

**Diagnosis**:

```bash
fly ssh console --app tattoo-contest
free -h
ps aux | grep node
```

**Solutions**:

- Increase memory: `fly scale memory 512`
- Check for memory leaks: `fly logs --app tattoo-contest | grep memory`
- Clear old message queues: Reduce `maxQueueSize`
- Add more instances for load distribution

### Issue: Data Loss on Restart

**Symptoms**:

- Submissions disappear after restart
- Winners reset to empty

**Diagnosis**:

```bash
fly ssh console --app tattoo-contest
ls -la /app/data/
ls -la /app/backups/
```

**Solutions**:

- Verify volumes mounted: `df -h`
- Check atomic persistence: `cat /app/data/data.json`
- Restore from backup: `cp /app/backups/* /app/data/`
- Check file permissions: `chmod 644 /app/data/*`

### Issue: WebSocket Connections Failing

**Symptoms**:

- Real-time updates not working
- Browser console shows connection errors

**Diagnosis**:

```bash
# Check real-time health
curl https://tattoo-contest.fly.dev/api/realtime-health

# Check connection metrics
curl https://tattoo-contest.fly.dev/api/realtime-metrics

# View logs for connection errors
fly logs --app tattoo-contest | grep -i socket
```

**Solutions**:

- Check browser compatibility (modern browsers only)
- Verify firewall allows WebSocket
- Check for proxy/WAF blocking connections
- Restart real-time service: `fly restart --app tattoo-contest`

### Issue: High Latency

**Symptoms**:

- Slow response times
- Real-time updates delayed

**Diagnosis**:

```bash
# Check metrics
curl https://tattoo-contest.fly.dev/api/metrics

# Check instance load
fly ssh console --app tattoo-contest
top -b -n 1

# Check region distance
# (Higher latency in distant regions)
```

**Solutions**:

- Scale to multiple instances: `fly scale count 2`
- Add regional instances closer to users: `fly regions add lhr`
- Optimize database queries
- Enable caching
- Check network conditions

## Performance Tuning

### Node.js Optimization

In `Dockerfile`:

```dockerfile
ENV NODE_ENV=production
ENV NODE_OPTIONS="--max-old-space-size=512"
```

### Connection Pooling

Currently configured in `server.js`:

```javascript
const realtime = new RealtimeReliability(io, {
  heartbeatInterval: 30000,      // Reduce to 20000 for faster detection
  heartbeatTimeout: 45000,        // Reduce to 30000 for faster failover
  maxQueueSize: 1000,             // Reduce to 500 to save memory
  initialBackoffDelay: 1000,
  backoffMultiplier: 2,
  maxBackoffDelay: 30000
});
```

### Volume Performance

Monitor volume usage:

```bash
fly ssh console --app tattoo-contest
du -sh /app/data /app/backups /app/uploads
```

If volumes fill up:

```bash
# Increase volume size
fly volumes extend <volume-id> --size 10
```

## Backup & Recovery

### Automatic Backups

- **Location**: `/app/backups/`
- **Frequency**: Before each modification
- **Retention**: Latest 50 snapshots
- **Format**: JSON snapshots of entire application state

### Manual Backup

```bash
fly ssh console --app tattoo-contest
tar -czf /app/backups/manual-backup-$(date +%s).tar.gz /app/data/

# Download backup
fly sftp shell --app tattoo-contest
get /app/backups/manual-backup-*.tar.gz
```

### Recovery Procedure

```bash
# 1. SSH into instance
fly ssh console --app tattoo-contest

# 2. Stop application
# (if needed) systemctl stop tattoo-contest

# 3. Restore from backup
cp /app/backups/backup-*.json /app/data/data.json

# 4. Verify restored data
cat /app/data/data.json | jq .

# 5. Restart application
fly restart --app tattoo-contest
```

## Security Considerations

### Environment Variables

Store sensitive data in Fly.io secrets:

```bash
fly secrets set ADMIN_USER=admin --app tattoo-contest
fly secrets set ADMIN_PASSWORD=secure_password --app tattoo-contest
fly secrets set CLOUDINARY_URL=cloudinary://... --app tattoo-contest
```

### Backup Security

- Backups stored in persistent volumes
- Consider encryption for sensitive data
- Regular backup testing and recovery drills

### HTTPS

- Fly.io automatically provides HTTPS
- Free SSL certificate
- Automatic renewal

## Deployment Checklist

Before each production deployment:

```markdown
- [ ] Code reviewed and tested
- [ ] All tests passing
- [ ] Load test completed
- [ ] Backup current state
- [ ] Update deployment issue
- [ ] Notify team
- [ ] Deploy to production
- [ ] Monitor logs (5 minutes)
- [ ] Verify health checks
- [ ] Test core functionality
- [ ] Verify real-time connectivity
- [ ] Check data persistence
- [ ] Monitor metrics (24 hours)
- [ ] Document any issues
- [ ] Archive deployment notes
```

## Next Steps

1. Deploy with enhanced fly.toml configuration
2. Monitor health checks for 24 hours
3. Test graceful shutdown and recovery
4. Document any issues or improvements
5. Set up external monitoring (optional)
6. Create runbook for on-call team

## Support & Troubleshooting

For issues:

1. Check logs: `fly logs --app tattoo-contest`
2. Verify health: `fly status --app tattoo-contest`
3. Check metrics: `curl https://tattoo-contest.fly.dev/api/metrics`
4. Review this guide
5. Contact Fly.io support if needed

---

**Last Updated**: Production Deployment Guide v1.0
**Configuration Version**: fly.toml v2.0 with volumes and health checks
**Status**: Production-ready
