/**
 * OPTIMIZED DATABASE CONFIGURATION
 * High-performance connection pooling with intelligent caching
 */

import { createPool } from 'mysql2/promise';
import { createClient } from 'redis';
import { QueryCache } from '../middleware/performance.middleware.js';

/**
 * OPTIMIZED MYSQL CONNECTION POOL
 */
class OptimizedDatabase {
  constructor() {
    this.pool = null;
    this.redisClient = null;
    this.connectionCount = 0;
    this.queryStats = {
      total: 0,
      cached: 0,
      slow: 0,
      errors: 0
    };
  }

  /**
   * Initialize optimized database connections
   */
  async initialize() {
    try {
      console.log('🔌 Initializing optimized database connections...');
      
      // Create MySQL connection pool with optimization
      this.pool = createPool({
        host: process.env.DB_HOST || 'localhost',
        port: process.env.DB_PORT || 3306,
        user: process.env.DB_USER || 'root',
        password: process.env.DB_PASSWORD || '',
        database: process.env.DB_NAME || 'horizon',
        
        // Performance optimizations
        connectionLimit: 50,           // Max connections
        acquireTimeout: 60000,         // Connection acquire timeout
        timeout: 60000,                // Query timeout
        keepAliveInitialDelay: 0,      // Keep-alive delay
        enableKeepAlive: true,         // Enable keep-alive
        
        // Connection management
        idleTimeout: 900000,           // 15 minutes idle timeout
        maxIdle: 10,                   // Max idle connections
        idleTimeout: 900000,           // Idle connection timeout
        acquireTimeout: 60000,         // Connection acquire timeout
        
        // Query optimizations
        typeCast: true,                // Enable type casting
        supportBigNumbers: true,       // Support big numbers
        bigNumberStrings: false,       // Don't return big numbers as strings
        dateStrings: false,            // Return dates as Date objects
        
        // SSL and security
        ssl: process.env.DB_SSL === 'true' ? {
          rejectUnauthorized: false
        } : false,
        
        // Compression
        compress: true,
        
        // Performance flags
        flags: [
          'FOUND_ROWS',
          'IGNORE_SPACE',
          'INTERACTIVE',
          'LOCAL_FILES',
          'LONG_FLAG',
          'LONG_PASSWORD',
          'MULTI_RESULTS',
          'MULTI_STATEMENTS',
          'NO_SCHEMA',
          'ODBC',
          'PROTOCOL_41',
          'PS_MULTI_RESULTS',
          'RESERVED',
          'SECURE_CONNECTION',
          'TRANSACTIONS'
        ].join(' ')
      });

      // Test the connection
      const connection = await this.pool.getConnection();
      await connection.execute('SELECT 1 as test');
      connection.release();
      
      console.log('✅ MySQL connection pool initialized with optimizations');

      // Initialize Redis for query caching
      await this.initializeRedis();
      
      // Setup monitoring
      this.setupMonitoring();
      
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize Redis for advanced caching
   */
  async initializeRedis() {
    try {
      this.redisClient = createClient({
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
        password: process.env.REDIS_PASSWORD,
        db: 1, // Use database 1 for query cache
        retry_strategy: (options) => {
          if (options.error && options.error.code === 'ECONNREFUSED') {
            console.error('Redis server refused connection');
            return new Error('Redis server refused connection');
          }
          if (options.total_retry_time > 1000 * 60 * 60) {
            return new Error('Redis retry time exhausted');
          }
          if (options.attempt > 10) {
            return undefined;
          }
          return Math.min(options.attempt * 100, 3000);
        }
      });

      this.redisClient.on('error', (err) => {
        console.error('Redis error:', err);
      });

      this.redisClient.on('connect', () => {
        console.log('✅ Redis query cache connected');
      });

      await this.redisClient.connect();
    } catch (error) {
      console.warn('⚠️ Redis cache unavailable, using memory cache only');
      this.redisClient = null;
    }
  }

  /**
   * Execute optimized query with intelligent caching
   */
  async query(sql, params = [], options = {}) {
    const startTime = Date.now();
    const {
      cache = true,           // Enable caching
      cacheTtl = 300,        // Cache TTL in seconds
      timeout = 30000,       // Query timeout
      skipCache = false      // Skip cache for this query
    } = options;

    try {
      this.queryStats.total++;

      // Generate cache key
      const cacheKey = QueryCache.generateKey(sql, params);
      
      // Try cache first (if enabled and not a write operation)
      if (cache && !skipCache && this.isReadQuery(sql)) {
        let cachedResult = await QueryCache.get(cacheKey);
        
        // Try Redis cache if memory cache missed
        if (!cachedResult && this.redisClient) {
          try {
            const redisResult = await this.redisClient.get(`query:${cacheKey}`);
            if (redisResult) {
              cachedResult = JSON.parse(redisResult);
              // Store in memory cache for faster access
              QueryCache.set(cacheKey, cachedResult);
            }
          } catch (error) {
            console.error('Redis cache read error:', error);
          }
        }
        
        if (cachedResult) {
          this.queryStats.cached++;
          console.log(`💾 Cache hit for query: ${sql.substring(0, 50)}... (${Date.now() - startTime}ms)`);
          return cachedResult;
        }
      }

      // Execute query with timeout
      const queryPromise = this.pool.execute(sql, params);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Query timeout')), timeout);
      });

      const [rows, fields] = await Promise.race([queryPromise, timeoutPromise]);
      const result = { rows, fields };

      // Cache the result if it's a read query
      if (cache && this.isReadQuery(sql)) {
        QueryCache.set(cacheKey, result);
        
        // Also cache in Redis
        if (this.redisClient) {
          try {
            await this.redisClient.setEx(`query:${cacheKey}`, cacheTtl, JSON.stringify(result));
          } catch (error) {
            console.error('Redis cache write error:', error);
          }
        }
      }

      const queryTime = Date.now() - startTime;
      
      // Log slow queries
      if (queryTime > 1000) {
        this.queryStats.slow++;
        console.warn(`🐌 Slow query detected: ${sql.substring(0, 100)}... (${queryTime}ms)`);
      }

      return result;
      
    } catch (error) {
      this.queryStats.errors++;
      console.error('Database query error:', {
        sql: sql.substring(0, 100),
        params,
        error: error.message,
        time: Date.now() - startTime
      });
      throw error;
    }
  }

