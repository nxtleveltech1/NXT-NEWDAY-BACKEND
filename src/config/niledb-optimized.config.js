import { Pool } from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { createClient } from 'redis';

/**
 * NILEDB FIGHTER JET OPTIMIZATION CONFIGURATION
 * Performance targets: <50ms query response, optimized connection pooling
 */

const NILEDB_CONNECTION_STRING = 'postgres://01985dad-5492-710e-a575-76c9bc6f3c98:216d1021-70e6-420a-b7c7-c9b8ff3646fc@eu-central-1.db.thenile.dev/NILEDB';

// FIGHTER JET CONNECTION POOL - Optimized for maximum performance
const optimizedNilePool = new Pool({
  connectionString: NILEDB_CONNECTION_STRING,
  max: 20, // Increased from 10 to 20 for higher concurrency
  min: 5,  // Keep minimum connections warm
  idleTimeoutMillis: 10000, // Reduced from 30000 for faster recycling
  connectionTimeoutMillis: 2000, // Reduced from 5000 for faster failures
  acquireTimeoutMillis: 3000, // Max time to wait for connection
  keepAlive: true,
  keepAliveInitialDelayMillis: 10000,
  ssl: {
    rejectUnauthorized: false
  },
  // Advanced pool configuration for fighter jet performance
  allowExitOnIdle: false,
  maxUses: 7500, // Reuse connections efficiently
  application_name: 'nxt-fighter-jet-app',
  statement_timeout: 30000, // 30s max per query
  query_timeout: 25000, // 25s max per query (slightly less than statement)
  idle_in_transaction_session_timeout: 60000, // Clean up idle transactions
});

// Redis cache for ultra-fast NILEDB responses
const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379',
  socket: {
    connectTimeout: 2000,
    lazyConnect: true,
  },
  // Redis performance optimizations
  retry_delay_on_failover: 100,
  retry_delay_on_cluster_down: 300,
  max_attempts: 3,
  enable_offline_queue: false, // Fail fast instead of queueing
});

// Initialize Redis with error handling
let redisReady = false;
redisClient.on('connect', () => {
  console.log('🚀 Redis connected for NILEDB caching');
  redisReady = true;
});
redisClient.on('error', (err) => {
  console.error('❌ Redis error:', err);
  redisReady = false;
});

// Connect Redis
redisClient.connect().catch(console.error);

// Drizzle ORM with performance optimizations
export const optimizedNileDb = drizzle(optimizedNilePool, {
  logger: false, // Disable logging in production for performance
});

// Performance monitoring
let queryMetrics = {
  totalQueries: 0,
  totalTime: 0,
  slowQueries: 0,
  cacheHits: 0,
  cacheMisses: 0,
  errors: 0
};

/**
 * FIGHTER JET QUERY EXECUTOR
 * Ultra-fast query execution with intelligent caching
 */
export async function executeOptimizedQuery(queryFn, cacheKey = null, ttl = 300) {
  const startTime = Date.now();
  
  try {
    // Try cache first for read operations
    if (cacheKey && redisReady) {
      try {
        const cached = await redisClient.get(cacheKey);
        if (cached) {
          queryMetrics.cacheHits++;
          queryMetrics.totalQueries++;
          console.log(`⚡ Cache HIT: ${cacheKey} (${Date.now() - startTime}ms)`);
          return JSON.parse(cached);
        }
        queryMetrics.cacheMisses++;
      } catch (cacheError) {
        console.warn('Cache read error:', cacheError);
      }
    }
    
    // Execute query with performance monitoring
    const result = await queryFn();
    const executionTime = Date.now() - startTime;
    
    // Update metrics
    queryMetrics.totalQueries++;
    queryMetrics.totalTime += executionTime;
    
    if (executionTime > 1000) {
      queryMetrics.slowQueries++;
      console.warn(`🐌 Slow NILEDB query: ${executionTime}ms`);
    } else if (executionTime < 50) {
      console.log(`🚀 FIGHTER JET query: ${executionTime}ms`);
    }
    
    // Cache successful results
    if (cacheKey && redisReady && result) {
      try {
        await redisClient.setEx(cacheKey, ttl, JSON.stringify(result));
      } catch (cacheError) {
        console.warn('Cache write error:', cacheError);
      }
    }
    
    return result;
  } catch (error) {
    queryMetrics.errors++;
    const executionTime = Date.now() - startTime;
    console.error(`❌ NILEDB query failed after ${executionTime}ms:`, error.message);
    throw error;
  }
}

