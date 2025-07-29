/**
 * Supply Chain Dashboard Service
 * 
 * Provides unified dashboard with real-time metrics, drill-down capability,
 * predictive analytics, and export functionality for supply chain operations.
 */

import { db } from '../config/database.js';
import { 
  suppliers, 
  priceLists, 
  priceListItems,
  products, 
  inventory, 
  inventoryMovements,
  supplierPurchaseOrders,
  supplierPurchaseOrderItems,
  purchaseOrderReceipts,
  purchaseOrders,
  customers,
  timeSeriesEvents,
  timeSeriesMetrics,
  timeSeriesHourlyMetrics,
  analyticsDailyAggregates,
  analyticsMonthlyAggregates
} from '../db/schema.js';
import { eq, and, gte, lte, desc, asc, count, sum, avg, max, min, isNull } from 'drizzle-orm';
import { sql } from 'drizzle-orm';

class SupplyChainDashboardService {
  constructor() {
    this.cacheTimeout = 5 * 60 * 1000; // 5 minutes
    this.cache = new Map();
  }

  // ==================== MAIN DASHBOARD ====================

  /**
   * Get comprehensive supply chain dashboard data
   */
  async getDashboardData(timeRange = '24h', options = {}) {
    const cacheKey = `dashboard-${timeRange}-${JSON.stringify(options)}`;
    const cached = this.getCachedData(cacheKey);
    if (cached) return cached;

    try {
      const timeRangeMs = this.parseTimeRange(timeRange);
      const startTime = new Date(Date.now() - timeRangeMs);
      const endTime = new Date();

      const [
        overview,
        priceListMetrics,
        inventoryMetrics,
        orderMetrics,
        supplierMetrics,
        performanceMetrics,
        alerts,
        trends
      ] = await Promise.all([
        this.getOverviewMetrics(startTime, endTime),
        this.getPriceListMetrics(startTime, endTime),
        this.getInventoryMetrics(startTime, endTime),
        this.getOrderMetrics(startTime, endTime),
        this.getSupplierMetrics(startTime, endTime),
        this.getPerformanceMetrics(startTime, endTime),
        this.getActiveAlerts(),
        this.getTrendData(timeRange)
      ]);

      const dashboardData = {
        generatedAt: new Date(),
        timeRange,
        period: {
          start: startTime,
          end: endTime
        },
        overview,
        priceListMetrics,
        inventoryMetrics,
        orderMetrics,
        supplierMetrics,
        performanceMetrics,
        alerts,
        trends,
        healthScore: this.calculateHealthScore({
          overview,
          performanceMetrics,
          alerts
        })
      };

      this.setCachedData(cacheKey, dashboardData);
      return dashboardData;

    } catch (error) {
      console.error('Dashboard data generation failed:', error);
      throw error;
    }
  }

  // ==================== OVERVIEW METRICS ====================

