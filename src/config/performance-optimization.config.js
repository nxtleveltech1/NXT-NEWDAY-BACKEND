/**
 * PERFORMANCE OPTIMIZATION CONFIGURATION
 * Designed to handle 1000+ concurrent users on nxtdotx.co.za
 * Target: Sub-second response times under high load
 */

import { createClient } from 'redis';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import slowDown from 'express-slow-down';
import helmet from 'helmet';
import { RateLimiterRedis } from 'rate-limiter-flexible';

// Performance monitoring metrics
export const performanceMetrics = {
  requestCount: 0,
  totalResponseTime: 0,
  concurrentUsers: 0,
  cacheHitRate: 0,
  dbConnectionPool: {
    active: 0,
    idle: 0,
    waiting: 0
  },
  startTime: Date.now()
};

// Redis client for caching and rate limiting
let redisClient = null;
let rateLimiter = null;

/**
 * REDIS CACHING CONFIGURATION
 * High-performance Redis setup for production loads
 */
export const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD || '',
  db: 0,
  
  // Connection pool settings for high concurrency
  maxRetriesPerRequest: 3,
  retryDelayOnFailover: 100,
  enableReadyCheck: true,
  maxRetriesPerRequest: null,
  
  // Keep-alive settings
  keepAlive: true,
  family: 4,
  
  // Performance optimizations
  lazyConnect: true,
  connectTimeout: 10000,
  commandTimeout: 5000,
  
  // Connection pool
  maxConnections: 100,
  minConnections: 10
};

/**
 * Initialize Redis client with optimization
 */
export async function initializeRedisClient() {
  try {
    redisClient = createClient({
      url: `redis://${redisConfig.host}:${redisConfig.port}`,
      password: redisConfig.password,
      socket: {
        connectTimeout: redisConfig.connectTimeout,
        commandTimeout: redisConfig.commandTimeout,
        keepAlive: redisConfig.keepAlive,
        family: redisConfig.family
      },
      database: redisConfig.db
    });

    redisClient.on('error', (err) => {
      console.error('❌ Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      console.log('✅ Redis connected successfully');
    });

    redisClient.on('reconnecting', () => {
      console.log('🔄 Redis reconnecting...');
    });

    await redisClient.connect();
    
    // Initialize rate limiter with Redis
    rateLimiter = new RateLimiterRedis({
      storeClient: redisClient,
      keyPrefix: 'rl_nxtdotx',
      points: 100, // Number of requests
      duration: 60, // Per 60 seconds by IP
      blockDuration: 60, // Block for 60 seconds if limit exceeded
    });

    console.log('🚀 Redis cache and rate limiter initialized');
    return redisClient;
  } catch (error) {
    console.error('❌ Failed to initialize Redis:', error);
    return null;
  }
}

/**
 * DATABASE INDEXES FOR COMMON QUERIES
 * Critical indexes for performance optimization
 */
export const databaseIndexes = [
  // User and authentication indexes
  { table: 'users', columns: ['email'], unique: true },
  { table: 'users', columns: ['auth_id'], unique: true },
  { table: 'users', columns: ['created_at'] },
  { table: 'users', columns: ['organization_id'] },
  
  // Product and inventory indexes
  { table: 'products', columns: ['sku'], unique: true },
  { table: 'products', columns: ['category_id'] },
  { table: 'products', columns: ['supplier_id'] },
  { table: 'products', columns: ['status'] },
  { table: 'products', columns: ['created_at'] },
  { table: 'products', columns: ['updated_at'] },
  
  // Inventory tracking indexes
  { table: 'inventory', columns: ['product_id'] },
  { table: 'inventory', columns: ['location_id'] },
  { table: 'inventory', columns: ['last_updated'] },
  { table: 'inventory', columns: ['stock_level'] },
  
  // Order processing indexes
  { table: 'orders', columns: ['customer_id'] },
  { table: 'orders', columns: ['status'] },
  { table: 'orders', columns: ['order_date'] },
  { table: 'orders', columns: ['organization_id'] },
  
  // Supplier and pricing indexes
  { table: 'suppliers', columns: ['organization_id'] },
  { table: 'suppliers', columns: ['status'] },
  { table: 'supplier_prices', columns: ['product_id', 'supplier_id'] },
  { table: 'supplier_prices', columns: ['effective_date'] },
  
  // Financial indexes
  { table: 'invoices', columns: ['customer_id'] },
  { table: 'invoices', columns: ['status'] },
  { table: 'invoices', columns: ['due_date'] },
  { table: 'invoices', columns: ['created_at'] },
  
  // Communication indexes
  { table: 'messages', columns: ['sender_id'] },
  { table: 'messages', columns: ['recipient_id'] },
  { table: 'messages', columns: ['created_at'] },
  { table: 'messages', columns: ['message_type'] }
];

/**
 * COMPRESSION MIDDLEWARE CONFIGURATION
 * Optimize response sizes for faster transmission
 */
export const compressionConfig = compression({
  // Compress all responses
  filter: (req, res) => {
    if (req.headers['x-no-compression']) {
      return false;
    }
    return compression.filter(req, res);
  },
  
  // Compression level (1-9, 6 is default)
  level: 6,
  
  // Minimum bytes to compress
  threshold: 1024,
  
  // Compression algorithms
  chunkSize: 16 * 1024,
  windowBits: 15,
  memLevel: 8,
  
  // Additional MIME types to compress
  filter: (req, res) => {
    // Custom compression logic
    const contentType = res.get('Content-Type');
    if (contentType && (
      contentType.includes('application/json') ||
      contentType.includes('text/html') ||
      contentType.includes('text/css') ||
      contentType.includes('application/javascript') ||
      contentType.includes('text/javascript') ||
      contentType.includes('image/svg+xml')
    )) {
      return true;
    }
    return compression.filter(req, res);
  }
});

/**
 * RATE LIMITING CONFIGURATION
 * Protect against abuse while allowing high concurrency
 */
export const rateLimitConfig = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 1000, // Limit each IP to 1000 requests per minute
  message: {
    error: 'Too many requests from this IP, please try again later.',
    retryAfter: '1 minute'
  },
  standardHeaders: true,
  legacyHeaders: false,
  
  // Skip rate limiting for health checks
  skip: (req) => {
    return req.path === '/health' || req.path === '/metrics';
  },
  
  // Custom handler for rate limit exceeded
  handler: (req, res) => {
    performanceMetrics.rateLimitHits = (performanceMetrics.rateLimitHits || 0) + 1;
    res.status(429).json({
      error: 'Rate limit exceeded',
      retryAfter: 60,
      requestsRemaining: 0
    });
  }
});

