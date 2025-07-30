import { db } from '../config/database.js';
import { inventory, inventoryMovements, products, suppliers, orders, orderItems, orderAllocations, priceLists, priceListItems } from '../db/schema.js';
import { eq, and, sql, desc, inArray, gte, pgTable, uuid, varchar, integer, timestamp, decimal, text } from 'drizzle-orm';
import { recordMovement, reserveStock, releaseReservedStock } from '../db/inventory-queries.js';
import { realtimeService } from './realtime-service.js';

/**
 * Stock Allocation Service
 * Manages intelligent stock allocation, supplier performance tracking,
 * and reorder suggestions
 */

// ==================== STOCK ALLOCATION ====================

/**
 * Allocate stock to customer orders with supplier preferences
 */
export async function allocateStockToOrder(orderId, preferredSupplierIds = []) {
  return await db.transaction(async (tx) => {
    // Get order items
    const items = await tx
      .select({
        id: orderItems.id,
        productId: orderItems.productId,
        quantity: orderItems.quantity,
        unitPrice: orderItems.unitPrice
      })
      .from(orderItems)
      .where(eq(orderItems.orderId, orderId));

    if (items.length === 0) {
      throw new Error('No items found for order');
    }

    const allocations = [];
    const shortages = [];

    for (const item of items) {
      // Find available inventory with supplier information
      let inventoryQuery = tx
        .select({
          inventoryId: inventory.id,
          productId: inventory.productId,
          warehouseId: inventory.warehouseId,
          locationId: inventory.locationId,
          quantityAvailable: inventory.quantityAvailable,
          averageCost: inventory.averageCost,
          supplierId: products.supplierId,
          supplierName: suppliers.companyName,
          supplierCode: suppliers.supplierCode,
          leadTimeDays: suppliers.leadTimeDays
        })
        .from(inventory)
        .innerJoin(products, eq(inventory.productId, products.id))
        .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
        .where(
          and(
            eq(inventory.productId, item.productId),
            sql`${inventory.quantityAvailable} > 0`
          )
        );

      // Apply supplier preference if provided
      if (preferredSupplierIds.length > 0) {
        inventoryQuery = inventoryQuery.where(
          inArray(products.supplierId, preferredSupplierIds)
        );
      }

      const availableInventory = await inventoryQuery
        .orderBy(
          // Prioritize by supplier preference, then by available quantity
          sql`
            CASE 
              WHEN ${products.supplierId} = ANY(${preferredSupplierIds}) THEN 0 
              ELSE 1 
            END,
            ${inventory.quantityAvailable} DESC
          `
        );

      let remainingQuantity = item.quantity;
      const itemAllocations = [];

      // Allocate from available inventory using FIFO within supplier preference
      for (const inv of availableInventory) {
        if (remainingQuantity <= 0) break;

        const allocateQty = Math.min(remainingQuantity, inv.quantityAvailable);

        // Reserve the stock
        await tx
          .update(inventory)
          .set({
            quantityAvailable: sql`${inventory.quantityAvailable} - ${allocateQty}`,
            quantityReserved: sql`${inventory.quantityReserved} + ${allocateQty}`,
            updatedAt: new Date()
          })
          .where(eq(inventory.id, inv.inventoryId));

        // Create allocation record
        const allocation = {
          orderId,
          orderItemId: item.id,
          inventoryId: inv.inventoryId,
          productId: inv.productId,
          warehouseId: inv.warehouseId,
          locationId: inv.locationId,
          supplierId: inv.supplierId,
          supplierName: inv.supplierName,
          supplierCode: inv.supplierCode,
          quantity: allocateQty,
          unitCost: inv.averageCost,
          totalCost: allocateQty * inv.averageCost,
          status: 'reserved',
          allocatedAt: new Date()
        };

        itemAllocations.push(allocation);
        remainingQuantity -= allocateQty;
      }

      // Track shortages if any
      if (remainingQuantity > 0) {
        shortages.push({
          orderItemId: item.id,
          productId: item.productId,
          requestedQuantity: item.quantity,
          allocatedQuantity: item.quantity - remainingQuantity,
          shortageQuantity: remainingQuantity,
          status: 'partial_allocation'
        });

        // Notify about shortage
        await realtimeService.notifyStockAlert({
          orderId,
          productId: item.productId,
          shortageQuantity: remainingQuantity,
          alertType: 'allocation_shortage',
          priority: 'high',
          message: `Unable to fully allocate order ${orderId}. Short by ${remainingQuantity} units.`
        });
      }

      allocations.push(...itemAllocations);
    }

    // Store allocation details in database
    if (allocations.length > 0) {
      await tx.insert(orderAllocations).values(allocations);
    }

    return {
      orderId,
      allocations,
      shortages,
      fullyAllocated: shortages.length === 0,
      totalAllocated: allocations.reduce((sum, a) => sum + a.quantity, 0),
      totalCost: allocations.reduce((sum, a) => sum + a.totalCost, 0)
    };
  });
}

