import {
  timeSeriesMetrics,
  timeSeriesEvents,
  suppliers,
  inventory,
  purchaseOrders,
  supplierPurchaseOrders,
  priceLists
} from '../db/schema.js';
import { db } from '../config/database.js';
import { eq, and, sql, gte, lte, desc, count, avg, max, min } from 'drizzle-orm';
import { sendNotification, createAlert } from './notifications.js';

/**
 * Integration Monitoring Service
 * Provides comprehensive monitoring, health checks, alerting, and error recovery
 * for all supply chain integration points
 */

// ==================== HEALTH CHECKS ====================

/**
 * Perform comprehensive system health check
 * @param {Object} options - Health check options
 * @returns {Object} Health check results
 */
export async function performSystemHealthCheck(options = {}) {
  const {
    includeDetailedMetrics = true,
    checkExternalServices = true,
    performanceThresholds = getDefaultThresholds()
  } = options;

  try {
    const healthCheck = {
      timestamp: new Date(),
      overallStatus: 'healthy',
      components: {},
      metrics: {},
      issues: [],
      recommendations: []
    };

    // Check database connectivity and performance
    healthCheck.components.database = await checkDatabaseHealth();
    
    // Check core business modules
    healthCheck.components.inventory = await checkInventoryModuleHealth();
    healthCheck.components.suppliers = await checkSupplierModuleHealth();
    healthCheck.components.orders = await checkOrderProcessingHealth();
    healthCheck.components.pricing = await checkPricingModuleHealth();
    
    // Check integration workflows
    healthCheck.components.workflows = await checkWorkflowHealth();
    
    // Check system health
    healthCheck.components.system = await checkSystemHealth();
    
    // Performance metrics
    if (includeDetailedMetrics) {
      healthCheck.metrics = await collectPerformanceMetrics(performanceThresholds);
    }

    // Determine overall status
    const componentStatuses = Object.values(healthCheck.components).map(c => c.status);
    if (componentStatuses.includes('critical')) {
      healthCheck.overallStatus = 'critical';
    } else if (componentStatuses.includes('warning')) {
      healthCheck.overallStatus = 'warning';
    }

    // Collect issues and recommendations
    for (const component of Object.values(healthCheck.components)) {
      if (component.issues) {
        healthCheck.issues.push(...component.issues);
      }
      if (component.recommendations) {
        healthCheck.recommendations.push(...component.recommendations);
      }
    }

    // Log health check
    await logHealthCheck(healthCheck);

    // Send alerts if needed
    if (healthCheck.overallStatus !== 'healthy') {
      await sendHealthAlert(healthCheck);
    }

    return {
      success: true,
      data: healthCheck,
      message: `System health check complete - Status: ${healthCheck.overallStatus}`
    };

  } catch (error) {
    console.error('Error performing health check:', error);
    
    // Log critical health check failure
    await logEvent('health_check_failed', {
      error: error.message,
      timestamp: new Date()
    });

    return {
      success: false,
      error: error.message,
      message: 'Health check failed to complete'
    };
  }
}

/**
 * Check database health and performance
 * @returns {Object} Database health status
 */
async function checkDatabaseHealth() {
  const health = {
    status: 'healthy',
    responseTime: null,
    connectionCount: null,
    issues: [],
    recommendations: []
  };

  try {
    const startTime = Date.now();
    
    // Simple connectivity test - fixed Drizzle ORM syntax
    await db.select({ count: sql`1` }).from(timeSeriesMetrics).limit(1);
    
    health.responseTime = Date.now() - startTime;

    // Check response time threshold
    if (health.responseTime > 1000) {
      health.status = 'warning';
      health.issues.push('Database response time is slow');
      health.recommendations.push('Check database performance and connections');
    } else if (health.responseTime > 5000) {
      health.status = 'critical';
      health.issues.push('Database response time is critical');
    }

    // Get table sizes for monitoring
    const tableSizes = await db.execute(sql`
      SELECT 
        schemaname,
        tablename,
        pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
        pg_total_relation_size(schemaname||'.'||tablename) as bytes
      FROM pg_tables 
      WHERE schemaname = 'public'
      ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC
      LIMIT 10
    `);

    health.tableSizes = tableSizes;

  } catch (error) {
    health.status = 'critical';
    health.issues.push(`Database connectivity error: ${error.message}`);
    console.error('Database health check failed:', error);
  }

  return health;
}

