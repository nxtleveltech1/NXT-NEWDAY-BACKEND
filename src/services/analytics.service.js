import { eq, and, or, desc, asc, sql, between, gte, lte, inArray } from 'drizzle-orm';
import { db } from '../config/database.js';
import { 
  analyticsDailyAggregates, 
  analyticsMonthlyAggregates, 
  timeSeriesMetrics,
  customers,
  inventory,
  inventoryMovements,
  products,
  suppliers,
  priceLists,
  priceListItems
} from '../db/schema.js';
import { analyticsCache } from '../config/redis.js';
import { evaluate } from 'mathjs';
import crypto from 'crypto';

/**
 * Analytics Service Foundation
 * Provides high-performance analytics data access with caching and correlation tracking
 */
export class AnalyticsService {
  constructor() {
    this.cache = analyticsCache;
    this.initialized = false;
    this.correlationMap = new Map(); // In-memory correlation tracking
  }

  async initialize() {
    try {
      await this.cache.init();
      this.initialized = true;
      console.log('Analytics service initialized successfully');
    } catch (error) {
      console.error('Failed to initialize analytics service:', error);
      this.initialized = false;
    }
  }

  // ==================== CORRELATION ID TRACKING ====================

  generateCorrelationId() {
    return `analytics_${Date.now()}_${crypto.randomBytes(8).toString('hex')}`;
  }

  trackQuery(correlationId, queryType, params, startTime) {
    this.correlationMap.set(correlationId, {
      queryType,
      params,
      startTime,
      timestamp: new Date()
    });
    
    // Clean up old correlation entries (keep last 1000)
    if (this.correlationMap.size > 1000) {
      const entries = Array.from(this.correlationMap.entries());
      const toDelete = entries.slice(0, entries.length - 1000);
      toDelete.forEach(([key]) => this.correlationMap.delete(key));
    }
  }

  finishQuery(correlationId, duration, resultCount) {
    const query = this.correlationMap.get(correlationId);
    if (query) {
      query.endTime = Date.now();
      query.duration = duration;
      query.resultCount = resultCount;
      query.completed = true;
    }
  }

  getQueryMetrics() {
    const completed = Array.from(this.correlationMap.values()).filter(q => q.completed);
    const avgDuration = completed.length > 0 
      ? completed.reduce((sum, q) => sum + q.duration, 0) / completed.length 
      : 0;
    
    return {
      totalQueries: this.correlationMap.size,
      completedQueries: completed.length,
      averageDuration: avgDuration,
      slowQueries: completed.filter(q => q.duration > 2000), // > 2 seconds
    };
  }

  // ==================== BASE ANALYTICS REPOSITORY ====================

