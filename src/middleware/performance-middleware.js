/**
 * PERFORMANCE MIDDLEWARE SUITE
 * Comprehensive middleware for optimizing response times and handling high concurrency
 */

import compression from 'compression';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import helmet from 'helmet';
import responseTime from 'response-time';
import { createClient } from 'redis';
import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';

// Performance metrics collection
let performanceMetrics = {
  requests: {
    total: 0,
    success: 0,
    errors: 0,
    cached: 0
  },
  responseTimes: [],
  concurrentUsers: new Set(),
  rateLimitHits: 0,
  compressionSavings: 0,
  startTime: Date.now()
};

// Initialize Redis client for rate limiting
let redisClient = null;
let rateLimiter = null;
let memoryRateLimiter = null;

/**
 * Initialize Redis client for advanced rate limiting
 */
async function initializeRateLimitingRedis() {
  try {
    if (process.env.REDIS_URL || process.env.REDIS_HOST) {
      redisClient = createClient({
        url: process.env.REDIS_URL || `redis://${process.env.REDIS_HOST}:${process.env.REDIS_PORT || 6379}`,
        password: process.env.REDIS_PASSWORD,
        socket: {
          connectTimeout: 5000,
          lazyConnect: true
        }
      });

      redisClient.on('error', (err) => {
        console.warn('⚠️ Redis rate limiter error:', err.message);
      });

      await redisClient.connect();

      // Redis-based rate limiter
      rateLimiter = new RateLimiterRedis({
        storeClient: redisClient,
        keyPrefix: 'rl_nxtdotx',
        points: 100, // Requests
        duration: 60, // Per 60 seconds
        blockDuration: 60, // Block for 60 seconds
        execEvenly: true
      });

      console.log('✅ Redis rate limiter initialized');
    }
  } catch (error) {
    console.warn('⚠️ Redis rate limiter initialization failed, using memory fallback:', error.message);
  }

  // Memory fallback rate limiter
  memoryRateLimiter = new RateLimiterMemory({
    keyPrefix: 'rl_memory',
    points: 50, // More conservative for memory
    duration: 60,
    blockDuration: 60
  });

  console.log('✅ Memory rate limiter initialized');
}

/**
 * COMPRESSION MIDDLEWARE
 * Optimized compression for different content types
 */
export const compressionMiddleware = compression({
  level: 6, // Balance between compression ratio and speed
  threshold: 1024, // Only compress responses > 1KB
  
  filter: (req, res) => {
    // Don't compress if client doesn't support it
    if (req.headers['x-no-compression']) {
      return false;
    }

    // Don't compress images, videos, or already compressed files
    const contentType = res.get('Content-Type');
    if (contentType) {
      if (contentType.includes('image/') || 
          contentType.includes('video/') ||
          contentType.includes('application/zip') ||
          contentType.includes('application/gzip')) {
        return false;
      }
    }

    return compression.filter(req, res);
  },

  // Track compression savings
  onEnd: (req, res, originalSize, compressedSize) => {
    if (originalSize && compressedSize) {
      const savings = originalSize - compressedSize;
      performanceMetrics.compressionSavings += savings;
    }
  }
});

/**
 * ADVANCED RATE LIMITING MIDDLEWARE
 */
export const advancedRateLimitMiddleware = async (req, res, next) => {
  const clientKey = req.ip || req.connection.remoteAddress || 'unknown';
  
  try {
    // Use Redis rate limiter if available, otherwise memory
    const limiter = rateLimiter || memoryRateLimiter;
    
    if (limiter) {
      await limiter.consume(clientKey);
      
      // Add rate limit headers
      const resRateLimiter = await limiter.get(clientKey);
      if (resRateLimiter) {
        res.set({
          'X-RateLimit-Limit': limiter.points,
          'X-RateLimit-Remaining': resRateLimiter.remainingPoints || 0,
          'X-RateLimit-Reset': new Date(Date.now() + resRateLimiter.msBeforeNext || 0)
        });
      }
    }
    
    next();
  } catch (rejRes) {
    performanceMetrics.rateLimitHits++;
    
    const totalHits = rejRes.totalHits;
    const remainingPoints = rejRes.remainingPoints || 0;
    const msBeforeNext = rejRes.msBeforeNext || 60000;

    res.set({
      'Retry-After': Math.round(msBeforeNext / 1000) || 1,
      'X-RateLimit-Limit': rateLimiter?.points || 50,
      'X-RateLimit-Remaining': remainingPoints,
      'X-RateLimit-Reset': new Date(Date.now() + msBeforeNext)
    });

    res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please try again later.',
      retryAfter: Math.round(msBeforeNext / 1000) || 1,
      totalRequests: totalHits,
      remainingRequests: remainingPoints
    });
  }
};

/**
 * SMART SLOW DOWN MIDDLEWARE
 * Gradually increase response time as load increases
 */
