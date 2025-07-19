import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

class CacheService {
  constructor() {
    this.client = null;
    this.isConnected = false;
    this.defaultTTL = 3600; // 1 hour default TTL
    this.memoryCache = new Map();
    this.memoryCacheSize = 100; // Keep 100 items in memory
    this.memoryCacheTTL = 300; // 5 minutes in memory
  }

  async connect() {
    try {
      this.client = createClient({
        url: process.env.REDIS_URL || 'redis://localhost:6379',
        retry_delay_on_failover: 100,
        retry_delay_on_cluster_down: 300,
        max_attempts: 3
      });

      this.client.on('error', (err) => {
        console.error('Redis Client Error:', err);
        this.isConnected = false;
      });

      this.client.on('connect', () => {
        console.log('Redis Client Connected');
        this.isConnected = true;
      });

      this.client.on('disconnect', () => {
        console.log('Redis Client Disconnected');
        this.isConnected = false;
      });

      await this.client.connect();
      return true;
    } catch (error) {
      console.error('Failed to connect to Redis:', error);
      this.isConnected = false;
      return false;
    }
  }

  async disconnect() {
    if (this.client && this.isConnected) {
      await this.client.disconnect();
      this.isConnected = false;
    }
  }

  async get(key) {
    if (!this.isConnected) {
      console.warn('Redis not connected, skipping cache get');
      return null;
    }

    try {
      const value = await this.client.get(key);
      if (value) {
        return JSON.parse(value);
      }
      return null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async set(key, value, ttl = this.defaultTTL) {
    if (!this.isConnected) {
      console.warn('Redis not connected, skipping cache set');
      return false;
    }

    try {
      const serialized = JSON.stringify(value);
      await this.client.setEx(key, ttl, serialized);
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  async del(key) {
    if (!this.isConnected) {
      console.warn('Redis not connected, skipping cache delete');
      return false;
    }

    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  async exists(key) {
    if (!this.isConnected) {
      return false;
    }

    try {
      return await this.client.exists(key);
    } catch (error) {
      console.error('Cache exists error:', error);
      return false;
    }
  }

  async flushAll() {
    if (!this.isConnected) {
      console.warn('Redis not connected, skipping cache flush');
      return false;
    }

    try {
      await this.client.flushAll();
      return true;
    } catch (error) {
      console.error('Cache flush error:', error);
      return false;
    }
  }

  // Generate cache keys for different data types
  generateKey(type, ...identifiers) {
    return `nxt:${type}:${identifiers.join(':')}`;
  }

  // Enhanced caching with compression for large datasets
  async setLarge(key, value, ttl = this.defaultTTL) {
    if (!this.isConnected) {
      console.warn('Redis not connected, skipping cache set');
      return false;
    }

    try {
      const serialized = JSON.stringify(value);
      
      // Compress large data (>10KB)
      if (serialized.length > 10240) {
        const compressed = await this.compress(serialized);
        await this.client.setEx(`${key}:compressed`, ttl, compressed);
        await this.client.setEx(`${key}:meta`, ttl, JSON.stringify({ compressed: true, size: serialized.length }));
      } else {
        await this.client.setEx(key, ttl, serialized);
      }
      return true;
    } catch (error) {
      console.error('Cache setLarge error:', error);
      return false;
    }
  }

  async getLarge(key) {
    if (!this.isConnected) {
      return null;
    }

    try {
      // Check if data is compressed
      const meta = await this.client.get(`${key}:meta`);
      if (meta) {
        const metaData = JSON.parse(meta);
        if (metaData.compressed) {
          const compressed = await this.client.get(`${key}:compressed`);
          if (compressed) {
            const decompressed = await this.decompress(compressed);
            return JSON.parse(decompressed);
          }
        }
      }
      
      // Fallback to regular get
      return await this.get(key);
    } catch (error) {
      console.error('Cache getLarge error:', error);
      return null;
    }
  }

  async compress(data) {
    const zlib = await import('zlib');
    return new Promise((resolve, reject) => {
      zlib.gzip(data, (err, result) => {
        if (err) reject(err);
        else resolve(result.toString('base64'));
      });
    });
  }

  async decompress(data) {
    const zlib = await import('zlib');
    return new Promise((resolve, reject) => {
      const buffer = Buffer.from(data, 'base64');
      zlib.gunzip(buffer, (err, result) => {
        if (err) reject(err);
        else resolve(result.toString());
      });
    });
  }

  // Multi-tier caching: memory + Redis

  async getMultiTier(key) {
    // Check memory cache first
    const memoryKey = `mem:${key}`;
    const memoryItem = this.memoryCache.get(memoryKey);
    if (memoryItem && memoryItem.expires > Date.now()) {
      return memoryItem.data;
    }

    // Check Redis cache
    const redisData = await this.getLarge(key);
    if (redisData) {
      // Store in memory cache for faster access
      this.setMemoryCache(memoryKey, redisData);
      return redisData;
    }

    return null;
  }

  async setMultiTier(key, value, ttl = this.defaultTTL) {
    // Store in Redis
    await this.setLarge(key, value, ttl);
    
    // Store in memory cache with shorter TTL
    const memoryKey = `mem:${key}`;
    this.setMemoryCache(memoryKey, value);
    
    return true;
  }

  setMemoryCache(key, data) {
    // Implement LRU eviction
    if (this.memoryCache.size >= this.memoryCacheSize) {
      const firstKey = this.memoryCache.keys().next().value;
      this.memoryCache.delete(firstKey);
    }
    
    this.memoryCache.set(key, {
      data,
      expires: Date.now() + (this.memoryCacheTTL * 1000)
    });
  }

  // Cache analytics data with enhanced strategy
  async cacheAnalytics(key, data) {
    const fullKey = this.generateKey('analytics', key);
    return await this.setMultiTier(fullKey, data, 900); // 15 minutes
  }

  async getAnalytics(key) {
    const fullKey = this.generateKey('analytics', key);
    return await this.getMultiTier(fullKey);
  }

  // Cache inventory metrics with optimized TTL based on data type
  async cacheInventoryMetrics(warehouseId, data, dataType = 'summary') {
    const key = warehouseId ? `inventory:${warehouseId}` : 'inventory:all';
    const fullKey = this.generateKey('metrics', key, dataType);
    
    // Different TTLs based on data criticality
    const ttls = {
      summary: 300,    // 5 minutes - critical data
      analytics: 900,  // 15 minutes - analytical data
      reports: 1800,   // 30 minutes - report data
      trends: 3600     // 1 hour - trend data
    };
    
    const ttl = ttls[dataType] || 300;
    return await this.setMultiTier(fullKey, data, ttl);
  }

  async getInventoryMetrics(warehouseId, dataType = 'summary') {
    const key = warehouseId ? `inventory:${warehouseId}` : 'inventory:all';
    const fullKey = this.generateKey('metrics', key, dataType);
    return await this.getMultiTier(fullKey);
  }

  // Cache supplier metrics with 30-minute TTL
  async cacheSupplierMetrics(supplierId, data) {
    const key = supplierId ? `supplier:${supplierId}` : 'suppliers:all';
    return await this.set(this.generateKey('metrics', key), data, 1800); // 30 minutes
  }

  async getSupplierMetrics(supplierId) {
    const key = supplierId ? `supplier:${supplierId}` : 'suppliers:all';
    return await this.get(this.generateKey('metrics', key));
  }

  // Cache customer analytics with 20-minute TTL
  async cacheCustomerAnalytics(customerId, data) {
    const key = customerId ? `customer:${customerId}` : 'customers:all';
    return await this.set(this.generateKey('analytics', key), data, 1200); // 20 minutes
  }

  async getCustomerAnalytics(customerId) {
    const key = customerId ? `customer:${customerId}` : 'customers:all';
    return await this.get(this.generateKey('analytics', key));
  }

  // Invalidate related caches
  async invalidatePattern(pattern) {
    if (!this.isConnected) {
      return false;
    }

    try {
      const keys = await this.client.keys(`nxt:${pattern}`);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    } catch (error) {
      console.error('Cache invalidate pattern error:', error);
      return false;
    }
  }
}

// Singleton instance
const cacheService = new CacheService();

export default cacheService;