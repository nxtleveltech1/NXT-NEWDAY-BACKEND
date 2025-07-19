/**
 * NXT NEW DAY - Migration Status Dashboard and Reporting
 * 
 * Real-time migration monitoring, progress tracking, and comprehensive
 * reporting suite for production deployment oversight.
 * 
 * Author: Data Migration Agent
 * Version: 1.0.0
 * Last Updated: 2025-01-19
 */

import { drizzle } from 'drizzle-orm/node-postgres';
import { sql, eq, and, or, desc, asc, count, sum, avg, min, max } from 'drizzle-orm';
import fs from 'fs/promises';
import path from 'path';

// ==================== DASHBOARD CONFIGURATION ====================

const DASHBOARD_CONFIG = {
  refreshInterval: 5000,     // 5 seconds
  retentionPeriod: 30,       // 30 days
  alertThresholds: {
    errorRate: 0.05,         // 5%
    slowdownFactor: 0.5,     // 50% below expected rate
    memoryUsage: 0.8,        // 80%
    connectionPool: 0.9      // 90%
  },
  reportFormats: ['json', 'html', 'csv'],
  realTimeEnabled: true,
  metricsCollection: true
};

const STATUS_TYPES = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress', 
  COMPLETED: 'completed',
  FAILED: 'failed',
  PAUSED: 'paused',
  CANCELLED: 'cancelled',
  VALIDATING: 'validating'
};

const METRIC_TYPES = {
  RECORDS_PROCESSED: 'records_processed',
  PROCESSING_RATE: 'processing_rate',
  ERROR_COUNT: 'error_count',
  MEMORY_USAGE: 'memory_usage',
  CONNECTION_COUNT: 'connection_count',
  DISK_USAGE: 'disk_usage',
  NETWORK_LATENCY: 'network_latency'
};

// ==================== MIGRATION STATUS TRACKER ====================

export class MigrationDashboard {
  constructor(db, options = {}) {
    this.db = db;
    this.config = { ...DASHBOARD_CONFIG, ...options };
    this.migrationSession = null;
    this.metrics = new Map();
    this.alerts = [];
    this.statusLog = [];
    this.startTime = null;
    this.isRunning = false;
    this.intervalId = null;
  }

  // ==================== SESSION MANAGEMENT ====================

  async startMigrationSession(sessionName, migrationPlan) {
    this.migrationSession = {
      id: this.generateSessionId(),
      name: sessionName,
      startTime: new Date(),
      plan: migrationPlan,
      status: STATUS_TYPES.PENDING,
      currentPhase: null,
      currentStep: null,
      progress: {
        overall: 0,
        phase: 0,
        step: 0
      },
      stats: {
        totalTables: migrationPlan?.execution?.phases?.reduce((sum, phase) => sum + phase.steps.length, 0) || 0,
        completedTables: 0,
        totalRecords: 0,
        processedRecords: 0,
        failedRecords: 0,
        errorsEncountered: 0
      },
      phases: migrationPlan?.execution?.phases?.map(phase => ({
        name: phase.name,
        status: STATUS_TYPES.PENDING,
        startTime: null,
        endTime: null,
        steps: phase.steps.map(step => ({
          name: step.name,
          status: STATUS_TYPES.PENDING,
          startTime: null,
          endTime: null,
          recordsProcessed: 0,
          errors: []
        }))
      })) || []
    };

    this.startTime = new Date();
    this.isRunning = true;

    // Start real-time monitoring
    if (this.config.realTimeEnabled) {
      await this.startRealTimeMonitoring();
    }

    // Initialize metrics collection
    if (this.config.metricsCollection) {
      await this.initializeMetricsCollection();
    }

    this.log('INFO', `Migration session started: ${sessionName}`);
    return this.migrationSession.id;
  }

  async stopMigrationSession() {
    if (this.migrationSession) {
      this.migrationSession.endTime = new Date();
      this.migrationSession.duration = this.migrationSession.endTime - this.migrationSession.startTime;
    }

    this.isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.log('INFO', 'Migration session stopped');
  }

