import express from 'express';
import { niledbPerformanceService } from '../services/niledb-performance.service.js';
import redisTurboCacheService from '../services/redis-turbo-cache.service.js';
import { getPerformanceMetrics } from '../middleware/fighter-jet-performance.middleware.js';
import FighterJetBenchmark from '../utils/performance-benchmark.js';
import { performance } from 'perf_hooks';

/**
 * PERFORMANCE DASHBOARD ROUTES
 * Ultra-fast performance monitoring and optimization endpoints
 */

const router = express.Router();

/**
 * GET /api/performance/dashboard
 * Real-time performance dashboard data
 * Target: <25ms response time
 */
router.get('/dashboard', async (req, res) => {
  const startTime = performance.now();
  const { timeRange = '1h', lightweight = 'true' } = req.query;
  
  try {
    // Get comprehensive performance data
    const [
      niledbHealth,
      redisMetrics,
      middlewareMetrics,
      dashboardData
    ] = await Promise.all([
      niledbPerformanceService.getHealthMetrics(),
      Promise.resolve(redisTurboCacheService.getMetrics()),
      Promise.resolve(getPerformanceMetrics()),
      niledbPerformanceService.getDashboardData(timeRange, lightweight === 'true')
    ]);
    
    const responseTime = performance.now() - startTime;
    
    res.json({
      performance: {
        responseTime: Math.round(responseTime * 100) / 100,
        level: responseTime < 25 ? 'FIGHTER_JET' : responseTime < 100 ? 'FAST' : 'SLOW'
      },
      niledb: {
        health: niledbHealth.status,
        performance: niledbHealth.performance,
        connectionPool: niledbHealth.niledb?.pool
      },
      cache: {
        redis: {
          connected: redisMetrics.isConnected,
          hitRate: redisMetrics.hitRate,
          avgResponseTime: redisMetrics.avgResponseTime,
          performance: redisMetrics.performance
        }
      },
      api: {
        totalRequests: middlewareMetrics.totalRequests,
        avgResponseTime: middlewareMetrics.avgResponseTime,
        fighterJetPercentage: middlewareMetrics.fighterJetPercentage,
        cacheHitRate: middlewareMetrics.cacheHitRate,
        performance: middlewareMetrics.performance
      },
      data: dashboardData.data,
      timestamp: new Date()
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    res.status(500).json({
      error: 'Performance dashboard error',
      message: error.message,
      responseTime: Math.round(responseTime * 100) / 100
    });
  }
});

/**
 * GET /api/performance/metrics
 * Detailed performance metrics
 */
router.get('/metrics', async (req, res) => {
  const startTime = performance.now();
  
  try {
    const metrics = await niledbPerformanceService.getHealthMetrics();
    const responseTime = performance.now() - startTime;
    
    res.json({
      ...metrics,
      responseTime: Math.round(responseTime * 100) / 100,
      performance: responseTime < 50 ? 'FIGHTER_JET' : responseTime < 200 ? 'FAST' : 'SLOW'
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    res.status(500).json({
      error: 'Metrics error',
      message: error.message,
      responseTime: Math.round(responseTime * 100) / 100
    });
  }
});

/**
 * GET /api/performance/niledb
 * NILEDB-specific performance data
 */
router.get('/niledb', async (req, res) => {
  const startTime = performance.now();
  const { timeRange = '1h' } = req.query;
  
  try {
    const data = await niledbPerformanceService.getDashboardData(timeRange, false);
    const responseTime = performance.now() - startTime;
    
    res.json({
      ...data,
      performance: {
        responseTime: Math.round(responseTime * 100) / 100,
        level: responseTime < 50 ? 'FIGHTER_JET' : responseTime < 200 ? 'FAST' : 'SLOW'
      }
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    res.status(500).json({
      error: 'NILEDB performance error',
      message: error.message,
      responseTime: Math.round(responseTime * 100) / 100
    });
  }
});

/**
 * GET /api/performance/realtime
 * Real-time performance updates
 * Target: <15ms response time
 */
router.get('/realtime', async (req, res) => {
  const startTime = performance.now();
  const { dataTypes = 'metrics,events', limit = '25' } = req.query;
  
  try {
    const types = dataTypes.split(',').map(t => t.trim());
    const data = await niledbPerformanceService.getRealTimeUpdates(types, parseInt(limit));
    const responseTime = performance.now() - startTime;
    
    res.json({
      ...data,
      performance: {
        responseTime: Math.round(responseTime * 100) / 100,
        level: responseTime < 15 ? 'FIGHTER_JET' : responseTime < 50 ? 'FAST' : 'SLOW'
      }
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    res.status(500).json({
      error: 'Real-time data error',
      message: error.message,
      responseTime: Math.round(responseTime * 100) / 100
    });
  }
});

/**
 * GET /api/performance/analytics
 * Performance analytics data
 */
router.get('/analytics', async (req, res) => {
  const startTime = performance.now();
  const { queryType = 'performance_summary', timeRange } = req.query;
  
  try {
    const params = timeRange ? { timeRange } : {};
    const data = await niledbPerformanceService.getAnalyticsData(queryType, params);
    const responseTime = performance.now() - startTime;
    
    res.json({
      ...data,
      performance: {
        responseTime: Math.round(responseTime * 100) / 100,
        level: responseTime < 100 ? 'FIGHTER_JET' : responseTime < 500 ? 'FAST' : 'SLOW'
      }
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    res.status(500).json({
      error: 'Performance analytics error',
      message: error.message,
      responseTime: Math.round(responseTime * 100) / 100
    });
  }
});

/**
 * GET /api/performance/cache
 * Cache performance metrics
 */
router.get('/cache', async (req, res) => {
  const startTime = performance.now();
  
  try {
    const redisMetrics = redisTurboCacheService.getMetrics();
    const middlewareMetrics = getPerformanceMetrics();
    const responseTime = performance.now() - startTime;
    
    res.json({
      redis: redisMetrics,
      middleware: {
        cacheHits: middlewareMetrics.cacheHits,
        cacheMisses: middlewareMetrics.cacheMisses,
        cacheHitRate: middlewareMetrics.cacheHitRate
      },
      performance: {
        responseTime: Math.round(responseTime * 100) / 100,
        level: responseTime < 10 ? 'FIGHTER_JET' : responseTime < 50 ? 'FAST' : 'SLOW'
      },
      timestamp: new Date()
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    res.status(500).json({
      error: 'Cache metrics error',
      message: error.message,
      responseTime: Math.round(responseTime * 100) / 100
    });
  }
});

/**
 * POST /api/performance/optimize
 * Run performance optimization
 */
router.post('/optimize', async (req, res) => {
  const startTime = performance.now();
  const { force = false } = req.body;
  
  try {
    const result = await niledbPerformanceService.runOptimization(force);
    const responseTime = performance.now() - startTime;
    
    res.json({
      ...result,
      performance: {
        optimizationTime: Math.round(responseTime * 100) / 100
      },
      timestamp: new Date()
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    res.status(500).json({
      error: 'Optimization failed',
      message: error.message,
      optimizationTime: Math.round(responseTime * 100) / 100
    });
  }
});

/**
 * POST /api/performance/benchmark
 * Run performance benchmark suite
 */
router.post('/benchmark', async (req, res) => {
  const startTime = performance.now();
  
  try {
    // Start benchmark in background for quick response
    const benchmark = new FighterJetBenchmark();
    
    // Run a quick health check first
    const quickResult = await benchmark.runHealthCheck();
    const responseTime = performance.now() - startTime;
    
    // Start full benchmark in background
    setImmediate(async () => {
      try {
        await benchmark.runFullBenchmark();
        console.log('✅ Background benchmark completed');
      } catch (error) {
        console.error('❌ Background benchmark failed:', error);
      }
    });
    
    res.json({
      message: 'Benchmark started',
      quickHealth: quickResult,
      performance: {
        responseTime: Math.round(responseTime * 100) / 100
      },
      note: 'Full benchmark running in background - check logs for results',
      timestamp: new Date()
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    res.status(500).json({
      error: 'Benchmark failed to start',
      message: error.message,
      responseTime: Math.round(responseTime * 100) / 100
    });
  }
});

/**
 * GET /api/performance/status
 * Quick performance status check
 * Target: <5ms response time
 */
router.get('/status', async (req, res) => {
  const startTime = performance.now();
  
  try {
    const middlewareMetrics = getPerformanceMetrics();
    const redisConnected = redisTurboCacheService.getMetrics().isConnected;
    const responseTime = performance.now() - startTime;
    
    const status = {
      overall: middlewareMetrics.avgResponseTime < 50 ? 'FIGHTER_JET' : 
               middlewareMetrics.avgResponseTime < 200 ? 'FAST' : 'SLOW',
      api: {
        avgResponseTime: middlewareMetrics.avgResponseTime,
        fighterJetPercentage: middlewareMetrics.fighterJetPercentage,
        totalRequests: middlewareMetrics.totalRequests
      },
      cache: {
        redis: redisConnected,
        hitRate: middlewareMetrics.cacheHitRate
      },
      performance: {
        responseTime: Math.round(responseTime * 100) / 100,
        level: responseTime < 5 ? 'FIGHTER_JET' : responseTime < 25 ? 'FAST' : 'SLOW'
      },
      timestamp: new Date()
    };
    
    res.json(status);
  } catch (error) {
    const responseTime = performance.now() - startTime;
    res.status(500).json({
      error: 'Status check failed',
      message: error.message,
      responseTime: Math.round(responseTime * 100) / 100
    });
  }
});

/**
 * DELETE /api/performance/cache
 * Clear performance caches
 */
router.delete('/cache', async (req, res) => {
  const startTime = performance.now();
  const { pattern = '*' } = req.query;
  
  try {
    const results = await Promise.all([
      redisTurboCacheService.delPattern(pattern),
      pattern === '*' ? redisTurboCacheService.flushDatabase() : Promise.resolve(false)
    ]);
    
    const responseTime = performance.now() - startTime;
    
    res.json({
      message: 'Cache cleared',
      deletedKeys: results[0],
      flushed: results[1],
      performance: {
        responseTime: Math.round(responseTime * 100) / 100
      },
      timestamp: new Date()
    });
  } catch (error) {
    const responseTime = performance.now() - startTime;
    res.status(500).json({
      error: 'Cache clear failed',
      message: error.message,
      responseTime: Math.round(responseTime * 100) / 100
    });
  }
});

/**
 * WebSocket endpoint for real-time performance monitoring
 */
router.ws('/live', (ws, req) => {
  console.log('📡 Performance monitoring WebSocket connected');
  
  const sendUpdate = async () => {
    try {
      const startTime = performance.now();
      
      const [
        healthMetrics,
        redisMetrics,
        middlewareMetrics
      ] = await Promise.all([
        niledbPerformanceService.getHealthMetrics(),
        Promise.resolve(redisTurboCacheService.getMetrics()),
        Promise.resolve(getPerformanceMetrics())
      ]);
      
      const responseTime = performance.now() - startTime;
      
      const update = {
        type: 'performance_update',
        data: {
          niledb: healthMetrics,
          redis: redisMetrics,
          api: middlewareMetrics,
          updateTime: Math.round(responseTime * 100) / 100
        },
        timestamp: new Date()
      };
      
      if (ws.readyState === ws.OPEN) {
        ws.send(JSON.stringify(update));
      }
    } catch (error) {
      console.error('WebSocket update error:', error);
    }
  };
  
  // Send updates every 5 seconds
  const interval = setInterval(sendUpdate, 5000);
  
  // Send initial update
  sendUpdate();
  
  ws.on('close', () => {
    clearInterval(interval);
    console.log('📡 Performance monitoring WebSocket disconnected');
  });
  
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    clearInterval(interval);
  });
});

export default router;