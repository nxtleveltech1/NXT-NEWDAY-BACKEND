import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { db } from '../config/database.js';
import { timeSeriesMetrics } from '../db/schema.js';
import { createClient } from 'redis';

/**
 * Advanced DDoS Protection Service
 */
class DDoSProtectionService {
  constructor() {
    this.initialized = false;
    this.redis = null;
    this.limiters = {};
    this.suspiciousIPs = new Set();
    this.blockedIPs = new Set();
    this.analytics = {
      requestsBlocked: 0,
      suspiciousActivity: 0,
      totalRequests: 0
    };
    this.eventBatch = null; // For batching security events
  }

  async initialize() {
    try {
      // Try to connect to Redis, fallback to memory if unavailable
      if (process.env.REDIS_URL) {
        const redisConfig = {
          url: process.env.REDIS_URL,
          // Only set password if it exists and is not empty
          ...(process.env.REDIS_PASSWORD && process.env.REDIS_PASSWORD.trim() !== '' && {
            password: process.env.REDIS_PASSWORD
          }),
        };
        this.redis = createClient(redisConfig);
        await this.redis.connect();
        console.log('✅ DDoS Protection: Redis connected');
      } else {
        console.log('ℹ️ DDoS Protection: Using memory storage (Redis not available)');
      }

      this.setupRateLimiters();
      this.startAnalyticsReporting();
      this.initialized = true;
      
      console.log('✅ DDoS Protection Service initialized');
    } catch (error) {
      console.error('❌ DDoS Protection initialization failed:', error);
      // Fallback to memory-only mode
      this.setupRateLimiters();
      this.initialized = true;
    }
  }

  setupRateLimiters() {
    const limiterConfig = {
      storeClient: this.redis,
      keyPrefix: 'ddos_protection',
      execEvenly: true,
    };

    // Tier 1: Strict rate limiting for authentication endpoints
    this.limiters.auth = this.redis ? 
      new RateLimiterRedis({
        ...limiterConfig,
        keyPrefix: 'auth_limit',
        points: 5, // 5 attempts
        duration: 900, // Per 15 minutes
        blockDuration: 900, // Block for 15 minutes
      }) :
      new RateLimiterMemory({
        points: 5,
        duration: 900,
        blockDuration: 900,
      });

    // Tier 2: API endpoints rate limiting
    this.limiters.api = this.redis ?
      new RateLimiterRedis({
        ...limiterConfig,
        keyPrefix: 'api_limit',
        points: 100, // 100 requests
        duration: 60, // Per minute
        blockDuration: 300, // Block for 5 minutes
      }) :
      new RateLimiterMemory({
        points: 100,
        duration: 60,
        blockDuration: 300,
      });

    // Tier 3: Upload endpoints
    this.limiters.upload = this.redis ?
      new RateLimiterRedis({
        ...limiterConfig,
        keyPrefix: 'upload_limit',
        points: 10, // 10 uploads
        duration: 600, // Per 10 minutes
        blockDuration: 1800, // Block for 30 minutes
      }) :
      new RateLimiterMemory({
        points: 10,
        duration: 600,
        blockDuration: 1800,
      });

    // Tier 4: Global IP limiting (anti-flood)
    this.limiters.global = this.redis ?
      new RateLimiterRedis({
        ...limiterConfig,
        keyPrefix: 'global_limit',
        points: 1000, // 1000 requests
        duration: 3600, // Per hour
        blockDuration: 3600, // Block for 1 hour
      }) :
      new RateLimiterMemory({
        points: 1000,
        duration: 3600,
        blockDuration: 3600,
      });

    // Tier 5: Suspicious activity detection
    this.limiters.suspicious = this.redis ?
      new RateLimiterRedis({
        ...limiterConfig,
        keyPrefix: 'suspicious_limit',
        points: 1, // 1 strike
        duration: 86400, // Per day
        blockDuration: 86400, // Block for 24 hours
      }) :
      new RateLimiterMemory({
        points: 1,
        duration: 86400,
        blockDuration: 86400,
      });
  }