/**
 * Release allocated stock (e.g., when order is cancelled)
 */
export async function releaseOrderAllocations(orderId) {
  return await db.transaction(async (tx) => {
    // Get all allocations for the order
    const allocations = await tx
      .select()
      .from(orderAllocations)
      .where(eq(orderAllocations.orderId, orderId));

    const releasedItems = [];

    for (const allocation of allocations) {
      // Release the reserved stock
      await tx
        .update(inventory)
        .set({
          quantityAvailable: sql`${inventory.quantityAvailable} + ${allocation.quantity}`,
          quantityReserved: sql`${inventory.quantityReserved} - ${allocation.quantity}`,
          updatedAt: new Date()
        })
        .where(eq(inventory.id, allocation.inventoryId));

      // Update allocation status
      await tx
        .update(orderAllocations)
        .set({
          status: 'released',
          releasedAt: new Date()
        })
        .where(eq(orderAllocations.id, allocation.id));

      releasedItems.push({
        inventoryId: allocation.inventoryId,
        productId: allocation.productId,
        quantity: allocation.quantity
      });
    }

    return {
      orderId,
      releasedCount: releasedItems.length,
      releasedItems
    };
  });
}

// ==================== SUPPLIER PERFORMANCE TRACKING ====================

/**
 * Track supplier performance metrics based on allocations and deliveries
 */
