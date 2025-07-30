import { db } from './db.js';
import { sql, eq, and, or, gt, lt, gte, lte, desc, asc } from 'drizzle-orm';
import { 
  customers, suppliers, products, inventory, purchaseOrders, purchaseOrderItems,
  supplierPurchaseOrders, supplierPurchaseOrderItems, invoices, invoiceItems,
  inventoryMovements, analyticsDailyAggregates, priceLists, priceListItems
} from './schema.js';

/**
 * Supply Chain Analytics and Extraction Queries
 * 
 * This module provides advanced analytics queries for supply chain management,
 * extracting insights from WooCommerce/Odoo integrated data.
 */

// ==================== CUSTOMER ANALYTICS ====================

/**
 * Get customer purchase analytics with WooCommerce integration
 * @param {Object} filters - Filter options
 * @returns {Promise<Array>} Customer analytics data
 */
export async function getCustomerPurchaseAnalytics(filters = {}) {
  const { startDate, endDate, limit = 100, includeWooCommerce = true } = filters;
  
  try {
    let query = db
      .select({
        customerId: customers.id,
        customerCode: customers.customerCode,
        companyName: customers.companyName,
        email: customers.email,
        totalOrders: sql`COUNT(DISTINCT ${purchaseOrders.id})`,
        totalSpent: sql`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`,
        avgOrderValue: sql`COALESCE(AVG(${purchaseOrders.totalAmount}), 0)`,
        lastOrderDate: sql`MAX(${purchaseOrders.orderDate})`,
        firstOrderDate: sql`MIN(${purchaseOrders.orderDate})`,
        wooCommerceId: includeWooCommerce ? sql`${customers.metadata}->>'woocommerce_id'` : sql`NULL`,
        customerLifetimeValue: sql`
          CASE 
            WHEN COUNT(DISTINCT ${purchaseOrders.id}) > 0 
            THEN COALESCE(SUM(${purchaseOrders.totalAmount}), 0) 
            ELSE 0 
          END
        `,
        purchaseFrequency: sql`
          CASE 
            WHEN MAX(${purchaseOrders.orderDate}) > MIN(${purchaseOrders.orderDate}) 
            THEN EXTRACT(DAYS FROM (MAX(${purchaseOrders.orderDate}) - MIN(${purchaseOrders.orderDate}))) / NULLIF(COUNT(DISTINCT ${purchaseOrders.id}) - 1, 0)
            ELSE 0 
          END
        `
      })
      .from(customers)
      .leftJoin(purchaseOrders, eq(customers.id, purchaseOrders.customerId))
      .groupBy(customers.id);

    // Apply date filters
    if (startDate) {
      query = query.where(gte(purchaseOrders.orderDate, new Date(startDate)));
    }
    if (endDate) {
      query = query.where(lte(purchaseOrders.orderDate, new Date(endDate)));
    }

    // Apply limit
    query = query.limit(limit).orderBy(desc(sql`COALESCE(SUM(${purchaseOrders.totalAmount}), 0)`));

    const results = await query;

    return {
      success: true,
      data: results,
      summary: {
        totalCustomers: results.length,
        totalRevenue: results.reduce((sum, customer) => sum + parseFloat(customer.totalSpent || 0), 0),
        avgCustomerValue: results.length > 0 ? results.reduce((sum, customer) => sum + parseFloat(customer.totalSpent || 0), 0) / results.length : 0,
        wooCommerceCustomers: includeWooCommerce ? results.filter(c => c.wooCommerceId).length : 0
      }
    };
  } catch (error) {
    console.error('Error getting customer purchase analytics:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get customer segmentation based on purchase behavior
 * @param {Object} options - Segmentation options
 * @returns {Promise<Object>} Customer segments
 */
export async function getCustomerSegmentation(options = {}) {
  const { includeWooCommerce = true } = options;
  
  try {
    const segments = await db.execute(sql`
      WITH customer_metrics AS (
        SELECT 
          c.id,
          c.customer_code,
          c.company_name,
          c.email,
          ${includeWooCommerce ? sql`c.metadata->>'woocommerce_id' as woo_id,` : sql``}
          COALESCE(COUNT(DISTINCT po.id), 0) as order_count,
          COALESCE(SUM(po.total_amount), 0) as total_spent,
          COALESCE(AVG(po.total_amount), 0) as avg_order_value,
          MAX(po.order_date) as last_order_date,
          EXTRACT(DAYS FROM (CURRENT_DATE - MAX(po.order_date))) as days_since_last_order
        FROM customers c
        LEFT JOIN purchase_orders po ON c.id = po.customer_id
        GROUP BY c.id, c.customer_code, c.company_name, c.email ${includeWooCommerce ? sql`, c.metadata->>'woocommerce_id'` : sql``}
      ),
      segments AS (
        SELECT *,
          CASE 
            WHEN total_spent >= 10000 AND order_count >= 10 THEN 'VIP'
            WHEN total_spent >= 5000 AND order_count >= 5 THEN 'High Value'
            WHEN total_spent >= 1000 AND order_count >= 3 THEN 'Regular'
            WHEN order_count > 0 THEN 'Occasional'
            ELSE 'Prospect'
          END as segment,
          CASE 
            WHEN days_since_last_order IS NULL THEN 'Never Purchased'
            WHEN days_since_last_order <= 30 THEN 'Active'
            WHEN days_since_last_order <= 90 THEN 'At Risk'
            WHEN days_since_last_order <= 180 THEN 'Dormant'
            ELSE 'Lost'
          END as lifecycle_stage
        FROM customer_metrics
      )
      SELECT 
        segment,
        lifecycle_stage,
        COUNT(*) as customer_count,
        AVG(total_spent) as avg_total_spent,
        AVG(order_count) as avg_order_count,
        AVG(avg_order_value) as avg_order_value
      FROM segments
      GROUP BY segment, lifecycle_stage
      ORDER BY segment, lifecycle_stage
    `);

    return {
      success: true,
      segments: segments,
      generated_at: new Date()
    };
  } catch (error) {
    console.error('Error getting customer segmentation:', error);
    return { success: false, error: error.message };
  }
}

// ==================== SUPPLIER ANALYTICS ====================

/**
 * Get supplier performance analytics
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} Supplier performance data
 */
export async function getSupplierPerformanceAnalytics(filters = {}) {
  const { startDate, endDate, limit = 50 } = filters;
  
  try {
    let query = db
      .select({
        supplierId: suppliers.id,
        supplierCode: suppliers.supplierCode,
        companyName: suppliers.companyName,
        email: suppliers.email,
        supplierType: suppliers.supplierType,
        performanceRating: suppliers.performanceRating,
        leadTimeDays: suppliers.leadTimeDays,
        totalOrders: sql`COUNT(DISTINCT ${supplierPurchaseOrders.id})`,
        totalSpent: sql`COALESCE(SUM(${supplierPurchaseOrders.totalAmount}), 0)`,
        avgOrderValue: sql`COALESCE(AVG(${supplierPurchaseOrders.totalAmount}), 0)`,
        onTimeDeliveries: sql`
          COUNT(CASE 
            WHEN ${supplierPurchaseOrders.deliveredAt} IS NOT NULL 
            AND ${supplierPurchaseOrders.deliveredAt} <= ${supplierPurchaseOrders.expectedDeliveryDate}
            THEN 1 
          END)
        `,
        lateDeliveries: sql`
          COUNT(CASE 
            WHEN ${supplierPurchaseOrders.deliveredAt} IS NOT NULL 
            AND ${supplierPurchaseOrders.deliveredAt} > ${supplierPurchaseOrders.expectedDeliveryDate}
            THEN 1 
          END)
        `,
        deliveryPerformance: sql`
          CASE 
            WHEN COUNT(CASE WHEN ${supplierPurchaseOrders.deliveredAt} IS NOT NULL THEN 1 END) > 0
            THEN (COUNT(CASE 
              WHEN ${supplierPurchaseOrders.deliveredAt} <= ${supplierPurchaseOrders.expectedDeliveryDate}
              THEN 1 
            END)::DECIMAL / COUNT(CASE WHEN ${supplierPurchaseOrders.deliveredAt} IS NOT NULL THEN 1 END)) * 100
            ELSE 0
          END
        `,
        lastOrderDate: sql`MAX(${supplierPurchaseOrders.orderDate})`,
        productCount: sql`COUNT(DISTINCT ${products.id})`
      })
      .from(suppliers)
      .leftJoin(supplierPurchaseOrders, eq(suppliers.id, supplierPurchaseOrders.supplierId))
      .leftJoin(products, eq(suppliers.id, products.supplierId))
      .groupBy(suppliers.id);

    // Apply date filters
    if (startDate) {
      query = query.where(gte(supplierPurchaseOrders.orderDate, new Date(startDate)));
    }
    if (endDate) {
      query = query.where(lte(supplierPurchaseOrders.orderDate, new Date(endDate)));
    }

    query = query.limit(limit).orderBy(desc(sql`COALESCE(SUM(${supplierPurchaseOrders.totalAmount}), 0)`));

    const results = await query;

    return {
      success: true,
      data: results,
      summary: {
        totalSuppliers: results.length,
        totalSpent: results.reduce((sum, supplier) => sum + parseFloat(supplier.totalSpent || 0), 0),
        avgDeliveryPerformance: results.length > 0 ? results.reduce((sum, supplier) => sum + parseFloat(supplier.deliveryPerformance || 0), 0) / results.length : 0,
        avgLeadTime: results.length > 0 ? results.reduce((sum, supplier) => sum + parseFloat(supplier.leadTimeDays || 0), 0) / results.length : 0
      }
    };
  } catch (error) {
    console.error('Error getting supplier performance analytics:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get supplier spend analysis by category and time period
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} Supplier spend analysis
 */
export async function getSupplierSpendAnalysis(filters = {}) {
  const { startDate, endDate, groupBy = 'month' } = filters;
  
  try {
    const timeFormat = groupBy === 'week' ? 'YYYY-WW' : 
                     groupBy === 'quarter' ? 'YYYY-Q' : 'YYYY-MM';
    
    let query = sql`
      SELECT 
        s.supplier_type,
        s.industry,
        TO_CHAR(spo.order_date, ${timeFormat}) as time_period,
        COUNT(DISTINCT spo.id) as order_count,
        SUM(spo.total_amount) as total_spent,
        AVG(spo.total_amount) as avg_order_value,
        COUNT(DISTINCT s.id) as supplier_count
      FROM suppliers s
      LEFT JOIN supplier_purchase_orders spo ON s.id = spo.supplier_id
      WHERE 1=1
    `;

    const params = [];
    if (startDate) {
      query = sql`${query} AND spo.order_date >= ${startDate}`;
    }
    if (endDate) {
      query = sql`${query} AND spo.order_date <= ${endDate}`;
    }

    query = sql`
      ${query}
      GROUP BY s.supplier_type, s.industry, TO_CHAR(spo.order_date, ${timeFormat})
      ORDER BY time_period DESC, total_spent DESC
    `;

    const results = await db.execute(query);

    return {
      success: true,
      data: results,
      groupBy: groupBy,
      generated_at: new Date()
    };
  } catch (error) {
    console.error('Error getting supplier spend analysis:', error);
    return { success: false, error: error.message };
  }
}

// ==================== INVENTORY ANALYTICS ====================

/**
 * Get inventory turnover analysis
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} Inventory turnover data
 */
export async function getInventoryTurnoverAnalysis(filters = {}) {
  const { warehouseId, categoryFilter, lowTurnoverThreshold = 4 } = filters;
  
  try {
    let query = db
      .select({
        productId: products.id,
        sku: products.sku,
        name: products.name,
        category: products.category,
        currentStock: inventory.quantityOnHand,
        averageCost: inventory.averageCost,
        inventoryValue: sql`${inventory.quantityOnHand} * COALESCE(${inventory.averageCost}, ${products.costPrice}, 0)`,
        salesLast12Months: sql`
          COALESCE(SUM(CASE 
            WHEN ${inventoryMovements.movementType} = 'sale' 
            AND ${inventoryMovements.createdAt} >= CURRENT_DATE - INTERVAL '12 months'
            THEN ABS(${inventoryMovements.quantity})
            ELSE 0
          END), 0)
        `,
        avgMonthlyMovement: sql`
          COALESCE(SUM(CASE 
            WHEN ${inventoryMovements.movementType} IN ('sale', 'transfer') 
            AND ${inventoryMovements.createdAt} >= CURRENT_DATE - INTERVAL '12 months'
            THEN ABS(${inventoryMovements.quantity})
            ELSE 0
          END), 0) / 12.0
        `,
        inventoryTurnover: sql`
          CASE 
            WHEN ${inventory.quantityOnHand} > 0 
            THEN COALESCE(SUM(CASE 
              WHEN ${inventoryMovements.movementType} = 'sale' 
              AND ${inventoryMovements.createdAt} >= CURRENT_DATE - INTERVAL '12 months'
              THEN ABS(${inventoryMovements.quantity})
              ELSE 0
            END), 0) / ${inventory.quantityOnHand}::DECIMAL
            ELSE 0
          END
        `,
        daysOfSupply: sql`
          CASE 
            WHEN COALESCE(SUM(CASE 
              WHEN ${inventoryMovements.movementType} = 'sale' 
              AND ${inventoryMovements.createdAt} >= CURRENT_DATE - INTERVAL '12 months'
              THEN ABS(${inventoryMovements.quantity})
              ELSE 0
            END), 0) / 365.0 > 0
            THEN ${inventory.quantityOnHand} / (COALESCE(SUM(CASE 
              WHEN ${inventoryMovements.movementType} = 'sale' 
              AND ${inventoryMovements.createdAt} >= CURRENT_DATE - INTERVAL '12 months'
              THEN ABS(${inventoryMovements.quantity})
              ELSE 0
            END), 0) / 365.0)
            ELSE 999
          END
        `,
        lastMovementDate: sql`MAX(${inventoryMovements.createdAt})`,
        reorderPoint: inventory.reorderPoint,
        stockStatus: sql`
          CASE 
            WHEN ${inventory.quantityOnHand} <= 0 THEN 'Out of Stock'
            WHEN ${inventory.quantityOnHand} <= ${inventory.reorderPoint} THEN 'Low Stock'
            WHEN ${inventory.quantityOnHand} <= ${inventory.minStockLevel} THEN 'Below Minimum'
            ELSE 'In Stock'
          END
        `
      })
      .from(products)
      .leftJoin(inventory, eq(products.id, inventory.productId))
      .leftJoin(inventoryMovements, eq(inventory.id, inventoryMovements.inventoryId))
      .groupBy(products.id, inventory.id);

    // Apply filters
    if (warehouseId) {
      query = query.where(eq(inventory.warehouseId, warehouseId));
    }
    if (categoryFilter) {
      query = query.where(eq(products.category, categoryFilter));
    }

    query = query.orderBy(asc(sql`
      CASE 
        WHEN ${inventory.quantityOnHand} > 0 
        THEN COALESCE(SUM(CASE 
          WHEN ${inventoryMovements.movementType} = 'sale' 
          AND ${inventoryMovements.createdAt} >= CURRENT_DATE - INTERVAL '12 months'
          THEN ABS(${inventoryMovements.quantity})
          ELSE 0
        END), 0) / ${inventory.quantityOnHand}::DECIMAL
        ELSE 0
      END
    `));

    const results = await query;

    // Categorize results
    const analysis = {
      highTurnover: results.filter(item => parseFloat(item.inventoryTurnover) > 12),
      normalTurnover: results.filter(item => parseFloat(item.inventoryTurnover) >= lowTurnoverThreshold && parseFloat(item.inventoryTurnover) <= 12),
      lowTurnover: results.filter(item => parseFloat(item.inventoryTurnover) < lowTurnoverThreshold && parseFloat(item.inventoryTurnover) > 0),
      noMovement: results.filter(item => parseFloat(item.inventoryTurnover) === 0),
      outOfStock: results.filter(item => item.stockStatus === 'Out of Stock'),
      lowStock: results.filter(item => item.stockStatus === 'Low Stock')
    };

    return {
      success: true,
      data: results,
      analysis: analysis,
      summary: {
        totalItems: results.length,
        totalInventoryValue: results.reduce((sum, item) => sum + parseFloat(item.inventoryValue || 0), 0),
        avgTurnover: results.length > 0 ? results.reduce((sum, item) => sum + parseFloat(item.inventoryTurnover || 0), 0) / results.length : 0,
        highTurnoverCount: analysis.highTurnover.length,
        lowTurnoverCount: analysis.lowTurnover.length,
        noMovementCount: analysis.noMovement.length,
        outOfStockCount: analysis.outOfStock.length
      }
    };
  } catch (error) {
    console.error('Error getting inventory turnover analysis:', error);
    return { success: false, error: error.message };
  }
}

// ==================== SUPPLY CHAIN OPTIMIZATION ====================

/**
 * Get reorder recommendations based on inventory levels and demand patterns
 * @param {Object} options - Recommendation options
 * @returns {Promise<Object>} Reorder recommendations
 */
export async function getReorderRecommendations(options = {}) {
  const { warehouseId, daysAhead = 30, safetyStockMultiplier = 1.5 } = options;
  
  try {
    let query = sql`
      WITH demand_analysis AS (
        SELECT 
          i.product_id,
          i.warehouse_id,
          i.quantity_on_hand,
          i.reorder_point,
          i.reorder_quantity,
          p.sku,
          p.name,
          p.cost_price,
          s.lead_time_days,
          s.company_name as supplier_name,
          -- Calculate average daily demand over last 90 days
          COALESCE(
            SUM(CASE 
              WHEN im.movement_type = 'sale' 
              AND im.created_at >= CURRENT_DATE - INTERVAL '90 days'
              THEN ABS(im.quantity)
              ELSE 0
            END) / 90.0, 0
          ) as avg_daily_demand,
          -- Calculate demand variability (standard deviation approximation)
          COALESCE(
            SQRT(
              SUM(CASE 
                WHEN im.movement_type = 'sale' 
                AND im.created_at >= CURRENT_DATE - INTERVAL '90 days'
                THEN POWER(ABS(im.quantity) - (
                  SUM(CASE 
                    WHEN im.movement_type = 'sale' 
                    AND im.created_at >= CURRENT_DATE - INTERVAL '90 days'
                    THEN ABS(im.quantity)
                    ELSE 0
                  END) / 90.0
                ), 2)
                ELSE 0
              END) / NULLIF(
                COUNT(CASE 
                  WHEN im.movement_type = 'sale' 
                  AND im.created_at >= CURRENT_DATE - INTERVAL '90 days'
                  THEN 1
                END), 0
              )
            ), 0
          ) as demand_variability
        FROM inventory i
        JOIN products p ON i.product_id = p.id
        LEFT JOIN suppliers s ON p.supplier_id = s.id
        LEFT JOIN inventory_movements im ON i.id = im.inventory_id
        WHERE i.is_active = true
        GROUP BY i.product_id, i.warehouse_id, i.quantity_on_hand, i.reorder_point, 
                 i.reorder_quantity, p.sku, p.name, p.cost_price, s.lead_time_days, s.company_name
      )
      SELECT 
        product_id,
        warehouse_id,
        sku,
        name,
        supplier_name,
        quantity_on_hand,
        reorder_point,
        reorder_quantity,
        avg_daily_demand,
        demand_variability,
        lead_time_days,
        cost_price,
        -- Calculate recommended safety stock
        CEIL(${safetyStockMultiplier} * demand_variability * SQRT(COALESCE(lead_time_days, 7))) as recommended_safety_stock,
        -- Calculate recommended reorder point
        CEIL(avg_daily_demand * COALESCE(lead_time_days, 7) + 
             ${safetyStockMultiplier} * demand_variability * SQRT(COALESCE(lead_time_days, 7))) as recommended_reorder_point,
        -- Calculate days until stockout
        CASE 
          WHEN avg_daily_demand > 0 
          THEN quantity_on_hand / avg_daily_demand
          ELSE 999
        END as days_until_stockout,
        -- Calculate recommended order quantity (Economic Order Quantity approximation)
        CASE 
          WHEN avg_daily_demand > 0 
          THEN CEIL(SQRT(2 * avg_daily_demand * 365 * 50 / NULLIF(cost_price, 0)) / 50) * 50
          ELSE reorder_quantity
        END as recommended_order_quantity,
        -- Priority scoring
        CASE 
          WHEN quantity_on_hand <= 0 THEN 'URGENT'
          WHEN quantity_on_hand <= reorder_point OR 
               (avg_daily_demand > 0 AND quantity_on_hand / avg_daily_demand <= ${daysAhead}) THEN 'HIGH'
          WHEN quantity_on_hand <= reorder_point * 1.5 THEN 'MEDIUM'
          ELSE 'LOW'
        END as priority
      FROM demand_analysis
      WHERE avg_daily_demand > 0 OR quantity_on_hand <= reorder_point
    `;

    const params = [];
    if (warehouseId) {
      query = sql`${query} AND warehouse_id = ${warehouseId}`;
    }

    query = sql`
      ${query}
      ORDER BY 
        CASE 
          WHEN quantity_on_hand <= 0 THEN 1
          WHEN quantity_on_hand <= reorder_point THEN 2
          ELSE 3
        END,
        avg_daily_demand DESC,
        days_until_stockout ASC
    `;

    const results = await db.execute(query);

    // Group by priority
    const recommendations = {
      urgent: results.filter(item => item.priority === 'URGENT'),
      high: results.filter(item => item.priority === 'HIGH'),
      medium: results.filter(item => item.priority === 'MEDIUM'),
      low: results.filter(item => item.priority === 'LOW')
    };

    return {
      success: true,
      recommendations: recommendations,
      summary: {
        totalItems: results.length,
        urgentCount: recommendations.urgent.length,
        highPriorityCount: recommendations.high.length,
        totalReorderValue: results.reduce((sum, item) => 
          sum + (parseFloat(item.recommended_order_quantity || 0) * parseFloat(item.cost_price || 0)), 0
        ),
        daysAhead: daysAhead
      },
      generated_at: new Date()
    };
  } catch (error) {
    console.error('Error getting reorder recommendations:', error);
    return { success: false, error: error.message };
  }
}

// ==================== PRICE ANALYSIS ====================

/**
 * Get price trend analysis for products
 * @param {Object} filters - Filter options
 * @returns {Promise<Object>} Price trend analysis
 */
export async function getPriceTrendAnalysis(filters = {}) {
  const { productIds, supplierIds, startDate, endDate } = filters;
  
  try {
    let query = db
      .select({
        productId: products.id,
        productSku: products.sku,
        productName: products.name,
        supplierId: suppliers.id,
        supplierName: suppliers.companyName,
        priceListId: priceLists.id,
        priceListName: priceLists.name,
        effectiveDate: priceLists.effectiveDate,
        currentPrice: priceListItems.unitPrice,
        previousPrice: sql`
          LAG(${priceListItems.unitPrice}) OVER (
            PARTITION BY ${products.id}, ${suppliers.id} 
            ORDER BY ${priceLists.effectiveDate}
          )
        `,
        priceChange: sql`
          ${priceListItems.unitPrice} - LAG(${priceListItems.unitPrice}) OVER (
            PARTITION BY ${products.id}, ${suppliers.id} 
            ORDER BY ${priceLists.effectiveDate}
          )
        `,
        priceChangePercent: sql`
          CASE 
            WHEN LAG(${priceListItems.unitPrice}) OVER (
              PARTITION BY ${products.id}, ${suppliers.id} 
              ORDER BY ${priceLists.effectiveDate}
            ) > 0
            THEN (${priceListItems.unitPrice} - LAG(${priceListItems.unitPrice}) OVER (
              PARTITION BY ${products.id}, ${suppliers.id} 
              ORDER BY ${priceLists.effectiveDate}
            )) / LAG(${priceListItems.unitPrice}) OVER (
              PARTITION BY ${products.id}, ${suppliers.id} 
              ORDER BY ${priceLists.effectiveDate}
            ) * 100
            ELSE 0
          END
        `
      })
      .from(priceListItems)
      .innerJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
      .innerJoin(products, eq(priceListItems.sku, products.sku))
      .innerJoin(suppliers, eq(priceLists.supplierId, suppliers.id))
      .where(eq(priceLists.status, 'active'));

    // Apply filters
    if (productIds && productIds.length > 0) {
      query = query.where(sql`${products.id} = ANY(${productIds})`);
    }
    if (supplierIds && supplierIds.length > 0) {
      query = query.where(sql`${suppliers.id} = ANY(${supplierIds})`);
    }
    if (startDate) {
      query = query.where(gte(priceLists.effectiveDate, startDate));
    }
    if (endDate) {
      query = query.where(lte(priceLists.effectiveDate, endDate));
    }

    query = query.orderBy(products.sku, suppliers.companyName, priceLists.effectiveDate);

    const results = await query;

    // Calculate summary statistics
    const priceIncreases = results.filter(item => parseFloat(item.priceChange || 0) > 0);
    const priceDecreases = results.filter(item => parseFloat(item.priceChange || 0) < 0);
    const avgPriceChange = results.length > 0 ? 
      results.reduce((sum, item) => sum + parseFloat(item.priceChangePercent || 0), 0) / results.length : 0;

    return {
      success: true,
      data: results,
      summary: {
        totalPricePoints: results.length,
        priceIncreases: priceIncreases.length,
        priceDecreases: priceDecreases.length,
        avgPriceChange: avgPriceChange,
        biggestIncrease: Math.max(...results.map(item => parseFloat(item.priceChangePercent || 0))),
        biggestDecrease: Math.min(...results.map(item => parseFloat(item.priceChangePercent || 0)))
      }
    };
  } catch (error) {
    console.error('Error getting price trend analysis:', error);
    return { success: false, error: error.message };
  }
}

// ==================== COMPREHENSIVE SUPPLY CHAIN DASHBOARD ====================

/**
 * Get comprehensive supply chain dashboard data
 * @param {Object} options - Dashboard options
 * @returns {Promise<Object>} Complete dashboard data
 */
export async function getSupplyChainDashboard(options = {}) {
  const { dateRange = '30d' } = options;
  
  try {
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - (dateRange === '7d' ? 7 : dateRange === '90d' ? 90 : 30));

    // Get all analytics in parallel
    const [
      customerAnalytics,
      supplierAnalytics,
      inventoryAnalysis,
      reorderRecommendations
    ] = await Promise.all([
      getCustomerPurchaseAnalytics({ startDate, limit: 20 }),
      getSupplierPerformanceAnalytics({ startDate, limit: 20 }),
      getInventoryTurnoverAnalysis({ lowTurnoverThreshold: 2 }),
      getReorderRecommendations({ daysAhead: 30 })
    ]);

    return {
      success: true,
      dashboard: {
        customers: customerAnalytics,
        suppliers: supplierAnalytics,
        inventory: inventoryAnalysis,
        reorders: reorderRecommendations
      },
      summary: {
        dateRange: dateRange,
        totalCustomers: customerAnalytics.success ? customerAnalytics.summary.totalCustomers : 0,
        totalSuppliers: supplierAnalytics.success ? supplierAnalytics.summary.totalSuppliers : 0,
        inventoryValue: inventoryAnalysis.success ? inventoryAnalysis.summary.totalInventoryValue : 0,
        urgentReorders: reorderRecommendations.success ? reorderRecommendations.summary.urgentCount : 0
      },
      generated_at: new Date()
    };
  } catch (error) {
    console.error('Error generating supply chain dashboard:', error);
    return { success: false, error: error.message };
  }
}