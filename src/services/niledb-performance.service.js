import { 
  executeOptimizedQuery, 
  getFastDashboardMetrics, 
  getFastRealTimeData,
  getOptimizedAnalytics,
  bulkInsertOptimized,
  getConnectionHealth,
  optimizeDatabase,
  performMaintenance,
  queryMetrics 
} from '../config/niledb-optimized.config.js';
import cacheService from './cache.service.js';

/**
 * NILEDB PERFORMANCE SERVICE
 * FIGHTER JET SPEED OPERATIONS
 * Target: <50ms response times, <200KB payloads
 */

class NileDBPerformanceService {
  constructor() {
    this.performanceMetrics = {
      queryCount: 0,
      totalTime: 0,
      cacheHitRate: 0,
      slowQueries: 0,
      errors: 0,
      lastOptimization: null
    };
    
    // Start performance monitoring
    this.startPerformanceMonitoring();
  }

  /**
   * ULTRA-FAST DASHBOARD DATA
   * Target: <25ms response
   */
  async getDashboardData(timeRange = '1h', lightweight = true) {
    const startTime = Date.now();
    
    try {
      const cacheKey = `niledb:dashboard:${timeRange}:${lightweight ? 'light' : 'full'}`;
      
      let data;
      if (lightweight) {
        // Lightweight version for real-time updates
        data = await executeOptimizedQuery(async () => {
          return getFastDashboardMetrics(timeRange);
        }, cacheKey, 30); // 30 second cache
      } else {
        // Full version with more details
        data = await this.getFullDashboardData(timeRange);
      }
      
      const responseTime = Date.now() - startTime;
      this.recordPerformanceMetric('dashboard_query', responseTime);
      
      // Ensure response is under 200KB
      const payload = JSON.stringify(data);
      if (payload.length > 200 * 1024) {
        console.warn(`⚠️ Dashboard payload too large: ${Math.round(payload.length / 1024)}KB`);
        // Compress data if too large
        data = this.compressPayload(data);
      }
      
      return {
        data,
        performance: {
          responseTime,
          cached: responseTime < 10,
          payloadSize: Math.round(JSON.stringify(data).length / 1024)
        },
        timestamp: new Date()
      };
    } catch (error) {
      this.recordPerformanceMetric('dashboard_error', Date.now() - startTime);
      throw error;
    }
  }

  /**
   * LIGHTNING-FAST REAL-TIME UPDATES
   * Target: <15ms response
   */
  async getRealTimeUpdates(dataTypes = ['metrics', 'events'], limit = 25) {
    const startTime = Date.now();
    
    try {
      const updates = await Promise.all(
        dataTypes.map(async (dataType) => {
          const data = await getFastRealTimeData(dataType, limit);
          return { type: dataType, data };
        })
      );
      
      const responseTime = Date.now() - startTime;
      this.recordPerformanceMetric('realtime_query', responseTime);
      
      return {
        updates,
        performance: {
          responseTime,
          dataTypes: dataTypes.length,
          totalRecords: updates.reduce((sum, update) => sum + update.data.length, 0)
        },
        timestamp: new Date()
      };
    } catch (error) {
      this.recordPerformanceMetric('realtime_error', Date.now() - startTime);
      throw error;
    }
  }

  /**
   * OPTIMIZED ANALYTICS QUERIES
   * Target: <100ms for complex analytics
   */
  async getAnalyticsData(queryType, params = {}) {
    const startTime = Date.now();
    
    try {
      let query, queryParams, cacheMinutes;
      
      switch (queryType) {
        case 'performance_summary':
          query = `
            SELECT 
              DATE_TRUNC('hour', timestamp) as hour,
              AVG(metric_value) as avg_response_time,
              COUNT(*) as request_count,
              PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY metric_value) as p95_response_time
            FROM dashboard_metrics 
            WHERE metric_name = 'api_response_time'
              AND timestamp >= NOW() - INTERVAL $1
            GROUP BY DATE_TRUNC('hour', timestamp)
            ORDER BY hour DESC
            LIMIT 24
          `;
          queryParams = [params.timeRange || '24 hours'];
          cacheMinutes = 5;
          break;
          
        case 'error_analysis':
          query = `
            SELECT 
              event_data->>'endpoint' as endpoint,
              COUNT(*) as error_count,
              event_data->>'error_type' as error_type
            FROM dashboard_events 
            WHERE event_type = 'api_error'
              AND timestamp >= NOW() - INTERVAL $1
            GROUP BY event_data->>'endpoint', event_data->>'error_type'
            ORDER BY error_count DESC
            LIMIT 20
          `;
          queryParams = [params.timeRange || '1 hour'];
          cacheMinutes = 2;
          break;
          
        case 'system_health':
          query = `
            SELECT 
              metric_name,
              AVG(metric_value) as avg_value,
              MAX(metric_value) as max_value,
              MIN(metric_value) as min_value,
              COUNT(*) as data_points
            FROM dashboard_metrics 
            WHERE metric_name IN ('memory_usage', 'cpu_usage', 'db_connections')
              AND timestamp >= NOW() - INTERVAL $1
            GROUP BY metric_name
          `;
          queryParams = [params.timeRange || '1 hour'];
          cacheMinutes = 3;
          break;
          
        default:
          throw new Error(`Unknown analytics query type: ${queryType}`);
      }
      
      const data = await getOptimizedAnalytics(query, queryParams, cacheMinutes);
      const responseTime = Date.now() - startTime;
      
      this.recordPerformanceMetric('analytics_query', responseTime);
      
      return {
        data,
        queryType,
        performance: {
          responseTime,
          recordCount: data.length,
          cached: responseTime < 20
        },
        timestamp: new Date()
      };
    } catch (error) {
      this.recordPerformanceMetric('analytics_error', Date.now() - startTime);
      throw error;
    }
  }

