import { db } from '../config/database.js';
import { sql } from 'drizzle-orm';
import cacheService from './cache.service.js';

/**
 * Query Optimization Service
 * Prevents runaway queries and optimizes database performance
 */

class QueryOptimizationService {
  constructor() {
    this.queryCache = new Map();
    this.queryStats = new Map();
    this.maxCacheSize = 1000;
    this.queryTimeoutMs = 30000; // 30 seconds
  }

  /**
   * Initialize query optimization service
   */
  async initialize() {
    try {
      console.log('Initializing query optimization service...');
      
      // Create performance indexes for critical queries
      await this.createPerformanceIndexes();
      
      // Set up query monitoring
      this.setupQueryMonitoring();
      
      console.log('Query optimization service initialized');
      return true;
    } catch (error) {
      console.error('Failed to initialize query optimization service:', error);
      return false;
    }
  }

  /**
   * Create critical performance indexes
   */
  async createPerformanceIndexes() {
    const indexes = [
      {
        name: 'idx_inventory_reorder_optimization',
        sql: `
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_reorder_optimization 
          ON inventory (quantity_on_hand, reorder_point, updated_at) 
          WHERE reorder_point IS NOT NULL AND reorder_point > 0
        `
      },
      {
        name: 'idx_products_active_optimization',
        sql: `
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_products_active_optimization 
          ON products (id, is_active) 
          WHERE is_active = true
        `
      },
      {
        name: 'idx_inventory_product_join_optimization',
        sql: `
          CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_inventory_product_join_optimization 
          ON inventory (product_id, quantity_on_hand, reorder_point)
        `
      }
    ];

    for (const index of indexes) {
      try {
        await db.execute(sql.raw(index.sql));
        console.log(`Created performance index: ${index.name}`);
      } catch (error) {
        if (!error.message.includes('already exists')) {
          console.error(`Failed to create index ${index.name}:`, error.message);
        }
      }
    }
  }

  /**
   * Set up query monitoring to prevent runaway queries
   */
  setupQueryMonitoring() {
    // Monitor and log slow queries
    setInterval(async () => {
      try {
        await this.analyzeSlowQueries();
        await this.cleanupQueryCache();
      } catch (error) {
        console.error('Query monitoring error:', error);
      }
    }, 300000); // Every 5 minutes
  }

  /**
   * Analyze and log slow queries
   */
  async analyzeSlowQueries() {
    try {
      const slowQueries = await db.execute(sql`
        SELECT 
          query,
          calls,
          total_exec_time,
          mean_exec_time,
          max_exec_time
        FROM pg_stat_statements 
        WHERE calls > 10 
          AND mean_exec_time > 1000
        ORDER BY total_exec_time DESC 
        LIMIT 10
      `);

      if (slowQueries && slowQueries.length > 0) {
        console.warn('SLOW QUERY ALERT: Found slow executing queries');
        slowQueries.forEach((query, index) => {
          console.warn(`${index + 1}. Calls: ${query.calls}, Avg: ${Math.round(query.mean_exec_time)}ms, Max: ${Math.round(query.max_exec_time)}ms`);
          console.warn(`   Query: ${query.query.substring(0, 100)}...`);
        });
      }
    } catch (error) {
      // pg_stat_statements might not be available
      console.log('Query analysis not available (pg_stat_statements extension needed)');
    }
  }

  /**
   * Clean up query cache to prevent memory leaks
   */
  cleanupQueryCache() {
    if (this.queryCache.size > this.maxCacheSize) {
      const entriesToDelete = this.queryCache.size - this.maxCacheSize;
      const keys = Array.from(this.queryCache.keys()).slice(0, entriesToDelete);
      
      keys.forEach(key => {
        this.queryCache.delete(key);
      });
      
      console.log(`Cleaned up ${entriesToDelete} old query cache entries`);
    }
  }

  /**
   * Optimized inventory reorder query with caching and limits
   */
  async getOptimizedLowStockItems(options = {}) {
    const {
      limit = 20,
      maxAge = 300000, // 5 minutes cache
      warehouseId = null,
      includeInactive = false
    } = options;

    const cacheKey = `low_stock_items:${limit}:${warehouseId}:${includeInactive}`;
    
    try {
      // Check cache first
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return { success: true, data: cached, source: 'cache' };
      }

      // Optimized query with proper joins and limits
      const query = sql`
        SELECT 
          i.id as inventory_id,
          i.product_id,
          p.sku,
          p.name,
          i.warehouse_id,
          i.quantity_on_hand,
          i.reorder_point,
          i.updated_at
        FROM inventory i
        INNER JOIN products p ON i.product_id = p.id
        WHERE i.quantity_on_hand <= COALESCE(i.reorder_point, 0)
          AND i.reorder_point IS NOT NULL
          AND i.reorder_point > 0
          ${includeInactive ? sql`` : sql`AND p.is_active = true`}
          ${warehouseId ? sql`AND i.warehouse_id = ${warehouseId}` : sql``}
          AND i.updated_at >= NOW() - INTERVAL '24 hours'
        ORDER BY (i.reorder_point - i.quantity_on_hand) DESC, i.updated_at DESC
        LIMIT ${limit}
      `;

      const startTime = Date.now();
      const result = await db.execute(query);
      const queryTime = Date.now() - startTime;

      // Log slow query warning
      if (queryTime > 5000) {
        console.warn(`SLOW QUERY WARNING: Low stock query took ${queryTime}ms`);
      }

      // Cache the result
      if (result && result.length > 0) {
        await cacheService.set(cacheKey, result, maxAge / 1000);
      }

      return {
        success: true,
        data: result || [],
        source: 'database',
        queryTime,
        count: result ? result.length : 0
      };

    } catch (error) {
      console.error('Error in optimized low stock query:', error);
      return {
        success: false,
        error: error.message,
        data: []
      };
    }
  }

  /**
   * Get query optimization statistics
   */
  getOptimizationStats() {
    return {
      cacheSize: this.queryCache.size,
      queryStats: Array.from(this.queryStats.entries()).slice(0, 10),
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Reset optimization caches and stats
   */
  resetOptimization() {
    this.queryCache.clear();
    this.queryStats.clear();
    console.log('Query optimization caches reset');
  }
}

// Create singleton instance
const queryOptimizationService = new QueryOptimizationService();

export default queryOptimizationService;