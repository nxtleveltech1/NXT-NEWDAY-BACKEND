import { sql, eq, and, or, desc, asc, gte, lte, isNotNull, count, sum, avg } from 'drizzle-orm';
import { db } from '../db/index.js';
import { 
  inventory, 
  inventoryMovements, 
  products, 
  suppliers, 
  customers, 
  priceLists,
  priceListItems,
  purchaseOrders,
  purchaseOrderItems,
  analyticsDailyAggregates,
  analyticsMonthlyAggregates 
} from '../db/schema.js';
import cacheService from './cache.service.js';

class OptimizedQueryService {
  constructor() {
    this.defaultCacheTTL = 900; // 15 minutes
    this.shortCacheTTL = 300;   // 5 minutes
    this.longCacheTTL = 3600;   // 1 hour
  }

  /**
   * Get cached result or execute query with caching
   */
  async getCachedOrExecute(cacheKey, queryFn, ttl = this.defaultCacheTTL) {
    // Check cache first
    const cached = await cacheService.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Execute query
    const result = await queryFn();
    
    // Cache the result
    await cacheService.set(cacheKey, result, ttl);
    
    return result;
  }

  /**
   * Optimized inventory dashboard metrics using materialized view
   */
  async getInventoryDashboardMetrics(warehouseId = null) {
    const cacheKey = `dashboard_inventory_${warehouseId || 'all'}`;
    
    return this.getCachedOrExecute(cacheKey, async () => {
      // Use materialized view for fast aggregation
      let query = db
        .select({
          totalItems: sum(sql`total_items`),
          totalQuantity: sum(sql`total_quantity`),
          totalValue: sum(sql`total_value`),
          itemsNeedingReorder: sum(sql`items_needing_reorder`),
          outOfStockItems: sum(sql`out_of_stock_items`),
          activeItems30d: sum(sql`active_items_30d`)
        })
        .from(sql`mv_inventory_summary`);

      if (warehouseId) {
        query = query.where(sql`warehouse_id = ${warehouseId}`);
      }

      const metrics = await query;

      // Get category breakdown
      let categoryQuery = db
        .select({
          category: sql`category`,
          totalItems: sql`total_items`,
          totalValue: sql`total_value`,
          totalQuantity: sql`total_quantity`
        })
        .from(sql`mv_inventory_summary`);

      if (warehouseId) {
        categoryQuery = categoryQuery.where(sql`warehouse_id = ${warehouseId}`);
      }

      const categoryBreakdown = await categoryQuery
        .orderBy(desc(sql`total_value`));

      return {
        summary: metrics[0] || {
          totalItems: 0,
          totalQuantity: 0,
          totalValue: 0,
          itemsNeedingReorder: 0,
          outOfStockItems: 0,
          activeItems30d: 0
        },
        categoryBreakdown
      };
    }, this.shortCacheTTL);
  }

  /**
   * Optimized supplier performance metrics using materialized view
   */
  async getSupplierPerformanceMetrics(limit = 10) {
    const cacheKey = `supplier_performance_top_${limit}`;
    
    return this.getCachedOrExecute(cacheKey, async () => {
      const topSuppliers = await db
        .select({
          supplierId: sql`supplier_id`,
          companyName: sql`company_name`,
          performanceRating: sql`performance_rating`,
          leadTimeDays: sql`lead_time_days`,
          activePriceLists: sql`active_price_lists`,
          totalProducts: sql`total_products`,
          totalPurchaseOrders: sql`total_purchase_orders`,
          avgDeliveryDays: sql`avg_delivery_days`,
          totalOrderValue: sql`total_order_value`,
          onTimeDeliveryRate: sql`on_time_delivery_rate`
        })
        .from(sql`mv_supplier_performance`)
        .orderBy(desc(sql`performance_rating`))
        .limit(limit);

      // Get aggregated metrics
      const aggregates = await db
        .select({
          totalSuppliers: count(),
          avgPerformanceRating: avg(sql`performance_rating`),
          avgLeadTime: avg(sql`lead_time_days`),
          totalOrderValue: sum(sql`total_order_value`),
          avgOnTimeDelivery: avg(sql`on_time_delivery_rate`)
        })
        .from(sql`mv_supplier_performance`);

      return {
        topSuppliers,
        aggregates: aggregates[0] || {
          totalSuppliers: 0,
          avgPerformanceRating: 0,
          avgLeadTime: 0,
          totalOrderValue: 0,
          avgOnTimeDelivery: 0
        }
      };
    }, this.longCacheTTL);
  }