  generateSessionId() {
    return `migration_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  // ==================== REAL-TIME MONITORING ====================

  async startRealTimeMonitoring() {
    this.log('INFO', 'Starting real-time monitoring');

    this.intervalId = setInterval(async () => {
      try {
        await this.collectMetrics();
        await this.updateProgress();
        await this.checkAlerts();
        await this.publishStatus();
      } catch (error) {
        this.log('ERROR', `Real-time monitoring error: ${error.message}`);
      }
    }, this.config.refreshInterval);
  }

  async collectMetrics() {
    const timestamp = new Date();

    // Collect system metrics
    const systemMetrics = await this.collectSystemMetrics();
    
    // Collect database metrics
    const dbMetrics = await this.collectDatabaseMetrics();
    
    // Collect migration-specific metrics
    const migrationMetrics = await this.collectMigrationMetrics();

    // Store metrics
    const allMetrics = {
      timestamp,
      system: systemMetrics,
      database: dbMetrics,
      migration: migrationMetrics
    };

    this.metrics.set(timestamp.toISOString(), allMetrics);

    // Clean up old metrics (keep last hour only for real-time)
    this.cleanupOldMetrics();
  }

  async collectSystemMetrics() {
    try {
      // In a real implementation, these would collect actual system metrics
      return {
        memoryUsage: {
          used: Math.random() * 8000, // MB
          total: 8000,
          percentage: Math.random() * 0.8
        },
        cpuUsage: {
          percentage: Math.random() * 0.7
        },
        diskUsage: {
          used: Math.random() * 100000, // MB  
          available: 100000,
          percentage: Math.random() * 0.6
        }
      };
    } catch (error) {
      this.log('WARNING', `Could not collect system metrics: ${error.message}`);
      return {};
    }
  }

  async collectDatabaseMetrics() {
    try {
      // Connection count
      const connectionResult = await this.db.execute(sql`
        SELECT count(*) as active_connections
        FROM pg_stat_activity 
        WHERE state = 'active'
      `);

      // Database size
      const sizeResult = await this.db.execute(sql`
        SELECT pg_size_pretty(pg_database_size(current_database())) as db_size,
               pg_database_size(current_database()) as db_size_bytes
      `);

      // Cache hit ratio
      const cacheResult = await this.db.execute(sql`
        SELECT 
          round(100.0 * sum(blks_hit) / sum(blks_hit + blks_read), 2) as cache_hit_ratio
        FROM pg_stat_database 
        WHERE datname = current_database()
      `);

      return {
        activeConnections: parseInt(connectionResult.rows[0]?.active_connections || 0),
        databaseSize: sizeResult.rows[0]?.db_size || 'Unknown',
        databaseSizeBytes: parseInt(sizeResult.rows[0]?.db_size_bytes || 0),
        cacheHitRatio: parseFloat(cacheResult.rows[0]?.cache_hit_ratio || 0)
      };

    } catch (error) {
      this.log('WARNING', `Could not collect database metrics: ${error.message}`);
      return {};
    }
  }

  async collectMigrationMetrics() {
    if (!this.migrationSession) return {};

    try {
      const currentTime = new Date();
      const elapsedTime = currentTime - this.migrationSession.startTime;
      const elapsedSeconds = elapsedTime / 1000;

      // Calculate processing rate
      const processingRate = this.migrationSession.stats.processedRecords / Math.max(elapsedSeconds, 1);

      // Calculate error rate
      const errorRate = this.migrationSession.stats.errorsEncountered / 
                       Math.max(this.migrationSession.stats.processedRecords, 1);

      // Estimate completion time
      const remainingRecords = this.migrationSession.stats.totalRecords - 
                              this.migrationSession.stats.processedRecords;
      const estimatedTimeRemaining = remainingRecords / Math.max(processingRate, 1);

      return {
        elapsedTime: elapsedSeconds,
        processingRate: Math.round(processingRate * 100) / 100,
        errorRate: Math.round(errorRate * 10000) / 100, // percentage
        estimatedTimeRemaining: Math.round(estimatedTimeRemaining),
        overallProgress: this.migrationSession.progress.overall,
        currentPhase: this.migrationSession.currentPhase,
        currentStep: this.migrationSession.currentStep
      };

    } catch (error) {
      this.log('WARNING', `Could not collect migration metrics: ${error.message}`);
      return {};
    }
  }

  cleanupOldMetrics() {
    const cutoffTime = new Date(Date.now() - (60 * 60 * 1000)); // 1 hour ago
    
    for (const [timestamp, _] of this.metrics) {
      if (new Date(timestamp) < cutoffTime) {
        this.metrics.delete(timestamp);
      }
    }
  }

  // ==================== PROGRESS TRACKING ====================

  async updateProgress() {
    if (!this.migrationSession) return;

    try {
      // Update overall progress
      const totalSteps = this.migrationSession.stats.totalTables;
      const completedSteps = this.migrationSession.stats.completedTables;
      this.migrationSession.progress.overall = totalSteps > 0 ? 
        Math.round((completedSteps / totalSteps) * 100) : 0;

      // Update phase progress
      if (this.migrationSession.currentPhase) {
        const currentPhase = this.migrationSession.phases.find(p => p.name === this.migrationSession.currentPhase);
        if (currentPhase) {
          const phaseSteps = currentPhase.steps.length;
          const completedPhaseSteps = currentPhase.steps.filter(s => s.status === STATUS_TYPES.COMPLETED).length;
          this.migrationSession.progress.phase = phaseSteps > 0 ?
            Math.round((completedPhaseSteps / phaseSteps) * 100) : 0;
        }
      }

    } catch (error) {
      this.log('WARNING', `Could not update progress: ${error.message}`);
    }
  }

  updatePhaseStatus(phaseName, status) {
    if (!this.migrationSession) return;

    const phase = this.migrationSession.phases.find(p => p.name === phaseName);
    if (phase) {
      phase.status = status;
      if (status === STATUS_TYPES.IN_PROGRESS) {
        phase.startTime = new Date();
        this.migrationSession.currentPhase = phaseName;
      } else if (status === STATUS_TYPES.COMPLETED || status === STATUS_TYPES.FAILED) {
        phase.endTime = new Date();
      }
    }

    this.log('INFO', `Phase ${phaseName} status updated: ${status}`);
  }

  updateStepStatus(phaseName, stepName, status, recordsProcessed = 0, errors = []) {
    if (!this.migrationSession) return;

    const phase = this.migrationSession.phases.find(p => p.name === phaseName);
    if (phase) {
      const step = phase.steps.find(s => s.name === stepName);
      if (step) {
        step.status = status;
        step.recordsProcessed = recordsProcessed;
        step.errors = errors;

        if (status === STATUS_TYPES.IN_PROGRESS) {
          step.startTime = new Date();
          this.migrationSession.currentStep = stepName;
        } else if (status === STATUS_TYPES.COMPLETED || status === STATUS_TYPES.FAILED) {
          step.endTime = new Date();
          if (status === STATUS_TYPES.COMPLETED) {
            this.migrationSession.stats.completedTables++;
          }
        }

        // Update overall stats
        this.migrationSession.stats.processedRecords += recordsProcessed;
        this.migrationSession.stats.errorsEncountered += errors.length;
        if (errors.length > 0) {
          this.migrationSession.stats.failedRecords += recordsProcessed;
        }
      }
    }

    this.log('INFO', `Step ${stepName} status updated: ${status} (${recordsProcessed} records processed)`);
  }

  // ==================== ALERT SYSTEM ====================

  async checkAlerts() {
    if (!this.migrationSession) return;

    const currentMetrics = Array.from(this.metrics.values()).slice(-1)[0];
    if (!currentMetrics) return;

    const alerts = [];

    // Check error rate
    if (currentMetrics.migration?.errorRate > this.config.alertThresholds.errorRate * 100) {
      alerts.push({
        type: 'ERROR_RATE_HIGH',
        severity: 'CRITICAL',
        message: `Error rate is ${currentMetrics.migration.errorRate}%, exceeding threshold of ${this.config.alertThresholds.errorRate * 100}%`,
        value: currentMetrics.migration.errorRate,
        threshold: this.config.alertThresholds.errorRate * 100,
        timestamp: new Date()
      });
    }

    // Check processing rate slowdown
    const expectedRate = this.calculateExpectedProcessingRate();
    if (currentMetrics.migration?.processingRate < expectedRate * this.config.alertThresholds.slowdownFactor) {
      alerts.push({
        type: 'PROCESSING_SLOWDOWN',
        severity: 'WARNING',
        message: `Processing rate is ${currentMetrics.migration.processingRate} records/sec, below expected ${expectedRate} records/sec`,
        value: currentMetrics.migration.processingRate,
        expected: expectedRate,
        timestamp: new Date()
      });
    }

    // Check memory usage
    if (currentMetrics.system?.memoryUsage?.percentage > this.config.alertThresholds.memoryUsage) {
      alerts.push({
        type: 'MEMORY_USAGE_HIGH',
        severity: 'WARNING',
        message: `Memory usage is ${Math.round(currentMetrics.system.memoryUsage.percentage * 100)}%, exceeding threshold of ${this.config.alertThresholds.memoryUsage * 100}%`,
        value: currentMetrics.system.memoryUsage.percentage,
        threshold: this.config.alertThresholds.memoryUsage,
        timestamp: new Date()
      });
    }

    // Check database connections
    if (currentMetrics.database?.activeConnections > 100 * this.config.alertThresholds.connectionPool) {
      alerts.push({
        type: 'CONNECTION_POOL_HIGH',
        severity: 'WARNING',
        message: `Active connections: ${currentMetrics.database.activeConnections}, approaching limit`,
        value: currentMetrics.database.activeConnections,
        timestamp: new Date()
      });
    }

    // Add new alerts
    this.alerts.push(...alerts);

    // Log critical alerts immediately
    alerts.filter(alert => alert.severity === 'CRITICAL').forEach(alert => {
      this.log('CRITICAL', alert.message);
    });
  }

  calculateExpectedProcessingRate() {
    // This would be based on historical data or benchmarks
    // For now, return a reasonable default
    return 100; // records per second
  }

  // ==================== STATUS PUBLISHING ====================

  async publishStatus() {
    if (!this.migrationSession) return;

    const status = {
      sessionId: this.migrationSession.id,
      timestamp: new Date().toISOString(),
      status: this.migrationSession.status,
      progress: this.migrationSession.progress,
      currentPhase: this.migrationSession.currentPhase,
      currentStep: this.migrationSession.currentStep,
      stats: this.migrationSession.stats,
      metrics: this.getLatestMetrics(),
      alerts: this.getActiveAlerts(),
      uptime: new Date() - this.migrationSession.startTime
    };

    // In a real implementation, this would publish to:
    // - WebSocket for real-time dashboard
    // - Message queue for other services
    // - Logging system
    // - Monitoring tools

    this.statusLog.push(status);

    // Keep only last 100 status updates
    if (this.statusLog.length > 100) {
      this.statusLog = this.statusLog.slice(-100);
    }
  }

  getLatestMetrics() {
    const latest = Array.from(this.metrics.values()).slice(-1)[0];
    return latest || {};
  }

  getActiveAlerts() {
    const cutoffTime = new Date(Date.now() - (5 * 60 * 1000)); // Last 5 minutes
    return this.alerts.filter(alert => alert.timestamp > cutoffTime);
  }

  // ==================== METRICS COLLECTION ====================

  async initializeMetricsCollection() {
    this.log('INFO', 'Initializing metrics collection');
    
    // Create metrics table if it doesn't exist
    try {
      await this.db.execute(sql`
        CREATE TABLE IF NOT EXISTS migration_metrics (
          id SERIAL PRIMARY KEY,
          session_id VARCHAR(255) NOT NULL,
          timestamp TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          metric_type VARCHAR(100) NOT NULL,
          metric_name VARCHAR(100) NOT NULL,
          value DECIMAL(20, 4) NOT NULL,
          metadata JSONB DEFAULT '{}',
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      await this.db.execute(sql`
        CREATE INDEX IF NOT EXISTS idx_migration_metrics_session_timestamp 
        ON migration_metrics(session_id, timestamp)
      `);

    } catch (error) {
      this.log('WARNING', `Could not initialize metrics table: ${error.message}`);
    }
  }