export const smartSlowDownMiddleware = slowDown({
  windowMs: 60 * 1000, // 1 minute window
  delayAfter: 200, // Allow 200 fast requests per minute per IP
  delayMs: (used, req) => {
    // Progressive delay: 50ms for first excess request, then 100ms, 200ms, etc.
    const excessRequests = used - 200;
    return Math.min(50 * Math.pow(2, excessRequests - 1), 2000); // Max 2 second delay
  },
  maxDelayMs: 2000,
  
  // Skip delay for critical endpoints
  skip: (req) => {
    const criticalPaths = ['/health', '/metrics', '/api/auth/login'];
    return criticalPaths.some(path => req.path.startsWith(path));
  },
  
  // Custom delay handler
  onLimitReached: (req, res, options) => {
    console.log(`⚠️ Slow down activated for IP ${req.ip} on ${req.path}`);
  }
});

/**
 * RESPONSE TIME TRACKING MIDDLEWARE
 */
export const responseTimeMiddleware = responseTime((req, res, time) => {
  performanceMetrics.requests.total++;
  performanceMetrics.responseTimes.push(time);
  
  // Keep only last 1000 response times for memory efficiency
  if (performanceMetrics.responseTimes.length > 1000) {
    performanceMetrics.responseTimes = performanceMetrics.responseTimes.slice(-1000);
  }
  
  // Track success/error status
  if (res.statusCode < 400) {
    performanceMetrics.requests.success++;
  } else {
    performanceMetrics.requests.errors++;
  }
  
  // Log slow requests
  if (time > 1000) {
    console.warn(`🐌 Slow request: ${req.method} ${req.path} - ${time.toFixed(2)}ms`);
  }
  
  // Add performance headers
  res.set({
    'X-Response-Time': `${time.toFixed(2)}ms`,
    'X-Server-Timing': `total;dur=${time.toFixed(2)}`
  });
});

/**
 * CONCURRENT USER TRACKING MIDDLEWARE
 */
export const concurrentUserMiddleware = (req, res, next) => {
  const userId = req.user?.id || req.sessionID || req.ip;
  
  if (userId) {
    performanceMetrics.concurrentUsers.add(userId);
    
    // Clean up user tracking on response end
    res.on('finish', () => {
      // Keep user in set for 5 minutes to track recent activity
      setTimeout(() => {
        performanceMetrics.concurrentUsers.delete(userId);
      }, 5 * 60 * 1000);
    });
  }
  
  next();
};

/**
 * SECURITY MIDDLEWARE
 * Production-ready security headers
 */
export const securityMiddleware = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com", "https://cdn.jsdelivr.net"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "https://cdn.jsdelivr.net"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'"], // Note: unsafe-eval should be removed in production
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      connectSrc: ["'self'", "wss:", "ws:", "https:"],
      mediaSrc: ["'self'", "data:", "blob:"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    },
  },
  crossOriginEmbedderPolicy: false, // Disable for better compatibility
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true
  },
  referrerPolicy: {
    policy: ["strict-origin-when-cross-origin"]
  },
  
  // Custom headers for additional security
  customHeaders: {
    'X-Frame-Options': 'DENY',
    'X-Content-Type-Options': 'nosniff',
    'X-XSS-Protection': '1; mode=block',
    'Strict-Transport-Security': 'max-age=31536000; includeSubDomains; preload',
    'X-Permitted-Cross-Domain-Policies': 'none',
    'X-Download-Options': 'noopen',
    'X-DNS-Prefetch-Control': 'off'
  }
});

/**
 * CACHE CONTROL MIDDLEWARE
 * Intelligent caching based on content type and path
 */
export const cacheControlMiddleware = (req, res, next) => {
  const path = req.path;
  const method = req.method;
  
  // Only apply cache control to GET requests
  if (method !== 'GET') {
    res.set('Cache-Control', 'no-cache, no-store, must-revalidate');
    return next();
  }
  
  // Static assets - long cache
  if (path.match(/\.(js|css|png|jpg|jpeg|gif|ico|svg|woff|woff2|ttf|eot)$/)) {
    res.set({
      'Cache-Control': 'public, max-age=31536000', // 1 year
      'Expires': new Date(Date.now() + 31536000000).toUTCString()
    });
  }
  // API endpoints - short cache with validation
  else if (path.startsWith('/api/')) {
    if (path.includes('/health') || path.includes('/metrics')) {
      res.set('Cache-Control', 'no-cache');
    } else {
      res.set({
        'Cache-Control': 'private, max-age=300', // 5 minutes
        'ETag': `"${Date.now()}"`
      });
    }
  }
  // HTML pages - moderate cache with validation
  else {
    res.set({
      'Cache-Control': 'public, max-age=3600, must-revalidate', // 1 hour
      'ETag': `"${Date.now()}"`
    });
  }
  
  next();
};

/**
 * ERROR HANDLING MIDDLEWARE
 */
export const errorHandlingMiddleware = (err, req, res, next) => {
  console.error('❌ Request error:', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    timestamp: new Date().toISOString()
  });
  
  performanceMetrics.requests.errors++;
  
  // Don't expose internal errors in production
  const isDevelopment = process.env.NODE_ENV === 'development';
  
  const errorResponse = {
    error: 'Internal Server Error',
    message: isDevelopment ? err.message : 'Something went wrong',
    timestamp: new Date().toISOString(),
    path: req.path,
    requestId: req.headers['x-request-id'] || 'unknown'
  };
  
  if (isDevelopment) {
    errorResponse.stack = err.stack;
  }
  
  res.status(err.status || 500).json(errorResponse);
};