/**
 * SLOW DOWN MIDDLEWARE CONFIGURATION
 * Gradually slow down requests as they approach rate limit
 */
export const slowDownConfig = slowDown({
  windowMs: 60 * 1000, // 1 minute
  delayAfter: 500, // Allow 500 fast requests per minute
  delayMs: 100, // Add 100ms delay per request after delayAfter
  maxDelayMs: 2000, // Maximum delay of 2 seconds
  
  // Skip slow down for critical endpoints
  skip: (req) => {
    return req.path === '/health' || req.path === '/metrics' || req.path.startsWith('/api/auth');
  }
});

/**
 * SECURITY MIDDLEWARE CONFIGURATION
 * Production-ready security headers
 */
export const securityConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "wss:", "ws:"],
    },
  },
  crossOriginEmbedderPolicy: false,
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
});

/**
 * CONNECTION POOLING OPTIMIZATION
 * Enhanced database connection pool settings
 */
export const connectionPoolConfig = {
  // PostgreSQL (Primary database)
  postgresql: {
    max: 50, // Maximum number of connections
    min: 10, // Minimum number of connections
    idle: 10000, // Close idle connections after 10 seconds
    acquire: 60000, // Maximum time to get connection
    evict: 1000, // Run eviction every second
    handleDisconnects: true,
    
    // Connection validation
    validate: true,
    retry: {
      max: 3,
      timeout: 5000
    },
    
    // Performance tuning
    statement_timeout: 30000,
    query_timeout: 25000,
    application_name: 'nxtdotx_backend'
  },
  
  // MySQL (Legacy support)
  mysql: {
    connectionLimit: 30,
    queueLimit: 0,
    acquireTimeout: 60000,
    timeout: 60000,
    reconnect: true,
    
    // Performance flags
    flags: [
      'COMPRESS',
      'PROTOCOL_41', 
      'TRANSACTIONS',
      'RESERVED',
      'SECURE_CONNECTION'
    ]
  },
  
  // Redis connection pool
  redis: {
    maxConnections: 100,
    minConnections: 10,
    acquireTimeoutMillis: 30000,
    idleTimeoutMillis: 30000,
    reapIntervalMillis: 1000
  }
};

/**
 * CACHING STRATEGIES
 * Multi-level caching for maximum performance
 */
