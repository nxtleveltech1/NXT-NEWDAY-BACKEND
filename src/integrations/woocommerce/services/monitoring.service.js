/**
 * WooCommerce Integration Monitoring Service
 * Real-time monitoring and analytics dashboard
 */

const db = require('../../../config/database');
const EventEmitter = require('events');

class WooCommerceMonitoringService extends EventEmitter {
  constructor() {
    super();
    this.isReady = false;
    this.config = {};
    this.realTimeEnabled = false;
    this.metricsCollector = null;
    this.dashboardData = {};
    
    // Performance metrics
    this.metrics = {
      sync: {
        totalSessions: 0,
        successfulSessions: 0,
        failedSessions: 0,
        avgDuration: 0,
        lastSync: null
      },
      webhooks: {
        totalReceived: 0,
        totalProcessed: 0,
        totalFailed: 0,
        avgProcessingTime: 0,
        lastWebhook: null
      },
      conflicts: {
        totalConflicts: 0,
        autoResolved: 0,
        manualResolution: 0,
        resolutionRate: 0
      },
      api: {
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        avgResponseTime: 0,
        rateLimitHits: 0
      }
    };

    // Alert thresholds
    this.alertThresholds = {
      failureRate: 0.1, // 10% failure rate
      avgResponseTime: 5000, // 5 seconds
      conflictRate: 0.05, // 5% conflict rate
      webhookDelay: 300000, // 5 minutes
      syncDelay: 3600000 // 1 hour
    };

    // Active alerts
    this.activeAlerts = new Map();
  }

