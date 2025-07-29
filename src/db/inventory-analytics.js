import { eq, and, or, desc, asc, sql, gte, lte, isNull, isNotNull, gt, lt, between } from 'drizzle-orm';
import { db } from '../config/database.js';
import { inventory, inventoryMovements, products, suppliers } from './schema.js';

// ==================== INVENTORY TURNOVER CALCULATIONS ====================

/**
 * Calculate inventory turnover ratio for products
 * Turnover = Cost of Goods Sold / Average Inventory Value
 */
export async function calculateInventoryTurnover(params = {}) {
  const {
    warehouseId = null,
    categoryFilter = null,
    dateFrom = null,
    dateTo = null,
    productId = null,
    groupBy = 'product' // product, category, warehouse, all
  } = params;

  // Default to last 12 months if no date range provided
  const endDate = dateTo ? new Date(dateTo) : new Date();
  const startDate = dateFrom ? new Date(dateFrom) : new Date(endDate.getTime() - 365 * 24 * 60 * 60 * 1000);

  let whereConditions = [
    eq(products.isActive, true),
    gte(inventoryMovements.createdAt, startDate),
    lte(inventoryMovements.createdAt, endDate)
  ];

  if (warehouseId) {
    whereConditions.push(eq(inventory.warehouseId, warehouseId));
  }

  if (categoryFilter) {
    whereConditions.push(eq(products.category, categoryFilter));
  }

  if (productId) {
    whereConditions.push(eq(products.id, productId));
  }

  const whereClause = and(...whereConditions);

  let selectFields = {};
  let groupByFields = [];

  // Configure grouping
  switch (groupBy) {
    case 'product':
      selectFields = {
        productId: inventory.productId,
        productSku: products.sku,
        productName: products.name,
        category: products.category,
      };
      groupByFields = [inventory.productId, products.sku, products.name, products.category];
      break;
    case 'category':
      selectFields = {
        category: products.category,
      };
      groupByFields = [products.category];
      break;
    case 'warehouse':
      selectFields = {
        warehouseId: inventory.warehouseId,
      };
      groupByFields = [inventory.warehouseId];
      break;
    case 'all':
    default:
      selectFields = {};
      groupByFields = [];
      break;
  }

  // Calculate turnover metrics
  const turnoverData = await db
    .select({
      ...selectFields,
      // Cost of goods sold (outbound movements)
      cogs: sql`SUM(CASE 
        WHEN ${inventoryMovements.quantity} < 0 
        THEN ABS(${inventoryMovements.quantity}) * COALESCE(${inventoryMovements.unitCost}, ${inventory.averageCost}, 0)
        ELSE 0 
      END)`,
      // Average inventory value during period
      avgInventoryValue: sql`AVG(${inventory.quantityOnHand} * COALESCE(${inventory.averageCost}, 0))`,
      // Current inventory value
      currentInventoryValue: sql`SUM(${inventory.quantityOnHand} * COALESCE(${inventory.averageCost}, 0))`,
      // Total units sold
      unitsSold: sql`SUM(CASE WHEN ${inventoryMovements.quantity} < 0 THEN ABS(${inventoryMovements.quantity}) ELSE 0 END)`,
      // Average stock level
      avgStockLevel: sql`AVG(${inventory.quantityOnHand})`,
      // Current stock level
      currentStockLevel: sql`SUM(${inventory.quantityOnHand})`,
      // Days in period
      daysInPeriod: sql`EXTRACT(DAY FROM AGE(${endDate}, ${startDate}))`,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .leftJoin(inventoryMovements, and(
      eq(inventoryMovements.inventoryId, inventory.id),
      gte(inventoryMovements.createdAt, startDate),
      lte(inventoryMovements.createdAt, endDate)
    ))
    .where(whereClause)
    .groupBy(...groupByFields);

  // Calculate derived metrics
  const enrichedData = turnoverData.map(row => {
    const cogs = Number(row.cogs) || 0;
    const avgInventoryValue = Number(row.avgInventoryValue) || 0;
    const currentInventoryValue = Number(row.currentInventoryValue) || 0;
    const unitsSold = Number(row.unitsSold) || 0;
    const avgStockLevel = Number(row.avgStockLevel) || 0;
    const currentStockLevel = Number(row.currentStockLevel) || 0;
    const daysInPeriod = Number(row.daysInPeriod) || 365;

    // Inventory turnover ratio
    const turnoverRatio = avgInventoryValue > 0 ? cogs / avgInventoryValue : 0;
    
    // Days of inventory (how many days of sales the current inventory represents)
    const dailySales = unitsSold / daysInPeriod;
    const daysOfInventory = dailySales > 0 ? currentStockLevel / dailySales : 0;
    
    // Inventory velocity (turns per year)
    const annualTurnover = turnoverRatio * (365 / daysInPeriod);

    return {
      ...row,
      turnoverRatio: Number(turnoverRatio.toFixed(2)),
      annualTurnover: Number(annualTurnover.toFixed(2)),
      daysOfInventory: Math.round(daysOfInventory),
      dailySalesRate: Number(dailySales.toFixed(2)),
      inventoryVelocity: turnoverRatio > 0 ? Number((365 / (daysOfInventory || 365)).toFixed(2)) : 0,
      // Performance indicators
      turnoverHealth: getTurnoverHealthStatus(annualTurnover),
      cogsTotal: cogs,
      avgInventoryValue: avgInventoryValue,
      currentInventoryValue: currentInventoryValue,
    };
  });

  return enrichedData;
}

/**
 * Get turnover trends over time
 */
export async function getInventoryTurnoverTrends(params = {}) {
  const {
    warehouseId = null,
    categoryFilter = null,
    productId = null,
    periodType = 'monthly', // weekly, monthly, quarterly
    periodsBack = 12
  } = params;

  const endDate = new Date();
  let startDate, groupByTimeUnit;

  switch (periodType) {
    case 'weekly':
      startDate = new Date(endDate.getTime() - periodsBack * 7 * 24 * 60 * 60 * 1000);
      groupByTimeUnit = sql`DATE_TRUNC('week', ${inventoryMovements.createdAt})`;
      break;
    case 'quarterly':
      startDate = new Date(endDate.getTime() - periodsBack * 90 * 24 * 60 * 60 * 1000);
      groupByTimeUnit = sql`DATE_TRUNC('quarter', ${inventoryMovements.createdAt})`;
      break;
    case 'monthly':
    default:
      startDate = new Date(endDate.getTime() - periodsBack * 30 * 24 * 60 * 60 * 1000);
      groupByTimeUnit = sql`DATE_TRUNC('month', ${inventoryMovements.createdAt})`;
      break;
  }

  let whereConditions = [
    eq(products.isActive, true),
    gte(inventoryMovements.createdAt, startDate),
    lte(inventoryMovements.createdAt, endDate)
  ];

  if (warehouseId) {
    whereConditions.push(eq(inventory.warehouseId, warehouseId));
  }

  if (categoryFilter) {
    whereConditions.push(eq(products.category, categoryFilter));
  }

  if (productId) {
    whereConditions.push(eq(products.id, productId));
  }

  const whereClause = and(...whereConditions);

  const trends = await db
    .select({
      period: groupByTimeUnit,
      cogs: sql`SUM(CASE 
        WHEN ${inventoryMovements.quantity} < 0 
        THEN ABS(${inventoryMovements.quantity}) * COALESCE(${inventoryMovements.unitCost}, ${inventory.averageCost}, 0)
        ELSE 0 
      END)`,
      avgInventoryValue: sql`AVG(${inventory.quantityOnHand} * COALESCE(${inventory.averageCost}, 0))`,
      unitsSold: sql`SUM(CASE WHEN ${inventoryMovements.quantity} < 0 THEN ABS(${inventoryMovements.quantity}) ELSE 0 END)`,
      avgStockLevel: sql`AVG(${inventory.quantityOnHand})`,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .leftJoin(inventoryMovements, and(
      eq(inventoryMovements.inventoryId, inventory.id),
      gte(inventoryMovements.createdAt, startDate),
      lte(inventoryMovements.createdAt, endDate)
    ))
    .where(whereClause)
    .groupBy(groupByTimeUnit)
    .orderBy(asc(groupByTimeUnit));

  // Calculate turnover ratio for each period
  return trends.map(trend => {
    const cogs = Number(trend.cogs) || 0;
    const avgInventoryValue = Number(trend.avgInventoryValue) || 0;
    const turnoverRatio = avgInventoryValue > 0 ? cogs / avgInventoryValue : 0;

    return {
      period: trend.period,
      turnoverRatio: Number(turnoverRatio.toFixed(2)),
      cogs: cogs,
      avgInventoryValue: avgInventoryValue,
      unitsSold: Number(trend.unitsSold) || 0,
      avgStockLevel: Number(trend.avgStockLevel) || 0,
    };
  });
}

// ==================== STOCK LEVEL OPTIMIZATION ====================

/**
 * Calculate optimal stock levels using various algorithms
 */
export async function calculateOptimalStockLevels(params = {}) {
  const {
    warehouseId = null,
    productId = null,
    analysisMethod = 'economic_order_quantity', // economic_order_quantity, abc_analysis, safety_stock
    lookbackDays = 90,
    serviceLevel = 0.95, // 95% service level for safety stock calculations
    leadTimeDays = 7
  } = params;

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  let whereConditions = [
    eq(products.isActive, true),
    gte(inventoryMovements.createdAt, startDate),
    lte(inventoryMovements.createdAt, endDate)
  ];

  if (warehouseId) {
    whereConditions.push(eq(inventory.warehouseId, warehouseId));
  }

  if (productId) {
    whereConditions.push(eq(products.id, productId));
  }

  const whereClause = and(...whereConditions);

  // Get demand patterns and costs
  const demandData = await db
    .select({
      productId: inventory.productId,
      productSku: products.sku,
      productName: products.name,
      category: products.category,
      warehouseId: inventory.warehouseId,
      currentStock: inventory.quantityOnHand,
      currentReorderPoint: inventory.reorderPoint,
      currentReorderQuantity: inventory.reorderQuantity,
      avgCost: inventory.averageCost,
      // Demand metrics
      totalDemand: sql`SUM(CASE WHEN ${inventoryMovements.quantity} < 0 THEN ABS(${inventoryMovements.quantity}) ELSE 0 END)`,
      demandVariance: sql`VARIANCE(CASE WHEN ${inventoryMovements.quantity} < 0 THEN ABS(${inventoryMovements.quantity}) ELSE 0 END)`,
      demandStdDev: sql`STDDEV(CASE WHEN ${inventoryMovements.quantity} < 0 THEN ABS(${inventoryMovements.quantity}) ELSE 0 END)`,
      avgDailyDemand: sql`AVG(CASE WHEN ${inventoryMovements.quantity} < 0 THEN ABS(${inventoryMovements.quantity}) ELSE 0 END)`,
      maxDailyDemand: sql`MAX(CASE WHEN ${inventoryMovements.quantity} < 0 THEN ABS(${inventoryMovements.quantity}) ELSE 0 END)`,
      demandDays: sql`COUNT(DISTINCT DATE(${inventoryMovements.createdAt}))`,
      // Cost data
      holdingCost: sql`${inventory.averageCost} * 0.25`, // Assume 25% annual holding cost
      orderingCost: sql`50`, // Assume $50 ordering cost per order
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .leftJoin(inventoryMovements, and(
      eq(inventoryMovements.inventoryId, inventory.id),
      gte(inventoryMovements.createdAt, startDate),
      lte(inventoryMovements.createdAt, endDate)
    ))
    .where(whereClause)
    .groupBy(
      inventory.productId, 
      products.sku, 
      products.name, 
      products.category,
      inventory.warehouseId,
      inventory.quantityOnHand,
      inventory.reorderPoint,
      inventory.reorderQuantity,
      inventory.averageCost
    );

  // Calculate optimal levels based on method
  const optimizedData = demandData.map(item => {
    const avgDailyDemand = Number(item.avgDailyDemand) || 0;
    const demandStdDev = Number(item.demandStdDev) || 0;
    const totalDemand = Number(item.totalDemand) || 0;
    const avgCost = Number(item.avgCost) || 0;
    const holdingCost = Number(item.holdingCost) || 0;
    const orderingCost = Number(item.orderingCost) || 0;
    const demandDays = Number(item.demandDays) || 1;

    // Annualized demand
    const annualDemand = (totalDemand / demandDays) * 365;

    let optimizedReorderPoint = 0;
    let optimizedReorderQuantity = 0;
    let safetyStock = 0;
    let maxStock = 0;

    switch (analysisMethod) {
      case 'economic_order_quantity':
        if (annualDemand > 0 && holdingCost > 0) {
          // EOQ formula: sqrt(2 * D * S / H)
          optimizedReorderQuantity = Math.sqrt((2 * annualDemand * orderingCost) / holdingCost);
          
          // Safety stock based on service level
          const zScore = getZScoreForServiceLevel(serviceLevel);
          safetyStock = zScore * demandStdDev * Math.sqrt(leadTimeDays);
          
          // Reorder point = (average daily demand * lead time) + safety stock
          optimizedReorderPoint = (avgDailyDemand * leadTimeDays) + safetyStock;
          
          // Max stock = reorder point + reorder quantity
          maxStock = optimizedReorderPoint + optimizedReorderQuantity;
        }
        break;

      case 'safety_stock':
        const zScore = getZScoreForServiceLevel(serviceLevel);
        safetyStock = zScore * demandStdDev * Math.sqrt(leadTimeDays);
        optimizedReorderPoint = (avgDailyDemand * leadTimeDays) + safetyStock;
        optimizedReorderQuantity = Math.max(avgDailyDemand * 30, 1); // 30 days worth
        maxStock = optimizedReorderPoint + optimizedReorderQuantity;
        break;

      case 'abc_analysis':
        // Will be implemented separately as it requires revenue data
        break;
    }

    // Calculate potential improvements
    const currentAnnualCost = calculateAnnualInventoryCost(
      item.currentStock,
      item.currentReorderQuantity || optimizedReorderQuantity,
      annualDemand,
      holdingCost,
      orderingCost
    );

    const optimizedAnnualCost = calculateAnnualInventoryCost(
      optimizedReorderPoint,
      optimizedReorderQuantity,
      annualDemand,
      holdingCost,
      orderingCost
    );

    const costSavings = currentAnnualCost - optimizedAnnualCost;
    const improvementPercentage = currentAnnualCost > 0 ? (costSavings / currentAnnualCost) * 100 : 0;

    return {
      ...item,
      avgDailyDemand: Number(avgDailyDemand.toFixed(2)),
      demandVariability: demandStdDev > 0 ? Number((demandStdDev / avgDailyDemand).toFixed(2)) : 0,
      optimizedReorderPoint: Math.round(optimizedReorderPoint),
      optimizedReorderQuantity: Math.round(optimizedReorderQuantity),
      safetyStock: Math.round(safetyStock),
      maxStock: Math.round(maxStock),
      currentAnnualCost: Number(currentAnnualCost.toFixed(2)),
      optimizedAnnualCost: Number(optimizedAnnualCost.toFixed(2)),
      potentialSavings: Number(costSavings.toFixed(2)),
      improvementPercentage: Number(improvementPercentage.toFixed(1)),
      recommendation: getStockOptimizationRecommendation(
        item.currentStock,
        optimizedReorderPoint,
        optimizedReorderQuantity,
        avgDailyDemand
      ),
    };
  });

  return optimizedData.filter(item => item.avgDailyDemand > 0); // Only return items with demand
}

/**
 * Perform ABC analysis for inventory categorization
 */
export async function performABCAnalysis(params = {}) {
  const {
    warehouseId = null,
    lookbackDays = 90,
    criteriaType = 'revenue' // revenue, quantity, margin
  } = params;

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  let whereConditions = [
    eq(products.isActive, true),
    gte(inventoryMovements.createdAt, startDate),
    lte(inventoryMovements.createdAt, endDate),
    lt(inventoryMovements.quantity, 0) // Only outbound movements (sales)
  ];

  if (warehouseId) {
    whereConditions.push(eq(inventory.warehouseId, warehouseId));
  }

  const whereClause = and(...whereConditions);

  // Calculate metrics for ABC classification
  const productMetrics = await db
    .select({
      productId: inventory.productId,
      productSku: products.sku,
      productName: products.name,
      category: products.category,
      currentStock: inventory.quantityOnHand,
      unitsSold: sql`SUM(ABS(${inventoryMovements.quantity}))`,
      revenue: sql`SUM(ABS(${inventoryMovements.quantity}) * COALESCE(${inventoryMovements.unitCost}, ${inventory.averageCost}, ${products.unitPrice}, 0))`,
      cost: sql`SUM(ABS(${inventoryMovements.quantity}) * COALESCE(${inventoryMovements.unitCost}, ${inventory.averageCost}, 0))`,
      avgPrice: sql`AVG(COALESCE(${inventoryMovements.unitCost}, ${inventory.averageCost}, ${products.unitPrice}, 0))`,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .innerJoin(inventoryMovements, and(
      eq(inventoryMovements.inventoryId, inventory.id),
      gte(inventoryMovements.createdAt, startDate),
      lte(inventoryMovements.createdAt, endDate),
      lt(inventoryMovements.quantity, 0)
    ))
    .where(whereClause)
    .groupBy(
      inventory.productId,
      products.sku,
      products.name,
      products.category,
      inventory.quantityOnHand
    );

  // Calculate criteria value based on type
  const enrichedMetrics = productMetrics.map(item => {
    const revenue = Number(item.revenue) || 0;
    const cost = Number(item.cost) || 0;
    const unitsSold = Number(item.unitsSold) || 0;
    const margin = revenue - cost;

    let criteriaValue = 0;
    switch (criteriaType) {
      case 'revenue':
        criteriaValue = revenue;
        break;
      case 'quantity':
        criteriaValue = unitsSold;
        break;
      case 'margin':
        criteriaValue = margin;
        break;
    }

    return {
      ...item,
      revenue: revenue,
      cost: cost,
      margin: margin,
      criteriaValue: criteriaValue,
      marginPercentage: revenue > 0 ? Number(((margin / revenue) * 100).toFixed(1)) : 0,
    };
  });

  // Sort by criteria value
  enrichedMetrics.sort((a, b) => b.criteriaValue - a.criteriaValue);

  // Calculate cumulative percentages
  const totalCriteriaValue = enrichedMetrics.reduce((sum, item) => sum + item.criteriaValue, 0);
  let cumulativeValue = 0;

  const classifiedItems = enrichedMetrics.map((item, index) => {
    cumulativeValue += item.criteriaValue;
    const cumulativePercentage = totalCriteriaValue > 0 ? (cumulativeValue / totalCriteriaValue) * 100 : 0;
    
    // ABC Classification
    let abcClass = 'C';
    if (cumulativePercentage <= 80) {
      abcClass = 'A';
    } else if (cumulativePercentage <= 95) {
      abcClass = 'B';
    }

    return {
      ...item,
      rank: index + 1,
      criteriaPercentage: totalCriteriaValue > 0 ? Number(((item.criteriaValue / totalCriteriaValue) * 100).toFixed(2)) : 0,
      cumulativePercentage: Number(cumulativePercentage.toFixed(2)),
      abcClass: abcClass,
      recommendedStrategy: getABCRecommendedStrategy(abcClass),
    };
  });

  // Summary statistics
  const summary = {
    totalItems: classifiedItems.length,
    classA: classifiedItems.filter(item => item.abcClass === 'A').length,
    classB: classifiedItems.filter(item => item.abcClass === 'B').length,
    classC: classifiedItems.filter(item => item.abcClass === 'C').length,
    totalValue: totalCriteriaValue,
    classAValue: classifiedItems.filter(item => item.abcClass === 'A').reduce((sum, item) => sum + item.criteriaValue, 0),
    classBValue: classifiedItems.filter(item => item.abcClass === 'B').reduce((sum, item) => sum + item.criteriaValue, 0),
    classCValue: classifiedItems.filter(item => item.abcClass === 'C').reduce((sum, item) => sum + item.criteriaValue, 0),
  };

  return {
    items: classifiedItems,
    summary: summary,
    criteriaType: criteriaType,
    analysisDate: endDate,
    lookbackDays: lookbackDays,
  };
}

// ==================== DEAD STOCK IDENTIFICATION ====================

/**
 * Identify dead stock and slow-moving inventory
 */
export async function identifyDeadStock(params = {}) {
  const {
    warehouseId = null,
    categoryFilter = null,
    deadStockDays = 180, // No movement in 180 days = dead stock
    slowMovingDays = 90,  // Little movement in 90 days = slow moving
    minQuantityThreshold = 1,
    includeSlowMoving = true
  } = params;

  const currentDate = new Date();
  const deadStockCutoff = new Date(currentDate.getTime() - deadStockDays * 24 * 60 * 60 * 1000);
  const slowMovingCutoff = new Date(currentDate.getTime() - slowMovingDays * 24 * 60 * 60 * 1000);

  let whereConditions = [
    eq(products.isActive, true),
    gte(inventory.quantityOnHand, minQuantityThreshold)
  ];

  if (warehouseId) {
    whereConditions.push(eq(inventory.warehouseId, warehouseId));
  }

  if (categoryFilter) {
    whereConditions.push(eq(products.category, categoryFilter));
  }

  const whereClause = and(...whereConditions);

  // Get inventory with movement history
  const inventoryWithMovements = await db
    .select({
      inventoryId: inventory.id,
      productId: inventory.productId,
      productSku: products.sku,
      productName: products.name,
      productDescription: products.description,
      category: products.category,
      warehouseId: inventory.warehouseId,
      quantityOnHand: inventory.quantityOnHand,
      quantityReserved: inventory.quantityReserved,
      quantityAvailable: inventory.quantityAvailable,
      averageCost: inventory.averageCost,
      lastMovement: inventory.lastMovement,
      lastStockCheck: inventory.lastStockCheck,
      reorderPoint: inventory.reorderPoint,
      // Movement statistics
      lastSaleDate: sql`MAX(CASE WHEN ${inventoryMovements.quantity} < 0 THEN ${inventoryMovements.createdAt} ELSE NULL END)`,
      lastReceiptDate: sql`MAX(CASE WHEN ${inventoryMovements.quantity} > 0 THEN ${inventoryMovements.createdAt} ELSE NULL END)`,
      totalOutboundLast90Days: sql`SUM(CASE 
        WHEN ${inventoryMovements.quantity} < 0 
        AND ${inventoryMovements.createdAt} >= ${slowMovingCutoff}
        THEN ABS(${inventoryMovements.quantity}) 
        ELSE 0 
      END)`,
      totalOutboundLast180Days: sql`SUM(CASE 
        WHEN ${inventoryMovements.quantity} < 0 
        AND ${inventoryMovements.createdAt} >= ${deadStockCutoff}
        THEN ABS(${inventoryMovements.quantity}) 
        ELSE 0 
      END)`,
      totalInboundLast180Days: sql`SUM(CASE 
        WHEN ${inventoryMovements.quantity} > 0 
        AND ${inventoryMovements.createdAt} >= ${deadStockCutoff}
        THEN ${inventoryMovements.quantity} 
        ELSE 0 
      END)`,
      movementCount90Days: sql`COUNT(CASE 
        WHEN ${inventoryMovements.createdAt} >= ${slowMovingCutoff}
        THEN 1 
        ELSE NULL 
      END)`,
      movementCount180Days: sql`COUNT(CASE 
        WHEN ${inventoryMovements.createdAt} >= ${deadStockCutoff}
        THEN 1 
        ELSE NULL 
      END)`,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .leftJoin(inventoryMovements, eq(inventoryMovements.inventoryId, inventory.id))
    .where(whereClause)
    .groupBy(
      inventory.id,
      inventory.productId,
      products.sku,
      products.name,
      products.description,
      products.category,
      inventory.warehouseId,
      inventory.quantityOnHand,
      inventory.quantityReserved,
      inventory.quantityAvailable,
      inventory.averageCost,
      inventory.lastMovement,
      inventory.lastStockCheck,
      inventory.reorderPoint
    );

  // Classify stock as dead, slow-moving, or normal
  const classifiedStock = inventoryWithMovements.map(item => {
    const lastSaleDate = item.lastSaleDate ? new Date(item.lastSaleDate) : null;
    const lastReceiptDate = item.lastReceiptDate ? new Date(item.lastReceiptDate) : null;
    const lastMovement = item.lastMovement ? new Date(item.lastMovement) : null;
    
    const daysWithoutSale = lastSaleDate ? 
      Math.floor((currentDate - lastSaleDate) / (1000 * 60 * 60 * 24)) : 
      999;
    
    const daysWithoutMovement = lastMovement ? 
      Math.floor((currentDate - lastMovement) / (1000 * 60 * 60 * 24)) : 
      999;

    const outbound90Days = Number(item.totalOutboundLast90Days) || 0;
    const outbound180Days = Number(item.totalOutboundLast180Days) || 0;
    const inbound180Days = Number(item.totalInboundLast180Days) || 0;
    const movementCount90Days = Number(item.movementCount90Days) || 0;
    const movementCount180Days = Number(item.movementCount180Days) || 0;

    // Calculate inventory value
    const inventoryValue = Number(item.quantityOnHand) * Number(item.averageCost || 0);

    // Determine stock status
    let stockStatus = 'normal';
    let riskLevel = 'low';
    let reason = '';

    if (daysWithoutSale >= deadStockDays && outbound180Days === 0) {
      stockStatus = 'dead';
      riskLevel = 'high';
      reason = `No sales for ${daysWithoutSale} days`;
    } else if (daysWithoutMovement >= deadStockDays && movementCount180Days === 0) {
      stockStatus = 'dead';
      riskLevel = 'high';
      reason = `No movement for ${daysWithoutMovement} days`;
    } else if (includeSlowMoving) {
      if (daysWithoutSale >= slowMovingDays && outbound90Days === 0) {
        stockStatus = 'slow_moving';
        riskLevel = 'medium';
        reason = `No sales for ${daysWithoutSale} days`;
      } else if (outbound90Days > 0 && outbound90Days < (Number(item.quantityOnHand) * 0.1)) {
        stockStatus = 'slow_moving';
        riskLevel = 'medium';
        reason = `Low sales velocity: ${outbound90Days} units in 90 days`;
      }
    }

    // Calculate days of inventory
    const dailySalesRate90Days = outbound90Days / 90;
    const daysOfInventory = dailySalesRate90Days > 0 ? 
      Number(item.quantityOnHand) / dailySalesRate90Days : 
      999;

    // Recommendations
    const recommendations = generateDeadStockRecommendations(
      stockStatus,
      inventoryValue,
      daysOfInventory,
      item.quantityOnHand,
      outbound90Days
    );

    return {
      ...item,
      stockStatus: stockStatus,
      riskLevel: riskLevel,
      reason: reason,
      daysWithoutSale: daysWithoutSale,
      daysWithoutMovement: daysWithoutMovement,
      daysOfInventory: Math.round(daysOfInventory),
      inventoryValue: Number(inventoryValue.toFixed(2)),
      dailySalesRate90Days: Number(dailySalesRate90Days.toFixed(2)),
      outbound90Days: outbound90Days,
      outbound180Days: outbound180Days,
      inbound180Days: inbound180Days,
      movementFrequency: movementCount180Days,
      recommendations: recommendations,
      lastSaleDate: lastSaleDate,
      lastReceiptDate: lastReceiptDate,
    };
  });

  // Filter and sort results
  const filteredResults = classifiedStock.filter(item => 
    item.stockStatus === 'dead' || (includeSlowMoving && item.stockStatus === 'slow_moving')
  );

  // Sort by inventory value (highest first) to prioritize high-value dead stock
  filteredResults.sort((a, b) => b.inventoryValue - a.inventoryValue);

  // Calculate summary statistics
  const summary = {
    totalItems: filteredResults.length,
    deadStockItems: filteredResults.filter(item => item.stockStatus === 'dead').length,
    slowMovingItems: filteredResults.filter(item => item.stockStatus === 'slow_moving').length,
    totalValue: filteredResults.reduce((sum, item) => sum + item.inventoryValue, 0),
    deadStockValue: filteredResults
      .filter(item => item.stockStatus === 'dead')
      .reduce((sum, item) => sum + item.inventoryValue, 0),
    slowMovingValue: filteredResults
      .filter(item => item.stockStatus === 'slow_moving')
      .reduce((sum, item) => sum + item.inventoryValue, 0),
    avgDaysWithoutSale: filteredResults.length > 0 ? 
      Math.round(filteredResults.reduce((sum, item) => sum + item.daysWithoutSale, 0) / filteredResults.length) : 0,
  };

  return {
    items: filteredResults,
    summary: summary,
    parameters: {
      deadStockDays,
      slowMovingDays,
      minQuantityThreshold,
      includeSlowMoving,
      analysisDate: currentDate,
    },
  };
}

// ==================== REORDER POINT CALCULATIONS ====================

/**
 * Calculate optimized reorder points using statistical methods
 */
export async function calculateOptimizedReorderPoints(params = {}) {
  const {
    warehouseId = null,
    productId = null,
    serviceLevel = 0.95,
    leadTimeDays = 7,
    lookbackDays = 90,
    method = 'statistical' // statistical, min_max, fixed_period
  } = params;

  const endDate = new Date();
  const startDate = new Date(endDate.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  let whereConditions = [
    eq(products.isActive, true),
    gte(inventoryMovements.createdAt, startDate),
    lte(inventoryMovements.createdAt, endDate),
    lt(inventoryMovements.quantity, 0) // Only outbound movements
  ];

  if (warehouseId) {
    whereConditions.push(eq(inventory.warehouseId, warehouseId));
  }

  if (productId) {
    whereConditions.push(eq(products.id, productId));
  }

  const whereClause = and(...whereConditions);

  // Get demand patterns
  const demandAnalysis = await db
    .select({
      productId: inventory.productId,
      productSku: products.sku,
      productName: products.name,
      category: products.category,
      warehouseId: inventory.warehouseId,
      currentStock: inventory.quantityOnHand,
      currentReorderPoint: inventory.reorderPoint,
      currentReorderQuantity: inventory.reorderQuantity,
      // Daily demand statistics
      avgDailyDemand: sql`AVG(ABS(${inventoryMovements.quantity}))`,
      maxDailyDemand: sql`MAX(ABS(${inventoryMovements.quantity}))`,
      minDailyDemand: sql`MIN(ABS(${inventoryMovements.quantity}))`,
      stdDevDemand: sql`STDDEV(ABS(${inventoryMovements.quantity}))`,
      totalDemand: sql`SUM(ABS(${inventoryMovements.quantity}))`,
      demandDays: sql`COUNT(DISTINCT DATE(${inventoryMovements.createdAt}))`,
      demandVariance: sql`VARIANCE(ABS(${inventoryMovements.quantity}))`,
      // Lead time demand (simulate different lead time scenarios)
      maxWeeklyDemand: sql`MAX(SUM(ABS(${inventoryMovements.quantity}))) OVER (PARTITION BY DATE_TRUNC('week', ${inventoryMovements.createdAt}))`,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .innerJoin(inventoryMovements, and(
      eq(inventoryMovements.inventoryId, inventory.id),
      gte(inventoryMovements.createdAt, startDate),
      lte(inventoryMovements.createdAt, endDate),
      lt(inventoryMovements.quantity, 0)
    ))
    .where(whereClause)
    .groupBy(
      inventory.productId,
      products.sku,
      products.name,
      products.category,
      inventory.warehouseId,
      inventory.quantityOnHand,
      inventory.reorderPoint,
      inventory.reorderQuantity
    );

  const optimizedReorderPoints = demandAnalysis.map(item => {
    const avgDailyDemand = Number(item.avgDailyDemand) || 0;
    const maxDailyDemand = Number(item.maxDailyDemand) || 0;
    const stdDevDemand = Number(item.stdDevDemand) || 0;
    const totalDemand = Number(item.totalDemand) || 0;
    const demandDays = Number(item.demandDays) || 1;

    let optimizedReorderPoint = 0;
    let safetyStock = 0;
    let leadTimeDemand = 0;
    let confidence = 'low';

    if (avgDailyDemand > 0) {
      leadTimeDemand = avgDailyDemand * leadTimeDays;

      switch (method) {
        case 'statistical':
          // Safety stock = Z-score * sqrt(lead time) * demand standard deviation
          const zScore = getZScoreForServiceLevel(serviceLevel);
          safetyStock = zScore * Math.sqrt(leadTimeDays) * stdDevDemand;
          optimizedReorderPoint = leadTimeDemand + safetyStock;
          confidence = stdDevDemand < (avgDailyDemand * 0.5) ? 'high' : 'medium';
          break;

        case 'min_max':
          // Simple min-max approach
          safetyStock = maxDailyDemand * leadTimeDays * 0.5; // 50% of max demand as safety
          optimizedReorderPoint = leadTimeDemand + safetyStock;
          confidence = 'medium';
          break;

        case 'fixed_period':
          // Fixed period approach with review period
          const reviewPeriod = 7; // Weekly review
          const reviewPeriodDemand = avgDailyDemand * reviewPeriod;
          safetyStock = 1.65 * stdDevDemand * Math.sqrt(leadTimeDays + reviewPeriod); // 95% service level
          optimizedReorderPoint = leadTimeDemand + reviewPeriodDemand + safetyStock;
          confidence = 'high';
          break;
      }
    }

    // Calculate current vs optimized performance
    const currentStockoutRisk = calculateStockoutRisk(
      item.currentStock,
      item.currentReorderPoint || 0,
      avgDailyDemand,
      stdDevDemand,
      leadTimeDays
    );

    const optimizedStockoutRisk = calculateStockoutRisk(
      item.currentStock,
      optimizedReorderPoint,
      avgDailyDemand,
      stdDevDemand,
      leadTimeDays
    );

    // Calculate holding cost impact
    const additionalHoldingCost = safetyStock * 0.25; // Assume 25% annual holding cost rate

    return {
      ...item,
      // Demand metrics
      avgDailyDemand: Number(avgDailyDemand.toFixed(2)),
      maxDailyDemand: Number(maxDailyDemand.toFixed(2)),
      demandVariability: avgDailyDemand > 0 ? Number((stdDevDemand / avgDailyDemand).toFixed(2)) : 0,
      demandTrend: calculateDemandTrend(totalDemand, demandDays),
      
      // Optimized parameters
      optimizedReorderPoint: Math.round(optimizedReorderPoint),
      safetyStock: Math.round(safetyStock),
      leadTimeDemand: Math.round(leadTimeDemand),
      serviceLevel: serviceLevel,
      confidence: confidence,
      
      // Performance comparison
      currentStockoutRisk: Number(currentStockoutRisk.toFixed(2)),
      optimizedStockoutRisk: Number(optimizedStockoutRisk.toFixed(2)),
      riskReduction: Number(((currentStockoutRisk - optimizedStockoutRisk) / Math.max(currentStockoutRisk, 0.01) * 100).toFixed(1)),
      
      // Cost impact
      additionalHoldingCost: Number(additionalHoldingCost.toFixed(2)),
      reorderPointChange: Math.round(optimizedReorderPoint) - (item.currentReorderPoint || 0),
      
      // Recommendations
      recommendation: getReorderPointRecommendation(
        item.currentReorderPoint || 0,
        optimizedReorderPoint,
        currentStockoutRisk,
        additionalHoldingCost
      ),
      
      // Implementation priority
      priority: calculateImplementationPriority(
        currentStockoutRisk - optimizedStockoutRisk,
        item.currentStock * avgDailyDemand, // Rough revenue impact
        confidence
      ),
    };
  });

  return optimizedReorderPoints.filter(item => item.avgDailyDemand > 0);
}

// ==================== UTILITY FUNCTIONS ====================

function getTurnoverHealthStatus(annualTurnover) {
  if (annualTurnover >= 12) return 'excellent';
  if (annualTurnover >= 6) return 'good';
  if (annualTurnover >= 3) return 'fair';
  if (annualTurnover >= 1) return 'poor';
  return 'critical';
}

function calculateAnnualInventoryCost(avgInventory, orderQuantity, annualDemand, holdingCostRate, orderingCost) {
  const holdingCost = avgInventory * holdingCostRate;
  const orderingCostTotal = annualDemand > 0 && orderQuantity > 0 ? (annualDemand / orderQuantity) * orderingCost : 0;
  return holdingCost + orderingCostTotal;
}

function getZScoreForServiceLevel(serviceLevel) {
  // Common Z-scores for service levels
  const zScores = {
    0.50: 0.00, 0.60: 0.25, 0.70: 0.52, 0.80: 0.84, 0.85: 1.04,
    0.90: 1.28, 0.95: 1.65, 0.97: 1.88, 0.98: 2.05, 0.99: 2.33, 0.995: 2.58
  };
  
  return zScores[serviceLevel] || 1.65; // Default to 95% service level
}

function getStockOptimizationRecommendation(currentStock, optimalReorderPoint, optimalQuantity, avgDailyDemand) {
  if (currentStock > optimalReorderPoint * 2) {
    return 'reduce_stock';
  } else if (currentStock < optimalReorderPoint * 0.5) {
    return 'increase_stock';
  } else if (Math.abs(optimalReorderPoint - currentStock) / Math.max(currentStock, 1) > 0.3) {
    return 'optimize_reorder_point';
  }
  return 'maintain_current';
}

function getABCRecommendedStrategy(abcClass) {
  switch (abcClass) {
    case 'A':
      return 'tight_control'; // Frequent monitoring, accurate forecasting, small safety stocks
    case 'B':
      return 'moderate_control'; // Periodic review, standard procedures
    case 'C':
      return 'simple_control'; // Simple procedures, large safety stocks, less frequent monitoring
    default:
      return 'review_required';
  }
}

function generateDeadStockRecommendations(stockStatus, inventoryValue, daysOfInventory, quantityOnHand, outbound90Days) {
  const recommendations = [];

  if (stockStatus === 'dead') {
    if (inventoryValue > 1000) {
      recommendations.push('liquidate_high_value');
    }
    recommendations.push('consider_disposal');
    recommendations.push('check_expiry_dates');
    recommendations.push('transfer_to_outlet');
  } else if (stockStatus === 'slow_moving') {
    if (daysOfInventory > 365) {
      recommendations.push('reduce_reorder_quantity');
    }
    recommendations.push('promotional_pricing');
    recommendations.push('bundle_with_fast_movers');
    recommendations.push('review_forecasting');
  }

  return recommendations;
}

function calculateStockoutRisk(currentStock, reorderPoint, avgDailyDemand, stdDevDemand, leadTimeDays) {
  if (avgDailyDemand === 0) return 0;
  
  const leadTimeDemand = avgDailyDemand * leadTimeDays;
  const leadTimeStdDev = stdDevDemand * Math.sqrt(leadTimeDays);
  
  if (leadTimeStdDev === 0) return currentStock < leadTimeDemand ? 1 : 0;
  
  const zScore = (currentStock - leadTimeDemand) / leadTimeStdDev;
  
  // Convert Z-score to probability (rough approximation)
  if (zScore >= 2.33) return 0.01;
  if (zScore >= 1.65) return 0.05;
  if (zScore >= 1.28) return 0.10;
  if (zScore >= 0.84) return 0.20;
  if (zScore >= 0.25) return 0.40;
  if (zScore >= -0.25) return 0.60;
  if (zScore >= -0.84) return 0.80;
  return 0.95;
}

function calculateDemandTrend(totalDemand, demandDays) {
  // Simplified trend calculation - would need more sophisticated time series analysis
  return totalDemand > 0 ? 'stable' : 'declining';
}

function getReorderPointRecommendation(currentRP, optimizedRP, currentRisk, additionalCost) {
  if (currentRisk > 0.2 && optimizedRP > currentRP) {
    return 'increase_urgently';
  } else if (currentRisk > 0.1 && optimizedRP > currentRP) {
    return 'increase_moderately';
  } else if (currentRP > optimizedRP * 1.5 && additionalCost > 100) {
    return 'decrease_to_reduce_cost';
  }
  return 'maintain_current';
}

function calculateImplementationPriority(riskReduction, revenueImpact, confidence) {
  let score = 0;
  
  if (riskReduction > 0.3) score += 3;
  else if (riskReduction > 0.1) score += 2;
  else if (riskReduction > 0.05) score += 1;
  
  if (revenueImpact > 10000) score += 3;
  else if (revenueImpact > 1000) score += 2;
  else if (revenueImpact > 100) score += 1;
  
  if (confidence === 'high') score += 2;
  else if (confidence === 'medium') score += 1;
  
  if (score >= 6) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

export default {
  calculateInventoryTurnover,
  getInventoryTurnoverTrends,
  calculateOptimalStockLevels,
  performABCAnalysis,
  identifyDeadStock,
  calculateOptimizedReorderPoints,
};