  async recordMetric(metricType, metricName, value, metadata = {}) {
    if (!this.migrationSession || !this.config.metricsCollection) return;

    try {
      await this.db.execute(sql`
        INSERT INTO migration_metrics (session_id, metric_type, metric_name, value, metadata)
        VALUES (${this.migrationSession.id}, ${metricType}, ${metricName}, ${value}, ${JSON.stringify(metadata)})
      `);

    } catch (error) {
      this.log('WARNING', `Could not record metric: ${error.message}`);
    }
  }

  // ==================== REPORTING ====================

  async generateProgressReport() {
    if (!this.migrationSession) {
      throw new Error('No active migration session');
    }

    const report = {
      session: {
        id: this.migrationSession.id,
        name: this.migrationSession.name,
        startTime: this.migrationSession.startTime,
        status: this.migrationSession.status,
        uptime: new Date() - this.migrationSession.startTime
      },
      progress: {
        overall: this.migrationSession.progress.overall,
        phase: this.migrationSession.progress.phase,
        step: this.migrationSession.progress.step,
        currentPhase: this.migrationSession.currentPhase,
        currentStep: this.migrationSession.currentStep
      },
      statistics: this.migrationSession.stats,
      phases: this.migrationSession.phases.map(phase => ({
        name: phase.name,
        status: phase.status,
        startTime: phase.startTime,
        endTime: phase.endTime,
        duration: phase.endTime && phase.startTime ? phase.endTime - phase.startTime : null,
        stepsCompleted: phase.steps.filter(s => s.status === STATUS_TYPES.COMPLETED).length,
        stepsTotal: phase.steps.length,
        steps: phase.steps.map(step => ({
          name: step.name,
          status: step.status,
          recordsProcessed: step.recordsProcessed,
          errors: step.errors.length,
          duration: step.endTime && step.startTime ? step.endTime - step.startTime : null
        }))
      })),
      performance: this.calculatePerformanceMetrics(),
      alerts: {
        active: this.getActiveAlerts(),
        total: this.alerts.length
      }
    };

    return report;
  }