  /**
   * Batch execute multiple queries with transaction support
   */
  async batchQuery(queries, useTransaction = true) {
    const connection = await this.pool.getConnection();
    
    try {
      if (useTransaction) {
        await connection.beginTransaction();
      }
      
      const results = [];
      for (const { sql, params } of queries) {
        const [rows, fields] = await connection.execute(sql, params || []);
        results.push({ rows, fields });
      }
      
      if (useTransaction) {
        await connection.commit();
      }
      
      return results;
      
    } catch (error) {
      if (useTransaction) {
        await connection.rollback();
      }
      throw error;
    } finally {
      connection.release();
    }
  }

  /**
   * Get prepared statement (cached)
   */
  async getPreparedStatement(sql) {
    const cacheKey = `prepared:${QueryCache.generateKey(sql)}`;
    
    let stmt = QueryCache.get(cacheKey);
    if (!stmt) {
      const connection = await this.pool.getConnection();
      stmt = await connection.prepare(sql);
      QueryCache.set(cacheKey, stmt);
      connection.release();
    }
    
    return stmt;
  }

  /**
   * Check if query is a read operation
   */
  isReadQuery(sql) {
    const readOperations = ['SELECT', 'SHOW', 'DESCRIBE', 'EXPLAIN'];
    const trimmedSql = sql.trim().toUpperCase();
    return readOperations.some(op => trimmedSql.startsWith(op));
  }

  /**
   * Setup database monitoring
   */
  setupMonitoring() {
    setInterval(() => {
      const stats = this.getStats();
      console.log('📊 Database Stats:', {
        ...stats,
        cacheHitRatio: ((stats.cached / stats.total) * 100).toFixed(2) + '%'
      });
    }, 300000); // Every 5 minutes
  }

  /**
   * Get database statistics
   */
  getStats() {
    return {
      ...this.queryStats,
      poolConnections: this.pool ? this.pool._allConnections.length : 0,
      poolFree: this.pool ? this.pool._freeConnections.length : 0,
      cacheSize: QueryCache.cache.size,
      uptime: process.uptime()
    };
  }

  /**
   * Clear all caches
   */
  async clearCache() {
    QueryCache.clear();
    
    if (this.redisClient) {
      try {
        await this.redisClient.flushDb();
        console.log('✅ Database cache cleared');
      } catch (error) {
        console.error('Redis cache clear error:', error);
      }
    }
  }

  /**
   * Graceful shutdown
   */
  async close() {
    try {
      console.log('🔌 Closing database connections...');
      
      if (this.pool) {
        await this.pool.end();
        console.log('✅ MySQL pool closed');
      }
      
      if (this.redisClient) {
        await this.redisClient.quit();
        console.log('✅ Redis cache connection closed');
      }
      
    } catch (error) {
      console.error('Database close error:', error);
      throw error;
    }
  }
}

// Create singleton instance
const optimizedDb = new OptimizedDatabase();

export default optimizedDb;

// Export convenience methods
export const query = (sql, params, options) => optimizedDb.query(sql, params, options);
export const batchQuery = (queries, useTransaction) => optimizedDb.batchQuery(queries, useTransaction);
export const clearCache = () => optimizedDb.clearCache();
export const getStats = () => optimizedDb.getStats();