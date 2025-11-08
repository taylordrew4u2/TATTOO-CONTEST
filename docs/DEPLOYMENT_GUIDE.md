# Fly.io Deployment Guide

## Overview

This guide walks you through deploying the Tattoo Contest application to Fly.io with persistent storage and zero-downtime deployments.

## Prerequisites

1. **Fly.io Account**: Create at <https://fly.io>
2. **Fly CLI**: Install from <https://fly.io/docs/hands-on/install-flyctl/>
3. **Authentication**: Run `flyctl auth login` to authenticate

## Deployment Steps

### Step 1: Create Persistent Volumes

The application requires three persistent volumes to store data, backups, and uploads:

```bash
# Create contest_data volume (1 GB)
# Stores: submissions and winners (data.json)
flyctl volumes create contest_data -r iad -n 2 --app tattoo-contest

# Create contest_backups volume (2 GB)
# Stores: atomic backup snapshots and Write-Ahead Log (WAL) recovery data
flyctl volumes create contest_backups -r iad -n 2 --app tattoo-contest

# Create contest_uploads volume (5 GB)
# Stores: user-uploaded tattoo images (local fallback to Cloudinary)
flyctl volumes create contest_uploads -r iad -n 2 --app tattoo-contest
```

**What the flags mean:**

- `-r iad`: Create volumes in the "iad" (Northern Virginia) region
- `-n 2`: Create 2 copies of each volume for redundancy
- `--app tattoo-contest`: Associate with the tattoo-contest app

**Verify volumes were created:**

```bash
flyctl volumes list --app tattoo-contest
```

Expected output:

```
ID              NAME              SIZE  REGION  CREATED AT
vol_xxxxx       contest_data      1     iad     Nov 8, 2025 10:23:45 UTC
vol_xxxxx       contest_data      1     iad     Nov 8, 2025 10:23:45 UTC
vol_yyyyy       contest_backups   2     iad     Nov 8, 2025 10:25:12 UTC
vol_yyyyy       contest_backups   2     iad     Nov 8, 2025 10:25:12 UTC
vol_zzzzz       contest_uploads   5     iad     Nov 8, 2025 10:26:30 UTC
vol_zzzzz       contest_uploads   5     iad     Nov 8, 2025 10:26:30 UTC
```

### Step 2: Deploy the Application

```bash
fly deploy --app tattoo-contest
```

This command will:

1. Build the Docker image (uses pre-built image if available)
2. Attach the persistent volumes to the instances
3. Start the application instances
4. Run health checks (readiness, liveness, real-time service)
5. Deploy zero-downtime (rolling restart)

### Step 3: Monitor the Deployment

```bash
# Watch logs in real-time
fly logs --app tattoo-contest

# In another terminal, check deployment status
fly status --app tattoo-contest
```

Expected successful logs:

```
2025-11-08T10:30:15.123Z app[abcd1234] info [80] 'GET /health' - - HTTP/1.1 200 - "-" "-" 5ms
2025-11-08T10:30:15.124Z app[abcd1234] info Real-time service initialized
2025-11-08T10:30:15.125Z app[abcd1234] info Listening on port 3000
```

### Step 4: Verify the Application

```bash
# Health check (should return 200 OK)
curl https://tattoo-contest.fly.dev/health

# Real-time service health (should return 200 OK if healthy, 503 if degraded)
curl https://tattoo-contest.fly.dev/api/realtime-health

# Metrics endpoint
curl https://tattoo-contest.fly.dev/api/metrics | jq .

# Visit the application
open https://tattoo-contest.fly.dev
```

## Automated Deployment Script

We provide `deploy.sh` to automate this process:

```bash
# Make it executable
chmod +x deploy.sh

# Run it
./deploy.sh
```

The script will:

1. Check if flyctl is installed
2. Guide you through creating each volume
3. Verify volumes were created
4. Deploy the application
5. Show monitoring commands

## Deployment Architecture

```
┌─────────────────────────────────────────┐
│     Browser / Client Application        │
│  (Real-time Socket.io connection)       │
└──────────────┬──────────────────────────┘
               │ HTTPS / WebSocket
               ↓
┌─────────────────────────────────────────┐
│     Fly.io Load Balancer                │
│  (Automatic SSL/TLS, sticky sessions)   │
└──────────────┬──────────────────────────┘
               │
    ┌──────────┴──────────┐
    ↓                     ↓
┌──────────────┐    ┌──────────────┐
│ Instance 1   │    │ Instance 2   │
│ Node.js App  │    │ Node.js App  │
│ (501 lines)  │    │ (501 lines)  │
└──┬─────────┬─┘    └──┬────────┬──┘
   │         │        │        │
   ↓         ↓        ↓        ↓
┌──────┐ ┌──────┐ ┌──────┐ ┌──────┐
│Vol 1 │ │Vol 1 │ │Vol 1 │ │Vol 1 │
│Data  │ │Back  │ │Upl   │ │Data  │
└──────┘ └──────┘ └──────┘ └──────┘

Volumes: Persistent storage that survive restarts
```

