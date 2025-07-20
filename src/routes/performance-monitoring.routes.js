import express from 'express';
import { performanceMonitoringService } from '../services/performance-monitoring.service.js';
import { getPoolStats } from '../config/database.js';
import cacheService from '../services/cache.service.js';
import materializedViewRefreshService from '../services/materialized-view-refresh.service.js';
import os from 'os';

const router = express.Router();

/**
 * Get real-time performance dashboard
 */
router.get('/dashboard', async (req, res) => {
  try {
    const { timeRange = '1h' } = req.query;
    
    const dashboard = await performanceMonitoringService.getDashboardMetrics(timeRange);
    
    res.json({
      success: true,
      data: dashboard,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching performance dashboard:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch performance metrics'
    });
  }
});

/**
 * Get system health status
 */
router.get('/health', async (req, res) => {
  try {
    // Database pool stats
    const poolStats = getPoolStats();
    
    // Redis status
    const redisConnected = cacheService.isConnected;
    
    // System metrics
    const systemMetrics = {
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
        used: os.totalmem() - os.freemem(),
        usagePercent: ((os.totalmem() - os.freemem()) / os.totalmem()) * 100
      },
      cpu: {
        cores: os.cpus().length,
        loadAverage: os.loadavg()
      },
      uptime: process.uptime()
    };
    
    // Service status
    const serviceStatus = {
      database: poolStats.errors === 0 ? 'healthy' : 'degraded',
      redis: redisConnected ? 'healthy' : 'unavailable',
      materializedViews: materializedViewRefreshService.isRunning ? 'active' : 'inactive'
    };
    
    // Overall health
    const isHealthy = serviceStatus.database === 'healthy' && 
                     serviceStatus.redis === 'healthy' &&
                     systemMetrics.memory.usagePercent < 90;
    
    res.json({
      success: true,
      healthy: isHealthy,
      services: serviceStatus,
      database: {
        pool: poolStats,
        healthy: poolStats.errors === 0
      },
      cache: {
        connected: redisConnected,
        healthy: redisConnected
      },
      system: systemMetrics,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching health status:', error);
    res.status(500).json({
      success: false,
      healthy: false,
      error: 'Failed to fetch health status'
    });
  }
});

/**
 * Get performance alerts
 */
router.get('/alerts', async (req, res) => {
  try {
    const alerts = await performanceMonitoringService.getActiveAlerts();
    
    res.json({
      success: true,
      data: alerts,
      count: alerts.length,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching performance alerts:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch performance alerts'
    });
  }
});

/**
 * Get historical performance metrics
 */
router.get('/metrics/:metricName', async (req, res) => {
  try {
    const { metricName } = req.params;
    const { 
      startTime = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
      endTime = new Date().toISOString(),
      aggregation = '5m'
    } = req.query;
    
    const metrics = await performanceMonitoringService.getMetricHistory(
      metricName,
      new Date(startTime),
      new Date(endTime),
      aggregation
    );
    
    res.json({
      success: true,
      data: metrics,
      metricName,
      timeRange: { startTime, endTime },
      aggregation,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching metric history:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch metric history'
    });
  }
});

/**
 * Get materialized view refresh status
 */
router.get('/materialized-views', async (req, res) => {
  try {
    const status = materializedViewRefreshService.getRefreshStatus();
    
    res.json({
      success: true,
      data: status,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching materialized view status:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch materialized view status'
    });
  }
});

/**
 * Manually trigger materialized view refresh
 */
router.post('/materialized-views/:viewName/refresh', async (req, res) => {
  try {
    const { viewName } = req.params;
    
    const result = await materializedViewRefreshService.manualRefresh(viewName);
    
    res.json({
      success: true,
      message: `Materialized view ${viewName} refreshed successfully`,
      duration: result.duration,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error refreshing materialized view:', error);
    res.status(500).json({
      success: false,
      error: `Failed to refresh materialized view: ${error.message}`
    });
  }
});

/**
 * Get cache statistics
 */
router.get('/cache/stats', async (req, res) => {
  try {
    const stats = {
      connected: cacheService.isConnected,
      memoryCache: {
        size: cacheService.memoryCache.size,
        maxSize: cacheService.memoryCacheSize
      }
    };
    
    // Get Redis info if connected
    if (cacheService.isConnected && cacheService.client) {
      try {
        const info = await cacheService.client.info();
        const memoryMatch = info.match(/used_memory_human:(\S+)/);
        const hitRateMatch = info.match(/keyspace_hits:(\d+)/);
        const missRateMatch = info.match(/keyspace_misses:(\d+)/);
        
        stats.redis = {
          memory: memoryMatch ? memoryMatch[1] : 'unknown',
          hits: hitRateMatch ? parseInt(hitRateMatch[1]) : 0,
          misses: missRateMatch ? parseInt(missRateMatch[1]) : 0
        };
        
        if (stats.redis.hits > 0 || stats.redis.misses > 0) {
          stats.redis.hitRate = (stats.redis.hits / (stats.redis.hits + stats.redis.misses) * 100).toFixed(2) + '%';
        }
      } catch (err) {
        console.error('Error fetching Redis stats:', err);
      }
    }
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching cache stats:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to fetch cache statistics'
    });
  }
});

export default router;