42
/**
 * Real-Time Reliability Module
 * 
 * Provides Socket.io resilience with:
 * - WebSocket reconnection logic with exponential backoff
 * - Heartbeat monitoring to detect broken connections
 * - Message queuing for offline clients
 * - Graceful degradation when real-time fails
 * - Health checks for real-time service status
 */

const EventEmitter = require('events');

class RealtimeReliability extends EventEmitter {
  constructor(io, options = {}) {
    super();
    
    this.io = io;
    this.connectedClients = new Map();
    this.messageQueue = new Map();
    this.heartbeatIntervals = new Map();
    
    // Configuration
    this.config = {
      heartbeatInterval: options.heartbeatInterval || 30000, // 30 seconds
      heartbeatTimeout: options.heartbeatTimeout || 45000, // 45 seconds
      maxQueueSize: options.maxQueueSize || 1000, // Max messages per client
      maxBackoffDelay: options.maxBackoffDelay || 30000, // 30 seconds max
      initialBackoffDelay: options.initialBackoffDelay || 1000, // 1 second initial
      backoffMultiplier: options.backoffMultiplier || 2,
      enableQueueing: options.enableQueueing !== false, // Default true
      enableHeartbeat: options.enableHeartbeat !== false, // Default true
      enableMetrics: options.enableMetrics !== false // Default true
    };
    
    // Metrics
    this.metrics = {
      totalConnections: 0,
      activeConnections: 0,
      messagesQueued: 0,
      messagesDelivered: 0,
      heartbeatFailures: 0,
      reconnections: 0,
      startTime: Date.now()
    };
    
    console.log('✅ RealtimeReliability initialized');
    console.log(`   Heartbeat interval: ${this.config.heartbeatInterval}ms`);
    console.log(`   Max backoff delay: ${this.config.maxBackoffDelay}ms`);
    console.log(`   Message queueing: ${this.config.enableQueueing ? 'enabled' : 'disabled'}`);
  }

  /**
   * Initialize connection handling
   */
  initializeConnections() {
    this.io.on('connection', (socket) => {
      const clientId = socket.id;
      
      console.log(`📡 Client connected: ${clientId}`);
      this.metrics.totalConnections++;
      this.metrics.activeConnections++;

      // Store client connection
      this.connectedClients.set(clientId, {
        socket: socket,
        connectedAt: Date.now(),
        lastHeartbeat: Date.now(),
        backoffAttempts: 0,
        isHealthy: true,
        messageCount: 0
      });

      // Handle client events
      socket.on('disconnect', () => this._handleDisconnect(clientId));
      socket.on('heartbeat-pong', () => this._handleHeartbeatPong(clientId));
      socket.on('error', (err) => this._handleSocketError(clientId, err));
      socket.on('reconnect', () => this._handleReconnect(clientId));

      // Emit connection event
      this.emit('clientConnected', { clientId, timestamp: Date.now() });

      // Start heartbeat for this client
      if (this.config.enableHeartbeat) {
        this._startHeartbeat(clientId);
      }

      // Send any queued messages
      this._deliverQueuedMessages(clientId);
    });

    console.log('✅ Connection handlers initialized');
  }

  /**
   * Start heartbeat monitoring for a client
   */
  _startHeartbeat(clientId) {
    // Clear existing heartbeat if any
    if (this.heartbeatIntervals.has(clientId)) {
      clearInterval(this.heartbeatIntervals.get(clientId));
    }

    const interval = setInterval(() => {
      const client = this.connectedClients.get(clientId);
      
      if (!client) {
        clearInterval(interval);
        this.heartbeatIntervals.delete(clientId);
        return;
      }

      const timeSinceLastPong = Date.now() - client.lastHeartbeat;

      // Check if heartbeat timeout exceeded
      if (timeSinceLastPong > this.config.heartbeatTimeout) {
        console.warn(`⚠️  Heartbeat timeout for ${clientId} (${timeSinceLastPong}ms)`);
        this.metrics.heartbeatFailures++;
        client.isHealthy = false;
        
        // Attempt to force reconnect
        try {
          client.socket.emit('heartbeat-expired');
        } catch (err) {
          console.error(`❌ Failed to emit heartbeat-expired to ${clientId}:`, err.message);
        }
      } else {
        // Send heartbeat ping
        try {
          client.socket.emit('heartbeat-ping', {
            timestamp: Date.now(),
            serverUptime: process.uptime(),
            activeConnections: this.metrics.activeConnections
          });
        } catch (err) {
          console.error(`❌ Failed to emit heartbeat-ping to ${clientId}:`, err.message);
        }
      }
    }, this.config.heartbeatInterval);

    this.heartbeatIntervals.set(clientId, interval);
    console.log(`💓 Heartbeat started for ${clientId}`);
  }