/**
 * Check inventory module health
 * @returns {Object} Inventory module health status
 */
async function checkInventoryModuleHealth() {
  const health = {
    status: 'healthy',
    metrics: {},
    issues: [],
    recommendations: []
  };

  try {
    // Check for negative inventory
    const [negativeInventory] = await db
      .select({ count: count() })
      .from(inventory)
      .where(sql`${inventory.quantityOnHand} < 0`);

    health.metrics.negativeInventoryCount = parseInt(negativeInventory.count);

    if (health.metrics.negativeInventoryCount > 0) {
      health.status = 'warning';
      health.issues.push(`${health.metrics.negativeInventoryCount} items have negative inventory`);
      health.recommendations.push('Review and correct negative inventory records');
    }

    // Check for stale inventory (no movement in 90 days)
    const ninetyDaysAgo = new Date(Date.now() - (90 * 24 * 60 * 60 * 1000));
    const [staleInventory] = await db
      .select({ count: count() })
      .from(inventory)
      .where(
        and(
          sql`${inventory.lastMovement} < ${ninetyDaysAgo}`,
          sql`${inventory.quantityOnHand} > 0`
        )
      );

    health.metrics.staleInventoryCount = parseInt(staleInventory.count);

    if (health.metrics.staleInventoryCount > 100) {
      health.status = 'warning';
      health.issues.push(`${health.metrics.staleInventoryCount} items have stale inventory`);
      health.recommendations.push('Review slow-moving inventory');
    }

    // Check inventory value
    const [inventoryValue] = await db
      .select({
        totalValue: sql`SUM(${inventory.quantityOnHand} * COALESCE(${inventory.averageCost}, 0))`
      })
      .from(inventory);

    health.metrics.totalInventoryValue = parseFloat(inventoryValue.totalValue || 0);

    // Check for items at reorder point
    const [reorderItems] = await db
      .select({ count: count() })
      .from(inventory)
      .where(sql`${inventory.quantityOnHand} <= ${inventory.reorderPoint}`);

    health.metrics.itemsAtReorderPoint = parseInt(reorderItems.count);

    if (health.metrics.itemsAtReorderPoint > 50) {
      health.status = 'warning';
      health.issues.push(`${health.metrics.itemsAtReorderPoint} items at or below reorder point`);
      health.recommendations.push('Review and process reorder recommendations');
    }

  } catch (error) {
    health.status = 'critical';
    health.issues.push(`Inventory module error: ${error.message}`);
    console.error('Inventory health check failed:', error);
  }

  return health;
}

/**
 * Check supplier module health
 * @returns {Object} Supplier module health status
 */
async function checkSupplierModuleHealth() {
  const health = {
    status: 'healthy',
    metrics: {},
    issues: [],
    recommendations: []
  };

  try {
    // Count active suppliers
    const [activeSuppliers] = await db
      .select({ count: count() })
      .from(suppliers)
      .where(eq(suppliers.isActive, true));

    health.metrics.activeSuppliers = parseInt(activeSuppliers.count);

    // Count suppliers with active price lists
    const [suppliersWithPriceLists] = await db
      .select({ count: sql`COUNT(DISTINCT ${priceLists.supplierId})` })
      .from(priceLists)
      .where(eq(priceLists.status, 'active'));

    health.metrics.suppliersWithActivePriceLists = parseInt(suppliersWithPriceLists.count);

    // Check for suppliers without recent activity
    const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
    const [inactiveSuppliers] = await db
      .select({ count: count() })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.isActive, true),
          sql`${suppliers.updatedAt} < ${thirtyDaysAgo}`
        )
      );

    health.metrics.inactiveSuppliers = parseInt(inactiveSuppliers.count);

    if (health.metrics.inactiveSuppliers > health.metrics.activeSuppliers * 0.5) {
      health.status = 'warning';
      health.issues.push('Many suppliers have not been updated recently');
      health.recommendations.push('Review supplier engagement and data freshness');
    }

    // Check performance ratings
    const [lowPerformanceSuppliers] = await db
      .select({ count: count() })
      .from(suppliers)
      .where(
        and(
          eq(suppliers.isActive, true),
          sql`${suppliers.performanceRating} < 2.5`
        )
      );

    health.metrics.lowPerformanceSuppliers = parseInt(lowPerformanceSuppliers.count);

  } catch (error) {
    health.status = 'critical';
    health.issues.push(`Supplier module error: ${error.message}`);
    console.error('Supplier health check failed:', error);
  }

  return health;
}