export async function trackSupplierPerformance(supplierId, dateRange = {}) {
  const { startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), endDate = new Date() } = dateRange;

  // Get allocation metrics
  const allocationMetrics = await db
    .select({
      totalAllocations: sql`COUNT(*)`,
      totalQuantityAllocated: sql`SUM(${orderAllocations.quantity})`,
      totalValueAllocated: sql`SUM(${orderAllocations.totalCost})`,
      uniqueOrders: sql`COUNT(DISTINCT ${orderAllocations.orderId})`,
      avgAllocationSize: sql`AVG(${orderAllocations.quantity})`,
      
      // Fulfillment metrics
      fulfilledCount: sql`COUNT(CASE WHEN ${orderAllocations.status} = 'fulfilled' THEN 1 END)`,
      partialCount: sql`COUNT(CASE WHEN ${orderAllocations.status} = 'partial' THEN 1 END)`,
      cancelledCount: sql`COUNT(CASE WHEN ${orderAllocations.status} = 'cancelled' THEN 1 END)`,
      
      // Timing metrics
      avgFulfillmentDays: sql`
        AVG(
          CASE 
            WHEN ${orderAllocations.fulfilledAt} IS NOT NULL 
            THEN EXTRACT(days FROM ${orderAllocations.fulfilledAt} - ${orderAllocations.allocatedAt})
            ELSE NULL
          END
        )
      `
    })
    .from(orderAllocations)
    .where(
      and(
        eq(orderAllocations.supplierId, supplierId),
        gte(orderAllocations.allocatedAt, startDate),
        sql`${orderAllocations.allocatedAt} <= ${endDate}`
      )
    );

  // Get quality metrics from movements
  const qualityMetrics = await db
    .select({
      totalReturns: sql`COUNT(CASE WHEN ${inventoryMovements.movementType} = 'return_to_supplier' THEN 1 END)`,
      returnQuantity: sql`ABS(SUM(CASE WHEN ${inventoryMovements.movementType} = 'return_to_supplier' THEN ${inventoryMovements.quantity} ELSE 0 END))`,
      defectiveUnits: sql`
        SUM(
          CASE 
            WHEN ${inventoryMovements.notes} LIKE '%defect%' 
              OR ${inventoryMovements.notes} LIKE '%quality%' 
            THEN ABS(${inventoryMovements.quantity})
            ELSE 0 
          END
        )
      `
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .where(
      and(
        eq(products.supplierId, supplierId),
        gte(inventoryMovements.createdAt, startDate),
        sql`${inventoryMovements.createdAt} <= ${endDate}`
      )
    );

  // Calculate performance scores
  const allocMetrics = allocationMetrics[0];
  const qualMetrics = qualityMetrics[0];

  const fulfillmentRate = allocMetrics.totalAllocations > 0 ?
    (allocMetrics.fulfilledCount / allocMetrics.totalAllocations) * 100 : 0;

  const qualityScore = allocMetrics.totalQuantityAllocated > 0 ?
    100 - ((qualMetrics.returnQuantity / allocMetrics.totalQuantityAllocated) * 100) : 100;

  const reliabilityScore = calculateReliabilityScore(
    fulfillmentRate,
    allocMetrics.avgFulfillmentDays,
    qualityScore
  );

  return {
    supplierId,
    dateRange: { startDate, endDate },
    allocation: {
      totalAllocations: Number(allocMetrics.totalAllocations),
      totalQuantity: Number(allocMetrics.totalQuantityAllocated),
      totalValue: Number(allocMetrics.totalValueAllocated),
      uniqueOrders: Number(allocMetrics.uniqueOrders),
      avgAllocationSize: Number(allocMetrics.avgAllocationSize)
    },
    fulfillment: {
      fulfillmentRate,
      fulfilledCount: Number(allocMetrics.fulfilledCount),
      partialCount: Number(allocMetrics.partialCount),
      cancelledCount: Number(allocMetrics.cancelledCount),
      avgFulfillmentDays: Number(allocMetrics.avgFulfillmentDays)
    },
    quality: {
      qualityScore,
      totalReturns: Number(qualMetrics.totalReturns),
      returnQuantity: Number(qualMetrics.returnQuantity),
      defectiveUnits: Number(qualMetrics.defectiveUnits)
    },
    overallScore: {
      reliabilityScore,
      rating: getSupplierRating(reliabilityScore)
    }
  };
}

/**
 * Calculate supplier reliability score
 */
function calculateReliabilityScore(fulfillmentRate, avgFulfillmentDays, qualityScore) {
  // Weights for different factors
  const weights = {
    fulfillment: 0.4,
    speed: 0.3,
    quality: 0.3
  };

  // Speed score (assuming 7 days is ideal, 14 days is acceptable)
  const speedScore = avgFulfillmentDays ?
    Math.max(0, 100 - ((avgFulfillmentDays - 7) * 5)) : 50;

  return (
    fulfillmentRate * weights.fulfillment +
    speedScore * weights.speed +
    qualityScore * weights.quality
  );
}

/**
 * Get supplier rating based on score
 */
function getSupplierRating(score) {
  if (score >= 90) return 'Excellent';
  if (score >= 80) return 'Good';
  if (score >= 70) return 'Fair';
  if (score >= 60) return 'Poor';
  return 'Critical';
}

// ==================== REORDER SUGGESTIONS ====================

/**
 * Generate intelligent reorder suggestions
 */
export async function generateReorderSuggestions(options = {}) {
  const {
    includeForecasting = true,
    leadTimeBuffer = 1.2, // 20% buffer on lead times
    safetyStockMultiplier = 1.5
  } = options;

  // Get items below reorder point with supplier info
  const lowStockItems = await db
    .select({
      inventoryId: inventory.id,
      productId: products.id,
      productSku: products.sku,
      productName: products.name,
      supplierId: suppliers.id,
      supplierName: suppliers.companyName,
      supplierCode: suppliers.supplierCode,
      leadTimeDays: suppliers.leadTimeDays,
      
      // Stock levels
      currentStock: inventory.quantityOnHand,
      availableStock: inventory.quantityAvailable,
      reservedStock: inventory.quantityReserved,
      reorderPoint: inventory.reorderPoint,
      reorderQuantity: inventory.reorderQuantity,
      
      // Costs
      averageCost: inventory.averageCost,
      lastPurchaseCost: inventory.lastPurchaseCost,
      
      // Calculated fields
      stockShortage: sql`${inventory.reorderPoint} - ${inventory.quantityAvailable}`,
      urgencyScore: sql`
        CASE
          WHEN ${inventory.quantityAvailable} = 0 THEN 100
          WHEN ${inventory.quantityAvailable} < ${inventory.minStockLevel} THEN 90
          WHEN ${inventory.quantityAvailable} <= ${inventory.reorderPoint} THEN 70
          ELSE 50
        END
      `
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .innerJoin(suppliers, eq(products.supplierId, suppliers.id))
    .where(
      and(
        sql`${inventory.quantityAvailable} <= ${inventory.reorderPoint}`,
        eq(products.isActive, true),
        eq(suppliers.isActive, true)
      )
    )
    .orderBy(desc(sql`urgencyScore`));

  const suggestions = [];

  for (const item of lowStockItems) {
    // Get average daily usage from recent movements
    const usage = await calculateAverageDailyUsage(item.productId);
    
    // Calculate days of stock remaining
    const daysOfStock = usage > 0 ? item.availableStock / usage : null;
    
    // Adjusted lead time with buffer
    const adjustedLeadTime = Math.ceil(item.leadTimeDays * leadTimeBuffer);
    
    // Calculate suggested order quantity
    let suggestedQuantity = item.reorderQuantity || item.stockShortage;
    
    if (includeForecasting && usage > 0) {
      // Forecast demand during lead time + safety stock
      const leadTimeDemand = usage * adjustedLeadTime;
      const safetyStock = usage * adjustedLeadTime * (safetyStockMultiplier - 1);
      suggestedQuantity = Math.max(
        suggestedQuantity,
        Math.ceil(leadTimeDemand + safetyStock - item.currentStock)
      );
    }

    // Get supplier MOQ from price list
    const moq = await getSupplierMOQ(item.productSku, item.supplierId);
    if (moq && suggestedQuantity < moq) {
      suggestedQuantity = moq;
    }

    // Estimate costs
    const unitCost = item.lastPurchaseCost || item.averageCost;
    const estimatedCost = suggestedQuantity * unitCost;

    suggestions.push({
      // Product info
      productId: item.productId,
      productSku: item.productSku,
      productName: item.productName,
      
      // Supplier info
      supplierId: item.supplierId,
      supplierName: item.supplierName,
      supplierCode: item.supplierCode,
      
      // Stock levels
      currentStock: item.currentStock,
      availableStock: item.availableStock,
      reorderPoint: item.reorderPoint,
      stockShortage: item.stockShortage,
      
      // Usage and forecasting
      avgDailyUsage: usage,
      daysOfStock,
      leadTimeDays: item.leadTimeDays,
      adjustedLeadTime,
      
      // Suggestions
      suggestedQuantity,
      moq,
      estimatedCost,
      urgencyScore: item.urgencyScore,
      urgencyLevel: getUrgencyLevel(item.urgencyScore),
      
      // Timing
      orderByDate: daysOfStock !== null ? 
        new Date(Date.now() + (daysOfStock - adjustedLeadTime) * 24 * 60 * 60 * 1000) : 
        new Date(),
      expectedDelivery: new Date(Date.now() + adjustedLeadTime * 24 * 60 * 60 * 1000)
    });
  }

  // Group by supplier for batch ordering
  const groupedBySupplie = suggestions.reduce((acc, suggestion) => {
    const key = suggestion.supplierId;
    if (!acc[key]) {
      acc[key] = {
        supplierId: suggestion.supplierId,
        supplierName: suggestion.supplierName,
        supplierCode: suggestion.supplierCode,
        items: [],
        totalItems: 0,
        totalQuantity: 0,
        totalEstimatedCost: 0,
        maxUrgencyScore: 0
      };
    }
    
    acc[key].items.push(suggestion);
    acc[key].totalItems++;
    acc[key].totalQuantity += suggestion.suggestedQuantity;
    acc[key].totalEstimatedCost += suggestion.estimatedCost;
    acc[key].maxUrgencyScore = Math.max(acc[key].maxUrgencyScore, suggestion.urgencyScore);
    
    return acc;
  }, {});

  return {
    suggestions,
    groupedBySupplier: Object.values(groupedBySupplie),
    summary: {
      totalItems: suggestions.length,
      criticalItems: suggestions.filter(s => s.urgencyScore >= 90).length,
      highPriorityItems: suggestions.filter(s => s.urgencyScore >= 70).length,
      totalEstimatedCost: suggestions.reduce((sum, s) => sum + s.estimatedCost, 0),
      suppliersAffected: Object.keys(groupedBySupplie).length
    }
  };
}

/**
 * Calculate average daily usage from movements
 */
async function calculateAverageDailyUsage(productId, days = 30) {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  
  const usage = await db
    .select({
      totalUsage: sql`SUM(ABS(${inventoryMovements.quantity}))`,
      daysWithMovement: sql`COUNT(DISTINCT DATE(${inventoryMovements.createdAt}))`
    })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.productId, productId),
        inArray(inventoryMovements.movementType, ['sale', 'adjustment_out']),
        gte(inventoryMovements.createdAt, startDate)
      )
    );

  const totalUsage = Number(usage[0]?.totalUsage || 0);
  return totalUsage / days;
}