  /**
   * Optimized customer analytics using materialized view
   */
  async getCustomerAnalyticsMetrics(limit = 10) {
    const cacheKey = `customer_analytics_top_${limit}`;
    
    return this.getCachedOrExecute(cacheKey, async () => {
      const topCustomers = await db
        .select({
          customerId: sql`customer_id`,
          companyName: sql`company_name`,
          customerSince: sql`customer_since`,
          totalOrders: sql`total_orders`,
          totalSpent: sql`total_spent`,
          avgOrderValue: sql`avg_order_value`,
          lastOrderDate: sql`last_order_date`,
          ordersLast90d: sql`orders_last_90d`,
          ordersLast30d: sql`orders_last_30d`,
          daysSinceLastOrder: sql`days_since_last_order`,
          uniqueProductsPurchased: sql`unique_products_purchased`
        })
        .from(sql`mv_customer_analytics`)
        .orderBy(desc(sql`total_spent`))
        .limit(limit);

      // Customer segmentation
      const segmentation = await db
        .select({
          segment: sql`
            CASE 
              WHEN total_spent > 10000 AND orders_last_30d > 0 THEN 'VIP Active'
              WHEN total_spent > 5000 AND orders_last_90d > 0 THEN 'High Value'
              WHEN orders_last_30d > 0 THEN 'Active'
              WHEN orders_last_90d > 0 THEN 'Recent'
              WHEN days_since_last_order <= 180 THEN 'Dormant'
              ELSE 'Inactive'
            END
          `,
          customerCount: count(),
          totalValue: sum(sql`total_spent`)
        })
        .from(sql`mv_customer_analytics`)
        .groupBy(sql`
          CASE 
            WHEN total_spent > 10000 AND orders_last_30d > 0 THEN 'VIP Active'
            WHEN total_spent > 5000 AND orders_last_90d > 0 THEN 'High Value'
            WHEN orders_last_30d > 0 THEN 'Active'
            WHEN orders_last_90d > 0 THEN 'Recent'
            WHEN days_since_last_order <= 180 THEN 'Dormant'
            ELSE 'Inactive'
          END
        `)
        .orderBy(desc(sql`total_value`));

      return {
        topCustomers,
        segmentation
      };
    }, this.longCacheTTL);
  }

  /**
   * Optimized sales trends with pre-aggregated data
   */
  async getSalesTrends(dateFrom, dateTo, granularity = 'daily') {
    const cacheKey = `sales_trends_${granularity}_${dateFrom}_${dateTo}`;
    
    return this.getCachedOrExecute(cacheKey, async () => {
      if (granularity === 'daily') {
        return await db
          .select({
            date: analyticsDailyAggregates.date,
            salesCount: sum(analyticsDailyAggregates.salesCount),
            salesRevenue: sum(analyticsDailyAggregates.salesRevenue),
            salesProfit: sum(analyticsDailyAggregates.salesProfit),
            uniqueCustomers: sum(analyticsDailyAggregates.uniqueCustomers)
          })
          .from(analyticsDailyAggregates)
          .where(
            and(
              gte(analyticsDailyAggregates.date, dateFrom),
              lte(analyticsDailyAggregates.date, dateTo)
            )
          )
          .groupBy(analyticsDailyAggregates.date)
          .orderBy(analyticsDailyAggregates.date);
      } else {
        return await db
          .select({
            year: analyticsMonthlyAggregates.year,
            month: analyticsMonthlyAggregates.month,
            salesCount: sum(analyticsMonthlyAggregates.salesCount),
            salesRevenue: sum(analyticsMonthlyAggregates.salesRevenue),
            salesProfit: sum(analyticsMonthlyAggregates.salesProfit),
            revenueGrowth: avg(analyticsMonthlyAggregates.revenueGrowth),
            customerGrowth: avg(analyticsMonthlyAggregates.customerGrowth)
          })
          .from(analyticsMonthlyAggregates)
          .where(
            and(
              gte(sql`MAKE_DATE(${analyticsMonthlyAggregates.year}, ${analyticsMonthlyAggregates.month}, 1)`, dateFrom),
              lte(sql`MAKE_DATE(${analyticsMonthlyAggregates.year}, ${analyticsMonthlyAggregates.month}, 1)`, dateTo)
            )
          )
          .groupBy(analyticsMonthlyAggregates.year, analyticsMonthlyAggregates.month)
          .orderBy(analyticsMonthlyAggregates.year, analyticsMonthlyAggregates.month);
      }
    }, this.defaultCacheTTL);
  }

