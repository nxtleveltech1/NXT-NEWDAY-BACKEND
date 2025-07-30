import { RateLimiterRedis, RateLimiterMemory } from 'rate-limiter-flexible';
import { createClient } from 'redis';

// Rate limiter configuration for upload operations
export class UploadRateLimiter {
  constructor(options = {}) {
    this.options = {
      redis: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        ...options.redis
      },
      limits: {
        // Per supplier limits
        supplierPerMinute: options.supplierPerMinute || 10,
        supplierPerHour: options.supplierPerHour || 100,
        supplierPerDay: options.supplierPerDay || 1000,
        
        // Per user limits
        userPerMinute: options.userPerMinute || 20,
        userPerHour: options.userPerHour || 200,
        userPerDay: options.userPerDay || 2000,
        
        // Global limits
        globalPerMinute: options.globalPerMinute || 100,
        globalPerHour: options.globalPerHour || 1000,
        
        // File size based limits (bytes)
        smallFileSize: options.smallFileSize || 5 * 1024 * 1024,  // 5MB
        mediumFileSize: options.mediumFileSize || 20 * 1024 * 1024, // 20MB
        largeFileSize: options.largeFileSize || 50 * 1024 * 1024,   // 50MB
        
        // Concurrent upload limits
        maxConcurrentPerSupplier: options.maxConcurrentPerSupplier || 5,
        maxConcurrentPerUser: options.maxConcurrentPerUser || 10,
        maxConcurrentGlobal: options.maxConcurrentGlobal || 50,
        
        ...options.limits
      }
    };
    
    this.redis = null;
    this.limiters = {};
    this.concurrentUploads = {
      bySupplier: new Map(),
      byUser: new Map(),
      global: 0
    };
    