  /**
   * Handle heartbeat pong response
   */
  _handleHeartbeatPong(clientId) {
    const client = this.connectedClients.get(clientId);
    
    if (client) {
      client.lastHeartbeat = Date.now();
      client.isHealthy = true;
      
      if (client.backoffAttempts > 0) {
        console.log(`✅ Client ${clientId} recovered (was at backoff attempt ${client.backoffAttempts})`);
        client.backoffAttempts = 0;
      }
    }
  }

  /**
   * Handle socket disconnect
   */
  _handleDisconnect(clientId) {
    console.log(`📴 Client disconnected: ${clientId}`);
    this.metrics.activeConnections = Math.max(0, this.metrics.activeConnections - 1);

    // Clear heartbeat
    if (this.heartbeatIntervals.has(clientId)) {
      clearInterval(this.heartbeatIntervals.get(clientId));
      this.heartbeatIntervals.delete(clientId);
    }

    // Keep messages in queue for offline client
    const client = this.connectedClients.get(clientId);
    if (client) {
      client.isHealthy = false;
      console.log(`📦 Message queue retained for ${clientId} (${this.messageQueue.get(clientId)?.length || 0} messages)`);
    }

    this.emit('clientDisconnected', { clientId, timestamp: Date.now() });
  }

  /**
   * Handle socket error
   */
  _handleSocketError(clientId, error) {
    console.error(`❌ Socket error for ${clientId}:`, error.message);
    
    const client = this.connectedClients.get(clientId);
    if (client) {
      client.isHealthy = false;
      client.backoffAttempts++;
    }

    this.emit('socketError', { clientId, error: error.message });
  }

  /**
   * Handle reconnection
   */
  _handleReconnect(clientId) {
    console.log(`🔄 Client reconnected: ${clientId}`);
    this.metrics.reconnections++;
    
    const client = this.connectedClients.get(clientId);
    if (client) {
      client.isHealthy = true;
      client.backoffAttempts = 0;
      client.lastHeartbeat = Date.now();
    }

    this.emit('clientReconnected', { clientId, timestamp: Date.now() });
  }

  /**
   * Queue a message for a specific client
   * Message will be sent when client connects or immediately if connected
   */
  queueMessage(clientId, event, data, options = {}) {
    if (!this.config.enableQueueing) {
      // Try to send immediately without queueing
      return this._sendToClient(clientId, event, data, options);
    }

    // Get or create queue for this client
    if (!this.messageQueue.has(clientId)) {
      this.messageQueue.set(clientId, []);
    }

    const queue = this.messageQueue.get(clientId);

    // Check queue size
    if (queue.length >= this.config.maxQueueSize) {
      console.warn(`⚠️  Message queue full for ${clientId}, dropping oldest message`);
      queue.shift();
    }

    const message = {
      event,
      data,
      queuedAt: Date.now(),
      ttl: options.ttl || 300000, // 5 minutes default TTL
      priority: options.priority || 0
    };

    queue.push(message);
    this.metrics.messagesQueued++;

    console.log(`📝 Message queued for ${clientId} (queue size: ${queue.length})`);

    // Try to send immediately if connected
    const client = this.connectedClients.get(clientId);
    if (client && client.socket && client.isHealthy) {
      this._deliverQueuedMessages(clientId);
    }

    return {
      queued: true,
      queueSize: queue.length,
      clientId,
      event
    };
  }