  /**
   * Initialize monitoring service
   */
  async initialize(config = {}) {
    try {
      this.config = {
        enableRealTime: config.enableRealTime !== false,
        metricsInterval: config.metricsInterval || 60000, // 1 minute
        alertsEnabled: config.alertsEnabled !== false,
        dashboardRefresh: config.dashboardRefresh || 30000, // 30 seconds
        ...config
      };

      // Initialize monitoring tables
      await this.initializeMonitoringTables();
      
      this.isReady = true;
      console.log('✅ WooCommerce Monitoring Service initialized');
      
      return { success: true };
    } catch (error) {
      console.error('❌ Monitoring service initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize monitoring tables
   */
  async initializeMonitoringTables() {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_monitoring_metrics (
          id SERIAL PRIMARY KEY,
          metric_type VARCHAR(50) NOT NULL,
          metric_name VARCHAR(100) NOT NULL,
          metric_value DECIMAL(15,4),
          metric_data JSONB,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          INDEX(metric_type),
          INDEX(metric_name),
          INDEX(timestamp)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_monitoring_alerts (
          id SERIAL PRIMARY KEY,
          alert_type VARCHAR(50) NOT NULL,
          alert_level VARCHAR(20) NOT NULL,
          title VARCHAR(200) NOT NULL,
          message TEXT,
          alert_data JSONB,
          status VARCHAR(20) DEFAULT 'active',
          acknowledged_by VARCHAR(100),
          acknowledged_at TIMESTAMP WITH TIME ZONE,
          resolved_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          INDEX(alert_type),
          INDEX(alert_level),
          INDEX(status),
          INDEX(created_at)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_monitoring_dashboard (
          id SERIAL PRIMARY KEY,
          dashboard_name VARCHAR(100) NOT NULL,
          widget_data JSONB NOT NULL,
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(dashboard_name)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_performance_log (
          id SERIAL PRIMARY KEY,
          operation_type VARCHAR(50) NOT NULL,
          operation_name VARCHAR(100) NOT NULL,
          duration INTEGER, -- milliseconds
          status VARCHAR(20) NOT NULL,
          error_details TEXT,
          metadata JSONB,
          started_at TIMESTAMP WITH TIME ZONE NOT NULL,
          completed_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          INDEX(operation_type),
          INDEX(operation_name),
          INDEX(status),
          INDEX(started_at)
        )
      `);

      console.log('✅ Monitoring tables initialized');
    } catch (error) {
      console.error('❌ Failed to initialize monitoring tables:', error);
      throw error;
    }
  }

  /**
   * Enable real-time monitoring
   */
  async enableRealTime() {
    try {
      if (this.realTimeEnabled) return;

      // Start metrics collector
      this.metricsCollector = setInterval(async () => {
        await this.collectMetrics();
        await this.updateDashboard();
        await this.checkAlerts();
      }, this.config.metricsInterval);

      // Initial metrics collection
      await this.collectMetrics();
      await this.updateDashboard();

      this.realTimeEnabled = true;
      console.log('✅ Real-time monitoring enabled');
    } catch (error) {
      console.error('❌ Failed to enable real-time monitoring:', error);
      throw error;
    }
  }

  /**
   * Start sync monitoring
   */
  async startSync(syncType, options = {}) {
    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    
    try {
      await this.logPerformance({
        operationType: 'sync',
        operationName: syncType,
        status: 'started',
        startedAt: new Date(),
        metadata: options
      });

      console.log(`📊 Monitoring started for sync: ${syncId}`);
      return syncId;
    } catch (error) {
      console.error('❌ Failed to start sync monitoring:', error);
      throw error;
    }
  }

  /**
   * Complete sync monitoring
   */
  async completeSync(syncId, results) {
    try {
      const duration = results.duration || 0;
      
      await this.logPerformance({
        operationType: 'sync',
        operationName: results.syncType || 'unknown',
        duration,
        status: 'completed',
        startedAt: new Date(Date.now() - duration),
        metadata: {
          syncId,
          ...results
        }
      });

      // Update metrics
      this.metrics.sync.totalSessions++;
      this.metrics.sync.successfulSessions++;
      this.metrics.sync.avgDuration = this.updateAverageMetric(
        this.metrics.sync.avgDuration,
        duration,
        this.metrics.sync.totalSessions
      );
      this.metrics.sync.lastSync = new Date();

      // Store metrics
      await this.storeMetric('sync', 'session_completed', 1, results);

      console.log(`✅ Sync monitoring completed: ${syncId}`);
      this.emit('syncCompleted', { syncId, results });
    } catch (error) {
      console.error('❌ Failed to complete sync monitoring:', error);
    }
  }

  /**
   * Fail sync monitoring
   */
  async failSync(syncId, error) {
    try {
      await this.logPerformance({
        operationType: 'sync',
        operationName: 'unknown',
        status: 'failed',
        errorDetails: error.error || error.message,
        startedAt: new Date(Date.now() - (error.duration || 0)),
        metadata: { syncId, error }
      });

      // Update metrics
      this.metrics.sync.totalSessions++;
      this.metrics.sync.failedSessions++;

      // Store metrics
      await this.storeMetric('sync', 'session_failed', 1, { syncId, error });

      // Check for alerts
      await this.checkSyncFailureAlert();

      console.log(`❌ Sync monitoring failed: ${syncId}`);
      this.emit('syncFailed', { syncId, error });
    } catch (monitoringError) {
      console.error('❌ Failed to log sync failure:', monitoringError);
    }
  }

  /**
   * Monitor webhook processing
   */
  async monitorWebhook(eventType, processingTime, success, error = null) {
    try {
      await this.logPerformance({
        operationType: 'webhook',
        operationName: eventType,
        duration: processingTime,
        status: success ? 'completed' : 'failed',
        errorDetails: error?.message,
        startedAt: new Date(Date.now() - processingTime),
        metadata: { eventType, success, error }
      });

      // Update metrics
      this.metrics.webhooks.totalReceived++;
      if (success) {
        this.metrics.webhooks.totalProcessed++;
      } else {
        this.metrics.webhooks.totalFailed++;
      }
      
      this.metrics.webhooks.avgProcessingTime = this.updateAverageMetric(
        this.metrics.webhooks.avgProcessingTime,
        processingTime,
        this.metrics.webhooks.totalReceived
      );
      this.metrics.webhooks.lastWebhook = new Date();

      // Store metrics
      await this.storeMetric('webhook', eventType, 1, { success, processingTime });

      this.emit('webhookMonitored', { eventType, success, processingTime });
    } catch (error) {
      console.error('❌ Failed to monitor webhook:', error);
    }
  }

  /**
   * Monitor API calls
   */
  async monitorApiCall(endpoint, responseTime, success, statusCode = null) {
    try {
      await this.logPerformance({
        operationType: 'api_call',
        operationName: endpoint,
        duration: responseTime,
        status: success ? 'completed' : 'failed',
        startedAt: new Date(Date.now() - responseTime),
        metadata: { endpoint, statusCode, success }
      });

      // Update metrics
      this.metrics.api.totalRequests++;
      if (success) {
        this.metrics.api.successfulRequests++;
      } else {
        this.metrics.api.failedRequests++;
      }
      
      this.metrics.api.avgResponseTime = this.updateAverageMetric(
        this.metrics.api.avgResponseTime,
        responseTime,
        this.metrics.api.totalRequests
      );

      // Check for rate limit
      if (statusCode === 429) {
        this.metrics.api.rateLimitHits++;
      }

      // Store metrics
      await this.storeMetric('api', 'request', 1, { endpoint, responseTime, success, statusCode });

      this.emit('apiCallMonitored', { endpoint, success, responseTime, statusCode });
    } catch (error) {
      console.error('❌ Failed to monitor API call:', error);
    }
  }

  /**
   * Collect comprehensive metrics
   */
  async collectMetrics() {
    try {
      // Collect database metrics
      const dbMetrics = await this.collectDatabaseMetrics();
      
      // Collect system metrics
      const systemMetrics = await this.collectSystemMetrics();
      
      // Update dashboard data
      this.dashboardData = {
        timestamp: new Date().toISOString(),
        sync: this.metrics.sync,
        webhooks: this.metrics.webhooks,
        conflicts: this.metrics.conflicts,
        api: this.metrics.api,
        database: dbMetrics,
        system: systemMetrics,
        alerts: Array.from(this.activeAlerts.values())
      };

      this.emit('metricsCollected', this.dashboardData);
    } catch (error) {
      console.error('❌ Failed to collect metrics:', error);
    }
  }

  /**
   * Collect database metrics
   */
  async collectDatabaseMetrics() {
    try {
      const [syncStats, webhookStats, conflictStats] = await Promise.all([
        this.getSyncStats(),
        this.getWebhookStats(),
        this.getConflictStats()
      ]);

      return {
        sync: syncStats,
        webhooks: webhookStats,
        conflicts: conflictStats
      };
    } catch (error) {
      console.error('❌ Failed to collect database metrics:', error);
      return {};
    }
  }

  /**
   * Collect system metrics
   */
  async collectSystemMetrics() {
    try {
      const memoryUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      return {
        memory: {
          rss: memoryUsage.rss,
          heapTotal: memoryUsage.heapTotal,
          heapUsed: memoryUsage.heapUsed,
          external: memoryUsage.external
        },
        cpu: {
          user: cpuUsage.user,
          system: cpuUsage.system
        },
        uptime: process.uptime(),
        nodeVersion: process.version
      };
    } catch (error) {
      console.error('❌ Failed to collect system metrics:', error);
      return {};
    }
  }

  /**
   * Get sync statistics
   */
  async getSyncStats() {
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_sessions,
          COUNT(*) FILTER (WHERE status = 'completed') as successful_sessions,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_sessions,
          AVG(duration) as avg_duration,
          MAX(started_at) as last_sync
        FROM wc_performance_log 
        WHERE operation_type = 'sync' 
          AND started_at >= NOW() - INTERVAL '24 hours'
      `);

      return result.rows[0] || {};
    } catch (error) {
      console.error('❌ Failed to get sync stats:', error);
      return {};
    }
  }

  /**
   * Get webhook statistics
   */
  async getWebhookStats() {
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_received,
          COUNT(*) FILTER (WHERE status = 'completed') as total_processed,
          COUNT(*) FILTER (WHERE status = 'failed') as total_failed,
          AVG(duration) as avg_processing_time,
          MAX(started_at) as last_webhook
        FROM wc_performance_log 
        WHERE operation_type = 'webhook' 
          AND started_at >= NOW() - INTERVAL '24 hours'
      `);

      return result.rows[0] || {};
    } catch (error) {
      console.error('❌ Failed to get webhook stats:', error);
      return {};
    }
  }

  /**
   * Get conflict statistics
   */
  async getConflictStats() {
    try {
      const result = await db.query(`
        SELECT 
          COUNT(*) as total_conflicts,
          COUNT(*) FILTER (WHERE auto_resolved = true) as auto_resolved,
          COUNT(*) FILTER (WHERE auto_resolved = false) as manual_resolution,
          ROUND(
            COUNT(*) FILTER (WHERE resolution_status = 'resolved')::decimal / 
            NULLIF(COUNT(*), 0) * 100, 2
          ) as resolution_rate
        FROM wc_conflict_log 
        WHERE created_at >= NOW() - INTERVAL '24 hours'
      `);

      return result.rows[0] || {};
    } catch (error) {
      console.error('❌ Failed to get conflict stats:', error);
      return {};
    }
  }

  /**
   * Update dashboard
   */
  async updateDashboard() {
    try {
      await db.query(`
        INSERT INTO wc_monitoring_dashboard (dashboard_name, widget_data)
        VALUES ('main', $1)
        ON CONFLICT (dashboard_name) 
        DO UPDATE SET widget_data = $1, updated_at = NOW()
      `, [JSON.stringify(this.dashboardData)]);

      this.emit('dashboardUpdated', this.dashboardData);
    } catch (error) {
      console.error('❌ Failed to update dashboard:', error);
    }
  }

  /**
   * Get dashboard data
   */
  async getDashboardData() {
    try {
      // Return cached data if recent
      if (this.dashboardData.timestamp) {
        const age = Date.now() - new Date(this.dashboardData.timestamp).getTime();
        if (age < this.config.dashboardRefresh) {
          return this.dashboardData;
        }
      }

      // Collect fresh metrics
      await this.collectMetrics();
      return this.dashboardData;
    } catch (error) {
      console.error('❌ Failed to get dashboard data:', error);
      throw error;
    }
  }

  /**
   * Get comprehensive analytics
   */
  async getComprehensiveAnalytics(timeframe = '30d') {
    try {
      const days = parseInt(timeframe.replace('d', ''));
      const since = new Date();
      since.setDate(since.getDate() - days);

      const [
        syncAnalytics,
        webhookAnalytics,
        conflictAnalytics,
        apiAnalytics,
        performanceTrends
      ] = await Promise.all([
        this.getSyncAnalytics(since),
        this.getWebhookAnalytics(since),
        this.getConflictAnalytics(since),
        this.getApiAnalytics(since),
        this.getPerformanceTrends(since)
      ]);

      return {
        timeframe,
        since: since.toISOString(),
        generatedAt: new Date().toISOString(),
        sync: syncAnalytics,
        webhooks: webhookAnalytics,
        conflicts: conflictAnalytics,
        api: apiAnalytics,
        performance: performanceTrends,
        currentMetrics: this.metrics
      };
    } catch (error) {
      console.error('❌ Failed to get comprehensive analytics:', error);
      throw error;
    }
  }

  /**
   * Get sync analytics
   */
  async getSyncAnalytics(since) {
    try {
      const result = await db.query(`
        SELECT 
          DATE(started_at) as sync_date,
          COUNT(*) as total_syncs,
          COUNT(*) FILTER (WHERE status = 'completed') as successful_syncs,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_syncs,
          AVG(duration) as avg_duration,
          MIN(duration) as min_duration,
          MAX(duration) as max_duration
        FROM wc_performance_log 
        WHERE operation_type = 'sync' AND started_at >= $1
        GROUP BY DATE(started_at)
        ORDER BY sync_date DESC
      `, [since]);

      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get sync analytics:', error);
      return [];
    }
  }

  /**
   * Get webhook analytics
   */
  async getWebhookAnalytics(since) {
    try {
      const result = await db.query(`
        SELECT 
          operation_name as event_type,
          COUNT(*) as total_events,
          COUNT(*) FILTER (WHERE status = 'completed') as successful_events,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_events,
          AVG(duration) as avg_processing_time
        FROM wc_performance_log 
        WHERE operation_type = 'webhook' AND started_at >= $1
        GROUP BY operation_name
        ORDER BY total_events DESC
      `, [since]);

      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get webhook analytics:', error);
      return [];
    }
  }

  /**
   * Get conflict analytics
   */
  async getConflictAnalytics(since) {
    try {
      const result = await db.query(`
        SELECT 
          entity_type,
          conflict_type,
          COUNT(*) as total_conflicts,
          COUNT(*) FILTER (WHERE auto_resolved = true) as auto_resolved,
          COUNT(*) FILTER (WHERE resolution_status = 'resolved') as resolved,
          AVG(EXTRACT(EPOCH FROM (resolved_at - created_at))) as avg_resolution_time
        FROM wc_conflict_log 
        WHERE created_at >= $1
        GROUP BY entity_type, conflict_type
        ORDER BY total_conflicts DESC
      `, [since]);

      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get conflict analytics:', error);
      return [];
    }
  }

  /**
   * Get API analytics
   */
  async getApiAnalytics(since) {
    try {
      const result = await db.query(`
        SELECT 
          operation_name as endpoint,
          COUNT(*) as total_requests,
          COUNT(*) FILTER (WHERE status = 'completed') as successful_requests,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_requests,
          AVG(duration) as avg_response_time,
          COUNT(*) FILTER (WHERE (metadata->>'statusCode')::int = 429) as rate_limit_hits
        FROM wc_performance_log 
        WHERE operation_type = 'api_call' AND started_at >= $1
        GROUP BY operation_name
        ORDER BY total_requests DESC
      `, [since]);

      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get API analytics:', error);
      return [];
    }
  }

  /**
   * Get performance trends
   */
  async getPerformanceTrends(since) {
    try {
      const result = await db.query(`
        SELECT 
          DATE(started_at) as trend_date,
          operation_type,
          AVG(duration) as avg_duration,
          COUNT(*) as operation_count,
          COUNT(*) FILTER (WHERE status = 'failed') as failed_count
        FROM wc_performance_log 
        WHERE started_at >= $1
        GROUP BY DATE(started_at), operation_type
        ORDER BY trend_date DESC, operation_type
      `, [since]);

      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get performance trends:', error);
      return [];
    }
  }

  /**
   * Check alerts
   */
  async checkAlerts() {
    try {
      // Check sync failure rate
      await this.checkSyncFailureAlert();
      
      // Check API response time
      await this.checkApiResponseTimeAlert();
      
      // Check conflict rate
      await this.checkConflictRateAlert();
      
      // Check webhook processing delay
      await this.checkWebhookDelayAlert();
      
    } catch (error) {
      console.error('❌ Failed to check alerts:', error);
    }
  }

  /**
   * Check sync failure alert
   */
  async checkSyncFailureAlert() {
    try {
      const failureRate = this.metrics.sync.totalSessions > 0 
        ? this.metrics.sync.failedSessions / this.metrics.sync.totalSessions
        : 0;

      if (failureRate > this.alertThresholds.failureRate) {
        await this.createAlert('sync_failure_rate', 'warning', 
          'High Sync Failure Rate',
          `Sync failure rate is ${(failureRate * 100).toFixed(1)}% (threshold: ${(this.alertThresholds.failureRate * 100)}%)`,
          { failureRate, threshold: this.alertThresholds.failureRate }
        );
      }
    } catch (error) {
      console.error('❌ Failed to check sync failure alert:', error);
    }
  }

  /**
   * Check API response time alert
   */
  async checkApiResponseTimeAlert() {
    try {
      if (this.metrics.api.avgResponseTime > this.alertThresholds.avgResponseTime) {
        await this.createAlert('api_response_time', 'warning',
          'High API Response Time',
          `Average API response time is ${this.metrics.api.avgResponseTime}ms (threshold: ${this.alertThresholds.avgResponseTime}ms)`,
          { responseTime: this.metrics.api.avgResponseTime, threshold: this.alertThresholds.avgResponseTime }
        );
      }
    } catch (error) {
      console.error('❌ Failed to check API response time alert:', error);
    }
  }

  /**
   * Check conflict rate alert
   */
  async checkConflictRateAlert() {
    try {
      const totalSyncOperations = this.metrics.sync.totalSessions;
      const conflictRate = totalSyncOperations > 0 
        ? this.metrics.conflicts.totalConflicts / totalSyncOperations
        : 0;

      if (conflictRate > this.alertThresholds.conflictRate) {
        await this.createAlert('conflict_rate', 'info',
          'High Conflict Rate',
          `Conflict rate is ${(conflictRate * 100).toFixed(1)}% (threshold: ${(this.alertThresholds.conflictRate * 100)}%)`,
          { conflictRate, threshold: this.alertThresholds.conflictRate }
        );
      }
    } catch (error) {
      console.error('❌ Failed to check conflict rate alert:', error);
    }
  }

  /**
   * Check webhook delay alert
   */
  async checkWebhookDelayAlert() {
    try {
      const lastWebhook = this.metrics.webhooks.lastWebhook;
      if (lastWebhook) {
        const delay = Date.now() - lastWebhook.getTime();
        if (delay > this.alertThresholds.webhookDelay) {
          await this.createAlert('webhook_delay', 'warning',
            'Webhook Processing Delay',
            `Last webhook processed ${Math.round(delay / 60000)} minutes ago (threshold: ${this.alertThresholds.webhookDelay / 60000} minutes)`,
            { delay, threshold: this.alertThresholds.webhookDelay }
          );
        }
      }
    } catch (error) {
      console.error('❌ Failed to check webhook delay alert:', error);
    }
  }

  /**
   * Create alert
   */
  async createAlert(alertType, level, title, message, data = {}) {
    try {
      // Check if alert already exists and is active
      if (this.activeAlerts.has(alertType)) {
        return;
      }

      const result = await db.query(`
        INSERT INTO wc_monitoring_alerts (alert_type, alert_level, title, message, alert_data)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
      `, [alertType, level, title, message, JSON.stringify(data)]);

      const alertId = result.rows[0].id;
      const alert = {
        id: alertId,
        type: alertType,
        level,
        title,
        message,
        data,
        createdAt: new Date()
      };

      this.activeAlerts.set(alertType, alert);
      this.emit('alertCreated', alert);

      console.log(`🚨 Alert created: ${title}`);
    } catch (error) {
      console.error('❌ Failed to create alert:', error);
    }
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Log performance data
   */
  async logPerformance(data) {
    try {
      await db.query(`
        INSERT INTO wc_performance_log (
          operation_type, operation_name, duration, status, error_details, metadata, started_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [
        data.operationType,
        data.operationName,
        data.duration || null,
        data.status,
        data.errorDetails || null,
        JSON.stringify(data.metadata || {}),
        data.startedAt
      ]);
    } catch (error) {
      console.error('❌ Failed to log performance:', error);
    }
  }

  /**
   * Store metric
   */
  async storeMetric(type, name, value, data = {}) {
    try {
      await db.query(`
        INSERT INTO wc_monitoring_metrics (metric_type, metric_name, metric_value, metric_data)
        VALUES ($1, $2, $3, $4)
      `, [type, name, value, JSON.stringify(data)]);
    } catch (error) {
      console.error('❌ Failed to store metric:', error);
    }
  }

  /**
   * Update average metric
   */
  updateAverageMetric(currentAvg, newValue, totalCount) {
    if (totalCount <= 1) return newValue;
    return ((currentAvg * (totalCount - 1)) + newValue) / totalCount;
  }

  /**
   * Shutdown monitoring service
   */
  async shutdown() {
    try {
      if (this.metricsCollector) {
        clearInterval(this.metricsCollector);
        this.metricsCollector = null;
      }
      
      this.realTimeEnabled = false;
      this.activeAlerts.clear();
      
      console.log('✅ Monitoring service shutdown complete');
    } catch (error) {
      console.error('❌ Monitoring service shutdown error:', error);
    }
  }

  /**
   * Get service readiness status
   */
  isReady() {
    return this.isReady;
  }
}

module.exports = new WooCommerceMonitoringService();