  async generateComprehensiveReport() {
    const progressReport = await this.generateProgressReport();
    
    const comprehensiveReport = {
      ...progressReport,
      metrics: {
        current: this.getLatestMetrics(),
        history: this.getMetricsHistory(),
        trends: this.calculateMetricsTrends()
      },
      alerts: {
        active: this.getActiveAlerts(),
        history: this.alerts,
        summary: this.summarizeAlerts()
      },
      recommendations: this.generateRecommendations(),
      troubleshooting: this.generateTroubleshootingGuide()
    };

    return comprehensiveReport;
  }

  calculatePerformanceMetrics() {
    if (!this.migrationSession) return {};

    const currentTime = new Date();
    const elapsedTime = (currentTime - this.migrationSession.startTime) / 1000; // seconds
    
    return {
      elapsedTime: Math.round(elapsedTime),
      averageProcessingRate: Math.round(this.migrationSession.stats.processedRecords / Math.max(elapsedTime, 1) * 100) / 100,
      errorRate: Math.round((this.migrationSession.stats.errorsEncountered / Math.max(this.migrationSession.stats.processedRecords, 1)) * 10000) / 100,
      completionRate: Math.round((this.migrationSession.stats.completedTables / Math.max(this.migrationSession.stats.totalTables, 1)) * 100),
      estimatedTimeRemaining: this.calculateEstimatedTimeRemaining()
    };
  }

