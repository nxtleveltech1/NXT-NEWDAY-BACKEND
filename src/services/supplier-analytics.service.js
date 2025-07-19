import { db } from '../config/database.js'
import { 
  suppliers, 
  priceLists, 
  priceListItems, 
  products, 
  inventory, 
  inventoryMovements,
  uploadHistory,
  analyticsDailyAggregates,
  analyticsMonthlyAggregates 
} from '../db/schema.js'
import { eq, and, sql, desc, asc, gte, lte, between, count, avg, sum, max, min } from 'drizzle-orm'
import { 
  getSupplierLeadTimes, 
  getSupplierReorderSuggestions,
  getSupplierById 
} from '../db/supplier-queries.js'
import { getPriceListStatistics } from '../db/price-list-queries.js'

/**
 * Supplier Performance Metrics and Analytics Service
 * Provides comprehensive analytics and performance tracking for suppliers
 * including delivery performance, price stability, quality metrics, and ROI analysis
 */

// ==================== PERFORMANCE METRICS CALCULATION ====================

/**
 * Get comprehensive supplier performance dashboard
 */
export async function getSupplierPerformanceDashboard(supplierId, options = {}) {
  try {
    const {
      dateRange = 'last_90_days',
      includeComparisons = true,
      includeTrends = true,
      includeRecommendations = true
    } = options

    const dateRanges = calculateDateRanges(dateRange)
    
    // Get supplier basic info
    const supplier = await getSupplierById(supplierId)
    if (!supplier) {
      return {
        success: false,
        error: 'Supplier not found',
        message: `No supplier found with ID: ${supplierId}`
      }
    }

    // Collect all performance metrics in parallel
    const [
      deliveryPerformance,
      priceStability,
      qualityMetrics,
      inventoryImpact,
      financialMetrics,
      priceListMetrics,
      trendAnalysis
    ] = await Promise.all([
      calculateDeliveryPerformance(supplierId, dateRanges),
      calculatePriceStability(supplierId, dateRanges),
      calculateQualityMetrics(supplierId, dateRanges),
      calculateInventoryImpact(supplierId, dateRanges),
      calculateFinancialMetrics(supplierId, dateRanges),
      calculatePriceListMetrics(supplierId, dateRanges),
      includeTrends ? calculateTrendAnalysis(supplierId, dateRanges) : null
    ])

    // Calculate overall performance score
    const overallScore = calculateOverallPerformanceScore({
      deliveryPerformance,
      priceStability,
      qualityMetrics,
      inventoryImpact,
      financialMetrics
    })

    // Generate recommendations
    const recommendations = includeRecommendations 
      ? generatePerformanceRecommendations({
          supplier,
          deliveryPerformance,
          priceStability,
          qualityMetrics,
          inventoryImpact,
          overallScore
        })
      : []

    const dashboard = {
      supplier: {
        id: supplier.id,
        code: supplier.supplierCode,
        name: supplier.companyName,
        isActive: supplier.isActive
      },
      period: {
        range: dateRange,
        from: dateRanges.current.from,
        to: dateRanges.current.to
      },
      overallScore,
      metrics: {
        delivery: deliveryPerformance,
        pricing: priceStability,
        quality: qualityMetrics,
        inventory: inventoryImpact,
        financial: financialMetrics,
        priceLists: priceListMetrics
      },
      trends: trendAnalysis,
      recommendations,
      lastUpdated: new Date()
    }

    return {
      success: true,
      data: dashboard,
      message: 'Supplier performance dashboard generated successfully'
    }
  } catch (error) {
    return {
      success: false,
      error: error.message,
      message: 'Failed to generate supplier performance dashboard'
    }
  }
}

/**
 * Calculate delivery performance metrics
 */
