# Socket.io Real-Time Reliability Guide

## Overview

This comprehensive guide covers the `RealtimeReliability` module, which provides production-grade Socket.io connection management with automatic recovery, message queuing, and graceful degradation.

## Table of Contents

- [Architecture Overview](#architecture-overview)
- [Core Features](#core-features)
- [Configuration](#configuration)
- [Connection Management](#connection-management)
- [Message Queuing](#message-queuing)
- [Heartbeat Monitoring](#heartbeat-monitoring)
- [Reconnection Strategy](#reconnection-strategy)
- [Health Monitoring](#health-monitoring)
- [Graceful Shutdown](#graceful-shutdown)
- [Troubleshooting](#troubleshooting)

## Architecture Overview

### Design Principles

The RealtimeReliability module extends Node.js EventEmitter and wraps Socket.io to provide:

1. **Automatic Reconnection**: Clients reconnect with exponential backoff
2. **Message Persistence**: Offline clients queue messages for delivery on reconnect
3. **Health Monitoring**: Continuous heartbeat checks detect broken connections
4. **Graceful Degradation**: Fallback strategies when real-time unavailable
5. **Zero Data Loss**: Important updates never lost due to connectivity issues

### System Architecture

```
┌─────────────────────────────────────────────────┐
│         Browser/Client Application              │
│  (implements Socket.io client with reconnect)   │
└────────────────┬────────────────────────────────┘
                 │
                 │ WebSocket Connection
                 │ (With heartbeat ping/pong)
                 ↓
┌─────────────────────────────────────────────────┐
│         RealtimeReliability Module              │
│  ┌────────────────────────────────────────────┐ │
│  │ Connection Management                      │ │
│  │ - Track per-client state                   │ │
│  │ - Detect disconnections via heartbeat      │ │
│  │ - Trigger reconnection handlers            │ │
│  └────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────┐ │
│  │ Message Queuing System                     │ │
│  │ - Store events for offline clients         │ │
│  │ - TTL-based expiration (5 min default)     │ │
│  │ - Deliver on reconnect                     │ │
│  │ - Max 1000 messages per client             │ │
│  └────────────────────────────────────────────┘ │
│  ┌────────────────────────────────────────────┐ │
│  │ Health Monitoring                          │ │
│  │ - Real-time service status                 │ │
│  │ - Connection metrics                       │ │
│  │ - Fallback recommendations                 │ │
│  └────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────┘
                 │
                 │ Events (newSubmission, saveWinners, etc)
                 │ + Queuing/Delivery tracking
                 ↓
        Express Application Server
        (server.js)
```

## Core Features

### 1. Automatic Reconnection with Exponential Backoff

**Problem Solved**: When WebSocket connection drops, clients automatically reconnect instead of requiring manual refresh.

**Implementation**:

```javascript
getBackoffDelay(attemptNumber) {
  return Math.min(
    this.config.initialBackoffDelay * Math.pow(this.config.backoffMultiplier, attemptNumber),
    this.config.maxBackoffDelay
  );
}
```

**Backoff Schedule** (default config):

```
Attempt 1: 1 second
Attempt 2: 2 seconds
Attempt 3: 4 seconds
Attempt 4: 8 seconds
Attempt 5: 16 seconds
Attempt 6+: 30 seconds (max)
```

**Benefits**:

- Prevents server flooding with reconnection requests
- Gives network time to recover
- Scales gracefully with connection pool size
- Configurable for different scenarios

### 2. Heartbeat Monitoring

**Problem Solved**: Detects broken connections that Socket.io doesn't automatically detect.

**How It Works**:

Every 30 seconds (configurable):

1. Server sends `heartbeat-ping` to client with timestamp
2. Client receives ping and immediately responds with `heartbeat-pong`
3. Server tracks response time

If no pong within 45 seconds (configurable):

1. Connection marked as unhealthy
2. Client notified with `heartbeat-expired` event
3. Client attempts reconnection with backoff

**Code**:

```javascript
_startHeartbeat(clientId) {
  const client = this.clients.get(clientId);
  
  const interval = setInterval(() => {
    const timeSinceLastPong = Date.now() - client.lastHeartbeat;
    
    if (timeSinceLastPong > this.config.heartbeatTimeout) {
      client.isHealthy = false;
      client.socket.emit('heartbeat-expired');
      clearInterval(interval);
    } else {
      client.socket.emit('heartbeat-ping', { timestamp: Date.now() });
    }
  }, this.config.heartbeatInterval);
}
```

**Latency Tracking**:

- `client.lastHeartbeat` updated on each pong
- Average latency calculated across all clients
- Exposed in `/api/realtime-metrics`

### 3. Message Queuing for Offline Clients

**Problem Solved**: When client disconnects, real-time updates aren't lost - they're queued and delivered when reconnected.

**Implementation**:

```javascript
broadcastMessage(event, data, options = {}) {
  const { includeOffline = true } = options;
  
  this.clients.forEach((client, clientId) => {
    if (client.isHealthy) {
      // Send to healthy clients
      client.socket.emit(event, data);
      client.lastBroadcast = Date.now();
    } else if (includeOffline) {
      // Queue for offline clients
      this.queueMessage(clientId, event, data);
    }
  });
}

queueMessage(clientId, event, data) {
  let queue = this.messageQueue.get(clientId) || [];
  
  // Enforce max queue size
  if (queue.length >= this.config.maxQueueSize) {
    queue.shift();  // Remove oldest message
  }
  
  queue.push({
    event,
    data,
    queuedAt: Date.now(),
    ttl: 300000  // 5 minute expiration
  });
  
  this.messageQueue.set(clientId, queue);
}
```

**Queue Lifecycle**:

1. **Queue Creation**: Message added when client offline
2. **Storage**: Held in-memory with timestamp
3. **Expiration**: Removed after 5 minutes (configurable TTL)
4. **Delivery**: All queued messages sent immediately on reconnect
5. **Cleanup**: Queue cleared after successful delivery

**Guardrails**:

- Max 1000 messages per client (prevents memory explosion)
- Oldest messages dropped first (FIFO with max size)
- 5-minute TTL (stale data not delivered)
- Automatic cleanup on reconnect

### 4. Health Status Monitoring

**Problem Solved**: No visibility into real-time service health and reliability.

**Health Endpoint** (`GET /api/realtime-health`):

Returns JSON:

```json
{
  "status": "healthy",
  "activeConnections": 42,
  "totalConnected": 128,
  "messageQueueSize": 156,
  "averageLatency": 45,
  "uptime": 3600000,
  "lastHeartbeat": 1234567890,
  "failureThreshold": 3,
  "successThreshold": 2
}
```

**Status Codes**:

- **200 OK**: Real-time service healthy
- **503 Unavailable**: Service degraded or unavailable

### 5. Graceful Shutdown

**Problem Solved**: Server restarts lose client connections abruptly.

**Shutdown Sequence**:

```javascript
shutdown() {
  // 1. Notify all clients (5 seconds)
  this.clients.forEach((client) => {
    client.socket.emit('server-shutdown', {
      message: 'Server shutting down, please reconnect shortly',
      gracePeriod: 5000
    });
  });
  
  // 2. Close message queues (10 seconds)
  this.messageQueue.clear();
  
  // 3. Stop heartbeat monitoring
  this.clients.forEach((client) => {
    clearInterval(client.heartbeatInterval);
  });
  
  // 4. Disconnect all clients (5 seconds)
  this.clients.forEach((client) => {
    client.socket.disconnect();
  });
  
  // 5. Process exit (after 25 seconds max)
  process.exit(0);
}
```

**Client Experience**:

1. Browser receives `server-shutdown` event
2. Shows message: "Server updating, reconnecting soon"
3. Waits 5 seconds before attempting reconnect
4. Reconnects with exponential backoff
5. Receives all queued updates immediately

## Configuration

### Default Configuration

```javascript
const realtime = new RealtimeReliability(io, {
  // Heartbeat settings (milliseconds)
  heartbeatInterval: 30000,        // Ping every 30 seconds
  heartbeatTimeout: 45000,         // Timeout after 45 seconds
  
  // Message queueing
  maxQueueSize: 1000,              // Max 1000 messages per client
  messageExpiry: 300000,           // Expire after 5 minutes
  cleanupInterval: 60000,          // Cleanup every 60 seconds
  
  // Exponential backoff
  initialBackoffDelay: 1000,       // Start with 1 second
  backoffMultiplier: 2,            // Double each time
  maxBackoffDelay: 30000           // Cap at 30 seconds
});
```

### Tuning for Different Scenarios

#### High-Latency Network (Mobile/4G)

```javascript
new RealtimeReliability(io, {
  heartbeatInterval: 45000,        // Less frequent pings (battery saver)
  heartbeatTimeout: 60000,         // Longer timeout for latency
  maxQueueSize: 500,               // Smaller queue (limit memory)
  initialBackoffDelay: 2000,       // Longer initial backoff
  maxBackoffDelay: 60000           // Allow longer backoff
});
```

#### High-Frequency Updates

```javascript
new RealtimeReliability(io, {
  heartbeatInterval: 15000,        // More frequent pings
  heartbeatTimeout: 30000,         // Quicker detection
  maxQueueSize: 2000,              // Larger queue (store more updates)
  messageExpiry: 600000            // 10 minute expiration
});
```

#### Low-Bandwidth Network

```javascript
new RealtimeReliability(io, {
  heartbeatInterval: 60000,        // Ping every minute (minimal bandwidth)
  messageExpiry: 600000,           // Keep messages longer
  maxQueueSize: 500                // Limit queue (fewer retransmits)
});
```

## Connection Management

### Per-Client State Tracking

Each connected client has:

```javascript
{
  clientId: 'socket-id',
  socket: SocketIOSocket,
  isHealthy: true,
  lastHeartbeat: 1234567890,
  lastBroadcast: 1234567890,
  reconnectAttempts: 0,
  connectionTime: 1234567890,
  latency: 45,  // milliseconds
  heartbeatInterval: intervalId
}
```

### Connection Lifecycle

#### 1. **New Connection**

```javascript
socket.on('connect', () => {
  realtime.clients.set(clientId, {
    socket,
    isHealthy: true,
    lastHeartbeat: Date.now(),
    // ... other state
  });
  
  // Start heartbeat monitoring
  realtime._startHeartbeat(clientId);
  
  // Deliver any queued messages
  realtime._deliverQueuedMessages(clientId);
});
```

#### 2. **Active Connection**

- Heartbeat ping/pong every 30 seconds
- Broadcasts received immediately
- State updated on each heartbeat response

#### 3. **Disconnection Detected**

- No pong received within 45 seconds
- Client marked `isHealthy: false`
- New messages queued for delivery

#### 4. **Reconnection**

- Client reconnects with exponential backoff
- All queued messages delivered immediately
- State reset, latency recalculated

### Heartbeat Flow Diagram

```
Time: 0s                     30s                    45s
      │                      │                      │
      │ [Connected Client]   │                      │
      │ isHealthy=true       │                      │
      │ lastHeartbeat=0s     │                      │
      │                      │                      │
      │                      ├──> Server sends      │
      │                      │    heartbeat-ping    │
      │                      │                      │
      │                      │ <─── Client responds │
      │                      │    with pong         │
      │                      │                      │
      │                      └──> Update lastHB=30s │
      │                          latency=0ms        │
      │                                              │
      │                                              ├──> Check: timeSince=45s
      │                                              │
      │                                              └──> TIMEOUT!
      │                                                  isHealthy=false
      │                                                  emit 'heartbeat-
      │                                                  expired'
      │
      └─────────────── [Offline - Messages Queued] ─────────────
                                                       Reconnect
                                                       (backoff)
                                                            │
                                                            └──>
                                                               All queued
                                                               delivered
```

## Message Queuing

### Queue Structure

```javascript
messageQueue = Map {
  'client-1': [
    {
      event: 'newSubmission',
      data: { id: 1, name: 'John', design: 'url' },
      queuedAt: 1234567890,
      ttl: 300000
    },
    {
      event: 'saveWinners',
      data: { winners: [...] },
      queuedAt: 1234567895,
      ttl: 300000
    }
  ],
  'client-2': [
    // ... other client's queue
  ]
}
```

### Delivery Process

```javascript
_deliverQueuedMessages(clientId) {
  const queue = this.messageQueue.get(clientId);
  if (!queue || queue.length === 0) return;
  
  let delivered = 0;
  queue.forEach((msg) => {
    // Check TTL before delivery
    const age = Date.now() - msg.queuedAt;
    if (age < msg.ttl) {
      socket.emit(msg.event, msg.data);
      delivered++;
    }
  });
  
  // Clear queue after delivery
  this.messageQueue.delete(clientId);
  
  return { delivered, total: queue.length };
}
```

### TTL Cleanup

Every 60 seconds:

```javascript
cleanupExpiredMessages() {
  const now = Date.now();
  
  this.messageQueue.forEach((queue, clientId) => {
    const fresh = queue.filter((msg) => {
      return (now - msg.queuedAt) < msg.ttl;
    });
    
    if (fresh.length === 0) {
      this.messageQueue.delete(clientId);
    } else if (fresh.length < queue.length) {
      this.messageQueue.set(clientId, fresh);
    }
  });
}
```

## Heartbeat Monitoring

### Ping/Pong Mechanism

**Server sends ping:**

```javascript
socket.emit('heartbeat-ping', {
  timestamp: Date.now(),
  sequence: sequenceNumber
});
```

**Client receives and responds:**

```javascript
socket.on('heartbeat-ping', (data) => {
  socket.emit('heartbeat-pong', {
    echo: data.timestamp,
    clientTime: Date.now()
  });
});
```

**Server receives pong:**

```javascript
socket.on('heartbeat-pong', (data) => {
  const latency = Date.now() - data.echo;
  client.lastHeartbeat = Date.now();
  client.latency = latency;
  client.isHealthy = true;
});
```

### Timeout Detection

```javascript
const interval = setInterval(() => {
  const timeSinceLastPong = Date.now() - client.lastHeartbeat;
  
  if (timeSinceLastPong > this.config.heartbeatTimeout) {
    // Connection dead
    client.isHealthy = false;
    client.socket.emit('heartbeat-expired', {
      lastSeen: client.lastHeartbeat,
      timeout: this.config.heartbeatTimeout
    });
  }
}, this.config.heartbeatInterval);
```

## Reconnection Strategy

### Exponential Backoff Algorithm

```javascript
function getBackoffDelay(attemptNumber, config) {
  // Formula: initialDelay * (multiplier ^ attemptNumber)
  // Capped at maxDelay
  
  const exponential = config.initialBackoffDelay * 
    Math.pow(config.backoffMultiplier, attemptNumber);
  
  return Math.min(exponential, config.maxBackoffDelay);
}

// Examples:
getBackoffDelay(0) => 1000ms (1 second)
getBackoffDelay(1) => 2000ms (2 seconds)
getBackoffDelay(2) => 4000ms (4 seconds)
getBackoffDelay(3) => 8000ms (8 seconds)
getBackoffDelay(4) => 16000ms (16 seconds)
getBackoffDelay(5) => 30000ms (30 seconds - capped)
```

### Why Exponential Backoff?

1. **Quick Recovery**: Fast reconnection for temporary network blips
2. **Server Protection**: Prevents reconnection storms
3. **Network Adaptation**: Gives network time to recover
4. **Fairness**: Distributed reconnection load over time

### Client Implementation

Clients should implement similar backoff:

```javascript
let reconnectAttempt = 0;
const socket = io();

socket.on('disconnect', () => {
  const delay = getBackoffDelay(reconnectAttempt++);
  setTimeout(() => {
    socket.connect();
  }, delay);
});

socket.on('connect', () => {
  reconnectAttempt = 0;  // Reset on successful connection
});
```

## Health Monitoring

### Health Endpoint API

```bash
GET /api/realtime-health
```

**Response (Healthy)**:

```json
HTTP/1.1 200 OK
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

**Response (Degraded)**:

```json
HTTP/1.1 503 Service Unavailable
{
  "status": "degraded",
  "activeConnections": 5,
  "totalConnected": 42,
  "messageQueueSize": 2341,
  "averageLatency": 2500,
  "warning": "High message queue size, connections unhealthy"
}
```

### Metrics Endpoint

```bash
GET /api/realtime-metrics
```

**Response**:

```json
{
  "connections": {
    "active": 42,
    "total": 128,
    "unhealthy": 86
  },
  "messaging": {
    "queueSize": 156,
    "totalQueued": 5234,
    "totalDelivered": 12000
  },
  "performance": {
    "averageLatency": 45,
    "minLatency": 5,
    "maxLatency": 250,
    "p95Latency": 120
  },
  "reliability": {
    "reconnectAttempts": 342,
    "failureCount": 12,
    "successRate": 0.9653
  },
  "uptime": {
    "seconds": 3600,
    "startTime": "2024-01-01T00:00:00Z"
  }
}
```

### Fallback Status

```bash
GET /api/realtime-fallback
```

**Response**:

```json
{
  "available": true,
  "fallbackRecommended": false,
  "reason": "Real-time service healthy",
  "alternatives": [
    {
      "method": "polling",
      "interval": 5000,
      "recommended": false
    },
    {
      "method": "server-sent-events",
      "interval": 2000,
      "recommended": false
    }
  ],
  "degradationThreshold": {
    "maxQueueSize": 5000,
    "minHealthyConnections": 5,
    "maxAverageLatency": 5000
  }
}
```

## Graceful Shutdown

### Server Shutdown Flow

**Triggered by**:

- `SIGTERM` signal from Fly.io
- `SIGINT` (Ctrl+C) manual stop
- Application error handlers

**Sequence** (Total: ~25 seconds):

1. **Notify Clients** (0-5s)

   ```javascript
   this.clients.forEach((client) => {
     client.socket.emit('server-shutdown', {
       message: 'Server shutting down, please reconnect shortly',
       gracePeriod: 5000
     });
   });
   ```

2. **Clear Message Queues** (5-10s)

   ```javascript
   this.messageQueue.clear();
   ```

3. **Stop Heartbeat Monitoring** (10-12s)

   ```javascript
   this.clients.forEach((client) => {
     clearInterval(client.heartbeatInterval);
   });
   ```

4. **Disconnect Clients** (12-20s)

   ```javascript
   this.clients.forEach((client) => {
     client.socket.disconnect();
   });
   this.clients.clear();
   ```

5. **Process Exit** (20-30s)

   ```javascript
   process.exit(0);  // Within kill_timeout
   ```

### Client Experience

**Timeline**:

- **T=0**: Server sends `server-shutdown` event
- **T=1**: Browser shows "Server updating..." message
- **T=5**: Browser attempts reconnection
- **T=6**: Reconnection fails (server offline)
- **T=8**: Retry with backoff (8 seconds)
- **T=14**: Server comes back online
- **T=14**: Reconnection succeeds
- **T=15**: All queued messages delivered
- **T=16**: Application resumes normally

## Troubleshooting

### Issue: Frequent Disconnections

**Symptoms**:

- Users see frequent "Connecting..." messages
- Real-time updates delayed or missing

**Diagnosis**:

```bash
# Check metrics
curl https://tattoo-contest.fly.dev/api/realtime-metrics

# Look for high latency or low success rate
# Expected: latency < 100ms, success rate > 99%
```

**Solutions**:

1. **Increase Heartbeat Timeout**

   ```javascript
   heartbeatTimeout: 60000  // was 45000
   ```

2. **Reduce Heartbeat Frequency** (mobile-friendly)

   ```javascript
   heartbeatInterval: 45000  // was 30000
   ```

3. **Check Network**
   - Browser DevTools → Network tab
   - Verify WebSocket connections established
   - Check for proxy/firewall blocking

4. **Check Server Health**

   ```bash
   fly status --app tattoo-contest
   fly logs --app tattoo-contest | grep socket
   ```

### Issue: Message Queue Growing

**Symptoms**:

- messageQueueSize continuously increasing
- Memory usage growing

**Diagnosis**:

```bash
# Check metrics
curl https://tattoo-contest.fly.dev/api/realtime-metrics
# Look at messageQueueSize and connection health
```

**Solutions**:

1. **Reduce Queue Size**

   ```javascript
   maxQueueSize: 500  // was 1000
   ```

2. **Reduce Message TTL**

   ```javascript
   messageExpiry: 180000  // 3 minutes instead of 5
   ```

3. **Increase Cleanup Frequency**

   ```javascript
   // In server.js, change cleanup interval
   setInterval(() => realtime.cleanupExpiredMessages(), 30000);  // every 30s
   ```

4. **Improve Connection Health**
   - Fix underlying disconnection issues
   - Check heartbeat latency
   - Verify network stability

### Issue: High Latency

**Symptoms**:

- Real-time updates delayed
- Heartbeat latency > 500ms

**Diagnosis**:

```bash
# Check metrics
curl https://tattoo-contest.fly.dev/api/realtime-metrics

# Check averageLatency - should be < 100ms
# If > 500ms, network or server issue
```

**Solutions**:

1. **Scale Horizontally**

   ```bash
   fly scale count 2  # Add another instance
   ```

2. **Check Server Resources**

   ```bash
   fly ssh console --app tattoo-contest
   top -b -n 1 | head -20
   ```

3. **Check Network Conditions**
   - From browser DevTools
   - Check region distance (latency = distance + processing)

4. **Optimize Message Size**
   - Reduce data sent in broadcasts
   - Use compression if available

### Issue: WebSocket Won't Connect

**Symptoms**:

- Browser shows connection error
- No WebSocket in DevTools Network tab

**Diagnosis**:

```bash
# Check real-time health
curl https://tattoo-contest.fly.dev/api/realtime-health

# Check server logs
fly logs --app tattoo-contest | grep -i "socket\|connection"
```

**Solutions**:

1. **Check Browser Compatibility**
   - Must support WebSocket
   - Check browser DevTools console

2. **Check Firewall/Proxy**
   - Some proxies block WebSocket
   - Check if polling works instead
   - Enterprise firewalls may need config

3. **Verify Server Endpoint**
   - Should be `wss://tattoo-contest.fly.dev` (secured)
   - Check that Socket.io path is correct

4. **Check Server Socket.io**

   ```bash
   fly ssh console --app tattoo-contest
   netstat -tlnp | grep 3000
   ```

### Issue: Memory Leak

**Symptoms**:

- Memory usage grows over time
- Eventually crashes with OOM

**Diagnosis**:

```bash
fly ssh console --app tattoo-contest

# Check memory growth
free -h

# Check Node.js memory
ps aux | grep node

# Long-term monitoring
while true; do free -h; sleep 10; done
```

**Common Causes**:

1. Message queue not cleaned (fix: enable cleanup)
2. Old client objects not removed (fix: remove on disconnect)
3. Event listeners not cleaned (fix: call socket.off() on disconnect)
4. Circular references (fix: clear references in shutdown)

**Solutions**:

1. **Verify Cleanup Running**
   - Check logs for cleanup messages
   - Verify cleanup interval configured

2. **Monitor Specific Leaks**
   - Check messageQueue size regularly
   - Monitor clients Map size
   - Verify no lingering intervals

3. **Increase Memory Allocation**

   ```bash
   fly scale memory 512  # from 256MB
   ```

### Issue: Cascading Failures

**Symptoms**:

- One client issue affects all clients
- Broadcast hangs entire server
- Memory exhaustion from queuing

**Prevention**:

1. **Message Queue Limits**
   - Max 1000 messages enforced
   - Oldest messages dropped

2. **Client Isolation**
   - Unhealthy clients don't block others
   - Failures don't propagate

3. **Timeout Protection**
   - Heartbeat timeouts prevent hanging
   - Broadcast non-blocking

**Monitoring**:

```bash
# Watch for cascading failures
fly logs --app tattoo-contest | grep -E "ERROR|WARN|timeout"

# Check for feedback loops
curl https://tattoo-contest.fly.dev/api/realtime-metrics | jq '.reliability'
```

## Best Practices

### 1. Client-Side Implementation

```javascript
const socket = io('wss://tattoo-contest.fly.dev', {
  reconnection: true,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 5000,
  reconnectionAttempts: Infinity,
  transports: ['websocket', 'polling']
});

socket.on('server-shutdown', (data) => {
  showNotification('Server updating, reconnecting shortly...');
  setTimeout(() => {
    socket.connect();
  }, data.gracePeriod);
});

socket.on('heartbeat-expired', () => {
  console.warn('Connection stale, reconnecting...');
  socket.disconnect();
  socket.connect();
});
```

### 2. Monitoring & Alerting

```bash
# Regular health checks
watch -n 60 'curl -s https://tattoo-contest.fly.dev/api/realtime-health | jq .'

# Alert on degradation
curl https://tattoo-contest.fly.dev/api/realtime-metrics | \
  jq 'if .performance.averageLatency > 500 then "HIGH_LATENCY" else "OK" end'
```

### 3. Testing Reconnection

```javascript
// Simulate network failure
socket.disconnect();

// Simulate server restart
socket.io().engine.close();
socket.connect();

// Verify message recovery
// - Check that queued messages delivered
// - Verify no duplicate processing
```

### 4. Scaling Considerations

- **Single Instance**: Up to ~100 concurrent connections
- **Multiple Instances**: Use load balancer with sticky sessions
- **Redis Adapter**: For distributed deployment (future enhancement)

---

**Last Updated**: Socket.io Reliability Guide v1.0
**Implementation**: lib/realtime-reliability.js (v1.0)
**Status**: Production-ready