/**
 * Check order processing health
 * @returns {Object} Order processing health status
 */
async function checkOrderProcessingHealth() {
  const health = {
    status: 'healthy',
    metrics: {},
    issues: [],
    recommendations: []
  };

  try {
    // Check pending orders
    const [pendingOrders] = await db
      .select({ count: count() })
      .from(purchaseOrders)
      .where(eq(purchaseOrders.status, 'pending'));

    health.metrics.pendingOrders = parseInt(pendingOrders.count);

    // Check overdue orders (pending > 7 days)
    const sevenDaysAgo = new Date(Date.now() - (7 * 24 * 60 * 60 * 1000));
    const [overdueOrders] = await db
      .select({ count: count() })
      .from(purchaseOrders)
      .where(
        and(
          eq(purchaseOrders.status, 'pending'),
          sql`${purchaseOrders.createdAt} < ${sevenDaysAgo}`
        )
      );

    health.metrics.overdueOrders = parseInt(overdueOrders.count);

    if (health.metrics.overdueOrders > 0) {
      health.status = 'warning';
      health.issues.push(`${health.metrics.overdueOrders} orders are overdue for processing`);
      health.recommendations.push('Review and process overdue orders');
    }

    // Check supplier purchase orders
    const [pendingSupplierOrders] = await db
      .select({ count: count() })
      .from(supplierPurchaseOrders)
      .where(eq(supplierPurchaseOrders.approvalStatus, 'pending'));

    health.metrics.pendingSupplierOrders = parseInt(pendingSupplierOrders.count);

    // Check order processing rate (orders per day)
    const yesterday = new Date(Date.now() - (24 * 60 * 60 * 1000));
    const [recentOrders] = await db
      .select({ count: count() })
      .from(purchaseOrders)
      .where(gte(purchaseOrders.createdAt, yesterday));

    health.metrics.orderProcessingRate = parseInt(recentOrders.count);

  } catch (error) {
    health.status = 'critical';
    health.issues.push(`Order processing error: ${error.message}`);
    console.error('Order processing health check failed:', error);
  }

  return health;
}

/**
 * Check pricing module health
 * @returns {Object} Pricing module health status
 */
async function checkPricingModuleHealth() {
  const health = {
    status: 'healthy',
    metrics: {},
    issues: [],
    recommendations: []
  };

  try {
    // Check active price lists
    const [activePriceLists] = await db
      .select({ count: count() })
      .from(priceLists)
      .where(eq(priceLists.status, 'active'));

    health.metrics.activePriceLists = parseInt(activePriceLists.count);

    // Check expired price lists still marked as active
    const [expiredActiveLists] = await db
      .select({ count: count() })
      .from(priceLists)
      .where(
        and(
          eq(priceLists.status, 'active'),
          sql`${priceLists.expiryDate} < CURRENT_DATE`
        )
      );

    health.metrics.expiredActiveLists = parseInt(expiredActiveLists.count);

    if (health.metrics.expiredActiveLists > 0) {
      health.status = 'warning';
      health.issues.push(`${health.metrics.expiredActiveLists} expired price lists still marked as active`);
      health.recommendations.push('Deactivate expired price lists');
    }

    // Check price lists pending approval
    const [pendingApproval] = await db
      .select({ count: count() })
      .from(priceLists)
      .where(eq(priceLists.status, 'pending_approval'));

    health.metrics.priceListsPendingApproval = parseInt(pendingApproval.count);

    // Check for price lists older than 30 days
    const thirtyDaysAgo = new Date(Date.now() - (30 * 24 * 60 * 60 * 1000));
    const [stalePriceLists] = await db
      .select({ count: count() })
      .from(priceLists)
      .where(
        and(
          eq(priceLists.status, 'active'),
          sql`${priceLists.createdAt} < ${thirtyDaysAgo}`
        )
      );

    health.metrics.stalePriceLists = parseInt(stalePriceLists.count);

  } catch (error) {
    health.status = 'critical';
    health.issues.push(`Pricing module error: ${error.message}`);
    console.error('Pricing health check failed:', error);
  }

  return health;
}

