import { createClient } from 'redis';
import { config } from 'dotenv';

// Load environment variables
config();

// Redis configuration with fallback defaults
const redisConfig = {
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    connectTimeout: 5000,
    lazyConnect: true,
  },
  password: process.env.REDIS_PASSWORD || undefined,
  database: parseInt(process.env.REDIS_DB || '0'),
  retryDelayOnFailover: 100,
  enableReadyCheck: true,
  maxRetriesPerRequest: 3,
  lazyConnect: true,
};

// Create Redis client instance
let redisClient = null;

export const createRedisClient = async () => {
  if (redisClient && redisClient.isOpen) {
    return redisClient;
  }

  try {
    redisClient = createClient(redisConfig);

    // Error handling
    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      console.log('Redis client connected');
    });

    redisClient.on('ready', () => {
      console.log('Redis client ready');
    });

    redisClient.on('end', () => {
      console.log('Redis client disconnected');
    });

    // Connect to Redis
    await redisClient.connect();
    
    return redisClient;
  } catch (error) {
    console.error('Failed to create Redis client:', error);
    // Return null client for graceful degradation
    return null;
  }
};

// Cache helper class for analytics
export class AnalyticsCache {
  constructor() {
    this.client = null;
    this.defaultTTL = parseInt(process.env.CACHE_TTL || '300'); // 5 minutes default
  }

  async init() {
    this.client = await createRedisClient();
    return this.client !== null;
  }

  async set(key, value, ttl = this.defaultTTL) {
    if (!this.client) return false;
    
    try {
      const serializedValue = JSON.stringify(value);
      await this.client.setEx(key, ttl, serializedValue);
      return true;
    } catch (error) {
      console.error('Cache set error:', error);
      return false;
    }
  }

  async get(key) {
    if (!this.client) return null;
    
    try {
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Cache get error:', error);
      return null;
    }
  }

  async del(key) {
    if (!this.client) return false;
    
    try {
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error('Cache delete error:', error);
      return false;
    }
  }

  async exists(key) {
    if (!this.client) return false;
    
    try {
      const result = await this.client.exists(key);
      return result === 1;
    } catch (error) {
      console.error('Cache exists error:', error);
      return false;
    }
  }

  async flush() {
    if (!this.client) return false;
    
    try {
      await this.client.flushDb();
      return true;
    } catch (error) {
      console.error('Cache flush error:', error);
      return false;
    }
  }

  async invalidatePattern(pattern) {
    if (!this.client) return false;
    
    try {
      const keys = await this.client.keys(pattern);
      if (keys.length > 0) {
        await this.client.del(keys);
      }
      return true;
    } catch (error) {
      console.error('Cache pattern invalidation error:', error);
      return false;
    }
  }

  // Generate cache key for analytics queries
  generateKey(prefix, params) {
    const sortedParams = Object.keys(params)
      .sort()
      .reduce((sorted, key) => {
        sorted[key] = params[key];
        return sorted;
      }, {});
    
    const paramString = JSON.stringify(sortedParams);
    return `analytics:${prefix}:${Buffer.from(paramString).toString('base64')}`;
  }

  // Analytics-specific cache methods
  async getCachedAnalytics(queryType, params) {
    const key = this.generateKey(queryType, params);
    return await this.get(key);
  }

  async setCachedAnalytics(queryType, params, data, ttl = this.defaultTTL) {
    const key = this.generateKey(queryType, params);
    return await this.set(key, data, ttl);
  }

  async invalidateAnalyticsCache(queryType) {
    return await this.invalidatePattern(`analytics:${queryType}:*`);
  }
}

// Export singleton instance
export const analyticsCache = new AnalyticsCache();

// Graceful shutdown handler
export async function closeRedisConnection() {
  if (redisClient && redisClient.isOpen) {
    try {
      await redisClient.disconnect();
      console.log('Redis connection closed');
    } catch (error) {
      console.error('Error closing Redis connection:', error);
    }
  }
}

// Handle process termination
process.on('SIGINT', async () => {
  await closeRedisConnection();
});

process.on('SIGTERM', async () => {
  await closeRedisConnection();
});

export default { createRedisClient, AnalyticsCache, analyticsCache };