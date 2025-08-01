import { createClient } from 'redis';
import { createHash } from 'crypto';
import { compress, decompress } from 'zlib';
import { promisify } from 'util';

/**
 * REDIS TURBO CACHE SERVICE
 * Ultra-high performance Redis caching for NILEDB operations
 * Target: <5ms cache operations, 95%+ hit rate
 */

const compressAsync = promisify(compress);
const decompressAsync = promisify(decompress);

class RedisTurboCacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      compressionSaved: 0,
      totalResponseTime: 0,
      operationCount: 0
    };
    
    // Performance settings
    this.config = {
      compressionThreshold: 1024, // Compress payloads > 1KB
      maxKeyLength: 250, // Redis key length limit
      defaultTTL: 300, // 5 minutes
      maxValueSize: 512 * 1024 * 1024, // 512MB max value size
      connectionTimeout: 1000, // 1 second connection timeout
      retryAttempts: 3,
      retryDelay: 100
    };
    
    this.initializeConnection();
    this.startMetricsLogging();
  }

  /**
   * Initialize Redis connection with optimal settings
   */
  async initializeConnection() {
    try {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        socket: {
          connectTimeout: this.config.connectionTimeout,
          lazyConnect: true,
          keepAlive: true,
          noDelay: true // Disable Nagle's algorithm for lower latency
        },
        database: parseInt(process.env.REDIS_CACHE_DB || '1'),
        // Performance optimizations
        retry_delay_on_failover: this.config.retryDelay,
        retry_delay_on_cluster_down: this.config.retryDelay,
        max_attempts: this.config.retryAttempts,
        enable_offline_queue: false, // Fail fast instead of queueing
        // Optimized serialization
        return_buffers: false,
        detect_buffers: false
      });

      // Event handlers
      this.client.on('connect', () => {
        console.log('🚀 Redis Turbo Cache connected');
        this.isConnected = true;
      });

      this.client.on('ready', () => {
        console.log('🚀 Redis Turbo Cache ready for FIGHTER JET performance');
        this.optimizeRedisSettings();
      });

      this.client.on('error', (err) => {
        console.error('❌ Redis Turbo Cache error:', err.message);
        this.isConnected = false;
        this.metrics.errors++;
      });

      this.client.on('disconnect', () => {
        console.log('📡 Redis Turbo Cache disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
    } catch (error) {
      console.error('❌ Failed to initialize Redis Turbo Cache:', error);
      this.isConnected = false;
    }
  }

  /**
   * Optimize Redis settings for maximum performance
   */
  async optimizeRedisSettings() {
    if (!this.isConnected) return;

    try {
      // Set optimal Redis configurations
      await this.client.configSet('timeout', '0'); // Disable client timeout
      await this.client.configSet('tcp-keepalive', '60'); // TCP keepalive
      await this.client.configSet('maxmemory-policy', 'allkeys-lru'); // LRU eviction
      
      console.log('⚡ Redis optimized for FIGHTER JET performance');
    } catch (error) {
      console.warn('⚠️ Could not optimize Redis settings:', error.message);
    }
  }

  /**
   * ULTRA-FAST GET operation
   * Target: <5ms response time
   */
  async get(key) {
    if (!this.isConnected) {
      console.warn('Redis not connected, skipping cache get');
      this.metrics.misses++;
      return null;
    }

    const startTime = process.hrtime.bigint();
    
    try {
      const cacheKey = this.generateOptimalKey(key);
      const value = await this.client.get(cacheKey);
      
      const responseTime = Number(process.hrtime.bigint() - startTime) / 1000000; // Convert to ms
      this.updateMetrics('get', responseTime);
      
      if (value === null) {
        this.metrics.misses++;
        return null;
      }

      this.metrics.hits++;
      
      // Check if value is compressed
      if (value.startsWith('COMPRESSED:')) {
        const compressedData = Buffer.from(value.slice(11), 'base64');
        const decompressed = await decompressAsync(compressedData);
        return JSON.parse(decompressed.toString());
      }
      
      return JSON.parse(value);
    } catch (error) {
      this.metrics.errors++;
      console.error('Cache get error:', error.message);
      return null;
    }
  }

  /**
   * ULTRA-FAST SET operation with intelligent compression
   * Target: <10ms response time
   */
  async set(key, value, ttl = this.config.defaultTTL) {
    if (!this.isConnected) {
      console.warn('Redis not connected, skipping cache set');
      return false;
    }

    const startTime = process.hrtime.bigint();
    
    try {
      const cacheKey = this.generateOptimalKey(key);
      let serializedValue = JSON.stringify(value);
      
      // Intelligent compression for large payloads
      if (serializedValue.length > this.config.compressionThreshold) {
        const compressed = await compressAsync(Buffer.from(serializedValue));
        const compressionRatio = compressed.length / serializedValue.length;
        
        // Only use compression if it saves significant space (>20%)
        if (compressionRatio < 0.8) {
          serializedValue = 'COMPRESSED:' + compressed.toString('base64');
          this.metrics.compressionSaved += serializedValue.length * (1 - compressionRatio);
        }
      }
      
      // Check value size limit
      if (serializedValue.length > this.config.maxValueSize) {
        console.warn(`Value too large for cache: ${Math.round(serializedValue.length / 1024 / 1024)}MB`);
        return false;
      }
      
      await this.client.setEx(cacheKey, ttl, serializedValue);
      
      const responseTime = Number(process.hrtime.bigint() - startTime) / 1000000;
      this.updateMetrics('set', responseTime);
      this.metrics.sets++;
      
      return true;
    } catch (error) {
      this.metrics.errors++;
      console.error('Cache set error:', error.message);
      return false;
    }
  }

  /**
   * BATCH GET operation for multiple keys
   * Ultra-fast retrieval of multiple values
   */
  async mget(keys) {
    if (!this.isConnected || !keys.length) {
      return keys.map(() => null);
    }

    const startTime = process.hrtime.bigint();
    
    try {
      const cacheKeys = keys.map(key => this.generateOptimalKey(key));
      const values = await this.client.mGet(cacheKeys);
      
      const responseTime = Number(process.hrtime.bigint() - startTime) / 1000000;
      this.updateMetrics('mget', responseTime);
      
      // Process results
      const results = await Promise.all(values.map(async (value, index) => {
        if (value === null) {
          this.metrics.misses++;
          return null;
        }
        
        this.metrics.hits++;
        
        // Handle compressed values
        if (value.startsWith('COMPRESSED:')) {
          const compressedData = Buffer.from(value.slice(11), 'base64');
          const decompressed = await decompressAsync(compressedData);
          return JSON.parse(decompressed.toString());
        }
        
        return JSON.parse(value);
      }));
      
      return results;
    } catch (error) {
      this.metrics.errors++;
      console.error('Cache mget error:', error.message);
      return keys.map(() => null);
    }
  }

  /**
   * BATCH SET operation for multiple key-value pairs
   */
  async mset(keyValuePairs, ttl = this.config.defaultTTL) {
    if (!this.isConnected || !keyValuePairs.length) {
      return false;
    }

    const startTime = process.hrtime.bigint();
    
    try {
      // Use pipeline for batch operations
      const pipeline = this.client.multi();
      
      for (const { key, value } of keyValuePairs) {
        const cacheKey = this.generateOptimalKey(key);
        let serializedValue = JSON.stringify(value);
        
        // Apply compression if beneficial
        if (serializedValue.length > this.config.compressionThreshold) {
          const compressed = await compressAsync(Buffer.from(serializedValue));
          if (compressed.length < serializedValue.length * 0.8) {
            serializedValue = 'COMPRESSED:' + compressed.toString('base64');
          }
        }
        
        pipeline.setEx(cacheKey, ttl, serializedValue);
      }
      
      await pipeline.exec();
      
      const responseTime = Number(process.hrtime.bigint() - startTime) / 1000000;
      this.updateMetrics('mset', responseTime);
      this.metrics.sets += keyValuePairs.length;
      
      return true;
    } catch (error) {
      this.metrics.errors++;
      console.error('Cache mset error:', error.message);
      return false;
    }
  }

  /**
   * DELETE operation
   */
  async del(key) {
    if (!this.isConnected) return false;

    const startTime = process.hrtime.bigint();
    
    try {
      const cacheKey = this.generateOptimalKey(key);
      const result = await this.client.del(cacheKey);
      
      const responseTime = Number(process.hrtime.bigint() - startTime) / 1000000;
      this.updateMetrics('del', responseTime);
      this.metrics.deletes++;
      
      return result > 0;
    } catch (error) {
      this.metrics.errors++;
      console.error('Cache del error:', error.message);
      return false;
    }
  }

  /**
   * PATTERN-BASED DELETE
   * Efficiently delete multiple keys matching a pattern
   */
  async delPattern(pattern) {
    if (!this.isConnected) return 0;

    const startTime = process.hrtime.bigint();
    
    try {
      const keys = await this.client.keys(`niledb:${pattern}`);
      if (keys.length === 0) return 0;
      
      const result = await this.client.del(keys);
      
      const responseTime = Number(process.hrtime.bigint() - startTime) / 1000000;
      this.updateMetrics('delPattern', responseTime);
      this.metrics.deletes += result;
      
      return result;
    } catch (error) {
      this.metrics.errors++;
      console.error('Cache pattern delete error:', error.message);
      return 0;
    }
  }

  /**
   * CHECK KEY EXISTENCE
   */
  async exists(key) {
    if (!this.isConnected) return false;

    try {
      const cacheKey = this.generateOptimalKey(key);
      const result = await this.client.exists(cacheKey);
      return result === 1;
    } catch (error) {
      this.metrics.errors++;
      return false;
    }
  }

  /**
   * GET TIME TO LIVE
   */
  async ttl(key) {
    if (!this.isConnected) return -2;

    try {
      const cacheKey = this.generateOptimalKey(key);
      return await this.client.ttl(cacheKey);
    } catch (error) {
      this.metrics.errors++;
      return -2;
    }
  }

  /**
   * NILEDB-SPECIFIC CACHE METHODS
   */

  // Cache dashboard metrics with smart TTL
  async cacheDashboardMetrics(timeRange, data) {
    const key = `dashboard:metrics:${timeRange}`;
    const ttl = timeRange === '5m' ? 30 : timeRange === '1h' ? 300 : 900;
    return this.set(key, data, ttl);
  }

  // Cache analytics data with compression
  async cacheAnalytics(queryType, params, data) {
    const key = `analytics:${queryType}:${this.hashObject(params)}`;
    return this.set(key, data, 900); // 15 minutes
  }

  // Cache real-time data with short TTL
  async cacheRealTimeData(dataType, data) {
    const key = `realtime:${dataType}`;
    return this.set(key, data, 30); // 30 seconds
  }

  // Invalidate related cache entries
  async invalidateNiledbCache(pattern) {
    return this.delPattern(`${pattern}*`);
  }

  /**
   * UTILITY METHODS
   */

  generateOptimalKey(key) {
    const prefixedKey = `niledb:${key}`;
    
    // Ensure key doesn't exceed Redis limit
    if (prefixedKey.length > this.config.maxKeyLength) {
      const hash = this.hashString(prefixedKey);
      return `niledb:hash:${hash}`;
    }
    
    return prefixedKey;
  }

  hashString(str) {
    return createHash('sha256').update(str).digest('hex').substring(0, 16);
  }

  hashObject(obj) {
    const sortedObj = this.sortObjectKeys(obj);
    return this.hashString(JSON.stringify(sortedObj));
  }

  sortObjectKeys(obj) {
    if (typeof obj !== 'object' || obj === null) return obj;
    if (Array.isArray(obj)) return obj.map(item => this.sortObjectKeys(item));
    
    const sortedKeys = Object.keys(obj).sort();
    const sortedObj = {};
    
    for (const key of sortedKeys) {
      sortedObj[key] = this.sortObjectKeys(obj[key]);
    }
    
    return sortedObj;
  }

  updateMetrics(operation, responseTime) {
    this.metrics.totalResponseTime += responseTime;
    this.metrics.operationCount++;
    
    if (responseTime > 50) {
      console.warn(`🐌 Slow cache ${operation}: ${responseTime.toFixed(2)}ms`);
    }
  }

  /**
   * PERFORMANCE MONITORING
   */

  getMetrics() {
    const totalOps = this.metrics.hits + this.metrics.misses;
    const hitRate = totalOps > 0 ? Math.round((this.metrics.hits / totalOps) * 100) : 0;
    const avgResponseTime = this.metrics.operationCount > 0 
      ? Math.round(this.metrics.totalResponseTime / this.metrics.operationCount * 100) / 100
      : 0;

    return {
      ...this.metrics,
      hitRate,
      avgResponseTime,
      isConnected: this.isConnected,
      performance: avgResponseTime < 5 ? 'FIGHTER_JET' : avgResponseTime < 25 ? 'FAST' : 'SLOW'
    };
  }

  resetMetrics() {
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
      errors: 0,
      compressionSaved: 0,
      totalResponseTime: 0,
      operationCount: 0
    };
  }

  startMetricsLogging() {
    // Log performance metrics every 2 minutes
    setInterval(() => {
      const metrics = this.getMetrics();
      if (metrics.operationCount > 0) {
        console.log(`🚀 Redis Turbo Cache: ${metrics.hitRate}% hit rate, ${metrics.avgResponseTime}ms avg response, ${metrics.operationCount} ops`);
      }
    }, 2 * 60 * 1000);
  }

  /**
   * CLEANUP AND MAINTENANCE
   */

  async flushDatabase() {
    if (!this.isConnected) return false;

    try {
      await this.client.flushDb();
      console.log('🧹 Redis cache flushed');
      return true;
    } catch (error) {
      console.error('Error flushing cache:', error.message);
      return false;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      try {
        await this.client.disconnect();
        console.log('🔌 Redis Turbo Cache disconnected');
      } catch (error) {
        console.error('Error disconnecting Redis:', error.message);
      }
    }
  }
}

// Export singleton instance
const redisTurboCacheService = new RedisTurboCacheService();

// Graceful shutdown
process.on('SIGINT', () => {
  redisTurboCacheService.disconnect();
});

process.on('SIGTERM', () => {
  redisTurboCacheService.disconnect();
});

export { redisTurboCacheService };
export default redisTurboCacheService;