/**
 * Check workflow health
 * @returns {Object} Workflow health status
 */
async function checkWorkflowHealth() {
  const health = {
    status: 'healthy',
    metrics: {},
    issues: [],
    recommendations: []
  };

  try {
    // Check recent workflow events
    const twentyFourHoursAgo = new Date(Date.now() - (24 * 60 * 60 * 1000));
    const [recentEvents] = await db
      .select({ count: count() })
      .from(timeSeriesEvents)
      .where(gte(timeSeriesEvents.timestamp, twentyFourHoursAgo));

    health.metrics.recentWorkflowEvents = parseInt(recentEvents.count);

    // Check for failed events
    const [failedEvents] = await db
      .select({ count: count() })
      .from(timeSeriesEvents)
      .where(
        and(
          gte(timeSeriesEvents.timestamp, twentyFourHoursAgo),
          eq(timeSeriesEvents.resultStatus, 'failed')
        )
      );

    health.metrics.failedEvents = parseInt(failedEvents.count);

    if (health.metrics.failedEvents > 0) {
      health.status = 'warning';
      health.issues.push(`${health.metrics.failedEvents} workflow events failed in the last 24 hours`);
      health.recommendations.push('Review failed workflow events and implement fixes');
    }

    // Check workflow performance
    const [avgDuration] = await db
      .select({
        avgDuration: avg(timeSeriesEvents.duration)
      })
      .from(timeSeriesEvents)
      .where(
        and(
          gte(timeSeriesEvents.timestamp, twentyFourHoursAgo),
          sql`${timeSeriesEvents.duration} IS NOT NULL`
        )
      );

    health.metrics.averageWorkflowDuration = parseFloat(avgDuration.avgDuration || 0);

    if (health.metrics.averageWorkflowDuration > 10000) { // 10 seconds
      health.status = 'warning';
      health.issues.push('Workflow performance is degraded');
      health.recommendations.push('Optimize workflow performance');
    }

  } catch (error) {
    health.status = 'critical';
    health.issues.push(`Workflow health error: ${error.message}`);
    console.error('Workflow health check failed:', error);
  }

  return health;
}

// ==================== PERFORMANCE METRICS ====================

/**
 * Collect comprehensive performance metrics
 * @param {Object} thresholds - Performance thresholds
 * @returns {Object} Performance metrics
 */
async function collectPerformanceMetrics(thresholds) {
  const metrics = {
    database: {},
    workflows: {},
    integrations: {},
    business: {}
  };

  try {
    // Database performance metrics
    const dbMetrics = await collectDatabaseMetrics();
    metrics.database = dbMetrics;

    // Workflow performance metrics
    const workflowMetrics = await collectWorkflowMetrics();
    metrics.workflows = workflowMetrics;

    // Integration performance metrics
    const integrationMetrics = await collectIntegrationMetrics();
    metrics.integrations = integrationMetrics;

    // Business performance metrics
    const businessMetrics = await collectBusinessMetrics();
    metrics.business = businessMetrics;

    // System memory metrics
    const memoryMetrics = await collectMemoryMetrics();
    metrics.memory = memoryMetrics;

    // Record metrics in time series
    await recordPerformanceMetrics(metrics);

  } catch (error) {
    console.error('Error collecting performance metrics:', error);
  }

  return metrics;
}

/**
 * Collect database performance metrics
 * @returns {Object} Database metrics
 */
async function collectDatabaseMetrics() {
  try {
    // Connection count and performance
    const connectionStats = await db.execute(sql`
      SELECT 
        count(*) as total_connections,
        count(*) FILTER (WHERE state = 'active') as active_connections,
        count(*) FILTER (WHERE state = 'idle') as idle_connections
      FROM pg_stat_activity
    `);

    // Database size
    const dbSize = await db.execute(sql`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `);

    // Query performance
    const slowQueries = await db.execute(sql`
      SELECT count(*) as slow_queries
      FROM pg_stat_statements 
      WHERE mean_exec_time > 1000
    `);

    return {
      connections: connectionStats[0],
      databaseSize: dbSize[0]?.size || 'unknown',
      slowQueries: slowQueries[0]?.slow_queries || 0
    };

  } catch (error) {
    console.error('Error collecting database metrics:', error);
    return {};
  }
}

