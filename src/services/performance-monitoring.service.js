import { sql, eq, and, desc, gte, lte, avg, sum, count, min, max } from 'drizzle-orm';
import { db } from '../db/index.js';
import { timeSeriesMetrics, timeSeriesEvents } from '../db/schema.js';
import cacheService from './cache.service.js';
import { performance } from 'perf_hooks';
import os from 'os';

class PerformanceMonitoringService {
  constructor() {
    this.metrics = new Map();
    this.alerts = [];
    this.thresholds = {
      apiResponseTime: {
        warning: 1000,  // 1 second
        critical: 2000  // 2 seconds for analytics, 500ms for CRUD
      },
      memoryUsage: {
        warning: 0.8,   // 80% of available memory
        critical: 0.9   // 90% of available memory
      },
      errorRate: {
        warning: 0.05,  // 5% error rate
        critical: 0.1   // 10% error rate
      },
      dbConnectionPool: {
        warning: 0.8,   // 80% pool utilization
        critical: 0.9   // 90% pool utilization
      }
    };
    
    // Start background monitoring
    this.startBackgroundMonitoring();
  }

  /**
   * Record a performance metric
   */
  async recordMetric(metricName, value, tags = {}) {
    try {
      await db.insert(timeSeriesMetrics).values({
        timestamp: new Date(),
        metricName,
        metricType: 'gauge',
        dimension1: tags.dimension1,
        dimension2: tags.dimension2,
        dimension3: tags.dimension3,
        value,
        tags
      });
    } catch (error) {
      console.error('Error recording metric:', error);
    }
  }

  /**
   * Record a performance event
   */
  async recordEvent(eventType, properties = {}) {
    try {
      await db.insert(timeSeriesEvents).values({
        timestamp: new Date(),
        eventType,
        eventCategory: 'performance',
        properties,
        duration: properties.duration || null,
        resultStatus: properties.status || 'success'
      });
    } catch (error) {
      console.error('Error recording event:', error);
    }
  }