  calculateEstimatedTimeRemaining() {
    if (!this.migrationSession) return 0;

    const currentTime = new Date();
    const elapsedTime = (currentTime - this.migrationSession.startTime) / 1000;
    const completionRate = this.migrationSession.progress.overall / 100;
    
    if (completionRate === 0) return 0;
    
    const totalEstimatedTime = elapsedTime / completionRate;
    const remainingTime = totalEstimatedTime - elapsedTime;
    
    return Math.max(0, Math.round(remainingTime));
  }

  getMetricsHistory() {
    return Array.from(this.metrics.values()).slice(-20); // Last 20 data points
  }

  calculateMetricsTrends() {
    const history = this.getMetricsHistory();
    if (history.length < 2) return {};

    const latest = history[history.length - 1];
    const previous = history[history.length - 2];

    const trends = {};

    if (latest.migration && previous.migration) {
      trends.processingRate = {
        current: latest.migration.processingRate,
        previous: previous.migration.processingRate,
        trend: latest.migration.processingRate > previous.migration.processingRate ? 'improving' : 'declining'
      };

      trends.errorRate = {
        current: latest.migration.errorRate,
        previous: previous.migration.errorRate,
        trend: latest.migration.errorRate < previous.migration.errorRate ? 'improving' : 'worsening'
      };
    }

    return trends;
  }