  /**
   * Optimized inventory turnover analysis
   */
  async getInventoryTurnoverAnalysis(warehouseId = null, limit = 50) {
    const cacheKey = `inventory_turnover_${warehouseId || 'all'}_${limit}`;
    
    return this.getCachedOrExecute(cacheKey, async () => {
      let whereConditions = [eq(products.isActive, true)];
      
      if (warehouseId) {
        whereConditions.push(eq(inventory.warehouseId, warehouseId));
      }

      // Use optimized query with CTEs for better performance
      const turnoverData = await db.execute(sql`
        WITH sales_data AS (
          SELECT 
            im.product_id,
            im.warehouse_id,
            SUM(ABS(im.quantity)) as total_sold,
            SUM(ABS(im.quantity) * COALESCE(im.unit_cost, 0)) as total_sales_value,
            COUNT(*) as sale_count
          FROM inventory_movements im
          WHERE im.movement_type = 'sale'
            AND im.created_at >= NOW() - INTERVAL '12 months'
            ${warehouseId ? sql`AND im.warehouse_id = ${warehouseId}` : sql``}
          GROUP BY im.product_id, im.warehouse_id
        ),
        inventory_data AS (
          SELECT 
            i.id,
            i.product_id,
            i.warehouse_id,
            i.quantity_on_hand,
            i.average_cost,
            p.sku,
            p.name,
            p.category
          FROM inventory i
          INNER JOIN products p ON i.product_id = p.id
          WHERE p.is_active = true
            ${warehouseId ? sql`AND i.warehouse_id = ${warehouseId}` : sql``}
        )
        SELECT 
          id.id,
          id.product_id,
          id.warehouse_id,
          id.sku,
          id.name,
          id.category,
          id.quantity_on_hand,
          id.average_cost,
          COALESCE(sd.total_sold, 0) as total_sold,
          COALESCE(sd.total_sales_value, 0) as total_sales_value,
          COALESCE(sd.sale_count, 0) as sale_count,
          CASE 
            WHEN id.quantity_on_hand > 0 AND COALESCE(sd.total_sold, 0) > 0
            THEN COALESCE(sd.total_sold, 0)::DECIMAL / id.quantity_on_hand
            ELSE 0
          END as turnover_ratio,
          CASE 
            WHEN COALESCE(sd.total_sold, 0) > 0
            THEN (id.quantity_on_hand * 365.0) / COALESCE(sd.total_sold, 0)
            ELSE NULL
          END as days_of_inventory,
          (id.quantity_on_hand * COALESCE(id.average_cost, 0)) as inventory_value
        FROM inventory_data id
        LEFT JOIN sales_data sd ON id.product_id = sd.product_id AND id.warehouse_id = sd.warehouse_id
        ORDER BY 
          CASE 
            WHEN id.quantity_on_hand > 0 AND COALESCE(sd.total_sold, 0) > 0
            THEN COALESCE(sd.total_sold, 0)::DECIMAL / id.quantity_on_hand
            ELSE 0
          END DESC
        LIMIT ${limit}
      `);

      return turnoverData.rows;
    }, this.defaultCacheTTL);
  }