    this.initialize();
  }
  
  // Initialize rate limiters
  async initialize() {
    try {
      // Try to connect to Redis
      this.redis = createClient(this.options.redis);
      await this.redis.connect();
      console.log('✅ Upload Rate Limiter: Redis connected');
      
      // Create Redis-based limiters
      this.createRedisLimiters();
    } catch (error) {
      console.log('ℹ️ Upload Rate Limiter: Using memory storage (Redis not available)');
      
      // Create memory-based limiters as fallback
      this.createMemoryLimiters();
    }
  }
  
  // Create Redis-based rate limiters
  createRedisLimiters() {
    // Supplier rate limiters
    this.limiters.supplierPerMinute = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'upload_supplier_minute',
      points: this.options.limits.supplierPerMinute,
      duration: 60, // 1 minute
      blockDuration: 10, // Block for 10 seconds if exceeded
    });
    
    this.limiters.supplierPerHour = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'upload_supplier_hour',
      points: this.options.limits.supplierPerHour,
      duration: 3600, // 1 hour
      blockDuration: 60, // Block for 1 minute if exceeded
    });
    
    this.limiters.supplierPerDay = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'upload_supplier_day',
      points: this.options.limits.supplierPerDay,
      duration: 86400, // 24 hours
      blockDuration: 300, // Block for 5 minutes if exceeded
    });
    
    // User rate limiters
    this.limiters.userPerMinute = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'upload_user_minute',
      points: this.options.limits.userPerMinute,
      duration: 60,
      blockDuration: 10,
    });
    
    this.limiters.userPerHour = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'upload_user_hour',
      points: this.options.limits.userPerHour,
      duration: 3600,
      blockDuration: 60,
    });
    
    this.limiters.userPerDay = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'upload_user_day',
      points: this.options.limits.userPerDay,
      duration: 86400,
      blockDuration: 300,
    });
    
    // Global rate limiters
    this.limiters.globalPerMinute = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'upload_global_minute',
      points: this.options.limits.globalPerMinute,
      duration: 60,
      blockDuration: 5,
    });
    
    this.limiters.globalPerHour = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'upload_global_hour',
      points: this.options.limits.globalPerHour,
      duration: 3600,
      blockDuration: 30,
    });
    
    // File size based limiters
    this.limiters.largeFilePerHour = new RateLimiterRedis({
      storeClient: this.redis,
      keyPrefix: 'upload_large_file_hour',
      points: 10, // Only 10 large files per hour per supplier
      duration: 3600,
      blockDuration: 300,
    });
  }
  
  // Create memory-based rate limiters (fallback)
  createMemoryLimiters() {
    // Similar structure but using RateLimiterMemory
    this.limiters.supplierPerMinute = new RateLimiterMemory({
      keyPrefix: 'upload_supplier_minute',
      points: this.options.limits.supplierPerMinute,
      duration: 60,
      blockDuration: 10,
    });
    
    this.limiters.supplierPerHour = new RateLimiterMemory({
      keyPrefix: 'upload_supplier_hour',
      points: this.options.limits.supplierPerHour,
      duration: 3600,
      blockDuration: 60,
    });
    
    this.limiters.supplierPerDay = new RateLimiterMemory({
      keyPrefix: 'upload_supplier_day',
      points: this.options.limits.supplierPerDay,
      duration: 86400,
      blockDuration: 300,
    });
    
    this.limiters.userPerMinute = new RateLimiterMemory({
      keyPrefix: 'upload_user_minute',
      points: this.options.limits.userPerMinute,
      duration: 60,
      blockDuration: 10,
    });
    
    this.limiters.userPerHour = new RateLimiterMemory({
      keyPrefix: 'upload_user_hour',
      points: this.options.limits.userPerHour,
      duration: 3600,
      blockDuration: 60,
    });
    
    this.limiters.userPerDay = new RateLimiterMemory({
      keyPrefix: 'upload_user_day',
      points: this.options.limits.userPerDay,
      duration: 86400,
      blockDuration: 300,
    });
    
    this.limiters.globalPerMinute = new RateLimiterMemory({
      keyPrefix: 'upload_global_minute',
      points: this.options.limits.globalPerMinute,
      duration: 60,
      blockDuration: 5,
    });
    
    this.limiters.globalPerHour = new RateLimiterMemory({
      keyPrefix: 'upload_global_hour',
      points: this.options.limits.globalPerHour,
      duration: 3600,
      blockDuration: 30,
    });
    
    this.limiters.largeFilePerHour = new RateLimiterMemory({
      keyPrefix: 'upload_large_file_hour',
      points: 10,
      duration: 3600,
      blockDuration: 300,
    });
  }
  
  // Check if upload is allowed based on rate limits
  async checkUploadAllowed(uploadData) {
    const { supplierId, userId, file } = uploadData;
    const fileSize = file.size;
    const errors = [];
    const warnings = [];
    
    try {
      // Check concurrent upload limits
      const concurrentCheck = this.checkConcurrentLimits(supplierId, userId);
      if (!concurrentCheck.allowed) {
        return {
          allowed: false,
          reason: concurrentCheck.reason,
          retryAfter: concurrentCheck.retryAfter || 60000,
          errors: [concurrentCheck.reason]
        };
      }
      
      // Check supplier rate limits
      const supplierChecks = await this.checkSupplierLimits(supplierId);
      if (!supplierChecks.allowed) {
        errors.push(...supplierChecks.errors);
      }
      
      // Check user rate limits
      const userChecks = await this.checkUserLimits(userId);
      if (!userChecks.allowed) {
        errors.push(...userChecks.errors);
      }
      
      // Check global rate limits
      const globalChecks = await this.checkGlobalLimits();
      if (!globalChecks.allowed) {
        errors.push(...globalChecks.errors);
      }
      
      // Check file size based limits
      if (fileSize > this.options.limits.largeFileSize) {
        const largeFileCheck = await this.checkLargeFileLimits(supplierId);
        if (!largeFileCheck.allowed) {
          errors.push(...largeFileCheck.errors);
        }
      }
      
      // Calculate throttling if needed
      let throttleDelay = 0;
      
      // Apply progressive throttling based on usage
      const supplierUsage = await this.getUsagePercentage('supplier', supplierId);
      const userUsage = await this.getUsagePercentage('user', userId);
      const globalUsage = await this.getUsagePercentage('global', 'global');
      
      if (supplierUsage > 80 || userUsage > 80 || globalUsage > 80) {
        warnings.push('High usage detected - throttling applied');
        throttleDelay = this.calculateThrottleDelay(Math.max(supplierUsage, userUsage, globalUsage));
      }
      
      // Determine if allowed
      const allowed = errors.length === 0;
      
      return {
        allowed,
        errors,
        warnings,
        throttleDelay,
        usage: {
          supplier: supplierUsage,
          user: userUsage,
          global: globalUsage
        },
        limits: {
          supplierPerMinute: this.options.limits.supplierPerMinute,
          supplierPerHour: this.options.limits.supplierPerHour,
          supplierPerDay: this.options.limits.supplierPerDay,
          maxConcurrentPerSupplier: this.options.limits.maxConcurrentPerSupplier
        }
      };
      
    } catch (error) {
      console.error('Rate limiter check error:', error);
      // Allow upload if rate limiter fails (fail open)
      return {
        allowed: true,
        warnings: ['Rate limiter check failed - proceeding with upload']
      };
    }
  }
  
  // Check concurrent upload limits
  checkConcurrentLimits(supplierId, userId) {
    // Check global concurrent limit
    if (this.concurrentUploads.global >= this.options.limits.maxConcurrentGlobal) {
      return {
        allowed: false,
        reason: 'Global concurrent upload limit reached',
        retryAfter: 30000
      };
    }
    
    // Check supplier concurrent limit
    const supplierConcurrent = this.concurrentUploads.bySupplier.get(supplierId) || 0;
    if (supplierConcurrent >= this.options.limits.maxConcurrentPerSupplier) {
      return {
        allowed: false,
        reason: 'Supplier concurrent upload limit reached',
        retryAfter: 15000
      };
    }
    
    // Check user concurrent limit
    const userConcurrent = this.concurrentUploads.byUser.get(userId) || 0;
    if (userConcurrent >= this.options.limits.maxConcurrentPerUser) {
      return {
        allowed: false,
        reason: 'User concurrent upload limit reached',
        retryAfter: 10000
      };
    }
    
    return { allowed: true };
  }
  
  // Check supplier rate limits
  async checkSupplierLimits(supplierId) {
    const errors = [];
    
    try {
      await this.limiters.supplierPerMinute.consume(supplierId);
    } catch (rateLimiterRes) {
      errors.push(`Supplier minute limit exceeded. Retry after ${Math.round(rateLimiterRes.msBeforeNext / 1000)}s`);
    }
    
    try {
      await this.limiters.supplierPerHour.consume(supplierId);
    } catch (rateLimiterRes) {
      errors.push(`Supplier hourly limit exceeded. Retry after ${Math.round(rateLimiterRes.msBeforeNext / 1000)}s`);
    }
    
    try {
      await this.limiters.supplierPerDay.consume(supplierId);
    } catch (rateLimiterRes) {
      errors.push(`Supplier daily limit exceeded. Retry after ${Math.round(rateLimiterRes.msBeforeNext / 1000)}s`);
    }
    
    return {
      allowed: errors.length === 0,
      errors
    };
  }
  
  // Check user rate limits
  async checkUserLimits(userId) {
    const errors = [];
    
    try {
      await this.limiters.userPerMinute.consume(userId);
    } catch (rateLimiterRes) {
      errors.push(`User minute limit exceeded. Retry after ${Math.round(rateLimiterRes.msBeforeNext / 1000)}s`);
    }
    
    try {
      await this.limiters.userPerHour.consume(userId);
    } catch (rateLimiterRes) {
      errors.push(`User hourly limit exceeded. Retry after ${Math.round(rateLimiterRes.msBeforeNext / 1000)}s`);
    }
    
    try {
      await this.limiters.userPerDay.consume(userId);
    } catch (rateLimiterRes) {
      errors.push(`User daily limit exceeded. Retry after ${Math.round(rateLimiterRes.msBeforeNext / 1000)}s`);
    }
    
    return {
      allowed: errors.length === 0,
      errors
    };
  }
  
  // Check global rate limits
  async checkGlobalLimits() {
    const errors = [];
    
    try {
      await this.limiters.globalPerMinute.consume('global');
    } catch (rateLimiterRes) {
      errors.push(`Global minute limit exceeded. Retry after ${Math.round(rateLimiterRes.msBeforeNext / 1000)}s`);
    }
    
    try {
      await this.limiters.globalPerHour.consume('global');
    } catch (rateLimiterRes) {
      errors.push(`Global hourly limit exceeded. Retry after ${Math.round(rateLimiterRes.msBeforeNext / 1000)}s`);
    }
    
    return {
      allowed: errors.length === 0,
      errors
    };
  }
  
  // Check large file limits
  async checkLargeFileLimits(supplierId) {
    const errors = [];
    
    try {
      await this.limiters.largeFilePerHour.consume(supplierId);
    } catch (rateLimiterRes) {
      errors.push(`Large file hourly limit exceeded. Retry after ${Math.round(rateLimiterRes.msBeforeNext / 1000)}s`);
    }
    
    return {
      allowed: errors.length === 0,
      errors
    };
  }
  
  // Get usage percentage for rate limiting
  async getUsagePercentage(type, key) {
    try {
      let limiter;
      let maxPoints;
      
      switch (type) {
        case 'supplier':
          limiter = this.limiters.supplierPerMinute;
          maxPoints = this.options.limits.supplierPerMinute;
          break;
        case 'user':
          limiter = this.limiters.userPerMinute;
          maxPoints = this.options.limits.userPerMinute;
          break;
        case 'global':
          limiter = this.limiters.globalPerMinute;
          maxPoints = this.options.limits.globalPerMinute;
          break;
        default:
          return 0;
      }
      
      const res = await limiter.get(key);
      if (!res) return 0;
      
      return (res.consumedPoints / maxPoints) * 100;
    } catch (error) {
      return 0;
    }
  }
  
  // Calculate throttle delay based on usage
  calculateThrottleDelay(usagePercentage) {
    if (usagePercentage >= 95) {
      return 10000; // 10 seconds
    } else if (usagePercentage >= 90) {
      return 5000; // 5 seconds
    } else if (usagePercentage >= 85) {
      return 3000; // 3 seconds
    } else if (usagePercentage >= 80) {
      return 1000; // 1 second
    }
    return 0;
  }
  
  // Increment concurrent upload counters
  incrementConcurrent(supplierId, userId) {
    this.concurrentUploads.global++;
    
    const supplierCount = this.concurrentUploads.bySupplier.get(supplierId) || 0;
    this.concurrentUploads.bySupplier.set(supplierId, supplierCount + 1);
    
    const userCount = this.concurrentUploads.byUser.get(userId) || 0;
    this.concurrentUploads.byUser.set(userId, userCount + 1);
  }
  
  // Decrement concurrent upload counters
  decrementConcurrent(supplierId, userId) {
    this.concurrentUploads.global = Math.max(0, this.concurrentUploads.global - 1);
    
    const supplierCount = this.concurrentUploads.bySupplier.get(supplierId) || 0;
    if (supplierCount > 1) {
      this.concurrentUploads.bySupplier.set(supplierId, supplierCount - 1);
    } else {
      this.concurrentUploads.bySupplier.delete(supplierId);
    }
    
    const userCount = this.concurrentUploads.byUser.get(userId) || 0;
    if (userCount > 1) {
      this.concurrentUploads.byUser.set(userId, userCount - 1);
    } else {
      this.concurrentUploads.byUser.delete(userId);
    }
  }
  
  // Get current rate limit status
  async getRateLimitStatus(supplierId, userId) {
    const status = {
      supplier: {},
      user: {},
      global: {},
      concurrent: {
        supplier: this.concurrentUploads.bySupplier.get(supplierId) || 0,
        user: this.concurrentUploads.byUser.get(userId) || 0,
        global: this.concurrentUploads.global
      }
    };
    
    // Get supplier limits
    const supplierMinute = await this.limiters.supplierPerMinute.get(supplierId);
    const supplierHour = await this.limiters.supplierPerHour.get(supplierId);
    const supplierDay = await this.limiters.supplierPerDay.get(supplierId);
    
    status.supplier = {
      perMinute: {
        consumed: supplierMinute ? supplierMinute.consumedPoints : 0,
        remaining: this.options.limits.supplierPerMinute - (supplierMinute ? supplierMinute.consumedPoints : 0),
        resetIn: supplierMinute ? Math.round(supplierMinute.msBeforeNext / 1000) : 60
      },
      perHour: {
        consumed: supplierHour ? supplierHour.consumedPoints : 0,
        remaining: this.options.limits.supplierPerHour - (supplierHour ? supplierHour.consumedPoints : 0),
        resetIn: supplierHour ? Math.round(supplierHour.msBeforeNext / 1000) : 3600
      },
      perDay: {
        consumed: supplierDay ? supplierDay.consumedPoints : 0,
        remaining: this.options.limits.supplierPerDay - (supplierDay ? supplierDay.consumedPoints : 0),
        resetIn: supplierDay ? Math.round(supplierDay.msBeforeNext / 1000) : 86400
      }
    };
    
    // Get user limits
    const userMinute = await this.limiters.userPerMinute.get(userId);
    const userHour = await this.limiters.userPerHour.get(userId);
    const userDay = await this.limiters.userPerDay.get(userId);
    
    status.user = {
      perMinute: {
        consumed: userMinute ? userMinute.consumedPoints : 0,
        remaining: this.options.limits.userPerMinute - (userMinute ? userMinute.consumedPoints : 0),
        resetIn: userMinute ? Math.round(userMinute.msBeforeNext / 1000) : 60
      },
      perHour: {
        consumed: userHour ? userHour.consumedPoints : 0,
        remaining: this.options.limits.userPerHour - (userHour ? userHour.consumedPoints : 0),
        resetIn: userHour ? Math.round(userHour.msBeforeNext / 1000) : 3600
      },
      perDay: {
        consumed: userDay ? userDay.consumedPoints : 0,
        remaining: this.options.limits.userPerDay - (userDay ? userDay.consumedPoints : 0),
        resetIn: userDay ? Math.round(userDay.msBeforeNext / 1000) : 86400
      }
    };
    
    // Get global limits
    const globalMinute = await this.limiters.globalPerMinute.get('global');
    const globalHour = await this.limiters.globalPerHour.get('global');
    
    status.global = {
      perMinute: {
        consumed: globalMinute ? globalMinute.consumedPoints : 0,
        remaining: this.options.limits.globalPerMinute - (globalMinute ? globalMinute.consumedPoints : 0),
        resetIn: globalMinute ? Math.round(globalMinute.msBeforeNext / 1000) : 60
      },
      perHour: {
        consumed: globalHour ? globalHour.consumedPoints : 0,
        remaining: this.options.limits.globalPerHour - (globalHour ? globalHour.consumedPoints : 0),
        resetIn: globalHour ? Math.round(globalHour.msBeforeNext / 1000) : 3600
      }
    };
    
    return status;
  }
  
  // Reset rate limits (for admin use)
  async resetLimits(type, key) {
    const limitersToReset = [];
    
    switch (type) {
      case 'supplier':
        limitersToReset.push(
          this.limiters.supplierPerMinute,
          this.limiters.supplierPerHour,
          this.limiters.supplierPerDay
        );
        break;
      case 'user':
        limitersToReset.push(
          this.limiters.userPerMinute,
          this.limiters.userPerHour,
          this.limiters.userPerDay
        );
        break;
      case 'global':
        limitersToReset.push(
          this.limiters.globalPerMinute,
          this.limiters.globalPerHour
        );
        key = 'global';
        break;
      default:
        throw new Error('Invalid reset type');
    }
    
    for (const limiter of limitersToReset) {
      await limiter.delete(key);
    }
    
    return { success: true, message: `${type} limits reset for ${key}` };
  }
  
  // Get all current limits configuration
  getLimitsConfiguration() {
    return {
      supplier: {
        perMinute: this.options.limits.supplierPerMinute,
        perHour: this.options.limits.supplierPerHour,
        perDay: this.options.limits.supplierPerDay,
        maxConcurrent: this.options.limits.maxConcurrentPerSupplier
      },
      user: {
        perMinute: this.options.limits.userPerMinute,
        perHour: this.options.limits.userPerHour,
        perDay: this.options.limits.userPerDay,
        maxConcurrent: this.options.limits.maxConcurrentPerUser
      },
      global: {
        perMinute: this.options.limits.globalPerMinute,
        perHour: this.options.limits.globalPerHour,
        maxConcurrent: this.options.limits.maxConcurrentGlobal
      },
      fileSize: {
        small: this.options.limits.smallFileSize,
        medium: this.options.limits.mediumFileSize,
        large: this.options.limits.largeFileSize,
        largeFilePerHour: 10
      }
    };
  }
  
  // Cleanup and close connections
  async destroy() {
    if (this.redis) {
      await this.redis.quit();
    }
  }
}

// Singleton instance
let uploadRateLimiter = null;

// Get or create rate limiter instance
export function getUploadRateLimiter(options) {
  if (!uploadRateLimiter) {
    uploadRateLimiter = new UploadRateLimiter(options);
  }
  return uploadRateLimiter;
}