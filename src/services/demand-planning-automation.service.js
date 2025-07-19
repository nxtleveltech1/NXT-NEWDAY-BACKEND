import {
  inventory,
  inventoryMovements,
  products,
  suppliers,
  purchaseOrders,
  purchaseOrderItems,
  supplierPurchaseOrders,
  priceLists,
  priceListItems,
  timeSeriesMetrics,
  timeSeriesEvents
} from '../db/schema.js';
import { db } from '../config/database.js';
import { eq, and, sql, gte, lte, desc, asc, inArray } from 'drizzle-orm';
import { createSupplierPurchaseOrder } from '../db/supplier-purchase-order-queries.js';
import { sendNotification } from './notifications.js';

/**
 * Demand Planning and Reorder Automation Service
 * Handles intelligent demand forecasting, reorder point management, and automated purchasing
 */

// ==================== DEMAND FORECASTING ====================

/**
 * Analyze demand patterns for products
 * @param {Object} options - Analysis options
 * @returns {Object} Demand analysis results
 */
export async function analyzeDemandPatterns(options = {}) {
  const {
    timeRange = 90, // days
    productIds = null,
    warehouseIds = null,
    includeSeasonality = true,
    includeTrendAnalysis = true
  } = options;

  try {
    const endDate = new Date();
    const startDate = new Date(endDate.getTime() - (timeRange * 24 * 60 * 60 * 1000));

    // Get historical sales data
    const salesData = await db
      .select({
        productId: products.id,
        sku: products.sku,
        productName: products.name,
        supplierId: products.supplierId,
        supplierName: suppliers.companyName,
        date: sql`DATE(${inventoryMovements.createdAt})`,
        quantitySold: sql`SUM(ABS(${inventoryMovements.quantity}))`,
        salesValue: sql`SUM(ABS(${inventoryMovements.quantity}) * COALESCE(${inventoryMovements.unitCost}, 0))`,
        transactionCount: sql`COUNT(*)`
      })
      .from(inventoryMovements)
      .innerJoin(products, eq(inventoryMovements.productId, products.id))
      .innerJoin(suppliers, eq(products.supplierId, suppliers.id))
      .where(
        and(
          eq(inventoryMovements.movementType, 'sale'),
          gte(inventoryMovements.createdAt, startDate),
          lte(inventoryMovements.createdAt, endDate),
          productIds ? inArray(products.id, productIds) : sql`true`,
          warehouseIds ? inArray(inventoryMovements.warehouseId, warehouseIds) : sql`true`
        )
      )
      .groupBy(
        products.id,
        products.sku,
        products.name,
        products.supplierId,
        suppliers.companyName,
        sql`DATE(${inventoryMovements.createdAt})`
      )
      .orderBy(products.sku, sql`DATE(${inventoryMovements.createdAt})`);

    // Process demand patterns by product
    const demandPatterns = await processDemandPatterns(salesData, {
      timeRange,
      includeSeasonality,
      includeTrendAnalysis
    });

    // Calculate forecasts
    const forecasts = await generateDemandForecasts(demandPatterns, {
      forecastDays: 30,
      confidenceLevel: 0.95
    });

    return {
      success: true,
      data: {
        analysisMetadata: {
          timeRange,
          startDate,
          endDate,
          productsAnalyzed: demandPatterns.length,
          totalTransactions: salesData.length
        },
        demandPatterns,
        forecasts
      },
      message: `Demand analysis complete for ${demandPatterns.length} products`
    };

  } catch (error) {
    console.error('Error analyzing demand patterns:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to analyze demand patterns'
    };
  }
}

/**
 * Process raw sales data into demand patterns
 * @param {Array} salesData - Raw sales data
 * @param {Object} options - Processing options
 * @returns {Array} Processed demand patterns
 */