export const cachingStrategies = {
  // L1 Cache: In-memory cache for frequently accessed data
  l1Cache: {
    maxSize: 1000,
    ttl: 300, // 5 minutes
    checkPeriod: 60 // Check for expired items every minute
  },
  
  // L2 Cache: Redis cache for shared data
  l2Cache: {
    ttl: 3600, // 1 hour
    keyPrefix: 'nxtdotx:',
    compression: true
  },
  
  // Cache strategies by data type
  strategies: {
    user_sessions: { ttl: 1800, type: 'redis' }, // 30 minutes
    product_catalog: { ttl: 3600, type: 'both' }, // 1 hour
    inventory_levels: { ttl: 300, type: 'redis' }, // 5 minutes
    supplier_prices: { ttl: 7200, type: 'both' }, // 2 hours
    analytics_data: { ttl: 600, type: 'redis' }, // 10 minutes
    system_config: { ttl: 86400, type: 'both' } // 24 hours
  }
};

/**
 * QUERY CACHING IMPLEMENTATION
 * Intelligent query result caching
 */
export class QueryCache {
  constructor() {
    this.memoryCache = new Map();
    this.hitCount = 0;
    this.missCount = 0;
  }

  async get(key) {
    // Check memory cache first (L1)
    if (this.memoryCache.has(key)) {
      this.hitCount++;
      const cached = this.memoryCache.get(key);
      if (cached.expires > Date.now()) {
        performanceMetrics.cacheHitRate = this.hitCount / (this.hitCount + this.missCount);
        return cached.data;
      } else {
        this.memoryCache.delete(key);
      }
    }

    // Check Redis cache (L2)
    if (redisClient) {
      try {
        const cached = await redisClient.get(`query:${key}`);
        if (cached) {
          this.hitCount++;
          const data = JSON.parse(cached);
          
          // Store in memory cache for faster future access
          this.memoryCache.set(key, {
            data,
            expires: Date.now() + (cachingStrategies.l1Cache.ttl * 1000)
          });
          
          performanceMetrics.cacheHitRate = this.hitCount / (this.hitCount + this.missCount);
          return data;
        }
      } catch (error) {
        console.error('Redis cache error:', error);
      }
    }

    this.missCount++;
    performanceMetrics.cacheHitRate = this.hitCount / (this.hitCount + this.missCount);
    return null;
  }

  async set(key, data, ttl = 3600) {
    // Store in memory cache
    this.memoryCache.set(key, {
      data,
      expires: Date.now() + (Math.min(ttl, cachingStrategies.l1Cache.ttl) * 1000)
    });

    // Store in Redis cache
    if (redisClient) {
      try {
        await redisClient.setEx(`query:${key}`, ttl, JSON.stringify(data));
      } catch (error) {
        console.error('Redis cache set error:', error);
      }
    }
  }

  async invalidate(pattern) {
    // Clear memory cache
    for (const key of this.memoryCache.keys()) {
      if (key.includes(pattern)) {
        this.memoryCache.delete(key);
      }
    }

    // Clear Redis cache
    if (redisClient) {
      try {
        const keys = await redisClient.keys(`query:*${pattern}*`);
        if (keys.length > 0) {
          await redisClient.del(keys);
        }
      } catch (error) {
        console.error('Redis cache invalidation error:', error);
      }
    }
  }

  getStats() {
    return {
      hitCount: this.hitCount,
      missCount: this.missCount,
      hitRate: this.hitCount / (this.hitCount + this.missCount) * 100,
      memoryCacheSize: this.memoryCache.size,
      maxMemoryCacheSize: cachingStrategies.l1Cache.maxSize
    };
  }
}

// Global query cache instance
export const queryCache = new QueryCache();

/**
 * PERFORMANCE MONITORING
 * Track system performance metrics
 */
export class PerformanceMonitor {
  constructor() {
    this.metrics = {
      requests: {
        total: 0,
        success: 0,
        errors: 0
      },
      response_times: {
        min: Infinity,
        max: 0,
        avg: 0,
        p95: 0,
        p99: 0
      },
      concurrent_users: 0,
      database: {
        connections: 0,
        queries: 0,
        slow_queries: 0
      },
      cache: {
        hits: 0,
        misses: 0,
        hit_rate: 0
      },
      memory: {
        used: 0,
        heap_used: 0,
        external: 0
      }
    };
    
    this.responseTimes = [];
    this.startTime = Date.now();
  }