/**
 * Get supplier MOQ for a product
 */
async function getSupplierMOQ(productSku, supplierId) {
  const result = await db
    .select({ moq: priceListItems.moq })
    .from(priceListItems)
    .innerJoin(priceLists, eq(priceListItems.priceListId, priceLists.id))
    .where(
      and(
        eq(priceListItems.sku, productSku),
        eq(priceLists.supplierId, supplierId),
        eq(priceLists.status, 'active')
      )
    )
    .limit(1);

  return result[0]?.moq || null;
}

/**
 * Get urgency level from score
 */
function getUrgencyLevel(score) {
  if (score >= 90) return 'Critical';
  if (score >= 70) return 'High';
  if (score >= 50) return 'Medium';
  return 'Low';
}

// ==================== ALLOCATION OPTIMIZATION ====================

/**
 * Optimize allocations across multiple orders
 */
export async function optimizeMultiOrderAllocations(orderIds, options = {}) {
  const {
    priorityWeight = 0.4,
    customerWeight = 0.3,
    profitWeight = 0.3
  } = options;

  // Get all pending orders with items
  const ordersWithItems = await db
    .select({
      orderId: orders.id,
      orderNumber: orders.orderNumber,
      customerId: orders.customerId,
      priority: orders.priority,
      orderDate: orders.createdAt,
      
      itemId: orderItems.id,
      productId: orderItems.productId,
      quantity: orderItems.quantity,
      unitPrice: orderItems.unitPrice
    })
    .from(orders)
    .innerJoin(orderItems, eq(orders.id, orderItems.orderId))
    .where(
      and(
        inArray(orders.id, orderIds),
        eq(orders.status, 'pending')
      )
    );

  // Group by product to see total demand
  const productDemand = ordersWithItems.reduce((acc, item) => {
    if (!acc[item.productId]) {
      acc[item.productId] = {
        productId: item.productId,
        totalDemand: 0,
        orders: []
      };
    }
    
    acc[item.productId].totalDemand += item.quantity;
    acc[item.productId].orders.push({
      orderId: item.orderId,
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      priority: item.priority
    });
    
    return acc;
  }, {});

  // Check available inventory for each product
  const allocationPlan = [];

  for (const [productId, demand] of Object.entries(productDemand)) {
    const availableStock = await db
      .select({
        inventoryId: inventory.id,
        quantityAvailable: inventory.quantityAvailable,
        averageCost: inventory.averageCost
      })
      .from(inventory)
      .where(
        and(
          eq(inventory.productId, productId),
          sql`${inventory.quantityAvailable} > 0`
        )
      )
      .orderBy(desc(inventory.quantityAvailable));

    const totalAvailable = availableStock.reduce((sum, inv) => sum + inv.quantityAvailable, 0);

    if (totalAvailable >= demand.totalDemand) {
      // Enough stock - allocate to all orders
      for (const order of demand.orders) {
        allocationPlan.push({
          orderId: order.orderId,
          productId,
          quantity: order.quantity,
          status: 'full_allocation'
        });
      }
    } else {
      // Not enough stock - optimize allocation
      const optimizedAllocations = optimizeScarcityAllocation(
        demand.orders,
        totalAvailable,
        { priorityWeight, customerWeight, profitWeight }
      );
      
      allocationPlan.push(...optimizedAllocations);
    }
  }

  return {
    allocationPlan,
    summary: {
      totalOrders: orderIds.length,
      fullyAllocated: allocationPlan.filter(a => a.status === 'full_allocation').length,
      partiallyAllocated: allocationPlan.filter(a => a.status === 'partial_allocation').length,
      notAllocated: allocationPlan.filter(a => a.status === 'no_allocation').length
    }
  };
}