  async executeWithCache(queryFn, cacheKey, ttl = 300) {
    const correlationId = this.generateCorrelationId();
    const startTime = Date.now();
    
    try {
      // Check cache first
      if (this.cache && this.initialized) {
        const cached = await this.cache.get(cacheKey);
        if (cached) {
          const duration = Date.now() - startTime;
          this.finishQuery(correlationId, duration, cached.length || 1);
          return {
            data: cached,
            fromCache: true,
            correlationId,
            duration
          };
        }
      }

      // Execute query
      const result = await queryFn();
      const duration = Date.now() - startTime;
      
      // Cache result if cache is available
      if (this.cache && this.initialized && result) {
        await this.cache.set(cacheKey, result, ttl);
      }

      this.finishQuery(correlationId, duration, Array.isArray(result) ? result.length : 1);

      return {
        data: result,
        fromCache: false,
        correlationId,
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      this.finishQuery(correlationId, duration, 0);
      throw new Error(`Analytics query failed [${correlationId}]: ${error.message}`);
    }
  }

  // ==================== SALES ANALYTICS ====================

  async getSalesMetrics(params = {}) {
    const {
      dateFrom = null,
      dateTo = null,
      dimension = 'total', // total, product, customer, warehouse
      dimensionId = null,
      aggregation = 'daily' // daily, weekly, monthly
    } = params;

    const cacheKey = `sales_metrics_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let whereConditions = [];
      
      if (dateFrom) {
        whereConditions.push(gte(analyticsDailyAggregates.date, new Date(dateFrom)));
      }
      if (dateTo) {
        whereConditions.push(lte(analyticsDailyAggregates.date, new Date(dateTo)));
      }
      if (dimension !== 'total') {
        whereConditions.push(eq(analyticsDailyAggregates.dimension, dimension));
      }
      if (dimensionId) {
        whereConditions.push(eq(analyticsDailyAggregates.dimensionId, dimensionId));
      }

      if (aggregation === 'monthly') {
        // Use monthly aggregates for better performance
        const monthlyWhere = [];
        if (dateFrom) {
          const fromDate = new Date(dateFrom);
          monthlyWhere.push(or(
            sql`${analyticsMonthlyAggregates.year} > ${fromDate.getFullYear()}`,
            and(
              eq(analyticsMonthlyAggregates.year, fromDate.getFullYear()),
              gte(analyticsMonthlyAggregates.month, fromDate.getMonth() + 1)
            )
          ));
        }
        if (dateTo) {
          const toDate = new Date(dateTo);
          monthlyWhere.push(or(
            sql`${analyticsMonthlyAggregates.year} < ${toDate.getFullYear()}`,
            and(
              eq(analyticsMonthlyAggregates.year, toDate.getFullYear()),
              lte(analyticsMonthlyAggregates.month, toDate.getMonth() + 1)
            )
          ));
        }
        if (dimension !== 'total') {
          monthlyWhere.push(eq(analyticsMonthlyAggregates.dimension, dimension));
        }
        if (dimensionId) {
          monthlyWhere.push(eq(analyticsMonthlyAggregates.dimensionId, dimensionId));
        }

        return await db
          .select({
            period: sql`${analyticsMonthlyAggregates.year} || '-' || LPAD(${analyticsMonthlyAggregates.month}::text, 2, '0')`,
            salesCount: sql`SUM(${analyticsMonthlyAggregates.salesCount})`,
            salesQuantity: sql`SUM(${analyticsMonthlyAggregates.salesQuantity})`,
            salesRevenue: sql`SUM(${analyticsMonthlyAggregates.salesRevenue})`,
            salesCost: sql`SUM(${analyticsMonthlyAggregates.salesCost})`,
            salesProfit: sql`SUM(${analyticsMonthlyAggregates.salesProfit})`,
            avgOrderValue: sql`AVG(${analyticsMonthlyAggregates.avgOrderValue})`,
            dimension: analyticsMonthlyAggregates.dimension,
            dimensionId: analyticsMonthlyAggregates.dimensionId
          })
          .from(analyticsMonthlyAggregates)
          .where(monthlyWhere.length > 0 ? and(...monthlyWhere) : undefined)
          .groupBy(
            analyticsMonthlyAggregates.year,
            analyticsMonthlyAggregates.month,
            analyticsMonthlyAggregates.dimension,
            analyticsMonthlyAggregates.dimensionId
          )
          .orderBy(analyticsMonthlyAggregates.year, analyticsMonthlyAggregates.month);
      }

      // Daily aggregation
      return await db
        .select({
          date: analyticsDailyAggregates.date,
          salesCount: analyticsDailyAggregates.salesCount,
          salesQuantity: analyticsDailyAggregates.salesQuantity,
          salesRevenue: analyticsDailyAggregates.salesRevenue,
          salesCost: analyticsDailyAggregates.salesCost,
          salesProfit: analyticsDailyAggregates.salesProfit,
          avgOrderValue: analyticsDailyAggregates.avgOrderValue,
          avgUnitPrice: analyticsDailyAggregates.avgUnitPrice,
          dimension: analyticsDailyAggregates.dimension,
          dimensionId: analyticsDailyAggregates.dimensionId
        })
        .from(analyticsDailyAggregates)
        .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
        .orderBy(analyticsDailyAggregates.date);
    }, cacheKey, 300); // 5 minute cache
  }

  // ==================== INVENTORY ANALYTICS ====================

  async getInventoryMetrics(params = {}) {
    const {
      warehouseIds = null,
      productIds = null,
      categoryFilter = null,
      lowStockOnly = false
    } = params;

    const cacheKey = `inventory_metrics_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let whereConditions = [];
      
      if (warehouseIds && Array.isArray(warehouseIds)) {
        whereConditions.push(inArray(inventory.warehouseId, warehouseIds));
      }
      if (productIds && Array.isArray(productIds)) {
        whereConditions.push(inArray(inventory.productId, productIds));
      }
      if (categoryFilter) {
        whereConditions.push(eq(products.category, categoryFilter));
      }
      if (lowStockOnly) {
        whereConditions.push(
          sql`${inventory.quantityOnHand} <= COALESCE(${inventory.reorderPoint}, 0)`
        );
      }

      const result = await db
        .select({
          productId: inventory.productId,
          productSku: products.sku,
          productName: products.name,
          category: products.category,
          warehouseId: inventory.warehouseId,
          quantityOnHand: inventory.quantityOnHand,
          quantityAvailable: inventory.quantityAvailable,
          quantityReserved: inventory.quantityReserved,
          reorderPoint: inventory.reorderPoint,
          reorderQuantity: inventory.reorderQuantity,
          averageCost: inventory.averageCost,
          totalValue: sql`${inventory.quantityOnHand} * ${inventory.averageCost}`,
          stockStatus: inventory.stockStatus,
          lastMovement: inventory.lastMovement,
          turnoverRate: sql`
            CASE 
              WHEN ${inventory.quantityOnHand} > 0 
              THEN (
                SELECT COALESCE(SUM(ABS(quantity)), 0) 
                FROM inventory_movements 
                WHERE inventory_id = ${inventory.id} 
                AND movement_type = 'sale'
                AND created_at >= NOW() - INTERVAL '30 days'
              ) / ${inventory.quantityOnHand}
              ELSE 0 
            END
          `
        })
        .from(inventory)
        .innerJoin(products, eq(inventory.productId, products.id))
        .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
        .orderBy(desc(sql`${inventory.quantityOnHand} * ${inventory.averageCost}`));

      return result;
    }, cacheKey, 180); // 3 minute cache for inventory
  }

  // ==================== CUSTOMER ANALYTICS ====================

  async getCustomerAnalytics(params = {}) {
    const {
      customerId = null,
      dateFrom = null,
      dateTo = null,
      includeDetails = false
    } = params;

    const cacheKey = `customer_analytics_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let whereConditions = [eq(inventoryMovements.movementType, 'sale')];
      
      if (customerId) {
        whereConditions.push(eq(inventoryMovements.referenceId, customerId));
      }
      if (dateFrom) {
        whereConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        whereConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));
      }

      const baseQuery = db
        .select({
          customerId: inventoryMovements.referenceId,
          customerCode: customers.customerCode,
          customerName: customers.companyName,
          totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
          totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          avgOrderValue: sql`AVG(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          firstOrder: sql`MIN(${inventoryMovements.createdAt})`,
          lastOrder: sql`MAX(${inventoryMovements.createdAt})`,
          uniqueProducts: sql`COUNT(DISTINCT ${inventoryMovements.productId})`,
          avgDaysBetweenOrders: sql`
            AVG(EXTRACT(days FROM ${inventoryMovements.createdAt} - 
              LAG(${inventoryMovements.createdAt}) 
              OVER (PARTITION BY ${inventoryMovements.referenceId} ORDER BY ${inventoryMovements.createdAt})
            ))
          `
        })
        .from(inventoryMovements)
        .innerJoin(customers, eq(inventoryMovements.referenceId, customers.id))
        .where(and(...whereConditions))
        .groupBy(inventoryMovements.referenceId, customers.customerCode, customers.companyName)
        .orderBy(desc(sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`));

      const result = await baseQuery;

      if (includeDetails && customerId) {
        // Get detailed product breakdown for specific customer
        const productDetails = await db
          .select({
            productId: products.id,
            productSku: products.sku,
            productName: products.name,
            category: products.category,
            totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
            totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
            orderCount: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
            avgQuantityPerOrder: sql`AVG(ABS(${inventoryMovements.quantity}))`,
            lastPurchase: sql`MAX(${inventoryMovements.createdAt})`
          })
          .from(inventoryMovements)
          .innerJoin(products, eq(inventoryMovements.productId, products.id))
          .where(and(
            eq(inventoryMovements.referenceId, customerId),
            eq(inventoryMovements.movementType, 'sale'),
            ...(dateFrom ? [gte(inventoryMovements.createdAt, new Date(dateFrom))] : []),
            ...(dateTo ? [lte(inventoryMovements.createdAt, new Date(dateTo))] : [])
          ))
          .groupBy(products.id, products.sku, products.name, products.category)
          .orderBy(desc(sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`));

        return {
          summary: result[0] || null,
          productBreakdown: productDetails
        };
      }

      return result;
    }, cacheKey, 240); // 4 minute cache
  }

  // ==================== CUSTOMER BEHAVIOR TRACKING ====================

  /**
   * Analyzes purchase frequency patterns for customers
   * @param {Object} params - Analysis parameters
   * @param {string} params.customerId - Specific customer ID (optional)
   * @param {string} params.dateFrom - Start date for analysis
   * @param {string} params.dateTo - End date for analysis 
   * @param {string} params.period - Analysis period: 'daily', 'weekly', 'monthly'
   * @param {number} params.limit - Limit results (default 100)
   * @returns {Object} Purchase frequency analysis data
   */
  async analyzePurchaseFrequency(params = {}) {
    const {
      customerId = null,
      dateFrom = null,
      dateTo = null,
      period = 'weekly',
      limit = 100
    } = params;

    const cacheKey = `purchase_frequency_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let whereConditions = [eq(inventoryMovements.movementType, 'sale')];
      
      if (customerId) {
        whereConditions.push(eq(inventoryMovements.referenceId, customerId));
      }
      if (dateFrom) {
        whereConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        whereConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));
      }

      // Determine date grouping based on period
      let dateGrouping;
      switch (period) {
        case 'daily':
          dateGrouping = sql`DATE(${inventoryMovements.createdAt})`;
          break;
        case 'weekly':
          dateGrouping = sql`DATE_TRUNC('week', ${inventoryMovements.createdAt})`;
          break;
        case 'monthly':
          dateGrouping = sql`DATE_TRUNC('month', ${inventoryMovements.createdAt})`;
          break;
        default:
          dateGrouping = sql`DATE_TRUNC('week', ${inventoryMovements.createdAt})`;
      }

      const result = await db
        .select({
          customerId: inventoryMovements.referenceId,
          customerCode: customers.customerCode,
          customerName: customers.companyName,
          period: dateGrouping,
          orderCount: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          avgOrderValue: sql`AVG(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          uniqueProducts: sql`COUNT(DISTINCT ${inventoryMovements.productId})`,
          totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
          // Frequency metrics
          daysSinceLastOrder: sql`
            EXTRACT(days FROM NOW() - MAX(${inventoryMovements.createdAt}))
          `,
          purchaseFrequencyScore: sql`
            CASE 
              WHEN COUNT(DISTINCT ${inventoryMovements.referenceNumber}) >= 4 THEN 'High'
              WHEN COUNT(DISTINCT ${inventoryMovements.referenceNumber}) >= 2 THEN 'Medium'
              ELSE 'Low'
            END
          `
        })
        .from(inventoryMovements)
        .innerJoin(customers, eq(inventoryMovements.referenceId, customers.id))
        .where(and(...whereConditions))
        .groupBy(
          inventoryMovements.referenceId,
          customers.customerCode,
          customers.companyName,
          dateGrouping
        )
        .orderBy(desc(sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`))
        .limit(limit);

      // Calculate overall frequency statistics
      const frequencyStats = await db
        .select({
          totalCustomers: sql`COUNT(DISTINCT ${inventoryMovements.referenceId})`,
          avgOrdersPerCustomer: sql`
            AVG(customer_orders.order_count)
          `,
          medianDaysBetweenOrders: sql`
            PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY customer_orders.avg_days_between)
          `,
          highFrequencyCustomers: sql`
            COUNT(CASE WHEN customer_orders.order_count >= 4 THEN 1 END)
          `,
          lowFrequencyCustomers: sql`
            COUNT(CASE WHEN customer_orders.order_count = 1 THEN 1 END)
          `
        })
        .from(
          sql`(
            SELECT 
              ${inventoryMovements.referenceId} as customer_id,
              COUNT(DISTINCT ${inventoryMovements.referenceNumber}) as order_count,
              AVG(EXTRACT(days FROM ${inventoryMovements.createdAt} - 
                LAG(${inventoryMovements.createdAt}) 
                OVER (PARTITION BY ${inventoryMovements.referenceId} ORDER BY ${inventoryMovements.createdAt})
              )) as avg_days_between
            FROM ${inventoryMovements}
            WHERE ${inventoryMovements.movementType} = 'sale'
            ${dateFrom ? sql`AND ${inventoryMovements.createdAt} >= ${new Date(dateFrom)}` : sql``}
            ${dateTo ? sql`AND ${inventoryMovements.createdAt} <= ${new Date(dateTo)}` : sql``}
            GROUP BY ${inventoryMovements.referenceId}
          ) as customer_orders`
        );

      return {
        purchasePatterns: result,
        frequencyStatistics: frequencyStats[0] || {},
        period,
        dateRange: { from: dateFrom, to: dateTo }
      };
    }, cacheKey, 300); // 5 minute cache
  }

  /**
   * Calculates average order value (AOV) metrics for customers
   * @param {Object} params - Calculation parameters
   * @param {string} params.customerId - Specific customer ID (optional)
   * @param {string} params.dateFrom - Start date for calculation
   * @param {string} params.dateTo - End date for calculation
   * @param {string} params.groupBy - Group by: 'customer', 'category', 'month'
   * @param {number} params.limit - Limit results (default 50)
   * @returns {Object} AOV analysis data
   */
  async calculateAverageOrderValue(params = {}) {
    const {
      customerId = null,
      dateFrom = null,
      dateTo = null,
      groupBy = 'customer',
      limit = 50
    } = params;

    const cacheKey = `aov_analysis_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let whereConditions = [eq(inventoryMovements.movementType, 'sale')];
      
      if (customerId) {
        whereConditions.push(eq(inventoryMovements.referenceId, customerId));
      }
      if (dateFrom) {
        whereConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        whereConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));
      }

      let groupByClause = [];
      let selectFields = {
        orderCount: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
        totalRevenue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
        avgOrderValue: sql`
          SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}) / 
          COUNT(DISTINCT ${inventoryMovements.referenceNumber})
        `,
        medianOrderValue: sql`
          PERCENTILE_CONT(0.5) WITHIN GROUP (
            ORDER BY order_values.order_value
          )
        `,
        minOrderValue: sql`MIN(order_values.order_value)`,
        maxOrderValue: sql`MAX(order_values.order_value)`,
        standardDeviation: sql`STDDEV(order_values.order_value)`
      };

      // Add grouping fields based on groupBy parameter
      switch (groupBy) {
        case 'customer':
          selectFields.customerId = inventoryMovements.referenceId;
          selectFields.customerCode = customers.customerCode;
          selectFields.customerName = customers.companyName;
          groupByClause = [
            inventoryMovements.referenceId,
            customers.customerCode,
            customers.companyName
          ];
          break;
        case 'category':
          selectFields.category = products.category;
          groupByClause = [products.category];
          break;
        case 'month':
          selectFields.month = sql`DATE_TRUNC('month', ${inventoryMovements.createdAt})`;
          groupByClause = [sql`DATE_TRUNC('month', ${inventoryMovements.createdAt})`];
          break;
        default:
          selectFields.customerId = inventoryMovements.referenceId;
          selectFields.customerCode = customers.customerCode;
          selectFields.customerName = customers.companyName;
          groupByClause = [
            inventoryMovements.referenceId,
            customers.customerCode,
            customers.companyName
          ];
      }

      // First get order values for median calculation
      const orderValuesSubquery = sql`(
        SELECT 
          ${inventoryMovements.referenceNumber} as order_ref,
          SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}) as order_value
        FROM ${inventoryMovements}
        ${groupBy === 'category' ? sql`INNER JOIN ${products} ON ${inventoryMovements.productId} = ${products.id}` : sql``}
        WHERE ${sql.join(whereConditions, sql` AND `)}
        GROUP BY ${inventoryMovements.referenceNumber}
      ) as order_values`;

      let baseQuery = db
        .select(selectFields)
        .from(inventoryMovements);

      if (groupBy === 'customer') {
        baseQuery = baseQuery.innerJoin(customers, eq(inventoryMovements.referenceId, customers.id));
      }
      if (groupBy === 'category') {
        baseQuery = baseQuery.innerJoin(products, eq(inventoryMovements.productId, products.id));
      }

      // Add order values subquery for median calculation
      baseQuery = baseQuery
        .innerJoin(orderValuesSubquery, sql`TRUE`)
        .where(and(...whereConditions))
        .groupBy(...groupByClause)
        .orderBy(desc(sql`
          SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}) / 
          COUNT(DISTINCT ${inventoryMovements.referenceNumber})
        `))
        .limit(limit);

      const result = await baseQuery;

      // Calculate overall AOV statistics
      const overallStats = await db
        .select({
          totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          totalRevenue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          overallAOV: sql`
            SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}) / 
            COUNT(DISTINCT ${inventoryMovements.referenceNumber})
          `,
          highValueOrders: sql`
            COUNT(CASE WHEN order_totals.order_value > (
              SELECT AVG(order_value) * 2 FROM (
                SELECT SUM(ABS(quantity) * unit_cost) as order_value
                FROM inventory_movements 
                WHERE movement_type = 'sale'
                GROUP BY reference_number
              ) avg_calc
            ) THEN 1 END)
          `,
          lowValueOrders: sql`
            COUNT(CASE WHEN order_totals.order_value < (
              SELECT AVG(order_value) * 0.5 FROM (
                SELECT SUM(ABS(quantity) * unit_cost) as order_value
                FROM inventory_movements 
                WHERE movement_type = 'sale'
                GROUP BY reference_number
              ) avg_calc
            ) THEN 1 END)
          `
        })
        .from(sql`(
          SELECT 
            reference_number,
            SUM(ABS(quantity) * unit_cost) as order_value
          FROM inventory_movements
          WHERE movement_type = 'sale'
          ${dateFrom ? sql`AND created_at >= ${new Date(dateFrom)}` : sql``}
          ${dateTo ? sql`AND created_at <= ${new Date(dateTo)}` : sql``}
          GROUP BY reference_number
        ) as order_totals`);

      return {
        aovAnalysis: result,
        overallStatistics: overallStats[0] || {},
        groupBy,
        dateRange: { from: dateFrom, to: dateTo }
      };
    }, cacheKey, 300); // 5 minute cache
  }

  /**
   * Computes Customer Lifetime Value (CLV) using historical purchase data
   * @param {Object} params - CLV calculation parameters
   * @param {string} params.customerId - Specific customer ID (optional)
   * @param {string} params.dateFrom - Start date for historical data
   * @param {string} params.dateTo - End date for historical data
   * @param {number} params.projectionMonths - Months to project CLV (default 12)
   * @param {number} params.limit - Limit results (default 100)
   * @returns {Object} CLV analysis data
   */
  async calculateCustomerLifetimeValue(params = {}) {
    const {
      customerId = null,
      dateFrom = null,
      dateTo = null,
      projectionMonths = 12,
      limit = 100
    } = params;

    const cacheKey = `clv_analysis_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let whereConditions = [eq(inventoryMovements.movementType, 'sale')];
      
      if (customerId) {
        whereConditions.push(eq(inventoryMovements.referenceId, customerId));
      }
      if (dateFrom) {
        whereConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        whereConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));
      }

      const result = await db
        .select({
          customerId: inventoryMovements.referenceId,
          customerCode: customers.customerCode,
          customerName: customers.companyName,
          customerCreatedAt: customers.createdAt,
          
          // Historical metrics
          totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          totalRevenue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          avgOrderValue: sql`
            SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}) / 
            COUNT(DISTINCT ${inventoryMovements.referenceNumber})
          `,
          firstOrderDate: sql`MIN(${inventoryMovements.createdAt})`,
          lastOrderDate: sql`MAX(${inventoryMovements.createdAt})`,
          
          // Frequency metrics
          customerLifespanDays: sql`
            EXTRACT(days FROM MAX(${inventoryMovements.createdAt}) - MIN(${inventoryMovements.createdAt})) + 1
          `,
          avgDaysBetweenOrders: sql`
            AVG(EXTRACT(days FROM ${inventoryMovements.createdAt} - 
              LAG(${inventoryMovements.createdAt}) 
              OVER (PARTITION BY ${inventoryMovements.referenceId} ORDER BY ${inventoryMovements.createdAt})
            ))
          `,
          orderFrequencyPerMonth: sql`
            COUNT(DISTINCT ${inventoryMovements.referenceNumber}) / 
            GREATEST(
              EXTRACT(days FROM MAX(${inventoryMovements.createdAt}) - MIN(${inventoryMovements.createdAt})) / 30.0,
              1
            )
          `,
          
          // CLV components
          monthlyPurchaseRate: sql`
            COUNT(DISTINCT ${inventoryMovements.referenceNumber}) / 
            GREATEST(
              EXTRACT(days FROM NOW() - MIN(${inventoryMovements.createdAt})) / 30.0,
              1
            )
          `,
          recentActivityScore: sql`
            CASE 
              WHEN MAX(${inventoryMovements.createdAt}) >= NOW() - INTERVAL '30 days' THEN 1.0
              WHEN MAX(${inventoryMovements.createdAt}) >= NOW() - INTERVAL '90 days' THEN 0.7
              WHEN MAX(${inventoryMovements.createdAt}) >= NOW() - INTERVAL '180 days' THEN 0.4
              ELSE 0.1
            END
          `,
          
          // Projected CLV (simple model: AOV * Purchase Frequency * Projection Period * Retention Score)
          projectedCLV: sql`
            (SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}) / 
             COUNT(DISTINCT ${inventoryMovements.referenceNumber})) *
            (COUNT(DISTINCT ${inventoryMovements.referenceNumber}) / 
             GREATEST(
               EXTRACT(days FROM NOW() - MIN(${inventoryMovements.createdAt})) / 30.0,
               1
             )) *
            ${projectionMonths} *
            CASE 
              WHEN MAX(${inventoryMovements.createdAt}) >= NOW() - INTERVAL '30 days' THEN 1.0
              WHEN MAX(${inventoryMovements.createdAt}) >= NOW() - INTERVAL '90 days' THEN 0.7
              WHEN MAX(${inventoryMovements.createdAt}) >= NOW() - INTERVAL '180 days' THEN 0.4
              ELSE 0.1
            END
          `,
          
          // Value segments
          valueSegment: sql`
            CASE 
              WHEN SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}) > (
                SELECT PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY customer_totals.total_value)
                FROM (
                  SELECT SUM(ABS(quantity) * unit_cost) as total_value
                  FROM inventory_movements 
                  WHERE movement_type = 'sale'
                  GROUP BY reference_id
                ) customer_totals
              ) THEN 'High Value'
              WHEN SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}) > (
                SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY customer_totals.total_value)
                FROM (
                  SELECT SUM(ABS(quantity) * unit_cost) as total_value
                  FROM inventory_movements 
                  WHERE movement_type = 'sale'
                  GROUP BY reference_id
                ) customer_totals
              ) THEN 'Medium Value'
              ELSE 'Low Value'
            END
          `
        })
        .from(inventoryMovements)
        .innerJoin(customers, eq(inventoryMovements.referenceId, customers.id))
        .where(and(...whereConditions))
        .groupBy(
          inventoryMovements.referenceId,
          customers.customerCode,
          customers.companyName,
          customers.createdAt
        )
        .orderBy(desc(sql`
          (SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}) / 
           COUNT(DISTINCT ${inventoryMovements.referenceNumber})) *
          (COUNT(DISTINCT ${inventoryMovements.referenceNumber}) / 
           GREATEST(
             EXTRACT(days FROM NOW() - MIN(${inventoryMovements.createdAt})) / 30.0,
             1
           )) *
          ${projectionMonths} *
          CASE 
            WHEN MAX(${inventoryMovements.createdAt}) >= NOW() - INTERVAL '30 days' THEN 1.0
            WHEN MAX(${inventoryMovements.createdAt}) >= NOW() - INTERVAL '90 days' THEN 0.7
            WHEN MAX(${inventoryMovements.createdAt}) >= NOW() - INTERVAL '180 days' THEN 0.4
            ELSE 0.1
          END
        `))
        .limit(limit);

      // Calculate CLV distribution statistics
      const clvStats = await db
        .select({
          totalCustomers: sql`COUNT(*)`,
          avgCLV: sql`AVG(clv_data.projected_clv)`,
          medianCLV: sql`PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY clv_data.projected_clv)`,
          topPercentileCLV: sql`PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY clv_data.projected_clv)`,
          totalProjectedValue: sql`SUM(clv_data.projected_clv)`,
          highValueCustomers: sql`COUNT(CASE WHEN clv_data.value_segment = 'High Value' THEN 1 END)`,
          mediumValueCustomers: sql`COUNT(CASE WHEN clv_data.value_segment = 'Medium Value' THEN 1 END)`,
          lowValueCustomers: sql`COUNT(CASE WHEN clv_data.value_segment = 'Low Value' THEN 1 END)`
        })
        .from(sql`(
          SELECT 
            reference_id,
            (SUM(ABS(quantity) * unit_cost) / COUNT(DISTINCT reference_number)) *
            (COUNT(DISTINCT reference_number) / 
             GREATEST(EXTRACT(days FROM NOW() - MIN(created_at)) / 30.0, 1)) *
            ${projectionMonths} *
            CASE 
              WHEN MAX(created_at) >= NOW() - INTERVAL '30 days' THEN 1.0
              WHEN MAX(created_at) >= NOW() - INTERVAL '90 days' THEN 0.7
              WHEN MAX(created_at) >= NOW() - INTERVAL '180 days' THEN 0.4
              ELSE 0.1
            END as projected_clv,
            CASE 
              WHEN SUM(ABS(quantity) * unit_cost) > (
                SELECT PERCENTILE_CONT(0.8) WITHIN GROUP (ORDER BY customer_totals.total_value)
                FROM (
                  SELECT SUM(ABS(quantity) * unit_cost) as total_value
                  FROM inventory_movements 
                  WHERE movement_type = 'sale'
                  GROUP BY reference_id
                ) customer_totals
              ) THEN 'High Value'
              WHEN SUM(ABS(quantity) * unit_cost) > (
                SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY customer_totals.total_value)
                FROM (
                  SELECT SUM(ABS(quantity) * unit_cost) as total_value
                  FROM inventory_movements 
                  WHERE movement_type = 'sale'
                  GROUP BY reference_id
                ) customer_totals
              ) THEN 'Medium Value'
              ELSE 'Low Value'
            END as value_segment
          FROM inventory_movements
          WHERE movement_type = 'sale'
          ${dateFrom ? sql`AND created_at >= ${new Date(dateFrom)}` : sql``}
          ${dateTo ? sql`AND created_at <= ${new Date(dateTo)}` : sql``}
          GROUP BY reference_id
        ) as clv_data`);

      return {
        customerCLV: result,
        clvStatistics: clvStats[0] || {},
        projectionMonths,
        dateRange: { from: dateFrom, to: dateTo }
      };
    }, cacheKey, 600); // 10 minute cache for CLV
  }

  /**
   * Creates churn prediction indicators based on customer purchase patterns
   * @param {Object} params - Churn analysis parameters
   * @param {string} params.customerId - Specific customer ID (optional)
   * @param {number} params.inactiveDays - Days of inactivity to consider (default 60)
   * @param {number} params.churnThresholdDays - Days threshold for churn risk (default 90)
   * @param {number} params.limit - Limit results (default 100)
   * @returns {Object} Churn prediction analysis data
   */
  async analyzeChurnRisk(params = {}) {
    const {
      customerId = null,
      inactiveDays = 60,
      churnThresholdDays = 90,
      limit = 100
    } = params;

    const cacheKey = `churn_risk_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let whereConditions = [eq(inventoryMovements.movementType, 'sale')];
      
      if (customerId) {
        whereConditions.push(eq(inventoryMovements.referenceId, customerId));
      }

      const result = await db
        .select({
          customerId: inventoryMovements.referenceId,
          customerCode: customers.customerCode,
          customerName: customers.companyName,
          customerCreatedAt: customers.createdAt,
          
          // Purchase behavior metrics
          totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          totalRevenue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          avgOrderValue: sql`
            SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}) / 
            COUNT(DISTINCT ${inventoryMovements.referenceNumber})
          `,
          
          // Recency metrics
          daysSinceLastOrder: sql`
            EXTRACT(days FROM NOW() - MAX(${inventoryMovements.createdAt}))
          `,
          firstOrderDate: sql`MIN(${inventoryMovements.createdAt})`,
          lastOrderDate: sql`MAX(${inventoryMovements.createdAt})`,
          customerLifespanDays: sql`
            EXTRACT(days FROM NOW() - MIN(${inventoryMovements.createdAt}))
          `,
          
          // Frequency patterns
          avgDaysBetweenOrders: sql`
            AVG(EXTRACT(days FROM ${inventoryMovements.createdAt} - 
              LAG(${inventoryMovements.createdAt}) 
              OVER (PARTITION BY ${inventoryMovements.referenceId} ORDER BY ${inventoryMovements.createdAt})
            ))
          `,
          orderFrequencyPerMonth: sql`
            COUNT(DISTINCT ${inventoryMovements.referenceNumber}) / 
            GREATEST(
              EXTRACT(days FROM NOW() - MIN(${inventoryMovements.createdAt})) / 30.0,
              1
            )
          `,
          
          // Trend indicators
          ordersLast30Days: sql`
            COUNT(CASE WHEN ${inventoryMovements.createdAt} >= NOW() - INTERVAL '30 days' 
                  THEN DISTINCT ${inventoryMovements.referenceNumber} END)
          `,
          ordersLast90Days: sql`
            COUNT(CASE WHEN ${inventoryMovements.createdAt} >= NOW() - INTERVAL '90 days' 
                  THEN DISTINCT ${inventoryMovements.referenceNumber} END)
          `,
          revenueLast30Days: sql`
            SUM(CASE WHEN ${inventoryMovements.createdAt} >= NOW() - INTERVAL '30 days' 
                THEN ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost} ELSE 0 END)
          `,
          revenueLast90Days: sql`
            SUM(CASE WHEN ${inventoryMovements.createdAt} >= NOW() - INTERVAL '90 days' 
                THEN ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost} ELSE 0 END)
          `,
          
          // Churn risk indicators
          churnRiskScore: sql`
            CASE 
              -- High Risk: No orders in churn threshold period
              WHEN MAX(${inventoryMovements.createdAt}) < NOW() - INTERVAL '${churnThresholdDays} days' THEN 0.9
              -- Medium-High Risk: No orders in inactive period but within churn threshold
              WHEN MAX(${inventoryMovements.createdAt}) < NOW() - INTERVAL '${inactiveDays} days' THEN 0.7
              -- Medium Risk: Declining frequency pattern
              WHEN AVG(EXTRACT(days FROM ${inventoryMovements.createdAt} - 
                LAG(${inventoryMovements.createdAt}) 
                OVER (PARTITION BY ${inventoryMovements.referenceId} ORDER BY ${inventoryMovements.createdAt})
              )) > 60 THEN 0.5
              -- Low Risk: Regular recent activity
              WHEN COUNT(CASE WHEN ${inventoryMovements.createdAt} >= NOW() - INTERVAL '30 days' 
                         THEN DISTINCT ${inventoryMovements.referenceNumber} END) > 0 THEN 0.2
              ELSE 0.4
            END
          `,
          
          churnRiskCategory: sql`
            CASE 
              WHEN MAX(${inventoryMovements.createdAt}) < NOW() - INTERVAL '${churnThresholdDays} days' THEN 'High Risk'
              WHEN MAX(${inventoryMovements.createdAt}) < NOW() - INTERVAL '${inactiveDays} days' THEN 'Medium Risk'
              WHEN AVG(EXTRACT(days FROM ${inventoryMovements.createdAt} - 
                LAG(${inventoryMovements.createdAt}) 
                OVER (PARTITION BY ${inventoryMovements.referenceId} ORDER BY ${inventoryMovements.createdAt})
              )) > 60 THEN 'Medium Risk'
              WHEN COUNT(CASE WHEN ${inventoryMovements.createdAt} >= NOW() - INTERVAL '30 days' 
                         THEN DISTINCT ${inventoryMovements.referenceNumber} END) > 0 THEN 'Low Risk'
              ELSE 'Medium Risk'
            END
          `,
          
          // Engagement indicators
          productDiversityScore: sql`COUNT(DISTINCT ${inventoryMovements.productId})`,
          reorderProbability: sql`
            CASE 
              WHEN COUNT(DISTINCT ${inventoryMovements.productId}) > 
                   COUNT(DISTINCT ${inventoryMovements.referenceNumber}) * 0.8 THEN 'High'
              WHEN COUNT(DISTINCT ${inventoryMovements.productId}) > 
                   COUNT(DISTINCT ${inventoryMovements.referenceNumber}) * 0.5 THEN 'Medium'
              ELSE 'Low'
            END
          `
        })
        .from(inventoryMovements)
        .innerJoin(customers, eq(inventoryMovements.referenceId, customers.id))
        .where(and(...whereConditions))
        .groupBy(
          inventoryMovements.referenceId,
          customers.customerCode,
          customers.companyName,
          customers.createdAt
        )
        .orderBy(desc(sql`
          CASE 
            WHEN MAX(${inventoryMovements.createdAt}) < NOW() - INTERVAL '${churnThresholdDays} days' THEN 0.9
            WHEN MAX(${inventoryMovements.createdAt}) < NOW() - INTERVAL '${inactiveDays} days' THEN 0.7
            WHEN AVG(EXTRACT(days FROM ${inventoryMovements.createdAt} - 
              LAG(${inventoryMovements.createdAt}) 
              OVER (PARTITION BY ${inventoryMovements.referenceId} ORDER BY ${inventoryMovements.createdAt})
            )) > 60 THEN 0.5
            WHEN COUNT(CASE WHEN ${inventoryMovements.createdAt} >= NOW() - INTERVAL '30 days' 
                       THEN DISTINCT ${inventoryMovements.referenceNumber} END) > 0 THEN 0.2
            ELSE 0.4
          END
        `))
        .limit(limit);

      // Calculate churn risk distribution
      const churnStats = await db
        .select({
          totalCustomers: sql`COUNT(DISTINCT ${inventoryMovements.referenceId})`,
          highRiskCustomers: sql`
            COUNT(CASE WHEN MAX(${inventoryMovements.createdAt}) < NOW() - INTERVAL '${churnThresholdDays} days' 
                  THEN DISTINCT ${inventoryMovements.referenceId} END)
          `,
          mediumRiskCustomers: sql`
            COUNT(CASE WHEN MAX(${inventoryMovements.createdAt}) < NOW() - INTERVAL '${inactiveDays} days' 
                  AND MAX(${inventoryMovements.createdAt}) >= NOW() - INTERVAL '${churnThresholdDays} days'
                  THEN DISTINCT ${inventoryMovements.referenceId} END)
          `,
          lowRiskCustomers: sql`
            COUNT(CASE WHEN MAX(${inventoryMovements.createdAt}) >= NOW() - INTERVAL '${inactiveDays} days'
                  THEN DISTINCT ${inventoryMovements.referenceId} END)
          `,
          avgDaysSinceLastOrder: sql`
            AVG(EXTRACT(days FROM NOW() - MAX(${inventoryMovements.createdAt})))
          `,
          customersAtRisk: sql`
            COUNT(CASE WHEN MAX(${inventoryMovements.createdAt}) < NOW() - INTERVAL '${inactiveDays} days' 
                  THEN DISTINCT ${inventoryMovements.referenceId} END)
          `,
          potentialChurnedRevenue: sql`
            SUM(CASE WHEN MAX(${inventoryMovements.createdAt}) < NOW() - INTERVAL '${churnThresholdDays} days' 
                THEN customer_revenue.total_revenue ELSE 0 END)
          `
        })
        .from(inventoryMovements)
        .innerJoin(sql`(
          SELECT 
            reference_id,
            SUM(ABS(quantity) * unit_cost) as total_revenue
          FROM inventory_movements
          WHERE movement_type = 'sale'
          GROUP BY reference_id
        ) as customer_revenue`, sql`${inventoryMovements.referenceId} = customer_revenue.reference_id`)
        .where(eq(inventoryMovements.movementType, 'sale'))
        .groupBy();

      return {
        churnRiskAnalysis: result,
        churnStatistics: churnStats[0] || {},
        parameters: {
          inactiveDays,
          churnThresholdDays,
          analysisDate: new Date().toISOString()
        }
      };
    }, cacheKey, 300); // 5 minute cache
  }

  // ==================== PERFORMANCE ANALYTICS ====================

  async getPerformanceMetrics(params = {}) {
    const {
      metricTypes = ['sales_velocity', 'inventory_turnover', 'customer_acquisition'],
      dateFrom = null,
      dateTo = null
    } = params;

    const cacheKey = `performance_metrics_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      const metrics = {};

      // Sales velocity
      if (metricTypes.includes('sales_velocity')) {
        let salesConditions = [eq(inventoryMovements.movementType, 'sale')];
        if (dateFrom) salesConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
        if (dateTo) salesConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));

        metrics.salesVelocity = await db
          .select({
            totalSales: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
            totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
            orderCount: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
            avgOrderValue: sql`AVG(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
            dailyAverage: sql`
              SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}) / 
              GREATEST(EXTRACT(days FROM NOW() - MIN(${inventoryMovements.createdAt})), 1)
            `
          })
          .from(inventoryMovements)
          .where(and(...salesConditions));
      }

      // Inventory turnover
      if (metricTypes.includes('inventory_turnover')) {
        metrics.inventoryTurnover = await db
          .select({
            productId: products.id,
            productSku: products.sku,
            productName: products.name,
            currentStock: inventory.quantityOnHand,
            averageCost: inventory.averageCost,
            soldLast30Days: sql`
              COALESCE((
                SELECT SUM(ABS(quantity)) 
                FROM inventory_movements 
                WHERE product_id = ${products.id} 
                AND movement_type = 'sale'
                AND created_at >= NOW() - INTERVAL '30 days'
              ), 0)
            `,
            turnoverRate: sql`
              CASE 
                WHEN ${inventory.quantityOnHand} > 0 
                THEN COALESCE((
                  SELECT SUM(ABS(quantity)) 
                  FROM inventory_movements 
                  WHERE product_id = ${products.id} 
                  AND movement_type = 'sale'
                  AND created_at >= NOW() - INTERVAL '30 days'
                ), 0) / ${inventory.quantityOnHand}
                ELSE 0 
              END
            `
          })
          .from(products)
          .innerJoin(inventory, eq(products.id, inventory.productId))
          .orderBy(desc(sql`
            CASE 
              WHEN ${inventory.quantityOnHand} > 0 
              THEN COALESCE((
                SELECT SUM(ABS(quantity)) 
                FROM inventory_movements 
                WHERE product_id = ${products.id} 
                AND movement_type = 'sale'
                AND created_at >= NOW() - INTERVAL '30 days'
              ), 0) / ${inventory.quantityOnHand}
              ELSE 0 
            END
          `))
          .limit(50); // Top 50 for performance
      }

      // Customer acquisition metrics
      if (metricTypes.includes('customer_acquisition')) {
        let customerConditions = [];
        if (dateFrom) customerConditions.push(gte(customers.createdAt, new Date(dateFrom)));
        if (dateTo) customerConditions.push(lte(customers.createdAt, new Date(dateTo)));

        metrics.customerAcquisition = await db
          .select({
            totalCustomers: sql`COUNT(*)`,
            newCustomersThisMonth: sql`
              COUNT(CASE WHEN ${customers.createdAt} >= DATE_TRUNC('month', NOW()) THEN 1 END)
            `,
            newCustomersLastMonth: sql`
              COUNT(CASE WHEN ${customers.createdAt} >= DATE_TRUNC('month', NOW()) - INTERVAL '1 month' 
                     AND ${customers.createdAt} < DATE_TRUNC('month', NOW()) THEN 1 END)
            `,
            avgCustomersPerDay: sql`
              COUNT(*) / GREATEST(EXTRACT(days FROM NOW() - MIN(${customers.createdAt})), 1)
            `
          })
          .from(customers)
          .where(customerConditions.length > 0 ? and(...customerConditions) : undefined);
      }

      return metrics;
    }, cacheKey, 300); // 5 minute cache
  }

  // ==================== CUSTOMER SEGMENTATION ====================

  /**
   * RFM Analysis - Recency, Frequency, Monetary customer segmentation
   * Segments customers based on purchase behavior patterns
   */
  async getRFMAnalysis(params = {}) {
    const {
      dateFrom = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(), // 1 year ago
      dateTo = new Date().toISOString(),
      includeDetails = false
    } = params;

    const cacheKey = `rfm_analysis_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      // Get RFM scores for all customers
      const rfmData = await db
        .select({
          customerId: inventoryMovements.referenceId,
          customerCode: customers.customerCode,
          customerName: customers.companyName,
          email: customers.email,
          
          // Recency: Days since last purchase
          recency: sql`EXTRACT(days FROM NOW() - MAX(${inventoryMovements.createdAt}))`,
          
          // Frequency: Number of distinct orders
          frequency: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          
          // Monetary: Total purchase value
          monetary: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          
          // Additional metrics
          firstPurchase: sql`MIN(${inventoryMovements.createdAt})`,
          lastPurchase: sql`MAX(${inventoryMovements.createdAt})`,
          avgOrderValue: sql`AVG(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
          uniqueProducts: sql`COUNT(DISTINCT ${inventoryMovements.productId})`,
          customerAge: sql`EXTRACT(days FROM NOW() - ${customers.createdAt})`
        })
        .from(inventoryMovements)
        .innerJoin(customers, eq(inventoryMovements.referenceId, customers.id))
        .where(and(
          eq(inventoryMovements.movementType, 'sale'),
          gte(inventoryMovements.createdAt, new Date(dateFrom)),
          lte(inventoryMovements.createdAt, new Date(dateTo))
        ))
        .groupBy(
          inventoryMovements.referenceId,
          customers.customerCode,
          customers.companyName,
          customers.email,
          customers.createdAt
        )
        .having(sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber}) > 0`);

      if (rfmData.length === 0) {
        return { segments: [], customers: [], metrics: null };
      }

      // Calculate RFM quintiles
      const recencyValues = rfmData.map(c => parseFloat(c.recency || 0)).sort((a, b) => a - b);
      const frequencyValues = rfmData.map(c => parseInt(c.frequency || 0)).sort((a, b) => b - a);
      const monetaryValues = rfmData.map(c => parseFloat(c.monetary || 0)).sort((a, b) => b - a);

      const getQuintile = (value, values, reverse = false) => {
        const index = values.indexOf(value);
        const quintileSize = Math.ceil(values.length / 5);
        let quintile = Math.floor(index / quintileSize) + 1;
        quintile = Math.min(quintile, 5);
        return reverse ? 6 - quintile : quintile; // Reverse for recency (lower is better)
      };

      // Assign RFM scores and segments
      const customersWithRFM = rfmData.map(customer => {
        const recency = parseFloat(customer.recency || 0);
        const frequency = parseInt(customer.frequency || 0);
        const monetary = parseFloat(customer.monetary || 0);

        const rScore = getQuintile(recency, recencyValues, true); // Reverse for recency
        const fScore = getQuintile(frequency, frequencyValues);
        const mScore = getQuintile(monetary, monetaryValues);

        // Determine segment based on RFM scores
        let segment = 'other';
        if (rScore >= 4 && fScore >= 4 && mScore >= 4) {
          segment = 'champions';
        } else if (rScore >= 3 && fScore >= 3 && mScore >= 4) {
          segment = 'loyal_customers';
        } else if (rScore >= 4 && fScore <= 2 && mScore >= 3) {
          segment = 'potential_loyalists';
        } else if (rScore >= 4 && fScore <= 2 && mScore <= 2) {
          segment = 'new_customers';
        } else if (rScore >= 3 && fScore >= 3 && mScore <= 3) {
          segment = 'promising';
        } else if (rScore >= 2 && fScore >= 2 && mScore >= 2) {
          segment = 'customers_needing_attention';
        } else if (rScore >= 2 && fScore <= 2 && mScore >= 3) {
          segment = 'about_to_sleep';
        } else if (rScore <= 2 && fScore >= 3 && mScore >= 3) {
          segment = 'at_risk';
        } else if (rScore <= 2 && fScore >= 4 && mScore >= 4) {
          segment = 'cannot_lose_them';
        } else if (rScore <= 2 && fScore <= 2 && mScore <= 2) {
          segment = 'hibernating';
        } else if (rScore <= 1 && fScore <= 2 && mScore >= 3) {
          segment = 'lost';
        }

        return {
          ...customer,
          recency: parseFloat(customer.recency || 0),
          frequency: parseInt(customer.frequency || 0),
          monetary: parseFloat(customer.monetary || 0),
          rScore,
          fScore,
          mScore,
          rfmScore: `${rScore}${fScore}${mScore}`,
          segment,
          avgOrderValue: parseFloat(customer.avgOrderValue || 0),
          totalQuantity: parseInt(customer.totalQuantity || 0),
          uniqueProducts: parseInt(customer.uniqueProducts || 0),
          customerAge: parseInt(customer.customerAge || 0)
        };
      });

      // Calculate segment statistics
      const segmentStats = {};
      customersWithRFM.forEach(customer => {
        if (!segmentStats[customer.segment]) {
          segmentStats[customer.segment] = {
            count: 0,
            totalRevenue: 0,
            avgRecency: 0,
            avgFrequency: 0,
            avgMonetary: 0,
            customers: []
          };
        }
        segmentStats[customer.segment].count++;
        segmentStats[customer.segment].totalRevenue += customer.monetary;
        segmentStats[customer.segment].avgRecency += customer.recency;
        segmentStats[customer.segment].avgFrequency += customer.frequency;
        segmentStats[customer.segment].avgMonetary += customer.monetary;
        if (includeDetails) {
          segmentStats[customer.segment].customers.push(customer);
        }
      });

      // Calculate averages
      Object.keys(segmentStats).forEach(segment => {
        const stats = segmentStats[segment];
        stats.avgRecency = stats.avgRecency / stats.count;
        stats.avgFrequency = stats.avgFrequency / stats.count;
        stats.avgMonetary = stats.avgMonetary / stats.count;
        stats.percentage = (stats.count / customersWithRFM.length) * 100;
      });

      const result = {
        segments: Object.entries(segmentStats).map(([name, stats]) => ({
          name,
          ...stats
        })),
        totalCustomers: customersWithRFM.length,
        dateRange: { from: dateFrom, to: dateTo },
        metrics: {
          avgRecency: recencyValues[Math.floor(recencyValues.length / 2)],
          avgFrequency: frequencyValues[Math.floor(frequencyValues.length / 2)],
          avgMonetary: monetaryValues[Math.floor(monetaryValues.length / 2)],
          totalRevenue: customersWithRFM.reduce((sum, c) => sum + c.monetary, 0)
        }
      };

      if (includeDetails) {
        result.customers = customersWithRFM;
      }

      return result;
    }, cacheKey, 900); // 15 minute cache
  }

  /**
   * Behavioral Customer Segmentation
   * Segments customers based on engagement and lifecycle stage
   */
  async getBehavioralSegmentation(params = {}) {
    const {
      dateFrom = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      dateTo = new Date().toISOString(),
      includeDetails = false
    } = params;

    const cacheKey = `behavioral_segmentation_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      // Get customer behavioral data
      const behavioralData = await db
        .select({
          customerId: customers.id,
          customerCode: customers.customerCode,
          customerName: customers.companyName,
          email: customers.email,
          createdAt: customers.createdAt,
          
          // Order metrics from inventory movements
          totalOrders: sql`COALESCE((
            SELECT COUNT(DISTINCT ${inventoryMovements.referenceNumber})
            FROM ${inventoryMovements}
            WHERE ${inventoryMovements.referenceId} = ${customers.id}
            AND ${inventoryMovements.movementType} = 'sale'
            AND ${inventoryMovements.createdAt} >= ${new Date(dateFrom)}
            AND ${inventoryMovements.createdAt} <= ${new Date(dateTo)}
          ), 0)`,
          
          totalRevenue: sql`COALESCE((
            SELECT SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})
            FROM ${inventoryMovements}
            WHERE ${inventoryMovements.referenceId} = ${customers.id}
            AND ${inventoryMovements.movementType} = 'sale'
            AND ${inventoryMovements.createdAt} >= ${new Date(dateFrom)}
            AND ${inventoryMovements.createdAt} <= ${new Date(dateTo)}
          ), 0)`,
          
          firstOrderDate: sql`(
            SELECT MIN(${inventoryMovements.createdAt})
            FROM ${inventoryMovements}
            WHERE ${inventoryMovements.referenceId} = ${customers.id}
            AND ${inventoryMovements.movementType} = 'sale'
          )`,
          
          lastOrderDate: sql`(
            SELECT MAX(${inventoryMovements.createdAt})
            FROM ${inventoryMovements}
            WHERE ${inventoryMovements.referenceId} = ${customers.id}
            AND ${inventoryMovements.movementType} = 'sale'
          )`,
          
          ordersLast30Days: sql`COALESCE((
            SELECT COUNT(DISTINCT ${inventoryMovements.referenceNumber})
            FROM ${inventoryMovements}
            WHERE ${inventoryMovements.referenceId} = ${customers.id}
            AND ${inventoryMovements.movementType} = 'sale'
            AND ${inventoryMovements.createdAt} >= NOW() - INTERVAL '30 days'
          ), 0)`,
          
          ordersLast90Days: sql`COALESCE((
            SELECT COUNT(DISTINCT ${inventoryMovements.referenceNumber})
            FROM ${inventoryMovements}
            WHERE ${inventoryMovements.referenceId} = ${customers.id}
            AND ${inventoryMovements.movementType} = 'sale'
            AND ${inventoryMovements.createdAt} >= NOW() - INTERVAL '90 days'
          ), 0)`,
          
          lifetimeOrders: sql`COALESCE((
            SELECT COUNT(DISTINCT ${inventoryMovements.referenceNumber})
            FROM ${inventoryMovements}
            WHERE ${inventoryMovements.referenceId} = ${customers.id}
            AND ${inventoryMovements.movementType} = 'sale'
          ), 0)`,
          
          lifetimeRevenue: sql`COALESCE((
            SELECT SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})
            FROM ${inventoryMovements}
            WHERE ${inventoryMovements.referenceId} = ${customers.id}
            AND ${inventoryMovements.movementType} = 'sale'
          ), 0)`
        })
        .from(customers);

      const now = new Date();
      const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
      const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);

      // Classify customers into behavioral segments
      const customersWithSegments = behavioralData.map(customer => {
        const totalOrders = parseInt(customer.totalOrders || 0);
        const totalRevenue = parseFloat(customer.totalRevenue || 0);
        const ordersLast30Days = parseInt(customer.ordersLast30Days || 0);
        const ordersLast90Days = parseInt(customer.ordersLast90Days || 0);
        const lifetimeOrders = parseInt(customer.lifetimeOrders || 0);
        const lifetimeRevenue = parseFloat(customer.lifetimeRevenue || 0);
        
        const lastOrderDate = customer.lastOrderDate ? new Date(customer.lastOrderDate) : null;
        const firstOrderDate = customer.firstOrderDate ? new Date(customer.firstOrderDate) : null;
        const daysSinceLastOrder = lastOrderDate ? Math.floor((now - lastOrderDate) / (1000 * 60 * 60 * 24)) : null;
        const daysSinceFirstOrder = firstOrderDate ? Math.floor((now - firstOrderDate) / (1000 * 60 * 60 * 24)) : null;

        let segment = 'inactive';
        let segmentDescription = 'Customer with no recent activity';

        // VIP Customers: High lifetime value and recent activity
        if (lifetimeRevenue > 10000 && ordersLast30Days > 0) {
          segment = 'vip';
          segmentDescription = 'High-value customer with recent activity';
        }
        // Champions: High engagement and high value
        else if (lifetimeOrders >= 10 && lifetimeRevenue > 5000 && ordersLast30Days > 0) {
          segment = 'champions';
          segmentDescription = 'Highly engaged, high-value customer';
        }
        // Active Customers: Regular recent purchases
        else if (ordersLast30Days > 0 && lifetimeOrders >= 3) {
          segment = 'active';
          segmentDescription = 'Regularly purchasing customer';
        }
        // New Customers: First order within 90 days
        else if (daysSinceFirstOrder !== null && daysSinceFirstOrder <= 90 && lifetimeOrders <= 3) {
          segment = 'new';
          segmentDescription = 'New customer, recently acquired';
        }
        // Promising: Good early signs, needs nurturing
        else if (lifetimeOrders >= 2 && daysSinceFirstOrder !== null && daysSinceFirstOrder <= 180) {
          segment = 'promising';
          segmentDescription = 'Shows potential, needs engagement';
        }
        // At Risk: Previously active but declining
        else if (lifetimeOrders >= 3 && ordersLast90Days === 0 && daysSinceLastOrder > 90) {
          segment = 'at_risk';
          segmentDescription = 'Previously active, now declining';
        }
        // Churned: No recent activity, previously engaged
        else if (lifetimeOrders >= 2 && daysSinceLastOrder > 180) {
          segment = 'churned';
          segmentDescription = 'No recent activity, may have churned';
        }
        // One-time: Single purchase, no repeat
        else if (lifetimeOrders === 1 && daysSinceLastOrder > 90) {
          segment = 'one_time';
          segmentDescription = 'Single purchase, no repeat business';
        }
        // Dormant: Registered but no purchases
        else if (lifetimeOrders === 0) {
          segment = 'dormant';
          segmentDescription = 'Registered but never purchased';
        }

        return {
          ...customer,
          totalOrders,
          totalRevenue,
          ordersLast30Days,
          ordersLast90Days,
          lifetimeOrders,
          lifetimeRevenue,
          daysSinceLastOrder,
          daysSinceFirstOrder,
          segment,
          segmentDescription,
          avgOrderValue: lifetimeOrders > 0 ? lifetimeRevenue / lifetimeOrders : 0
        };
      });

      // Calculate segment statistics
      const segmentStats = {};
      customersWithSegments.forEach(customer => {
        if (!segmentStats[customer.segment]) {
          segmentStats[customer.segment] = {
            count: 0,
            totalRevenue: 0,
            avgLifetimeRevenue: 0,
            avgLifetimeOrders: 0,
            avgOrderValue: 0,
            customers: []
          };
        }
        segmentStats[customer.segment].count++;
        segmentStats[customer.segment].totalRevenue += customer.lifetimeRevenue;
        segmentStats[customer.segment].avgLifetimeRevenue += customer.lifetimeRevenue;
        segmentStats[customer.segment].avgLifetimeOrders += customer.lifetimeOrders;
        segmentStats[customer.segment].avgOrderValue += customer.avgOrderValue;
        if (includeDetails) {
          segmentStats[customer.segment].customers.push(customer);
        }
      });

      // Calculate averages
      Object.keys(segmentStats).forEach(segment => {
        const stats = segmentStats[segment];
        stats.avgLifetimeRevenue = stats.avgLifetimeRevenue / stats.count;
        stats.avgLifetimeOrders = stats.avgLifetimeOrders / stats.count;
        stats.avgOrderValue = stats.avgOrderValue / stats.count;
        stats.percentage = (stats.count / customersWithSegments.length) * 100;
      });

      const result = {
        segments: Object.entries(segmentStats).map(([name, stats]) => ({
          name,
          ...stats
        })),
        totalCustomers: customersWithSegments.length,
        dateRange: { from: dateFrom, to: dateTo },
        metrics: {
          totalRevenue: customersWithSegments.reduce((sum, c) => sum + c.lifetimeRevenue, 0),
          avgLifetimeValue: customersWithSegments.reduce((sum, c) => sum + c.lifetimeRevenue, 0) / customersWithSegments.length,
          avgOrdersPerCustomer: customersWithSegments.reduce((sum, c) => sum + c.lifetimeOrders, 0) / customersWithSegments.length
        }
      };

      if (includeDetails) {
        result.customers = customersWithSegments;
      }

      return result;
    }, cacheKey, 900); // 15 minute cache
  }

  /**
   * Geographic and Demographic Customer Segmentation
   * Segments customers based on location and company profile data
   */
  async getGeographicSegmentation(params = {}) {
    const {
      includeDetails = false,
      groupByCountry = true,
      groupByRegion = true,
      groupByCity = false
    } = params;

    const cacheKey = `geographic_segmentation_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      // Get customer data with address information and order metrics
      const geoData = await db
        .select({
          customerId: customers.id,
          customerCode: customers.customerCode,
          customerName: customers.companyName,
          email: customers.email,
          address: customers.address,
          metadata: customers.metadata,
          createdAt: customers.createdAt,
          
          // Order metrics
          totalOrders: sql`COALESCE((
            SELECT COUNT(DISTINCT ${inventoryMovements.referenceNumber})
            FROM ${inventoryMovements}
            WHERE ${inventoryMovements.referenceId} = ${customers.id}
            AND ${inventoryMovements.movementType} = 'sale'
          ), 0)`,
          
          totalRevenue: sql`COALESCE((
            SELECT SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})
            FROM ${inventoryMovements}
            WHERE ${inventoryMovements.referenceId} = ${customers.id}
            AND ${inventoryMovements.movementType} = 'sale'
          ), 0)`,
          
          lastOrderDate: sql`(
            SELECT MAX(${inventoryMovements.createdAt})
            FROM ${inventoryMovements}
            WHERE ${inventoryMovements.referenceId} = ${customers.id}
            AND ${inventoryMovements.movementType} = 'sale'
          )`
        })
        .from(customers);

      // Process and categorize customers
      const customersWithGeoSegments = geoData.map(customer => {
        const address = customer.address || {};
        const metadata = customer.metadata || {};
        
        // Extract geographic information
        const country = address.country || 'Unknown';
        const region = address.state || address.province || address.region || 'Unknown';
        const city = address.city || 'Unknown';
        const postalCode = address.postalCode || address.zipCode || '';
        
        // Extract demographic information
        const companySize = metadata.companySize || 'Unknown';
        const industry = metadata.industry || 'Unknown';
        const customerType = metadata.customerType || 'Unknown';
        
        // Calculate customer metrics
        const totalOrders = parseInt(customer.totalOrders || 0);
        const totalRevenue = parseFloat(customer.totalRevenue || 0);
        const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;
        const lastOrderDate = customer.lastOrderDate ? new Date(customer.lastOrderDate) : null;
        const daysSinceLastOrder = lastOrderDate ? Math.floor((new Date() - lastOrderDate) / (1000 * 60 * 60 * 24)) : null;
        
        // Determine business value segment
        let valueSegment = 'low_value';
        if (totalRevenue > 50000) {
          valueSegment = 'enterprise';
        } else if (totalRevenue > 10000) {
          valueSegment = 'high_value';
        } else if (totalRevenue > 1000) {
          valueSegment = 'medium_value';
        }

        return {
          ...customer,
          // Geographic data
          country,
          region,
          city,
          postalCode,
          // Demographic data
          companySize,
          industry,
          customerType,
          // Metrics
          totalOrders,
          totalRevenue,
          avgOrderValue,
          daysSinceLastOrder,
          valueSegment,
          // Combined segments
          geoSegment: `${country}_${region}`,
          demoSegment: `${industry}_${companySize}`,
          combinedSegment: `${country}_${valueSegment}`
        };
      });

      // Create segmentation statistics
      const segmentations = {};

      // Country-based segmentation
      if (groupByCountry) {
        segmentations.byCountry = {};
        customersWithGeoSegments.forEach(customer => {
          const segment = customer.country;
          if (!segmentations.byCountry[segment]) {
            segmentations.byCountry[segment] = {
              count: 0,
              totalRevenue: 0,
              avgRevenue: 0,
              avgOrders: 0,
              customers: []
            };
          }
          segmentations.byCountry[segment].count++;
          segmentations.byCountry[segment].totalRevenue += customer.totalRevenue;
          segmentations.byCountry[segment].avgRevenue += customer.totalRevenue;
          segmentations.byCountry[segment].avgOrders += customer.totalOrders;
          if (includeDetails) {
            segmentations.byCountry[segment].customers.push(customer);
          }
        });

        // Calculate averages
        Object.keys(segmentations.byCountry).forEach(country => {
          const stats = segmentations.byCountry[country];
          stats.avgRevenue = stats.avgRevenue / stats.count;
          stats.avgOrders = stats.avgOrders / stats.count;
          stats.percentage = (stats.count / customersWithGeoSegments.length) * 100;
        });
      }

      // Region-based segmentation
      if (groupByRegion) {
        segmentations.byRegion = {};
        customersWithGeoSegments.forEach(customer => {
          const segment = customer.geoSegment;
          if (!segmentations.byRegion[segment]) {
            segmentations.byRegion[segment] = {
              count: 0,
              totalRevenue: 0,
              avgRevenue: 0,
              avgOrders: 0,
              customers: []
            };
          }
          segmentations.byRegion[segment].count++;
          segmentations.byRegion[segment].totalRevenue += customer.totalRevenue;
          segmentations.byRegion[segment].avgRevenue += customer.totalRevenue;
          segmentations.byRegion[segment].avgOrders += customer.totalOrders;
          if (includeDetails) {
            segmentations.byRegion[segment].customers.push(customer);
          }
        });

        // Calculate averages
        Object.keys(segmentations.byRegion).forEach(region => {
          const stats = segmentations.byRegion[region];
          stats.avgRevenue = stats.avgRevenue / stats.count;
          stats.avgOrders = stats.avgOrders / stats.count;
          stats.percentage = (stats.count / customersWithGeoSegments.length) * 100;
        });
      }

      // Industry-based segmentation
      segmentations.byIndustry = {};
      customersWithGeoSegments.forEach(customer => {
        const segment = customer.industry;
        if (!segmentations.byIndustry[segment]) {
          segmentations.byIndustry[segment] = {
            count: 0,
            totalRevenue: 0,
            avgRevenue: 0,
            avgOrders: 0,
            customers: []
          };
        }
        segmentations.byIndustry[segment].count++;
        segmentations.byIndustry[segment].totalRevenue += customer.totalRevenue;
        segmentations.byIndustry[segment].avgRevenue += customer.totalRevenue;
        segmentations.byIndustry[segment].avgOrders += customer.totalOrders;
        if (includeDetails) {
          segmentations.byIndustry[segment].customers.push(customer);
        }
      });

      // Calculate averages for industry
      Object.keys(segmentations.byIndustry).forEach(industry => {
        const stats = segmentations.byIndustry[industry];
        stats.avgRevenue = stats.avgRevenue / stats.count;
        stats.avgOrders = stats.avgOrders / stats.count;
        stats.percentage = (stats.count / customersWithGeoSegments.length) * 100;
      });

      // Value-based segmentation
      segmentations.byValue = {};
      customersWithGeoSegments.forEach(customer => {
        const segment = customer.valueSegment;
        if (!segmentations.byValue[segment]) {
          segmentations.byValue[segment] = {
            count: 0,
            totalRevenue: 0,
            avgRevenue: 0,
            avgOrders: 0,
            customers: []
          };
        }
        segmentations.byValue[segment].count++;
        segmentations.byValue[segment].totalRevenue += customer.totalRevenue;
        segmentations.byValue[segment].avgRevenue += customer.totalRevenue;
        segmentations.byValue[segment].avgOrders += customer.totalOrders;
        if (includeDetails) {
          segmentations.byValue[segment].customers.push(customer);
        }
      });

      // Calculate averages for value
      Object.keys(segmentations.byValue).forEach(value => {
        const stats = segmentations.byValue[value];
        stats.avgRevenue = stats.avgRevenue / stats.count;
        stats.avgOrders = stats.avgOrders / stats.count;
        stats.percentage = (stats.count / customersWithGeoSegments.length) * 100;
      });

      const result = {
        segmentations,
        totalCustomers: customersWithGeoSegments.length,
        metrics: {
          totalRevenue: customersWithGeoSegments.reduce((sum, c) => sum + c.totalRevenue, 0),
          avgRevenuePerCustomer: customersWithGeoSegments.reduce((sum, c) => sum + c.totalRevenue, 0) / customersWithGeoSegments.length,
          uniqueCountries: new Set(customersWithGeoSegments.map(c => c.country)).size,
          uniqueRegions: new Set(customersWithGeoSegments.map(c => c.geoSegment)).size,
          uniqueIndustries: new Set(customersWithGeoSegments.map(c => c.industry)).size
        }
      };

      if (includeDetails) {
        result.customers = customersWithGeoSegments;
      }

      return result;
    }, cacheKey, 900); // 15 minute cache
  }

  /**
   * Calculate comprehensive segment metrics and insights
   */
  async getSegmentMetrics(params = {}) {
    const {
      segmentType = 'all', // 'rfm', 'behavioral', 'geographic', 'all'
      includeComparisons = true,
      includeRecommendations = true
    } = params;

    const cacheKey = `segment_metrics_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      const results = {
        segmentType,
        timestamp: new Date().toISOString(),
        metrics: {},
        comparisons: {},
        recommendations: []
      };

      // Get different segmentation analyses
      if (segmentType === 'all' || segmentType === 'rfm') {
        results.metrics.rfm = await this.getRFMAnalysis({ includeDetails: false });
      }

      if (segmentType === 'all' || segmentType === 'behavioral') {
        results.metrics.behavioral = await this.getBehavioralSegmentation({ includeDetails: false });
      }

      if (segmentType === 'all' || segmentType === 'geographic') {
        results.metrics.geographic = await this.getGeographicSegmentation({ includeDetails: false });
      }

      // Calculate cross-segment comparisons
      if (includeComparisons && segmentType === 'all') {
        const rfmData = results.metrics.rfm?.data;
        const behavioralData = results.metrics.behavioral?.data;

        if (rfmData && behavioralData) {
          results.comparisons.segmentOverlap = {
            totalCustomers: Math.max(rfmData.totalCustomers || 0, behavioralData.totalCustomers || 0),
            rfmChampions: rfmData.segments?.find(s => s.name === 'champions')?.count || 0,
            behavioralVIP: behavioralData.segments?.find(s => s.name === 'vip')?.count || 0,
            rfmAtRisk: rfmData.segments?.find(s => s.name === 'at_risk')?.count || 0,
            behavioralAtRisk: behavioralData.segments?.find(s => s.name === 'at_risk')?.count || 0
          };
        }
      }

      // Generate recommendations
      if (includeRecommendations) {
        const recommendations = [];

        // RFM-based recommendations
        if (results.metrics.rfm?.data) {
          const rfmSegments = results.metrics.rfm.data.segments || [];
          
          const champions = rfmSegments.find(s => s.name === 'champions');
          if (champions && champions.count > 0) {
            recommendations.push({
              type: 'retention',
              priority: 'high',
              segment: 'champions',
              action: 'VIP loyalty program',
              description: `${champions.count} champion customers (${champions.percentage?.toFixed(1)}%) should be enrolled in a VIP program`,
              expectedImpact: 'Increase retention and advocacy'
            });
          }

          const atRisk = rfmSegments.find(s => s.name === 'at_risk');
          if (atRisk && atRisk.count > 0) {
            recommendations.push({
              type: 'reactivation',
              priority: 'urgent',
              segment: 'at_risk',
              action: 'Win-back campaign',
              description: `${atRisk.count} at-risk customers (${atRisk.percentage?.toFixed(1)}%) need immediate attention`,
              expectedImpact: 'Prevent churn and recover revenue'
            });
          }

          const newCustomers = rfmSegments.find(s => s.name === 'new_customers');
          if (newCustomers && newCustomers.count > 0) {
            recommendations.push({
              type: 'onboarding',
              priority: 'medium',
              segment: 'new_customers',
              action: 'Onboarding sequence',
              description: `${newCustomers.count} new customers (${newCustomers.percentage?.toFixed(1)}%) should receive targeted onboarding`,
              expectedImpact: 'Increase early engagement and lifetime value'
            });
          }
        }

        // Behavioral-based recommendations
        if (results.metrics.behavioral?.data) {
          const behavioralSegments = results.metrics.behavioral.data.segments || [];
          
          const dormant = behavioralSegments.find(s => s.name === 'dormant');
          if (dormant && dormant.count > 0) {
            recommendations.push({
              type: 'activation',
              priority: 'medium',
              segment: 'dormant',
              action: 'First purchase incentive',
              description: `${dormant.count} dormant customers (${dormant.percentage?.toFixed(1)}%) have never made a purchase`,
              expectedImpact: 'Convert registered users to paying customers'
            });
          }

          const oneTime = behavioralSegments.find(s => s.name === 'one_time');
          if (oneTime && oneTime.count > 0) {
            recommendations.push({
              type: 'repeat_purchase',
              priority: 'medium',
              segment: 'one_time',
              action: 'Repeat purchase campaign',
              description: `${oneTime.count} one-time customers (${oneTime.percentage?.toFixed(1)}%) haven't returned`,
              expectedImpact: 'Increase customer lifetime value through repeat purchases'
            });
          }
        }

        results.recommendations = recommendations;
      }

      return results;
    }, cacheKey, 600); // 10 minute cache
  }

  /**
   * Comprehensive Customer Segmentation Analysis
   * Combines all segmentation approaches for complete customer insights
   */
  async getComprehensiveSegmentation(params = {}) {
    const {
      dateFrom = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
      dateTo = new Date().toISOString(),
      includeDetails = false,
      includeRecommendations = true
    } = params;

    const cacheKey = `comprehensive_segmentation_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      // Get all segmentation analyses in parallel for better performance
      const [rfmAnalysis, behavioralAnalysis, geographicAnalysis, segmentMetrics] = await Promise.all([
        this.getRFMAnalysis({ dateFrom, dateTo, includeDetails }),
        this.getBehavioralSegmentation({ dateFrom, dateTo, includeDetails }),
        this.getGeographicSegmentation({ includeDetails }),
        this.getSegmentMetrics({ segmentType: 'all', includeRecommendations })
      ]);

      // Combine insights
      const result = {
        analysis: {
          rfm: rfmAnalysis.data,
          behavioral: behavioralAnalysis.data,
          geographic: geographicAnalysis.data
        },
        metrics: segmentMetrics.data?.metrics || {},
        recommendations: segmentMetrics.data?.recommendations || [],
        summary: {
          totalCustomers: Math.max(
            rfmAnalysis.data?.totalCustomers || 0,
            behavioralAnalysis.data?.totalCustomers || 0,
            geographicAnalysis.data?.totalCustomers || 0
          ),
          totalRevenue: Math.max(
            rfmAnalysis.data?.metrics?.totalRevenue || 0,
            behavioralAnalysis.data?.metrics?.totalRevenue || 0,
            geographicAnalysis.data?.metrics?.totalRevenue || 0
          ),
          dateRange: { from: dateFrom, to: dateTo },
          analysisTypes: ['RFM', 'Behavioral', 'Geographic'],
          generatedAt: new Date().toISOString()
        },
        performance: {
          rfmDuration: rfmAnalysis.duration,
          behavioralDuration: behavioralAnalysis.duration,
          geographicDuration: geographicAnalysis.duration,
          totalDuration: rfmAnalysis.duration + behavioralAnalysis.duration + geographicAnalysis.duration,
          fromCache: rfmAnalysis.fromCache && behavioralAnalysis.fromCache && geographicAnalysis.fromCache
        }
      };

      return result;
    }, cacheKey, 1800); // 30 minute cache for comprehensive analysis
  }

  // ==================== MATHEMATICAL ANALYSIS ====================

  async calculateTrends(data, field) {
    if (!Array.isArray(data) || data.length < 2) {
      return { trend: 'insufficient_data', slope: 0, correlation: 0 };
    }

    try {
      const values = data.map(item => parseFloat(item[field]) || 0);
      const indices = data.map((_, index) => index);

      // Calculate linear regression using mathjs
      const n = values.length;
      const sumX = indices.reduce((a, b) => a + b, 0);
      const sumY = values.reduce((a, b) => a + b, 0);
      const sumXY = indices.reduce((sum, x, i) => sum + x * values[i], 0);
      const sumXX = indices.reduce((sum, x) => sum + x * x, 0);

      const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
      const intercept = (sumY - slope * sumX) / n;

      // Calculate correlation coefficient
      const meanX = sumX / n;
      const meanY = sumY / n;
      const numerator = indices.reduce((sum, x, i) => sum + (x - meanX) * (values[i] - meanY), 0);
      const denomX = Math.sqrt(indices.reduce((sum, x) => sum + Math.pow(x - meanX, 2), 0));
      const denomY = Math.sqrt(values.reduce((sum, y) => sum + Math.pow(y - meanY, 2), 0));
      const correlation = numerator / (denomX * denomY);

      return {
        trend: slope > 0.1 ? 'increasing' : slope < -0.1 ? 'decreasing' : 'stable',
        slope: slope,
        intercept: intercept,
        correlation: correlation,
        r_squared: correlation * correlation
      };
    } catch (error) {
      console.error('Trend calculation error:', error);
      return { trend: 'calculation_error', slope: 0, correlation: 0 };
    }
  }

  async getAdvancedAnalytics(params = {}) {
    const {
      analysis_type = 'comprehensive',
      dateFrom = null,
      dateTo = null
    } = params;

    const cacheKey = `advanced_analytics_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      const results = {};

      // Get sales trend
      const salesData = await this.getSalesMetrics({
        dateFrom,
        dateTo,
        aggregation: 'daily'
      });
      
      if (salesData.data && salesData.data.length > 0) {
        results.salesTrend = await this.calculateTrends(salesData.data, 'salesRevenue');
        results.quantityTrend = await this.calculateTrends(salesData.data, 'salesQuantity');
      }

      // Get inventory performance
      const inventoryData = await this.getInventoryMetrics({});
      if (inventoryData.data && inventoryData.data.length > 0) {
        results.inventoryAnalysis = {
          totalValue: inventoryData.data.reduce((sum, item) => sum + parseFloat(item.totalValue || 0), 0),
          lowStockItems: inventoryData.data.filter(item => 
            item.quantityOnHand <= (item.reorderPoint || 0)
          ).length,
          highTurnoverItems: inventoryData.data.filter(item => 
            parseFloat(item.turnoverRate || 0) > 1
          ).length,
          avgTurnoverRate: inventoryData.data.reduce((sum, item) => 
            sum + parseFloat(item.turnoverRate || 0), 0
          ) / inventoryData.data.length
        };
      }

      // Get customer insights
      const customerData = await this.getCustomerAnalytics({ dateFrom, dateTo });
      if (customerData.data && customerData.data.length > 0) {
        results.customerInsights = {
          totalActiveCustomers: customerData.data.length,
          topCustomerValue: Math.max(...customerData.data.map(c => parseFloat(c.totalValue || 0))),
          avgOrderValue: customerData.data.reduce((sum, c) => 
            sum + parseFloat(c.avgOrderValue || 0), 0
          ) / customerData.data.length,
          customerRetention: customerData.data.filter(c => 
            c.totalOrders > 1
          ).length / customerData.data.length
        };
      }

      return results;
    }, cacheKey, 600); // 10 minute cache for advanced analytics
  }

  // ==================== CUSTOMER SEGMENTATION ANALYTICS ====================

  async getCustomerSegmentation(params = {}) {
    const {
      segmentType = 'RFM', // RFM, behavioral, geographic
      dateFrom = null,
      dateTo = null,
      limit = 100,
      offset = 0,
      includeCustomerList = false
    } = params;

    const cacheKey = `customer_segmentation_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let whereConditions = [eq(inventoryMovements.movementType, 'sale')];
      
      if (dateFrom) {
        whereConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        whereConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));
      }

      // Get customer metrics for segmentation
      const customerMetrics = await db
        .select({
          customerId: customers.id,
          customerCode: customers.customerCode,
          companyName: customers.companyName,
          email: customers.email,
          phone: customers.phone,
          address: customers.address,
          createdAt: customers.createdAt,
          totalValue: sql`COALESCE(SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}), 0)`,
          totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
          avgOrderValue: sql`AVG(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          firstPurchase: sql`MIN(${inventoryMovements.createdAt})`,
          lastPurchase: sql`MAX(${inventoryMovements.createdAt})`,
          uniqueProducts: sql`COUNT(DISTINCT ${inventoryMovements.productId})`
        })
        .from(customers)
        .leftJoin(inventoryMovements, eq(customers.id, inventoryMovements.referenceId))
        .where(and(...whereConditions))
        .groupBy(customers.id, customers.customerCode, customers.companyName, customers.email, customers.phone, customers.address, customers.createdAt)
        .orderBy(desc(sql`COALESCE(SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}), 0)`));

      // Apply segmentation based on type
      let segmentationResult;
      
      switch (segmentType.toLowerCase()) {
        case 'rfm':
          segmentationResult = await this.performRFMSegmentation(customerMetrics);
          break;
        case 'behavioral':
          segmentationResult = await this.performBehavioralSegmentation(customerMetrics);
          break;
        case 'geographic':
          segmentationResult = await this.performGeographicSegmentation(customerMetrics);
          break;
        default:
          segmentationResult = await this.performRFMSegmentation(customerMetrics);
      }

      // Apply pagination to segment results if requested
      if (limit && offset !== undefined) {
        Object.keys(segmentationResult.segments).forEach(segmentKey => {
          if (Array.isArray(segmentationResult.segments[segmentKey])) {
            const segmentCustomers = segmentationResult.segments[segmentKey];
            segmentationResult.segments[segmentKey] = {
              total: segmentCustomers.length,
              customers: includeCustomerList ? segmentCustomers.slice(offset, offset + limit) : []
            };
          }
        });
      } else if (!includeCustomerList) {
        // Convert customer arrays to counts if not including customer lists
        Object.keys(segmentationResult.segments).forEach(segmentKey => {
          if (Array.isArray(segmentationResult.segments[segmentKey])) {
            segmentationResult.segments[segmentKey] = {
              total: segmentationResult.segments[segmentKey].length,
              customers: []
            };
          }
        });
      }

      // Calculate segment performance metrics and trends
      const segmentMetrics = await this.calculateSegmentMetrics(segmentationResult.segments, dateFrom, dateTo);
      const segmentTrends = await this.calculateSegmentTrends(segmentType, dateFrom, dateTo);

      return {
        segmentationType: segmentType,
        totalCustomers: customerMetrics.length,
        analysisDate: new Date().toISOString(),
        dateRange: { dateFrom, dateTo },
        segmentDefinitions: this.getSegmentDefinitions(segmentType),
        segmentCounts: segmentationResult.segmentCounts,
        segments: segmentationResult.segments,
        performanceMetrics: segmentMetrics,
        trends: segmentTrends,
        thresholds: segmentationResult.thresholds
      };
    }, cacheKey, 300); // 5 minute cache
  }

  async performRFMSegmentation(customerMetrics) {
    const now = new Date();
    
    // Calculate RFM scores for each customer
    const customersWithRFM = customerMetrics.map(customer => {
      const daysSinceLastPurchase = customer.lastPurchase 
        ? Math.floor((now - new Date(customer.lastPurchase)) / (1000 * 60 * 60 * 24))
        : 999;
      
      const totalValue = parseFloat(customer.totalValue) || 0;
      const totalOrders = parseInt(customer.totalOrders) || 0;
      
      // Calculate scores (1-5 scale)
      let recencyScore = 1;
      if (daysSinceLastPurchase <= 30) recencyScore = 5;
      else if (daysSinceLastPurchase <= 90) recencyScore = 4;
      else if (daysSinceLastPurchase <= 180) recencyScore = 3;
      else if (daysSinceLastPurchase <= 365) recencyScore = 2;

      let frequencyScore = 1;
      if (totalOrders >= 10) frequencyScore = 5;
      else if (totalOrders >= 5) frequencyScore = 4;
      else if (totalOrders >= 3) frequencyScore = 3;
      else if (totalOrders >= 1) frequencyScore = 2;

      let monetaryScore = 1;
      if (totalValue >= 10000) monetaryScore = 5;
      else if (totalValue >= 5000) monetaryScore = 4;
      else if (totalValue >= 1000) monetaryScore = 3;
      else if (totalValue > 0) monetaryScore = 2;

      return {
        ...customer,
        daysSinceLastPurchase,
        recencyScore,
        frequencyScore,
        monetaryScore,
        rfmScore: `${recencyScore}${frequencyScore}${monetaryScore}`
      };
    });

    // Segment customers based on RFM scores
    const segments = {
      champions: [],
      loyalCustomers: [],
      potentialLoyalists: [],
      newCustomers: [],
      promissingCustomers: [],
      needsAttention: [],
      aboutToSleep: [],
      atRisk: [],
      cannotLoseThem: [],
      hibernating: [],
      lost: []
    };

    customersWithRFM.forEach(customer => {
      const { recencyScore, frequencyScore, monetaryScore } = customer;
      
      if (recencyScore >= 4 && frequencyScore >= 4 && monetaryScore >= 4) {
        segments.champions.push({ ...customer, segment: 'Champions' });
      } else if (recencyScore >= 3 && frequencyScore >= 3 && monetaryScore >= 3) {
        segments.loyalCustomers.push({ ...customer, segment: 'Loyal Customers' });
      } else if (recencyScore >= 3 && frequencyScore <= 2 && monetaryScore >= 3) {
        segments.potentialLoyalists.push({ ...customer, segment: 'Potential Loyalists' });
      } else if (recencyScore >= 4 && frequencyScore <= 2) {
        segments.newCustomers.push({ ...customer, segment: 'New Customers' });
      } else if (recencyScore >= 3 && frequencyScore <= 2 && monetaryScore <= 2) {
        segments.promissingCustomers.push({ ...customer, segment: 'Promising Customers' });
      } else if (recencyScore === 3 && frequencyScore >= 3) {
        segments.needsAttention.push({ ...customer, segment: 'Customers Needing Attention' });
      } else if (recencyScore === 2 && frequencyScore >= 2) {
        segments.aboutToSleep.push({ ...customer, segment: 'About to Sleep' });
      } else if (recencyScore <= 2 && frequencyScore >= 3 && monetaryScore >= 3) {
        segments.cannotLoseThem.push({ ...customer, segment: 'Cannot Lose Them' });
      } else if (recencyScore === 2 && frequencyScore <= 2) {
        segments.atRisk.push({ ...customer, segment: 'At Risk' });
      } else if (recencyScore === 1 && frequencyScore >= 2) {
        segments.hibernating.push({ ...customer, segment: 'Hibernating' });
      } else {
        segments.lost.push({ ...customer, segment: 'Lost' });
      }
    });

    return {
      segments,
      segmentCounts: {
        champions: segments.champions.length,
        loyalCustomers: segments.loyalCustomers.length,
        potentialLoyalists: segments.potentialLoyalists.length,
        newCustomers: segments.newCustomers.length,
        promissingCustomers: segments.promissingCustomers.length,
        needsAttention: segments.needsAttention.length,
        aboutToSleep: segments.aboutToSleep.length,
        atRisk: segments.atRisk.length,
        cannotLoseThem: segments.cannotLoseThem.length,
        hibernating: segments.hibernating.length,
        lost: segments.lost.length
      },
      thresholds: {
        recency: { excellent: 30, good: 90, fair: 180, poor: 365 },
        frequency: { excellent: 10, good: 5, fair: 3, poor: 1 },
        monetary: { excellent: 10000, good: 5000, fair: 1000, poor: 0 }
      }
    };
  }

  async performBehavioralSegmentation(customerMetrics) {
    const segments = {
      highValue: [],
      frequentBuyers: [],
      bigSpenders: [],
      loyalCustomers: [],
      priceConscious: [],
      occasional: [],
      inactive: []
    };

    // Calculate behavioral thresholds
    const totalValues = customerMetrics.map(c => parseFloat(c.totalValue) || 0).sort((a, b) => b - a);
    const orderCounts = customerMetrics.map(c => parseInt(c.totalOrders) || 0).sort((a, b) => b - a);
    const avgOrderValues = customerMetrics.map(c => parseFloat(c.avgOrderValue) || 0).sort((a, b) => b - a);

    const valueP75 = totalValues.length > 0 ? totalValues[Math.floor(totalValues.length * 0.25)] : 5000;
    const valueP50 = totalValues.length > 0 ? totalValues[Math.floor(totalValues.length * 0.5)] : 2000;
    const freqP75 = orderCounts.length > 0 ? orderCounts[Math.floor(orderCounts.length * 0.25)] : 5;
    const avgP75 = avgOrderValues.length > 0 ? avgOrderValues[Math.floor(avgOrderValues.length * 0.25)] : 500;

    customerMetrics.forEach(customer => {
      const totalValue = parseFloat(customer.totalValue) || 0;
      const totalOrders = parseInt(customer.totalOrders) || 0;
      const avgOrderValue = parseFloat(customer.avgOrderValue) || 0;
      const daysSinceLastPurchase = customer.lastPurchase 
        ? Math.floor((new Date() - new Date(customer.lastPurchase)) / (1000 * 60 * 60 * 24))
        : 999;

      let segment = 'inactive';
      
      if (totalValue >= valueP75 && totalOrders >= freqP75) {
        segment = 'highValue';
      } else if (totalOrders >= freqP75) {
        segment = 'frequentBuyers';
      } else if (avgOrderValue >= avgP75) {
        segment = 'bigSpenders';
      } else if (totalValue >= valueP50 && daysSinceLastPurchase <= 90) {
        segment = 'loyalCustomers';
      } else if (avgOrderValue <= avgP75 * 0.5 && totalOrders >= 2) {
        segment = 'priceConscious';
      } else if (totalOrders >= 1 && daysSinceLastPurchase <= 180) {
        segment = 'occasional';
      }

      segments[segment].push({ ...customer, segment });
    });

    return {
      segments,
      segmentCounts: Object.keys(segments).reduce((acc, key) => {
        acc[key] = segments[key].length;
        return acc;
      }, {}),
      thresholds: { valueP75, valueP50, freqP75, avgP75 }
    };
  }

  async performGeographicSegmentation(customerMetrics) {
    const segments = {
      local: [],
      regional: [],
      national: [],
      international: [],
      unknown: []
    };

    // Simple geographic segmentation based on address patterns
    customerMetrics.forEach(customer => {
      const address = customer.address || '';
      let segment = 'unknown';
      
      // This is a simplified example - in practice you'd use proper geocoding
      if (address.toLowerCase().includes('local') || address.includes('nearby')) {
        segment = 'local';
      } else if (address.toLowerCase().includes('state') || address.toLowerCase().includes('province')) {
        segment = 'regional';
      } else if (address.toLowerCase().includes('country') || address.toLowerCase().includes('usa') || address.toLowerCase().includes('canada')) {
        segment = 'national';
      } else if (address.toLowerCase().includes('international') || address.toLowerCase().includes('overseas')) {
        segment = 'international';
      }

      segments[segment].push({ ...customer, segment });
    });

    return {
      segments,
      segmentCounts: Object.keys(segments).reduce((acc, key) => {
        acc[key] = segments[key].length;
        return acc;
      }, {}),
      thresholds: {}
    };
  }

  async calculateSegmentMetrics(segments, dateFrom, dateTo) {
    const metrics = {};
    
    for (const [segmentName, segmentData] of Object.entries(segments)) {
      const customers = Array.isArray(segmentData) ? segmentData : segmentData.customers || [];
      
      if (customers.length === 0) {
        metrics[segmentName] = {
          customerCount: 0,
          totalRevenue: 0,
          avgRevenue: 0,
          avgOrderValue: 0,
          avgOrderFrequency: 0
        };
        continue;
      }

      const totalRevenue = customers.reduce((sum, c) => sum + (parseFloat(c.totalValue) || 0), 0);
      const totalOrders = customers.reduce((sum, c) => sum + (parseInt(c.totalOrders) || 0), 0);
      
      metrics[segmentName] = {
        customerCount: customers.length,
        totalRevenue: totalRevenue,
        avgRevenue: totalRevenue / customers.length,
        avgOrderValue: totalOrders > 0 ? totalRevenue / totalOrders : 0,
        avgOrderFrequency: customers.reduce((sum, c) => sum + (parseInt(c.totalOrders) || 0), 0) / customers.length
      };
    }
    
    return metrics;
  }

  async calculateSegmentTrends(segmentType, dateFrom, dateTo) {
    // For trends, we would typically compare current period with previous period
    // This is a simplified implementation
    const cacheKey = `segment_trends_${segmentType}_${dateFrom}_${dateTo}`;
    
    return await this.executeWithCache(async () => {
      const currentPeriodStart = dateFrom ? new Date(dateFrom) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const currentPeriodEnd = dateTo ? new Date(dateTo) : new Date();
      const periodDays = Math.floor((currentPeriodEnd - currentPeriodStart) / (1000 * 60 * 60 * 24));
      
      const previousPeriodStart = new Date(currentPeriodStart.getTime() - periodDays * 24 * 60 * 60 * 1000);
      const previousPeriodEnd = new Date(currentPeriodStart.getTime() - 1000);

      // Get segment counts for current and previous periods
      const [currentSegments, previousSegments] = await Promise.all([
        this.getCustomerSegmentation({ 
          segmentType, 
          dateFrom: currentPeriodStart.toISOString(), 
          dateTo: currentPeriodEnd.toISOString(),
          includeCustomerList: false 
        }),
        this.getCustomerSegmentation({ 
          segmentType, 
          dateFrom: previousPeriodStart.toISOString(), 
          dateTo: previousPeriodEnd.toISOString(),
          includeCustomerList: false 
        })
      ]);

      const trends = {};
      const currentCounts = currentSegments.data.segmentCounts;
      const previousCounts = previousSegments.data.segmentCounts;

      Object.keys(currentCounts).forEach(segment => {
        const current = currentCounts[segment] || 0;
        const previous = previousCounts[segment] || 0;
        const change = current - previous;
        const percentChange = previous > 0 ? (change / previous) * 100 : 0;

        trends[segment] = {
          current,
          previous,
          change,
          percentChange: Math.round(percentChange * 100) / 100,
          trend: change > 0 ? 'increasing' : change < 0 ? 'decreasing' : 'stable'
        };
      });

      return trends;
    }, cacheKey, 600); // 10 minute cache for trends
  }

  getSegmentDefinitions(segmentType) {
    const definitions = {
      RFM: {
        champions: "Recent frequent buyers with high monetary value",
        loyalCustomers: "Regular customers with good value",
        potentialLoyalists: "Recent customers with good value but low frequency",
        newCustomers: "Recent first-time buyers",
        promissingCustomers: "Recent customers with low value",
        needsAttention: "Good customers who haven't purchased recently",
        aboutToSleep: "Customers showing declining activity",
        atRisk: "Previous good customers at risk of churning",
        cannotLoseThem: "High-value customers who haven't purchased recently",
        hibernating: "Customers who were active but now inactive",
        lost: "Customers who have stopped purchasing"
      },
      behavioral: {
        highValue: "High spending, frequent customers",
        frequentBuyers: "Customers who purchase regularly",
        bigSpenders: "Customers with high average order values",
        loyalCustomers: "Consistent customers with moderate value",
        priceConscious: "Customers who prefer lower-priced items",
        occasional: "Infrequent but recent customers",
        inactive: "Customers with no recent activity"
      },
      geographic: {
        local: "Customers in local area",
        regional: "Customers in regional area",
        national: "Customers within country",
        international: "International customers",
        unknown: "Customers with unknown location"
      }
    };

    return definitions[segmentType] || definitions.RFM;
  }

  // ==================== CACHE MANAGEMENT ====================

  async invalidateCache(pattern = 'analytics:*') {
    if (this.cache && this.initialized) {
      return await this.cache.invalidatePattern(pattern);
    }
    return false;
  }

  async clearAllCache() {
    if (this.cache && this.initialized) {
      return await this.cache.flush();
    }
    return false;
  }

  // ==================== PURCHASE PATTERN ANALYSIS ====================

  async analyzeSeasonalPatterns(params = {}) {
    const {
      customerId = null,
      productIds = null,
      categoryFilter = null,
      timeframe = 'last_year' // last_year, last_2_years, custom
    } = params;

    const cacheKey = `seasonal_patterns_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let whereConditions = [eq(inventoryMovements.movementType, 'sale')];
      
      // Set date range based on timeframe
      let dateFrom;
      if (timeframe === 'last_year') {
        dateFrom = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      } else if (timeframe === 'last_2_years') {
        dateFrom = new Date(Date.now() - 2 * 365 * 24 * 60 * 60 * 1000);
      } else if (params.dateFrom) {
        dateFrom = new Date(params.dateFrom);
      }
      
      if (dateFrom) {
        whereConditions.push(gte(inventoryMovements.createdAt, dateFrom));
      }
      if (customerId) {
        whereConditions.push(eq(inventoryMovements.referenceId, customerId));
      }
      if (productIds && Array.isArray(productIds)) {
        whereConditions.push(inArray(inventoryMovements.productId, productIds));
      }

      // Monthly seasonality analysis
      const monthlyPatterns = await db
        .select({
          month: sql`EXTRACT(month FROM ${inventoryMovements.createdAt})`,
          monthName: sql`TO_CHAR(${inventoryMovements.createdAt}, 'Month')`,
          totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
          totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          avgOrderValue: sql`AVG(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          uniqueCustomers: sql`COUNT(DISTINCT ${inventoryMovements.referenceId})`,
          topProduct: sql`
            MODE() WITHIN GROUP (ORDER BY ${inventoryMovements.productId})
          `
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(...whereConditions, categoryFilter ? eq(products.category, categoryFilter) : undefined))
        .groupBy(sql`EXTRACT(month FROM ${inventoryMovements.createdAt})`, sql`TO_CHAR(${inventoryMovements.createdAt}, 'Month')`)
        .orderBy(sql`EXTRACT(month FROM ${inventoryMovements.createdAt})`);

      // Weekly day patterns
      const weeklyPatterns = await db
        .select({
          dayOfWeek: sql`EXTRACT(dow FROM ${inventoryMovements.createdAt})`,
          dayName: sql`TO_CHAR(${inventoryMovements.createdAt}, 'Day')`,
          totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
          totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          avgOrderValue: sql`AVG(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(...whereConditions, categoryFilter ? eq(products.category, categoryFilter) : undefined))
        .groupBy(sql`EXTRACT(dow FROM ${inventoryMovements.createdAt})`, sql`TO_CHAR(${inventoryMovements.createdAt}, 'Day')`)
        .orderBy(sql`EXTRACT(dow FROM ${inventoryMovements.createdAt})`);

      // Hourly patterns
      const hourlyPatterns = await db
        .select({
          hour: sql`EXTRACT(hour FROM ${inventoryMovements.createdAt})`,
          totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
          totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(...whereConditions, categoryFilter ? eq(products.category, categoryFilter) : undefined))
        .groupBy(sql`EXTRACT(hour FROM ${inventoryMovements.createdAt})`)
        .orderBy(sql`EXTRACT(hour FROM ${inventoryMovements.createdAt})`);

      return {
        monthly: monthlyPatterns,
        weekly: weeklyPatterns,
        hourly: hourlyPatterns,
        insights: {
          peakMonth: monthlyPatterns.length > 0 ? 
            monthlyPatterns.reduce((max, curr) => 
              parseFloat(curr.totalValue) > parseFloat(max.totalValue) ? curr : max
            ) : null,
          peakDay: weeklyPatterns.length > 0 ? 
            weeklyPatterns.reduce((max, curr) => 
              parseFloat(curr.totalValue) > parseFloat(max.totalValue) ? curr : max
            ) : null,
          peakHour: hourlyPatterns.length > 0 ? 
            hourlyPatterns.reduce((max, curr) => 
              parseFloat(curr.totalValue) > parseFloat(max.totalValue) ? curr : max
            ) : null
        }
      };
    }, cacheKey, 900); // 15 minute cache
  }

  async analyzeProductAffinity(params = {}) {
    const {
      customerId = null,
      minSupport = 0.02, // 2% minimum support
      minConfidence = 0.3, // 30% minimum confidence
      dateFrom = null,
      dateTo = null
    } = params;

    const cacheKey = `product_affinity_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let whereConditions = [eq(inventoryMovements.movementType, 'sale')];
      
      if (customerId) {
        whereConditions.push(eq(inventoryMovements.referenceId, customerId));
      }
      if (dateFrom) {
        whereConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        whereConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));
      }

      // Basic product pair analysis - find products sold in same orders
      const productPairs = await db
        .select({
          productA: inventoryMovements.productId,
          productAName: products.name,
          productASku: products.sku,
          coOccurrences: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          support: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})::float / GREATEST((SELECT COUNT(DISTINCT reference_number) FROM inventory_movements WHERE movement_type = 'sale'), 1)`,
          confidence: sql`0.5`, // Placeholder - would need complex subquery
          lift: sql`1.5` // Placeholder - would need complex calculation
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(...whereConditions))
        .groupBy(inventoryMovements.productId, products.name, products.sku)
        .having(sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber}) >= 2`)
        .orderBy(desc(sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`))
        .limit(50);

      // Category co-occurrence analysis
      const categoryAffinity = await db
        .select({
          categoryA: products.category,
          coOccurrences: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          support: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})::float / GREATEST((SELECT COUNT(DISTINCT reference_number) FROM inventory_movements WHERE movement_type = 'sale'), 1)`,
          avgOrderValue: sql`AVG(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(
          ...whereConditions,
          sql`${products.category} IS NOT NULL`
        ))
        .groupBy(products.category)
        .having(sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber}) >= 3`)
        .orderBy(desc(sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`))
        .limit(20);

      return {
        productPairs: productPairs.filter(pair => parseFloat(pair.confidence) >= minConfidence),
        categoryAffinity,
        recommendations: productPairs
          .filter(pair => parseFloat(pair.support) >= minSupport)
          .slice(0, 20)
          .map(pair => ({
            recommendation: `Product ${pair.productAName} (${pair.productASku}) appears in ${pair.coOccurrences} orders`,
            confidence: parseFloat(pair.confidence),
            lift: parseFloat(pair.lift),
            support: parseFloat(pair.support)
          }))
      };
    }, cacheKey, 1800); // 30 minute cache
  }

  async analyzePurchaseCycles(params = {}) {
    const {
      customerId = null,
      productIds = null,
      segmentBy = 'customer' // customer, product, category
    } = params;

    const cacheKey = `purchase_cycles_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let whereConditions = [eq(inventoryMovements.movementType, 'sale')];
      
      if (customerId) {
        whereConditions.push(eq(inventoryMovements.referenceId, customerId));
      }
      if (productIds && Array.isArray(productIds)) {
        whereConditions.push(inArray(inventoryMovements.productId, productIds));
      }

      if (segmentBy === 'customer') {
        // Simplified customer purchase cycle analysis
        const customerCycles = await db
          .select({
            customerId: inventoryMovements.referenceId,
            customerName: customers.companyName,
            totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
            firstOrder: sql`MIN(${inventoryMovements.createdAt})`,
            lastOrder: sql`MAX(${inventoryMovements.createdAt})`,
            avgDaysBetweenOrders: sql`
              CASE 
                WHEN COUNT(DISTINCT ${inventoryMovements.referenceNumber}) > 1 
                THEN EXTRACT(days FROM MAX(${inventoryMovements.createdAt}) - MIN(${inventoryMovements.createdAt})) / 
                     (COUNT(DISTINCT ${inventoryMovements.referenceNumber}) - 1)
                ELSE NULL 
              END
            `,
            medianDaysBetweenOrders: sql`30.0`, // Placeholder
            predictedNextOrder: sql`MAX(${inventoryMovements.createdAt}) + INTERVAL '30 days'`, // Simplified
            totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
            avgOrderValue: sql`AVG(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`
          })
          .from(inventoryMovements)
          .innerJoin(customers, eq(inventoryMovements.referenceId, customers.id))
          .where(and(...whereConditions))
          .groupBy(inventoryMovements.referenceId, customers.companyName)
          .having(sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber}) >= 2`)
          .orderBy(desc(sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`))
          .limit(100);

        return { customers: customerCycles };
      }

      if (segmentBy === 'product') {
        // Simplified product replenishment cycle analysis
        const productCycles = await db
          .select({
            productId: products.id,
            productSku: products.sku,
            productName: products.name,
            category: products.category,
            uniqueCustomers: sql`COUNT(DISTINCT ${inventoryMovements.referenceId})`,
            totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
            avgDaysBetweenPurchases: sql`45.0`, // Placeholder
            medianDaysBetweenPurchases: sql`30.0`, // Placeholder
            repeatCustomerRate: sql`0.5`, // Placeholder
            totalQuantitySold: sql`SUM(ABS(${inventoryMovements.quantity}))`,
            totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`
          })
          .from(inventoryMovements)
          .innerJoin(products, eq(inventoryMovements.productId, products.id))
          .where(and(...whereConditions))
          .groupBy(products.id, products.sku, products.name, products.category)
          .orderBy(desc(sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`))
          .limit(50);

        return { products: productCycles };
      }

      if (segmentBy === 'category') {
        // Simplified category replenishment analysis
        const categoryCycles = await db
          .select({
            category: products.category,
            uniqueCustomers: sql`COUNT(DISTINCT ${inventoryMovements.referenceId})`,
            totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
            avgDaysBetweenPurchases: sql`30.0`, // Placeholder
            totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
            uniqueProducts: sql`COUNT(DISTINCT ${inventoryMovements.productId})`
          })
          .from(inventoryMovements)
          .innerJoin(products, eq(inventoryMovements.productId, products.id))
          .where(and(...whereConditions, sql`${products.category} IS NOT NULL`))
          .groupBy(products.category)
          .orderBy(desc(sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`));

        return { categories: categoryCycles };
      }

      return { error: 'Invalid segmentBy parameter' };
    }, cacheKey, 600); // 10 minute cache
  }

  async identifyTrendingProducts(params = {}) {
    const {
      timeWindow = '30_days', // 7_days, 30_days, 90_days
      customerId = null,
      categoryFilter = null,
      minGrowthRate = 0.1 // 10% minimum growth
    } = params;

    const cacheKey = `trending_products_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let days;
      switch (timeWindow) {
        case '7_days': days = 7; break;
        case '30_days': days = 30; break;
        case '90_days': days = 90; break;
        default: days = 30;
      }

      const currentPeriodStart = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      const previousPeriodStart = new Date(Date.now() - 2 * days * 24 * 60 * 60 * 1000);

      let whereConditions = [eq(inventoryMovements.movementType, 'sale')];
      if (customerId) {
        whereConditions.push(eq(inventoryMovements.referenceId, customerId));
      }

      // Current period metrics
      const currentPeriod = await db
        .select({
          productId: products.id,
          productSku: products.sku,
          productName: products.name,
          category: products.category,
          currentQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
          currentRevenue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          currentOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          currentCustomers: sql`COUNT(DISTINCT ${inventoryMovements.referenceId})`,
          avgUnitPrice: sql`AVG(${inventoryMovements.unitCost})`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(
          ...whereConditions,
          gte(inventoryMovements.createdAt, currentPeriodStart),
          categoryFilter ? eq(products.category, categoryFilter) : undefined
        ))
        .groupBy(products.id, products.sku, products.name, products.category);

      // Previous period metrics
      const previousPeriod = await db
        .select({
          productId: products.id,
          previousQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
          previousRevenue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          previousOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          previousCustomers: sql`COUNT(DISTINCT ${inventoryMovements.referenceId})`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(
          ...whereConditions,
          gte(inventoryMovements.createdAt, previousPeriodStart),
          lte(inventoryMovements.createdAt, currentPeriodStart),
          categoryFilter ? eq(products.category, categoryFilter) : undefined
        ))
        .groupBy(products.id);

      // Combine and calculate trends
      const trendingProducts = currentPeriod.map(current => {
        const previous = previousPeriod.find(p => p.productId === current.productId);
        
        if (!previous) {
          return {
            ...current,
            trend: 'new',
            quantityGrowth: null,
            revenueGrowth: null,
            orderGrowth: null,
            customerGrowth: null,
            trendScore: 100 // New products get high trend score
          };
        }

        const quantityGrowth = previous.previousQuantity > 0 ? 
          (current.currentQuantity - previous.previousQuantity) / previous.previousQuantity : 0;
        const revenueGrowth = previous.previousRevenue > 0 ? 
          (current.currentRevenue - previous.previousRevenue) / previous.previousRevenue : 0;
        const orderGrowth = previous.previousOrders > 0 ? 
          (current.currentOrders - previous.previousOrders) / previous.previousOrders : 0;
        const customerGrowth = previous.previousCustomers > 0 ? 
          (current.currentCustomers - previous.previousCustomers) / previous.previousCustomers : 0;

        // Calculate composite trend score
        const trendScore = (
          quantityGrowth * 0.3 + 
          revenueGrowth * 0.4 + 
          orderGrowth * 0.2 + 
          customerGrowth * 0.1
        ) * 100;

        return {
          ...current,
          ...previous,
          trend: trendScore > minGrowthRate * 100 ? 'rising' : 
                 trendScore < -minGrowthRate * 100 ? 'declining' : 'stable',
          quantityGrowth,
          revenueGrowth,
          orderGrowth,
          customerGrowth,
          trendScore
        };
      });

      // Sort by trend score and filter
      const trending = trendingProducts
        .filter(product => product.trendScore > minGrowthRate * 100 || product.trend === 'new')
        .sort((a, b) => b.trendScore - a.trendScore)
        .slice(0, 50);

      // Category trends
      const categoryTrends = {};
      trending.forEach(product => {
        if (product.category) {
          if (!categoryTrends[product.category]) {
            categoryTrends[product.category] = {
              category: product.category,
              trendingProducts: 0,
              avgTrendScore: 0,
              totalRevenue: 0
            };
          }
          categoryTrends[product.category].trendingProducts++;
          categoryTrends[product.category].avgTrendScore += product.trendScore;
          categoryTrends[product.category].totalRevenue += parseFloat(product.currentRevenue || 0);
        }
      });

      Object.keys(categoryTrends).forEach(category => {
        categoryTrends[category].avgTrendScore /= categoryTrends[category].trendingProducts;
      });

      return {
        trendingProducts: trending,
        categoryTrends: Object.values(categoryTrends).sort((a, b) => b.avgTrendScore - a.avgTrendScore),
        summary: {
          totalTrendingProducts: trending.length,
          newProducts: trending.filter(p => p.trend === 'new').length,
          risingProducts: trending.filter(p => p.trend === 'rising').length,
          avgTrendScore: trending.length > 0 ? 
            trending.reduce((sum, p) => sum + p.trendScore, 0) / trending.length : 0
        }
      };
    }, cacheKey, 300); // 5 minute cache
  }

  async analyzePeakPurchaseTimes(params = {}) {
    const {
      customerId = null,
      productIds = null,
      categoryFilter = null,
      timezone = 'UTC',
      dateFrom = null,
      dateTo = null
    } = params;

    const cacheKey = `peak_times_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let whereConditions = [eq(inventoryMovements.movementType, 'sale')];
      
      if (customerId) {
        whereConditions.push(eq(inventoryMovements.referenceId, customerId));
      }
      if (productIds && Array.isArray(productIds)) {
        whereConditions.push(inArray(inventoryMovements.productId, productIds));
      }
      if (dateFrom) {
        whereConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        whereConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));
      }

      // Hourly peak analysis - simplified without timezone
      const hourlyPeaks = await db
        .select({
          hour: sql`EXTRACT(hour FROM ${inventoryMovements.createdAt})`,
          totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
          totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          avgOrderValue: sql`AVG(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          uniqueCustomers: sql`COUNT(DISTINCT ${inventoryMovements.referenceId})`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(...whereConditions, categoryFilter ? eq(products.category, categoryFilter) : undefined))
        .groupBy(sql`EXTRACT(hour FROM ${inventoryMovements.createdAt})`)
        .orderBy(sql`EXTRACT(hour FROM ${inventoryMovements.createdAt})`);

      // Day of week analysis - simplified without timezone
      const weeklyPeaks = await db
        .select({
          dayOfWeek: sql`EXTRACT(dow FROM ${inventoryMovements.createdAt})`,
          dayName: sql`TO_CHAR(${inventoryMovements.createdAt}, 'Day')`,
          totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
          totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          avgOrderValue: sql`AVG(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          uniqueCustomers: sql`COUNT(DISTINCT ${inventoryMovements.referenceId})`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(...whereConditions, categoryFilter ? eq(products.category, categoryFilter) : undefined))
        .groupBy(
          sql`EXTRACT(dow FROM ${inventoryMovements.createdAt})`,
          sql`TO_CHAR(${inventoryMovements.createdAt}, 'Day')`
        )
        .orderBy(sql`EXTRACT(dow FROM ${inventoryMovements.createdAt})`);

      // Monthly day patterns - simplified without timezone
      const monthlyDayPeaks = await db
        .select({
          dayOfMonth: sql`EXTRACT(day FROM ${inventoryMovements.createdAt})`,
          totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          avgOrderValue: sql`AVG(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(...whereConditions, categoryFilter ? eq(products.category, categoryFilter) : undefined))
        .groupBy(sql`EXTRACT(day FROM ${inventoryMovements.createdAt})`)
        .orderBy(sql`EXTRACT(day FROM ${inventoryMovements.createdAt})`);

      // Calculate peak insights
      const peakHour = hourlyPeaks.length > 0 ? 
        hourlyPeaks.reduce((max, curr) => 
          parseFloat(curr.totalValue) > parseFloat(max.totalValue) ? curr : max
        ) : null;

      const peakDay = weeklyPeaks.length > 0 ? 
        weeklyPeaks.reduce((max, curr) => 
          parseFloat(curr.totalValue) > parseFloat(max.totalValue) ? curr : max
        ) : null;

      const peakMonthDay = monthlyDayPeaks.length > 0 ? 
        monthlyDayPeaks.reduce((max, curr) => 
          parseFloat(curr.totalValue) > parseFloat(max.totalValue) ? curr : max
        ) : null;

      return {
        hourlyPeaks,
        weeklyPeaks,
        monthlyDayPeaks,
        insights: {
          peakHour: peakHour ? {
            hour: peakHour.hour,
            description: `${peakHour.hour}:00`,
            totalValue: peakHour.totalValue,
            orderCount: peakHour.totalOrders
          } : null,
          peakDay: peakDay ? {
            dayOfWeek: peakDay.dayOfWeek,
            dayName: peakDay.dayName.trim(),
            totalValue: peakDay.totalValue,
            orderCount: peakDay.totalOrders
          } : null,
          peakMonthDay: peakMonthDay ? {
            dayOfMonth: peakMonthDay.dayOfMonth,
            description: `Day ${peakMonthDay.dayOfMonth} of month`,
            totalValue: peakMonthDay.totalValue,
            orderCount: peakMonthDay.totalOrders
          } : null,
          businessHours: {
            start: hourlyPeaks.filter(h => parseFloat(h.totalValue) > 0)
              .sort((a, b) => a.hour - b.hour)[0]?.hour || 9,
            end: hourlyPeaks.filter(h => parseFloat(h.totalValue) > 0)
              .sort((a, b) => b.hour - a.hour)[0]?.hour || 17
          }
        }
      };
    }, cacheKey, 600); // 10 minute cache
  }

  async getComprehensivePurchasePatterns(params = {}) {
    const {
      customerId = null,
      includeSeasonality = true,
      includeAffinity = true,
      includeCycles = true,
      includeTrending = true,
      includePeakTimes = true
    } = params;

    const cacheKey = `comprehensive_patterns_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      const patterns = {};

      if (includeSeasonality) {
        patterns.seasonality = await this.analyzeSeasonalPatterns(params);
      }

      if (includeAffinity) {
        patterns.productAffinity = await this.analyzeProductAffinity(params);
      }

      if (includeCycles) {
        patterns.purchaseCycles = await this.analyzePurchaseCycles(params);
      }

      if (includeTrending) {
        patterns.trendingProducts = await this.identifyTrendingProducts(params);
      }

      if (includePeakTimes) {
        patterns.peakTimes = await this.analyzePeakPurchaseTimes(params);
      }

      // Generate actionable insights
      const insights = this.generatePurchaseInsights(patterns);

      return {
        ...patterns,
        insights,
        metadata: {
          generatedAt: new Date().toISOString(),
          customerId,
          scope: customerId ? 'customer' : 'global'
        }
      };
    }, cacheKey, 1800); // 30 minute cache
  }

  generatePurchaseInsights(patterns) {
    const insights = [];

    // Seasonality insights
    if (patterns.seasonality?.data?.insights) {
      const { peakMonth, peakDay, peakHour } = patterns.seasonality.data.insights;
      if (peakMonth) {
        insights.push({
          type: 'seasonality',
          priority: 'high',
          message: `Peak sales occur in ${peakMonth.monthName} with ${peakMonth.totalOrders} orders and $${parseFloat(peakMonth.totalValue).toFixed(2)} revenue`,
          actionable: true,
          recommendation: 'Consider increasing inventory and marketing efforts before peak season'
        });
      }
    }

    // Product affinity insights
    if (patterns.productAffinity?.data?.recommendations) {
      const topRecommendations = patterns.productAffinity.data.recommendations.slice(0, 3);
      topRecommendations.forEach(rec => {
        insights.push({
          type: 'cross_sell',
          priority: 'medium',
          message: rec.recommendation,
          confidence: rec.confidence,
          actionable: true,
          recommendation: 'Implement product bundling or cross-sell campaigns'
        });
      });
    }

    // Purchase cycle insights
    if (patterns.purchaseCycles?.data?.customers) {
      const avgCycle = patterns.purchaseCycles.data.customers
        .filter(c => c.avgDaysBetweenOrders)
        .reduce((sum, c) => sum + parseFloat(c.avgDaysBetweenOrders), 0) / 
        patterns.purchaseCycles.data.customers.filter(c => c.avgDaysBetweenOrders).length;
      
      if (avgCycle) {
        insights.push({
          type: 'retention',
          priority: 'high',
          message: `Average purchase cycle is ${avgCycle.toFixed(1)} days`,
          actionable: true,
          recommendation: `Set up automated follow-up campaigns ${Math.floor(avgCycle * 0.8)} days after purchase`
        });
      }
    }

    // Trending product insights
    if (patterns.trendingProducts?.data?.summary) {
      const { totalTrendingProducts, newProducts, risingProducts } = patterns.trendingProducts.data.summary;
      if (totalTrendingProducts > 0) {
        insights.push({
          type: 'trending',
          priority: 'medium',
          message: `${totalTrendingProducts} products are trending (${newProducts} new, ${risingProducts} rising)`,
          actionable: true,
          recommendation: 'Focus marketing and inventory on trending products'
        });
      }
    }

    // Peak time insights
    if (patterns.peakTimes?.data?.insights) {
      const { peakHour, peakDay } = patterns.peakTimes.data.insights;
      if (peakHour && peakDay) {
        insights.push({
          type: 'timing',
          priority: 'low',
          message: `Peak purchase times: ${peakDay.dayName} at ${peakHour.description}`,
          actionable: true,
          recommendation: 'Schedule promotions and ensure staff availability during peak times'
        });
      }
    }

    return insights.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  // ==================== SUPPLIER ANALYTICS ====================

  async getSupplierPriceTrends(params = {}) {
    const {
      supplierId = null,
      productId = null,
      dateFrom = null,
      dateTo = null,
      timeframe = 'monthly' // daily, weekly, monthly
    } = params;

    const cacheKey = `supplier_price_trends_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      let whereConditions = [
        eq(inventoryMovements.movementType, 'purchase')
      ];

      if (supplierId) {
        whereConditions.push(eq(products.supplierId, supplierId));
      }
      if (productId) {
        whereConditions.push(eq(inventoryMovements.productId, productId));
      }
      if (dateFrom) {
        whereConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        whereConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));
      }

      // Get price trends data
      const priceTrends = await db
        .select({
          supplierId: products.supplierId,
          supplierName: suppliers.name,
          productId: products.id,
          productSku: products.sku,
          productName: products.name,
          period: sql`DATE_TRUNC('${timeframe === 'daily' ? 'day' : timeframe === 'weekly' ? 'week' : 'month'}', ${inventoryMovements.createdAt})`,
          avgPrice: sql`AVG(${inventoryMovements.unitCost})`,
          minPrice: sql`MIN(${inventoryMovements.unitCost})`,
          maxPrice: sql`MAX(${inventoryMovements.unitCost})`,
          totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
          orderCount: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          priceStdDev: sql`STDDEV(${inventoryMovements.unitCost})`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .innerJoin(suppliers, eq(products.supplierId, suppliers.id))
        .where(and(...whereConditions))
        .groupBy(
          products.supplierId, 
          suppliers.name, 
          products.id, 
          products.sku, 
          products.name,
          sql`DATE_TRUNC('${timeframe === 'daily' ? 'day' : timeframe === 'weekly' ? 'week' : 'month'}', ${inventoryMovements.createdAt})`
        )
        .orderBy(
          asc(products.supplierId),
          asc(products.id),
          asc(sql`DATE_TRUNC('${timeframe === 'daily' ? 'day' : timeframe === 'weekly' ? 'week' : 'month'}', ${inventoryMovements.createdAt})`)
        );

      // Calculate trends and volatility
      const processedData = this.processPriceTrends(priceTrends);

      // Get supplier comparisons
      const supplierComparisons = await this.calculateSupplierPriceComparisons(priceTrends);

      return {
        trends: processedData,
        comparisons: supplierComparisons,
        summary: {
          totalSuppliers: [...new Set(priceTrends.map(t => t.supplierId))].length,
          totalProducts: [...new Set(priceTrends.map(t => t.productId))].length,
          dateRange: { dateFrom, dateTo },
          timeframe,
          generatedAt: new Date().toISOString()
        }
      };
    }, cacheKey, 900); // 15 minute cache
  }

  async getSupplierScorecard(supplierId, params = {}) {
    const {
      dateFrom = null,
      dateTo = null,
      includeRecommendations = true
    } = params;

    const cacheKey = `supplier_scorecard_${supplierId}_${JSON.stringify(params)}`;
    
    return await this.executeWithCache(async () => {
      // Get supplier basic info
      const supplierInfo = await db
        .select()
        .from(suppliers)
        .where(eq(suppliers.id, supplierId))
        .limit(1);

      if (supplierInfo.length === 0) {
        throw new Error(`Supplier with ID ${supplierId} not found`);
      }

      let whereConditions = [
        eq(products.supplierId, supplierId),
        eq(inventoryMovements.movementType, 'purchase')
      ];

      if (dateFrom) {
        whereConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        whereConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));
      }

      // Get performance metrics
      const performanceMetrics = await db
        .select({
          totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
          totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
          avgOrderValue: sql`AVG(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
          avgUnitPrice: sql`AVG(${inventoryMovements.unitCost})`,
          productCount: sql`COUNT(DISTINCT ${products.id})`,
          priceVolatility: sql`STDDEV(${inventoryMovements.unitCost}) / AVG(${inventoryMovements.unitCost})`,
          firstOrderDate: sql`MIN(${inventoryMovements.createdAt})`,
          lastOrderDate: sql`MAX(${inventoryMovements.createdAt})`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(...whereConditions));

      // Get delivery performance (simulated - would need actual delivery data)
      const deliveryMetrics = {
        onTimeDeliveryRate: 0.85 + Math.random() * 0.15, // 85-100%
        averageDeliveryDays: 3 + Math.random() * 7, // 3-10 days
        qualityScore: 0.8 + Math.random() * 0.2 // 80-100%
      };

      // Calculate scores
      const scores = await this.calculateSupplierScores(supplierInfo[0], performanceMetrics[0], deliveryMetrics);

      // Get trend analysis
      const trendAnalysis = await this.analyzeSupplierTrends(supplierId, dateFrom, dateTo);

      // Generate recommendations
      const recommendations = includeRecommendations ? 
        await this.generateSupplierRecommendations(scores, performanceMetrics[0], deliveryMetrics) : [];

      return {
        supplier: supplierInfo[0],
        performance: performanceMetrics[0],
        delivery: deliveryMetrics,
        scores,
        trends: trendAnalysis,
        recommendations,
        metadata: {
          dateRange: { dateFrom, dateTo },
          generatedAt: new Date().toISOString(),
          dataPoints: performanceMetrics[0].totalOrders
        }
      };
    }, cacheKey, 900); // 15 minute cache
  }

  // Helper methods for supplier analytics

  processPriceTrends(trends) {
    const groupedByProduct = trends.reduce((acc, trend) => {
      const key = `${trend.productId}`;
      if (!acc[key]) {
        acc[key] = {
          productId: trend.productId,
          productSku: trend.productSku,
          productName: trend.productName,
          supplierId: trend.supplierId,
          supplierName: trend.supplierName,
          periods: []
        };
      }
      
      acc[key].periods.push({
        period: trend.period,
        avgPrice: parseFloat(trend.avgPrice),
        minPrice: parseFloat(trend.minPrice),
        maxPrice: parseFloat(trend.maxPrice),
        totalQuantity: parseInt(trend.totalQuantity),
        orderCount: parseInt(trend.orderCount),
        priceVolatility: parseFloat(trend.priceStdDev) / parseFloat(trend.avgPrice) || 0
      });
      
      return acc;
    }, {});

    // Calculate trend indicators for each product
    return Object.values(groupedByProduct).map(product => {
      const sortedPeriods = product.periods.sort((a, b) => new Date(a.period) - new Date(b.period));
      const trendIndicators = this.calculateTrendIndicators(sortedPeriods);
      
      return {
        ...product,
        periods: sortedPeriods,
        trendIndicators
      };
    });
  }

  calculateTrendIndicators(periods) {
    if (periods.length < 2) {
      return { trend: 'insufficient_data', changePercent: 0 };
    }

    const prices = periods.map(p => p.avgPrice);
    const recentPrice = prices[prices.length - 1];
    const previousPrice = prices[prices.length - 2];
    const firstPrice = prices[0];

    const recentChange = ((recentPrice - previousPrice) / previousPrice) * 100;
    const overallChange = ((recentPrice - firstPrice) / firstPrice) * 100;

    return {
      trend: recentChange > 5 ? 'increasing' : recentChange < -5 ? 'decreasing' : 'stable',
      recentChangePercent: recentChange,
      overallChangePercent: overallChange,
      volatility: this.calculateVolatility(prices),
      periods: periods.length
    };
  }

  calculateVolatility(prices) {
    if (prices.length < 2) return 0;
    
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const variance = prices.reduce((sum, price) => sum + Math.pow(price - mean, 2), 0) / prices.length;
    const stdDev = Math.sqrt(variance);
    
    return (stdDev / mean) * 100; // Coefficient of variation as percentage
  }

  async calculateSupplierPriceComparisons(trends) {
    const productComparisons = {};
    
    trends.forEach(trend => {
      const productKey = trend.productId;
      if (!productComparisons[productKey]) {
        productComparisons[productKey] = {
          productId: trend.productId,
          productSku: trend.productSku,
          productName: trend.productName,
          suppliers: []
        };
      }
      
      const existingSupplier = productComparisons[productKey].suppliers.find(s => s.supplierId === trend.supplierId);
      if (!existingSupplier) {
        productComparisons[productKey].suppliers.push({
          supplierId: trend.supplierId,
          supplierName: trend.supplierName,
          avgPrice: parseFloat(trend.avgPrice),
          minPrice: parseFloat(trend.minPrice),
          maxPrice: parseFloat(trend.maxPrice),
          totalQuantity: parseInt(trend.totalQuantity)
        });
      }
    });

    // Calculate rankings for each product
    return Object.values(productComparisons).map(product => {
      const rankedSuppliers = product.suppliers
        .sort((a, b) => a.avgPrice - b.avgPrice)
        .map((supplier, index) => ({
          ...supplier,
          priceRank: index + 1,
          priceDifferenceFromBest: supplier.avgPrice - product.suppliers[0].avgPrice,
          priceDifferencePercent: ((supplier.avgPrice - product.suppliers[0].avgPrice) / product.suppliers[0].avgPrice) * 100
        }));

      return {
        ...product,
        suppliers: rankedSuppliers,
        bestPrice: rankedSuppliers[0].avgPrice,
        worstPrice: rankedSuppliers[rankedSuppliers.length - 1].avgPrice,
        priceRange: rankedSuppliers[rankedSuppliers.length - 1].avgPrice - rankedSuppliers[0].avgPrice
      };
    });
  }

  async calculateSupplierScores(supplier, performance, delivery) {
    const scores = {
      overall: 0,
      cost: 0,
      quality: 0,
      delivery: 0,
      reliability: 0
    };

    // Cost score (lower prices = higher score)
    const industryAvgPrice = 50; // Would be calculated from industry data
    const priceScore = Math.max(0, 100 - ((performance.avgUnitPrice - industryAvgPrice) / industryAvgPrice) * 100);
    scores.cost = Math.min(100, Math.max(0, priceScore));

    // Quality score
    scores.quality = delivery.qualityScore * 100;

    // Delivery score
    const deliveryScore = (delivery.onTimeDeliveryRate * 0.7) + ((10 - delivery.averageDeliveryDays) / 10 * 0.3);
    scores.delivery = Math.min(100, Math.max(0, deliveryScore * 100));

    // Reliability score (based on order consistency and volatility)
    const volatilityPenalty = (performance.priceVolatility || 0) * 100;
    const reliabilityScore = Math.max(0, 100 - volatilityPenalty);
    scores.reliability = reliabilityScore;

    // Overall score (weighted average)
    scores.overall = (scores.cost * 0.3) + (scores.quality * 0.25) + (scores.delivery * 0.25) + (scores.reliability * 0.2);

    // Round all scores
    Object.keys(scores).forEach(key => {
      scores[key] = Math.round(scores[key] * 10) / 10;
    });

    return scores;
  }

  async analyzeSupplierTrends(supplierId, dateFrom, dateTo) {
    // Simplified trend analysis - would be more complex in real implementation
    return {
      orderVolumetrend: 'increasing',
      pricetrend: 'stable',
      qualitytrend: 'improving',
      performancetrend: 'stable'
    };
  }

  async generateSupplierRecommendations(scores, performance, delivery) {
    const recommendations = [];

    if (scores.cost < 70) {
      recommendations.push({
        type: 'cost',
        priority: 'high',
        title: 'Price Optimization Opportunity',
        description: 'This supplier\'s pricing is above market average. Consider negotiating better rates or exploring alternative suppliers.',
        impact: 'cost_reduction'
      });
    }

    if (scores.delivery < 80) {
      recommendations.push({
        type: 'delivery',
        priority: 'medium',
        title: 'Delivery Performance Improvement',
        description: 'Delivery performance could be improved. Work with supplier on logistics optimization.',
        impact: 'operational_efficiency'
      });
    }

    if (scores.quality < 85) {
      recommendations.push({
        type: 'quality',
        priority: 'high',
        title: 'Quality Management Required',
        description: 'Quality scores indicate need for improved quality control processes.',
        impact: 'quality_improvement'
      });
    }

    if (scores.overall > 85) {
      recommendations.push({
        type: 'strategic',
        priority: 'low',
        title: 'Strategic Partnership Opportunity',
        description: 'Excellent performance indicates potential for expanded partnership and volume discounts.',
        impact: 'strategic_advantage'
      });
    }

    return recommendations;
  }

  // ==================== SUPPLIER ANALYTICS ====================

  /**
   * Get comprehensive supplier performance metrics
   * Analyzes on-time delivery, fulfillment rates, price stability, and quality scores
   */
  async getSupplierPerformance(params = {}) {
    const {
      supplierId = null,
      dateFrom = null,
      dateTo = null,
      performanceThreshold = 80,
      includeRankings = true,
      includeComparisons = true
    } = params;

    const cacheKey = `supplier_performance:${supplierId || 'all'}:${dateFrom}:${dateTo}:${performanceThreshold}`;
    
    return await this.executeWithCache(async () => {
      const baseDate = dateTo ? new Date(dateTo) : new Date();
      const startDate = dateFrom ? new Date(dateFrom) : new Date(baseDate.getTime() - 90 * 24 * 60 * 60 * 1000);

      // Build supplier filter condition
      const supplierCondition = supplierId ? eq(suppliers.id, supplierId) : undefined;
      const dateCondition = and(
        gte(inventoryMovements.createdAt, startDate),
        lte(inventoryMovements.createdAt, baseDate)
      );

      // Get supplier performance data from multiple sources
      const [supplierBasics, deliveryMetrics, priceMetrics, qualityMetrics] = await Promise.all([
        // Basic supplier information and current metrics
        db.select({
          id: suppliers.id,
          supplierCode: suppliers.supplierCode,
          companyName: suppliers.companyName,
          performanceRating: suppliers.performanceRating,
          leadTimeDays: suppliers.leadTimeDays,
          isActive: suppliers.isActive,
          isApproved: suppliers.isApproved,
          supplierType: suppliers.supplierType,
          industry: suppliers.industry
        })
        .from(suppliers)
        .where(supplierCondition || sql`1=1`)
        .orderBy(desc(suppliers.performanceRating)),

        // Delivery performance metrics from inventory movements (purchases)
        db.select({
          supplierId: products.supplierId,
          totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceId})::integer`,
          totalQuantity: sql`SUM(${inventoryMovements.quantity})::integer`,
          averageOrderSize: sql`AVG(${inventoryMovements.quantity})::numeric(10,2)`,
          totalValue: sql`SUM(${inventoryMovements.totalCost})::numeric(12,2)`,
          averageUnitCost: sql`AVG(${inventoryMovements.unitCost})::numeric(10,2)`,
          onTimeDeliveries: sql`COUNT(CASE WHEN ${inventoryMovements.createdAt} <= ${inventoryMovements.createdAt} THEN 1 END)::integer`,
          lastOrderDate: sql`MAX(${inventoryMovements.createdAt})`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(
          eq(inventoryMovements.movementType, 'purchase'),
          dateCondition,
          supplierCondition ? eq(products.supplierId, supplierId) : sql`1=1`
        ))
        .groupBy(products.supplierId),

        // Price stability metrics from price lists
        db.select({
          supplierId: priceLists.supplierId,
          priceUpdates: sql`COUNT(*)::integer`,
          averagePriceChange: sql`AVG(CASE WHEN ${priceLists.updatedAt} > ${priceLists.createdAt} THEN 1 ELSE 0 END)::numeric(5,2)`,
          latestPriceUpdate: sql`MAX(${priceLists.updatedAt})`,
          activePriceLists: sql`COUNT(CASE WHEN ${priceLists.status} = 'active' THEN 1 END)::integer`
        })
        .from(priceLists)
        .where(and(
          gte(priceLists.createdAt, startDate),
          lte(priceLists.createdAt, baseDate),
          supplierCondition ? eq(priceLists.supplierId, supplierId) : sql`1=1`
        ))
        .groupBy(priceLists.supplierId),

        // Quality metrics from analytics aggregates
        db.select({
          supplierId: sql`${analyticsDailyAggregates.dimensionId}::uuid`,
          qualityScore: sql`AVG(${analyticsDailyAggregates.qualityScore})::numeric(5,2)`,
          defectRate: sql`AVG(${analyticsDailyAggregates.defectRate})::numeric(5,4)`,
          returnRate: sql`AVG(${analyticsDailyAggregates.returnRate})::numeric(5,4)`,
          customerSatisfaction: sql`AVG(${analyticsDailyAggregates.customerSatisfactionScore})::numeric(5,2)`
        })
        .from(analyticsDailyAggregates)
        .where(and(
          eq(analyticsDailyAggregates.dimension, 'supplier'),
          gte(analyticsDailyAggregates.date, startDate.toISOString().split('T')[0]),
          lte(analyticsDailyAggregates.date, baseDate.toISOString().split('T')[0]),
          supplierCondition ? eq(analyticsDailyAggregates.dimensionId, supplierId) : sql`1=1`
        ))
        .groupBy(analyticsDailyAggregates.dimensionId)
      ]);

      // Process and combine metrics
      const supplierPerformanceMap = new Map();

      // Initialize with basic supplier data
      supplierBasics.forEach(supplier => {
        supplierPerformanceMap.set(supplier.id, {
          supplier: {
            id: supplier.id,
            code: supplier.supplierCode,
            name: supplier.companyName,
            type: supplier.supplierType,
            industry: supplier.industry,
            isActive: supplier.isActive,
            isApproved: supplier.isApproved,
            leadTimeDays: supplier.leadTimeDays
          },
          performance: {
            currentRating: parseFloat(supplier.performanceRating) || 0,
            onTimeDeliveryRate: 0,
            orderFulfillmentRate: 0,
            priceStability: 0,
            qualityScore: 0,
            overallScore: 0
          },
          metrics: {
            totalOrders: 0,
            totalValue: 0,
            averageOrderSize: 0,
            averageUnitCost: 0,
            lastOrderDate: null,
            priceUpdates: 0,
            defectRate: 0,
            returnRate: 0
          },
          trends: {
            orderVolumeChange: 0,
            priceChangeFrequency: 0,
            qualityTrend: 'stable'
          }
        });
      });

      // Add delivery metrics
      deliveryMetrics.forEach(metric => {
        if (supplierPerformanceMap.has(metric.supplierId)) {
          const supplier = supplierPerformanceMap.get(metric.supplierId);
          const onTimeRate = metric.totalOrders > 0 ? (metric.onTimeDeliveries / metric.totalOrders) * 100 : 0;
          const fulfillmentRate = metric.totalQuantity > 0 ? Math.min(100, (metric.totalQuantity / metric.totalQuantity) * 100) : 0;
          
          supplier.performance.onTimeDeliveryRate = parseFloat(onTimeRate.toFixed(2));
          supplier.performance.orderFulfillmentRate = parseFloat(fulfillmentRate.toFixed(2));
          supplier.metrics.totalOrders = metric.totalOrders;
          supplier.metrics.totalValue = parseFloat(metric.totalValue) || 0;
          supplier.metrics.averageOrderSize = parseFloat(metric.averageOrderSize) || 0;
          supplier.metrics.averageUnitCost = parseFloat(metric.averageUnitCost) || 0;
          supplier.metrics.lastOrderDate = metric.lastOrderDate;
        }
      });

      // Add price stability metrics
      priceMetrics.forEach(metric => {
        if (supplierPerformanceMap.has(metric.supplierId)) {
          const supplier = supplierPerformanceMap.get(metric.supplierId);
          const priceStability = Math.max(0, 100 - (metric.priceUpdates * 10)); // Fewer updates = more stable
          
          supplier.performance.priceStability = parseFloat(priceStability.toFixed(2));
          supplier.metrics.priceUpdates = metric.priceUpdates;
          supplier.trends.priceChangeFrequency = parseFloat(metric.averagePriceChange) || 0;
        }
      });

      // Add quality metrics
      qualityMetrics.forEach(metric => {
        if (supplierPerformanceMap.has(metric.supplierId)) {
          const supplier = supplierPerformanceMap.get(metric.supplierId);
          
          supplier.performance.qualityScore = parseFloat(metric.qualityScore) || 0;
          supplier.metrics.defectRate = parseFloat(metric.defectRate) || 0;
          supplier.metrics.returnRate = parseFloat(metric.returnRate) || 0;
        }
      });

      // Calculate overall performance scores
      const performanceData = Array.from(supplierPerformanceMap.values()).map(supplier => {
        const weights = {
          onTimeDelivery: 0.3,
          fulfillment: 0.25,
          priceStability: 0.2,
          quality: 0.25
        };

        const overallScore = (
          supplier.performance.onTimeDeliveryRate * weights.onTimeDelivery +
          supplier.performance.orderFulfillmentRate * weights.fulfillment +
          supplier.performance.priceStability * weights.priceStability +
          supplier.performance.qualityScore * weights.quality
        );

        supplier.performance.overallScore = parseFloat(overallScore.toFixed(2));

        // Determine performance status
        supplier.performance.status = overallScore >= performanceThreshold ? 'excellent' :
                                     overallScore >= 70 ? 'good' :
                                     overallScore >= 50 ? 'fair' : 'poor';

        return supplier;
      });

      // Sort by overall performance score
      performanceData.sort((a, b) => b.performance.overallScore - a.performance.overallScore);

      // Add rankings if requested
      if (includeRankings) {
        performanceData.forEach((supplier, index) => {
          supplier.ranking = {
            overall: index + 1,
            onTimeDelivery: 0,
            quality: 0,
            priceStability: 0
          };
        });

        // Calculate individual metric rankings
        const onTimeRanked = [...performanceData].sort((a, b) => b.performance.onTimeDeliveryRate - a.performance.onTimeDeliveryRate);
        const qualityRanked = [...performanceData].sort((a, b) => b.performance.qualityScore - a.performance.qualityScore);
        const priceRanked = [...performanceData].sort((a, b) => b.performance.priceStability - a.performance.priceStability);

        onTimeRanked.forEach((supplier, index) => {
          const original = performanceData.find(s => s.supplier.id === supplier.supplier.id);
          if (original) original.ranking.onTimeDelivery = index + 1;
        });

        qualityRanked.forEach((supplier, index) => {
          const original = performanceData.find(s => s.supplier.id === supplier.supplier.id);
          if (original) original.ranking.quality = index + 1;
        });

        priceRanked.forEach((supplier, index) => {
          const original = performanceData.find(s => s.supplier.id === supplier.supplier.id);
          if (original) original.ranking.priceStability = index + 1;
        });
      }

      // Generate summary statistics
      const summary = {
        totalSuppliers: performanceData.length,
        averagePerformanceScore: performanceData.length > 0 ? 
          parseFloat((performanceData.reduce((sum, s) => sum + s.performance.overallScore, 0) / performanceData.length).toFixed(2)) : 0,
        suppliersAboveThreshold: performanceData.filter(s => s.performance.overallScore >= performanceThreshold).length,
        topPerformer: performanceData[0] || null,
        performanceDistribution: {
          excellent: performanceData.filter(s => s.performance.status === 'excellent').length,
          good: performanceData.filter(s => s.performance.status === 'good').length,
          fair: performanceData.filter(s => s.performance.status === 'fair').length,
          poor: performanceData.filter(s => s.performance.status === 'poor').length
        },
        keyMetrics: {
          averageOnTimeRate: performanceData.length > 0 ? 
            parseFloat((performanceData.reduce((sum, s) => sum + s.performance.onTimeDeliveryRate, 0) / performanceData.length).toFixed(2)) : 0,
          averageQualityScore: performanceData.length > 0 ? 
            parseFloat((performanceData.reduce((sum, s) => sum + s.performance.qualityScore, 0) / performanceData.length).toFixed(2)) : 0,
          totalOrderValue: performanceData.reduce((sum, s) => sum + s.metrics.totalValue, 0)
        }
      };

      return {
        suppliers: performanceData,
        summary,
        filters: {
          supplierId,
          dateFrom: startDate.toISOString(),
          dateTo: baseDate.toISOString(),
          performanceThreshold,
          includeRankings,
          includeComparisons
        },
        generatedAt: new Date().toISOString()
      };
    }, cacheKey, 900); // 15-minute cache
  }

  // ==================== SUPPLIER RANKING SYSTEM ====================

  /**
   * Calculate comprehensive supplier rankings using multi-factor scoring
   * @param {Object} options - Filtering and configuration options
   * @param {string} options.dateFrom - Start date for analysis period
   * @param {string} options.dateTo - End date for analysis period
   * @param {string[]} options.supplierIds - Specific supplier IDs to analyze
   * @param {string[]} options.categories - Product categories to filter by
   * @param {number} options.minTransactions - Minimum transactions for inclusion
   * @returns {Object} Comprehensive supplier rankings and scores
   */
  async getSupplierRankings(options = {}) {
    const cacheKey = `supplier_rankings_${JSON.stringify(options)}`;
    
    return await this.executeWithCache(async () => {
      const correlationId = this.generateCorrelationId();
      const startTime = Date.now();
      
      try {
        this.trackQuery(correlationId, 'getSupplierRankings', options, startTime);
        
        const {
          dateFrom = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
          dateTo = new Date().toISOString(),
          supplierIds,
          categories,
          minTransactions = 5
        } = options;

        // Get base supplier data with transaction metrics
        const supplierMetrics = await this._getSupplierBaseMetrics(dateFrom, dateTo, supplierIds, categories, minTransactions);
        
        // Calculate individual scoring components
        const scoredSuppliers = await Promise.all(
          supplierMetrics.map(async (supplier) => {
            const [
              priceScore,
              deliveryScore,
              qualityScore,
              reliabilityScore,
              paymentScore
            ] = await Promise.all([
              this._calculatePriceCompetitivenessScore(supplier, supplierMetrics),
              this._calculateDeliveryPerformanceScore(supplier, dateFrom, dateTo),
              this._calculateQualityMetricsScore(supplier, dateFrom, dateTo),
              this._calculateReliabilityScore(supplier, dateFrom, dateTo),
              this._calculatePaymentTermsScore(supplier)
            ]);

            // Calculate weighted overall score (0-100)
            const overallScore = Math.round(
              (priceScore * 0.30) +      // 30% weight
              (deliveryScore * 0.25) +   // 25% weight
              (qualityScore * 0.20) +    // 20% weight
              (reliabilityScore * 0.15) + // 15% weight
              (paymentScore * 0.10)      // 10% weight
            );

            return {
              ...supplier,
              scores: {
                overall: overallScore,
                priceCompetitiveness: priceScore,
                deliveryPerformance: deliveryScore,
                qualityMetrics: qualityScore,
                reliability: reliabilityScore,
                paymentTerms: paymentScore
              },
              ranking: 0, // Will be set after sorting
              tier: this._getSupplierTier(overallScore),
              recommendations: this._generateSupplierRecommendations(overallScore, {
                priceScore, deliveryScore, qualityScore, reliabilityScore, paymentScore
              })
            };
          })
        );

        // Sort by overall score and assign rankings
        const rankedSuppliers = scoredSuppliers
          .sort((a, b) => b.scores.overall - a.scores.overall)
          .map((supplier, index) => ({
            ...supplier,
            ranking: index + 1
          }));

        // Generate category rankings
        const categoryRankings = await this._getSupplierCategoryRankings(rankedSuppliers, categories);
        
        // Calculate ranking changes over time
        const rankingChanges = await this._calculateRankingChanges(rankedSuppliers, dateFrom, dateTo);

        const duration = Date.now() - startTime;
        this.finishQuery(correlationId, duration, rankedSuppliers.length);

        return {
          suppliers: rankedSuppliers,
          categoryRankings,
          rankingChanges,
          summary: {
            totalSuppliers: rankedSuppliers.length,
            averageScore: Math.round(rankedSuppliers.reduce((sum, s) => sum + s.scores.overall, 0) / rankedSuppliers.length),
            topPerformers: rankedSuppliers.filter(s => s.scores.overall >= 80).length,
            underperformers: rankedSuppliers.filter(s => s.scores.overall < 60).length,
            analysisperiod: { dateFrom, dateTo },
            generatedAt: new Date().toISOString()
          },
          alerts: this._generateSupplierAlerts(rankedSuppliers)
        };

      } catch (error) {
        console.error('Error calculating supplier rankings:', error);
        throw error;
      }
    }, cacheKey, 300); // 5-minute cache
  }

  /**
   * Get base supplier metrics from database
   */
  async _getSupplierBaseMetrics(dateFrom, dateTo, supplierIds, categories, minTransactions) {
    const whereConditions = [
      gte(inventoryMovements.createdAt, new Date(dateFrom)),
      lte(inventoryMovements.createdAt, new Date(dateTo)),
      eq(inventoryMovements.movementType, 'purchase') // Focus on purchases from suppliers
    ];

    if (supplierIds?.length > 0) {
      whereConditions.push(inArray(suppliers.id, supplierIds));
    }

    const query = db
      .select({
        supplierId: suppliers.id,
        supplierCode: suppliers.supplierCode,
        companyName: suppliers.companyName,
        supplierType: suppliers.supplierType,
        paymentTerms: suppliers.paymentTerms,
        creditLimit: suppliers.creditLimit,
        
        // Transaction metrics
        totalTransactions: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
        totalValue: sql`SUM(${inventoryMovements.quantity} * ${inventoryMovements.unitCost})`,
        averageOrderValue: sql`AVG(${inventoryMovements.quantity} * ${inventoryMovements.unitCost})`,
        totalQuantity: sql`SUM(${inventoryMovements.quantity})`,
        
        // Product diversity
        uniqueProducts: sql`COUNT(DISTINCT ${inventoryMovements.productId})`,
        
        // Timing metrics
        firstTransaction: sql`MIN(${inventoryMovements.createdAt})`,
        lastTransaction: sql`MAX(${inventoryMovements.createdAt})`,
        averageOrderInterval: sql`
          AVG(EXTRACT(days FROM ${inventoryMovements.createdAt} - 
            LAG(${inventoryMovements.createdAt}) 
            OVER (PARTITION BY ${suppliers.id} ORDER BY ${inventoryMovements.createdAt})
          ))
        `,
        
        // Quality indicators (based on returns/adjustments)
        returnTransactions: sql`
          COUNT(CASE WHEN ${inventoryMovements.movementType} = 'return' THEN 1 END)
        `,
        adjustmentTransactions: sql`
          COUNT(CASE WHEN ${inventoryMovements.movementType} = 'adjustment' THEN 1 END)
        `
      })
      .from(inventoryMovements)
      .innerJoin(suppliers, eq(inventoryMovements.referenceId, suppliers.id))
      .leftJoin(products, eq(inventoryMovements.productId, products.id))
      .where(and(...whereConditions))
      .groupBy(
        suppliers.id,
        suppliers.supplierCode,
        suppliers.companyName,
        suppliers.supplierType,
        suppliers.paymentTerms,
        suppliers.creditLimit
      )
      .having(sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber}) >= ${minTransactions}`)
      .orderBy(desc(sql`SUM(${inventoryMovements.quantity} * ${inventoryMovements.unitCost})`));

    return await query;
  }

  /**
   * Calculate price competitiveness score (0-100)
   * Compares supplier's average prices against market average
   */
  async _calculatePriceCompetitivenessScore(supplier, allSuppliers) {
    try {
      const marketAverage = allSuppliers.reduce((sum, s) => sum + parseFloat(s.averageOrderValue || 0), 0) / allSuppliers.length;
      const supplierAverage = parseFloat(supplier.averageOrderValue || 0);
      
      if (marketAverage === 0 || supplierAverage === 0) return 50; // Neutral score if no data
      
      // Better score for lower prices (more competitive)
      const priceRatio = supplierAverage / marketAverage;
      
      if (priceRatio <= 0.8) return 100; // 20% below market = perfect score
      if (priceRatio <= 0.9) return 85;  // 10% below market = excellent
      if (priceRatio <= 1.0) return 75;  // At market price = good
      if (priceRatio <= 1.1) return 60;  // 10% above market = fair
      if (priceRatio <= 1.2) return 40;  // 20% above market = poor
      return 20; // More than 20% above market = very poor
      
    } catch (error) {
      console.error('Error calculating price competitiveness:', error);
      return 50; // Default neutral score
    }
  }

  /**
   * Calculate delivery performance score (0-100)
   * Based on delivery reliability and speed
   */
  async _calculateDeliveryPerformanceScore(supplier, dateFrom, dateTo) {
    try {
      // Get detailed delivery metrics
      const deliveryMetrics = await db
        .select({
          averageDeliveryDays: sql`
            AVG(EXTRACT(days FROM ${inventoryMovements.createdAt} - ${inventoryMovements.expectedDate}))
          `,
          onTimeDeliveries: sql`
            COUNT(CASE WHEN ${inventoryMovements.createdAt} <= ${inventoryMovements.expectedDate} THEN 1 END)
          `,
          totalDeliveries: sql`COUNT(*)`,
          consistencyScore: sql`
            CASE WHEN STDDEV(EXTRACT(days FROM ${inventoryMovements.createdAt} - ${inventoryMovements.expectedDate})) < 2 THEN 100
                 WHEN STDDEV(EXTRACT(days FROM ${inventoryMovements.createdAt} - ${inventoryMovements.expectedDate})) < 5 THEN 80
                 WHEN STDDEV(EXTRACT(days FROM ${inventoryMovements.createdAt} - ${inventoryMovements.expectedDate})) < 10 THEN 60
                 ELSE 40
            END
          `
        })
        .from(inventoryMovements)
        .where(and(
          eq(inventoryMovements.referenceId, supplier.supplierId),
          eq(inventoryMovements.movementType, 'purchase'),
          gte(inventoryMovements.createdAt, new Date(dateFrom)),
          lte(inventoryMovements.createdAt, new Date(dateTo))
        ));

      if (!deliveryMetrics[0] || deliveryMetrics[0].totalDeliveries === 0) return 50;

      const metrics = deliveryMetrics[0];
      const onTimeRate = (parseInt(metrics.onTimeDeliveries) / parseInt(metrics.totalDeliveries)) * 100;
      const avgDelay = parseFloat(metrics.averageDeliveryDays) || 0;
      const consistency = parseInt(metrics.consistencyScore) || 50;

      // Calculate weighted delivery score
      let deliveryScore = 0;
      
      // On-time delivery rate (60% weight)
      if (onTimeRate >= 95) deliveryScore += 60;
      else if (onTimeRate >= 90) deliveryScore += 50;
      else if (onTimeRate >= 80) deliveryScore += 40;
      else if (onTimeRate >= 70) deliveryScore += 30;
      else deliveryScore += 20;

      // Average delivery performance (25% weight)
      if (avgDelay <= 0) deliveryScore += 25; // Early delivery
      else if (avgDelay <= 1) deliveryScore += 20; // 1 day late
      else if (avgDelay <= 3) deliveryScore += 15; // 2-3 days late
      else if (avgDelay <= 7) deliveryScore += 10; // Up to 1 week late
      else deliveryScore += 5; // More than 1 week late

      // Consistency (15% weight)
      deliveryScore += (consistency * 0.15);

      return Math.min(100, Math.round(deliveryScore));

    } catch (error) {
      console.error('Error calculating delivery performance:', error);
      return 50;
    }
  }

  /**
   * Calculate quality metrics score (0-100)
   * Based on return rates, adjustments, and damage reports
   */
  async _calculateQualityMetricsScore(supplier, dateFrom, dateTo) {
    try {
      const totalTransactions = parseInt(supplier.totalTransactions) || 1;
      const returnTransactions = parseInt(supplier.returnTransactions) || 0;
      const adjustmentTransactions = parseInt(supplier.adjustmentTransactions) || 0;

      // Calculate quality indicators
      const returnRate = (returnTransactions / totalTransactions) * 100;
      const adjustmentRate = (adjustmentTransactions / totalTransactions) * 100;
      const totalIssueRate = returnRate + adjustmentRate;

      // Score based on issue rates
      let qualityScore = 100;

      // Deduct points for returns (more severe)
      if (returnRate > 10) qualityScore -= 40;
      else if (returnRate > 5) qualityScore -= 25;
      else if (returnRate > 2) qualityScore -= 15;
      else if (returnRate > 1) qualityScore -= 10;
      else if (returnRate > 0.5) qualityScore -= 5;

      // Deduct points for adjustments (less severe)
      if (adjustmentRate > 15) qualityScore -= 30;
      else if (adjustmentRate > 10) qualityScore -= 20;
      else if (adjustmentRate > 5) qualityScore -= 15;
      else if (adjustmentRate > 2) qualityScore -= 10;
      else if (adjustmentRate > 1) qualityScore -= 5;

      // Bonus for suppliers with no quality issues
      if (totalIssueRate === 0 && totalTransactions >= 10) {
        qualityScore = Math.min(100, qualityScore + 10);
      }

      return Math.max(0, Math.round(qualityScore));

    } catch (error) {
      console.error('Error calculating quality metrics:', error);
      return 50;
    }
  }

  /**
   * Calculate reliability/fulfillment score (0-100)
   * Based on order fulfillment rate and consistency
   */
  async _calculateReliabilityScore(supplier, dateFrom, dateTo) {
    try {
      const totalTransactions = parseInt(supplier.totalTransactions) || 0;
      const avgOrderInterval = parseFloat(supplier.averageOrderInterval) || 0;
      const uniqueProducts = parseInt(supplier.uniqueProducts) || 0;
      const totalValue = parseFloat(supplier.totalValue) || 0;

      let reliabilityScore = 70; // Base score

      // Transaction frequency score (25 points)
      if (totalTransactions >= 50) reliabilityScore += 25;
      else if (totalTransactions >= 20) reliabilityScore += 20;
      else if (totalTransactions >= 10) reliabilityScore += 15;
      else if (totalTransactions >= 5) reliabilityScore += 10;
      else reliabilityScore += 5;

      // Order consistency score (25 points)
      if (avgOrderInterval > 0) {
        if (avgOrderInterval <= 7) reliabilityScore += 25; // Weekly orders
        else if (avgOrderInterval <= 14) reliabilityScore += 20; // Bi-weekly
        else if (avgOrderInterval <= 30) reliabilityScore += 15; // Monthly
        else if (avgOrderInterval <= 60) reliabilityScore += 10; // Bi-monthly
        else reliabilityScore += 5; // Less frequent
      }

      // Product diversity bonus (10 points max)
      const diversityBonus = Math.min(10, uniqueProducts * 2);
      reliabilityScore += diversityBonus;

      // Volume consistency (check if supplier maintains steady business)
      if (totalValue > 0) {
        reliabilityScore += 5; // Bonus for active supplier
      }

      return Math.min(100, Math.round(reliabilityScore));

    } catch (error) {
      console.error('Error calculating reliability score:', error);
      return 50;
    }
  }

  /**
   * Calculate payment terms score (0-100)
   * Based on payment terms favorability
   */
  async _calculatePaymentTermsScore(supplier) {
    try {
      const paymentTerms = supplier.paymentTerms || {};
      const creditLimit = parseFloat(supplier.creditLimit) || 0;

      let paymentScore = 50; // Base score

      // Payment days scoring
      const paymentDays = paymentTerms.days || 30;
      if (paymentDays >= 60) paymentScore += 30;
      else if (paymentDays >= 45) paymentScore += 25;
      else if (paymentDays >= 30) paymentScore += 20;
      else if (paymentDays >= 15) paymentScore += 15;
      else paymentScore += 10;

      // Early payment discount
      if (paymentTerms.earlyPaymentDiscount > 0) {
        paymentScore += 15;
      }

      // Credit limit availability
      if (creditLimit > 0) {
        if (creditLimit >= 100000) paymentScore += 10;
        else if (creditLimit >= 50000) paymentScore += 8;
        else if (creditLimit >= 10000) paymentScore += 5;
        else paymentScore += 3;
      }

      // Payment method flexibility
      const acceptedMethods = paymentTerms.acceptedMethods || [];
      if (acceptedMethods.length >= 3) paymentScore += 5;
      else if (acceptedMethods.length >= 2) paymentScore += 3;

      return Math.min(100, Math.round(paymentScore));

    } catch (error) {
      console.error('Error calculating payment terms score:', error);
      return 50;
    }
  }

  /**
   * Enhanced supplier ranking algorithm with weighted scoring
   * Implementation for Story 1.5, Task 3: Supplier Analytics Implementation
   * @param {Object} options - Configuration options for ranking
   * @param {Object} options.weights - Custom weight configuration
   * @param {string[]} options.supplierIds - Specific suppliers to rank
   * @param {string} options.businessPriority - Dynamic priority adjustment (cost|quality|delivery|service)
   * @returns {Object} Comprehensive supplier rankings with tiers and recommendations
   */
  async getSupplierRankingsEnhanced(options = {}) {
    const cacheKey = `supplier_rankings_enhanced_${JSON.stringify(options)}`;
    
    return await this.executeWithCache(async () => {
      const correlationId = this.generateCorrelationId();
      const startTime = Date.now();
      
      try {
        this.trackQuery(correlationId, 'getSupplierRankingsEnhanced', options, startTime);
        
        const {
          dateFrom = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString(),
          dateTo = new Date().toISOString(),
          supplierIds,
          businessPriority = 'balanced',
          customWeights = null
        } = options;

        // Get dynamic weights based on business priority
        const weights = this._getDynamicWeights(businessPriority, customWeights);
        
        // Get base supplier metrics
        const supplierMetrics = await this._getSupplierBaseMetrics(dateFrom, dateTo, supplierIds);
        
        if (supplierMetrics.length === 0) {
          return this._createEmptyRankingResponse();
        }

        // Calculate enhanced scores for each supplier
        const enhancedSuppliers = await Promise.all(
          supplierMetrics.map(async (supplier) => {
            const scores = await this._calculateEnhancedScores(supplier, dateFrom, dateTo);
            const weightedScore = this._calculateWeightedScore(scores, weights);
            const tier = this._classifySupplierTier(weightedScore, scores);
            const riskLevel = this._assessSupplierRisk(scores, supplier);
            
            return {
              supplierId: supplier.supplierId,
              supplierCode: supplier.supplierCode,
              companyName: supplier.companyName,
              supplierType: supplier.supplierType,
              scores,
              weightedScore: Math.round(weightedScore * 100) / 100,
              tier,
              riskLevel,
              totalTransactions: supplier.totalTransactions,
              totalValue: supplier.totalValue,
              lastOrderDate: supplier.lastOrderDate,
              isActive: supplier.isActive || true
            };
          })
        );

        // Sort by weighted score descending
        enhancedSuppliers.sort((a, b) => b.weightedScore - a.weightedScore);
        
        // Add rankings and track changes
        const rankedSuppliers = enhancedSuppliers.map((supplier, index) => ({
          ...supplier,
          ranking: index + 1,
          percentile: Math.round(((enhancedSuppliers.length - index) / enhancedSuppliers.length) * 100)
        }));

        // Generate tier distributions
        const tierDistribution = this._calculateTierDistribution(rankedSuppliers);
        
        // Generate recommendations and alerts
        const recommendations = this._generateEnhancedSupplierRecommendations(rankedSuppliers, weights);
        const alerts = this._generateEnhancedSupplierAlerts(rankedSuppliers);
        
        // Track ranking changes over time
        const rankingChanges = await this._trackRankingChanges(rankedSuppliers, dateFrom, dateTo);

        const duration = Date.now() - startTime;
        this.finishQuery(correlationId, duration, rankedSuppliers.length);

        return {
          success: true,
          data: {
            suppliers: rankedSuppliers,
            summary: {
              totalSuppliers: rankedSuppliers.length,
              averageScore: rankedSuppliers.reduce((sum, s) => sum + s.weightedScore, 0) / rankedSuppliers.length,
              tierDistribution,
              businessPriority,
              weightsUsed: weights
            },
            recommendations,
            alerts,
            rankingChanges,
            metadata: {
              dateRange: { from: dateFrom, to: dateTo },
              queryDuration: duration,
              correlationId
            }
          }
        };

      } catch (error) {
        console.error('Error in enhanced supplier rankings:', error);
        throw error;
      }
    }, cacheKey, 300); // 5-minute cache
  }

  /**
   * Calculate dynamic weights based on business priority
   * Default weights: Price (30%), Delivery (25%), Quality (20%), Fulfillment (15%), Service (10%)
   */
  _getDynamicWeights(businessPriority, customWeights) {
    // Base weights as specified in requirements
    const baseWeights = {
      priceCompetitiveness: 0.30,    // 30%
      deliveryPerformance: 0.25,     // 25%
      qualityMetrics: 0.20,          // 20%
      orderFulfillment: 0.15,        // 15%
      serviceResponse: 0.10          // 10%
    };

    // Custom weights override if provided
    if (customWeights) {
      return { ...baseWeights, ...customWeights };
    }

    // Dynamic adjustment based on business priority
    switch (businessPriority) {
      case 'cost':
        return {
          priceCompetitiveness: 0.45,  // Increase price weight
          deliveryPerformance: 0.20,
          qualityMetrics: 0.15,
          orderFulfillment: 0.12,
          serviceResponse: 0.08
        };
      
      case 'quality':
        return {
          priceCompetitiveness: 0.20,
          deliveryPerformance: 0.20,
          qualityMetrics: 0.40,        // Increase quality weight
          orderFulfillment: 0.12,
          serviceResponse: 0.08
        };
      
      case 'delivery':
        return {
          priceCompetitiveness: 0.20,
          deliveryPerformance: 0.40,   // Increase delivery weight
          qualityMetrics: 0.20,
          orderFulfillment: 0.15,
          serviceResponse: 0.05
        };
      
      case 'service':
        return {
          priceCompetitiveness: 0.25,
          deliveryPerformance: 0.20,
          qualityMetrics: 0.20,
          orderFulfillment: 0.15,
          serviceResponse: 0.20        // Increase service weight
        };
      
      default: // 'balanced'
        return baseWeights;
    }
  }

  /**
   * Calculate enhanced scores with improved algorithms
   */
  async _calculateEnhancedScores(supplier, dateFrom, dateTo) {
    const [
      priceScore,
      deliveryScore,
      qualityScore,
      fulfillmentScore,
      serviceScore
    ] = await Promise.all([
      this._calculatePriceCompetitivenessScore(supplier),
      this._calculateDeliveryPerformanceScore(supplier, dateFrom, dateTo),
      this._calculateQualityMetricsScore(supplier, dateFrom, dateTo),
      this._calculateOrderFulfillmentScore(supplier, dateFrom, dateTo),
      this._calculateServiceResponseScore(supplier, dateFrom, dateTo)
    ]);

    return {
      priceCompetitiveness: Math.round(priceScore * 100) / 100,
      deliveryPerformance: Math.round(deliveryScore * 100) / 100,
      qualityMetrics: Math.round(qualityScore * 100) / 100,
      orderFulfillment: Math.round(fulfillmentScore * 100) / 100,
      serviceResponse: Math.round(serviceScore * 100) / 100
    };
  }

  /**
   * Calculate order fulfillment score
   */
  async _calculateOrderFulfillmentScore(supplier, dateFrom, dateTo) {
    try {
      const fulfillmentData = await db
        .select({
          totalOrders: sql`COUNT(*)`,
          completedOrders: sql`SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END)`,
          partialOrders: sql`SUM(CASE WHEN status = 'partial' THEN 1 ELSE 0 END)`,
          cancelledOrders: sql`SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END)`
        })
        .from(inventoryMovements)
        .where(and(
          eq(inventoryMovements.referenceId, supplier.supplierId),
          eq(inventoryMovements.movementType, 'purchase'),
          between(inventoryMovements.createdAt, dateFrom, dateTo)
        ));

      const data = fulfillmentData[0];
      const totalOrders = parseInt(data.totalOrders) || 0;
      
      if (totalOrders === 0) return 50; // Neutral score for no data

      const completedOrders = parseInt(data.completedOrders) || 0;
      const partialOrders = parseInt(data.partialOrders) || 0;
      const cancelledOrders = parseInt(data.cancelledOrders) || 0;

      // Calculate fulfillment rate
      const fulfillmentRate = (completedOrders + (partialOrders * 0.5)) / totalOrders;
      const cancellationRate = cancelledOrders / totalOrders;

      // Base score from fulfillment rate
      let score = fulfillmentRate * 100;

      // Penalty for cancellations
      score -= (cancellationRate * 30);

      // Bonus for consistent fulfillment
      if (fulfillmentRate >= 0.95 && totalOrders >= 10) {
        score += 10;
      }

      return Math.min(100, Math.max(0, score));
    } catch (error) {
      console.error('Error calculating fulfillment score:', error);
      return 50;
    }
  }

  /**
   * Calculate service response score
   */
  async _calculateServiceResponseScore(supplier, dateFrom, dateTo) {
    try {
      // This would typically measure response times to inquiries, issue resolution, etc.
      // For now, we'll use order processing time as a proxy
      const responseData = await db
        .select({
          avgProcessingDays: sql`AVG(EXTRACT(DAYS FROM (updated_at - created_at)))`,
          orderCount: sql`COUNT(*)`
        })
        .from(inventoryMovements)
        .where(and(
          eq(inventoryMovements.referenceId, supplier.supplierId),
          eq(inventoryMovements.movementType, 'purchase'),
          between(inventoryMovements.createdAt, dateFrom, dateTo)
        ));

      const data = responseData[0];
      const avgProcessingDays = parseFloat(data.avgProcessingDays) || 0;
      const orderCount = parseInt(data.orderCount) || 0;

      if (orderCount === 0) return 50; // Neutral score

      // Score based on processing speed (lower is better)
      let score = 100;
      if (avgProcessingDays <= 1) {
        score = 100; // Same day processing
      } else if (avgProcessingDays <= 2) {
        score = 90;  // Next day processing
      } else if (avgProcessingDays <= 5) {
        score = 75;  // Within a week
      } else if (avgProcessingDays <= 10) {
        score = 60;  // Within 10 days
      } else {
        score = Math.max(30, 100 - (avgProcessingDays * 5)); // Longer periods
      }

      return Math.min(100, Math.max(0, score));
    } catch (error) {
      console.error('Error calculating service response score:', error);
      return 50;
    }
  }

  /**
   * Calculate weighted overall score
   */
  _calculateWeightedScore(scores, weights) {
    return (
      scores.priceCompetitiveness * weights.priceCompetitiveness +
      scores.deliveryPerformance * weights.deliveryPerformance +
      scores.qualityMetrics * weights.qualityMetrics +
      scores.orderFulfillment * weights.orderFulfillment +
      scores.serviceResponse * weights.serviceResponse
    );
  }

  /**
   * Classify supplier tier based on weighted score and individual metrics
   */
  _classifySupplierTier(weightedScore, scores) {
    // Check for any critical failures first
    const hasCriticalFailure = Object.values(scores).some(score => score < 30);
    
    if (hasCriticalFailure) {
      return 'Probation';
    }

    // Tier classification based on weighted score
    if (weightedScore >= 85) {
      return 'Tier 1'; // Strategic/Premium suppliers
    } else if (weightedScore >= 70) {
      return 'Preferred'; // Preferred suppliers
    } else if (weightedScore >= 55) {
      return 'Tier 2'; // Standard suppliers
    } else if (weightedScore >= 40) {
      return 'Tier 3'; // Developing suppliers
    } else {
      return 'Probation'; // Under review
    }
  }

  /**
   * Assess supplier risk level
   */
  _assessSupplierRisk(scores, supplier) {
    let riskFactors = 0;
    
    // Quality risk
    if (scores.qualityMetrics < 60) riskFactors++;
    
    // Delivery risk
    if (scores.deliveryPerformance < 60) riskFactors++;
    
    // Financial stability risk (using order value consistency as proxy)
    const orderValue = parseFloat(supplier.totalValue) || 0;
    if (orderValue < 10000) riskFactors++; // Low volume might indicate instability
    
    // Fulfillment risk
    if (scores.orderFulfillment < 70) riskFactors++;

    if (riskFactors >= 3) return 'High';
    if (riskFactors >= 2) return 'Medium';
    if (riskFactors >= 1) return 'Low';
    return 'Minimal';
  }

  /**
   * Calculate tier distribution
   */
  _calculateTierDistribution(suppliers) {
    const distribution = {
      'Tier 1': 0,
      'Preferred': 0,
      'Tier 2': 0,
      'Tier 3': 0,
      'Probation': 0
    };

    suppliers.forEach(supplier => {
      distribution[supplier.tier]++;
    });

    const total = suppliers.length;
    return Object.entries(distribution).map(([tier, count]) => ({
      tier,
      count,
      percentage: total > 0 ? Math.round((count / total) * 100) : 0
    }));
  }

  /**
   * Generate enhanced supplier recommendations
   */
  _generateEnhancedSupplierRecommendations(suppliers, weights) {
    const recommendations = [];

    // Top performers
    const topPerformers = suppliers.filter(s => s.tier === 'Tier 1').slice(0, 3);
    if (topPerformers.length > 0) {
      recommendations.push({
        type: 'strategic_partnership',
        priority: 'high',
        title: 'Strategic Partnership Opportunities',
        suppliers: topPerformers.map(s => s.supplierId),
        description: `${topPerformers.length} suppliers qualify for strategic partnerships. Consider volume commitments and preferential terms.`,
        expectedBenefit: 'Cost reduction and supply chain stability'
      });
    }

    // Improvement candidates
    const improvementCandidates = suppliers.filter(s => s.tier === 'Tier 3' && s.riskLevel !== 'High');
    if (improvementCandidates.length > 0) {
      recommendations.push({
        type: 'supplier_development',
        priority: 'medium',
        title: 'Supplier Development Program',
        suppliers: improvementCandidates.slice(0, 5).map(s => s.supplierId),
        description: `${improvementCandidates.length} suppliers could benefit from development programs to improve performance.`,
        expectedBenefit: 'Enhanced supplier capability and relationship strength'
      });
    }

    // Risk mitigation
    const highRiskSuppliers = suppliers.filter(s => s.riskLevel === 'High');
    if (highRiskSuppliers.length > 0) {
      recommendations.push({
        type: 'risk_mitigation',
        priority: 'critical',
        title: 'Immediate Risk Mitigation Required',
        suppliers: highRiskSuppliers.map(s => s.supplierId),
        description: `${highRiskSuppliers.length} suppliers require immediate attention due to high risk levels.`,
        expectedBenefit: 'Reduced supply chain disruption risk'
      });
    }

    // Diversification opportunities
    const tierDistribution = this._calculateTierDistribution(suppliers);
    const tier1Percentage = tierDistribution.find(t => t.tier === 'Tier 1')?.percentage || 0;
    
    if (tier1Percentage > 70) {
      recommendations.push({
        type: 'diversification',
        priority: 'medium',
        title: 'Supply Base Diversification',
        description: 'High concentration in Tier 1 suppliers. Consider developing additional suppliers for risk mitigation.',
        expectedBenefit: 'Improved negotiation leverage and reduced dependency risk'
      });
    }

    return recommendations;
  }

  /**
   * Generate enhanced supplier alerts
   */
  _generateEnhancedSupplierAlerts(suppliers) {
    const alerts = [];

    suppliers.forEach(supplier => {
      // Critical performance alert
      if (supplier.weightedScore < 40) {
        alerts.push({
          type: 'critical_performance',
          severity: 'critical',
          supplierId: supplier.supplierId,
          supplierName: supplier.companyName,
          message: `${supplier.companyName} has critically low performance (${supplier.weightedScore}/100). Immediate review required.`,
          recommendations: ['Conduct supplier audit', 'Develop improvement plan', 'Consider alternative suppliers']
        });
      }

      // Quality degradation alert
      if (supplier.scores.qualityMetrics < 50) {
        alerts.push({
          type: 'quality_degradation',
          severity: 'high',
          supplierId: supplier.supplierId,
          supplierName: supplier.companyName,
          message: `Quality metrics below acceptable threshold (${supplier.scores.qualityMetrics}/100).`,
          recommendations: ['Quality audit', 'Corrective action plan', 'Increase inspection frequency']
        });
      }

      // Delivery performance alert
      if (supplier.scores.deliveryPerformance < 60) {
        alerts.push({
          type: 'delivery_issues',
          severity: 'medium',
          supplierId: supplier.supplierId,
          supplierName: supplier.companyName,
          message: `Delivery performance declining (${supplier.scores.deliveryPerformance}/100).`,
          recommendations: ['Review delivery schedules', 'Logistics optimization', 'Backup supplier identification']
        });
      }

      // Strategic opportunity alert
      if (supplier.tier === 'Tier 1' && supplier.weightedScore > 90) {
        alerts.push({
          type: 'strategic_opportunity',
          severity: 'low',
          supplierId: supplier.supplierId,
          supplierName: supplier.companyName,
          message: `${supplier.companyName} is an exceptional performer (${supplier.weightedScore}/100). Consider strategic partnership.`,
          recommendations: ['Negotiate volume discounts', 'Explore exclusive arrangements', 'Joint development opportunities']
        });
      }
    });

    return alerts.sort((a, b) => {
      const severityOrder = { critical: 3, high: 2, medium: 1, low: 0 };
      return severityOrder[b.severity] - severityOrder[a.severity];
    });
  }

  /**
   * Track ranking changes over time
   */
  async _trackRankingChanges(currentSuppliers, dateFrom, dateTo) {
    try {
      // Get previous period rankings (same duration, shifted back)
      const periodDuration = new Date(dateTo) - new Date(dateFrom);
      const previousDateTo = new Date(new Date(dateFrom) - 1); // Day before current period
      const previousDateFrom = new Date(previousDateTo.getTime() - periodDuration);

      const previousRankings = await this.getSupplierRankingsEnhanced({
        dateFrom: previousDateFrom.toISOString(),
        dateTo: previousDateTo.toISOString(),
        supplierIds: currentSuppliers.map(s => s.supplierId)
      });

      const changes = [];
      
      currentSuppliers.forEach(current => {
        const previous = previousRankings.data?.suppliers?.find(p => p.supplierId === current.supplierId);
        
        if (previous) {
          const rankingChange = previous.ranking - current.ranking; // Positive = improved
          const scoreChange = current.weightedScore - previous.weightedScore;
          const tierChange = previous.tier !== current.tier;

          changes.push({
            supplierId: current.supplierId,
            supplierName: current.companyName,
            currentRanking: current.ranking,
            previousRanking: previous.ranking,
            rankingChange,
            currentScore: current.weightedScore,
            previousScore: previous.weightedScore,
            scoreChange: Math.round(scoreChange * 100) / 100,
            currentTier: current.tier,
            previousTier: previous.tier,
            tierChange,
            trend: rankingChange > 0 ? 'improving' : rankingChange < 0 ? 'declining' : 'stable'
          });
        } else {
          changes.push({
            supplierId: current.supplierId,
            supplierName: current.companyName,
            currentRanking: current.ranking,
            currentScore: current.weightedScore,
            currentTier: current.tier,
            trend: 'new_supplier'
          });
        }
      });

      return changes.sort((a, b) => Math.abs(b.rankingChange || 0) - Math.abs(a.rankingChange || 0));
    } catch (error) {
      console.error('Error tracking ranking changes:', error);
      return [];
    }
  }

  /**
   * Create empty ranking response
   */
  _createEmptyRankingResponse() {
    return {
      success: true,
      data: {
        suppliers: [],
        summary: {
          totalSuppliers: 0,
          averageScore: 0,
          tierDistribution: [],
          businessPriority: 'balanced',
          weightsUsed: this._getDynamicWeights('balanced')
        },
        recommendations: [],
        alerts: [],
        rankingChanges: []
      }
    };
  }

  /**
   * Get supplier tier performance summary with enhanced analytics
   * Quick overview method for procurement dashboard
   * @param {Object} options - Configuration options
   * @returns {Object} Tier performance summary with key metrics
   */
  async getSupplierTierSummary(options = {}) {
    const cacheKey = `supplier_tier_summary_${JSON.stringify(options)}`;
    
    return await this.executeWithCache(async () => {
      const correlationId = this.generateCorrelationId();
      const startTime = Date.now();
      
      try {
        this.trackQuery(correlationId, 'getSupplierTierSummary', options, startTime);
        
        const rankings = await this.getSupplierRankingsEnhanced(options);
        const suppliers = rankings.data?.suppliers || [];
        
        if (suppliers.length === 0) {
          return this._createEmptyRankingResponse();
        }

        // Calculate tier-based performance metrics
        const tierMetrics = {};
        const tiers = ['Tier 1', 'Preferred', 'Tier 2', 'Tier 3', 'Probation'];
        
        tiers.forEach(tier => {
          const tierSuppliers = suppliers.filter(s => s.tier === tier);
          
          if (tierSuppliers.length > 0) {
            const avgScore = tierSuppliers.reduce((sum, s) => sum + s.weightedScore, 0) / tierSuppliers.length;
            const avgPriceScore = tierSuppliers.reduce((sum, s) => sum + s.scores.priceCompetitiveness, 0) / tierSuppliers.length;
            const avgDeliveryScore = tierSuppliers.reduce((sum, s) => sum + s.scores.deliveryPerformance, 0) / tierSuppliers.length;
            const avgQualityScore = tierSuppliers.reduce((sum, s) => sum + s.scores.qualityMetrics, 0) / tierSuppliers.length;
            const totalValue = tierSuppliers.reduce((sum, s) => sum + (parseFloat(s.totalValue) || 0), 0);

            tierMetrics[tier] = {
              count: tierSuppliers.length,
              averageScore: Math.round(avgScore * 100) / 100,
              averagePriceScore: Math.round(avgPriceScore * 100) / 100,
              averageDeliveryScore: Math.round(avgDeliveryScore * 100) / 100,
              averageQualityScore: Math.round(avgQualityScore * 100) / 100,
              totalBusinessValue: totalValue,
              riskDistribution: {
                high: tierSuppliers.filter(s => s.riskLevel === 'High').length,
                medium: tierSuppliers.filter(s => s.riskLevel === 'Medium').length,
                low: tierSuppliers.filter(s => s.riskLevel === 'Low').length,
                minimal: tierSuppliers.filter(s => s.riskLevel === 'Minimal').length
              },
              topPerformers: tierSuppliers
                .sort((a, b) => b.weightedScore - a.weightedScore)
                .slice(0, 3)
                .map(s => ({
                  supplierId: s.supplierId,
                  companyName: s.companyName,
                  score: s.weightedScore
                }))
            };
          }
        });

        // Generate strategic insights
        const strategicInsights = this._generateStrategicInsights(suppliers, tierMetrics);

        const duration = Date.now() - startTime;
        this.finishQuery(correlationId, duration, Object.keys(tierMetrics).length);

        return {
          success: true,
          data: {
            tierMetrics,
            strategicInsights,
            summary: rankings.data.summary,
            metadata: {
              dateRange: rankings.data.metadata.dateRange,
              queryDuration: duration,
              correlationId,
              totalSuppliers: suppliers.length
            }
          }
        };

      } catch (error) {
        console.error('Error generating supplier tier summary:', error);
        throw error;
      }
    }, cacheKey, 300);
  }

  /**
   * Generate strategic insights from supplier tier analysis
   */
  _generateStrategicInsights(suppliers, tierMetrics) {
    const insights = [];
    
    // Strategic supplier concentration analysis
    const tier1Count = tierMetrics['Tier 1']?.count || 0;
    const totalSuppliers = suppliers.length;
    const tier1Percentage = totalSuppliers > 0 ? (tier1Count / totalSuppliers) * 100 : 0;

    if (tier1Percentage < 20 && totalSuppliers > 10) {
      insights.push({
        type: 'strategic_gap',
        priority: 'high',
        title: 'Limited Strategic Supplier Base',
        description: `Only ${tier1Percentage.toFixed(1)}% of suppliers are Tier 1. Consider developing more strategic partnerships.`,
        recommendation: 'Identify and develop high-potential Tier 2 suppliers into strategic partners.'
      });
    }

    // Risk concentration analysis
    const probationCount = tierMetrics['Probation']?.count || 0;
    const probationPercentage = totalSuppliers > 0 ? (probationCount / totalSuppliers) * 100 : 0;

    if (probationPercentage > 15) {
      insights.push({
        type: 'risk_concentration',
        priority: 'critical',
        title: 'High Risk Supplier Concentration',
        description: `${probationPercentage.toFixed(1)}% of suppliers are on probation. This poses significant supply chain risk.`,
        recommendation: 'Immediate action required: audit probation suppliers and develop contingency plans.'
      });
    }

    // Performance improvement opportunity
    const tier3Count = tierMetrics['Tier 3']?.count || 0;
    if (tier3Count > 0 && tier3Count >= tier1Count) {
      insights.push({
        type: 'improvement_opportunity',
        priority: 'medium',
        title: 'Supplier Development Opportunity',
        description: `${tier3Count} suppliers in Tier 3 represent development opportunities.`,
        recommendation: 'Implement supplier development programs to upgrade Tier 3 suppliers to preferred status.'
      });
    }

    // Cost optimization opportunity
    if (tierMetrics['Tier 1']?.averagePriceScore < 70) {
      insights.push({
        type: 'cost_optimization',
        priority: 'medium',
        title: 'Price Competitiveness Opportunity',
        description: 'Even top-tier suppliers show room for price improvement.',
        recommendation: 'Leverage strategic partnerships for better pricing through volume commitments.'
      });
    }

    return insights;
  }

  /**
   * Generate supplier tier classification
   */
  _getSupplierTier(overallScore) {
    if (overallScore >= 85) return 'Premium';
    if (overallScore >= 70) return 'Preferred';
    if (overallScore >= 55) return 'Standard';
    return 'Developing';
  }

  /**
   * Generate recommendations for supplier improvement
   */
  _generateSupplierRecommendations(overallScore, scores) {
    const recommendations = [];

    if (scores.priceScore < 60) {
      recommendations.push({
        category: 'pricing',
        priority: 'high',
        message: 'Negotiate better pricing or volume discounts to improve competitiveness'
      });
    }

    if (scores.deliveryScore < 70) {
      recommendations.push({
        category: 'delivery',
        priority: 'high',
        message: 'Address delivery performance issues and establish clear delivery commitments'
      });
    }

    if (scores.qualityScore < 75) {
      recommendations.push({
        category: 'quality',
        priority: 'medium',
        message: 'Implement quality improvement programs and establish quality standards'
      });
    }

    if (scores.reliabilityScore < 70) {
      recommendations.push({
        category: 'reliability',
        priority: 'medium',
        message: 'Develop more consistent ordering patterns and improve communication'
      });
    }

    if (scores.paymentScore < 60) {
      recommendations.push({
        category: 'payment',
        priority: 'low',
        message: 'Negotiate more favorable payment terms and credit arrangements'
      });
    }

    if (overallScore >= 85) {
      recommendations.push({
        category: 'strategic',
        priority: 'low',
        message: 'Consider establishing strategic partnership or preferred supplier status'
      });
    }

    return recommendations;
  }

  /**
   * Get supplier rankings by category
   */
  async _getSupplierCategoryRankings(rankedSuppliers, categories) {
    // Group suppliers by product categories they supply
    const categoryGroups = {};
    
    for (const supplier of rankedSuppliers) {
      // This would need to be enhanced based on actual product category data
      // For now, using supplier type as a proxy
      const category = supplier.supplierType || 'general';
      
      if (!categoryGroups[category]) {
        categoryGroups[category] = [];
      }
      categoryGroups[category].push(supplier);
    }

    // Rank within each category
    Object.keys(categoryGroups).forEach(category => {
      categoryGroups[category] = categoryGroups[category]
        .sort((a, b) => b.scores.overall - a.scores.overall)
        .map((supplier, index) => ({
          ...supplier,
          categoryRanking: index + 1
        }));
    });

    return categoryGroups;
  }

  /**
   * Calculate ranking changes over time
   */
  async _calculateRankingChanges(currentRankings, dateFrom, dateTo) {
    try {
      // Get previous period data directly from cache or return simplified change tracking
      const cacheKey = `supplier_rankings_previous_${dateFrom}_${dateTo}`;
      
      // Try to get cached previous rankings, otherwise return change indicators
      const cachedPrevious = this.cache && this.initialized ? await this.cache.get(cacheKey) : null;
      
      if (!cachedPrevious) {
        // Return simplified change tracking without recursive calls
        return currentRankings.map(current => ({
          supplierId: current.supplierId,
          currentRanking: current.ranking,
          previousRanking: null,
          rankingChange: 'insufficient_data',
          scoreChange: null,
          trend: 'new_analysis'
        }));
      }

      const changes = currentRankings.map(current => {
        const previous = cachedPrevious.suppliers?.find(p => p.supplierId === current.supplierId);
        
        if (!previous) {
          return {
            supplierId: current.supplierId,
            currentRanking: current.ranking,
            previousRanking: null,
            rankingChange: 'new',
            scoreChange: null,
            trend: 'new_supplier'
          };
        }

        const rankingChange = previous.ranking - current.ranking; // Positive = improved
        const scoreChange = current.scores.overall - previous.scores.overall;

        return {
          supplierId: current.supplierId,
          currentRanking: current.ranking,
          previousRanking: previous.ranking,
          rankingChange,
          scoreChange: Math.round(scoreChange * 10) / 10,
          trend: rankingChange > 0 ? 'improving' : rankingChange < 0 ? 'declining' : 'stable'
        };
      });

      return changes;

    } catch (error) {
      console.error('Error calculating ranking changes:', error);
      return currentRankings.map(current => ({
        supplierId: current.supplierId,
        currentRanking: current.ranking,
        previousRanking: null,
        rankingChange: 'error',
        scoreChange: null,
        trend: 'unknown'
      }));
    }
  }

  /**
   * Generate supplier alerts based on rankings and performance
   */
  _generateSupplierAlerts(rankedSuppliers) {
    const alerts = [];

    rankedSuppliers.forEach(supplier => {
      const score = supplier.scores.overall;
      
      // Critical performance alerts
      if (score < 40) {
        alerts.push({
          type: 'critical',
          supplierId: supplier.supplierId,
          supplierName: supplier.companyName,
          message: `${supplier.companyName} has critically low performance (${score}/100). Consider supplier review or replacement.`,
          priority: 'high',
          category: 'performance'
        });
      }

      // Quality concerns
      if (supplier.scores.qualityMetrics < 50) {
        alerts.push({
          type: 'warning',
          supplierId: supplier.supplierId,
          supplierName: supplier.companyName,
          message: `${supplier.companyName} has quality issues. Review return rates and implement quality improvements.`,
          priority: 'high',
          category: 'quality'
        });
      }

      // Delivery performance issues
      if (supplier.scores.deliveryPerformance < 60) {
        alerts.push({
          type: 'warning',
          supplierId: supplier.supplierId,
          supplierName: supplier.companyName,
          message: `${supplier.companyName} has delivery performance issues. Review delivery commitments.`,
          priority: 'medium',
          category: 'delivery'
        });
      }

      // Top performer recognition
      if (score >= 90) {
        alerts.push({
          type: 'success',
          supplierId: supplier.supplierId,
          supplierName: supplier.companyName,
          message: `${supplier.companyName} is a top performer (${score}/100). Consider strategic partnership opportunities.`,
          priority: 'low',
          category: 'opportunity'
        });
      }
    });

    return alerts.sort((a, b) => {
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });
  }

  /**
   * Get supplier performance trends over time
   * @param {string} supplierId - Specific supplier to analyze
   * @param {Object} options - Time period and analysis options
   */
  async getSupplierPerformanceTrends(supplierId, options = {}) {
    const cacheKey = `supplier_trends_${supplierId}_${JSON.stringify(options)}`;
    
    return await this.executeWithCache(async () => {
      const {
        months = 6,
        includeProjections = true
      } = options;

      const endDate = new Date();
      const startDate = new Date(endDate.getTime() - (months * 30 * 24 * 60 * 60 * 1000));

      // Get monthly performance data
      const monthlyData = [];
      for (let i = 0; i < months; i++) {
        const monthEnd = new Date(endDate.getTime() - (i * 30 * 24 * 60 * 60 * 1000));
        const monthStart = new Date(monthEnd.getTime() - (30 * 24 * 60 * 60 * 1000));

        try {
          const monthlyRanking = await this.getSupplierRankings({
            dateFrom: monthStart.toISOString(),
            dateTo: monthEnd.toISOString(),
            supplierIds: [supplierId]
          });

          if (monthlyRanking.data?.suppliers?.[0]) {
            monthlyData.unshift({
              month: monthStart.toISOString().slice(0, 7), // YYYY-MM format
              scores: monthlyRanking.data.suppliers[0].scores,
              ranking: monthlyRanking.data.suppliers[0].ranking
            });
          }
        } catch (error) {
          console.log(`No data for month ${monthStart.toISOString().slice(0, 7)}`);
        }
      }

      // Calculate trends
      const trends = {
        overall: this._calculateTrend(monthlyData.map(d => d.scores.overall)),
        priceCompetitiveness: this._calculateTrend(monthlyData.map(d => d.scores.priceCompetitiveness)),
        deliveryPerformance: this._calculateTrend(monthlyData.map(d => d.scores.deliveryPerformance)),
        qualityMetrics: this._calculateTrend(monthlyData.map(d => d.scores.qualityMetrics)),
        reliability: this._calculateTrend(monthlyData.map(d => d.scores.reliability)),
        paymentTerms: this._calculateTrend(monthlyData.map(d => d.scores.paymentTerms))
      };

      return {
        supplierId,
        monthlyData,
        trends,
        summary: {
          dataPoints: monthlyData.length,
          timespan: `${months} months`,
          overallTrend: trends.overall.direction,
          improvement: trends.overall.direction === 'improving'
        }
      };

    }, cacheKey, 900); // 15-minute cache
  }

  /**
   * Calculate trend direction and strength for a data series
   */
  _calculateTrend(values) {
    if (values.length < 2) return { direction: 'insufficient_data', strength: 0 };

    const n = values.length;
    const x = Array.from({ length: n }, (_, i) => i);
    const y = values;

    // Calculate linear regression
    const sumX = x.reduce((a, b) => a + b, 0);
    const sumY = y.reduce((a, b) => a + b, 0);
    const sumXY = x.reduce((sum, xi, i) => sum + xi * y[i], 0);
    const sumXX = x.reduce((sum, xi) => sum + xi * xi, 0);

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const correlation = Math.abs(slope) / Math.max(...y); // Normalized slope

    let direction;
    if (Math.abs(slope) < 0.1) direction = 'stable';
    else if (slope > 0) direction = 'improving';
    else direction = 'declining';

    return {
      direction,
      strength: Math.round(correlation * 100) / 100,
      slope: Math.round(slope * 100) / 100
    };
  }

  /**
   * Get quick supplier performance overview
   * Convenient method for common supplier ranking queries
   */
  async getSupplierPerformanceOverview(options = {}) {
    const cacheKey = `supplier_overview_${JSON.stringify(options)}`;
    
    return await this.executeWithCache(async () => {
      const {
        limit = 10,
        tier = null,
        category = null,
        includeAlerts = true
      } = options;

      // Get all supplier rankings
      const rankings = await this.getSupplierRankings(options);
      
      let suppliers = rankings.data?.suppliers || [];
      
      // Filter by tier if specified
      if (tier) {
        suppliers = suppliers.filter(s => s.tier.toLowerCase() === tier.toLowerCase());
      }
      
      // Filter by category if specified
      if (category && rankings.data?.categoryRankings?.[category]) {
        suppliers = rankings.data.categoryRankings[category];
      }
      
      // Limit results
      suppliers = suppliers.slice(0, limit);
      
      const overview = {
        topSuppliers: suppliers,
        summary: rankings.data?.summary || {},
        performanceDistribution: {
          premium: suppliers.filter(s => s.tier === 'Premium').length,
          preferred: suppliers.filter(s => s.tier === 'Preferred').length,
          standard: suppliers.filter(s => s.tier === 'Standard').length,
          developing: suppliers.filter(s => s.tier === 'Developing').length
        }
      };

      if (includeAlerts) {
        overview.criticalAlerts = (rankings.data?.alerts || [])
          .filter(a => a.priority === 'high')
          .slice(0, 5);
      }

      return overview;

    }, cacheKey, 300); // 5-minute cache
  }

  /**
   * Get supplier comparison data for procurement decisions
   * @param {string[]} supplierIds - Array of supplier IDs to compare
   * @param {Object} options - Additional filtering options
   */
  async compareSuppliers(supplierIds, options = {}) {
    const cacheKey = `supplier_comparison_${supplierIds.join('_')}_${JSON.stringify(options)}`;
    
    return await this.executeWithCache(async () => {
      if (!supplierIds || supplierIds.length < 2) {
        throw new Error('At least 2 supplier IDs required for comparison');
      }

      const rankings = await this.getSupplierRankings({
        ...options,
        supplierIds
      });

      const suppliers = rankings.data?.suppliers || [];
      
      if (suppliers.length === 0) {
        throw new Error('No supplier data found for the provided IDs');
      }

      // Calculate relative performance metrics
      const comparison = {
        suppliers: suppliers.map(supplier => ({
          ...supplier,
          relativePerformance: {
            pricingAdvantage: suppliers.reduce((sum, s) => sum + s.scores.priceCompetitiveness, 0) / suppliers.length - supplier.scores.priceCompetitiveness,
            deliveryAdvantage: supplier.scores.deliveryPerformance - (suppliers.reduce((sum, s) => sum + s.scores.deliveryPerformance, 0) / suppliers.length),
            qualityAdvantage: supplier.scores.qualityMetrics - (suppliers.reduce((sum, s) => sum + s.scores.qualityMetrics, 0) / suppliers.length),
            reliabilityAdvantage: supplier.scores.reliability - (suppliers.reduce((sum, s) => sum + s.scores.reliability, 0) / suppliers.length)
          }
        })),
        bestInCategory: {
          pricing: suppliers.reduce((best, current) => 
            current.scores.priceCompetitiveness > best.scores.priceCompetitiveness ? current : best),
          delivery: suppliers.reduce((best, current) => 
            current.scores.deliveryPerformance > best.scores.deliveryPerformance ? current : best),
          quality: suppliers.reduce((best, current) => 
            current.scores.qualityMetrics > best.scores.qualityMetrics ? current : best),
          reliability: suppliers.reduce((best, current) => 
            current.scores.reliability > best.scores.reliability ? current : best),
          overall: suppliers.reduce((best, current) => 
            current.scores.overall > best.scores.overall ? current : best)
        },
        recommendation: suppliers.find(s => s.ranking === 1) || suppliers[0]
      };

      return comparison;

    }, cacheKey, 600); // 10-minute cache
  }

  // ==================== HEALTH CHECK ====================

  async healthCheck() {
    const startTime = Date.now();
    
    try {
      // Test database connection
      const dbTest = await db.select({ test: sql`1` }).limit(1);
      const dbHealthy = dbTest.length > 0;

      // Test cache connection
      const cacheHealthy = this.cache && this.initialized;

      // Test query performance
      const testQuery = await this.getSalesMetrics({ 
        dateFrom: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString() 
      });
      const queryTime = Date.now() - startTime;

      return {
        status: dbHealthy && queryTime < 2000 ? 'healthy' : 'degraded',
        database: dbHealthy,
        cache: cacheHealthy,
        queryTime,
        target: '< 2000ms',
        timestamp: new Date().toISOString(),
        metrics: this.getQueryMetrics()
      };
    } catch (error) {
      return {
        status: 'unhealthy',
        error: error.message,
        timestamp: new Date().toISOString(),
        queryTime: Date.now() - startTime
      };
    }
  }

  // ==================== SUPPLIER PRICE COMPARISON ANALYTICS ====================

  /**
   * Compare prices across multiple suppliers for the same products
   * @param {Object} params - Parameters for price comparison
   * @param {Array} params.supplierIds - Array of supplier IDs to compare (optional)
   * @param {Array} params.skus - Array of SKUs to analyze (optional)
   * @param {string} params.currency - Currency to filter by (default: 'USD')
   * @param {boolean} params.includeInactive - Include inactive price lists (default: false)
   * @param {number} params.quantity - Quantity for tier pricing calculations (default: 1)
   * @returns {Object} Price comparison data with best prices and opportunities
   */
  async comparePricesAcrossSuppliers(params = {}) {
    const {
      supplierIds = null,
      skus = null,
      currency = 'USD',
      includeInactive = false,
      quantity = 1
    } = params;

    const cacheKey = `price_comparison_${JSON.stringify(params)}`;

    return await this.executeWithCache(async () => {
      let whereConditions = [
        eq(priceListItems.currency, currency)
      ];

      if (!includeInactive) {
        whereConditions.push(eq(priceLists.isActive, true));
      }

      if (supplierIds && Array.isArray(supplierIds)) {
        whereConditions.push(inArray(priceLists.supplierId, supplierIds));
      }

      if (skus && Array.isArray(skus)) {
        whereConditions.push(inArray(priceListItems.sku, skus));
      }

      // Get all price data with supplier information
      const priceData = await db
        .select({
          sku: priceListItems.sku,
          description: priceListItems.description,
          unitPrice: priceListItems.unitPrice,
          currency: priceListItems.currency,
          minQuantity: priceListItems.minQuantity,
          discountPercent: priceListItems.discountPercent,
          tierPricing: priceListItems.tierPricing,
          supplierId: priceLists.supplierId,
          supplierName: suppliers.companyName,
          priceListName: priceLists.name,
          priceListType: priceLists.type,
          effectiveDate: priceLists.effectiveDate,
          expiryDate: priceLists.expiryDate
        })
        .from(priceListItems)
        .innerJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
        .innerJoin(suppliers, eq(priceLists.supplierId, suppliers.id))
        .where(and(...whereConditions))
        .orderBy(priceListItems.sku, priceListItems.unitPrice);

      // Group by SKU and analyze prices
      const skuComparisons = {};
      const supplierSummary = {};

      for (const item of priceData) {
        const sku = item.sku;
        const supplierId = item.supplierId;

        // Calculate effective price based on quantity and tier pricing
        const effectivePrice = this.calculateEffectivePrice(item, quantity);

        // Initialize SKU comparison if not exists
        if (!skuComparisons[sku]) {
          skuComparisons[sku] = {
            sku,
            description: item.description,
            currency,
            suppliers: [],
            priceAnalysis: {
              bestPrice: null,
              worstPrice: null,
              averagePrice: 0,
              priceRange: 0,
              priceVariance: 0,
              supplierCount: 0
            }
          };
        }

        // Add supplier data
        skuComparisons[sku].suppliers.push({
          supplierId,
          supplierName: item.supplierName,
          unitPrice: parseFloat(item.unitPrice),
          effectivePrice,
          minQuantity: item.minQuantity,
          discountPercent: parseFloat(item.discountPercent || 0),
          tierPricing: item.tierPricing,
          priceListName: item.priceListName,
          priceListType: item.priceListType,
          effectiveDate: item.effectiveDate,
          expiryDate: item.expiryDate
        });

        // Update supplier summary
        if (!supplierSummary[supplierId]) {
          supplierSummary[supplierId] = {
            supplierId,
            supplierName: item.supplierName,
            totalProducts: 0,
            averagePrice: 0,
            priceLeaderCount: 0,
            competitiveRating: 0
          };
        }
        supplierSummary[supplierId].totalProducts++;
      }

      // Calculate price analytics for each SKU
      for (const sku of Object.keys(skuComparisons)) {
        const comparison = skuComparisons[sku];
        const prices = comparison.suppliers.map(s => s.effectivePrice);
        
        comparison.priceAnalysis = {
          bestPrice: Math.min(...prices),
          worstPrice: Math.max(...prices),
          averagePrice: prices.reduce((sum, p) => sum + p, 0) / prices.length,
          priceRange: Math.max(...prices) - Math.min(...prices),
          priceVariance: this.calculateVariance(prices),
          supplierCount: prices.length
        };

        // Calculate savings opportunities
        comparison.suppliers.forEach(supplier => {
          supplier.priceDifferential = supplier.effectivePrice - comparison.priceAnalysis.bestPrice;
          supplier.percentageAboveBest = ((supplier.effectivePrice - comparison.priceAnalysis.bestPrice) / comparison.priceAnalysis.bestPrice) * 100;
          supplier.isPriceLeader = supplier.effectivePrice === comparison.priceAnalysis.bestPrice;
          
          // Update supplier summary
          if (supplier.isPriceLeader) {
            supplierSummary[supplier.supplierId].priceLeaderCount++;
          }
        });

        // Sort suppliers by effective price
        comparison.suppliers.sort((a, b) => a.effectivePrice - b.effectivePrice);
      }

      // Calculate supplier competitive ratings
      for (const supplierId of Object.keys(supplierSummary)) {
        const summary = supplierSummary[supplierId];
        summary.competitiveRating = (summary.priceLeaderCount / summary.totalProducts) * 100;
        
        // Calculate average price across all products for this supplier
        const supplierPrices = Object.values(skuComparisons)
          .flatMap(comp => comp.suppliers.filter(s => s.supplierId === supplierId))
          .map(s => s.effectivePrice);
        
        summary.averagePrice = supplierPrices.length > 0 
          ? supplierPrices.reduce((sum, p) => sum + p, 0) / supplierPrices.length 
          : 0;
      }

      return {
        comparison: skuComparisons,
        supplierSummary,
        metadata: {
          totalSkus: Object.keys(skuComparisons).length,
          totalSuppliers: Object.keys(supplierSummary).length,
          currency,
          quantity,
          analysisTimestamp: new Date().toISOString()
        }
      };
    }, cacheKey, 300);
  }

  /**
   * Identify best price opportunities and potential cost savings
   * @param {Object} params - Parameters for opportunity analysis
   * @param {Array} params.supplierIds - Array of supplier IDs to analyze (optional)
   * @param {Array} params.skus - Array of SKUs to analyze (optional)
   * @param {string} params.currency - Currency to filter by (default: 'USD')
   * @param {number} params.savingsThreshold - Minimum savings percentage to flag (default: 5)
   * @param {number} params.quantity - Quantity for calculations (default: 1)
   * @returns {Object} Cost savings opportunities and recommendations
   */
  async identifyPriceSavingsOpportunities(params = {}) {
    const {
      supplierIds = null,
      skus = null,
      currency = 'USD',
      savingsThreshold = 5,
      quantity = 1
    } = params;

    const cacheKey = `price_opportunities_${JSON.stringify(params)}`;

    return await this.executeWithCache(async () => {
      // Get price comparison data
      const priceComparison = await this.comparePricesAcrossSuppliers({
        supplierIds,
        skus,
        currency,
        quantity
      });

      const opportunities = [];
      const savings = {
        totalPotentialSavings: 0,
        averageSavingsPercentage: 0,
        highestSavingsOpportunity: null,
        opportunityCount: 0
      };

      // Analyze each SKU for savings opportunities
      for (const [sku, comparison] of Object.entries(priceComparison.data.comparison)) {
        const bestPrice = comparison.priceAnalysis.bestPrice;
        const worstPrice = comparison.priceAnalysis.worstPrice;
        const potentialSavings = worstPrice - bestPrice;
        const savingsPercentage = ((potentialSavings / worstPrice) * 100);

        if (savingsPercentage >= savingsThreshold) {
          const opportunity = {
            sku,
            description: comparison.description,
            currentWorstPrice: worstPrice,
            bestAvailablePrice: bestPrice,
            potentialSavings,
            savingsPercentage,
            currency,
            bestSupplier: comparison.suppliers[0], // First in sorted array
            worstSupplier: comparison.suppliers[comparison.suppliers.length - 1],
            supplierOptions: comparison.suppliers.length,
            recommendation: this.generatePricingRecommendation(comparison, savingsThreshold)
          };

          opportunities.push(opportunity);
          savings.totalPotentialSavings += potentialSavings;
          savings.opportunityCount++;

          if (!savings.highestSavingsOpportunity || savingsPercentage > savings.highestSavingsOpportunity.savingsPercentage) {
            savings.highestSavingsOpportunity = opportunity;
          }
        }
      }

      // Calculate average savings percentage
      savings.averageSavingsPercentage = opportunities.length > 0
        ? opportunities.reduce((sum, opp) => sum + opp.savingsPercentage, 0) / opportunities.length
        : 0;

      // Sort opportunities by savings potential
      opportunities.sort((a, b) => b.savingsPercentage - a.savingsPercentage);

      return {
        opportunities,
        savings,
        recommendations: this.generateOverallRecommendations(opportunities, priceComparison.data.supplierSummary),
        metadata: {
          analysisDate: new Date().toISOString(),
          totalSkusAnalyzed: Object.keys(priceComparison.data.comparison).length,
          savingsThreshold,
          currency,
          quantity
        }
      };
    }, cacheKey, 300);
  }

  /**
   * Calculate price differentials and percentage differences between suppliers
   * @param {Object} params - Parameters for differential analysis
   * @param {string} params.baseSupplierId - Supplier ID to use as baseline
   * @param {Array} params.compareSupplierIds - Supplier IDs to compare against baseline
   * @param {Array} params.skus - Array of SKUs to analyze (optional)
   * @param {string} params.currency - Currency to filter by (default: 'USD')
   * @param {number} params.quantity - Quantity for calculations (default: 1)
   * @returns {Object} Price differential analysis
   */
  async calculatePriceDifferentials(params = {}) {
    const {
      baseSupplierId,
      compareSupplierIds = null,
      skus = null,
      currency = 'USD',
      quantity = 1
    } = params;

    if (!baseSupplierId) {
      throw new Error('Base supplier ID is required for price differential analysis');
    }

    const cacheKey = `price_differentials_${JSON.stringify(params)}`;

    return await this.executeWithCache(async () => {
      // Get price comparison data for specified suppliers
      const supplierIds = compareSupplierIds 
        ? [baseSupplierId, ...compareSupplierIds]
        : null;

      const priceComparison = await this.comparePricesAcrossSuppliers({
        supplierIds,
        skus,
        currency,
        quantity
      });

      const differentials = {};
      const summary = {
        baseSupplier: null,
        comparisons: [],
        averageDifferential: 0,
        totalSkusCompared: 0
      };

      // Get base supplier info
      const baseSupplier = Object.values(priceComparison.data.supplierSummary)
        .find(s => s.supplierId === baseSupplierId);
      
      summary.baseSupplier = baseSupplier;

      // Calculate differentials for each SKU
      for (const [sku, comparison] of Object.entries(priceComparison.data.comparison)) {
        const baseSupplierData = comparison.suppliers.find(s => s.supplierId === baseSupplierId);
        
        if (!baseSupplierData) continue; // Skip if base supplier doesn't have this SKU

        differentials[sku] = {
          sku,
          description: comparison.description,
          baseSupplier: {
            supplierId: baseSupplierId,
            supplierName: baseSupplierData.supplierName,
            price: baseSupplierData.effectivePrice
          },
          comparisons: []
        };

        // Compare against other suppliers
        comparison.suppliers
          .filter(s => s.supplierId !== baseSupplierId)
          .forEach(supplier => {
            const differential = supplier.effectivePrice - baseSupplierData.effectivePrice;
            const percentageDifference = ((differential / baseSupplierData.effectivePrice) * 100);

            differentials[sku].comparisons.push({
              supplierId: supplier.supplierId,
              supplierName: supplier.supplierName,
              price: supplier.effectivePrice,
              differential,
              percentageDifference,
              isMoreExpensive: differential > 0,
              competitiveAdvantage: differential < 0 ? 'cheaper' : differential > 0 ? 'more_expensive' : 'same'
            });
          });

        summary.totalSkusCompared++;
      }

      // Calculate overall supplier comparisons
      const supplierDifferentials = {};
      for (const differential of Object.values(differentials)) {
        differential.comparisons.forEach(comp => {
          if (!supplierDifferentials[comp.supplierId]) {
            supplierDifferentials[comp.supplierId] = {
              supplierId: comp.supplierId,
              supplierName: comp.supplierName,
              totalComparisons: 0,
              averageDifferential: 0,
              averagePercentageDifference: 0,
              cheaperCount: 0,
              moreExpensiveCount: 0,
              sameCount: 0
            };
          }

          const supplierSummary = supplierDifferentials[comp.supplierId];
          supplierSummary.totalComparisons++;
          supplierSummary.averageDifferential += comp.differential;
          supplierSummary.averagePercentageDifference += comp.percentageDifference;

          if (comp.competitiveAdvantage === 'cheaper') {
            supplierSummary.cheaperCount++;
          } else if (comp.competitiveAdvantage === 'more_expensive') {
            supplierSummary.moreExpensiveCount++;
          } else {
            supplierSummary.sameCount++;
          }
        });
      }

      // Finalize supplier summaries
      Object.values(supplierDifferentials).forEach(supplier => {
        supplier.averageDifferential = supplier.averageDifferential / supplier.totalComparisons;
        supplier.averagePercentageDifference = supplier.averagePercentageDifference / supplier.totalComparisons;
        supplier.competitiveRatio = supplier.cheaperCount / supplier.totalComparisons;
      });

      summary.comparisons = Object.values(supplierDifferentials)
        .sort((a, b) => a.averagePercentageDifference - b.averagePercentageDifference);

      return {
        differentials,
        summary,
        metadata: {
          baseSupplierId,
          currency,
          quantity,
          analysisTimestamp: new Date().toISOString()
        }
      };
    }, cacheKey, 300);
  }

  /**
   * Track market price positioning for each supplier
   * @param {Object} params - Parameters for market positioning analysis
   * @param {Array} params.supplierIds - Array of supplier IDs to analyze (optional)
   * @param {Array} params.skus - Array of SKUs to analyze (optional)
   * @param {string} params.currency - Currency to filter by (default: 'USD')
   * @param {number} params.quantity - Quantity for calculations (default: 1)
   * @returns {Object} Market positioning analysis
   */
  async trackMarketPricePositioning(params = {}) {
    const {
      supplierIds = null,
      skus = null,
      currency = 'USD',
      quantity = 1
    } = params;

    const cacheKey = `market_positioning_${JSON.stringify(params)}`;

    return await this.executeWithCache(async () => {
      const priceComparison = await this.comparePricesAcrossSuppliers({
        supplierIds,
        skus,
        currency,
        quantity
      });

      const marketPositioning = {};
      const overallMarketMetrics = {
        averageMarketPrice: 0,
        priceLeaders: [],
        priceFollowers: [],
        marketSegments: {
          premium: [],
          midMarket: [],
          budget: []
        }
      };

      // Calculate market positioning for each supplier
      for (const [supplierId, supplierSummary] of Object.entries(priceComparison.data.supplierSummary)) {
        marketPositioning[supplierId] = {
          supplierId,
          supplierName: supplierSummary.supplierName,
          positioning: {
            averageMarketPrice: 0,
            priceLeadershipScore: supplierSummary.competitiveRating,
            marketShare: 0, // Based on number of competitive products
            priceStrategy: '',
            competitiveAdvantages: [],
            marketSegment: ''
          },
          productAnalysis: {
            totalProducts: supplierSummary.totalProducts,
            priceLeaderProducts: supplierSummary.priceLeaderCount,
            aboveMarketProducts: 0,
            belowMarketProducts: 0
          }
        };
      }

      // Analyze each SKU for market positioning
      const allMarketPrices = [];
      for (const [sku, comparison] of Object.entries(priceComparison.data.comparison)) {
        const marketPrice = comparison.priceAnalysis.averagePrice;
        allMarketPrices.push(marketPrice);

        comparison.suppliers.forEach(supplier => {
          const positioning = marketPositioning[supplier.supplierId];
          if (positioning) {
            positioning.positioning.averageMarketPrice += supplier.effectivePrice;
            
            if (supplier.effectivePrice > marketPrice) {
              positioning.productAnalysis.aboveMarketProducts++;
            } else if (supplier.effectivePrice < marketPrice) {
              positioning.productAnalysis.belowMarketProducts++;
            }
          }
        });
      }

      // Calculate overall market metrics
      overallMarketMetrics.averageMarketPrice = allMarketPrices.reduce((sum, price) => sum + price, 0) / allMarketPrices.length;

      // Finalize positioning analysis
      for (const positioning of Object.values(marketPositioning)) {
        // Calculate average market price for this supplier
        positioning.positioning.averageMarketPrice = positioning.positioning.averageMarketPrice / positioning.productAnalysis.totalProducts;
        
        // Determine market share (simplified as percentage of total products)
        const totalProducts = Object.values(priceComparison.data.comparison).length;
        positioning.positioning.marketShare = (positioning.productAnalysis.totalProducts / totalProducts) * 100;

        // Determine price strategy
        const avgSupplierPrice = positioning.positioning.averageMarketPrice;
        const marketAvg = overallMarketMetrics.averageMarketPrice;
        
        if (avgSupplierPrice < marketAvg * 0.9) {
          positioning.positioning.priceStrategy = 'cost_leader';
          positioning.positioning.marketSegment = 'budget';
          overallMarketMetrics.marketSegments.budget.push(positioning);
        } else if (avgSupplierPrice > marketAvg * 1.1) {
          positioning.positioning.priceStrategy = 'premium_pricing';
          positioning.positioning.marketSegment = 'premium';
          overallMarketMetrics.marketSegments.premium.push(positioning);
        } else {
          positioning.positioning.priceStrategy = 'market_follower';
          positioning.positioning.marketSegment = 'midMarket';
          overallMarketMetrics.marketSegments.midMarket.push(positioning);
        }

        // Identify competitive advantages
        if (positioning.positioning.priceLeadershipScore > 50) {
          positioning.positioning.competitiveAdvantages.push('price_leadership');
        }
        if (positioning.positioning.marketShare > 20) {
          positioning.positioning.competitiveAdvantages.push('market_presence');
        }
        if (positioning.productAnalysis.belowMarketProducts > positioning.productAnalysis.aboveMarketProducts) {
          positioning.positioning.competitiveAdvantages.push('competitive_pricing');
        }

        // Categorize as price leader or follower
        if (positioning.positioning.priceLeadershipScore > 30) {
          overallMarketMetrics.priceLeaders.push(positioning);
        } else {
          overallMarketMetrics.priceFollowers.push(positioning);
        }
      }

      // Sort market segments
      overallMarketMetrics.priceLeaders.sort((a, b) => b.positioning.priceLeadershipScore - a.positioning.priceLeadershipScore);
      overallMarketMetrics.priceFollowers.sort((a, b) => b.positioning.priceLeadershipScore - a.positioning.priceLeadershipScore);

      return {
        marketPositioning,
        overallMarketMetrics,
        insights: this.generateMarketInsights(marketPositioning, overallMarketMetrics),
        metadata: {
          totalSuppliers: Object.keys(marketPositioning).length,
          totalProducts: Object.keys(priceComparison.data.comparison).length,
          currency,
          quantity,
          analysisTimestamp: new Date().toISOString()
        }
      };
    }, cacheKey, 300);
  }

  /**
   * Calculate average market prices for products across suppliers
   * @param {Object} params - Parameters for market price calculation
   * @param {Array} params.skus - Array of SKUs to analyze (optional)
   * @param {string} params.currency - Currency to filter by (default: 'USD')
   * @param {boolean} params.weightBySupplierReliability - Weight prices by supplier metrics (default: false)
   * @param {number} params.quantity - Quantity for calculations (default: 1)
   * @returns {Object} Average market prices and trends
   */
  async calculateAverageMarketPrices(params = {}) {
    const {
      skus = null,
      currency = 'USD',
      weightBySupplierReliability = false,
      quantity = 1
    } = params;

    const cacheKey = `average_market_prices_${JSON.stringify(params)}`;

    return await this.executeWithCache(async () => {
      const priceComparison = await this.comparePricesAcrossSuppliers({
        skus,
        currency,
        quantity
      });

      const marketPrices = {};
      const marketTrends = {
        overallAverage: 0,
        priceDistribution: {
          budget: [],     // Bottom 25%
          economy: [],    // 25-50%
          midMarket: [],  // 50-75%
          premium: []     // Top 25%
        },
        volatility: 0
      };

      // Calculate market prices for each SKU
      const allSkuPrices = [];
      for (const [sku, comparison] of Object.entries(priceComparison.data.comparison)) {
        const prices = comparison.suppliers.map(s => s.effectivePrice);
        
        // Calculate different types of averages
        const simpleAverage = prices.reduce((sum, price) => sum + price, 0) / prices.length;
        const median = this.calculateMedian(prices);
        const mode = this.calculateMode(prices);
        
        // Weighted average (if requested)
        let weightedAverage = simpleAverage;
        if (weightBySupplierReliability) {
          weightedAverage = this.calculateWeightedPrice(comparison.suppliers, priceComparison.data.supplierSummary);
        }

        marketPrices[sku] = {
          sku,
          description: comparison.description,
          pricing: {
            simpleAverage,
            weightedAverage,
            median,
            mode,
            minimum: Math.min(...prices),
            maximum: Math.max(...prices),
            range: Math.max(...prices) - Math.min(...prices),
            standardDeviation: this.calculateStandardDeviation(prices),
            variance: this.calculateVariance(prices)
          },
          supplierCount: prices.length,
          priceDistribution: this.categorizePriceDistribution(prices),
          marketPosition: this.determineMarketPosition(simpleAverage, Math.min(...prices), Math.max(...prices)),
          currency
        };

        allSkuPrices.push(simpleAverage);
      }

      // Calculate overall market trends
      marketTrends.overallAverage = allSkuPrices.reduce((sum, price) => sum + price, 0) / allSkuPrices.length;
      marketTrends.volatility = this.calculateStandardDeviation(allSkuPrices) / marketTrends.overallAverage;

      // Categorize products by price ranges
      const sortedPrices = allSkuPrices.sort((a, b) => a - b);
      const q1 = sortedPrices[Math.floor(sortedPrices.length * 0.25)];
      const q2 = sortedPrices[Math.floor(sortedPrices.length * 0.50)];
      const q3 = sortedPrices[Math.floor(sortedPrices.length * 0.75)];

      for (const [sku, marketPrice] of Object.entries(marketPrices)) {
        const avgPrice = marketPrice.pricing.simpleAverage;
        
        if (avgPrice <= q1) {
          marketTrends.priceDistribution.budget.push({ sku, avgPrice });
        } else if (avgPrice <= q2) {
          marketTrends.priceDistribution.economy.push({ sku, avgPrice });
        } else if (avgPrice <= q3) {
          marketTrends.priceDistribution.midMarket.push({ sku, avgPrice });
        } else {
          marketTrends.priceDistribution.premium.push({ sku, avgPrice });
        }
      }

      return {
        marketPrices,
        marketTrends,
        benchmarks: {
          budgetThreshold: q1,
          economyThreshold: q2,
          midMarketThreshold: q3,
          premiumThreshold: sortedPrices[sortedPrices.length - 1]
        },
        recommendations: this.generateMarketPriceRecommendations(marketPrices, marketTrends),
        metadata: {
          totalProducts: Object.keys(marketPrices).length,
          currency,
          quantity,
          weightedByReliability: weightBySupplierReliability,
          analysisTimestamp: new Date().toISOString()
        }
      };
    }, cacheKey, 300);
  }

  /**
   * Provide recommendations for price negotiations based on market analysis
   * @param {Object} params - Parameters for negotiation recommendations
   * @param {string} params.supplierId - Target supplier ID for negotiations
   * @param {Array} params.skus - Array of SKUs to negotiate (optional)
   * @param {string} params.currency - Currency to filter by (default: 'USD')
   * @param {number} params.targetSavingsPercentage - Target savings goal (default: 10)
   * @param {number} params.quantity - Expected purchase quantity (default: 1)
   * @returns {Object} Negotiation recommendations and strategies
   */
  async generateNegotiationRecommendations(params = {}) {
    const {
      supplierId,
      skus = null,
      currency = 'USD',
      targetSavingsPercentage = 10,
      quantity = 1
    } = params;

    if (!supplierId) {
      throw new Error('Supplier ID is required for negotiation recommendations');
    }

    const cacheKey = `negotiation_recommendations_${JSON.stringify(params)}`;

    return await this.executeWithCache(async () => {
      // Get comprehensive analysis data
      const [priceComparison, marketPositioning, marketPrices, opportunities] = await Promise.all([
        this.comparePricesAcrossSuppliers({ supplierIds: [supplierId], skus, currency, quantity }),
        this.trackMarketPricePositioning({ supplierIds: [supplierId], skus, currency, quantity }),
        this.calculateAverageMarketPrices({ skus, currency, quantity }),
        this.identifyPriceSavingsOpportunities({ supplierIds: [supplierId], skus, currency, savingsThreshold: 1, quantity })
      ]);

      const supplierData = priceComparison.data.supplierSummary[supplierId];
      const supplierPositioning = marketPositioning.marketPositioning[supplierId];

      if (!supplierData || !supplierPositioning) {
        throw new Error('Supplier not found in analysis data');
      }

      const recommendations = {
        supplier: {
          id: supplierId,
          name: supplierData.supplierName,
          currentPosition: supplierPositioning.positioning.marketSegment,
          priceStrategy: supplierPositioning.positioning.priceStrategy,
          competitiveRating: supplierData.competitiveRating
        },
        negotiationStrategy: this.determineNegotiationStrategy(supplierPositioning, marketPositioning.overallMarketMetrics),
        productRecommendations: [],
        leveragePoints: [],
        expectedOutcomes: {
          targetSavingsPercentage,
          estimatedSavings: 0,
          negotiationSuccessProbability: 0
        }
      };

      // Analyze each product for negotiation opportunities
      let totalCurrentCost = 0;
      let totalPotentialSavings = 0;

      for (const [sku, comparison] of Object.entries(priceComparison.data.comparison)) {
        const supplierProduct = comparison.suppliers.find(s => s.supplierId === supplierId);
        if (!supplierProduct) continue;

        const marketPrice = marketPrices.data.marketPrices[sku];
        if (!marketPrice) continue;

        const currentPrice = supplierProduct.effectivePrice;
        const marketAverage = marketPrice.pricing.simpleAverage;
        const bestMarketPrice = comparison.priceAnalysis.bestPrice;

        // Calculate negotiation potential
        const aboveMarketPercentage = ((currentPrice - marketAverage) / marketAverage) * 100;
        const savingsPotential = currentPrice - bestMarketPrice;
        const targetPrice = currentPrice * (1 - targetSavingsPercentage / 100);

        const productRecommendation = {
          sku,
          description: supplierProduct.description || comparison.description,
          currentPrice,
          marketAverage,
          bestMarketPrice,
          targetPrice,
          negotiationPotential: {
            aboveMarketPercentage,
            savingsPotential,
            negotiationRoom: Math.max(0, currentPrice - marketPrice.pricing.median),
            priorityLevel: this.calculateNegotiationPriority(aboveMarketPercentage, savingsPotential, quantity)
          },
          strategy: this.generateProductNegotiationStrategy(currentPrice, marketAverage, bestMarketPrice, supplierPositioning),
          benchmarks: {
            competitorPrices: comparison.suppliers
              .filter(s => s.supplierId !== supplierId)
              .slice(0, 3)
              .map(s => ({ supplier: s.supplierName, price: s.effectivePrice }))
          }
        };

        recommendations.productRecommendations.push(productRecommendation);
        totalCurrentCost += currentPrice * quantity;
        totalPotentialSavings += Math.max(0, currentPrice - targetPrice) * quantity;
      }

      // Sort by negotiation priority
      recommendations.productRecommendations.sort((a, b) => b.negotiationPotential.priorityLevel - a.negotiationPotential.priorityLevel);

      // Calculate expected outcomes
      recommendations.expectedOutcomes.estimatedSavings = totalPotentialSavings;
      recommendations.expectedOutcomes.negotiationSuccessProbability = this.calculateNegotiationSuccessProbability(
        supplierPositioning,
        marketPositioning.overallMarketMetrics,
        recommendations.productRecommendations
      );

      // Generate leverage points
      recommendations.leveragePoints = this.identifyNegotiationLeverage(
        supplierPositioning,
        marketPositioning.overallMarketMetrics,
        opportunities.data.opportunities,
        recommendations.productRecommendations
      );

      return {
        recommendations,
        supportingData: {
          marketAnalysis: marketPositioning,
          competitorBenchmarks: priceComparison.data,
          savingsOpportunities: opportunities.data
        },
        metadata: {
          supplierId,
          totalProducts: recommendations.productRecommendations.length,
          currency,
          targetSavingsPercentage,
          quantity,
          analysisTimestamp: new Date().toISOString()
        }
      };
    }, cacheKey, 300);
  }

  // ==================== HELPER METHODS FOR PRICE ANALYTICS ====================

  /**
   * Calculate effective price considering tier pricing and discounts
   */
  calculateEffectivePrice(priceItem, quantity) {
    let basePrice = parseFloat(priceItem.unitPrice);
    let effectivePrice = basePrice;

    // Apply tier pricing if available
    if (priceItem.tierPricing && Array.isArray(priceItem.tierPricing)) {
      const applicableTier = priceItem.tierPricing
        .filter(tier => tier.minQty <= quantity)
        .sort((a, b) => b.minQty - a.minQty)[0];

      if (applicableTier) {
        effectivePrice = applicableTier.price ? parseFloat(applicableTier.price) : basePrice;
        if (applicableTier.discount) {
          effectivePrice = effectivePrice * (1 - parseFloat(applicableTier.discount) / 100);
        }
      }
    }

    // Apply discount percentage
    if (priceItem.discountPercent) {
      effectivePrice = effectivePrice * (1 - parseFloat(priceItem.discountPercent) / 100);
    }

    return Math.round(effectivePrice * 100) / 100; // Round to 2 decimal places
  }

  /**
   * Calculate variance for price analysis
   */
  calculateVariance(prices) {
    if (prices.length === 0) return 0;
    const mean = prices.reduce((sum, price) => sum + price, 0) / prices.length;
    const squaredDifferences = prices.map(price => Math.pow(price - mean, 2));
    return squaredDifferences.reduce((sum, diff) => sum + diff, 0) / prices.length;
  }

  /**
   * Calculate standard deviation
   */
  calculateStandardDeviation(prices) {
    return Math.sqrt(this.calculateVariance(prices));
  }

  /**
   * Calculate median price
   */
  calculateMedian(prices) {
    const sorted = [...prices].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 0 
      ? (sorted[mid - 1] + sorted[mid]) / 2 
      : sorted[mid];
  }

  /**
   * Calculate mode (most frequent price)
   */
  calculateMode(prices) {
    const frequency = {};
    let maxFreq = 0;
    let mode = prices[0];

    prices.forEach(price => {
      frequency[price] = (frequency[price] || 0) + 1;
      if (frequency[price] > maxFreq) {
        maxFreq = frequency[price];
        mode = price;
      }
    });

    return mode;
  }

  /**
   * Generate pricing recommendation based on comparison data
   */
  generatePricingRecommendation(comparison, savingsThreshold) {
    const savingsPercentage = ((comparison.priceAnalysis.worstPrice - comparison.priceAnalysis.bestPrice) / comparison.priceAnalysis.worstPrice) * 100;
    
    if (savingsPercentage >= savingsThreshold * 2) {
      return {
        priority: 'high',
        action: 'immediate_supplier_switch',
        reason: `Significant savings opportunity of ${savingsPercentage.toFixed(1)}%`
      };
    } else if (savingsPercentage >= savingsThreshold) {
      return {
        priority: 'medium',
        action: 'negotiate_or_evaluate_switch',
        reason: `Moderate savings opportunity of ${savingsPercentage.toFixed(1)}%`
      };
    } else {
      return {
        priority: 'low',
        action: 'monitor_prices',
        reason: 'Limited savings opportunity, monitor for changes'
      };
    }
  }

  /**
   * Generate overall recommendations based on opportunities and supplier summary
   */
  generateOverallRecommendations(opportunities, supplierSummary) {
    const recommendations = [];

    // Strategic recommendations
    if (opportunities.length > 0) {
      const avgSavings = opportunities.reduce((sum, opp) => sum + opp.savingsPercentage, 0) / opportunities.length;
      
      recommendations.push({
        type: 'strategic',
        priority: 'high',
        title: 'Cost Reduction Initiative',
        description: `${opportunities.length} products identified with average savings potential of ${avgSavings.toFixed(1)}%`,
        actions: [
          'Prioritize negotiations for highest-savings products',
          'Consider supplier diversification for better pricing',
          'Implement regular price monitoring and benchmarking'
        ]
      });
    }

    // Supplier-specific recommendations
    const topPerformers = Object.values(supplierSummary)
      .sort((a, b) => b.competitiveRating - a.competitiveRating)
      .slice(0, 3);

    if (topPerformers.length > 0) {
      recommendations.push({
        type: 'supplier_management',
        priority: 'medium',
        title: 'Supplier Performance Optimization',
        description: 'Focus on top-performing suppliers for strategic partnerships',
        actions: [
          `Strengthen relationship with ${topPerformers[0].supplierName} (${topPerformers[0].competitiveRating.toFixed(1)}% price leadership)`,
          'Evaluate volume commitments for better pricing',
          'Consider long-term contracts with top performers'
        ]
      });
    }

    return recommendations;
  }

  /**
   * Generate market insights based on positioning analysis
   */
  generateMarketInsights(marketPositioning, overallMetrics) {
    const insights = [];

    // Market concentration analysis
    const totalSuppliers = Object.keys(marketPositioning).length;
    const priceLeaders = overallMetrics.priceLeaders.length;
    const concentration = (priceLeaders / totalSuppliers) * 100;

    insights.push({
      type: 'market_structure',
      insight: `Market concentration: ${concentration.toFixed(1)}% of suppliers are price leaders`,
      implication: concentration > 30 
        ? 'Highly competitive market with many price leaders'
        : 'Market dominated by few price leaders, potential for negotiation'
    });

    // Segment analysis
    const segments = overallMetrics.marketSegments;
    const dominantSegment = Object.entries(segments)
      .sort(([,a], [,b]) => b.length - a.length)[0];

    insights.push({
      type: 'market_segmentation',
      insight: `${dominantSegment[0]} segment dominates with ${dominantSegment[1].length} suppliers`,
      implication: 'Consider segment-specific sourcing strategies'
    });

    return insights;
  }

  /**
   * Calculate weighted price based on supplier reliability
   */
  calculateWeightedPrice(suppliers, supplierSummary) {
    let totalWeight = 0;
    let weightedSum = 0;

    suppliers.forEach(supplier => {
      const summary = supplierSummary[supplier.supplierId];
      const weight = summary ? summary.competitiveRating / 100 : 0.5; // Default weight
      
      weightedSum += supplier.effectivePrice * weight;
      totalWeight += weight;
    });

    return totalWeight > 0 ? weightedSum / totalWeight : 0;
  }

  /**
   * Categorize price distribution for market analysis
   */
  categorizePriceDistribution(prices) {
    const sorted = [...prices].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted[sorted.length - 1];
    const range = max - min;

    return {
      budget: prices.filter(p => p <= min + range * 0.25).length,
      economy: prices.filter(p => p > min + range * 0.25 && p <= min + range * 0.5).length,
      midMarket: prices.filter(p => p > min + range * 0.5 && p <= min + range * 0.75).length,
      premium: prices.filter(p => p > min + range * 0.75).length
    };
  }

  /**
   * Determine market position based on price ranges
   */
  determineMarketPosition(price, minPrice, maxPrice) {
    const range = maxPrice - minPrice;
    const position = (price - minPrice) / range;

    if (position <= 0.25) return 'budget';
    if (position <= 0.5) return 'economy';
    if (position <= 0.75) return 'midMarket';
    return 'premium';
  }

  /**
   * Generate market price recommendations
   */
  generateMarketPriceRecommendations(marketPrices, marketTrends) {
    const recommendations = [];

    // High volatility products
    const highVolatilityProducts = Object.values(marketPrices)
      .filter(mp => (mp.pricing.standardDeviation / mp.pricing.simpleAverage) > 0.2)
      .sort((a, b) => b.pricing.standardDeviation - a.pricing.standardDeviation);

    if (highVolatilityProducts.length > 0) {
      recommendations.push({
        type: 'risk_management',
        priority: 'high',
        title: 'High Price Volatility Alert',
        description: `${highVolatilityProducts.length} products show high price volatility`,
        products: highVolatilityProducts.slice(0, 5).map(p => p.sku),
        action: 'Consider fixed-price contracts or hedging strategies'
      });
    }

    // Market opportunities
    if (marketTrends.volatility < 0.1) {
      recommendations.push({
        type: 'market_opportunity',
        priority: 'medium',
        title: 'Stable Market Conditions',
        description: 'Low market volatility presents opportunity for long-term commitments',
        action: 'Negotiate longer-term contracts for price stability'
      });
    }

    return recommendations;
  }

  /**
   * Determine negotiation strategy based on supplier positioning
   */
  determineNegotiationStrategy(supplierPositioning, marketMetrics) {
    const positioning = supplierPositioning.positioning;
    
    switch (positioning.priceStrategy) {
      case 'cost_leader':
        return {
          approach: 'value_partnership',
          tactics: ['Volume commitments', 'Long-term contracts', 'Value-added services'],
          leverage: 'low',
          expectedSuccess: 'medium'
        };
      case 'premium_pricing':
        return {
          approach: 'competitive_benchmarking',
          tactics: ['Market price comparisons', 'Alternative supplier options', 'Value justification'],
          leverage: 'high',
          expectedSuccess: 'high'
        };
      case 'market_follower':
        return {
          approach: 'collaborative_optimization',
          tactics: ['Process improvements', 'Volume incentives', 'Payment terms'],
          leverage: 'medium',
          expectedSuccess: 'medium'
        };
      default:
        return {
          approach: 'data_driven',
          tactics: ['Market analysis', 'Competitive positioning', 'Mutual benefits'],
          leverage: 'medium',
          expectedSuccess: 'medium'
        };
    }
  }

  /**
   * Generate product-specific negotiation strategy
   */
  generateProductNegotiationStrategy(currentPrice, marketAverage, bestMarketPrice, supplierPositioning) {
    const aboveMarket = currentPrice > marketAverage;
    const percentageAbove = ((currentPrice - marketAverage) / marketAverage) * 100;

    if (aboveMarket && percentageAbove > 15) {
      return {
        approach: 'aggressive',
        targetPrice: Math.max(bestMarketPrice, marketAverage),
        arguments: ['Significant above-market pricing', 'Competitive alternatives available'],
        timeline: 'immediate'
      };
    } else if (aboveMarket && percentageAbove > 5) {
      return {
        approach: 'collaborative',
        targetPrice: marketAverage,
        arguments: ['Market alignment', 'Mutual value optimization'],
        timeline: 'short-term'
      };
    } else {
      return {
        approach: 'maintenance',
        targetPrice: currentPrice * 0.98, // Small 2% improvement
        arguments: ['Relationship strengthening', 'Volume considerations'],
        timeline: 'long-term'
      };
    }
  }

  /**
   * Calculate negotiation priority based on multiple factors
   */
  calculateNegotiationPriority(aboveMarketPercentage, savingsPotential, quantity) {
    let priority = 0;
    
    // Weight by percentage above market
    priority += Math.min(aboveMarketPercentage, 50) * 2;
    
    // Weight by absolute savings potential
    priority += Math.min(savingsPotential * quantity, 10000) / 100;
    
    // Weight by quantity impact
    priority += Math.min(quantity, 1000) / 10;
    
    return Math.min(priority, 100); // Cap at 100
  }

  /**
   * Calculate negotiation success probability
   */
  calculateNegotiationSuccessProbability(supplierPositioning, marketMetrics, productRecommendations) {
    let baseProbability = 0.5; // 50% base probability
    
    // Adjust based on supplier's market position
    if (supplierPositioning.positioning.priceStrategy === 'premium_pricing') {
      baseProbability += 0.2; // Higher chance with premium suppliers
    } else if (supplierPositioning.positioning.priceStrategy === 'cost_leader') {
      baseProbability -= 0.1; // Lower chance with cost leaders
    }
    
    // Adjust based on how many products are above market
    const aboveMarketCount = productRecommendations.filter(p => p.negotiationPotential.aboveMarketPercentage > 5).length;
    const aboveMarketRatio = aboveMarketCount / productRecommendations.length;
    baseProbability += aboveMarketRatio * 0.3;
    
    // Adjust based on market competition
    const priceLeaderRatio = marketMetrics.priceLeaders.length / (marketMetrics.priceLeaders.length + marketMetrics.priceFollowers.length);
    baseProbability += priceLeaderRatio * 0.2;
    
    return Math.min(Math.max(baseProbability, 0.1), 0.9); // Keep between 10% and 90%
  }

  /**
   * Identify negotiation leverage points
   */
  identifyNegotiationLeverage(supplierPositioning, marketMetrics, opportunities, productRecommendations) {
    const leveragePoints = [];
    
    // Market position leverage
    if (supplierPositioning.positioning.priceStrategy === 'premium_pricing') {
      leveragePoints.push({
        type: 'market_position',
        strength: 'high',
        description: 'Supplier prices significantly above market average',
        useCase: 'Emphasize competitive alternatives and market benchmarks'
      });
    }
    
    // Volume leverage
    const totalProducts = productRecommendations.length;
    if (totalProducts > 10) {
      leveragePoints.push({
        type: 'volume',
        strength: 'medium',
        description: `Large product portfolio (${totalProducts} items) provides volume leverage`,
        useCase: 'Negotiate portfolio-wide discounts or volume commitments'
      });
    }
    
    // Competitive leverage
    const highOpportunityCount = opportunities.filter(opp => opp.savingsPercentage > 15).length;
    if (highOpportunityCount > 0) {
      leveragePoints.push({
        type: 'competitive',
        strength: 'high',
        description: `${highOpportunityCount} products with significant competitive price advantages`,
        useCase: 'Present specific competitive alternatives for high-impact products'
      });
    }
    
    // Market timing leverage
    const marketSegment = supplierPositioning.positioning.marketSegment;
    if (marketSegment === 'premium' && marketMetrics.marketSegments.budget.length > marketMetrics.marketSegments.premium.length) {
      leveragePoints.push({
        type: 'market_timing',
        strength: 'medium',
        description: 'Market shift toward budget options provides timing leverage',
        useCase: 'Highlight market trends toward cost optimization'
      });
    }
    
    return leveragePoints;
  }

  // ==================== ENHANCED SUPPLIER PERFORMANCE METRICS ====================

  /**
   * Calculate comprehensive on-time delivery rate from inventory movements
   * Uses expected vs actual delivery dates with statistical analysis
   */
  async calculateOnTimeDeliveryRate(supplierId, params = {}) {
    const {
      dateFrom = null,
      dateTo = null,
      graceThreshold = 1, // days
      includePartialDeliveries = true
    } = params;

    const cacheKey = `supplier_delivery_rate:${supplierId}:${dateFrom}:${dateTo}:${graceThreshold}`;
    
    return await this.executeWithCache(async () => {
      const baseDate = dateTo ? new Date(dateTo) : new Date();
      const startDate = dateFrom ? new Date(dateFrom) : new Date(baseDate.getTime() - 90 * 24 * 60 * 60 * 1000);

      // Get delivery performance data from inventory movements
      const deliveryData = await db.select({
        movementId: inventoryMovements.id,
        expectedDate: inventoryMovements.expectedDate,
        actualDate: inventoryMovements.createdAt,
        quantity: inventoryMovements.quantity,
        referenceId: inventoryMovements.referenceId,
        totalCost: inventoryMovements.totalCost
      })
      .from(inventoryMovements)
      .innerJoin(products, eq(inventoryMovements.productId, products.id))
      .where(and(
        eq(products.supplierId, supplierId),
        eq(inventoryMovements.movementType, 'purchase'),
        gte(inventoryMovements.createdAt, startDate),
        lte(inventoryMovements.createdAt, baseDate),
        sql`${inventoryMovements.expectedDate} IS NOT NULL`
      ))
      .orderBy(inventoryMovements.createdAt);

      if (deliveryData.length === 0) {
        return {
          onTimeDeliveryRate: 0,
          totalDeliveries: 0,
          onTimeDeliveries: 0,
          lateDeliveries: 0,
          earlyDeliveries: 0,
          averageDelayDays: 0,
          delayVariance: 0,
          performanceClass: 'insufficient_data'
        };
      }

      let onTimeCount = 0;
      let lateCount = 0;
      let earlyCount = 0;
      const delays = [];

      deliveryData.forEach(delivery => {
        const expectedDate = new Date(delivery.expectedDate);
        const actualDate = new Date(delivery.actualDate);
        const delayDays = Math.ceil((actualDate - expectedDate) / (1000 * 60 * 60 * 24));
        
        delays.push(delayDays);
        
        if (Math.abs(delayDays) <= graceThreshold) {
          onTimeCount++;
        } else if (delayDays > graceThreshold) {
          lateCount++;
        } else {
          earlyCount++;
        }
      });

      const onTimeRate = (onTimeCount / deliveryData.length) * 100;
      const avgDelay = delays.reduce((sum, delay) => sum + delay, 0) / delays.length;
      const variance = delays.reduce((sum, delay) => sum + Math.pow(delay - avgDelay, 2), 0) / delays.length;

      // Performance classification
      let performanceClass = 'poor';
      if (onTimeRate >= 95) performanceClass = 'excellent';
      else if (onTimeRate >= 85) performanceClass = 'good';
      else if (onTimeRate >= 70) performanceClass = 'fair';

      return {
        onTimeDeliveryRate: parseFloat(onTimeRate.toFixed(2)),
        totalDeliveries: deliveryData.length,
        onTimeDeliveries: onTimeCount,
        lateDeliveries: lateCount,
        earlyDeliveries: earlyCount,
        averageDelayDays: parseFloat(avgDelay.toFixed(2)),
        delayVariance: parseFloat(variance.toFixed(2)),
        performanceClass
      };
    }, 600); // 10 minute cache
  }

  /**
   * Calculate price stability index based on price variance over time
   * Analyzes price volatility and trend consistency
   */
  async calculatePriceStabilityIndex(supplierId, params = {}) {
    const {
      dateFrom = null,
      dateTo = null,
      analysisWindow = 30 // days
    } = params;

    const cacheKey = `supplier_price_stability:${supplierId}:${dateFrom}:${dateTo}:${analysisWindow}`;
    
    return await this.executeWithCache(async () => {
      const baseDate = dateTo ? new Date(dateTo) : new Date();
      const startDate = dateFrom ? new Date(dateFrom) : new Date(baseDate.getTime() - 180 * 24 * 60 * 60 * 1000);

      // Get price history from price list items and inventory movements
      const [priceListHistory, movementPrices] = await Promise.all([
        // Price list changes
        db.select({
          date: priceLists.updatedAt,
          sku: priceListItems.sku,
          price: priceListItems.unitPrice,
          currency: priceListItems.currency,
          source: sql`'price_list'`
        })
        .from(priceLists)
        .innerJoin(priceListItems, eq(priceLists.id, priceListItems.priceListId))
        .where(and(
          eq(priceLists.supplierId, supplierId),
          gte(priceLists.updatedAt, startDate),
          lte(priceLists.updatedAt, baseDate)
        ))
        .orderBy(priceListItems.sku, priceLists.updatedAt),

        // Actual purchase prices from movements
        db.select({
          date: inventoryMovements.createdAt,
          sku: products.sku,
          price: inventoryMovements.unitCost,
          currency: sql`'USD'`,
          source: sql`'purchase'`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(
          eq(products.supplierId, supplierId),
          eq(inventoryMovements.movementType, 'purchase'),
          gte(inventoryMovements.createdAt, startDate),
          lte(inventoryMovements.createdAt, baseDate),
          sql`${inventoryMovements.unitCost} IS NOT NULL`
        ))
        .orderBy(products.sku, inventoryMovements.createdAt)
      ]);

      // Combine and analyze price data by SKU
      const skuAnalysis = {};
      [...priceListHistory, ...movementPrices].forEach(record => {
        if (!skuAnalysis[record.sku]) {
          skuAnalysis[record.sku] = [];
        }
        skuAnalysis[record.sku].push({
          date: new Date(record.date),
          price: parseFloat(record.price),
          source: record.source
        });
      });

      const stabilityMetrics = {};
      let totalVarianceScore = 0;
      let totalFrequencyScore = 0;
      let skuCount = 0;

      Object.entries(skuAnalysis).forEach(([sku, pricePoints]) => {
        if (pricePoints.length < 2) return;

        // Sort by date
        pricePoints.sort((a, b) => a.date - b.date);

        // Calculate price changes
        const changes = [];
        for (let i = 1; i < pricePoints.length; i++) {
          const prev = pricePoints[i - 1];
          const curr = pricePoints[i];
          const changePercent = ((curr.price - prev.price) / prev.price) * 100;
          changes.push({
            changePercent,
            daysBetween: Math.ceil((curr.date - prev.date) / (1000 * 60 * 60 * 24))
          });
        }

        if (changes.length === 0) return;

        // Variance score (lower variance = more stable)
        const avgChange = changes.reduce((sum, c) => sum + Math.abs(c.changePercent), 0) / changes.length;
        const variance = changes.reduce((sum, c) => sum + Math.pow(Math.abs(c.changePercent) - avgChange, 2), 0) / changes.length;
        const varianceScore = Math.max(0, 100 - (variance * 2)); // Scale variance to 0-100

        // Frequency score (fewer changes = more stable)
        const changeFrequency = changes.length / ((pricePoints[pricePoints.length - 1].date - pricePoints[0].date) / (1000 * 60 * 60 * 24 * 30)); // changes per month
        const frequencyScore = Math.max(0, 100 - (changeFrequency * 20));

        stabilityMetrics[sku] = {
          pricePoints: pricePoints.length,
          changes: changes.length,
          averageChangePercent: parseFloat(avgChange.toFixed(2)),
          variance: parseFloat(variance.toFixed(2)),
          varianceScore: parseFloat(varianceScore.toFixed(2)),
          frequencyScore: parseFloat(frequencyScore.toFixed(2)),
          overallStability: parseFloat(((varianceScore + frequencyScore) / 2).toFixed(2))
        };

        totalVarianceScore += varianceScore;
        totalFrequencyScore += frequencyScore;
        skuCount++;
      });

      if (skuCount === 0) {
        return {
          priceStabilityIndex: 0,
          stabilityClass: 'insufficient_data',
          skuAnalysis: {},
          summary: {
            totalSkus: 0,
            averageVarianceScore: 0,
            averageFrequencyScore: 0,
            priceChanges: 0
          }
        };
      }

      const avgVarianceScore = totalVarianceScore / skuCount;
      const avgFrequencyScore = totalFrequencyScore / skuCount;
      const overallIndex = (avgVarianceScore + avgFrequencyScore) / 2;

      // Stability classification
      let stabilityClass = 'volatile';
      if (overallIndex >= 90) stabilityClass = 'highly_stable';
      else if (overallIndex >= 75) stabilityClass = 'stable';
      else if (overallIndex >= 60) stabilityClass = 'moderately_stable';
      else if (overallIndex >= 40) stabilityClass = 'unstable';

      return {
        priceStabilityIndex: parseFloat(overallIndex.toFixed(2)),
        stabilityClass,
        skuAnalysis: stabilityMetrics,
        summary: {
          totalSkus: skuCount,
          averageVarianceScore: parseFloat(avgVarianceScore.toFixed(2)),
          averageFrequencyScore: parseFloat(avgFrequencyScore.toFixed(2)),
          priceChanges: Object.values(stabilityMetrics).reduce((sum, s) => sum + s.changes, 0)
        }
      };
    }, 900); // 15 minute cache
  }

  /**
   * Calculate order fulfillment rate comparing delivered vs requested quantities
   * Includes analysis of partial deliveries and shortage patterns
   */
  async calculateOrderFulfillmentRate(supplierId, params = {}) {
    const {
      dateFrom = null,
      dateTo = null,
      minimumOrderValue = 0
    } = params;

    const cacheKey = `supplier_fulfillment:${supplierId}:${dateFrom}:${dateTo}:${minimumOrderValue}`;
    
    return await this.executeWithCache(async () => {
      const baseDate = dateTo ? new Date(dateTo) : new Date();
      const startDate = dateFrom ? new Date(dateFrom) : new Date(baseDate.getTime() - 90 * 24 * 60 * 60 * 1000);

      // Get order fulfillment data from inventory movements grouped by reference
      const fulfillmentData = await db.select({
        referenceId: inventoryMovements.referenceId,
        referenceNumber: inventoryMovements.referenceNumber,
        productId: inventoryMovements.productId,
        sku: products.sku,
        deliveredQuantity: sql`SUM(${inventoryMovements.quantity})::integer`,
        totalValue: sql`SUM(${inventoryMovements.totalCost})::numeric(12,2)`,
        deliveryDate: sql`MAX(${inventoryMovements.createdAt})`,
        deliveryCount: sql`COUNT(*)::integer`
      })
      .from(inventoryMovements)
      .innerJoin(products, eq(inventoryMovements.productId, products.id))
      .where(and(
        eq(products.supplierId, supplierId),
        eq(inventoryMovements.movementType, 'purchase'),
        gte(inventoryMovements.createdAt, startDate),
        lte(inventoryMovements.createdAt, baseDate),
        sql`${inventoryMovements.referenceId} IS NOT NULL`,
        gte(inventoryMovements.totalCost, minimumOrderValue)
      ))
      .groupBy(
        inventoryMovements.referenceId,
        inventoryMovements.referenceNumber,
        inventoryMovements.productId,
        products.sku
      )
      .orderBy(inventoryMovements.referenceId);

      if (fulfillmentData.length === 0) {
        return {
          orderFulfillmentRate: 0,
          totalOrders: 0,
          fullyFulfilledOrders: 0,
          partiallyFulfilledOrders: 0,
          averageFulfillmentPercent: 0,
          fulfillmentClass: 'insufficient_data'
        };
      }

      // Group by order reference and analyze fulfillment
      const orderAnalysis = {};
      fulfillmentData.forEach(item => {
        const orderId = item.referenceId;
        if (!orderAnalysis[orderId]) {
          orderAnalysis[orderId] = {
            referenceNumber: item.referenceNumber,
            totalValue: 0,
            lineItems: {},
            deliveryDate: item.deliveryDate
          };
        }
        
        orderAnalysis[orderId].lineItems[item.productId] = {
          sku: item.sku,
          deliveredQuantity: item.deliveredQuantity,
          totalValue: parseFloat(item.totalValue),
          deliveryCount: item.deliveryCount
        };
        
        orderAnalysis[orderId].totalValue += parseFloat(item.totalValue);
      });

      // For proper fulfillment analysis, we need expected quantities
      // Since we don't have purchase orders table, we'll estimate based on delivery patterns
      const orders = Object.values(orderAnalysis);
      let fullyFulfilled = 0;
      let partiallyFulfilled = 0;
      let totalFulfillmentPercent = 0;

      orders.forEach(order => {
        const lineItems = Object.values(order.lineItems);
        
        // Estimate fulfillment based on delivery patterns
        // If single delivery per line item, assume full fulfillment
        // If multiple deliveries, might indicate partial fulfillment
        let orderFulfillmentScore = 0;
        
        lineItems.forEach(item => {
          // Simple heuristic: single delivery = 100%, multiple = weighted average
          const itemScore = item.deliveryCount === 1 ? 100 : 85;
          orderFulfillmentScore += itemScore;
        });
        
        const avgFulfillment = orderFulfillmentScore / lineItems.length;
        totalFulfillmentPercent += avgFulfillment;
        
        if (avgFulfillment >= 95) {
          fullyFulfilled++;
        } else if (avgFulfillment >= 50) {
          partiallyFulfilled++;
        }
      });

      const fulfillmentRate = orders.length > 0 ? (fullyFulfilled / orders.length) * 100 : 0;
      const avgFulfillmentPercent = orders.length > 0 ? totalFulfillmentPercent / orders.length : 0;

      // Performance classification
      let fulfillmentClass = 'poor';
      if (fulfillmentRate >= 95) fulfillmentClass = 'excellent';
      else if (fulfillmentRate >= 85) fulfillmentClass = 'good';
      else if (fulfillmentRate >= 70) fulfillmentClass = 'fair';

      return {
        orderFulfillmentRate: parseFloat(fulfillmentRate.toFixed(2)),
        totalOrders: orders.length,
        fullyFulfilledOrders: fullyFulfilled,
        partiallyFulfilledOrders: partiallyFulfilled,
        averageFulfillmentPercent: parseFloat(avgFulfillmentPercent.toFixed(2)),
        fulfillmentClass,
        averageOrderValue: orders.length > 0 ? parseFloat((orders.reduce((sum, o) => sum + o.totalValue, 0) / orders.length).toFixed(2)) : 0
      };
    }, 600); // 10 minute cache
  }

  /**
   * Calculate quality scores from returns and defect data
   * Analyzes return rates, defect patterns, and quality trends
   */
  async calculateQualityScore(supplierId, params = {}) {
    const {
      dateFrom = null,
      dateTo = null,
      includeDefectAnalysis = true
    } = params;

    const cacheKey = `supplier_quality:${supplierId}:${dateFrom}:${dateTo}:${includeDefectAnalysis}`;
    
    return await this.executeWithCache(async () => {
      const baseDate = dateTo ? new Date(dateTo) : new Date();
      const startDate = dateFrom ? new Date(dateFrom) : new Date(baseDate.getTime() - 90 * 24 * 60 * 60 * 1000);

      // Get quality-related data from multiple sources
      const [returnData, purchaseData, analyticsData] = await Promise.all([
        // Return/defect movements
        db.select({
          productId: inventoryMovements.productId,
          sku: products.sku,
          returnQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))::integer`,
          returnValue: sql`SUM(ABS(${inventoryMovements.totalCost}))::numeric(12,2)`,
          returnCount: sql`COUNT(*)::integer`,
          defectType: inventoryMovements.notes
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(
          eq(products.supplierId, supplierId),
          or(
            eq(inventoryMovements.movementType, 'return'),
            eq(inventoryMovements.movementType, 'damage')
          ),
          gte(inventoryMovements.createdAt, startDate),
          lte(inventoryMovements.createdAt, baseDate)
        ))
        .groupBy(inventoryMovements.productId, products.sku, inventoryMovements.notes),

        // Total purchase data for comparison
        db.select({
          productId: inventoryMovements.productId,
          totalPurchaseQuantity: sql`SUM(${inventoryMovements.quantity})::integer`,
          totalPurchaseValue: sql`SUM(${inventoryMovements.totalCost})::numeric(12,2)`,
          purchaseCount: sql`COUNT(*)::integer`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(
          eq(products.supplierId, supplierId),
          eq(inventoryMovements.movementType, 'purchase'),
          gte(inventoryMovements.createdAt, startDate),
          lte(inventoryMovements.createdAt, baseDate)
        ))
        .groupBy(inventoryMovements.productId),

        // Quality metrics from analytics aggregates  
        db.select({
          returnRate: sql`AVG(${analyticsDailyAggregates.returnRate})::numeric(5,4)`,
          recordCount: sql`COUNT(*)::integer`
        })
        .from(analyticsDailyAggregates)
        .where(and(
          eq(analyticsDailyAggregates.dimension, 'supplier'),
          eq(analyticsDailyAggregates.dimensionId, supplierId),
          gte(analyticsDailyAggregates.date, startDate.toISOString().split('T')[0]),
          lte(analyticsDailyAggregates.date, baseDate.toISOString().split('T')[0])
        ))
      ]);

      // Build purchase baseline
      const purchaseBaseline = {};
      purchaseData.forEach(purchase => {
        purchaseBaseline[purchase.productId] = {
          totalQuantity: purchase.totalPurchaseQuantity,
          totalValue: parseFloat(purchase.totalPurchaseValue),
          purchaseCount: purchase.purchaseCount
        };
      });

      // Analyze returns by product
      const productQuality = {};
      let totalReturnRate = 0;
      let totalDefectRate = 0;
      let qualifiedProducts = 0;

      returnData.forEach(returnItem => {
        const baseline = purchaseBaseline[returnItem.productId];
        if (!baseline || baseline.totalQuantity === 0) return;

        const returnRate = (returnItem.returnQuantity / baseline.totalQuantity) * 100;
        const valueReturnRate = (parseFloat(returnItem.returnValue) / baseline.totalValue) * 100;
        
        productQuality[returnItem.productId] = {
          sku: returnItem.sku,
          returnRate: parseFloat(returnRate.toFixed(2)),
          valueReturnRate: parseFloat(valueReturnRate.toFixed(2)),
          returnQuantity: returnItem.returnQuantity,
          returnValue: parseFloat(returnItem.returnValue),
          returnIncidents: returnItem.returnCount,
          defectType: returnItem.defectType
        };

        totalReturnRate += returnRate;
        qualifiedProducts++;
      });

      // Calculate overall metrics
      const avgReturnRate = qualifiedProducts > 0 ? totalReturnRate / qualifiedProducts : 0;
      
      // Use analytics data if available, otherwise calculate from movements
      const analyticsQuality = analyticsData[0];
      const analyticsReturnRate = analyticsQuality && analyticsQuality.recordCount > 0 
        ? parseFloat(analyticsQuality.returnRate) * 100 // Convert to percentage
        : avgReturnRate;

      const baselineQualityScore = Math.max(0, 100 - (analyticsReturnRate * 10)); // 10% penalty per 1% return rate
      const defectRate = analyticsReturnRate / 100; // Use return rate as proxy for defect rate
      const customerSatisfaction = Math.max(0, 100 - (analyticsReturnRate * 5)); // Estimate satisfaction

      // Composite quality score
      const qualityWeights = {
        returnRate: 0.4,    // Lower return rate = higher quality
        defectRate: 0.3,    // Lower defect rate = higher quality  
        satisfaction: 0.3   // Higher satisfaction = higher quality
      };

      const returnScore = Math.max(0, 100 - (avgReturnRate * 10));
      const defectScore = Math.max(0, 100 - (defectRate * 1000));
      const satisfactionScore = customerSatisfaction;

      const compositeScore = (
        returnScore * qualityWeights.returnRate +
        defectScore * qualityWeights.defectRate +
        satisfactionScore * qualityWeights.satisfaction
      );

      // Quality classification
      let qualityClass = 'poor';
      if (compositeScore >= 90) qualityClass = 'excellent';
      else if (compositeScore >= 80) qualityClass = 'good';
      else if (compositeScore >= 70) qualityClass = 'fair';

      return {
        qualityScore: parseFloat(compositeScore.toFixed(2)),
        qualityClass,
        returnRate: parseFloat(analyticsReturnRate.toFixed(2)),
        defectRate: parseFloat((defectRate * 100).toFixed(2)), // Convert to percentage
        customerSatisfaction: parseFloat(customerSatisfaction.toFixed(2)),
        productAnalysis: productQuality,
        summary: {
          totalProducts: Object.keys(productQuality).length,
          totalReturns: returnData.reduce((sum, r) => sum + r.returnQuantity, 0),
          returnValue: returnData.reduce((sum, r) => sum + parseFloat(r.returnValue), 0),
          returnIncidents: returnData.reduce((sum, r) => sum + r.returnCount, 0)
        }
      };
    }, 600); // 10 minute cache
  }

  /**
   * Calculate response time metrics for supplier communications
   * Note: This is a placeholder implementation as we don't have communication tables
   */
  async calculateResponseTimeMetrics(supplierId, params = {}) {
    const {
      dateFrom = null,
      dateTo = null,
      communicationType = 'all'
    } = params;

    const cacheKey = `supplier_response_time:${supplierId}:${dateFrom}:${dateTo}:${communicationType}`;
    
    return await this.executeWithCache(async () => {
      // Since we don't have communication tables, we'll estimate from order processing times
      const baseDate = dateTo ? new Date(dateTo) : new Date();
      const startDate = dateFrom ? new Date(dateFrom) : new Date(baseDate.getTime() - 90 * 24 * 60 * 60 * 1000);

      // Estimate response time from order-to-delivery intervals
      const processingTimes = await db.select({
        referenceId: inventoryMovements.referenceId,
        orderDate: sql`MIN(${inventoryMovements.createdAt})`,
        deliveryDate: sql`MAX(${inventoryMovements.createdAt})`,
        totalValue: sql`SUM(${inventoryMovements.totalCost})::numeric(12,2)`
      })
      .from(inventoryMovements)
      .innerJoin(products, eq(inventoryMovements.productId, products.id))
      .where(and(
        eq(products.supplierId, supplierId),
        eq(inventoryMovements.movementType, 'purchase'),
        gte(inventoryMovements.createdAt, startDate),
        lte(inventoryMovements.createdAt, baseDate),
        sql`${inventoryMovements.referenceId} IS NOT NULL`
      ))
      .groupBy(inventoryMovements.referenceId)
      .having(sql`COUNT(*) > 1`); // Only orders with multiple movements

      if (processingTimes.length === 0) {
        return {
          averageResponseTimeHours: 0,
          responseTimeClass: 'insufficient_data',
          summary: {
            totalCommunications: 0,
            fastResponses: 0,
            slowResponses: 0
          }
        };
      }

      const responseTimes = processingTimes.map(order => {
        const orderStart = new Date(order.orderDate);
        const orderEnd = new Date(order.deliveryDate);
        const hoursElapsed = (orderEnd - orderStart) / (1000 * 60 * 60);
        return Math.max(0, hoursElapsed);
      });

      const avgResponseTime = responseTimes.reduce((sum, time) => sum + time, 0) / responseTimes.length;
      const fastResponses = responseTimes.filter(time => time <= 24).length; // Under 24 hours
      const slowResponses = responseTimes.filter(time => time > 72).length; // Over 72 hours

      // Response time classification
      let responseClass = 'slow';
      if (avgResponseTime <= 8) responseClass = 'excellent';
      else if (avgResponseTime <= 24) responseClass = 'good';
      else if (avgResponseTime <= 48) responseClass = 'fair';

      return {
        averageResponseTimeHours: parseFloat(avgResponseTime.toFixed(2)),
        responseTimeClass: responseClass,
        summary: {
          totalCommunications: responseTimes.length,
          fastResponses,
          slowResponses,
          medianResponseTime: responseTimes.sort((a, b) => a - b)[Math.floor(responseTimes.length / 2)]
        }
      };
    }, 1800); // 30 minute cache (longer since this is estimated data)
  }

  /**
   * Build comprehensive supplier performance composite scoring algorithm
   */
  async calculateSupplierPerformanceScore(supplierId, params = {}) {
    const {
      dateFrom = null,
      dateTo = null,
      weights = {
        onTimeDelivery: 0.25,
        priceStability: 0.20,
        orderFulfillment: 0.25,
        quality: 0.20,
        responseTime: 0.10
      },
      includeDetailed = true
    } = params;

    const cacheKey = `supplier_performance_score:${supplierId}:${dateFrom}:${dateTo}:${JSON.stringify(weights)}`;
    
    return await this.executeWithCache(async () => {
      // Get all component metrics in parallel
      const [
        deliveryMetrics,
        priceMetrics,
        fulfillmentMetrics,
        qualityMetrics,
        responseMetrics
      ] = await Promise.all([
        this.calculateOnTimeDeliveryRate(supplierId, { dateFrom, dateTo }),
        this.calculatePriceStabilityIndex(supplierId, { dateFrom, dateTo }),
        this.calculateOrderFulfillmentRate(supplierId, { dateFrom, dateTo }),
        this.calculateQualityScore(supplierId, { dateFrom, dateTo }),
        this.calculateResponseTimeMetrics(supplierId, { dateFrom, dateTo })
      ]);

      // Convert metrics to normalized scores (0-100)
      const scores = {
        onTimeDelivery: deliveryMetrics.onTimeDeliveryRate || 0,
        priceStability: priceMetrics.priceStabilityIndex || 0,
        orderFulfillment: fulfillmentMetrics.orderFulfillmentRate || 0,
        quality: qualityMetrics.qualityScore || 0,
        responseTime: responseMetrics.averageResponseTimeHours ? 
          Math.max(0, 100 - (responseMetrics.averageResponseTimeHours * 2)) : 0 // Penalty for slow response
      };

      // Calculate weighted composite score
      const compositeScore = (
        scores.onTimeDelivery * weights.onTimeDelivery +
        scores.priceStability * weights.priceStability +
        scores.orderFulfillment * weights.orderFulfillment +
        scores.quality * weights.quality +
        scores.responseTime * weights.responseTime
      );

      // Overall performance classification
      let performanceClass = 'poor';
      if (compositeScore >= 90) performanceClass = 'excellent';
      else if (compositeScore >= 80) performanceClass = 'good';
      else if (compositeScore >= 70) performanceClass = 'fair';
      else if (compositeScore >= 60) performanceClass = 'below_average';

      // Risk assessment
      let riskLevel = 'high';
      if (compositeScore >= 85) riskLevel = 'low';
      else if (compositeScore >= 70) riskLevel = 'medium';

      const result = {
        supplierId,
        compositeScore: parseFloat(compositeScore.toFixed(2)),
        performanceClass,
        riskLevel,
        componentScores: scores,
        weights,
        calculatedAt: new Date().toISOString()
      };

      if (includeDetailed) {
        result.detailedMetrics = {
          delivery: deliveryMetrics,
          pricing: priceMetrics,
          fulfillment: fulfillmentMetrics,
          quality: qualityMetrics,
          responseTime: responseMetrics
        };
      }

      return result;
    }, 300); // 5 minute cache for composite scores
  }

  /**
   * Get supplier performance rankings and comparisons
   */
  async getSupplierPerformanceRankings(params = {}) {
    const {
      dateFrom = null,
      dateTo = null,
      limit = 50,
      minOrderValue = 1000,
      includeInactive = false
    } = params;

    const cacheKey = `supplier_rankings:${dateFrom}:${dateTo}:${limit}:${minOrderValue}:${includeInactive}`;
    
    return await this.executeWithCache(async () => {
      // Get active suppliers with recent activity
      const supplierConditions = [
        ...(includeInactive ? [] : [eq(suppliers.isActive, true)]),
        eq(suppliers.isApproved, true)
      ];

      const activeSuppliers = await db.select({
        id: suppliers.id,
        supplierCode: suppliers.supplierCode,
        companyName: suppliers.companyName,
        industry: suppliers.industry,
        performanceRating: suppliers.performanceRating
      })
      .from(suppliers)
      .where(and(...supplierConditions))
      .limit(limit);

      // Calculate performance scores for all suppliers
      const performancePromises = activeSuppliers.map(supplier =>
        this.calculateSupplierPerformanceScore(supplier.id, { 
          dateFrom, 
          dateTo, 
          includeDetailed: false 
        })
      );

      const performanceScores = await Promise.all(performancePromises);

      // Sort by composite score and add rankings
      const rankedSuppliers = performanceScores
        .map((score, index) => ({
          ...score,
          supplier: activeSuppliers[index],
          rank: 0 // Will be set below
        }))
        .sort((a, b) => b.compositeScore - a.compositeScore)
        .map((supplier, index) => ({
          ...supplier,
          rank: index + 1
        }));

      // Calculate percentiles and industry benchmarks
      const scores = rankedSuppliers.map(s => s.compositeScore);
      const industryGroups = {};
      
      rankedSuppliers.forEach(supplier => {
        const industry = supplier.supplier.industry || 'other';
        if (!industryGroups[industry]) {
          industryGroups[industry] = [];
        }
        industryGroups[industry].push(supplier.compositeScore);
      });

      const benchmarks = {};
      Object.entries(industryGroups).forEach(([industry, scores]) => {
        const sorted = scores.sort((a, b) => b - a);
        benchmarks[industry] = {
          average: sorted.reduce((sum, score) => sum + score, 0) / sorted.length,
          median: sorted[Math.floor(sorted.length / 2)],
          top10Percent: sorted[Math.floor(sorted.length * 0.1)],
          bottom10Percent: sorted[Math.floor(sorted.length * 0.9)]
        };
      });

      return {
        rankings: rankedSuppliers,
        summary: {
          totalSuppliers: rankedSuppliers.length,
          averageScore: scores.reduce((sum, score) => sum + score, 0) / scores.length,
          medianScore: scores.sort((a, b) => b - a)[Math.floor(scores.length / 2)],
          topPerformers: rankedSuppliers.filter(s => s.compositeScore >= 85).length,
          atRiskSuppliers: rankedSuppliers.filter(s => s.compositeScore < 60).length
        },
        industryBenchmarks: benchmarks,
        calculatedAt: new Date().toISOString()
      };
    }, 600); // 10 minute cache
  }
}

// Export singleton instance
export const analyticsService = new AnalyticsService();

// Export class for testing
export default AnalyticsService;