async function processDemandPatterns(salesData, options) {
  const { timeRange, includeSeasonality, includeTrendAnalysis } = options;
  
  // Group data by product
  const productGroups = new Map();
  
  for (const sale of salesData) {
    const key = sale.productId;
    if (!productGroups.has(key)) {
      productGroups.set(key, {
        productId: sale.productId,
        sku: sale.sku,
        productName: sale.productName,
        supplierId: sale.supplierId,
        supplierName: sale.supplierName,
        dailySales: [],
        totalQuantity: 0,
        totalValue: 0,
        totalDays: 0
      });
    }
    
    const product = productGroups.get(key);
    product.dailySales.push({
      date: sale.date,
      quantity: parseInt(sale.quantitySold),
      value: parseFloat(sale.salesValue),
      transactions: parseInt(sale.transactionCount)
    });
    product.totalQuantity += parseInt(sale.quantitySold);
    product.totalValue += parseFloat(sale.salesValue);
    product.totalDays++;
  }

  // Calculate patterns for each product
  const patterns = [];
  
  for (const [productId, productData] of productGroups) {
    const pattern = await calculateProductDemandPattern(productData, {
      timeRange,
      includeSeasonality,
      includeTrendAnalysis
    });
    patterns.push(pattern);
  }

  return patterns.sort((a, b) => b.averageDailyDemand - a.averageDailyDemand);
}

/**
 * Calculate demand pattern for a single product
 * @param {Object} productData - Product sales data
 * @param {Object} options - Calculation options
 * @returns {Object} Demand pattern
 */
async function calculateProductDemandPattern(productData, options) {
  const { timeRange, includeSeasonality, includeTrendAnalysis } = options;
  
  const pattern = {
    productId: productData.productId,
    sku: productData.sku,
    productName: productData.productName,
    supplierId: productData.supplierId,
    supplierName: productData.supplierName,
    totalQuantity: productData.totalQuantity,
    totalValue: productData.totalValue,
    activeDays: productData.totalDays,
    averageDailyDemand: productData.totalQuantity / timeRange,
    actualAverageDailyDemand: productData.totalDays > 0 ? productData.totalQuantity / productData.totalDays : 0,
    maxDailyDemand: Math.max(...productData.dailySales.map(d => d.quantity)),
    minDailyDemand: Math.min(...productData.dailySales.map(d => d.quantity)),
    demandVariability: 0,
    demandTrend: 'stable',
    seasonalityScore: 0,
    demandClassification: 'regular'
  };

  // Calculate demand variability (coefficient of variation)
  if (productData.dailySales.length > 1) {
    const quantities = productData.dailySales.map(d => d.quantity);
    const mean = pattern.actualAverageDailyDemand;
    const variance = quantities.reduce((sum, q) => sum + Math.pow(q - mean, 2), 0) / quantities.length;
    const standardDeviation = Math.sqrt(variance);
    pattern.demandVariability = mean > 0 ? standardDeviation / mean : 0;
  }

  // Trend analysis
  if (includeTrendAnalysis && productData.dailySales.length >= 7) {
    const trendAnalysis = calculateTrend(productData.dailySales);
    pattern.demandTrend = trendAnalysis.trend;
    pattern.trendStrength = trendAnalysis.strength;
    pattern.trendSlope = trendAnalysis.slope;
  }

  // Seasonality analysis
  if (includeSeasonality && productData.dailySales.length >= 14) {
    pattern.seasonalityScore = calculateSeasonality(productData.dailySales);
  }

  // Classify demand pattern
  pattern.demandClassification = classifyDemandPattern(pattern);

  return pattern;
}

/**
 * Calculate trend in demand data
 * @param {Array} dailySales - Daily sales data
 * @returns {Object} Trend analysis
 */