  /**
   * Get high-level overview metrics
   */
  async getOverviewMetrics(startTime, endTime) {
    try {
      // Total integration events
      const [eventStats] = await db.select({
        totalEvents: count(),
        successfulEvents: count(sql`CASE WHEN ${timeSeriesEvents.resultStatus} = 'success' THEN 1 END`),
        failedEvents: count(sql`CASE WHEN ${timeSeriesEvents.resultStatus} = 'error' THEN 1 END`),
        avgDuration: avg(timeSeriesEvents.duration)
      })
      .from(timeSeriesEvents)
      .where(and(
        gte(timeSeriesEvents.timestamp, startTime),
        lte(timeSeriesEvents.timestamp, endTime),
        eq(timeSeriesEvents.eventCategory, 'integration')
      ));

      // Active suppliers and customers
      const [supplierCount] = await db.select({ count: count() })
        .from(suppliers)
        .where(eq(suppliers.isActive, true));

      const [customerCount] = await db.select({ count: count() })
        .from(customers);

      // Inventory summary
      const [inventorySummary] = await db.select({
        totalProducts: count(),
        totalValue: sum(sql`${inventory.quantityOnHand} * ${inventory.averageCost}`),
        lowStockItems: count(sql`CASE WHEN ${inventory.quantityAvailable} <= ${inventory.reorderPoint} THEN 1 END`),
        outOfStockItems: count(sql`CASE WHEN ${inventory.quantityOnHand} <= 0 THEN 1 END`)
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .where(eq(products.isActive, true));

      // Calculate success rate
      const totalEvents = eventStats.totalEvents || 0;
      const successRate = totalEvents > 0 ? 
        ((eventStats.successfulEvents || 0) / totalEvents) * 100 : 100;

      return {
        integration: {
          totalEvents: totalEvents,
          successRate: Math.round(successRate * 100) / 100,
          failureRate: Math.round((100 - successRate) * 100) / 100,
          avgProcessingTime: Math.round(eventStats.avgDuration || 0)
        },
        suppliers: {
          activeCount: supplierCount.count,
          // TODO: Add supplier performance metrics
        },
        customers: {
          totalCount: customerCount.count,
          // TODO: Add customer metrics
        },
        inventory: {
          totalProducts: inventorySummary.totalProducts,
          totalValue: Math.round((inventorySummary.totalValue || 0) * 100) / 100,
          lowStockItems: inventorySummary.lowStockItems,
          outOfStockItems: inventorySummary.outOfStockItems,
          stockHealthScore: this.calculateStockHealthScore(inventorySummary)
        }
      };

    } catch (error) {
      console.error('Failed to get overview metrics:', error);
      return this.getDefaultOverviewMetrics();
    }
  }

  // ==================== PRICE LIST METRICS ====================

  /**
   * Get price list processing metrics
   */
  async getPriceListMetrics(startTime, endTime) {
    try {
      // Recent price list uploads
      const recentUploads = await db.select({
        id: priceLists.id,
        supplierName: suppliers.companyName,
        name: priceLists.name,
        status: priceLists.status,
        validationStatus: priceLists.validationStatus,
        itemCount: priceLists.itemCount,
        effectiveDate: priceLists.effectiveDate,
        createdAt: priceLists.createdAt
      })
      .from(priceLists)
      .innerJoin(suppliers, eq(priceLists.supplierId, suppliers.id))
      .where(and(
        gte(priceLists.createdAt, startTime),
        lte(priceLists.createdAt, endTime)
      ))
      .orderBy(desc(priceLists.createdAt))
      .limit(10);

      // Price list statistics
      const [priceListStats] = await db.select({
        totalUploads: count(),
        validatedUploads: count(sql`CASE WHEN ${priceLists.validationStatus} = 'validated' THEN 1 END`),
        failedUploads: count(sql`CASE WHEN ${priceLists.validationStatus} = 'failed' THEN 1 END`),
        totalItems: sum(priceLists.itemCount),
        avgItemsPerUpload: avg(priceLists.itemCount)
      })
      .from(priceLists)
      .where(and(
        gte(priceLists.createdAt, startTime),
        lte(priceLists.createdAt, endTime)
      ));

      // Price change events
      const priceChangeEvents = await db.select({
        count: count(),
        eventType: timeSeriesEvents.eventType
      })
      .from(timeSeriesEvents)
      .where(and(
        gte(timeSeriesEvents.timestamp, startTime),
        lte(timeSeriesEvents.timestamp, endTime),
        sql`${timeSeriesEvents.eventType} LIKE '%price%'`
      ))
      .groupBy(timeSeriesEvents.eventType);

      const totalUploads = priceListStats.totalUploads || 0;
      const validationRate = totalUploads > 0 ? 
        ((priceListStats.validatedUploads || 0) / totalUploads) * 100 : 100;

      return {
        summary: {
          totalUploads,
          validationRate: Math.round(validationRate * 100) / 100,
          failureRate: Math.round((100 - validationRate) * 100) / 100,
          totalItems: priceListStats.totalItems || 0,
          avgItemsPerUpload: Math.round(priceListStats.avgItemsPerUpload || 0)
        },
        recentUploads,
        events: priceChangeEvents
      };

    } catch (error) {
      console.error('Failed to get price list metrics:', error);
      return {
        summary: { totalUploads: 0, validationRate: 0, failureRate: 0, totalItems: 0 },
        recentUploads: [],
        events: []
      };
    }
  }

  // ==================== INVENTORY METRICS ====================

  /**
   * Get inventory-related metrics
   */
  async getInventoryMetrics(startTime, endTime) {
    try {
      // Inventory movements summary
      const [movementStats] = await db.select({
        totalMovements: count(),
        purchaseMovements: count(sql`CASE WHEN ${inventoryMovements.movementType} = 'purchase' THEN 1 END`),
        saleMovements: count(sql`CASE WHEN ${inventoryMovements.movementType} = 'sale' THEN 1 END`),
        adjustmentMovements: count(sql`CASE WHEN ${inventoryMovements.movementType} = 'adjustment' THEN 1 END`),
        totalValue: sum(inventoryMovements.totalCost)
      })
      .from(inventoryMovements)
      .where(and(
        gte(inventoryMovements.createdAt, startTime),
        lte(inventoryMovements.createdAt, endTime)
      ));

      // Stock level analysis
      const stockLevels = await db.select({
        category: products.category,
        totalProducts: count(),
        lowStockCount: count(sql`CASE WHEN ${inventory.quantityAvailable} <= ${inventory.reorderPoint} THEN 1 END`),
        adequateStockCount: count(sql`CASE WHEN ${inventory.quantityAvailable} > ${inventory.reorderPoint} AND ${inventory.quantityAvailable} < ${inventory.maxStockLevel} THEN 1 END`),
        overStockCount: count(sql`CASE WHEN ${inventory.quantityAvailable} >= ${inventory.maxStockLevel} THEN 1 END`),
        totalValue: sum(sql`${inventory.quantityOnHand} * ${inventory.averageCost}`)
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .where(eq(products.isActive, true))
      .groupBy(products.category);

      // Top movements
      const topMovements = await db.select({
        productName: products.name,
        sku: products.sku,
        movementType: inventoryMovements.movementType,
        quantity: inventoryMovements.quantity,
        totalCost: inventoryMovements.totalCost,
        createdAt: inventoryMovements.createdAt
      })
      .from(inventoryMovements)
      .innerJoin(products, eq(inventoryMovements.productId, products.id))
      .where(and(
        gte(inventoryMovements.createdAt, startTime),
        lte(inventoryMovements.createdAt, endTime)
      ))
      .orderBy(desc(inventoryMovements.totalCost))
      .limit(10);

      return {
        summary: {
          totalMovements: movementStats.totalMovements || 0,
          purchaseMovements: movementStats.purchaseMovements || 0,
          saleMovements: movementStats.saleMovements || 0,
          adjustmentMovements: movementStats.adjustmentMovements || 0,
          totalValue: Math.round((movementStats.totalValue || 0) * 100) / 100
        },
        stockLevels,
        topMovements,
        healthScore: this.calculateInventoryHealthScore(stockLevels)
      };

    } catch (error) {
      console.error('Failed to get inventory metrics:', error);
      return {
        summary: { totalMovements: 0, purchaseMovements: 0, saleMovements: 0 },
        stockLevels: [],
        topMovements: []
      };
    }
  }

  // ==================== ORDER METRICS ====================

  /**
   * Get order processing metrics
   */
  async getOrderMetrics(startTime, endTime) {
    try {
      // Customer orders
      const [customerOrderStats] = await db.select({
        totalOrders: count(),
        confirmedOrders: count(sql`CASE WHEN ${purchaseOrders.status} = 'confirmed' THEN 1 END`),
        shippedOrders: count(sql`CASE WHEN ${purchaseOrders.status} = 'shipped' THEN 1 END`),
        deliveredOrders: count(sql`CASE WHEN ${purchaseOrders.status} = 'delivered' THEN 1 END`),
        totalValue: sum(purchaseOrders.totalAmount),
        avgOrderValue: avg(purchaseOrders.totalAmount)
      })
      .from(purchaseOrders)
      .where(and(
        gte(purchaseOrders.orderDate, startTime),
        lte(purchaseOrders.orderDate, endTime)
      ));

      // Supplier purchase orders
      const [supplierPoStats] = await db.select({
        totalPos: count(),
        approvedPos: count(sql`CASE WHEN ${supplierPurchaseOrders.status} = 'approved' THEN 1 END`),
        deliveredPos: count(sql`CASE WHEN ${supplierPurchaseOrders.status} = 'delivered' THEN 1 END`),
        totalValue: sum(supplierPurchaseOrders.totalAmount),
        avgPoValue: avg(supplierPurchaseOrders.totalAmount)
      })
      .from(supplierPurchaseOrders)
      .where(and(
        gte(supplierPurchaseOrders.orderDate, startTime),
        lte(supplierPurchaseOrders.orderDate, endTime)
      ));

      // Recent orders
      const recentCustomerOrders = await db.select({
        id: purchaseOrders.id,
        orderNumber: purchaseOrders.orderNumber,
        customerName: customers.companyName,
        status: purchaseOrders.status,
        totalAmount: purchaseOrders.totalAmount,
        orderDate: purchaseOrders.orderDate
      })
      .from(purchaseOrders)
      .innerJoin(customers, eq(purchaseOrders.customerId, customers.id))
      .where(and(
        gte(purchaseOrders.orderDate, startTime),
        lte(purchaseOrders.orderDate, endTime)
      ))
      .orderBy(desc(purchaseOrders.orderDate))
      .limit(10);

      const recentSupplierPos = await db.select({
        id: supplierPurchaseOrders.id,
        poNumber: supplierPurchaseOrders.poNumber,
        supplierName: suppliers.companyName,
        status: supplierPurchaseOrders.status,
        totalAmount: supplierPurchaseOrders.totalAmount,
        orderDate: supplierPurchaseOrders.orderDate
      })
      .from(supplierPurchaseOrders)
      .innerJoin(suppliers, eq(supplierPurchaseOrders.supplierId, suppliers.id))
      .where(and(
        gte(supplierPurchaseOrders.orderDate, startTime),
        lte(supplierPurchaseOrders.orderDate, endTime)
      ))
      .orderBy(desc(supplierPurchaseOrders.orderDate))
      .limit(10);

      return {
        customerOrders: {
          total: customerOrderStats.totalOrders || 0,
          confirmed: customerOrderStats.confirmedOrders || 0,
          shipped: customerOrderStats.shippedOrders || 0,
          delivered: customerOrderStats.deliveredOrders || 0,
          totalValue: Math.round((customerOrderStats.totalValue || 0) * 100) / 100,
          avgOrderValue: Math.round((customerOrderStats.avgOrderValue || 0) * 100) / 100
        },
        supplierPurchaseOrders: {
          total: supplierPoStats.totalPos || 0,
          approved: supplierPoStats.approvedPos || 0,
          delivered: supplierPoStats.deliveredPos || 0,
          totalValue: Math.round((supplierPoStats.totalValue || 0) * 100) / 100,
          avgPoValue: Math.round((supplierPoStats.avgPoValue || 0) * 100) / 100
        },
        recent: {
          customerOrders: recentCustomerOrders,
          supplierPurchaseOrders: recentSupplierPos
        }
      };

    } catch (error) {
      console.error('Failed to get order metrics:', error);
      return {
        customerOrders: { total: 0, confirmed: 0, shipped: 0, delivered: 0 },
        supplierPurchaseOrders: { total: 0, approved: 0, delivered: 0 },
        recent: { customerOrders: [], supplierPurchaseOrders: [] }
      };
    }
  }

  // ==================== SUPPLIER METRICS ====================

  /**
   * Get supplier performance metrics
   */
  async getSupplierMetrics(startTime, endTime) {
    try {
      // Supplier performance
      const supplierPerformance = await db.select({
        id: suppliers.id,
        companyName: suppliers.companyName,
        performanceRating: suppliers.performanceRating,
        leadTimeDays: suppliers.leadTimeDays,
        totalPos: count(supplierPurchaseOrders.id),
        totalValue: sum(supplierPurchaseOrders.totalAmount),
        onTimeDeliveries: count(sql`CASE WHEN ${supplierPurchaseOrders.deliveredAt} <= ${supplierPurchaseOrders.expectedDeliveryDate} THEN 1 END`),
        lateDeliveries: count(sql`CASE WHEN ${supplierPurchaseOrders.deliveredAt} > ${supplierPurchaseOrders.expectedDeliveryDate} THEN 1 END`)
      })
      .from(suppliers)
      .leftJoin(supplierPurchaseOrders, eq(suppliers.id, supplierPurchaseOrders.supplierId))
      .where(and(
        eq(suppliers.isActive, true),
        suppliers.id.in(
          db.select({ supplierId: supplierPurchaseOrders.supplierId })
            .from(supplierPurchaseOrders)
            .where(and(
              gte(supplierPurchaseOrders.orderDate, startTime),
              lte(supplierPurchaseOrders.orderDate, endTime)
            ))
        )
      ))
      .groupBy(suppliers.id, suppliers.companyName, suppliers.performanceRating, suppliers.leadTimeDays)
      .orderBy(desc(suppliers.performanceRating))
      .limit(10);

      // Calculate on-time delivery rates
      const supplierMetrics = supplierPerformance.map(supplier => {
        const totalDeliveries = (supplier.onTimeDeliveries || 0) + (supplier.lateDeliveries || 0);
        const onTimeRate = totalDeliveries > 0 ? 
          ((supplier.onTimeDeliveries || 0) / totalDeliveries) * 100 : 0;

        return {
          ...supplier,
          onTimeDeliveryRate: Math.round(onTimeRate * 100) / 100,
          totalValue: Math.round((supplier.totalValue || 0) * 100) / 100
        };
      });

      // Overall supplier stats
      const [overallStats] = await db.select({
        totalActiveSuppliers: count(),
        avgPerformanceRating: avg(suppliers.performanceRating),
        avgLeadTime: avg(suppliers.leadTimeDays)
      })
      .from(suppliers)
      .where(eq(suppliers.isActive, true));

      return {
        summary: {
          totalActiveSuppliers: overallStats.totalActiveSuppliers || 0,
          avgPerformanceRating: Math.round((overallStats.avgPerformanceRating || 0) * 100) / 100,
          avgLeadTime: Math.round(overallStats.avgLeadTime || 0)
        },
        topPerformers: supplierMetrics.slice(0, 5),
        allSuppliers: supplierMetrics
      };

    } catch (error) {
      console.error('Failed to get supplier metrics:', error);
      return {
        summary: { totalActiveSuppliers: 0, avgPerformanceRating: 0, avgLeadTime: 0 },
        topPerformers: [],
        allSuppliers: []
      };
    }
  }

  // ==================== PERFORMANCE METRICS ====================

  /**
   * Get system performance metrics
   */
  async getPerformanceMetrics(startTime, endTime) {
    try {
      // Integration performance
      const [performanceStats] = await db.select({
        avgDuration: avg(timeSeriesEvents.duration),
        maxDuration: max(timeSeriesEvents.duration),
        minDuration: min(timeSeriesEvents.duration),
        totalEvents: count(),
        errorRate: sql`COUNT(CASE WHEN ${timeSeriesEvents.resultStatus} = 'error' THEN 1 END) * 100.0 / COUNT(*)`
      })
      .from(timeSeriesEvents)
      .where(and(
        gte(timeSeriesEvents.timestamp, startTime),
        lte(timeSeriesEvents.timestamp, endTime),
        eq(timeSeriesEvents.eventCategory, 'integration')
      ));

      // Performance by event type
      const eventTypePerformance = await db.select({
        eventType: timeSeriesEvents.eventType,
        count: count(),
        avgDuration: avg(timeSeriesEvents.duration),
        successRate: sql`COUNT(CASE WHEN ${timeSeriesEvents.resultStatus} = 'success' THEN 1 END) * 100.0 / COUNT(*)`
      })
      .from(timeSeriesEvents)
      .where(and(
        gte(timeSeriesEvents.timestamp, startTime),
        lte(timeSeriesEvents.timestamp, endTime),
        eq(timeSeriesEvents.eventCategory, 'integration')
      ))
      .groupBy(timeSeriesEvents.eventType)
      .orderBy(desc(count()));

      // System resources (if available)
      const resourceMetrics = await this.getResourceMetrics(startTime, endTime);

      return {
        overall: {
          avgResponseTime: Math.round(performanceStats.avgDuration || 0),
          maxResponseTime: Math.round(performanceStats.maxDuration || 0),
          minResponseTime: Math.round(performanceStats.minDuration || 0),
          totalEvents: performanceStats.totalEvents || 0,
          errorRate: Math.round((performanceStats.errorRate || 0) * 100) / 100,
          successRate: Math.round((100 - (performanceStats.errorRate || 0)) * 100) / 100
        },
        byEventType: eventTypePerformance.map(event => ({
          eventType: event.eventType,
          count: event.count,
          avgDuration: Math.round(event.avgDuration || 0),
          successRate: Math.round((event.successRate || 0) * 100) / 100
        })),
        resources: resourceMetrics
      };

    } catch (error) {
      console.error('Failed to get performance metrics:', error);
      return {
        overall: { avgResponseTime: 0, errorRate: 0, successRate: 100, totalEvents: 0 },
        byEventType: [],
        resources: {}
      };
    }
  }

  // ==================== ALERTS AND MONITORING ====================

  /**
   * Get active alerts and issues
   */
  async getActiveAlerts() {
    try {
      const alerts = [];

      // Check for recent failures
      const recentFailures = await db.select()
        .from(timeSeriesEvents)
        .where(and(
          eq(timeSeriesEvents.resultStatus, 'error'),
          gte(timeSeriesEvents.timestamp, new Date(Date.now() - 60 * 60 * 1000)) // Last hour
        ))
        .orderBy(desc(timeSeriesEvents.timestamp))
        .limit(10);

      if (recentFailures.length > 0) {
        alerts.push({
          type: 'integration_failures',
          severity: 'high',
          message: `${recentFailures.length} integration failures in the last hour`,
          count: recentFailures.length,
          timestamp: new Date(),
          details: recentFailures.slice(0, 3) // Show top 3
        });
      }

      // Check for low stock items
      const [lowStockCount] = await db.select({
        count: count()
      })
      .from(inventory)
      .where(sql`${inventory.quantityAvailable} <= ${inventory.reorderPoint}`);

      if (lowStockCount.count > 0) {
        alerts.push({
          type: 'low_stock',
          severity: 'medium',
          message: `${lowStockCount.count} items are at or below reorder point`,
          count: lowStockCount.count,
          timestamp: new Date()
        });
      }

      // Check for stuck purchase orders
      const stuckPos = await db.select({ count: count() })
        .from(supplierPurchaseOrders)
        .where(and(
          eq(supplierPurchaseOrders.status, 'pending'),
          lte(supplierPurchaseOrders.createdAt, new Date(Date.now() - 24 * 60 * 60 * 1000))
        ));

      if (stuckPos[0].count > 0) {
        alerts.push({
          type: 'stuck_purchase_orders',
          severity: 'medium',
          message: `${stuckPos[0].count} purchase orders pending for over 24 hours`,
          count: stuckPos[0].count,
          timestamp: new Date()
        });
      }

      return alerts;

    } catch (error) {
      console.error('Failed to get active alerts:', error);
      return [];
    }
  }

  // ==================== TREND ANALYSIS ====================

  /**
   * Get trend data for charts
   */
  async getTrendData(timeRange) {
    try {
      const timeRangeMs = this.parseTimeRange(timeRange);
      const startTime = new Date(Date.now() - timeRangeMs);
      
      // Get hourly aggregated metrics
      const hourlyMetrics = await db.select()
        .from(timeSeriesHourlyMetrics)
        .where(gte(timeSeriesHourlyMetrics.hourTimestamp, startTime))
        .orderBy(asc(timeSeriesHourlyMetrics.hourTimestamp));

      // Group by metric name
      const trendsByMetric = {};
      hourlyMetrics.forEach(metric => {
        if (!trendsByMetric[metric.metricName]) {
          trendsByMetric[metric.metricName] = [];
        }
        trendsByMetric[metric.metricName].push({
          timestamp: metric.hourTimestamp,
          value: metric.avgValue,
          count: metric.countValue
        });
      });

      return trendsByMetric;

    } catch (error) {
      console.error('Failed to get trend data:', error);
      return {};
    }
  }

  // ==================== EXPORT FUNCTIONALITY ====================

  /**
   * Export dashboard data to CSV
   */
  async exportToCsv(timeRange = '24h', sections = []) {
    const data = await this.getDashboardData(timeRange);
    
    let csvContent = 'Supply Chain Dashboard Export\n';
    csvContent += `Generated: ${data.generatedAt}\n`;
    csvContent += `Time Range: ${timeRange}\n\n`;

    // Export sections based on request
    if (sections.length === 0 || sections.includes('overview')) {
      csvContent += this.exportOverviewToCsv(data.overview);
    }
    
    if (sections.length === 0 || sections.includes('inventory')) {
      csvContent += this.exportInventoryToCsv(data.inventoryMetrics);
    }

    if (sections.length === 0 || sections.includes('orders')) {
      csvContent += this.exportOrdersToCsv(data.orderMetrics);
    }

    if (sections.length === 0 || sections.includes('suppliers')) {
      csvContent += this.exportSuppliersToCsv(data.supplierMetrics);
    }

    return csvContent;
  }

  /**
   * Export to JSON format
   */
  async exportToJson(timeRange = '24h', sections = []) {
    const data = await this.getDashboardData(timeRange);
    
    if (sections.length === 0) {
      return JSON.stringify(data, null, 2);
    }

    const exportData = { generatedAt: data.generatedAt, timeRange };
    sections.forEach(section => {
      if (data[section]) {
        exportData[section] = data[section];
      }
    });

    return JSON.stringify(exportData, null, 2);
  }

  // ==================== HELPER METHODS ====================

  /**
   * Calculate overall health score
   */
  calculateHealthScore(data) {
    const { overview, performanceMetrics, alerts } = data;
    
    let score = 100;
    
    // Deduct for failures
    if (overview.integration.failureRate > 5) {
      score -= Math.min(overview.integration.failureRate * 2, 30);
    }
    
    // Deduct for low stock
    if (overview.inventory.lowStockItems > 0) {
      score -= Math.min(overview.inventory.lowStockItems, 20);
    }
    
    // Deduct for alerts
    const criticalAlerts = alerts.filter(a => a.severity === 'critical').length;
    const highAlerts = alerts.filter(a => a.severity === 'high').length;
    
    score -= (criticalAlerts * 15) + (highAlerts * 10);
    
    return Math.max(Math.round(score), 0);
  }

  /**
   * Calculate stock health score
   */
  calculateStockHealthScore(inventorySummary) {
    const total = inventorySummary.totalProducts || 1;
    const lowStock = inventorySummary.lowStockItems || 0;
    const outOfStock = inventorySummary.outOfStockItems || 0;
    
    const healthyStock = total - lowStock - outOfStock;
    return Math.round((healthyStock / total) * 100);
  }

  /**
   * Calculate inventory health score
   */
  calculateInventoryHealthScore(stockLevels) {
    if (!stockLevels.length) return 100;
    
    const totals = stockLevels.reduce((acc, level) => ({
      total: acc.total + level.totalProducts,
      adequate: acc.adequate + level.adequateStockCount,
      low: acc.low + level.lowStockCount
    }), { total: 0, adequate: 0, low: 0 });
    
    const healthyPercentage = totals.total > 0 ? 
      ((totals.adequate + totals.total - totals.low) / totals.total) * 100 : 100;
    
    return Math.round(healthyPercentage);
  }

  /**
   * Get default overview metrics for error cases
   */
  getDefaultOverviewMetrics() {
    return {
      integration: { totalEvents: 0, successRate: 0, failureRate: 0, avgProcessingTime: 0 },
      suppliers: { activeCount: 0 },
      customers: { totalCount: 0 },
      inventory: { totalProducts: 0, totalValue: 0, lowStockItems: 0, outOfStockItems: 0 }
    };
  }

  /**
   * Get system resource metrics (placeholder)
   */
  async getResourceMetrics(startTime, endTime) {
    // This could be extended to include actual system metrics
    // like CPU usage, memory usage, database performance, etc.
    return {
      cpuUsage: 'N/A',
      memoryUsage: 'N/A',
      databaseConnections: 'N/A'
    };
  }

  /**
   * Parse time range string to milliseconds
   */
  parseTimeRange(timeRange) {
    const units = {
      'm': 60 * 1000,
      'h': 60 * 60 * 1000,
      'd': 24 * 60 * 60 * 1000
    };

    const match = timeRange.match(/^(\d+)([mhd])$/);
    if (!match) {
      return 24 * 60 * 60 * 1000; // Default to 24 hours
    }

    const [, amount, unit] = match;
    return parseInt(amount) * units[unit];
  }

  /**
   * Cache management
   */
  getCachedData(key) {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  setCachedData(key, data) {
    this.cache.set(key, {
      data,
      timestamp: Date.now()
    });
  }

  /**
   * CSV export helpers
   */
  exportOverviewToCsv(overview) {
    let csv = 'OVERVIEW METRICS\n';
    csv += 'Metric,Value\n';
    csv += `Total Events,${overview.integration.totalEvents}\n`;
    csv += `Success Rate,${overview.integration.successRate}%\n`;
    csv += `Active Suppliers,${overview.suppliers.activeCount}\n`;
    csv += `Total Customers,${overview.customers.totalCount}\n`;
    csv += `Total Products,${overview.inventory.totalProducts}\n`;
    csv += `Inventory Value,$${overview.inventory.totalValue}\n`;
    csv += `Low Stock Items,${overview.inventory.lowStockItems}\n\n`;
    return csv;
  }

  exportInventoryToCsv(inventoryMetrics) {
    let csv = 'INVENTORY METRICS\n';
    csv += 'Category,Total Products,Low Stock,Adequate Stock,Over Stock,Total Value\n';
    inventoryMetrics.stockLevels.forEach(level => {
      csv += `${level.category},${level.totalProducts},${level.lowStockCount},${level.adequateStockCount},${level.overStockCount},$${level.totalValue}\n`;
    });
    csv += '\n';
    return csv;
  }

  exportOrdersToCsv(orderMetrics) {
    let csv = 'ORDER METRICS\n';
    csv += 'Order Type,Total,Confirmed/Approved,Shipped/Delivered,Total Value,Avg Value\n';
    csv += `Customer Orders,${orderMetrics.customerOrders.total},${orderMetrics.customerOrders.confirmed},${orderMetrics.customerOrders.delivered},$${orderMetrics.customerOrders.totalValue},$${orderMetrics.customerOrders.avgOrderValue}\n`;
    csv += `Supplier POs,${orderMetrics.supplierPurchaseOrders.total},${orderMetrics.supplierPurchaseOrders.approved},${orderMetrics.supplierPurchaseOrders.delivered},$${orderMetrics.supplierPurchaseOrders.totalValue},$${orderMetrics.supplierPurchaseOrders.avgPoValue}\n\n`;
    return csv;
  }

  exportSuppliersToCsv(supplierMetrics) {
    let csv = 'SUPPLIER PERFORMANCE\n';
    csv += 'Supplier,Performance Rating,Lead Time,Total POs,Total Value,On-Time Delivery Rate\n';
    supplierMetrics.allSuppliers.forEach(supplier => {
      csv += `${supplier.companyName},${supplier.performanceRating},${supplier.leadTimeDays},${supplier.totalPos},$${supplier.totalValue},${supplier.onTimeDeliveryRate}%\n`;
    });
    csv += '\n';
    return csv;
  }
}

export const supplyChainDashboardService = new SupplyChainDashboardService();
export default supplyChainDashboardService;