  /**
   * Broadcast message to all connected clients
   * Also queues for offline clients
   */
  broadcastMessage(event, data, options = {}) {
    const result = {
      event,
      deliveredTo: [],
      queuedFor: [],
      failedClients: [],
      timestamp: Date.now()
    };

    for (const [clientId, client] of this.connectedClients.entries()) {
      if (client.isHealthy && client.socket) {
        try {
          client.socket.emit(event, data);
          result.deliveredTo.push(clientId);
          this.metrics.messagesDelivered++;
        } catch (err) {
          console.error(`❌ Failed to send broadcast to ${clientId}:`, err.message);
          result.failedClients.push(clientId);
        }
      } else if (this.config.enableQueueing && options.queue !== false) {
        this.queueMessage(clientId, event, data, options);
        result.queuedFor.push(clientId);
      }
    }

    console.log(`📢 Broadcast: ${event} → ${result.deliveredTo.length} delivered, ${result.queuedFor.length} queued`);
    return result;
  }

  /**
   * Send message to specific client
   */
  _sendToClient(clientId, event, data, options = {}) {
    const client = this.connectedClients.get(clientId);

    if (!client) {
      if (this.config.enableQueueing && options.queue !== false) {
        return this.queueMessage(clientId, event, data, options);
      }
      return { sent: false, reason: 'Client not found' };
    }

    if (!client.socket || !client.isHealthy) {
      if (this.config.enableQueueing && options.queue !== false) {
        return this.queueMessage(clientId, event, data, options);
      }
      return { sent: false, reason: 'Client not available' };
    }

    try {
      client.socket.emit(event, data);
      client.messageCount++;
      this.metrics.messagesDelivered++;
      return { sent: true, clientId, event };
    } catch (err) {
      console.error(`❌ Failed to send to ${clientId}:`, err.message);
      client.isHealthy = false;
      
      if (this.config.enableQueueing && options.queue !== false) {
        return this.queueMessage(clientId, event, data, options);
      }
      return { sent: false, reason: err.message };
    }
  }

  /**
   * Deliver queued messages to a client
   */
  _deliverQueuedMessages(clientId) {
    const queue = this.messageQueue.get(clientId);
    if (!queue || queue.length === 0) return;

    const client = this.connectedClients.get(clientId);
    if (!client || !client.socket || !client.isHealthy) return;

    const deliveredMessages = [];
    const expiredMessages = [];
    const now = Date.now();

    while (queue.length > 0) {
      const message = queue.shift();

      // Check if message has expired
      if (now - message.queuedAt > message.ttl) {
        expiredMessages.push(message);
        console.log(`⏱️  Dropped expired message for ${clientId}: ${message.event}`);
        continue;
      }

      try {
        client.socket.emit(message.event, message.data);
        deliveredMessages.push(message);
        this.metrics.messagesDelivered++;
      } catch (err) {
        console.error(`❌ Failed to deliver queued message to ${clientId}:`, err.message);
        // Put message back in queue
        queue.unshift(message);
        break;
      }
    }

    if (deliveredMessages.length > 0) {
      console.log(`✅ Delivered ${deliveredMessages.length} queued message(s) to ${clientId}`);
    }
  }

  /**
   * Get calculated backoff delay with exponential backoff
   */
  getBackoffDelay(attemptNumber) {
    const delay = this.config.initialBackoffDelay * 
      Math.pow(this.config.backoffMultiplier, attemptNumber);
    
    return Math.min(delay, this.config.maxBackoffDelay);
  }

  /**
   * Get health status of the real-time service
   */
  getHealthStatus() {
    const uptime = Date.now() - this.metrics.startTime;
    const healthyClients = Array.from(this.connectedClients.values())
      .filter(c => c.isHealthy).length;

    const queuedMessageCount = Array.from(this.messageQueue.values())
      .reduce((sum, q) => sum + q.length, 0);

    return {
      status: this.metrics.activeConnections > 0 ? 'healthy' : 'degraded',
      timestamp: Date.now(),
      uptime: uptime,
      metrics: {
        activeConnections: this.metrics.activeConnections,
        totalConnections: this.metrics.totalConnections,
        healthyClients: healthyClients,
        messagesQueued: queuedMessageCount,
        messagesDelivered: this.metrics.messagesDelivered,
        heartbeatFailures: this.metrics.heartbeatFailures,
        reconnections: this.metrics.reconnections
      },
      config: {
        heartbeatInterval: this.config.heartbeatInterval,
        heartbeatTimeout: this.config.heartbeatTimeout,
        maxQueueSize: this.config.maxQueueSize,
        enableQueueing: this.config.enableQueueing,
        enableHeartbeat: this.config.enableHeartbeat
      }
    };
  }