## Features Deployed

### Real-Time Reliability

- ✅ Automatic reconnection with exponential backoff (1s → 30s)
- ✅ Heartbeat monitoring (30s intervals, 45s timeout)
- ✅ Message queuing (1000 per offline client, 5 min TTL)
- ✅ Graceful degradation with fallback recommendations
- ✅ Real-time health monitoring endpoints

### Production Deployment

- ✅ Persistent volumes (data, backups, uploads)
- ✅ Graceful shutdown (30-second cleanup window)
- ✅ Three-tier health checks (readiness, liveness, real-time)
- ✅ Zero-downtime deployments
- ✅ Automatic instance recovery on failure

### Enterprise Features

- ✅ Atomic transactions with Write-Ahead Logging
- ✅ Automatic crash recovery
- ✅ Pre-operation backup snapshots
- ✅ Comprehensive health reporting
- ✅ Performance monitoring and metrics

## Troubleshooting

### Issue: Volumes already exist

If you see an error like "Volume name already exists", you can either:

1. Use different volume names
2. Delete existing volumes: `fly volumes delete contest_data --app tattoo-contest`
3. Check existing volumes: `fly volumes list --app tattoo-contest`

### Issue: Deployment stuck

If deployment seems stuck:

1. Check logs: `fly logs --app tattoo-contest`
2. Check status: `fly status --app tattoo-contest`
3. Force restart: `fly restart --app tattoo-contest`

### Issue: Health checks failing

If health checks are failing:

1. Check real-time health: `curl https://tattoo-contest.fly.dev/api/realtime-health`
2. Check basic health: `curl https://tattoo-contest.fly.dev/health`
3. View logs: `fly logs --app tattoo-contest | grep ERROR`

### Issue: Data not persisting

If data is lost after restart:

1. Verify volumes are attached: `fly status --app tattoo-contest`
2. Check volume mounts: `fly volumes list --app tattoo-contest`
3. Ensure volumes are in same region as app

## Monitoring

### Real-Time Metrics

Access real-time metrics at:

```
GET /api/realtime-metrics
```

Response includes:

- Active WebSocket connections
- Message queue size
- Connection latency
- Reconnection attempts
- Service uptime

### Health Endpoints

- `GET /health` - Basic health check
- `GET /ready` - Readiness probe (checks real-time service + data persistence)
- `GET /api/realtime-health` - Real-time service status (200 or 503)

### Logs

```bash
# Stream live logs
fly logs --app tattoo-contest

# Search for errors
fly logs --app tattoo-contest | grep ERROR

# Last 100 lines
fly logs -n 100 --app tattoo-contest
```

## Rollback Procedure

If you need to rollback to a previous deployment:

```bash
# View recent releases
fly releases --app tattoo-contest

# Rollback to previous version
fly releases rollback --app tattoo-contest
```

## Scaling

### Scale horizontally (add instances)

```bash
# Scale to 2 instances
fly scale count 2 --app tattoo-contest

# Scale to 3 instances
fly scale count 3 --app tattoo-contest
```

**Note**: You'll need to create additional volume copies:

```bash
# Add another copy of each volume for 3rd instance
fly volumes create contest_data -r iad -n 1 --app tattoo-contest
fly volumes create contest_backups -r iad -n 1 --app tattoo-contest
fly volumes create contest_uploads -r iad -n 1 --app tattoo-contest
```

### Scale memory per instance

```bash
fly scale memory 512 --app tattoo-contest
```

## Cost Considerations

**Fly.io Pricing (as of November 2025):**

- Compute: $0.15 per vCPU per month
- RAM: $0.02 per GB per month
- Volumes: $0.15 per GB per month

**Example Cost for 2 Instances:**

- 2 x shared-cpu-2x instances: ~$9/month
- 8 GB RAM (4 per instance): ~$6/month
- 16 GB volumes (1+2+5 GB x 2): ~$2.40/month
- Total: ~$17.40/month

## Next Steps

1. Run volume creation commands
2. Deploy with `fly deploy --app tattoo-contest`
3. Monitor logs and status
4. Verify endpoints are working
5. Test real-time functionality
6. Visit <https://tattoo-contest.fly.dev>

## Support

For issues or questions:

- Fly.io Docs: <https://fly.io/docs/>
- Tattoo Contest Docs: See docs/ directory in repository
- GitHub Issues: <https://github.com/taylordrew4u2/TATTOO-CONTEST/issues>

---

**Deployment Script**: See `deploy.sh` for automated deployment  
**Configuration**: See `fly.toml` for production configuration  
**Documentation**: See `QUICK_STATUS.md` for quick reference
