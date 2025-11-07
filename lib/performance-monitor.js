42
/**
 * Performance Monitoring & Analytics
 * Tracks key metrics for the Tattoo Contest app
 */

const fs = require('fs');
const path = require('path');

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      requests: [],
      errors: [],
      socketEvents: [],
      uploads: [],
      startTime: Date.now()
    };
    this.metricsFile = path.join(__dirname, 'metrics.json');
    this.loadMetrics();
  }

  /**
   * Record HTTP request metrics
   */
  recordRequest(req, res, duration) {
    const metric = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: duration,
      userAgent: req.get('user-agent')?.substring(0, 100) || 'unknown'
    };
    this.metrics.requests.push(metric);
    this.pruneOldMetrics();
  }

  /**
   * Record error
   */
  recordError(error, context = {}) {
    const metric = {
      timestamp: new Date().toISOString(),
      message: error.message,
      stack: error.stack?.substring(0, 500) || '',
      context
    };
    this.metrics.errors.push(metric);
    this.pruneOldMetrics();
  }

  /**
   * Record Socket.io event
   */
  recordSocketEvent(eventName, dataSize) {
    const metric = {
      timestamp: new Date().toISOString(),
      event: eventName,
      dataSize: dataSize,
      timestamp_ms: Date.now()
    };
    this.metrics.socketEvents.push(metric);
    this.pruneOldMetrics();
  }

  /**
   * Record file upload
   */
  recordUpload(filename, size, duration, success) {
    const metric = {
      timestamp: new Date().toISOString(),
      filename,
      sizeBytes: size,
      duration,
      success
    };
    this.metrics.uploads.push(metric);
    this.pruneOldMetrics();
  }

  /**
   * Get aggregated metrics
   */
  getAggregatedMetrics() {
    const now = Date.now();
    const oneHourAgo = now - 60 * 60 * 1000;
    const oneDayAgo = now - 24 * 60 * 60 * 1000;

    // Filter metrics by time
    const recentRequests = this.metrics.requests.filter(
      r => new Date(r.timestamp).getTime() > oneHourAgo
    );
    const recentErrors = this.metrics.errors.filter(
      e => new Date(e.timestamp).getTime() > oneDayAgo
    );

    // Calculate request stats
    const totalRequests = recentRequests.length;
    const avgResponseTime = totalRequests > 0
      ? recentRequests.reduce((sum, r) => sum + r.duration, 0) / totalRequests
      : 0;
    const maxResponseTime = totalRequests > 0
      ? Math.max(...recentRequests.map(r => r.duration))
      : 0;
    const errorCount = recentRequests.filter(r => r.statusCode >= 400).length;
    const errorRate = totalRequests > 0 ? (errorCount / totalRequests) * 100 : 0;

    // Group requests by path
    const requestsByPath = {};
    recentRequests.forEach(r => {
      if (!requestsByPath[r.path]) {
        requestsByPath[r.path] = { count: 0, avgDuration: 0, errors: 0 };
      }
      requestsByPath[r.path].count++;
      requestsByPath[r.path].avgDuration += r.duration;
      if (r.statusCode >= 400) requestsByPath[r.path].errors++;
    });

    Object.keys(requestsByPath).forEach(path => {
      const data = requestsByPath[path];
      data.avgDuration = data.avgDuration / data.count;
    });

    // Calculate upload stats
    const totalUploads = this.metrics.uploads.filter(
      u => new Date(u.timestamp).getTime() > oneHourAgo
    ).length;
    const successfulUploads = this.metrics.uploads.filter(
      u => u.success && new Date(u.timestamp).getTime() > oneHourAgo
    ).length;

    return {
      timestamp: new Date().toISOString(),
      uptime: (Date.now() - this.metrics.startTime) / 1000,
      requests: {
        total: totalRequests,
        avgResponseTime: Math.round(avgResponseTime),
        maxResponseTime,
        errorRate: Math.round(errorRate * 100) / 100,
        errorCount
      },
      requestsByPath,
      errors: {
        last24h: recentErrors.length,
        topErrors: this.getTopErrors(recentErrors, 5)
      },
      uploads: {
        total: totalUploads,
        successful: successfulUploads,
        failureRate: totalUploads > 0
          ? Math.round(((totalUploads - successfulUploads) / totalUploads) * 100)
          : 0
      },
      socketEvents: {
        total: this.metrics.socketEvents.filter(
          e => new Date(e.timestamp).getTime() > oneHourAgo
        ).length
      }
    };
  }

  /**
   * Get top errors
   */
  getTopErrors(errors, limit) {
    const errorCounts = {};
    errors.forEach(e => {
      const key = e.message;
      errorCounts[key] = (errorCounts[key] || 0) + 1;
    });

    return Object.entries(errorCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([message, count]) => ({ message, count }));
  }

  /**
   * Keep only last N metrics of each type
   */
  pruneOldMetrics() {
    const maxMetrics = 1000;
    if (this.metrics.requests.length > maxMetrics) {
      this.metrics.requests = this.metrics.requests.slice(-maxMetrics);
    }
    if (this.metrics.errors.length > maxMetrics) {
      this.metrics.errors = this.metrics.errors.slice(-maxMetrics);
    }
    if (this.metrics.socketEvents.length > maxMetrics) {
      this.metrics.socketEvents = this.metrics.socketEvents.slice(-maxMetrics);
    }
    if (this.metrics.uploads.length > maxMetrics) {
      this.metrics.uploads = this.metrics.uploads.slice(-maxMetrics);
    }
  }

  /**
   * Save metrics to file
   */
  saveMetrics() {
    try {
      fs.writeFileSync(
        this.metricsFile,
        JSON.stringify(this.getAggregatedMetrics(), null, 2)
      );
    } catch (err) {
      console.error('Failed to save metrics:', err);
    }
  }

  /**
   * Load metrics from file
   */
  loadMetrics() {
    try {
      if (fs.existsSync(this.metricsFile)) {
        // Just verify file exists and is readable
        fs.accessSync(this.metricsFile, fs.constants.R_OK);
      }
    } catch (err) {
      console.error('Failed to load metrics:', err);
    }
  }

  /**
   * Generate health report
   */
  generateHealthReport() {
    const agg = this.getAggregatedMetrics();
    const health = {
      status: 'healthy',
      checks: {}
    };

    // Response time check
    if (agg.requests.avgResponseTime > 1000) {
      health.checks.responseTime = { status: 'warning', value: agg.requests.avgResponseTime };
      health.status = 'warning';
    } else {
      health.checks.responseTime = { status: 'ok', value: agg.requests.avgResponseTime };
    }

    // Error rate check
    if (agg.requests.errorRate > 5) {
      health.checks.errorRate = { status: 'critical', value: agg.requests.errorRate };
      health.status = 'critical';
    } else if (agg.requests.errorRate > 1) {
      health.checks.errorRate = { status: 'warning', value: agg.requests.errorRate };
      if (health.status !== 'critical') health.status = 'warning';
    } else {
      health.checks.errorRate = { status: 'ok', value: agg.requests.errorRate };
    }

    // Upload success check
    if (agg.uploads.failureRate > 10) {
      health.checks.uploads = { status: 'warning', value: agg.uploads.failureRate };
      if (health.status !== 'critical') health.status = 'warning';
    } else {
      health.checks.uploads = { status: 'ok', value: agg.uploads.failureRate };
    }

    return health;
  }
}

module.exports = PerformanceMonitor;