  /**
   * Get metrics for monitoring
   */
  getMetrics() {
    return {
      timestamp: Date.now(),
      uptime: process.uptime(),
      connections: {
        active: this.metrics.activeConnections,
        total: this.metrics.totalConnections,
        healthy: Array.from(this.connectedClients.values())
          .filter(c => c.isHealthy).length
      },
      messages: {
        queued: this.messageQueue.size,
        delivered: this.metrics.messagesDelivered,
        queuedTotal: Array.from(this.messageQueue.values())
          .reduce((sum, q) => sum + q.length, 0)
      },
      reliability: {
        heartbeatFailures: this.metrics.heartbeatFailures,
        reconnections: this.metrics.reconnections,
        successRate: this.metrics.messagesDelivered > 0 ? 
          ((this.metrics.messagesDelivered / (this.metrics.messagesDelivered + this.metrics.heartbeatFailures)) * 100).toFixed(2) + '%' : 
          'N/A'
      }
    };
  }

  /**
   * Graceful degradation: check if real-time service is available
   */
  isAvailable() {
    return this.metrics.activeConnections > 0;
  }

  /**
   * Get fallback status and recommendations
   */
  getFallbackStatus() {
    const isAvailable = this.isAvailable();
    const recommendations = [];

    if (!isAvailable) {
      recommendations.push('Real-time service unavailable. Use polling fallback.');
    }

    if (this.metrics.heartbeatFailures > 10) {
      recommendations.push('High heartbeat failures. Check network stability.');
    }

    if (this.messageQueue.size > 5) {
      recommendations.push('Many offline clients with queued messages. Consider manual push.');
    }

    const queuedTotal = Array.from(this.messageQueue.values())
      .reduce((sum, q) => sum + q.length, 0);
    
    if (queuedTotal > 100) {
      recommendations.push('Large message queue. Consider cleanup or manual delivery.');
    }

    return {
      available: isAvailable,
      degraded: !isAvailable,
      recommendations: recommendations,
      fallbackMode: !isAvailable ? 'polling' : 'websocket'
    };
  }

  /**
   * Cleanup: remove expired queued messages
   */
  cleanupExpiredMessages() {
    const now = Date.now();
    let totalCleaned = 0;

    for (const [clientId, queue] of this.messageQueue.entries()) {
      const beforeLength = queue.length;
      
      // Filter out expired messages
      const filtered = queue.filter(msg => now - msg.queuedAt <= msg.ttl);
      
      this.messageQueue.set(clientId, filtered);
      
      const cleaned = beforeLength - filtered.length;
      totalCleaned += cleaned;

      if (cleaned > 0) {
        console.log(`🧹 Cleaned ${cleaned} expired message(s) from ${clientId}`);
      }
    }

    if (totalCleaned > 0) {
      console.log(`✅ Total expired messages cleaned: ${totalCleaned}`);
    }

    return totalCleaned;
  }

  /**
   * Shutdown gracefully
   */
  shutdown() {
    console.log('🛑 Shutting down real-time reliability layer...');

    // Clear all heartbeats
    for (const interval of this.heartbeatIntervals.values()) {
      clearInterval(interval);
    }
    this.heartbeatIntervals.clear();

    // Close all connections with warning
    for (const [clientId, client] of this.connectedClients.entries()) {
      try {
        client.socket.emit('server-shutdown', {
          message: 'Server is shutting down',
          queueMessages: true
        });
      } catch (err) {
        // Ignore errors on shutdown
      }
    }

    this.connectedClients.clear();
    console.log('✅ Real-time reliability layer shut down');
  }
}

module.exports = RealtimeReliability;