/**
 * REQUEST LOGGING MIDDLEWARE
 */
export const requestLoggingMiddleware = (req, res, next) => {
  const startTime = Date.now();
  
  // Generate request ID
  req.requestId = req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Add request ID to response headers
  res.set('X-Request-ID', req.requestId);
  
  // Log request start
  if (process.env.LOG_LEVEL === 'debug') {
    console.log(`🔍 ${req.method} ${req.path} - Start (${req.requestId})`);
  }
  
  // Log request completion
  res.on('finish', () => {
    const duration = Date.now() - startTime;
    const level = res.statusCode >= 400 ? '❌' : '✅';
    
    console.log(`${level} ${req.method} ${req.path} - ${res.statusCode} (${duration}ms) [${req.requestId}]`);
  });
  
  next();
};

/**
 * MEMORY MONITORING MIDDLEWARE
 */
export const memoryMonitoringMiddleware = (req, res, next) => {
  const memUsage = process.memoryUsage();
  const memoryThreshold = 500 * 1024 * 1024; // 500MB threshold
  
  if (memUsage.heapUsed > memoryThreshold) {
    console.warn(`⚠️ High memory usage: ${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
    
    // Force garbage collection if available
    if (global.gc) {
      global.gc();
      console.log('🗑️ Garbage collection triggered');
    }
  }
  
  // Add memory usage to response headers in development
  if (process.env.NODE_ENV === 'development') {
    res.set('X-Memory-Usage', `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`);
  }
  
  next();
};

/**
 * PERFORMANCE METRICS ENDPOINT
 */
export const getPerformanceMetrics = () => {
  const currentTime = Date.now();
  const uptime = currentTime - performanceMetrics.startTime;
  const avgResponseTime = performanceMetrics.responseTimes.length > 0 
    ? performanceMetrics.responseTimes.reduce((a, b) => a + b, 0) / performanceMetrics.responseTimes.length 
    : 0;
  
  // Calculate percentiles
  const sortedTimes = [...performanceMetrics.responseTimes].sort((a, b) => a - b);
  const p95 = sortedTimes[Math.floor(sortedTimes.length * 0.95)] || 0;
  const p99 = sortedTimes[Math.floor(sortedTimes.length * 0.99)] || 0;
  
  return {
    uptime: uptime,
    requests: {
      total: performanceMetrics.requests.total,
      success: performanceMetrics.requests.success,
      errors: performanceMetrics.requests.errors,
      cached: performanceMetrics.requests.cached,
      successRate: performanceMetrics.requests.total > 0 
        ? (performanceMetrics.requests.success / performanceMetrics.requests.total * 100).toFixed(2) + '%'
        : '0%'
    },
    responseTime: {
      average: Math.round(avgResponseTime),
      p95: Math.round(p95),
      p99: Math.round(p99),
      samples: performanceMetrics.responseTimes.length
    },
    concurrentUsers: performanceMetrics.concurrentUsers.size,
    rateLimitHits: performanceMetrics.rateLimitHits,
    compressionSavings: Math.round(performanceMetrics.compressionSavings / 1024) + 'KB',
    memory: {
      used: Math.round(process.memoryUsage().heapUsed / 1024 / 1024) + 'MB',
      total: Math.round(process.memoryUsage().rss / 1024 / 1024) + 'MB',
      external: Math.round(process.memoryUsage().external / 1024 / 1024) + 'MB'
    },
    system: {
      nodeVersion: process.version,
      platform: process.platform,
      cpuUsage: process.cpuUsage(),
      loadAverage: require('os').loadavg()
    }
  };
};

/**
 * MIDDLEWARE SETUP FUNCTION
 */
export const setupPerformanceMiddleware = async (app) => {
  console.log('🚀 Setting up performance middleware...');
  
  // Initialize rate limiting
  await initializeRateLimitingRedis();
  
  // Apply middleware in order
  app.use(requestLoggingMiddleware);
  app.use(responseTimeMiddleware);
  app.use(concurrentUserMiddleware);
  app.use(memoryMonitoringMiddleware);
  app.use(securityMiddleware);
  app.use(cacheControlMiddleware);
  app.use(compressionMiddleware);
  app.use(advancedRateLimitMiddleware);
  app.use(smartSlowDownMiddleware);
  
  // Performance metrics endpoint
  app.get('/api/performance/metrics', (req, res) => {
    res.json(getPerformanceMetrics());
  });
  
  console.log('✅ Performance middleware setup complete');
};

export default {
  compressionMiddleware,
  advancedRateLimitMiddleware,
  smartSlowDownMiddleware,
  responseTimeMiddleware,
  concurrentUserMiddleware,
  securityMiddleware,
  cacheControlMiddleware,
  errorHandlingMiddleware,
  requestLoggingMiddleware,
  memoryMonitoringMiddleware,
  getPerformanceMetrics,
  setupPerformanceMiddleware
};