/**
 * ULTRA-FAST DASHBOARD METRICS
 * Optimized for <25ms response times
 */
export async function getFastDashboardMetrics(timeRange = '1h') {
  const cacheKey = `dashboard:metrics:${timeRange}`;
  
  return executeOptimizedQuery(async () => {
    const client = await optimizedNilePool.connect();
    try {
      // Ultra-optimized query with prepared statement
      const result = await client.query(`
        WITH time_bounds AS (
          SELECT 
            NOW() - INTERVAL $1 as start_time,
            NOW() as end_time
        ),
        quick_metrics AS (
          SELECT 
            COUNT(*) as total_events,
            AVG(CASE WHEN metric_name = 'api_response_time' THEN metric_value END) as avg_response_time,
            COUNT(CASE WHEN metric_name = 'api_error' THEN 1 END) as error_count,
            MAX(timestamp) as last_update
          FROM dashboard_metrics, time_bounds
          WHERE timestamp >= start_time
        )
        SELECT * FROM quick_metrics;
      `, [timeRange]);
      
      return result.rows[0];
    } finally {
      client.release();
    }
  }, cacheKey, 60); // 1 minute cache
}

/**
 * LIGHTNING-FAST REAL-TIME DATA
 * Sub-25ms response for live dashboard updates
 */
export async function getFastRealTimeData(dataType, limit = 50) {
  const cacheKey = `realtime:${dataType}:${limit}`;
  
  return executeOptimizedQuery(async () => {
    const client = await optimizedNilePool.connect();
    try {
      // Optimized query with index hints
      const result = await client.query(`
        SELECT data_payload, timestamp
        FROM real_time_data 
        WHERE data_type = $1 
          AND expires_at > NOW()
        ORDER BY timestamp DESC 
        LIMIT $2
      `, [dataType, limit]);
      
      return result.rows;
    } finally {
      client.release();
    }
  }, cacheKey, 30); // 30 second cache for real-time data
}

/**
 * HYPER-OPTIMIZED ANALYTICS QUERIES
 * Target: <100ms for complex analytics
 */
export async function getOptimizedAnalytics(query, params = [], cacheMinutes = 15) {
  const cacheKey = `analytics:${Buffer.from(query + JSON.stringify(params)).toString('base64').slice(0, 50)}`;
  
  return executeOptimizedQuery(async () => {
    const client = await optimizedNilePool.connect();
    try {
      // Use prepared statements for better performance
      const result = await client.query(query, params);
      return result.rows;
    } finally {
      client.release();
    }
  }, cacheKey, cacheMinutes * 60);
}

/**
 * BULK OPERATIONS FOR MAXIMUM THROUGHPUT
 */
