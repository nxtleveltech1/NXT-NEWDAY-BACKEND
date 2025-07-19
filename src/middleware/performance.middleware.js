import { performance } from 'perf_hooks';
import rateLimit from 'express-rate-limit';
import compression from 'compression';
import { timeSeriesMetrics } from '../db/schema.js';
import { db } from '../db/index.js';
import optimizedQueryService from '../services/optimized-query.service.js';

/**
 * Performance monitoring middleware
 */
export function performanceMonitoring() {
  return (req, res, next) => {
    const startTime = performance.now();
    const startTimestamp = new Date();
    
    // Override res.json to capture response time
    const originalJson = res.json;
    res.json = function(data) {
      const endTime = performance.now();
      const responseTime = endTime - startTime;
      
      // Add performance headers
      res.set({
        'X-Response-Time': `${responseTime.toFixed(2)}ms`,
        'X-Timestamp': startTimestamp.toISOString()
      });
      
      // Log slow queries (>2000ms for analytics, >500ms for CRUD)
      const isAnalyticsEndpoint = req.path.includes('/analytics') || req.path.includes('/reports');
      const slowThreshold = isAnalyticsEndpoint ? 2000 : 500;
      
      if (responseTime > slowThreshold) {
        console.warn(`🐌 Slow ${req.method} ${req.path}: ${responseTime.toFixed(2)}ms`);
      }
      
      // Store metrics for monitoring (async, don't block response)
      setImmediate(async () => {
        try {
          await db.insert(timeSeriesMetrics).values({
            timestamp: startTimestamp,
            metricName: 'api_response_time',
            metricType: 'gauge',
            dimension1: req.method,
            dimension2: req.path.split('/')[2] || 'root', // API section
            dimension3: res.statusCode.toString(),
            value: responseTime,
            tags: {
              endpoint: req.path,
              method: req.method,
              statusCode: res.statusCode,
              userAgent: req.get('User-Agent')?.substring(0, 100)
            }
          });
        } catch (error) {
          console.error('Error storing performance metric:', error);
        }
      });
      
      return originalJson.call(this, data);
    };
    
    next();
  };
}

/**
 * API rate limiting with performance-based limits
 */
export const createRateLimiter = (options = {}) => {
  const {
    windowMs = 15 * 60 * 1000, // 15 minutes
    max = 1000, // requests per window
    message = 'Too many requests, please try again later',
    standardHeaders = true,
    legacyHeaders = false
  } = options;

  return rateLimit({
    windowMs,
    max,
    message: { error: message },
    standardHeaders,
    legacyHeaders,
    // Skip rate limiting for health checks
    skip: (req) => req.path === '/health',
    keyGenerator: (req) => {
      // Use IP + user ID if authenticated
      const userKey = req.user?.sub || 'anonymous';
      return `${req.ip}:${userKey}`;
    }
  });
};

/**
 * Compression middleware with optimized settings
 */
export const compressionMiddleware = compression({
  filter: (req, res) => {
    // Don't compress if Content-Encoding is already set
    if (req.headers['x-no-compression']) {
      return false;
    }
    // Fallback to standard filter
    return compression.filter(req, res);
  },
  level: 6, // Balanced compression level
  threshold: 1024, // Only compress responses > 1KB
  // Cache compressed responses
  chunkSize: 16 * 1024, // 16KB chunks
});

/**
 * Request timeout middleware
 */
export function requestTimeout(timeoutMs = 30000) {
  return (req, res, next) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        res.status(408).json({
          error: 'Request timeout',
          message: 'The request took too long to process'
        });
      }
    }, timeoutMs);

    // Clear timeout when response is sent
    res.on('finish', () => {
      clearTimeout(timeout);
    });

    next();
  };
}

/**
 * Memory usage monitoring
 */
export function memoryMonitoring() {
  return (req, res, next) => {
    const memBefore = process.memoryUsage();
    
    res.on('finish', () => {
      const memAfter = process.memoryUsage();
      const memDiff = {
        rss: memAfter.rss - memBefore.rss,
        heapUsed: memAfter.heapUsed - memBefore.heapUsed,
        heapTotal: memAfter.heapTotal - memBefore.heapTotal,
        external: memAfter.external - memBefore.external
      };
      
      // Log significant memory increases (>50MB)
      if (memDiff.heapUsed > 50 * 1024 * 1024) {
        console.warn(`📈 High memory usage for ${req.method} ${req.path}: +${(memDiff.heapUsed / 1024 / 1024).toFixed(2)}MB`);
      }
      
      // Store memory metrics
      setImmediate(async () => {
        try {
          await db.insert(timeSeriesMetrics).values([
            {
              timestamp: new Date(),
              metricName: 'memory_usage_rss',
              metricType: 'gauge',
              dimension1: req.method,
              dimension2: req.path.split('/')[2] || 'root',
              value: memAfter.rss / 1024 / 1024, // MB
              tags: { endpoint: req.path }
            },
            {
              timestamp: new Date(),
              metricName: 'memory_usage_heap',
              metricType: 'gauge',
              dimension1: req.method,
              dimension2: req.path.split('/')[2] || 'root',
              value: memAfter.heapUsed / 1024 / 1024, // MB
              tags: { endpoint: req.path }
            }
          ]);
        } catch (error) {
          console.error('Error storing memory metric:', error);
        }
      });
    });
    
    next();
  };
}