  /**
   * Main DDoS protection middleware
   */
  protectionMiddleware() {
    return async (req, res, next) => {
      if (!this.initialized) {
        return next();
      }

      const ip = this.getClientIP(req);
      const userAgent = req.get('User-Agent') || 'unknown';
      const endpoint = req.path;
      const method = req.method;

      try {
        // Update request analytics
        this.analytics.totalRequests++;

        // Check if IP is in blocklist
        if (this.blockedIPs.has(ip)) {
          await this.logSecurityEvent('BLOCKED_IP_ACCESS', {
            ip, userAgent, endpoint, method
          });
          return this.sendBlockedResponse(res, 'IP_BLOCKED');
        }

        // Determine protection tier based on endpoint
        const tier = this.getProtectionTier(endpoint);
        const limiterKey = `${ip}:${tier}`;

        // Apply rate limiting
        const limiter = this.limiters[tier];
        const resRateLimiter = await limiter.consume(limiterKey);

        // Add rate limit headers
        res.set({
          'X-RateLimit-Limit': limiter.points,
          'X-RateLimit-Remaining': resRateLimiter.remainingPoints,
          'X-RateLimit-Reset': new Date(Date.now() + resRateLimiter.msBeforeNext)
        });

        // Check for suspicious patterns
        await this.detectSuspiciousActivity(req, ip, userAgent);

        next();

      } catch (rejRes) {
        // Rate limit exceeded
        this.analytics.requestsBlocked++;
        
        await this.logSecurityEvent('RATE_LIMIT_EXCEEDED', {
          ip, userAgent, endpoint, method,
          tier: this.getProtectionTier(endpoint),
          remainingPoints: rejRes.remainingPoints || 0,
          msBeforeNext: rejRes.msBeforeNext || 0
        });

        // Add suspicious activity if repeatedly hitting limits
        if (rejRes.totalHits > limiter.points * 2) {
          this.suspiciousIPs.add(ip);
          this.analytics.suspiciousActivity++;
        }

        return this.sendRateLimitResponse(res, rejRes);
      }
    };
  }

  /**
   * Get client IP with proper proxy handling
   */
  getClientIP(req) {
    return req.headers['cf-connecting-ip'] || // Cloudflare
           req.headers['x-real-ip'] || // Nginx
           req.headers['x-forwarded-for']?.split(',')[0] || // Standard proxy
           req.connection?.remoteAddress ||
           req.socket?.remoteAddress ||
           req.ip ||
           'unknown';
  }

  /**
   * Determine protection tier based on endpoint
   */
  getProtectionTier(endpoint) {
    if (endpoint.includes('/auth') || endpoint.includes('/login')) {
      return 'auth';
    }
    if (endpoint.includes('/upload') || endpoint.includes('/price-lists')) {
      return 'upload';
    }
    if (endpoint.includes('/api/')) {
      return 'api';
    }
    return 'global';
  }

  /**
   * Detect suspicious activity patterns
   */
  async detectSuspiciousActivity(req, ip, userAgent) {
    const patterns = {
      // Empty or suspicious user agents
      suspiciousUserAgent: !userAgent || 
                          userAgent.length < 10 || 
                          /bot|crawler|spider|scraper/i.test(userAgent),
      
      // Rapid sequential requests (checked via timing)
      rapidRequests: req.headers['x-request-timing'] && 
                    parseInt(req.headers['x-request-timing']) < 100,
      
      // Unusual request patterns
      unusualHeaders: !req.headers['accept'] || 
                     !req.headers['accept-language'],
      
      // Large payloads to non-upload endpoints
      largePayload: req.headers['content-length'] && 
                   parseInt(req.headers['content-length']) > 1024 * 1024 && 
                   !req.path.includes('/upload'),
      
      // SQL injection attempts in URL
      sqlInjection: /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION)\b|--|#|\/\*)/i.test(req.url),
      
      // Path traversal attempts
      pathTraversal: /(\.\.|\/etc\/|\/var\/|\/proc\/|\\\\)/i.test(req.url)
    };