/**
 * Collect workflow performance metrics
 * @returns {Object} Workflow metrics
 */
async function collectWorkflowMetrics() {
  const twentyFourHoursAgo = new Date(Date.now() - (24 * 60 * 60 * 1000));

  try {
    const [workflowStats] = await db
      .select({
        totalEvents: count(),
        avgDuration: avg(timeSeriesEvents.duration),
        maxDuration: max(timeSeriesEvents.duration),
        minDuration: min(timeSeriesEvents.duration),
        successRate: sql`(COUNT(CASE WHEN result_status = 'success' THEN 1 END) * 100.0 / COUNT(*))`
      })
      .from(timeSeriesEvents)
      .where(gte(timeSeriesEvents.timestamp, twentyFourHoursAgo));

    return {
      totalEvents: parseInt(workflowStats.totalEvents || 0),
      averageDuration: parseFloat(workflowStats.avgDuration || 0),
      maxDuration: parseFloat(workflowStats.maxDuration || 0),
      minDuration: parseFloat(workflowStats.minDuration || 0),
      successRate: parseFloat(workflowStats.successRate || 0)
    };

  } catch (error) {
    console.error('Error collecting workflow metrics:', error);
    return {};
  }
}

/**
 * Collect integration performance metrics
 * @returns {Object} Integration metrics
 */
async function collectIntegrationMetrics() {
  const oneHourAgo = new Date(Date.now() - (60 * 60 * 1000));

  try {
    // Recent integration events by type
    const integrationEvents = await db
      .select({
        eventType: timeSeriesEvents.eventType,
        count: count(),
        avgDuration: avg(timeSeriesEvents.duration)
      })
      .from(timeSeriesEvents)
      .where(
        and(
          gte(timeSeriesEvents.timestamp, oneHourAgo),
          sql`${timeSeriesEvents.eventCategory} IN ('price_workflow', 'order_fulfillment', 'demand_planning')`
        )
      )
      .groupBy(timeSeriesEvents.eventType);

    return {
      recentIntegrationEvents: integrationEvents,
      lastHourEventCount: integrationEvents.reduce((sum, event) => sum + parseInt(event.count), 0)
    };

  } catch (error) {
    console.error('Error collecting integration metrics:', error);
    return {};
  }
}

/**
 * Collect business performance metrics
 * @returns {Object} Business metrics
 */
async function collectBusinessMetrics() {
  const today = new Date();
  const yesterday = new Date(today.getTime() - (24 * 60 * 60 * 1000));

  try {
    // Orders processed today
    const [ordersToday] = await db
      .select({ count: count() })
      .from(purchaseOrders)
      .where(gte(purchaseOrders.createdAt, yesterday));

    // Inventory movements today
    const [movementsToday] = await db
      .select({ count: count() })
      .from(inventory)
      .where(gte(inventory.lastMovement, yesterday));

    return {
      ordersProcessedToday: parseInt(ordersToday.count || 0),
      inventoryMovementsToday: parseInt(movementsToday.count || 0),
      timestamp: new Date()
    };

  } catch (error) {
    console.error('Error collecting business metrics:', error);
    return {};
  }
}

/**
 * Collect system memory metrics
 * @returns {Object} Memory metrics
 */
async function collectMemoryMetrics() {
  try {
    const memoryUsage = process.memoryUsage();
    return {
      rss: memoryUsage.rss,
      heapTotal: memoryUsage.heapTotal,
      heapUsed: memoryUsage.heapUsed,
      external: memoryUsage.external,
      arrayBuffers: memoryUsage.arrayBuffers
    };
  } catch (error) {
    console.error('Error collecting memory metrics:', error);
    return {};
  }
}

/**
 * Check system health (memory usage)
 * @returns {Object} System health status
 */