function calculateTrend(dailySales) {
  if (dailySales.length < 2) {
    return { trend: 'stable', strength: 0, slope: 0 };
  }

  // Simple linear regression
  const n = dailySales.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  
  dailySales.forEach((sale, index) => {
    const x = index;
    const y = sale.quantity;
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
  });

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  
  // Calculate R-squared for trend strength
  const meanY = sumY / n;
  let ssTotal = 0, ssRes = 0;
  
  dailySales.forEach((sale, index) => {
    const predicted = slope * index + intercept;
    ssTotal += Math.pow(sale.quantity - meanY, 2);
    ssRes += Math.pow(sale.quantity - predicted, 2);
  });
  
  const rSquared = ssTotal > 0 ? 1 - (ssRes / ssTotal) : 0;
  
  let trend = 'stable';
  if (Math.abs(slope) > 0.1 && rSquared > 0.3) {
    trend = slope > 0 ? 'increasing' : 'decreasing';
  }
  
  return {
    trend,
    strength: rSquared,
    slope,
    intercept
  };
}

/**
 * Calculate seasonality score
 * @param {Array} dailySales - Daily sales data
 * @returns {number} Seasonality score (0-1)
 */
function calculateSeasonality(dailySales) {
  // Simple day-of-week seasonality check
  const dayTotals = new Array(7).fill(0);
  const dayCounts = new Array(7).fill(0);
  
  dailySales.forEach(sale => {
    const dayOfWeek = new Date(sale.date).getDay();
    dayTotals[dayOfWeek] += sale.quantity;
    dayCounts[dayOfWeek]++;
  });
  
  const dayAverages = dayTotals.map((total, i) => dayCounts[i] > 0 ? total / dayCounts[i] : 0);
  const overallAverage = dayAverages.reduce((sum, avg) => sum + avg, 0) / 7;
  
  if (overallAverage === 0) return 0;
  
  // Calculate coefficient of variation for day averages
  const variance = dayAverages.reduce((sum, avg) => sum + Math.pow(avg - overallAverage, 2), 0) / 7;
  const cv = Math.sqrt(variance) / overallAverage;
  
  return Math.min(cv, 1); // Cap at 1
}

/**
 * Classify demand pattern
 * @param {Object} pattern - Demand pattern data
 * @returns {string} Classification
 */
function classifyDemandPattern(pattern) {
  const { demandVariability, averageDailyDemand, activeDays, demandTrend } = pattern;
  
  if (averageDailyDemand < 0.1) return 'slow_moving';
  if (activeDays < 7) return 'sporadic';
  if (demandVariability > 1.5) return 'irregular';
  if (demandTrend === 'increasing') return 'growing';
  if (demandTrend === 'decreasing') return 'declining';
  if (demandVariability < 0.3) return 'stable';
  
  return 'regular';
}

// ==================== DEMAND FORECASTING ====================

/**
 * Generate demand forecasts for products
 * @param {Array} demandPatterns - Demand patterns
 * @param {Object} options - Forecast options
 * @returns {Array} Demand forecasts
 */
async function generateDemandForecasts(demandPatterns, options) {
  const { forecastDays = 30, confidenceLevel = 0.95 } = options;
  
  const forecasts = [];
  
  for (const pattern of demandPatterns) {
    const forecast = await generateProductForecast(pattern, {
      forecastDays,
      confidenceLevel
    });
    forecasts.push(forecast);
  }
  
  return forecasts;
}

/**
 * Generate forecast for a single product
 * @param {Object} pattern - Demand pattern
 * @param {Object} options - Forecast options
 * @returns {Object} Product forecast
 */