  recordRequest(responseTime, success = true) {
    this.metrics.requests.total++;
    if (success) {
      this.metrics.requests.success++;
    } else {
      this.metrics.requests.errors++;
    }

    // Track response times
    this.responseTimes.push(responseTime);
    if (this.responseTimes.length > 1000) {
      this.responseTimes = this.responseTimes.slice(-1000); // Keep last 1000
    }

    this.metrics.response_times.min = Math.min(this.metrics.response_times.min, responseTime);
    this.metrics.response_times.max = Math.max(this.metrics.response_times.max, responseTime);
    this.metrics.response_times.avg = this.responseTimes.reduce((a, b) => a + b, 0) / this.responseTimes.length;

    // Calculate percentiles
    const sorted = [...this.responseTimes].sort((a, b) => a - b);
    this.metrics.response_times.p95 = sorted[Math.floor(sorted.length * 0.95)];
    this.metrics.response_times.p99 = sorted[Math.floor(sorted.length * 0.99)];
  }

  updateConcurrentUsers(count) {
    this.metrics.concurrent_users = count;
  }

  updateMemoryUsage() {
    const memUsage = process.memoryUsage();
    this.metrics.memory = {
      used: memUsage.rss / 1024 / 1024, // MB
      heap_used: memUsage.heapUsed / 1024 / 1024, // MB
      external: memUsage.external / 1024 / 1024 // MB
    };
  }

  getMetrics() {
    this.updateMemoryUsage();
    
    return {
      ...this.metrics,
      uptime: Date.now() - this.startTime,
      cache_stats: queryCache.getStats(),
      timestamp: new Date().toISOString()
    };
  }

  // Alert thresholds
  checkAlerts() {
    const alerts = [];
    
    if (this.metrics.response_times.avg > 1000) {
      alerts.push({ type: 'warning', message: 'High average response time' });
    }
    
    if (this.metrics.memory.used > 500) {
      alerts.push({ type: 'warning', message: 'High memory usage' });
    }
    
    if (this.metrics.requests.errors / this.metrics.requests.total > 0.05) {
      alerts.push({ type: 'critical', message: 'High error rate' });
    }
    
    return alerts;
  }
}

// Global performance monitor
export const performanceMonitor = new PerformanceMonitor();

/**
 * MIDDLEWARE FUNCTIONS
 */

// Performance tracking middleware
export const performanceMiddleware = (req, res, next) => {
  const startTime = Date.now();
  
  res.on('finish', () => {
    const responseTime = Date.now() - startTime;
    const success = res.statusCode < 400;
    performanceMonitor.recordRequest(responseTime, success);
  });
  
  next();
};

// Cache middleware
export const cacheMiddleware = (ttl = 300) => {
  return async (req, res, next) => {
    if (req.method !== 'GET') {
      return next();
    }

    const cacheKey = `${req.originalUrl || req.url}${JSON.stringify(req.query)}`;
    
    try {
      const cached = await queryCache.get(cacheKey);
      if (cached) {
        res.set('X-Cache', 'HIT');
        return res.json(cached);
      }
    } catch (error) {
      console.error('Cache middleware error:', error);
    }

    // Store original json method
    const originalJson = res.json;
    
    // Override json method to cache response
    res.json = function(data) {
      res.set('X-Cache', 'MISS');
      queryCache.set(cacheKey, data, ttl).catch(console.error);
      return originalJson.call(this, data);
    };

    next();
  };
};

// Rate limiting middleware with Redis
export const advancedRateLimitMiddleware = async (req, res, next) => {
  if (!rateLimiter) {
    return next();
  }

  try {
    const key = req.ip || req.connection.remoteAddress;
    await rateLimiter.consume(key);
    next();
  } catch (rejRes) {
    const totalHits = rejRes.totalHits;
    const totalRemainingPoints = rejRes.remainingPoints;
    const msBeforeNext = rejRes.msBeforeNext;

    res.set('Retry-After', Math.round(msBeforeNext / 1000) || 1);
    res.set('X-RateLimit-Limit', rateLimiter.points);
    res.set('X-RateLimit-Remaining', totalRemainingPoints);
    res.set('X-RateLimit-Reset', new Date(Date.now() + msBeforeNext));

    res.status(429).json({
      error: 'Too Many Requests',
      retryAfter: Math.round(msBeforeNext / 1000) || 1
    });
  }
};

export default {
  redisConfig,
  initializeRedisClient,
  databaseIndexes,
  compressionConfig,
  rateLimitConfig,
  slowDownConfig,
  securityConfig,
  connectionPoolConfig,
  cachingStrategies,
  queryCache,
  performanceMonitor,
  performanceMiddleware,
  cacheMiddleware,
  advancedRateLimitMiddleware
};