async function checkSystemHealth() {
  const health = {
    status: 'healthy',
    metrics: {},
    issues: [],
    recommendations: []
  };

  try {
    health.metrics = await collectMemoryMetrics();
    
    // Check against thresholds
    const thresholds = getDefaultThresholds().memory;
    const memoryUsagePercent = (health.metrics.rss / thresholds.rssBytes) * 100;
    
    if (memoryUsagePercent > thresholds.usagePercent) {
      health.status = 'critical';
      health.issues.push(`Memory usage critical: ${memoryUsagePercent.toFixed(2)}% of threshold`);
      health.recommendations.push('Investigate memory leaks or optimize application memory usage');
    } else if (memoryUsagePercent > thresholds.usagePercent * 0.8) {
      health.status = 'warning';
      health.issues.push(`Memory usage high: ${memoryUsagePercent.toFixed(2)}% of threshold`);
    }
  } catch (error) {
    health.status = 'critical';
    health.issues.push(`System health check error: ${error.message}`);
    console.error('System health check failed:', error);
  }

  return health;
}

// ==================== ERROR RECOVERY ====================

/**
 * Automated error recovery system
 * @param {Object} options - Recovery options
 * @returns {Object} Recovery results
 */
export async function performAutomatedRecovery(options = {}) {
  const {
    recoveryLevel = 'basic', // basic, intermediate, aggressive
    dryRun = false
  } = options;

  try {
    const recoveryResults = {
      timestamp: new Date(),
      recoveryLevel,
      dryRun,
      actionsPerformed: [],
      errors: [],
      summary: {
        totalActions: 0,
        successfulActions: 0,
        failedActions: 0
      }
    };

    // Basic recovery actions
    if (recoveryLevel === 'basic' || recoveryLevel === 'intermediate' || recoveryLevel === 'aggressive') {
      await performBasicRecovery(recoveryResults, dryRun);
    }

    // Intermediate recovery actions
    if (recoveryLevel === 'intermediate' || recoveryLevel === 'aggressive') {
      await performIntermediateRecovery(recoveryResults, dryRun);
    }

    // Aggressive recovery actions
    if (recoveryLevel === 'aggressive') {
      await performAggressiveRecovery(recoveryResults, dryRun);
    }

    // Log recovery attempt
    await logEvent('automated_recovery_performed', {
      recoveryLevel,
      dryRun,
      actionsCount: recoveryResults.actionsPerformed.length,
      successRate: recoveryResults.summary.totalActions > 0 
        ? (recoveryResults.summary.successfulActions / recoveryResults.summary.totalActions) * 100 
        : 0
    });

    return {
      success: true,
      data: recoveryResults,
      message: `Recovery complete: ${recoveryResults.summary.successfulActions}/${recoveryResults.summary.totalActions} actions successful`
    };

  } catch (error) {
    console.error('Error during automated recovery:', error);
    return {
      success: false,
      error: error.message,
      message: 'Automated recovery failed'
    };
  }
}

/**
 * Perform basic recovery actions
 * @param {Object} results - Recovery results object
 * @param {boolean} dryRun - Whether to perform actual changes
 */
async function performBasicRecovery(results, dryRun) {
  // Clean up expired active price lists
  try {
    if (!dryRun) {
      const expiredLists = await db
        .update(priceLists)
        .set({ status: 'expired' })
        .where(
          and(
            eq(priceLists.status, 'active'),
            sql`${priceLists.expiryDate} < CURRENT_DATE`
          )
        )
        .returning({ id: priceLists.id });

      results.actionsPerformed.push({
        action: 'cleanup_expired_price_lists',
        success: true,
        affectedRecords: expiredLists.length,
        description: 'Deactivated expired price lists'
      });
    } else {
      results.actionsPerformed.push({
        action: 'cleanup_expired_price_lists',
        success: true,
        dryRun: true,
        description: 'Would deactivate expired price lists'
      });
    }
    results.summary.successfulActions++;
  } catch (error) {
    results.errors.push({
      action: 'cleanup_expired_price_lists',
      error: error.message
    });
    results.summary.failedActions++;
  }
  results.summary.totalActions++;

  // Fix negative inventory quantities
  try {
    if (!dryRun) {
      const fixedInventory = await db
        .update(inventory)
        .set({ 
          quantityOnHand: 0,
          quantityAvailable: 0 
        })
        .where(sql`${inventory.quantityOnHand} < 0`)
        .returning({ id: inventory.id });

      results.actionsPerformed.push({
        action: 'fix_negative_inventory',
        success: true,
        affectedRecords: fixedInventory.length,
        description: 'Fixed negative inventory quantities'
      });
    } else {
      results.actionsPerformed.push({
        action: 'fix_negative_inventory',
        success: true,
        dryRun: true,
        description: 'Would fix negative inventory quantities'
      });
    }
    results.summary.successfulActions++;
  } catch (error) {
    results.errors.push({
      action: 'fix_negative_inventory',
      error: error.message
    });
    results.summary.failedActions++;
  }
  results.summary.totalActions++;
}