export async function bulkInsertOptimized(tableName, data, batchSize = 1000) {
  if (!data || data.length === 0) return { inserted: 0 };
  
  const client = await optimizedNilePool.connect();
  const startTime = Date.now();
  let totalInserted = 0;
  
  try {
    await client.query('BEGIN');
    
    // Process in batches for optimal memory usage
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      // Generate optimized INSERT statement
      const columns = Object.keys(batch[0]);
      const values = batch.map((row, idx) => 
        `(${columns.map((_, colIdx) => `$${idx * columns.length + colIdx + 1}`).join(', ')})`
      ).join(', ');
      
      const flatValues = batch.flatMap(row => columns.map(col => row[col]));
      
      const query = `
        INSERT INTO ${tableName} (${columns.join(', ')}) 
        VALUES ${values}
        ON CONFLICT DO NOTHING
      `;
      
      const result = await client.query(query, flatValues);
      totalInserted += result.rowCount || 0;
    }
    
    await client.query('COMMIT');
    
    const executionTime = Date.now() - startTime;
    console.log(`🚀 Bulk insert: ${totalInserted} rows in ${executionTime}ms (${Math.round(totalInserted/executionTime*1000)} rows/sec)`);
    
    return { inserted: totalInserted, time: executionTime };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * CONNECTION HEALTH MONITORING
 */
export async function getConnectionHealth() {
  return {
    pool: {
      totalCount: optimizedNilePool.totalCount,
      idleCount: optimizedNilePool.idleCount,
      waitingCount: optimizedNilePool.waitingCount,
      maxConnections: 20,
      utilizationPercent: Math.round((optimizedNilePool.totalCount / 20) * 100)
    },
    cache: {
      ready: redisReady,
      hits: queryMetrics.cacheHits,
      misses: queryMetrics.cacheMisses,
      hitRate: queryMetrics.cacheHits > 0 
        ? Math.round((queryMetrics.cacheHits / (queryMetrics.cacheHits + queryMetrics.cacheMisses)) * 100)
        : 0
    },
    performance: {
      totalQueries: queryMetrics.totalQueries,
      averageTime: queryMetrics.totalQueries > 0 
        ? Math.round(queryMetrics.totalTime / queryMetrics.totalQueries)
        : 0,
      slowQueries: queryMetrics.slowQueries,
      errorRate: queryMetrics.totalQueries > 0
        ? Math.round((queryMetrics.errors / queryMetrics.totalQueries) * 100)
        : 0
    }
  };
}

/**
 * PERFORMANCE OPTIMIZATION UTILITIES
 */
export async function optimizeDatabase() {
  const client = await optimizedNilePool.connect();
  
  try {
    console.log('🚀 Running NILEDB performance optimizations...');
    
    // Update table statistics for better query planning
    await client.query('ANALYZE dashboard_metrics');
    await client.query('ANALYZE dashboard_events');
    await client.query('ANALYZE real_time_data');
    
    // Create performance indexes if they don't exist
    const indexes = [
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dashboard_metrics_name_time_opt ON dashboard_metrics (metric_name, timestamp DESC) WHERE timestamp > NOW() - INTERVAL \'7 days\'',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dashboard_events_type_time_opt ON dashboard_events (event_type, timestamp DESC) WHERE timestamp > NOW() - INTERVAL \'7 days\'',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_real_time_data_type_time_opt ON real_time_data (data_type, timestamp DESC) WHERE expires_at > NOW()',
      'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_dashboard_metrics_value ON dashboard_metrics (metric_value) WHERE metric_value > 0'
    ];
    
    for (const indexQuery of indexes) {
      try {
        await client.query(indexQuery);
        console.log('✅ Index created/verified');
      } catch (error) {
        if (!error.message.includes('already exists')) {
          console.warn('Index creation warning:', error.message);
        }
      }
    }
    
    // Set optimal database parameters
    await client.query("SET work_mem = '256MB'");
    await client.query("SET shared_preload_libraries = 'pg_stat_statements'");
    await client.query("SET track_activity_query_size = 2048");
    
    console.log('🚀 NILEDB optimization complete!');
    
    return { success: true, message: 'Database optimized for fighter jet performance' };
  } catch (error) {
    console.error('❌ Database optimization failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

/**
 * CLEANUP AND MAINTENANCE
 */
export async function performMaintenance() {
  const client = await optimizedNilePool.connect();
  
  try {
    // Clean up expired real-time data
    const cleanupResult = await client.query(`
      DELETE FROM real_time_data 
      WHERE expires_at <= NOW() - INTERVAL '1 hour'
    `);
    
    // Vacuum and analyze for optimal performance
    await client.query('VACUUM ANALYZE dashboard_metrics');
    await client.query('VACUUM ANALYZE real_time_data');
    
    console.log(`🧹 Maintenance complete: ${cleanupResult.rowCount || 0} expired records cleaned`);
    
    return { 
      success: true, 
      cleanedRecords: cleanupResult.rowCount || 0,
      timestamp: new Date()
    };
  } finally {
    client.release();
  }
}

// Auto-maintenance every hour
setInterval(performMaintenance, 3600000);

// Export optimized components
export { 
  optimizedNilePool, 
  redisClient, 
  queryMetrics 
};

export default {
  executeOptimizedQuery,
  getFastDashboardMetrics,
  getFastRealTimeData,
  getOptimizedAnalytics,
  bulkInsertOptimized,
  getConnectionHealth,
  optimizeDatabase,
  performMaintenance
};