  /**
   * Optimized product performance analysis
   */
  async getTopProductsByRevenue(limit = 20, dateFrom = null, dateTo = null) {
    const cacheKey = `top_products_revenue_${limit}_${dateFrom || 'all'}_${dateTo || 'all'}`;
    
    return this.getCachedOrExecute(cacheKey, async () => {
      let whereConditions = [eq(inventoryMovements.movementType, 'sale')];
      
      if (dateFrom) {
        whereConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
      }
      if (dateTo) {
        whereConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));
      }

      return await db
        .select({
          productId: products.id,
          productSku: products.sku,
          productName: products.name,
          category: products.category,
          totalQuantitySold: sum(sql`ABS(${inventoryMovements.quantity})`),
          totalRevenue: sum(sql`ABS(${inventoryMovements.quantity}) * COALESCE(${inventoryMovements.unitCost}, 0)`),
          avgUnitPrice: avg(inventoryMovements.unitCost),
          saleCount: count(),
          currentStock: sql`(
            SELECT SUM(quantity_on_hand) 
            FROM inventory 
            WHERE product_id = ${products.id}
          )`
        })
        .from(inventoryMovements)
        .innerJoin(products, eq(inventoryMovements.productId, products.id))
        .where(and(...whereConditions))
        .groupBy(products.id, products.sku, products.name, products.category)
        .orderBy(desc(sql`SUM(ABS(${inventoryMovements.quantity}) * COALESCE(${inventoryMovements.unitCost}, 0))`))
        .limit(limit);
    }, this.defaultCacheTTL);
  }

  /**
   * Optimized low stock alerts
   */
  async getLowStockAlerts(warehouseId = null) {
    const cacheKey = `low_stock_alerts_${warehouseId || 'all'}`;
    
    return this.getCachedOrExecute(cacheKey, async () => {
      let whereConditions = [
        eq(products.isActive, true),
        isNotNull(inventory.reorderPoint),
        sql`${inventory.quantityAvailable} <= ${inventory.reorderPoint}`
      ];
      
      if (warehouseId) {
        whereConditions.push(eq(inventory.warehouseId, warehouseId));
      }

      return await db
        .select({
          inventoryId: inventory.id,
          productId: products.id,
          productSku: products.sku,
          productName: products.name,
          category: products.category,
          warehouseId: inventory.warehouseId,
          quantityAvailable: inventory.quantityAvailable,
          reorderPoint: inventory.reorderPoint,
          reorderQuantity: inventory.reorderQuantity,
          lastMovement: inventory.lastMovement,
          supplierName: suppliers.companyName,
          supplierId: suppliers.id,
          urgency: sql`
            CASE 
              WHEN ${inventory.quantityAvailable} = 0 THEN 'critical'
              WHEN ${inventory.quantityAvailable} <= (${inventory.reorderPoint} * 0.5) THEN 'high'
              ELSE 'medium'
            END
          `
        })
        .from(inventory)
        .innerJoin(products, eq(inventory.productId, products.id))
        .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
        .where(and(...whereConditions))
        .orderBy(
          sql`
            CASE 
              WHEN ${inventory.quantityAvailable} = 0 THEN 1
              WHEN ${inventory.quantityAvailable} <= (${inventory.reorderPoint} * 0.5) THEN 2
              ELSE 3
            END
          `,
          asc(inventory.quantityAvailable)
        );
    }, this.shortCacheTTL);
  }

  /**
   * Invalidate related caches when data changes
   */
  async invalidateInventoryCaches(warehouseId = null) {
    const patterns = [
      'dashboard_inventory_*',
      'low_stock_alerts_*',
      'inventory_turnover_*',
      'top_products_*'
    ];

    if (warehouseId) {
      patterns.push(`*_${warehouseId}_*`);
    }

    for (const pattern of patterns) {
      await cacheService.invalidatePattern(pattern);
    }
  }

  async invalidateSupplierCaches() {
    await cacheService.invalidatePattern('supplier_performance_*');
  }

  async invalidateCustomerCaches() {
    await cacheService.invalidatePattern('customer_analytics_*');
  }

  async invalidateSalesCaches() {
    await cacheService.invalidatePattern('sales_trends_*');
  }

  /**
   * Refresh materialized views for performance
   */
  async refreshPerformanceViews() {
    try {
      await db.execute(sql`SELECT refresh_performance_views()`);
      console.log('Materialized views refreshed successfully');
      return true;
    } catch (error) {
      console.error('Error refreshing materialized views:', error);
      return false;
    }
  }
}

// Singleton instance
const optimizedQueryService = new OptimizedQueryService();

export default optimizedQueryService;