  summarizeAlerts() {
    const alertCounts = {};
    
    this.alerts.forEach(alert => {
      alertCounts[alert.type] = (alertCounts[alert.type] || 0) + 1;
    });

    return {
      total: this.alerts.length,
      bySeverity: {
        critical: this.alerts.filter(a => a.severity === 'CRITICAL').length,
        warning: this.alerts.filter(a => a.severity === 'WARNING').length,
        info: this.alerts.filter(a => a.severity === 'INFO').length
      },
      byType: alertCounts
    };
  }

  generateRecommendations() {
    const recommendations = [];
    const activeAlerts = this.getActiveAlerts();

    if (activeAlerts.some(a => a.type === 'ERROR_RATE_HIGH')) {
      recommendations.push({
        priority: 'HIGH',
        category: 'Error Handling',
        recommendation: 'Investigate and resolve data quality issues causing high error rate',
        action: 'Pause migration, fix source data, resume migration'
      });
    }

    if (activeAlerts.some(a => a.type === 'PROCESSING_SLOWDOWN')) {
      recommendations.push({
        priority: 'MEDIUM',
        category: 'Performance',
        recommendation: 'Optimize database performance or increase resource allocation',
        action: 'Check indexes, increase memory allocation, or reduce batch size'
      });
    }

    if (activeAlerts.some(a => a.type === 'MEMORY_USAGE_HIGH')) {
      recommendations.push({
        priority: 'MEDIUM',
        category: 'Resources',
        recommendation: 'Monitor memory usage and consider reducing batch sizes',
        action: 'Reduce concurrent operations or increase available memory'
      });
    }

    if (recommendations.length === 0) {
      recommendations.push({
        priority: 'LOW',
        category: 'General',
        recommendation: 'Migration is proceeding normally',
        action: 'Continue monitoring for any issues'
      });
    }

    return recommendations;
  }

  generateTroubleshootingGuide() {
    return {
      commonIssues: [
        {
          issue: 'High error rate',
          symptoms: 'Error rate > 5%',
          causes: ['Data quality issues', 'Network connectivity', 'Database constraints'],
          solutions: ['Validate source data', 'Check network stability', 'Review constraint violations']
        },
        {
          issue: 'Slow processing',
          symptoms: 'Processing rate below expected',
          causes: ['Resource constraints', 'Database locks', 'Network latency'],
          solutions: ['Increase resources', 'Check for blocking queries', 'Optimize network connection']
        },
        {
          issue: 'Memory issues',
          symptoms: 'High memory usage or out of memory errors',
          causes: ['Large batch sizes', 'Memory leaks', 'Insufficient RAM'],
          solutions: ['Reduce batch size', 'Restart migration process', 'Increase available memory']
        }
      ],
      diagnosticQueries: [
        {
          name: 'Check active connections',
          query: 'SELECT count(*) FROM pg_stat_activity WHERE state = \'active\''
        },
        {
          name: 'Check database size',
          query: 'SELECT pg_size_pretty(pg_database_size(current_database()))'
        },
        {
          name: 'Check table sizes',
          query: 'SELECT schemaname, tablename, pg_size_pretty(pg_total_relation_size(schemaname||\'.\' ||tablename)) FROM pg_tables WHERE schemaname = \'public\' ORDER BY pg_total_relation_size(schemaname||\'.\' ||tablename) DESC LIMIT 10'
        }
      ]
    };
  }

  // ==================== EXPORT METHODS ====================

  async exportReport(format = 'json') {
    const report = await this.generateComprehensiveReport();
    const timestamp = new Date().toISOString().split('T')[0];
    const filename = `migration-report-${timestamp}.${format}`;

    switch (format) {
      case 'json':
        await fs.writeFile(`/tmp/${filename}`, JSON.stringify(report, null, 2));
        break;
      case 'csv':
        await this.exportToCSV(report, `/tmp/${filename}`);
        break;
      case 'html':
        await this.exportToHTML(report, `/tmp/${filename}`);
        break;
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }

    this.log('INFO', `Report exported: /tmp/${filename}`);
    return `/tmp/${filename}`;
  }