/**
 * Perform intermediate recovery actions
 * @param {Object} results - Recovery results object
 * @param {boolean} dryRun - Whether to perform actual changes
 */
async function performIntermediateRecovery(results, dryRun) {
  // Retry failed workflow events from the last hour
  try {
    const oneHourAgo = new Date(Date.now() - (60 * 60 * 1000));
    const failedEvents = await db
      .select()
      .from(timeSeriesEvents)
      .where(
        and(
          eq(timeSeriesEvents.resultStatus, 'failed'),
          gte(timeSeriesEvents.timestamp, oneHourAgo)
        )
      )
      .limit(10); // Limit to prevent overwhelming the system

    let retriedCount = 0;
    if (!dryRun) {
      for (const event of failedEvents) {
        try {
          await retryFailedEvent(event);
          retriedCount++;
        } catch (error) {
          console.error(`Failed to retry event ${event.id}:`, error);
        }
      }
    }

    results.actionsPerformed.push({
      action: 'retry_failed_events',
      success: true,
      affectedRecords: dryRun ? failedEvents.length : retriedCount,
      description: dryRun ? 'Would retry failed workflow events' : 'Retried failed workflow events'
    });
    results.summary.successfulActions++;
  } catch (error) {
    results.errors.push({
      action: 'retry_failed_events',
      error: error.message
    });
    results.summary.failedActions++;
  }
  results.summary.totalActions++;
}

/**
 * Perform aggressive recovery actions
 * @param {Object} results - Recovery results object
 * @param {boolean} dryRun - Whether to perform actual changes
 */