  /**
   * Get real-time performance dashboard data
   */
  async getDashboardMetrics(timeRange = '1h') {
    const cacheKey = `performance_dashboard_${timeRange}`;
    
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    const timeRanges = {
      '5m': new Date(Date.now() - 5 * 60 * 1000),
      '15m': new Date(Date.now() - 15 * 60 * 1000),
      '1h': new Date(Date.now() - 60 * 60 * 1000),
      '24h': new Date(Date.now() - 24 * 60 * 60 * 1000),
      '7d': new Date(Date.now() - 7 * 24 * 60 * 60 * 1000)
    };

    const since = timeRanges[timeRange] || timeRanges['1h'];

    try {
      // API Response Times
      const apiMetrics = await db
        .select({
          endpoint: sql`dimension2`,
          avgResponseTime: avg(sql`value`),
          maxResponseTime: max(sql`value`),
          minResponseTime: min(sql`value`),
          requestCount: count(),
          p95ResponseTime: sql`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value)`
        })
        .from(timeSeriesMetrics)
        .where(
          and(
            eq(timeSeriesMetrics.metricName, 'api_response_time'),
            gte(timeSeriesMetrics.timestamp, since)
          )
        )
        .groupBy(sql`dimension2`)
        .orderBy(desc(sql`AVG(value)`));

      // Error Rates
      const errorMetrics = await db
        .select({
          endpoint: sql`dimension2`,
          errorCount: count(),
          errorRate: sql`COUNT(*) * 100.0 / (
            SELECT COUNT(*) 
            FROM time_series_metrics 
            WHERE metric_name = 'api_response_time' 
            AND dimension2 = time_series_metrics.dimension2
            AND timestamp >= ${since}
          )`
        })
        .from(timeSeriesMetrics)
        .where(
          and(
            eq(timeSeriesMetrics.metricName, 'api_error'),
            gte(timeSeriesMetrics.timestamp, since)
          )
        )
        .groupBy(sql`dimension2`);

      // Memory Usage Trends
      const memoryTrends = await db
        .select({
          timestamp: sql`DATE_TRUNC('minute', timestamp)`,
          avgMemoryRSS: avg(sql`CASE WHEN metric_name = 'memory_usage_rss' THEN value END`),
          avgMemoryHeap: avg(sql`CASE WHEN metric_name = 'memory_usage_heap' THEN value END`)
        })
        .from(timeSeriesMetrics)
        .where(
          and(
            sql`metric_name IN ('memory_usage_rss', 'memory_usage_heap')`,
            gte(timeSeriesMetrics.timestamp, since)
          )
        )
        .groupBy(sql`DATE_TRUNC('minute', timestamp)`)
        .orderBy(sql`DATE_TRUNC('minute', timestamp)`);

      // System Metrics
      const systemMetrics = this.getSystemMetrics();

      // Performance Alerts
      const alerts = await this.checkPerformanceAlerts(since);

      // Top Slow Endpoints
      const slowEndpoints = await db
        .select({
          endpoint: sql`CONCAT(dimension1, ' ', dimension2)`,
          avgResponseTime: avg(sql`value`),
          requestCount: count()
        })
        .from(timeSeriesMetrics)
        .where(
          and(
            eq(timeSeriesMetrics.metricName, 'api_response_time'),
            gte(timeSeriesMetrics.timestamp, since),
            gte(sql`value`, 1000) // Only endpoints taking >1s
          )
        )
        .groupBy(sql`CONCAT(dimension1, ' ', dimension2)`)
        .orderBy(desc(sql`AVG(value)`))
        .limit(10);

      const dashboard = {
        timeRange,
        generatedAt: new Date(),
        systemMetrics,
        apiMetrics,
        errorMetrics,
        memoryTrends,
        alerts,
        slowEndpoints,
        summary: {
          totalRequests: apiMetrics.reduce((sum, metric) => sum + Number(metric.requestCount), 0),
          avgResponseTime: apiMetrics.length > 0 
            ? apiMetrics.reduce((sum, metric) => sum + Number(metric.avgResponseTime), 0) / apiMetrics.length 
            : 0,
          totalErrors: errorMetrics.reduce((sum, metric) => sum + Number(metric.errorCount), 0),
          criticalAlerts: alerts.filter(alert => alert.severity === 'critical').length,
          warningAlerts: alerts.filter(alert => alert.severity === 'warning').length
        }
      };

      // Cache for 1 minute for real-time data, 5 minutes for historical
      const cacheTTL = timeRange === '5m' ? 60 : 300;
      await cacheService.set(cacheKey, dashboard, cacheTTL);

      return dashboard;
    } catch (error) {
      console.error('Error getting dashboard metrics:', error);
      throw error;
    }
  }

  /**
   * Get system metrics
   */
  getSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();
    const uptime = process.uptime();
    