async function generateProductForecast(pattern, options) {
  const { forecastDays, confidenceLevel } = options;
  
  let forecastDemand = pattern.averageDailyDemand * forecastDays;
  
  // Adjust based on trend
  if (pattern.demandTrend === 'increasing' && pattern.trendStrength > 0.3) {
    forecastDemand *= 1 + (pattern.trendSlope * forecastDays * 0.1);
  } else if (pattern.demandTrend === 'decreasing' && pattern.trendStrength > 0.3) {
    forecastDemand *= Math.max(0.1, 1 - (Math.abs(pattern.trendSlope) * forecastDays * 0.1));
  }
  
  // Adjust for demand classification
  const adjustmentFactors = {
    'slow_moving': 0.8,
    'sporadic': 0.7,
    'irregular': 1.2,
    'growing': 1.1,
    'declining': 0.9,
    'stable': 1.0,
    'regular': 1.0
  };
  
  forecastDemand *= adjustmentFactors[pattern.demandClassification] || 1.0;
  
  // Calculate confidence intervals
  const standardError = pattern.demandVariability * pattern.averageDailyDemand * Math.sqrt(forecastDays);
  const zScore = confidenceLevel === 0.95 ? 1.96 : (confidenceLevel === 0.99 ? 2.58 : 1.64);
  
  return {
    productId: pattern.productId,
    sku: pattern.sku,
    productName: pattern.productName,
    supplierId: pattern.supplierId,
    forecastPeriodDays: forecastDays,
    forecastDemand: Math.max(0, Math.round(forecastDemand)),
    confidenceLevel,
    lowerBound: Math.max(0, Math.round(forecastDemand - (zScore * standardError))),
    upperBound: Math.round(forecastDemand + (zScore * standardError)),
    demandClassification: pattern.demandClassification,
    forecastAccuracy: pattern.demandVariability < 0.5 ? 'high' : (pattern.demandVariability < 1.0 ? 'medium' : 'low')
  };
}

// ==================== REORDER AUTOMATION ====================

/**
 * Analyze current inventory levels and generate reorder recommendations
 * @param {Object} options - Analysis options
 * @returns {Object} Reorder recommendations
 */
