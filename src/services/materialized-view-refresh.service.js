import cron from 'node-cron';
import { db } from '../config/database.js';
import { sql } from 'drizzle-orm';
import cacheService from './cache.service.js';

/**
 * Materialized View Refresh Service
 * Manages scheduled refresh of materialized views for performance optimization
 */

class MaterializedViewRefreshService {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
    this.refreshHistory = [];
    this.maxHistorySize = 100;
  }

  /**
   * Initialize and start all refresh jobs
   */
  async initialize() {
    try {
      console.log('Initializing materialized view refresh service...');
      
      // Define refresh schedules for different views
      this.defineRefreshSchedules();
      
      // Start all jobs
      this.startAllJobs();
      
      this.isRunning = true;
      console.log('Materialized view refresh service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize materialized view refresh service:', error);
      throw error;
    }
  }

  /**
   * Define refresh schedules for materialized views
   */
  defineRefreshSchedules() {
    // Analytics daily aggregates - refresh every hour
    this.addJob('analytics_daily_aggregates_mv', '0 * * * *', async () => {
      await this.refreshView('analytics_daily_aggregates_mv');
    });

    // Analytics monthly aggregates - refresh daily at 2 AM
    this.addJob('analytics_monthly_aggregates_mv', '0 2 * * *', async () => {
      await this.refreshView('analytics_monthly_aggregates_mv');
    });

    // Customer segments - refresh every 6 hours
    this.addJob('customer_segments_mv', '0 */6 * * *', async () => {
      await this.refreshView('customer_segments_mv');
    });

    // Supplier performance metrics - refresh every 4 hours
    this.addJob('supplier_performance_mv', '0 */4 * * *', async () => {
      await this.refreshView('supplier_performance_mv');
    });

    // Inventory metrics - refresh every 2 hours
    this.addJob('inventory_metrics_mv', '0 */2 * * *', async () => {
      await this.refreshView('inventory_metrics_mv');
    });

    // Product sales velocity - refresh every 3 hours
    this.addJob('product_sales_velocity_mv', '0 */3 * * *', async () => {
      await this.refreshView('product_sales_velocity_mv');
    });

    // Real-time dashboards - refresh every 15 minutes
    this.addJob('realtime_dashboard_mv', '*/15 * * * *', async () => {
      await this.refreshView('realtime_dashboard_mv');
    });

    // Dead stock analysis - refresh daily at 3 AM
    this.addJob('dead_stock_analysis_mv', '0 3 * * *', async () => {
      await this.refreshView('dead_stock_analysis_mv');
    });

    // Customer lifetime value - refresh weekly on Sunday at 4 AM
    this.addJob('customer_lifetime_value_mv', '0 4 * * 0', async () => {
      await this.refreshView('customer_lifetime_value_mv');
    });

    // ABC analysis - refresh daily at 1 AM
    this.addJob('abc_analysis_mv', '0 1 * * *', async () => {
      await this.refreshView('abc_analysis_mv');
    });
  }

  /**
   * Add a refresh job
   */
  addJob(viewName, schedule, refreshFunction) {
    const job = cron.schedule(schedule, async () => {
      try {
        const startTime = Date.now();
        console.log(`Starting refresh for ${viewName}...`);
        
        await refreshFunction();
        
        const duration = Date.now() - startTime;
        this.recordRefresh(viewName, true, duration);
        
        console.log(`Completed refresh for ${viewName} in ${duration}ms`);
      } catch (error) {
        console.error(`Failed to refresh ${viewName}:`, error);
        this.recordRefresh(viewName, false, 0, error.message);
      }
    }, {
      scheduled: false
    });

    this.jobs.set(viewName, { job, schedule });
  }

  /**
   * Refresh a specific materialized view
   */
  async refreshView(viewName) {
    try {
      // Execute refresh
      await db.execute(sql`REFRESH MATERIALIZED VIEW CONCURRENTLY ${sql.raw(viewName)}`);
      
      // Clear related cache entries
      await this.clearRelatedCache(viewName);
      
      return true;
    } catch (error) {
      // If concurrent refresh fails, try non-concurrent
      if (error.message.includes('CONCURRENTLY')) {
        console.log(`Falling back to non-concurrent refresh for ${viewName}`);
        await db.execute(sql`REFRESH MATERIALIZED VIEW ${sql.raw(viewName)}`);
        await this.clearRelatedCache(viewName);
        return true;
      }
      throw error;
    }
  }

  /**
   * Clear cache entries related to a materialized view
   */
  async clearRelatedCache(viewName) {
    const cachePatterns = {
      'analytics_daily_aggregates_mv': 'analytics:*',
      'analytics_monthly_aggregates_mv': 'analytics:*',
      'customer_segments_mv': 'customers:segments:*',
      'supplier_performance_mv': 'suppliers:performance:*',
      'inventory_metrics_mv': 'inventory:metrics:*',
      'product_sales_velocity_mv': 'products:velocity:*',
      'realtime_dashboard_mv': 'dashboard:*',
      'dead_stock_analysis_mv': 'inventory:deadstock:*',
      'customer_lifetime_value_mv': 'customers:clv:*',
      'abc_analysis_mv': 'inventory:abc:*'
    };

    const pattern = cachePatterns[viewName];
    if (pattern) {
      await cacheService.invalidatePattern(pattern);
      console.log(`Cleared cache for pattern: ${pattern}`);
    }
  }

  /**
   * Start all scheduled jobs
   */
  startAllJobs() {
    for (const [viewName, { job }] of this.jobs.entries()) {
      job.start();
      console.log(`Started refresh job for ${viewName}`);
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stopAllJobs() {
    for (const [viewName, { job }] of this.jobs.entries()) {
      job.stop();
      console.log(`Stopped refresh job for ${viewName}`);
    }
    this.isRunning = false;
  }

  /**
   * Manually trigger refresh for a specific view
   */
  async manualRefresh(viewName) {
    const jobInfo = this.jobs.get(viewName);
    if (!jobInfo) {
      throw new Error(`No refresh job found for view: ${viewName}`);
    }

    const startTime = Date.now();
    try {
      await this.refreshView(viewName);
      const duration = Date.now() - startTime;
      this.recordRefresh(viewName, true, duration, 'Manual refresh');
      return { success: true, duration };
    } catch (error) {
      this.recordRefresh(viewName, false, 0, error.message);
      throw error;
    }
  }

  /**
   * Get refresh status for all views
   */
  getRefreshStatus() {
    const status = [];
    
    for (const [viewName, { schedule }] of this.jobs.entries()) {
      const history = this.refreshHistory
        .filter(h => h.viewName === viewName)
        .slice(-5); // Last 5 refreshes
      
      const lastRefresh = history[history.length - 1];
      const successRate = history.length > 0
        ? (history.filter(h => h.success).length / history.length) * 100
        : 0;
      
      status.push({
        viewName,
        schedule,
        lastRefresh: lastRefresh || null,
        successRate: successRate.toFixed(1),
        recentHistory: history
      });
    }
    
    return {
      isRunning: this.isRunning,
      views: status,
      totalRefreshes: this.refreshHistory.length
    };
  }

  /**
   * Record refresh attempt in history
   */
  recordRefresh(viewName, success, duration, error = null) {
    const record = {
      viewName,
      success,
      duration,
      error,
      timestamp: new Date().toISOString()
    };
    
    this.refreshHistory.push(record);
    
    // Keep history size limited
    if (this.refreshHistory.length > this.maxHistorySize) {
      this.refreshHistory = this.refreshHistory.slice(-this.maxHistorySize);
    }
  }

  /**
   * Create missing materialized views
   */
  async createMaterializedViews() {
    const views = [
      {
        name: 'analytics_daily_aggregates_mv',
        query: `
          CREATE MATERIALIZED VIEW IF NOT EXISTS analytics_daily_aggregates_mv AS
          SELECT * FROM analytics_daily_aggregates
          WITH DATA
        `
      },
      {
        name: 'customer_segments_mv',
        query: `
          CREATE MATERIALIZED VIEW IF NOT EXISTS customer_segments_mv AS
          SELECT 
            c.id,
            c.customer_code,
            c.company_name,
            COUNT(DISTINCT ph.order_id) as total_orders,
            SUM(ph.total_amount) as lifetime_value,
            MAX(ph.created_at) as last_purchase_date,
            CASE 
              WHEN SUM(ph.total_amount) > 10000 THEN 'VIP'
              WHEN SUM(ph.total_amount) > 5000 THEN 'Gold'
              WHEN SUM(ph.total_amount) > 1000 THEN 'Silver'
              ELSE 'Bronze'
            END as segment
          FROM customers c
          LEFT JOIN purchase_orders ph ON c.id = ph.customer_id
          GROUP BY c.id, c.customer_code, c.company_name
          WITH DATA
        `
      },
      {
        name: 'inventory_metrics_mv',
        query: `
          CREATE MATERIALIZED VIEW IF NOT EXISTS inventory_metrics_mv AS
          SELECT 
            i.product_id,
            i.warehouse_id,
            i.quantity_on_hand,
            i.quantity_reserved,
            i.quantity_available,
            i.reorder_point,
            i.reorder_quantity,
            CASE 
              WHEN i.quantity_available <= 0 THEN 'out_of_stock'
              WHEN i.quantity_available <= i.reorder_point THEN 'low_stock'
              ELSE 'in_stock'
            END as stock_status
          FROM inventory i
          WHERE i.is_active = true
          WITH DATA
        `
      }
    ];

    for (const view of views) {
      try {
        await db.execute(sql.raw(view.query));
        console.log(`Created materialized view: ${view.name}`);
        
        // Create index for better query performance
        await db.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_${sql.raw(view.name)}_id ON ${sql.raw(view.name)} (id)`);
      } catch (error) {
        console.error(`Failed to create materialized view ${view.name}:`, error);
      }
    }
  }
}

// Singleton instance
const materializedViewRefreshService = new MaterializedViewRefreshService();

export default materializedViewRefreshService;