    return {
      memory: {
        rss: Math.round(memUsage.rss / 1024 / 1024), // MB
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
        external: Math.round(memUsage.external / 1024 / 1024), // MB
        heapUsagePercent: Math.round((memUsage.heapUsed / memUsage.heapTotal) * 100)
      },
      system: {
        loadAverage: os.loadavg(),
        freeMemory: Math.round(os.freemem() / 1024 / 1024), // MB
        totalMemory: Math.round(os.totalmem() / 1024 / 1024), // MB
        memoryUsagePercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 100),
        uptime: Math.round(uptime),
        platform: os.platform(),
        nodeVersion: process.version
      },
      cpu: {
        user: Math.round(cpuUsage.user / 1000), // ms to seconds
        system: Math.round(cpuUsage.system / 1000) // ms to seconds
      }
    };
  }

  /**
   * Check for performance alerts
   */
  async checkPerformanceAlerts(since) {
    const alerts = [];

    try {
      // Check API response times
      const slowEndpoints = await db
        .select({
          endpoint: sql`dimension2`,
          avgResponseTime: avg(sql`value`),
          requestCount: count()
        })
        .from(timeSeriesMetrics)
        .where(
          and(
            eq(timeSeriesMetrics.metricName, 'api_response_time'),
            gte(timeSeriesMetrics.timestamp, since)
          )
        )
        .groupBy(sql`dimension2`)
        .having(sql`AVG(value) > ${this.thresholds.apiResponseTime.warning}`);

      slowEndpoints.forEach(endpoint => {
        const severity = Number(endpoint.avgResponseTime) > this.thresholds.apiResponseTime.critical 
          ? 'critical' : 'warning';
        
        alerts.push({
          type: 'slow_api_response',
          severity,
          message: `Slow API response on ${endpoint.endpoint}: ${Math.round(endpoint.avgResponseTime)}ms average`,
          value: endpoint.avgResponseTime,
          threshold: this.thresholds.apiResponseTime[severity],
          endpoint: endpoint.endpoint,
          requestCount: endpoint.requestCount,
          timestamp: new Date()
        });
      });

      // Check error rates
      const errorRates = await db
        .select({
          endpoint: sql`dimension2`,
          errorCount: count(),
          errorRate: sql`
            COUNT(*) * 100.0 / NULLIF((
              SELECT COUNT(*) 
              FROM time_series_metrics 
              WHERE metric_name = 'api_response_time' 
              AND dimension2 = time_series_metrics.dimension2
              AND timestamp >= ${since}
            ), 0)
          `
        })
        .from(timeSeriesMetrics)
        .where(
          and(
            eq(timeSeriesMetrics.metricName, 'api_error'),
            gte(timeSeriesMetrics.timestamp, since)
          )
        )
        .groupBy(sql`dimension2`)
        .having(sql`COUNT(*) * 100.0 / NULLIF((
          SELECT COUNT(*) 
          FROM time_series_metrics 
          WHERE metric_name = 'api_response_time' 
          AND dimension2 = time_series_metrics.dimension2
          AND timestamp >= ${since}
        ), 0) > ${this.thresholds.errorRate.warning * 100}`);

      errorRates.forEach(endpoint => {
        const errorRateDecimal = Number(endpoint.errorRate) / 100;
        const severity = errorRateDecimal > this.thresholds.errorRate.critical 
          ? 'critical' : 'warning';
        
        alerts.push({
          type: 'high_error_rate',
          severity,
          message: `High error rate on ${endpoint.endpoint}: ${endpoint.errorRate}%`,
          value: errorRateDecimal,
          threshold: this.thresholds.errorRate[severity],
          endpoint: endpoint.endpoint,
          errorCount: endpoint.errorCount,
          timestamp: new Date()
        });
      });

      // Check memory usage
      const systemMetrics = this.getSystemMetrics();
      const memoryUsagePercent = systemMetrics.system.memoryUsagePercent / 100;
      
      if (memoryUsagePercent > this.thresholds.memoryUsage.warning) {
        const severity = memoryUsagePercent > this.thresholds.memoryUsage.critical 
          ? 'critical' : 'warning';
        
        alerts.push({
          type: 'high_memory_usage',
          severity,
          message: `High system memory usage: ${Math.round(memoryUsagePercent * 100)}%`,
          value: memoryUsagePercent,
          threshold: this.thresholds.memoryUsage[severity],
          timestamp: new Date()
        });
      }

    } catch (error) {
      console.error('Error checking performance alerts:', error);
    }

    return alerts.sort((a, b) => {
      if (a.severity === 'critical' && b.severity !== 'critical') return -1;
      if (b.severity === 'critical' && a.severity !== 'critical') return 1;
      return b.timestamp - a.timestamp;
    });
  }

  /**
   * Get performance trends over time
   */
  async getPerformanceTrends(metricName, timeRange = '24h', granularity = 'hour') {
    const cacheKey = `trends_${metricName}_${timeRange}_${granularity}`;
    
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    const timeRanges = {
      '1h': new Date(Date.now() - 60 * 60 * 1000),
      '6h': new Date(Date.now() - 6 * 60 * 60 * 1000),
      '24h': new Date(Date.now() - 24 * 60 * 60 * 1000),
      '7d': new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
      '30d': new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    };

    const since = timeRanges[timeRange] || timeRanges['24h'];
    
    const dateFunction = granularity === 'minute' 
      ? "DATE_TRUNC('minute', timestamp)"
      : granularity === 'hour'
      ? "DATE_TRUNC('hour', timestamp)"
      : "DATE_TRUNC('day', timestamp)";

    try {
      const trends = await db
        .select({
          timestamp: sql`${sql.raw(dateFunction)}`,
          avgValue: avg(sql`value`),
          minValue: min(sql`value`),
          maxValue: max(sql`value`),
          count: count()
        })
        .from(timeSeriesMetrics)
        .where(
          and(
            eq(timeSeriesMetrics.metricName, metricName),
            gte(timeSeriesMetrics.timestamp, since)
          )
        )
        .groupBy(sql`${sql.raw(dateFunction)}`)
        .orderBy(sql`${sql.raw(dateFunction)}`);

      await cacheService.set(cacheKey, trends, 300); // 5 minutes cache
      return trends;
    } catch (error) {
      console.error('Error getting performance trends:', error);
      throw error;
    }
  }

  /**
   * Generate performance report
   */
  async generatePerformanceReport(dateFrom, dateTo) {
    const cacheKey = `performance_report_${dateFrom}_${dateTo}`;
    
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    try {
      const report = {
        period: { from: dateFrom, to: dateTo },
        generatedAt: new Date(),
        summary: {},
        apiPerformance: {},
        systemPerformance: {},
        recommendations: []
      };

      // API Performance Summary
      const apiSummary = await db
        .select({
          totalRequests: count(),
          avgResponseTime: avg(sql`value`),
          p95ResponseTime: sql`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value)`,
          p99ResponseTime: sql`PERCENTILE_CONT(0.99) WITHIN GROUP (ORDER BY value)`,
          slowRequests: sql`COUNT(CASE WHEN value > 2000 THEN 1 END)`,
          fastRequests: sql`COUNT(CASE WHEN value <= 500 THEN 1 END)`
        })
        .from(timeSeriesMetrics)
        .where(
          and(
            eq(timeSeriesMetrics.metricName, 'api_response_time'),
            gte(timeSeriesMetrics.timestamp, new Date(dateFrom)),
            lte(timeSeriesMetrics.timestamp, new Date(dateTo))
          )
        );

      report.apiPerformance = apiSummary[0] || {};

      // Top endpoints by response time
      const topEndpoints = await db
        .select({
          endpoint: sql`CONCAT(dimension1, ' ', dimension2)`,
          avgResponseTime: avg(sql`value`),
          requestCount: count(),
          p95ResponseTime: sql`PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY value)`
        })
        .from(timeSeriesMetrics)
        .where(
          and(
            eq(timeSeriesMetrics.metricName, 'api_response_time'),
            gte(timeSeriesMetrics.timestamp, new Date(dateFrom)),
            lte(timeSeriesMetrics.timestamp, new Date(dateTo))
          )
        )
        .groupBy(sql`CONCAT(dimension1, ' ', dimension2)`)
        .orderBy(desc(sql`AVG(value)`))
        .limit(10);

      report.apiPerformance.topSlowEndpoints = topEndpoints;

      // Error analysis
      const errorAnalysis = await db
        .select({
          totalErrors: count(),
          errorTypes: sql`jsonb_agg(DISTINCT dimension3)`,
          topErrorEndpoints: sql`
            jsonb_agg(
              jsonb_build_object(
                'endpoint', dimension2,
                'count', COUNT(*)
              ) ORDER BY COUNT(*) DESC
            ) FILTER (WHERE dimension2 IS NOT NULL)
          `
        })
        .from(timeSeriesMetrics)
        .where(
          and(
            eq(timeSeriesMetrics.metricName, 'api_error'),
            gte(timeSeriesMetrics.timestamp, new Date(dateFrom)),
            lte(timeSeriesMetrics.timestamp, new Date(dateTo))
          )
        );

      report.apiPerformance.errors = errorAnalysis[0] || {};

      // Generate recommendations
      const avgResponseTime = Number(report.apiPerformance.avgResponseTime) || 0;
      const slowRequestPercent = Number(report.apiPerformance.slowRequests) / Number(report.apiPerformance.totalRequests) * 100;

      if (avgResponseTime > 1000) {
        report.recommendations.push({
          type: 'performance',
          priority: 'high',
          title: 'Optimize API Response Times',
          description: `Average response time is ${Math.round(avgResponseTime)}ms. Consider implementing caching, database query optimization, or load balancing.`
        });
      }

      if (slowRequestPercent > 10) {
        report.recommendations.push({
          type: 'performance',
          priority: 'medium',
          title: 'Address Slow Endpoints',
          description: `${slowRequestPercent.toFixed(1)}% of requests are slower than 2 seconds. Review the slowest endpoints and optimize their queries.`
        });
      }

      if (Number(report.apiPerformance.errors?.totalErrors) > 0) {
        report.recommendations.push({
          type: 'reliability',
          priority: 'high',
          title: 'Reduce Error Rate',
          description: `${report.apiPerformance.errors.totalErrors} errors detected during the reporting period. Review error logs and implement proper error handling.`
        });
      }

      // Cache report for 1 hour
      await cacheService.set(cacheKey, report, 3600);
      return report;
    } catch (error) {
      console.error('Error generating performance report:', error);
      throw error;
    }
  }

  /**
   * Start background monitoring
   */
  startBackgroundMonitoring() {
    // Record system metrics every minute
    setInterval(() => {
      this.recordSystemMetrics();
    }, 60000);

    // Clean up old metrics every hour
    setInterval(() => {
      this.cleanupOldMetrics();
    }, 3600000);
  }

  /**
   * Record system metrics
   */
  async recordSystemMetrics() {
    try {
      const metrics = this.getSystemMetrics();
      const timestamp = new Date();

      await Promise.all([
        // Memory metrics
        this.recordMetric('system_memory_rss', metrics.memory.rss, { dimension1: 'process' }),
        this.recordMetric('system_memory_heap_used', metrics.memory.heapUsed, { dimension1: 'process' }),
        this.recordMetric('system_memory_usage_percent', metrics.system.memoryUsagePercent, { dimension1: 'system' }),
        
        // CPU metrics
        this.recordMetric('system_cpu_load_1m', metrics.system.loadAverage[0], { dimension1: 'system' }),
        this.recordMetric('system_cpu_load_5m', metrics.system.loadAverage[1], { dimension1: 'system' }),
        this.recordMetric('system_cpu_load_15m', metrics.system.loadAverage[2], { dimension1: 'system' }),
        
        // Process metrics
        this.recordMetric('process_uptime', metrics.system.uptime, { dimension1: 'process' })
      ]);
    } catch (error) {
      console.error('Error recording system metrics:', error);
    }
  }

  /**
   * Cleanup old metrics (keep last 30 days)
   */
  async cleanupOldMetrics() {
    try {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      
      await db
        .delete(timeSeriesMetrics)
        .where(lte(timeSeriesMetrics.timestamp, thirtyDaysAgo));
      
      await db
        .delete(timeSeriesEvents)
        .where(lte(timeSeriesEvents.timestamp, thirtyDaysAgo));
      
      console.log('Old performance metrics cleaned up');
    } catch (error) {
      console.error('Error cleaning up old metrics:', error);
    }
  }
}

// Singleton instance
const performanceMonitoringService = new PerformanceMonitoringService();

export default performanceMonitoringService;