    const suspiciousCount = Object.values(patterns).filter(Boolean).length;
    
    if (suspiciousCount >= 2) {
      this.suspiciousIPs.add(ip);
      this.analytics.suspiciousActivity++;
      
      await this.logSecurityEvent('SUSPICIOUS_ACTIVITY_DETECTED', {
        ip, userAgent,
        endpoint: req.path,
        method: req.method,
        patterns: Object.keys(patterns).filter(key => patterns[key]),
        suspiciousCount
      });

      // Auto-block after multiple suspicious activities
      try {
        await this.limiters.suspicious.consume(ip);
      } catch (rejRes) {
        this.blockedIPs.add(ip);
        await this.logSecurityEvent('IP_AUTO_BLOCKED', {
          ip, userAgent, reason: 'Multiple suspicious activities'
        });
      }
    }
  }

  /**
   * Send rate limit exceeded response
   */
  sendRateLimitResponse(res, rejRes) {
    const retryAfter = Math.round(rejRes.msBeforeNext / 1000) || 1;
    
    res.set({
      'Retry-After': retryAfter,
      'X-RateLimit-Limit': rejRes.points || 0,
      'X-RateLimit-Remaining': rejRes.remainingPoints || 0,
      'X-RateLimit-Reset': new Date(Date.now() + rejRes.msBeforeNext)
    });

    return res.status(429).json({
      success: false,
      error: 'Too many requests',
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'You have exceeded the rate limit. Please try again later.',
      retryAfter: `${retryAfter} seconds`,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Send blocked IP response
   */
  sendBlockedResponse(res, reason) {
    return res.status(403).json({
      success: false,
      error: 'Access denied',
      code: reason,
      message: 'Your IP address has been blocked due to suspicious activity.',
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log security events with batching and throttling
   */
  async logSecurityEvent(eventType, details) {
    try {
      // Check system load before logging non-critical events
      const severity = this.getSeverityLevel(eventType);
      const memUsage = process.memoryUsage();
      const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      // Skip logging low severity events during high load
      if (memUsagePercent > 85 && severity === 'LOW') {
        return;
      }

      // Batch non-critical events to reduce database pressure
      if (severity === 'MEDIUM' || severity === 'LOW') {
        this.batchSecurityEvent(eventType, details);
      } else {
        // Log critical events immediately
        await db.insert(timeSeriesMetrics).values({
          timestamp: new Date(),
          metricName: 'ddos_protection_event',
          metricType: 'counter',
          dimension1: eventType,
          dimension2: details.ip || 'unknown',
          dimension3: details.endpoint || 'unknown',
          value: 1,
          tags: {
            ...details,
            severity,
            service: 'ddos_protection'
          }
        });
      }

      // Only log to console for high severity events or during low load
      if (severity === 'HIGH' || severity === 'CRITICAL' || memUsagePercent < 70) {
        console.warn(`🛡️ DDoS Protection [${eventType}]:`, details);
      }
    } catch (error) {
      console.error('Failed to log DDoS protection event:', error);
    }
  }

  /**
   * Batch security events to reduce database load
   */
  batchSecurityEvent(eventType, details) {
    if (!this.eventBatch) {
      this.eventBatch = [];
      // Process batch every 30 seconds
      setTimeout(() => this.processBatchedEvents(), 30000);
    }

    this.eventBatch.push({
      timestamp: new Date(),
      metricName: 'ddos_protection_event',
      metricType: 'counter',
      dimension1: eventType,
      dimension2: details.ip || 'unknown',
      dimension3: details.endpoint || 'unknown',
      value: 1,
      tags: {
        ...details,
        severity: this.getSeverityLevel(eventType),
        service: 'ddos_protection'
      }
    });
  }

  /**
   * Process batched security events
   */
  async processBatchedEvents() {
    if (!this.eventBatch || this.eventBatch.length === 0) {
      return;
    }

    try {
      await db.insert(timeSeriesMetrics).values(this.eventBatch);
      console.log(`Processed ${this.eventBatch.length} batched DDoS protection events`);
    } catch (error) {
      console.error('Failed to process batched events:', error);
    } finally {
      this.eventBatch = null;
    }
  }

  /**
   * Get severity level for events
   */
  getSeverityLevel(eventType) {
    const severityMap = {
      'RATE_LIMIT_EXCEEDED': 'MEDIUM',
      'SUSPICIOUS_ACTIVITY_DETECTED': 'HIGH',
      'IP_AUTO_BLOCKED': 'HIGH',
      'BLOCKED_IP_ACCESS': 'MEDIUM'
    };
    return severityMap[eventType] || 'LOW';
  }

  /**
   * Manual IP blocking/unblocking
   */
  async blockIP(ip, reason = 'Manual block') {
    this.blockedIPs.add(ip);
    await this.logSecurityEvent('IP_MANUALLY_BLOCKED', { ip, reason });
  }

  async unblockIP(ip) {
    this.blockedIPs.delete(ip);
    this.suspiciousIPs.delete(ip);
    await this.logSecurityEvent('IP_UNBLOCKED', { ip });
  }

  /**
   * Get protection statistics
   */
  getStatistics() {
    return {
      ...this.analytics,
      blockedIPs: this.blockedIPs.size,
      suspiciousIPs: this.suspiciousIPs.size,
      rateLimitersStatus: Object.keys(this.limiters).reduce((status, key) => {
        status[key] = 'active';
        return status;
      }, {}),
      isInitialized: this.initialized,
      redisConnected: !!this.redis
    };
  }

  /**
   * Start optimized analytics reporting with reduced frequency
   */
  startAnalyticsReporting() {
    setInterval(async () => {
      try {
        // Check if we should skip reporting during high load
        const memUsage = process.memoryUsage();
        const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
        
        if (memUsagePercent > 90) {
          console.log('Skipping DDoS analytics reporting due to high memory usage');
          return;
        }

        const stats = this.getStatistics();
        
        // Only report if there's meaningful data to reduce database load
        if (stats.requestsBlocked > 0 || stats.suspiciousActivity > 0 || stats.totalRequests > 100) {
          await db.insert(timeSeriesMetrics).values([
            {
              timestamp: new Date(),
              metricName: 'ddos_requests_blocked',
              metricType: 'counter',
              value: stats.requestsBlocked,
              tags: { service: 'ddos_protection' }
            },
            {
              timestamp: new Date(),
              metricName: 'ddos_suspicious_activity',
              metricType: 'counter',
              value: stats.suspiciousActivity,
              tags: { service: 'ddos_protection' }
            },
            {
              timestamp: new Date(),
              metricName: 'ddos_total_requests',
              metricType: 'counter',
              value: stats.totalRequests,
              tags: { service: 'ddos_protection' }
            },
            {
              timestamp: new Date(),
              metricName: 'ddos_blocked_ips',
              metricType: 'gauge',
              value: stats.blockedIPs,
              tags: { service: 'ddos_protection' }
            }
          ]);
        }

        // Reset counters
        this.analytics.requestsBlocked = 0;
        this.analytics.suspiciousActivity = 0;
        this.analytics.totalRequests = 0;

      } catch (error) {
        console.error('Error reporting DDoS analytics:', error);
      }
    }, 300000); // Reduced from 1 minute to 5 minutes
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    if (this.redis) {
      await this.redis.disconnect();
    }
  }
}

// Export singleton instance
export const ddosProtectionService = new DDoSProtectionService();
export default ddosProtectionService;