  /**
   * HIGH-PERFORMANCE BULK OPERATIONS
   * Target: >1000 records/second
   */
  async bulkInsertMetrics(metrics, options = {}) {
    const startTime = Date.now();
    const batchSize = options.batchSize || 1000;
    
    try {
      if (!metrics || metrics.length === 0) {
        return { inserted: 0, time: 0 };
      }
      
      // Validate and prepare data
      const validMetrics = metrics.filter(metric => 
        metric.metric_name && 
        typeof metric.metric_value === 'number' &&
        metric.timestamp
      );
      
      if (validMetrics.length !== metrics.length) {
        console.warn(`⚠️ Filtered ${metrics.length - validMetrics.length} invalid metrics`);
      }
      
      const result = await bulkInsertOptimized('dashboard_metrics', validMetrics, batchSize);
      const responseTime = Date.now() - startTime;
      
      this.recordPerformanceMetric('bulk_insert', responseTime);
      
      console.log(`🚀 Bulk insert performance: ${Math.round(result.inserted / responseTime * 1000)} records/sec`);
      
      return {
        ...result,
        performance: {
          recordsPerSecond: Math.round(result.inserted / responseTime * 1000),
          responseTime,
          batchSize,
          efficiency: result.inserted / metrics.length
        }
      };
    } catch (error) {
      this.recordPerformanceMetric('bulk_insert_error', Date.now() - startTime);
      throw error;
    }
  }

  /**
   * PERFORMANCE HEALTH CHECK
   */
  async getHealthMetrics() {
    try {
      const connectionHealth = await getConnectionHealth();
      const cacheStats = await this.getCacheStatistics();
      const systemHealth = await this.getSystemPerformance();
      
      return {
        niledb: connectionHealth,
        cache: cacheStats,
        system: systemHealth,
        performance: this.performanceMetrics,
        status: this.determineHealthStatus(connectionHealth, cacheStats, systemHealth),
        timestamp: new Date()
      };
    } catch (error) {
      console.error('Health check failed:', error);
      return {
        status: 'error',
        error: error.message,
        timestamp: new Date()
      };
    }
  }

  /**
   * PERFORMANCE OPTIMIZATION RUNNER
   */
  async runOptimization(force = false) {
    const lastOptimization = this.performanceMetrics.lastOptimization;
    const hoursSinceLastRun = lastOptimization 
      ? (Date.now() - lastOptimization) / (1000 * 60 * 60)
      : 24;
    
    if (!force && hoursSinceLastRun < 6) {
      return {
        skipped: true,
        reason: `Last optimization was ${Math.round(hoursSinceLastRun)} hours ago`,
        nextRun: new Date(lastOptimization + 6 * 60 * 60 * 1000)
      };
    }
    
    try {
      console.log('🚀 Starting NILEDB performance optimization...');
      
      const optimizationResult = await optimizeDatabase();
      const maintenanceResult = await performMaintenance();
      
      this.performanceMetrics.lastOptimization = Date.now();
      
      // Reset performance counters
      this.performanceMetrics.queryCount = 0;
      this.performanceMetrics.totalTime = 0;
      this.performanceMetrics.slowQueries = 0;
      this.performanceMetrics.errors = 0;
      
      return {
        success: true,
        optimization: optimizationResult,
        maintenance: maintenanceResult,
        timestamp: new Date()
      };
    } catch (error) {
      console.error('❌ Optimization failed:', error);
      throw error;
    }
  }