async function calculateDeliveryPerformance(supplierId, dateRanges) {
  const deliveryData = await db
    .select({
      totalDeliveries: count(inventoryMovements.id),
      totalQuantityReceived: sum(inventoryMovements.quantity),
      totalValue: sum(inventoryMovements.totalCost),
      avgDeliveryValue: avg(inventoryMovements.totalCost),
      avgDeliveryQuantity: avg(inventoryMovements.quantity),
      lastDelivery: max(inventoryMovements.createdAt),
      firstDelivery: min(inventoryMovements.createdAt)
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .where(
      and(
        eq(products.supplierId, supplierId),
        eq(inventoryMovements.movementType, 'purchase'),
        between(
          inventoryMovements.createdAt,
          dateRanges.current.from,
          dateRanges.current.to
        )
      )
    )

  // Calculate lead time metrics
  const leadTimeQuery = await db
    .select({
      productId: products.id,
      productSku: products.sku,
      deliveryDates: sql`array_agg(${inventoryMovements.createdAt} ORDER BY ${inventoryMovements.createdAt})`,
      quantities: sql`array_agg(${inventoryMovements.quantity})`,
      costs: sql`array_agg(${inventoryMovements.totalCost})`
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .where(
      and(
        eq(products.supplierId, supplierId),
        eq(inventoryMovements.movementType, 'purchase'),
        between(
          inventoryMovements.createdAt,
          dateRanges.current.from,
          dateRanges.current.to
        )
      )
    )
    .groupBy(products.id, products.sku)

  // Calculate lead times and consistency
  const leadTimeAnalysis = calculateLeadTimeConsistency(leadTimeQuery)

  return {
    totalDeliveries: Number(deliveryData[0]?.totalDeliveries || 0),
    totalValue: Number(deliveryData[0]?.totalValue || 0),
    totalQuantity: Number(deliveryData[0]?.totalQuantityReceived || 0),
    averageOrderValue: Number(deliveryData[0]?.avgDeliveryValue || 0),
    averageOrderQuantity: Number(deliveryData[0]?.avgDeliveryQuantity || 0),
    lastDeliveryDate: deliveryData[0]?.lastDelivery,
    firstDeliveryDate: deliveryData[0]?.firstDelivery,
    leadTime: leadTimeAnalysis.averageLeadTime,
    leadTimeConsistency: leadTimeAnalysis.consistency,
    onTimeDeliveryRate: leadTimeAnalysis.onTimeRate,
    deliveryFrequency: calculateDeliveryFrequency(deliveryData[0], dateRanges.current)
  }
}

/**
 * Calculate price stability metrics
 */
async function calculatePriceStability(supplierId, dateRanges) {
  // Get price changes over time
  const priceHistory = await db
    .select({
      priceListId: priceLists.id,
      effectiveDate: priceLists.effectiveDate,
      status: priceLists.status,
      itemCount: count(priceListItems.id),
      avgPrice: avg(priceListItems.unitPrice),
      minPrice: min(priceListItems.unitPrice),
      maxPrice: max(priceListItems.unitPrice),
      totalValue: sum(sql`${priceListItems.unitPrice} * ${priceListItems.minQuantity}`)
    })
    .from(priceLists)
    .leftJoin(priceListItems, eq(priceLists.id, priceListItems.priceListId))
    .where(
      and(
        eq(priceLists.supplierId, supplierId),
        between(
          priceLists.effectiveDate,
          dateRanges.current.from,
          dateRanges.current.to
        )
      )
    )
    .groupBy(priceLists.id, priceLists.effectiveDate, priceLists.status)
    .orderBy(priceLists.effectiveDate)

  // Calculate price volatility and trends
  const priceAnalysis = analyzePriceVolatility(priceHistory)

  // Get current vs previous period comparison
  const previousPeriodPrices = await db
    .select({
      avgPrice: avg(priceListItems.unitPrice),
      itemCount: count(priceListItems.id)
    })
    .from(priceLists)
    .leftJoin(priceListItems, eq(priceLists.id, priceListItems.priceListId))
    .where(
      and(
        eq(priceLists.supplierId, supplierId),
        eq(priceLists.status, 'active'),
        between(
          priceLists.effectiveDate,
          dateRanges.previous.from,
          dateRanges.previous.to
        )
      )
    )

  return {
    priceListUpdates: priceHistory.length,
    averagePriceChange: priceAnalysis.averageChange,
    priceVolatility: priceAnalysis.volatility,
    priceStabilityScore: priceAnalysis.stabilityScore,
    inflationImpact: priceAnalysis.inflationAdjusted,
    priceChangeFrequency: priceHistory.length / (dateRanges.current.days || 90),
    currentVsPreviousPeriod: {
      priceChange: calculatePriceChange(priceHistory, previousPeriodPrices[0]),
      itemCountChange: (priceHistory[priceHistory.length - 1]?.itemCount || 0) - (previousPeriodPrices[0]?.itemCount || 0)
    },
    trendDirection: priceAnalysis.trendDirection
  }
}

/**
 * Calculate quality metrics
 */
async function calculateQualityMetrics(supplierId, dateRanges) {
  // In a full implementation, this would include quality data from various sources
  // For now, we'll use inventory movements and return patterns as proxies
  
  const qualityIndicators = await db
    .select({
      totalReceipts: count(sql`CASE WHEN ${inventoryMovements.movementType} = 'purchase' THEN 1 END`),
      totalReturns: count(sql`CASE WHEN ${inventoryMovements.movementType} = 'return' THEN 1 END`),
      totalDamage: count(sql`CASE WHEN ${inventoryMovements.movementType} = 'damage' THEN 1 END`),
      totalExpiry: count(sql`CASE WHEN ${inventoryMovements.movementType} = 'expiry' THEN 1 END`),
      totalAdjustments: count(sql`CASE WHEN ${inventoryMovements.movementType} = 'adjustment' THEN 1 END`)
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .where(
      and(
        eq(products.supplierId, supplierId),
        between(
          inventoryMovements.createdAt,
          dateRanges.current.from,
          dateRanges.current.to
        )
      )
    )

  const indicators = qualityIndicators[0] || {}
  const totalReceipts = Number(indicators.totalReceipts || 0)
  
  return {
    returnRate: totalReceipts > 0 ? (Number(indicators.totalReturns || 0) / totalReceipts) * 100 : 0,
    damageRate: totalReceipts > 0 ? (Number(indicators.totalDamage || 0) / totalReceipts) * 100 : 0,
    expiryRate: totalReceipts > 0 ? (Number(indicators.totalExpiry || 0) / totalReceipts) * 100 : 0,
    adjustmentRate: totalReceipts > 0 ? (Number(indicators.totalAdjustments || 0) / totalReceipts) * 100 : 0,
    qualityScore: calculateQualityScore(indicators, totalReceipts),
    totalIssues: Number(indicators.totalReturns || 0) + Number(indicators.totalDamage || 0) + Number(indicators.totalExpiry || 0),
    totalReceipts
  }
}

/**
 * Calculate inventory impact metrics
 */
async function calculateInventoryImpact(supplierId, dateRanges) {
  // Get current inventory levels for supplier products
  const inventoryData = await db
    .select({
      totalProducts: count(sql`DISTINCT ${products.id}`),
      totalOnHand: sum(inventory.quantityOnHand),
      totalValue: sum(sql`${inventory.quantityOnHand} * ${inventory.averageCost}`),
      avgTurnover: avg(sql`CASE WHEN ${inventory.averageCost} > 0 THEN ${inventory.quantityOnHand} * ${inventory.averageCost} ELSE 0 END`),
      lowStockItems: count(sql`CASE WHEN ${inventory.quantityOnHand} <= ${inventory.reorderPoint} THEN 1 END`),
      outOfStockItems: count(sql`CASE WHEN ${inventory.quantityOnHand} = 0 THEN 1 END`)
    })
    .from(products)
    .leftJoin(inventory, eq(products.id, inventory.productId))
    .where(eq(products.supplierId, supplierId))

  // Get reorder suggestions
  const reorderSuggestions = await getSupplierReorderSuggestions(supplierId)

  const data = inventoryData[0] || {}
  
  return {
    totalProducts: Number(data.totalProducts || 0),
    totalInventoryValue: Number(data.totalValue || 0),
    totalUnitsOnHand: Number(data.totalOnHand || 0),
    lowStockItems: Number(data.lowStockItems || 0),
    outOfStockItems: Number(data.outOfStockItems || 0),
    reorderRequiredItems: reorderSuggestions.length,
    stockAvailabilityRate: data.totalProducts > 0 
      ? ((Number(data.totalProducts) - Number(data.outOfStockItems || 0)) / Number(data.totalProducts)) * 100 
      : 100,
    inventoryTurnover: calculateInventoryTurnover(data, dateRanges),
    serviceLevel: calculateServiceLevel(data)
  }
}

/**
 * Calculate financial metrics
 */
async function calculateFinancialMetrics(supplierId, dateRanges) {
  const financialData = await db
    .select({
      totalPurchaseValue: sum(inventoryMovements.totalCost),
      totalPurchaseQuantity: sum(inventoryMovements.quantity),
      avgPurchaseValue: avg(inventoryMovements.totalCost),
      maxSinglePurchase: max(inventoryMovements.totalCost),
      purchaseCount: count(inventoryMovements.id)
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .where(
      and(
        eq(products.supplierId, supplierId),
        eq(inventoryMovements.movementType, 'purchase'),
        between(
          inventoryMovements.createdAt,
          dateRanges.current.from,
          dateRanges.current.to
        )
      )
    )

  // Get previous period for comparison
  const previousPeriodData = await db
    .select({
      totalPurchaseValue: sum(inventoryMovements.totalCost),
      purchaseCount: count(inventoryMovements.id)
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .where(
      and(
        eq(products.supplierId, supplierId),
        eq(inventoryMovements.movementType, 'purchase'),
        between(
          inventoryMovements.createdAt,
          dateRanges.previous.from,
          dateRanges.previous.to
        )
      )
    )

  const current = financialData[0] || {}
  const previous = previousPeriodData[0] || {}
  
  return {
    totalSpend: Number(current.totalPurchaseValue || 0),
    averageOrderValue: Number(current.avgPurchaseValue || 0),
    largestOrder: Number(current.maxSinglePurchase || 0),
    totalOrders: Number(current.purchaseCount || 0),
    spendGrowth: calculateGrowthRate(
      Number(current.totalPurchaseValue || 0),
      Number(previous.totalPurchaseValue || 0)
    ),
    orderFrequency: Number(current.purchaseCount || 0) / (dateRanges.current.days || 90),
    costPerUnit: current.totalPurchaseQuantity > 0 
      ? Number(current.totalPurchaseValue || 0) / Number(current.totalPurchaseQuantity || 1)
      : 0
  }
}

/**
 * Calculate price list performance metrics
 */
async function calculatePriceListMetrics(supplierId, dateRanges) {
  const stats = await getPriceListStatistics(supplierId)
  
  // Get upload success rate
  const uploadStats = await db
    .select({
      totalUploads: count(uploadHistory.id),
      successfulUploads: count(sql`CASE WHEN ${uploadHistory.status} = 'completed' THEN 1 END`),
      failedUploads: count(sql`CASE WHEN ${uploadHistory.status} = 'failed' THEN 1 END`),
      avgProcessingTime: avg(sql`EXTRACT(EPOCH FROM (${uploadHistory.completedAt} - ${uploadHistory.uploadDate}))`),
      totalErrors: sum(uploadHistory.errorCount)
    })
    .from(uploadHistory)
    .where(
      and(
        eq(uploadHistory.supplierId, supplierId),
        between(
          uploadHistory.uploadDate,
          dateRanges.current.from,
          dateRanges.current.to
        )
      )
    )

  const uploads = uploadStats[0] || {}
  
  return {
    ...stats,
    uploadSuccessRate: Number(uploads.totalUploads || 0) > 0 
      ? (Number(uploads.successfulUploads || 0) / Number(uploads.totalUploads || 0)) * 100 
      : 100,
    averageProcessingTime: Number(uploads.avgProcessingTime || 0),
    totalUploadErrors: Number(uploads.totalErrors || 0),
    priceListHealthScore: calculatePriceListHealthScore(stats, uploads)
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Calculate date ranges for analysis
 */
function calculateDateRanges(dateRange) {
  const now = new Date()
  let days = 90

  switch (dateRange) {
    case 'last_30_days':
      days = 30
      break
    case 'last_60_days':
      days = 60
      break
    case 'last_90_days':
      days = 90
      break
    case 'last_180_days':
      days = 180
      break
    case 'last_year':
      days = 365
      break
  }

  const current = {
    from: new Date(now.getTime() - days * 24 * 60 * 60 * 1000),
    to: now,
    days
  }

  const previous = {
    from: new Date(current.from.getTime() - days * 24 * 60 * 60 * 1000),
    to: current.from,
    days
  }

  return { current, previous }
}

/**
 * Calculate overall performance score
 */
function calculateOverallPerformanceScore(metrics) {
  const weights = {
    delivery: 0.25,
    pricing: 0.20,
    quality: 0.25,
    inventory: 0.15,
    financial: 0.15
  }

  // Calculate individual scores (0-100)
  const scores = {
    delivery: calculateDeliveryScore(metrics.deliveryPerformance),
    pricing: calculatePricingScore(metrics.priceStability),
    quality: calculateQualityScoreFromMetrics(metrics.qualityMetrics),
    inventory: calculateInventoryScore(metrics.inventoryImpact),
    financial: calculateFinancialScore(metrics.financialMetrics)
  }

  // Calculate weighted average
  const overallScore = Object.keys(weights).reduce((acc, key) => {
    return acc + (scores[key] * weights[key])
  }, 0)

  return {
    overall: Math.round(overallScore),
    breakdown: scores,
    weights,
    grade: getPerformanceGrade(overallScore)
  }
}

/**
 * Generate performance recommendations
 */
function generatePerformanceRecommendations(data) {
  const recommendations = []

  // Delivery performance recommendations
  if (data.deliveryPerformance.onTimeDeliveryRate < 90) {
    recommendations.push({
      category: 'delivery',
      priority: 'high',
      title: 'Improve Delivery Performance',
      description: `On-time delivery rate is ${data.deliveryPerformance.onTimeDeliveryRate.toFixed(1)}%. Consider discussing delivery schedules with supplier.`,
      actionItems: [
        'Review delivery commitments with supplier',
        'Implement delivery performance tracking',
        'Consider alternative logistics arrangements'
      ]
    })
  }

  // Quality recommendations
  if (data.qualityMetrics.returnRate > 5) {
    recommendations.push({
      category: 'quality',
      priority: 'high',
      title: 'Address Quality Issues',
      description: `Return rate of ${data.qualityMetrics.returnRate.toFixed(1)}% indicates quality concerns.`,
      actionItems: [
        'Conduct quality audit with supplier',
        'Implement incoming inspection process',
        'Review supplier quality certifications'
      ]
    })
  }

  // Inventory recommendations
  if (data.inventoryImpact.stockAvailabilityRate < 95) {
    recommendations.push({
      category: 'inventory',
      priority: 'medium',
      title: 'Improve Stock Availability',
      description: `Stock availability is ${data.inventoryImpact.stockAvailabilityRate.toFixed(1)}%. Review reorder points and lead times.`,
      actionItems: [
        'Adjust reorder points for key items',
        'Implement demand forecasting',
        'Consider vendor-managed inventory'
      ]
    })
  }

  return recommendations
}

// Additional helper functions for score calculations
function calculateDeliveryScore(metrics) {
  let score = 100
  if (metrics.onTimeDeliveryRate < 95) score -= 20
  if (metrics.leadTimeConsistency < 80) score -= 15
  if (metrics.deliveryFrequency < 0.1) score -= 10
  return Math.max(0, score)
}

function calculatePricingScore(metrics) {
  let score = 100
  if (metrics.priceVolatility > 20) score -= 25
  if (metrics.priceStabilityScore < 80) score -= 15
  return Math.max(0, score)
}

function calculateQualityScoreFromMetrics(metrics) {
  let score = 100
  score -= metrics.returnRate * 5
  score -= metrics.damageRate * 10
  score -= metrics.expiryRate * 8
  return Math.max(0, score)
}

function calculateInventoryScore(metrics) {
  let score = 100
  if (metrics.stockAvailabilityRate < 95) score -= 20
  if (metrics.reorderRequiredItems > 10) score -= 15
  return Math.max(0, score)
}

function calculateFinancialScore(metrics) {
  let score = 100
  if (metrics.spendGrowth < -10) score -= 15
  if (metrics.orderFrequency < 0.1) score -= 10
  return Math.max(0, score)
}

function getPerformanceGrade(score) {
  if (score >= 90) return 'A'
  if (score >= 80) return 'B'
  if (score >= 70) return 'C'
  if (score >= 60) return 'D'
  return 'F'
}

// Placeholder implementations for complex calculations
function calculateLeadTimeConsistency(leadTimeQuery) {
  return {
    averageLeadTime: 14,
    consistency: 85,
    onTimeRate: 92
  }
}

function calculateDeliveryFrequency(data, period) {
  return Number(data?.totalDeliveries || 0) / (period.days || 90)
}

function analyzePriceVolatility(priceHistory) {
  return {
    averageChange: 5.2,
    volatility: 12.5,
    stabilityScore: 85,
    inflationAdjusted: 3.1,
    trendDirection: 'stable'
  }
}

function calculatePriceChange(current, previous) {
  if (!previous?.avgPrice || !current.length) return 0
  const latestPrice = current[current.length - 1]?.avgPrice || 0
  return ((latestPrice - Number(previous.avgPrice)) / Number(previous.avgPrice)) * 100
}

function calculateQualityScore(indicators, totalReceipts) {
  if (!totalReceipts) return 100
  const issueRate = ((Number(indicators.totalReturns || 0) + Number(indicators.totalDamage || 0)) / totalReceipts) * 100
  return Math.max(0, 100 - issueRate * 5)
}

function calculateInventoryTurnover(data, dateRanges) {
  return 4.2 // Placeholder
}

function calculateServiceLevel(data) {
  return 95.5 // Placeholder
}

function calculateGrowthRate(current, previous) {
  if (!previous || previous === 0) return current > 0 ? 100 : 0
  return ((current - previous) / previous) * 100
}

function calculatePriceListHealthScore(stats, uploads) {
  let score = 100
  if (Number(stats.pendingPriceLists || 0) > 2) score -= 20
  if (Number(uploads.uploadSuccessRate || 100) < 90) score -= 15
  return Math.max(0, score)
}

function calculateTrendAnalysis(supplierId, dateRanges) {
  // Placeholder for trend analysis
  return {
    deliveryTrend: 'improving',
    priceTrend: 'stable',
    qualityTrend: 'stable',
    volumeTrend: 'increasing'
  }
}

export default {
  getSupplierPerformanceDashboard
}