/**
 * Optimize allocation when stock is scarce
 */
function optimizeScarcityAllocation(orders, availableQuantity, weights) {
  // Calculate score for each order
  const scoredOrders = orders.map(order => {
    const priorityScore = order.priority === 'high' ? 100 : order.priority === 'medium' ? 50 : 0;
    const profitScore = order.unitPrice; // Simple profit proxy
    const customerScore = 50; // Would need customer value data
    
    const totalScore = 
      priorityScore * weights.priorityWeight +
      profitScore * weights.profitWeight +
      customerScore * weights.customerWeight;
    
    return { ...order, score: totalScore };
  });

  // Sort by score
  scoredOrders.sort((a, b) => b.score - a.score);

  // Allocate based on scores
  const allocations = [];
  let remaining = availableQuantity;

  for (const order of scoredOrders) {
    if (remaining <= 0) {
      allocations.push({
        orderId: order.orderId,
        productId: order.productId,
        quantity: 0,
        requestedQuantity: order.quantity,
        status: 'no_allocation'
      });
      continue;
    }

    const allocateQty = Math.min(order.quantity, remaining);
    allocations.push({
      orderId: order.orderId,
      productId: order.productId,
      quantity: allocateQty,
      requestedQuantity: order.quantity,
      status: allocateQty === order.quantity ? 'full_allocation' : 'partial_allocation'
    });
    
    remaining -= allocateQty;
  }

  return allocations;
}