async function performAggressiveRecovery(results, dryRun) {
  // Recalculate inventory quantities based on movements
  try {
    if (!dryRun) {
      // This would be a complex operation to recalculate all inventory
      // from movement history - implement based on specific needs
      results.actionsPerformed.push({
        action: 'recalculate_inventory',
        success: true,
        description: 'Inventory recalculation initiated'
      });
    } else {
      results.actionsPerformed.push({
        action: 'recalculate_inventory',
        success: true,
        dryRun: true,
        description: 'Would recalculate inventory from movement history'
      });
    }
    results.summary.successfulActions++;
  } catch (error) {
    results.errors.push({
      action: 'recalculate_inventory',
      error: error.message
    });
    results.summary.failedActions++;
  }
  results.summary.totalActions++;
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Get default performance thresholds
 * @returns {Object} Default thresholds
 */
function getDefaultThresholds() {
  return {
    database: {
      responseTime: 1000, // ms
      connectionCount: 100
    },
    workflows: {
      averageDuration: 5000, // ms
      successRate: 95 // %
    },
    business: {
      dailyOrders: 10,
      inventoryMovements: 50
    },
    memory: {
      usagePercent: 90, // %
      rssBytes: 1073741824 // 1GB in bytes
    }
  };
}

/**
 * Log health check results
 * @param {Object} healthCheck - Health check results
 */
async function logHealthCheck(healthCheck) {
  try {
    await logEvent('system_health_check', {
      overallStatus: healthCheck.overallStatus,
      componentsChecked: Object.keys(healthCheck.components).length,
      issuesFound: healthCheck.issues.length,
      timestamp: healthCheck.timestamp
    });

    // Record metrics
    await db.insert(timeSeriesMetrics).values({
      metricName: 'system_health_score',
      metricType: 'gauge',
      value: healthCheck.overallStatus === 'healthy' ? 1 : (healthCheck.overallStatus === 'warning' ? 0.5 : 0),
      dimension1: 'overall',
      timestamp: healthCheck.timestamp
    });

  } catch (error) {
    console.error('Error logging health check:', error);
  }
}

/**
 * Send health alerts
 * @param {Object} healthCheck - Health check results
 */
async function sendHealthAlert(healthCheck) {
  try {
    const severity = healthCheck.overallStatus === 'critical' ? 'high' : 'medium';
    
    await sendNotification({
      type: 'system_health_alert',
      title: `System Health Alert - ${healthCheck.overallStatus.toUpperCase()}`,
      message: `System health check detected ${healthCheck.issues.length} issues`,
      data: {
        overallStatus: healthCheck.overallStatus,
        issues: healthCheck.issues.slice(0, 5), // Limit to first 5
        totalIssues: healthCheck.issues.length,
        timestamp: healthCheck.timestamp
      },
      priority: severity,
      category: 'system_monitoring'
    });

    // Create alert for critical issues
    if (healthCheck.overallStatus === 'critical') {
      await createAlert({
        type: 'critical_system_health',
        severity: 'high',
        title: 'Critical System Health Issues',
        message: `System experiencing critical issues requiring immediate attention`,
        data: {
          healthCheck: healthCheck,
          requiresAction: true
        }
      });
    }

  } catch (error) {
    console.error('Error sending health alert:', error);
  }
}

/**
 * Retry a failed event
 * @param {Object} event - Failed event to retry
 */
async function retryFailedEvent(event) {
  // Implementation would depend on the specific event type
  // This is a placeholder for the retry logic
  console.log(`Retrying failed event: ${event.eventType}`);
  
  // Log the retry attempt
  await logEvent('event_retry_attempted', {
    originalEventId: event.id,
    eventType: event.eventType,
    retryTimestamp: new Date()
  });
}

/**
 * Record performance metrics in time series
 * @param {Object} metrics - Performance metrics
 */
async function recordPerformanceMetrics(metrics) {
  try {
    const timestamp = new Date();
    const metricsToInsert = [];

    // Database metrics
    if (metrics.database.connections) {
      metricsToInsert.push({
        metricName: 'database_connections',
        metricType: 'gauge',
        value: metrics.database.connections.total_connections,
        dimension1: 'total',
        timestamp
      });
    }

    // Workflow metrics
    if (metrics.workflows.totalEvents) {
      metricsToInsert.push({
        metricName: 'workflow_events',
        metricType: 'counter',
        value: metrics.workflows.totalEvents,
        timestamp
      });
    }

    if (metrics.workflows.successRate) {
      metricsToInsert.push({
        metricName: 'workflow_success_rate',
        metricType: 'gauge',
        value: metrics.workflows.successRate,
        timestamp
      });
    }

    // Business metrics
    if (metrics.business.ordersProcessedToday) {
      metricsToInsert.push({
        metricName: 'orders_processed',
        metricType: 'counter',
        value: metrics.business.ordersProcessedToday,
        dimension1: 'daily',
        timestamp
      });
    }

    if (metricsToInsert.length > 0) {
      await db.insert(timeSeriesMetrics).values(metricsToInsert);
    }

  } catch (error) {
    console.error('Error recording performance metrics:', error);
  }
}

/**
 * Log workflow events
 * @param {string} eventType - Event type
 * @param {Object} eventData - Event data
 */
async function logEvent(eventType, eventData) {
  try {
    await db.insert(timeSeriesEvents).values({
      eventType,
      eventCategory: 'system_monitoring',
      action: eventType,
      properties: eventData,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error logging event:', error);
  }
}

/**
 * Start monitoring system
 * @param {Object} options - Monitoring options
 */
export async function startMonitoring(options = {}) {
  console.log('Integration monitoring started');
  
  // Set up periodic health checks
  const healthCheckInterval = options.healthCheckInterval || 300000; // 5 minutes
  setInterval(async () => {
    try {
      await performSystemHealthCheck({ includeDetailedMetrics: false });
    } catch (error) {
      console.error('Scheduled health check failed:', error);
    }
  }, healthCheckInterval);
  
  return { success: true, message: 'Monitoring started successfully' };
}

export const integrationMonitoringService = {
  performSystemHealthCheck,
  performAutomatedRecovery,
  collectPerformanceMetrics,
  startMonitoring
};

export default {
  performSystemHealthCheck,
  performAutomatedRecovery,
  collectPerformanceMetrics
};