/**
 * Response caching middleware for GET requests
 */
export function responseCaching(ttlSeconds = 300) {
  return async (req, res, next) => {
    // Only cache GET requests
    if (req.method !== 'GET') {
      return next();
    }
    
    // Skip caching for auth-dependent endpoints that are user-specific
    const skipPatterns = ['/health', '/realtime'];
    if (skipPatterns.some(pattern => req.path.includes(pattern))) {
      return next();
    }
    
    const cacheKey = `api:${req.path}:${JSON.stringify(req.query)}`;
    
    try {
      const cached = await optimizedQueryService.getCachedOrExecute(
        cacheKey,
        () => null, // Don't execute anything, just check cache
        0 // No TTL for this check
      );
      
      if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(cached);
      }
    } catch (error) {
      console.error('Cache check error:', error);
    }
    
    // Override res.json to cache successful responses
    const originalJson = res.json;
    res.json = function(data) {
      // Cache successful responses (200-299)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        setImmediate(async () => {
          try {
            await optimizedQueryService.getCachedOrExecute(
              cacheKey,
              () => data,
              ttlSeconds
            );
          } catch (error) {
            console.error('Error caching response:', error);
          }
        });
      }
      
      res.set('X-Cache', 'MISS');
      return originalJson.call(this, data);
    };
    
    next();
  };
}

/**
 * Error tracking for performance issues
 */
export function performanceErrorHandler() {
  return (error, req, res, next) => {
    const errorMetrics = {
      timestamp: new Date(),
      metricName: 'api_error',
      metricType: 'counter',
      dimension1: req.method,
      dimension2: req.path.split('/')[2] || 'root',
      dimension3: error.name || 'UnknownError',
      value: 1,
      tags: {
        endpoint: req.path,
        errorMessage: error.message?.substring(0, 200),
        stack: error.stack?.substring(0, 500)
      }
    };
    
    // Store error metrics (async)
    setImmediate(async () => {
      try {
        await db.insert(timeSeriesMetrics).values(errorMetrics);
      } catch (metricError) {
        console.error('Error storing error metric:', metricError);
      }
    });
    
    // Log performance-related errors
    if (error.message?.includes('timeout') || 
        error.message?.includes('memory') ||
        error.message?.includes('performance')) {
      console.error(`⚠️ Performance Error in ${req.method} ${req.path}:`, error.message);
    }
    
    next(error);
  };
}

/**
 * Query optimization middleware
 */
export function queryOptimization() {
  return (req, res, next) => {
    // Add pagination defaults for list endpoints
    if (req.method === 'GET' && !req.query.limit) {
      // Set reasonable defaults based on endpoint type
      if (req.path.includes('/analytics')) {
        req.query.limit = '100';
      } else if (req.path.includes('/movements') || req.path.includes('/history')) {
        req.query.limit = '50';
      } else {
        req.query.limit = '25';
      }
    }
    
    // Ensure page is set
    if (req.method === 'GET' && !req.query.page) {
      req.query.page = '1';
    }
    
    // Validate and sanitize sort parameters
    if (req.query.sortBy) {
      const allowedSortFields = [
        'id', 'name', 'createdAt', 'updatedAt', 'quantity', 'price', 
        'orderDate', 'totalAmount', 'status', 'performanceRating'
      ];
      if (!allowedSortFields.includes(req.query.sortBy)) {
        req.query.sortBy = 'createdAt';
      }
    }
    
    if (req.query.sortOrder && !['asc', 'desc'].includes(req.query.sortOrder.toLowerCase())) {
      req.query.sortOrder = 'desc';
    }
    
    next();
  };
}

/**
 * Connection pooling monitoring
 */
export function connectionPoolMonitoring() {
  return (req, res, next) => {
    // Monitor database connection pool
    res.on('finish', () => {
      setImmediate(async () => {
        try {
          // This would require exposing pool stats from the database config
          // For now, we'll track active connections via a counter
          await db.insert(timeSeriesMetrics).values({
            timestamp: new Date(),
            metricName: 'db_connection_usage',
            metricType: 'gauge',
            dimension1: 'pool',
            value: 1, // Would be actual pool stats
            tags: { endpoint: req.path }
          });
        } catch (error) {
          console.error('Error storing connection metric:', error);
        }
      });
    });
    
    next();
  };
}

export default {
  performanceMonitoring,
  createRateLimiter,
  compressionMiddleware,
  requestTimeout,
  memoryMonitoring,
  responseCaching,
  performanceErrorHandler,
  queryOptimization,
  connectionPoolMonitoring
};