  async exportToCSV(report, filepath) {
    // Simple CSV export for statistics
    const csvLines = [
      'Table,Status,Records Processed,Errors,Duration',
      ...report.phases.flatMap(phase => 
        phase.steps.map(step => 
          `${step.name},${step.status},${step.recordsProcessed},${step.errors},${step.duration || 0}`
        )
      )
    ];

    await fs.writeFile(filepath, csvLines.join('\n'));
  }

  async exportToHTML(report, filepath) {
    const html = `
    <!DOCTYPE html>
    <html>
    <head>
        <title>Migration Report - ${report.session.name}</title>
        <style>
            body { font-family: Arial, sans-serif; margin: 20px; }
            .header { background: #f0f0f0; padding: 15px; border-radius: 5px; }
            .progress { background: #e8f5e8; padding: 10px; margin: 10px 0; border-radius: 5px; }
            .alert { background: #ffe6e6; padding: 10px; margin: 10px 0; border-radius: 5px; }
            table { border-collapse: collapse; width: 100%; margin: 10px 0; }
            th, td { border: 1px solid #ddd; padding: 8px; text-align: left; }
            th { background-color: #f2f2f2; }
        </style>
    </head>
    <body>
        <div class="header">
            <h1>Migration Report: ${report.session.name}</h1>
            <p>Session ID: ${report.session.id}</p>
            <p>Status: ${report.session.status}</p>
            <p>Started: ${report.session.startTime}</p>
        </div>
        
        <div class="progress">
            <h2>Progress</h2>
            <p>Overall: ${report.progress.overall}%</p>
            <p>Current Phase: ${report.progress.currentPhase || 'None'}</p>
            <p>Current Step: ${report.progress.currentStep || 'None'}</p>
        </div>
        
        <h2>Statistics</h2>
        <table>
            <tr><th>Metric</th><th>Value</th></tr>
            <tr><td>Total Tables</td><td>${report.statistics.totalTables}</td></tr>
            <tr><td>Completed Tables</td><td>${report.statistics.completedTables}</td></tr>
            <tr><td>Total Records</td><td>${report.statistics.totalRecords.toLocaleString()}</td></tr>
            <tr><td>Processed Records</td><td>${report.statistics.processedRecords.toLocaleString()}</td></tr>
            <tr><td>Failed Records</td><td>${report.statistics.failedRecords.toLocaleString()}</td></tr>
            <tr><td>Errors Encountered</td><td>${report.statistics.errorsEncountered}</td></tr>
        </table>
        
        ${report.alerts.active.length > 0 ? `
        <div class="alert">
            <h2>Active Alerts</h2>
            <ul>
                ${report.alerts.active.map(alert => `<li><strong>${alert.severity}</strong>: ${alert.message}</li>`).join('')}
            </ul>
        </div>
        ` : ''}
        
        <h2>Phase Details</h2>
        ${report.phases.map(phase => `
            <h3>${phase.name} - ${phase.status}</h3>
            <table>
                <tr><th>Step</th><th>Status</th><th>Records</th><th>Errors</th><th>Duration</th></tr>
                ${phase.steps.map(step => `
                    <tr>
                        <td>${step.name}</td>
                        <td>${step.status}</td>
                        <td>${step.recordsProcessed.toLocaleString()}</td>
                        <td>${step.errors}</td>
                        <td>${step.duration ? Math.round(step.duration / 1000) + 's' : '-'}</td>
                    </tr>
                `).join('')}
            </table>
        `).join('')}
        
    </body>
    </html>
    `;

    await fs.writeFile(filepath, html);
  }

  log(level, message) {
    const timestamp = new Date().toISOString();
    console.log(`[${timestamp}] ${level}: ${message}`);
  }
}

// ==================== UTILITY FUNCTIONS ====================

export async function createMigrationDashboard(db, options = {}) {
  return new MigrationDashboard(db, options);
}

export async function getSessionStatus(dashboard, sessionId) {
  if (dashboard.migrationSession?.id === sessionId) {
    return await dashboard.generateProgressReport();
  }
  throw new Error(`Session ${sessionId} not found`);
}

export default MigrationDashboard;