export async function analyzeReorderNeeds(options = {}) {
  const {
    warehouseIds = null,
    supplierIds = null,
    includeForecasting = true,
    urgencyOnly = false
  } = options;

  try {
    // Get current inventory levels with product and supplier info
    const inventoryData = await db
      .select({
        inventoryId: inventory.id,
        productId: inventory.productId,
        warehouseId: inventory.warehouseId,
        quantityOnHand: inventory.quantityOnHand,
        quantityAvailable: inventory.quantityAvailable,
        quantityReserved: inventory.quantityReserved,
        reorderPoint: inventory.reorderPoint,
        reorderQuantity: inventory.reorderQuantity,
        maxStockLevel: inventory.maxStockLevel,
        minStockLevel: inventory.minStockLevel,
        lastMovement: inventory.lastMovement,
        sku: products.sku,
        productName: products.name,
        supplierId: products.supplierId,
        supplierName: suppliers.companyName,
        leadTimeDays: suppliers.leadTimeDays,
        costPrice: products.costPrice
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .innerJoin(suppliers, eq(products.supplierId, suppliers.id))
      .where(
        and(
          warehouseIds ? inArray(inventory.warehouseId, warehouseIds) : sql`true`,
          supplierIds ? inArray(products.supplierId, supplierIds) : sql`true`,
          eq(suppliers.isActive, true)
        )
      );

    const reorderAnalysis = {
      urgentReorders: [],
      recommendedReorders: [],
      overstocked: [],
      stockouts: [],
      summary: {
        totalProducts: inventoryData.length,
        urgentReorders: 0,
        recommendedReorders: 0,
        stockouts: 0,
        overstocked: 0
      }
    };

    // Get demand forecasts if requested
    let demandForecasts = {};
    if (includeForecasting) {
      const forecastResult = await analyzeDemandPatterns({
        productIds: inventoryData.map(item => item.productId),
        timeRange: 60
      });
      
      if (forecastResult.success) {
        demandForecasts = forecastResult.data.forecasts.reduce((acc, forecast) => {
          acc[forecast.productId] = forecast;
          return acc;
        }, {});
      }
    }

    // Analyze each inventory item
    for (const item of inventoryData) {
      const analysis = await analyzeInventoryItem(item, demandForecasts[item.productId]);
      
      switch (analysis.recommendation) {
        case 'urgent_reorder':
          reorderAnalysis.urgentReorders.push(analysis);
          reorderAnalysis.summary.urgentReorders++;
          break;
        case 'reorder':
          reorderAnalysis.recommendedReorders.push(analysis);
          reorderAnalysis.summary.recommendedReorders++;
          break;
        case 'stockout':
          reorderAnalysis.stockouts.push(analysis);
          reorderAnalysis.summary.stockouts++;
          break;
        case 'overstock':
          reorderAnalysis.overstocked.push(analysis);
          reorderAnalysis.summary.overstocked++;
          break;
      }
    }

    // Sort by priority
    reorderAnalysis.urgentReorders.sort((a, b) => a.daysOfStock - b.daysOfStock);
    reorderAnalysis.recommendedReorders.sort((a, b) => a.daysOfStock - b.daysOfStock);

    return {
      success: true,
      data: reorderAnalysis,
      message: `Reorder analysis complete: ${reorderAnalysis.summary.urgentReorders} urgent, ${reorderAnalysis.summary.recommendedReorders} recommended`
    };

  } catch (error) {
    console.error('Error analyzing reorder needs:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to analyze reorder needs'
    };
  }
}

/**
 * Analyze individual inventory item for reorder needs
 * @param {Object} item - Inventory item data
 * @param {Object} forecast - Demand forecast (optional)
 * @returns {Object} Item analysis
 */
async function analyzeInventoryItem(item, forecast) {
  const currentStock = item.quantityAvailable;
  const reorderPoint = item.reorderPoint || 0;
  const reorderQuantity = item.reorderQuantity || 0;
  const maxStock = item.maxStockLevel || 0;
  const leadTimeDays = item.leadTimeDays || 7;

  // Calculate demand rate (using forecast if available, otherwise historical)
  let dailyDemandRate = 0;
  
  if (forecast) {
    dailyDemandRate = forecast.forecastDemand / forecast.forecastPeriodDays;
  } else {
    // Fall back to simple historical calculation
    const historicalDemand = await calculateHistoricalDemandRate(item.productId, 30);
    dailyDemandRate = historicalDemand;
  }

  // Safety calculations
  const daysOfStock = dailyDemandRate > 0 ? currentStock / dailyDemandRate : 999;
  const leadTimeDemand = dailyDemandRate * leadTimeDays;
  const suggestedReorderPoint = Math.ceil(leadTimeDemand * 1.5); // 1.5x safety factor
  const suggestedOrderQuantity = Math.max(
    reorderQuantity,
    Math.ceil(dailyDemandRate * 30) // 30 days worth
  );

  let recommendation = 'ok';
  let priority = 'low';
  let reason = 'Stock levels adequate';

  // Determine recommendation
  if (currentStock <= 0) {
    recommendation = 'stockout';
    priority = 'critical';
    reason = 'Out of stock';
  } else if (currentStock <= suggestedReorderPoint * 0.5 || daysOfStock <= 3) {
    recommendation = 'urgent_reorder';
    priority = 'high';
    reason = `Critical stock level - ${Math.round(daysOfStock)} days remaining`;
  } else if (currentStock <= reorderPoint || currentStock <= suggestedReorderPoint) {
    recommendation = 'reorder';
    priority = 'medium';
    reason = `Below reorder point - ${Math.round(daysOfStock)} days remaining`;
  } else if (maxStock > 0 && currentStock > maxStock) {
    recommendation = 'overstock';
    priority = 'low';
    reason = 'Overstocked';
  }

  return {
    inventoryId: item.inventoryId,
    productId: item.productId,
    sku: item.sku,
    productName: item.productName,
    supplierId: item.supplierId,
    supplierName: item.supplierName,
    warehouseId: item.warehouseId,
    currentStock,
    reorderPoint,
    reorderQuantity,
    suggestedReorderPoint,
    suggestedOrderQuantity,
    dailyDemandRate: Math.round(dailyDemandRate * 100) / 100,
    daysOfStock: Math.round(daysOfStock * 10) / 10,
    leadTimeDays,
    leadTimeDemand: Math.round(leadTimeDemand),
    recommendation,
    priority,
    reason,
    costPrice: parseFloat(item.costPrice || 0),
    estimatedOrderValue: suggestedOrderQuantity * parseFloat(item.costPrice || 0),
    lastMovement: item.lastMovement,
    forecast: forecast ? {
      forecastDemand: forecast.forecastDemand,
      forecastAccuracy: forecast.forecastAccuracy,
      demandClassification: forecast.demandClassification
    } : null
  };
}

/**
 * Calculate historical demand rate for a product
 * @param {string} productId - Product ID
 * @param {number} days - Number of days to analyze
 * @returns {number} Daily demand rate
 */
async function calculateHistoricalDemandRate(productId, days = 30) {
  const startDate = new Date(Date.now() - (days * 24 * 60 * 60 * 1000));
  
  const [result] = await db
    .select({
      totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`
    })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.productId, productId),
        eq(inventoryMovements.movementType, 'sale'),
        gte(inventoryMovements.createdAt, startDate)
      )
    );

  const totalQuantity = parseInt(result.totalQuantity || 0);
  return totalQuantity / days;
}

/**
 * Create automated purchase orders for reorder recommendations
 * @param {Array} reorderItems - Items to reorder
 * @param {Object} options - Creation options
 * @returns {Object} Purchase order creation results
 */
export async function createAutomatedPurchaseOrders(reorderItems, options = {}) {
  const {
    approvalRequired = true,
    userId = null,
    notes = 'Automated reorder based on demand analysis'
  } = options;

  try {
    // Group items by supplier
    const supplierGroups = new Map();
    
    for (const item of reorderItems) {
      if (!supplierGroups.has(item.supplierId)) {
        supplierGroups.set(item.supplierId, {
          supplierId: item.supplierId,
          supplierName: item.supplierName,
          items: []
        });
      }
      supplierGroups.get(item.supplierId).items.push(item);
    }

    const creationResults = {
      purchaseOrders: [],
      errors: [],
      summary: {
        suppliersProcessed: supplierGroups.size,
        itemsProcessed: reorderItems.length,
        ordersCreated: 0,
        totalValue: 0
      }
    };

    // Create PO for each supplier
    for (const [supplierId, supplierGroup] of supplierGroups) {
      try {
        // Get current price list for supplier
        const [activePriceList] = await db
          .select()
          .from(priceLists)
          .where(
            and(
              eq(priceLists.supplierId, supplierId),
              eq(priceLists.status, 'active')
            )
          )
          .orderBy(desc(priceLists.effectiveDate))
          .limit(1);

        if (!activePriceList) {
          creationResults.errors.push({
            supplierId,
            error: 'No active price list found',
            items: supplierGroup.items.map(i => i.sku)
          });
          continue;
        }

        // Get pricing for items
        const skus = supplierGroup.items.map(item => item.sku);
        const priceData = await db
          .select()
          .from(priceListItems)
          .where(
            and(
              eq(priceListItems.priceListId, activePriceList.id),
              inArray(priceListItems.sku, skus)
            )
          );

        const priceMap = new Map();
        priceData.forEach(price => {
          priceMap.set(price.sku, price);
        });

        // Create PO items
        const poItems = [];
        let totalValue = 0;

        for (const item of supplierGroup.items) {
          const priceInfo = priceMap.get(item.sku);
          
          if (!priceInfo) {
            creationResults.errors.push({
              supplierId,
              sku: item.sku,
              error: 'Price not found in active price list'
            });
            continue;
          }

          const orderQuantity = item.suggestedOrderQuantity;
          const unitPrice = parseFloat(priceInfo.unitPrice);
          const lineTotal = orderQuantity * unitPrice;
          
          poItems.push({
            sku: item.sku,
            productName: item.productName,
            quantityOrdered: orderQuantity,
            unitPrice: unitPrice.toString(),
            lineTotal: lineTotal.toString(),
            priceListItemId: priceInfo.id,
            notes: `Auto-reorder: ${item.reason}`
          });

          totalValue += lineTotal;
        }

        if (poItems.length === 0) {
          continue;
        }

        // Create purchase order
        const orderData = {
          supplierId,
          poNumber: `AUTO-${Date.now()}-${supplierId.slice(-6)}`,
          priceListId: activePriceList.id,
          status: approvalRequired ? 'draft' : 'approved',
          approvalStatus: approvalRequired ? 'pending' : 'auto_approved',
          subtotal: totalValue.toString(),
          totalAmount: totalValue.toString(),
          notes,
          internalNotes: `Automated PO created from demand analysis. ${poItems.length} items.`,
          createdBy: userId,
          metadata: {
            automatedReorder: true,
            createdAt: new Date().toISOString(),
            demandAnalysisBased: true
          }
        };

        const createdPO = await createSupplierPurchaseOrder(orderData, poItems);

        creationResults.purchaseOrders.push({
          supplierId,
          supplierName: supplierGroup.supplierName,
          purchaseOrder: createdPO,
          itemCount: poItems.length,
          totalValue
        });

        creationResults.summary.ordersCreated++;
        creationResults.summary.totalValue += totalValue;

        // Log creation event
        await logEvent('automated_po_created', {
          supplierId,
          purchaseOrderId: createdPO.id,
          itemCount: poItems.length,
          totalValue,
          approvalRequired,
          userId
        });

      } catch (error) {
        console.error(`Error creating PO for supplier ${supplierId}:`, error);
        creationResults.errors.push({
          supplierId,
          error: error.message,
          items: supplierGroup.items.map(i => i.sku)
        });
      }
    }

    // Send notifications
    if (creationResults.summary.ordersCreated > 0) {
      await sendNotification({
        type: 'automated_pos_created',
        title: 'Automated Purchase Orders Created',
        message: `${creationResults.summary.ordersCreated} automated purchase orders created`,
        data: {
          ordersCreated: creationResults.summary.ordersCreated,
          totalValue: creationResults.summary.totalValue,
          itemsProcessed: creationResults.summary.itemsProcessed,
          approvalRequired
        },
        priority: 'medium',
        category: 'procurement'
      });
    }

    return {
      success: true,
      data: creationResults,
      message: `Created ${creationResults.summary.ordersCreated} automated purchase orders`
    };

  } catch (error) {
    console.error('Error creating automated purchase orders:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to create automated purchase orders'
    };
  }
}

// ==================== SUPPLIER LEAD TIME MANAGEMENT ====================

/**
 * Update supplier lead times based on actual delivery performance
 * @param {Object} options - Update options
 * @returns {Object} Update results
 */
export async function updateSupplierLeadTimes(options = {}) {
  const {
    supplierId = null,
    lookbackDays = 90,
    minimumOrders = 3
  } = options;

  try {
    // Get delivery performance data
    const deliveryData = await db
      .select({
        supplierId: supplierPurchaseOrders.supplierId,
        supplierName: suppliers.companyName,
        orderDate: supplierPurchaseOrders.orderDate,
        expectedDeliveryDate: supplierPurchaseOrders.expectedDeliveryDate,
        deliveredAt: supplierPurchaseOrders.deliveredAt,
        currentLeadTime: suppliers.leadTimeDays
      })
      .from(supplierPurchaseOrders)
      .innerJoin(suppliers, eq(supplierPurchaseOrders.supplierId, suppliers.id))
      .where(
        and(
          supplierId ? eq(supplierPurchaseOrders.supplierId, supplierId) : sql`true`,
          sql`${supplierPurchaseOrders.deliveredAt} IS NOT NULL`,
          gte(supplierPurchaseOrders.orderDate, new Date(Date.now() - (lookbackDays * 24 * 60 * 60 * 1000)))
        )
      )
      .orderBy(suppliers.id, desc(supplierPurchaseOrders.deliveredAt));

    // Group by supplier and calculate performance
    const supplierPerformance = new Map();
    
    for (const delivery of deliveryData) {
      const key = delivery.supplierId;
      if (!supplierPerformance.has(key)) {
        supplierPerformance.set(key, {
          supplierId: delivery.supplierId,
          supplierName: delivery.supplierName,
          currentLeadTime: delivery.currentLeadTime,
          deliveries: []
        });
      }
      
      const actualLeadTime = Math.ceil(
        (new Date(delivery.deliveredAt) - new Date(delivery.orderDate)) / (24 * 60 * 60 * 1000)
      );
      
      supplierPerformance.get(key).deliveries.push({
        orderDate: delivery.orderDate,
        expectedDeliveryDate: delivery.expectedDeliveryDate,
        deliveredAt: delivery.deliveredAt,
        actualLeadTime
      });
    }

    const updateResults = {
      suppliersAnalyzed: 0,
      suppliersUpdated: 0,
      leadTimeChanges: []
    };

    // Calculate and update lead times
    for (const [supplierId, performance] of supplierPerformance) {
      updateResults.suppliersAnalyzed++;
      
      if (performance.deliveries.length < minimumOrders) {
        continue; // Skip suppliers with insufficient data
      }

      const leadTimes = performance.deliveries.map(d => d.actualLeadTime);
      const averageLeadTime = leadTimes.reduce((sum, lt) => sum + lt, 0) / leadTimes.length;
      const maxLeadTime = Math.max(...leadTimes);
      
      // Use 95th percentile for safety
      leadTimes.sort((a, b) => a - b);
      const p95Index = Math.floor(leadTimes.length * 0.95);
      const p95LeadTime = leadTimes[p95Index];
      
      const newLeadTime = Math.ceil(Math.max(averageLeadTime * 1.2, p95LeadTime));
      
      if (Math.abs(newLeadTime - performance.currentLeadTime) >= 1) {
        // Update supplier lead time
        await db
          .update(suppliers)
          .set({
            leadTimeDays: newLeadTime,
            updatedAt: new Date(),
            metadata: sql`${suppliers.metadata} || ${JSON.stringify({
              leadTimeUpdated: new Date().toISOString(),
              previousLeadTime: performance.currentLeadTime,
              calculatedFrom: performance.deliveries.length,
              averageActual: Math.round(averageLeadTime * 10) / 10,
              p95Actual: p95LeadTime
            })}`
          })
          .where(eq(suppliers.id, supplierId));

        updateResults.suppliersUpdated++;
        updateResults.leadTimeChanges.push({
          supplierId,
          supplierName: performance.supplierName,
          previousLeadTime: performance.currentLeadTime,
          newLeadTime,
          averageActual: Math.round(averageLeadTime * 10) / 10,
          p95Actual: p95LeadTime,
          dataPoints: performance.deliveries.length
        });
      }
    }

    // Log lead time updates
    await logEvent('supplier_lead_times_updated', {
      suppliersAnalyzed: updateResults.suppliersAnalyzed,
      suppliersUpdated: updateResults.suppliersUpdated,
      lookbackDays,
      minimumOrders
    });

    return {
      success: true,
      data: updateResults,
      message: `Updated lead times for ${updateResults.suppliersUpdated} suppliers`
    };

  } catch (error) {
    console.error('Error updating supplier lead times:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to update supplier lead times'
    };
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Log workflow events
 * @param {string} eventType - Event type
 * @param {Object} eventData - Event data
 */
async function logEvent(eventType, eventData) {
  try {
    await db.insert(timeSeriesEvents).values({
      eventType,
      eventCategory: 'demand_planning',
      action: eventType,
      properties: eventData,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error logging event:', error);
  }
}

export default {
  analyzeDemandPatterns,
  analyzeReorderNeeds,
  createAutomatedPurchaseOrders,
  updateSupplierLeadTimes
};