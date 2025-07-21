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
    this.backgroundInitializationComplete = false;
    this.jobsStartedCount = 0;
  }

  /**
   * Initialize and start all refresh jobs with API priority optimization
   * CRITICAL: This method is now NON-BLOCKING to prevent server startup delays
   */
  async initialize() {
    try {
      console.log('Initializing materialized view refresh service with API priority optimization...');
      
      // Check current server load before starting heavy operations
      const memUsage = process.memoryUsage();
      const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      
      if (memUsagePercent > 75) {
        console.warn(`High memory usage detected (${memUsagePercent.toFixed(1)}%). Delaying materialized view initialization.`);
        // Delay initialization by 5 minutes when system is under load
        setTimeout(() => {
          this.initializeDelayed();
        }, 5 * 60 * 1000);
        return;
      }
      
      // Define refresh schedules for different views with optimized intervals
      this.defineOptimizedRefreshSchedules();
      
      // CRITICAL FIX: Start all jobs in background WITHOUT blocking server startup
      this.startAllJobsStaggeredInBackground();
      
      this.isRunning = true;
      console.log('Materialized view refresh service initialized successfully with optimization (jobs starting in background)');
    } catch (error) {
      console.error('Failed to initialize materialized view refresh service:', error);
      // Continue without throwing to avoid blocking server startup
      this.isRunning = false;
    }
  }

  /**
   * Define optimized refresh schedules prioritizing API responsiveness
   */
  defineOptimizedRefreshSchedules() {
    // CRITICAL: Schedule intensive operations during off-peak hours (1-5 AM)
    // Reduce frequency during business hours (9 AM - 6 PM)
    
    // Analytics daily aggregates - reduced to every 3 hours during business hours
    this.addJob('analytics_daily_aggregates_mv', '0 1,4,7,10,13,16,19,22 * * *', async () => {
      await this.refreshViewWithThrottling('analytics_daily_aggregates_mv', 'high');
    });

    // Analytics monthly aggregates - only during off-peak at 2 AM
    this.addJob('analytics_monthly_aggregates_mv', '0 2 * * *', async () => {
      await this.refreshViewWithThrottling('analytics_monthly_aggregates_mv', 'low');
    });

    // Customer segments - reduced to every 8 hours, avoid business hours
    this.addJob('customer_segments_mv', '0 2,10,18 * * *', async () => {
      await this.refreshViewWithThrottling('customer_segments_mv', 'medium');
    });

    // Supplier performance metrics - every 6 hours, off-peak preferred
    this.addJob('supplier_performance_mv', '0 3,9,15,21 * * *', async () => {
      await this.refreshViewWithThrottling('supplier_performance_mv', 'medium');
    });

    // Inventory metrics - MOST CRITICAL - reduced to every 4 hours but prioritized
    this.addJob('inventory_metrics_mv', '0 1,5,9,13,17,21 * * *', async () => {
      await this.refreshViewWithThrottling('inventory_metrics_mv', 'critical');
    });

    // Product sales velocity - every 6 hours, off-peak
    this.addJob('product_sales_velocity_mv', '0 4,10,16,22 * * *', async () => {
      await this.refreshViewWithThrottling('product_sales_velocity_mv', 'medium');
    });

    // Real-time dashboards - DISABLED - too frequent, use cache instead
    // this.addJob('realtime_dashboard_mv', '*/15 * * * *', async () => {
    //   await this.refreshView('realtime_dashboard_mv');
    // });

    // Dead stock analysis - only at 3 AM
    this.addJob('dead_stock_analysis_mv', '0 3 * * *', async () => {
      await this.refreshViewWithThrottling('dead_stock_analysis_mv', 'low');
    });

    // Customer lifetime value - only weekly Sunday 4 AM
    this.addJob('customer_lifetime_value_mv', '0 4 * * 0', async () => {
      await this.refreshViewWithThrottling('customer_lifetime_value_mv', 'low');
    });

    // ABC analysis - only at 1 AM
    this.addJob('abc_analysis_mv', '0 1 * * *', async () => {
      await this.refreshViewWithThrottling('abc_analysis_mv', 'low');
    });
  }

  /**
   * Delayed initialization for high-load scenarios
   * CRITICAL: This method is also NON-BLOCKING
   */
  async initializeDelayed() {
    try {
      console.log('Starting delayed materialized view initialization...');
      this.defineOptimizedRefreshSchedules();
      // Use non-blocking background startup for delayed initialization too
      this.startAllJobsStaggeredInBackground();
      this.isRunning = true;
      console.log('Delayed materialized view refresh service initialized successfully (jobs starting in background)');
    } catch (error) {
      console.error('Failed delayed initialization:', error);
      this.isRunning = false;
    }
  }

  /**
   * Add a refresh job with API priority awareness
   */
  addJob(viewName, schedule, refreshFunction) {
    const job = cron.schedule(schedule, async () => {
      try {
        // Check system load before executing heavy operations
        if (await this.shouldSkipRefreshDueToLoad(viewName)) {
          console.log(`Skipping refresh for ${viewName} due to high system load`);
          this.recordRefresh(viewName, false, 0, 'Skipped due to high load');
          return;
        }

        const startTime = Date.now();
        console.log(`Starting optimized refresh for ${viewName}...`);
        
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
   * Refresh a specific materialized view with throttling and priority awareness
   */
  async refreshViewWithThrottling(viewName, priority = 'medium') {
    try {
      // Add artificial delay for non-critical refreshes during business hours
      const currentHour = new Date().getHours();
      const isBusinessHours = currentHour >= 9 && currentHour <= 18;
      
      if (isBusinessHours && priority !== 'critical') {
        // Add 5-15 second delay during business hours for non-critical refreshes
        const delay = priority === 'low' ? 15000 : 5000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }

      // Execute refresh with timeout to prevent hanging operations
      const refreshPromise = this.refreshView(viewName);
      const timeoutPromise = new Promise((_, reject) => {
        setTimeout(() => reject(new Error('Refresh timeout')), 300000); // 5 minute timeout
      });

      await Promise.race([refreshPromise, timeoutPromise]);
      return true;
    } catch (error) {
      console.error(`Throttled refresh failed for ${viewName}:`, error);
      throw error;
    }
  }

  /**
   * Refresh a specific materialized view (original method)
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
   * Start all scheduled jobs in background with staggered startup (NON-BLOCKING)
   * CRITICAL: This method runs in background without blocking server startup
   */
  startAllJobsStaggeredInBackground() {
    const jobEntries = Array.from(this.jobs.entries());
    this.jobsStartedCount = 0;
    this.backgroundInitializationComplete = false;
    
    // Run the staggered startup in background without blocking
    setTimeout(async () => {
      try {
        console.log('Starting materialized view refresh jobs in background...');
        
        for (let i = 0; i < jobEntries.length; i++) {
          const [viewName, { job }] = jobEntries[i];
          
          // Stagger job startup by 30 seconds to prevent simultaneous heavy operations
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 30000));
          }
          
          job.start();
          this.jobsStartedCount++;
          console.log(`Started refresh job for ${viewName} (${i + 1}/${jobEntries.length})`);
        }
        
        this.backgroundInitializationComplete = true;
        console.log('All materialized view refresh jobs started successfully in background');
      } catch (error) {
        console.error('Error starting materialized view jobs in background:', error);
        this.isRunning = false;
        this.backgroundInitializationComplete = false;
      }
    }, 100); // Start immediately in background (100ms delay to ensure method returns first)
  }

  /**
   * Start all scheduled jobs with staggered startup to avoid resource contention
   * LEGACY METHOD: Still available for manual/testing use but should not be used during server startup
   */
  async startAllJobsStaggered() {
    const jobEntries = Array.from(this.jobs.entries());
    
    for (let i = 0; i < jobEntries.length; i++) {
      const [viewName, { job }] = jobEntries[i];
      
      // Stagger job startup by 30 seconds to prevent simultaneous heavy operations
      if (i > 0) {
        await new Promise(resolve => setTimeout(resolve, 30000));
      }
      
      job.start();
      console.log(`Started refresh job for ${viewName} (${i + 1}/${jobEntries.length})`);
    }
  }

  /**
   * Start all scheduled jobs (legacy method)
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
      backgroundInitializationComplete: this.backgroundInitializationComplete,
      jobsStartedCount: this.jobsStartedCount,
      totalJobs: this.jobs.size,
      views: status,
      totalRefreshes: this.refreshHistory.length
    };
  }

  /**
   * Get current initialization status (useful for monitoring during startup)
   */
  getInitializationStatus() {
    return {
      serviceInitialized: this.isRunning,
      backgroundJobsStarting: this.isRunning && !this.backgroundInitializationComplete,
      backgroundJobsComplete: this.backgroundInitializationComplete,
      jobsStartedCount: this.jobsStartedCount,
      totalJobsToStart: this.jobs.size,
      initializationProgress: this.jobs.size > 0 ? (this.jobsStartedCount / this.jobs.size) * 100 : 0
    };
  }

  /**
   * Check if refresh should be skipped due to high system load
   */
  async shouldSkipRefreshDueToLoad(viewName) {
    try {
      const memUsage = process.memoryUsage();
      const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
      const cpuUsage = process.cpuUsage();
      
      // Skip non-critical refreshes if memory usage > 85%
      if (memUsagePercent > 85) {
        const criticalViews = ['inventory_metrics_mv'];
        if (!criticalViews.includes(viewName)) {
          return true;
        }
      }
      
      // Skip if memory usage > 95% for all refreshes
      if (memUsagePercent > 95) {
        return true;
      }
      
      return false;
    } catch (error) {
      console.error('Error checking system load:', error);
      return false;
    }
  }

  /**
   * Record refresh attempt in history with performance metrics
   */
  recordRefresh(viewName, success, duration, error = null) {
    const memUsage = process.memoryUsage();
    const memUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;
    
    const record = {
      viewName,
      success,
      duration,
      error,
      memoryUsage: memUsagePercent.toFixed(1),
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
            COUNT(DISTINCT po.id) as total_orders,
            COALESCE(SUM(po.total_amount), 0) as lifetime_value,
            MAX(po.order_date) as last_purchase_date,
            CASE 
              WHEN COALESCE(SUM(po.total_amount), 0) > 10000 THEN 'VIP'
              WHEN COALESCE(SUM(po.total_amount), 0) > 5000 THEN 'Gold'
              WHEN COALESCE(SUM(po.total_amount), 0) > 1000 THEN 'Silver'
              ELSE 'Bronze'
            END as segment
          FROM customers c
          LEFT JOIN purchase_orders po ON c.id = po.customer_id
          GROUP BY c.id, c.customer_code, c.company_name
          WITH DATA
        `
      },
      {
        name: 'inventory_metrics_mv',
        query: `
          CREATE MATERIALIZED VIEW IF NOT EXISTS inventory_metrics_mv AS
          SELECT 
            i.id,
            i.product_id,
            i.warehouse_id,
            i.quantity_on_hand,
            i.quantity_reserved,
            i.quantity_available,
            i.reorder_point,
            i.reorder_quantity,
            CASE 
              WHEN i.quantity_available <= 0 THEN 'out_of_stock'
              WHEN i.quantity_available <= COALESCE(i.reorder_point, 0) THEN 'low_stock'
              ELSE 'in_stock'
            END as calculated_stock_status,
            i.stock_status,
            i.average_cost,
            i.created_at,
            i.updated_at
          FROM inventory i
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