  /**
   * PRIVATE METHODS
   */
  
  async getFullDashboardData(timeRange) {
    // Implementation for full dashboard data
    const metrics = await getFastDashboardMetrics(timeRange);
    const events = await getFastRealTimeData('events', 50);
    const analytics = await this.getAnalyticsData('performance_summary', { timeRange });
    
    return {
      metrics,
      events,
      analytics: analytics.data,
      summary: {
        totalQueries: queryMetrics.totalQueries,
        averageResponseTime: queryMetrics.totalQueries > 0 
          ? Math.round(queryMetrics.totalTime / queryMetrics.totalQueries)
          : 0,
        cacheHitRate: queryMetrics.cacheHits > 0
          ? Math.round((queryMetrics.cacheHits / (queryMetrics.cacheHits + queryMetrics.cacheMisses)) * 100)
          : 0
      }
    };
  }
  
  compressPayload(data) {
    // Compress large payloads by removing unnecessary fields
    if (Array.isArray(data)) {
      return data.slice(0, 100); // Limit array size
    }
    
    if (typeof data === 'object') {
      const compressed = {};
      Object.keys(data).forEach(key => {
        if (key === 'metadata' || key === 'details') {
          // Skip large metadata fields
          compressed[key] = '[compressed]';
        } else {
          compressed[key] = data[key];
        }
      });
      return compressed;
    }
    
    return data;
  }
  
  recordPerformanceMetric(type, responseTime) {
    this.performanceMetrics.queryCount++;
    this.performanceMetrics.totalTime += responseTime;
    
    if (responseTime > 1000) {
      this.performanceMetrics.slowQueries++;
    }
    
    if (type.includes('error')) {
      this.performanceMetrics.errors++;
    }
    
    // Update cache hit rate
    if (queryMetrics.cacheHits > 0) {
      this.performanceMetrics.cacheHitRate = Math.round(
        (queryMetrics.cacheHits / (queryMetrics.cacheHits + queryMetrics.cacheMisses)) * 100
      );
    }
  }
  
  async getCacheStatistics() {
    try {
      // Get cache service statistics
      return {
        hits: queryMetrics.cacheHits,
        misses: queryMetrics.cacheMisses,
        hitRate: this.performanceMetrics.cacheHitRate,
        connected: cacheService.isConnected || false
      };
    } catch (error) {
      return { error: error.message };
    }
  }
  
  async getSystemPerformance() {
    const memUsage = process.memoryUsage();
    return {
      memory: {
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024),
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024),
        rss: Math.round(memUsage.rss / 1024 / 1024)
      },
      uptime: Math.round(process.uptime()),
      queries: {
        total: this.performanceMetrics.queryCount,
        averageTime: this.performanceMetrics.queryCount > 0
          ? Math.round(this.performanceMetrics.totalTime / this.performanceMetrics.queryCount)
          : 0,
        slowCount: this.performanceMetrics.slowQueries
      }
    };
  }
  
  determineHealthStatus(connectionHealth, cacheStats, systemHealth) {
    const poolUtilization = connectionHealth.pool.utilizationPercent;
    const cacheHitRate = cacheStats.hitRate || 0;
    const avgQueryTime = systemHealth.queries.averageTime;
    
    if (poolUtilization > 90 || avgQueryTime > 2000 || systemHealth.memory.heapUsed > 1000) {
      return 'critical';
    }
    
    if (poolUtilization > 70 || avgQueryTime > 1000 || cacheHitRate < 50) {
      return 'warning';
    }
    
    return 'healthy';
  }
  
  startPerformanceMonitoring() {
    // Monitor performance every 5 minutes
    setInterval(() => {
      this.logPerformanceMetrics();
    }, 5 * 60 * 1000);
    
    // Auto-optimization every 6 hours
    setInterval(() => {
      this.runOptimization().catch(console.error);
    }, 6 * 60 * 60 * 1000);
  }
  
  logPerformanceMetrics() {
    const avgTime = this.performanceMetrics.queryCount > 0
      ? Math.round(this.performanceMetrics.totalTime / this.performanceMetrics.queryCount)
      : 0;
    
    console.log(`📊 NILEDB Performance: ${this.performanceMetrics.queryCount} queries, ${avgTime}ms avg, ${this.performanceMetrics.cacheHitRate}% cache hit rate, ${this.performanceMetrics.slowQueries} slow queries`);
  }
}

// Export singleton instance
const niledbPerformanceService = new NileDBPerformanceService();

export { niledbPerformanceService };
export default niledbPerformanceService;