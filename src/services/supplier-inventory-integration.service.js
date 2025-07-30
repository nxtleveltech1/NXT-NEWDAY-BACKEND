import { db } from '../config/database.js';
import { inventory, inventoryMovements, products, suppliers, priceLists, priceListItems } from '../db/schema.js';
import { eq, and, sql, inArray } from 'drizzle-orm';
import { recordMovement } from '../db/inventory-queries.js';
import { realtimeService } from './realtime-service.js';

/**
 * Supplier-Inventory Integration Service
 * Handles the integration between supplier data and inventory management
 */

// ==================== PRICE LIST ACTIVATION ====================

/**
 * Update inventory costs when a price list is activated
 * This updates the average cost and last purchase cost for affected products
 */
export async function updateInventoryCostsFromPriceList(priceListId) {
  return await db.transaction(async (tx) => {
    // Get price list details
    const priceList = await tx
      .select()
      .from(priceLists)
      .where(eq(priceLists.id, priceListId))
      .limit(1);

    if (!priceList[0] || priceList[0].status !== 'active') {
      throw new Error('Price list not found or not active');
    }

    // Get all items in the price list
    const priceListItemsData = await tx
      .select({
        sku: priceListItems.sku,
        unitPrice: priceListItems.unitPrice,
        tierPricing: priceListItems.tierPricing,
        moq: priceListItems.moq
      })
      .from(priceListItems)
      .where(eq(priceListItems.priceListId, priceListId));

    // Update inventory costs for each affected product
    const updates = [];
    const notifications = [];

    for (const item of priceListItemsData) {
      // Find products matching the SKU
      const productsToUpdate = await tx
        .select({
          id: products.id,
          supplierId: products.supplierId
        })
        .from(products)
        .where(
          and(
            eq(products.sku, item.sku),
            eq(products.supplierId, priceList[0].supplierId)
          )
        );

      for (const product of productsToUpdate) {
        // Get current inventory records for this product
        const inventoryRecords = await tx
          .select({
            id: inventory.id,
            quantityOnHand: inventory.quantityOnHand,
            averageCost: inventory.averageCost,
            lastPurchaseCost: inventory.lastPurchaseCost,
            warehouseId: inventory.warehouseId
          })
          .from(inventory)
          .where(eq(inventory.productId, product.id));

        for (const inv of inventoryRecords) {
          // Calculate new average cost (if stock exists)
          let newAverageCost = inv.averageCost;
          if (inv.quantityOnHand > 0) {
            // Keep existing average cost calculation logic
            // Only update last purchase cost from price list
            newAverageCost = inv.averageCost;
          }

          // Update inventory with new costs
          const updated = await tx
            .update(inventory)
            .set({
              lastPurchaseCost: item.unitPrice,
              metadata: sql`
                jsonb_set(
                  COALESCE(metadata, '{}'::jsonb),
                  '{supplier_price_info}',
                  ${JSON.stringify({
                    priceListId: priceListId,
                    supplierId: priceList[0].supplierId,
                    lastUpdated: new Date().toISOString(),
                    moq: item.moq,
                    hasTierPricing: !!item.tierPricing
                  })}::jsonb
                )
              `,
              updatedAt: new Date()
            })
            .where(eq(inventory.id, inv.id))
            .returning();

          updates.push(updated[0]);

          // Prepare notification
          notifications.push({
            inventoryId: inv.id,
            productId: product.id,
            warehouseId: inv.warehouseId,
            oldCost: inv.lastPurchaseCost,
            newCost: item.unitPrice,
            changeReason: 'price_list_activation'
          });
        }
      }
    }

    // Send real-time notifications
    for (const notification of notifications) {
      await realtimeService.notifyInventoryChange(notification);
    }

    return {
      priceListId,
      updatedRecords: updates.length,
      updates
    };
  });
}

// ==================== WEIGHTED AVERAGE COST CALCULATION ====================

/**
 * Calculate weighted average cost for inventory after a purchase
 */
export async function calculateWeightedAverageCost(inventoryId, incomingQuantity, incomingUnitCost) {
  const inv = await db
    .select({
      quantityOnHand: inventory.quantityOnHand,
      averageCost: inventory.averageCost
    })
    .from(inventory)
    .where(eq(inventory.id, inventoryId))
    .limit(1);

  if (!inv[0]) {
    throw new Error('Inventory record not found');
  }

  const currentValue = inv[0].quantityOnHand * inv[0].averageCost;
  const incomingValue = incomingQuantity * incomingUnitCost;
  const totalQuantity = inv[0].quantityOnHand + incomingQuantity;
  
  if (totalQuantity === 0) {
    return inv[0].averageCost;
  }

  return (currentValue + incomingValue) / totalQuantity;
}

// ==================== SUPPLIER STOCK TRACKING ====================

/**
 * Get supplier-specific stock levels across all warehouses
 */
export async function getSupplierStockLevels(supplierId) {
  const stockLevels = await db
    .select({
      productId: products.id,
      productSku: products.sku,
      productName: products.name,
      supplierId: products.supplierId,
      supplierName: suppliers.companyName,
      totalOnHand: sql`SUM(${inventory.quantityOnHand})`,
      totalAvailable: sql`SUM(${inventory.quantityAvailable})`,
      totalReserved: sql`SUM(${inventory.quantityReserved})`,
      totalValue: sql`SUM(${inventory.quantityOnHand} * ${inventory.averageCost})`,
      warehouseCount: sql`COUNT(DISTINCT ${inventory.warehouseId})`,
      avgLeadTime: sql`
        COALESCE(
          (${inventory.metadata}->>'supplier_lead_time_days')::numeric,
          ${suppliers.leadTimeDays}
        )
      `
    })
    .from(products)
    .innerJoin(inventory, eq(products.id, inventory.productId))
    .innerJoin(suppliers, eq(products.supplierId, suppliers.id))
    .where(eq(suppliers.id, supplierId))
    .groupBy(products.id, products.sku, products.name, products.supplierId, suppliers.companyName, suppliers.leadTimeDays);

  return stockLevels;
}

/**
 * Track supplier performance metrics based on inventory movements
 */
export async function getSupplierPerformanceMetrics(supplierId, dateFrom = null, dateTo = null) {
  let whereConditions = [
    eq(products.supplierId, supplierId),
    inArray(inventoryMovements.movementType, ['purchase', 'return_to_supplier'])
  ];

  if (dateFrom) {
    whereConditions.push(sql`${inventoryMovements.createdAt} >= ${dateFrom}`);
  }
  if (dateTo) {
    whereConditions.push(sql`${inventoryMovements.createdAt} <= ${dateTo}`);
  }

  const metrics = await db
    .select({
      totalPurchases: sql`
        COUNT(CASE WHEN ${inventoryMovements.movementType} = 'purchase' THEN 1 END)
      `,
      totalReturns: sql`
        COUNT(CASE WHEN ${inventoryMovements.movementType} = 'return_to_supplier' THEN 1 END)
      `,
      totalQuantityPurchased: sql`
        SUM(CASE WHEN ${inventoryMovements.movementType} = 'purchase' THEN ${inventoryMovements.quantity} ELSE 0 END)
      `,
      totalQuantityReturned: sql`
        ABS(SUM(CASE WHEN ${inventoryMovements.movementType} = 'return_to_supplier' THEN ${inventoryMovements.quantity} ELSE 0 END))
      `,
      totalPurchaseValue: sql`
        SUM(CASE WHEN ${inventoryMovements.movementType} = 'purchase' THEN ${inventoryMovements.totalCost} ELSE 0 END)
      `,
      avgUnitCost: sql`
        AVG(CASE WHEN ${inventoryMovements.movementType} = 'purchase' THEN ${inventoryMovements.unitCost} END)
      `,
      returnRate: sql`
        CASE 
          WHEN SUM(CASE WHEN ${inventoryMovements.movementType} = 'purchase' THEN ${inventoryMovements.quantity} ELSE 0 END) > 0
          THEN ABS(SUM(CASE WHEN ${inventoryMovements.movementType} = 'return_to_supplier' THEN ${inventoryMovements.quantity} ELSE 0 END)) * 100.0 / 
               SUM(CASE WHEN ${inventoryMovements.movementType} = 'purchase' THEN ${inventoryMovements.quantity} ELSE 0 END)
          ELSE 0
        END
      `,
      uniqueProducts: sql`COUNT(DISTINCT ${inventoryMovements.productId})`,
      lastPurchaseDate: sql`MAX(CASE WHEN ${inventoryMovements.movementType} = 'purchase' THEN ${inventoryMovements.createdAt} END)`
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .where(and(...whereConditions));

  return metrics[0];
}

// ==================== PRICE CALCULATION ENGINE ====================

/**
 * Calculate price based on quantity and tier pricing
 */
export function calculateTierPrice(tierPricing, quantity) {
  if (!tierPricing || !Array.isArray(tierPricing) || tierPricing.length === 0) {
    return null;
  }

  // Sort tiers by minQuantity in descending order
  const sortedTiers = [...tierPricing].sort((a, b) => b.minQuantity - a.minQuantity);

  // Find the applicable tier
  for (const tier of sortedTiers) {
    if (quantity >= tier.minQuantity) {
      return tier.unitPrice;
    }
  }

  // Return the first tier price if quantity is less than all tiers
  return tierPricing[0]?.unitPrice || null;
}

/**
 * Calculate total cost including tier pricing and quantity breaks
 */
export async function calculatePurchaseCost(productSku, supplierId, quantity) {
  // Get active price list for the supplier
  const activePriceList = await db
    .select()
    .from(priceLists)
    .where(
      and(
        eq(priceLists.supplierId, supplierId),
        eq(priceLists.status, 'active'),
        eq(priceLists.isActive, true)
      )
    )
    .orderBy(sql`${priceLists.effectiveDate} DESC`)
    .limit(1);

  if (!activePriceList[0]) {
    throw new Error('No active price list found for supplier');
  }

  // Get price list item
  const priceItem = await db
    .select()
    .from(priceListItems)
    .where(
      and(
        eq(priceListItems.priceListId, activePriceList[0].id),
        eq(priceListItems.sku, productSku)
      )
    )
    .limit(1);

  if (!priceItem[0]) {
    throw new Error('Product not found in supplier price list');
  }

  const item = priceItem[0];

  // Check MOQ
  if (item.moq && quantity < item.moq) {
    throw new Error(`Quantity ${quantity} is below minimum order quantity of ${item.moq}`);
  }

  // Calculate unit price based on tier pricing
  let unitPrice = item.unitPrice;
  if (item.tierPricing) {
    const tierPrice = calculateTierPrice(item.tierPricing, quantity);
    if (tierPrice !== null) {
      unitPrice = tierPrice;
    }
  }

  // Apply discounts if any
  let discount = 0;
  if (item.discountPercentage && item.discountPercentage > 0) {
    discount = unitPrice * (item.discountPercentage / 100);
  }

  const finalUnitPrice = unitPrice - discount;
  const totalCost = finalUnitPrice * quantity;

  return {
    productSku,
    supplierId,
    priceListId: activePriceList[0].id,
    quantity,
    baseUnitPrice: item.unitPrice,
    tierUnitPrice: unitPrice,
    discountPercentage: item.discountPercentage || 0,
    discountAmount: discount,
    finalUnitPrice,
    totalCost,
    currency: item.currency,
    moq: item.moq,
    appliedTier: item.tierPricing ? 
      item.tierPricing.find(t => quantity >= t.minQuantity) : null
  };
}

// ==================== STOCK ALLOCATION ====================

/**
 * Allocate supplier stock to customer orders
 */
export async function allocateSupplierStock(orderId, orderItems, preferredSupplierId = null) {
  return await db.transaction(async (tx) => {
    const allocations = [];

    for (const item of orderItems) {
      // Find available inventory for the product
      let inventoryQuery = tx
        .select({
          inventoryId: inventory.id,
          productId: inventory.productId,
          warehouseId: inventory.warehouseId,
          quantityAvailable: inventory.quantityAvailable,
          supplierId: products.supplierId,
          supplierName: suppliers.companyName,
          averageCost: inventory.averageCost
        })
        .from(inventory)
        .innerJoin(products, eq(inventory.productId, products.id))
        .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
        .where(
          and(
            eq(products.sku, item.sku),
            sql`${inventory.quantityAvailable} > 0`
          )
        );

      // Prefer specific supplier if provided
      if (preferredSupplierId) {
        inventoryQuery = inventoryQuery.where(
          eq(products.supplierId, preferredSupplierId)
        );
      }

      const availableInventory = await inventoryQuery
        .orderBy(sql`${inventory.quantityAvailable} DESC`);

      if (availableInventory.length === 0) {
        throw new Error(`No available stock for product ${item.sku}`);
      }

      // Allocate from available inventory
      let remainingQuantity = item.quantity;
      const itemAllocations = [];

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

        // Record the allocation
        itemAllocations.push({
          orderId,
          orderItemSku: item.sku,
          inventoryId: inv.inventoryId,
          productId: inv.productId,
          warehouseId: inv.warehouseId,
          supplierId: inv.supplierId,
          supplierName: inv.supplierName,
          quantity: allocateQty,
          unitCost: inv.averageCost,
          totalCost: allocateQty * inv.averageCost
        });

        remainingQuantity -= allocateQty;
      }

      if (remainingQuantity > 0) {
        throw new Error(`Insufficient stock for product ${item.sku}. Short by ${remainingQuantity} units`);
      }

      allocations.push(...itemAllocations);
    }

    return allocations;
  });
}

/**
 * Generate reorder suggestions based on supplier lead times
 */
export async function generateSupplierReorderSuggestions() {
  const suggestions = await db
    .select({
      inventoryId: inventory.id,
      productId: products.id,
      productSku: products.sku,
      productName: products.name,
      supplierId: suppliers.id,
      supplierName: suppliers.companyName,
      supplierCode: suppliers.supplierCode,
      currentStock: inventory.quantityOnHand,
      availableStock: inventory.quantityAvailable,
      reorderPoint: inventory.reorderPoint,
      reorderQuantity: inventory.reorderQuantity,
      leadTimeDays: suppliers.leadTimeDays,
      moq: sql`
        COALESCE(
          (${inventory.metadata}->>'supplier_moq')::numeric,
          1
        )
      `,
      lastPurchaseCost: inventory.lastPurchaseCost,
      stockShortage: sql`${inventory.reorderPoint} - ${inventory.quantityAvailable}`,
      daysOfStock: sql`
        CASE 
          WHEN ${inventory.metadata}->>'daily_usage' IS NOT NULL 
            AND (${inventory.metadata}->>'daily_usage')::numeric > 0
          THEN ${inventory.quantityAvailable} / (${inventory.metadata}->>'daily_usage')::numeric
          ELSE NULL
        END
      `,
      urgencyLevel: sql`
        CASE
          WHEN ${inventory.quantityAvailable} = 0 THEN 'critical'
          WHEN ${inventory.quantityAvailable} < ${inventory.minStockLevel} THEN 'high'
          WHEN ${inventory.quantityAvailable} <= ${inventory.reorderPoint} THEN 'medium'
          ELSE 'low'
        END
      `
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .innerJoin(suppliers, eq(products.supplierId, suppliers.id))
    .where(
      and(
        sql`${inventory.quantityAvailable} <= ${inventory.reorderPoint}`,
        eq(suppliers.isActive, true),
        eq(products.isActive, true)
      )
    )
    .orderBy(
      sql`
        CASE
          WHEN ${inventory.quantityAvailable} = 0 THEN 1
          WHEN ${inventory.quantityAvailable} < ${inventory.minStockLevel} THEN 2
          WHEN ${inventory.quantityAvailable} <= ${inventory.reorderPoint} THEN 3
          ELSE 4
        END
      `,
      sql`${inventory.reorderPoint} - ${inventory.quantityAvailable} DESC`
    );

  // Calculate suggested order quantities
  return suggestions.map(suggestion => {
    let suggestedQuantity = suggestion.reorderQuantity || suggestion.stockShortage;
    
    // Round up to MOQ if necessary
    if (suggestion.moq && suggestedQuantity < suggestion.moq) {
      suggestedQuantity = suggestion.moq;
    }

    // Calculate estimated cost
    const estimatedCost = suggestedQuantity * (suggestion.lastPurchaseCost || 0);

    return {
      ...suggestion,
      suggestedQuantity,
      estimatedCost,
      estimatedDeliveryDays: suggestion.leadTimeDays || 7,
      canCoverDemand: suggestion.daysOfStock ? 
        suggestion.daysOfStock > suggestion.leadTimeDays : null
    };
  });
}

// ==================== INVENTORY SYNC MECHANISMS ====================

/**
 * Batch update inventory costs from supplier price changes
 */
export async function batchUpdateInventoryCosts(updates) {
  const results = [];
  const batchSize = 100; // Process in batches to avoid memory issues

  for (let i = 0; i < updates.length; i += batchSize) {
    const batch = updates.slice(i, i + batchSize);
    
    const batchResults = await db.transaction(async (tx) => {
      const batchUpdates = [];

      for (const update of batch) {
        const updated = await tx
          .update(inventory)
          .set({
            lastPurchaseCost: update.newCost,
            metadata: sql`
              jsonb_set(
                COALESCE(metadata, '{}'::jsonb),
                '{cost_update_history}',
                COALESCE(metadata->'cost_update_history', '[]'::jsonb) || 
                ${JSON.stringify([{
                  oldCost: update.oldCost,
                  newCost: update.newCost,
                  updatedAt: new Date().toISOString(),
                  reason: update.reason || 'batch_price_update'
                }])}::jsonb
              )
            `,
            updatedAt: new Date()
          })
          .where(eq(inventory.id, update.inventoryId))
          .returning();

        batchUpdates.push(updated[0]);
      }

      return batchUpdates;
    });

    results.push(...batchResults);
  }

  return {
    totalUpdated: results.length,
    updates: results
  };
}

/**
 * Sync inventory levels with supplier availability
 */
export async function syncSupplierInventoryLevels(supplierId, supplierStockData) {
  return await db.transaction(async (tx) => {
    const syncResults = [];

    for (const stockItem of supplierStockData) {
      // Find product by SKU and supplier
      const product = await tx
        .select({ id: products.id })
        .from(products)
        .where(
          and(
            eq(products.sku, stockItem.sku),
            eq(products.supplierId, supplierId)
          )
        )
        .limit(1);

      if (!product[0]) continue;

      // Update inventory metadata with supplier stock info
      const inventoryRecords = await tx
        .select({ id: inventory.id, metadata: inventory.metadata })
        .from(inventory)
        .where(eq(inventory.productId, product[0].id));

      for (const inv of inventoryRecords) {
        const updated = await tx
          .update(inventory)
          .set({
            metadata: sql`
              jsonb_set(
                jsonb_set(
                  COALESCE(metadata, '{}'::jsonb),
                  '{supplier_stock}',
                  ${JSON.stringify({
                    available: stockItem.availableQuantity,
                    onOrder: stockItem.onOrderQuantity || 0,
                    allocated: stockItem.allocatedQuantity || 0,
                    lastUpdated: new Date().toISOString()
                  })}::jsonb
                ),
                '{supplier_lead_time_days}',
                ${stockItem.leadTimeDays || 7}::text::jsonb
              )
            `,
            updatedAt: new Date()
          })
          .where(eq(inventory.id, inv.id))
          .returning();

        syncResults.push({
          inventoryId: inv.id,
          productSku: stockItem.sku,
          supplierStock: stockItem.availableQuantity,
          updated: true
        });
      }
    }

    return {
      supplierId,
      syncedItems: syncResults.length,
      results: syncResults
    };
  });
}

/**
 * Handle conflicts in concurrent inventory updates
 */
export async function resolveInventoryConflict(inventoryId, updates) {
  return await db.transaction(async (tx) => {
    // Lock the inventory record
    const current = await tx
      .select()
      .from(inventory)
      .where(eq(inventory.id, inventoryId))
      .for('update')
      .limit(1);

    if (!current[0]) {
      throw new Error('Inventory record not found');
    }

    // Apply conflict resolution strategy
    const resolved = {
      quantityOnHand: Math.max(...updates.map(u => u.quantityOnHand || 0)),
      quantityAvailable: Math.min(...updates.map(u => u.quantityAvailable || Infinity)),
      averageCost: updates.reduce((sum, u) => sum + (u.averageCost || 0), 0) / updates.length,
      lastPurchaseCost: Math.max(...updates.map(u => u.lastPurchaseCost || 0)),
      metadata: {
        ...current[0].metadata,
        conflictResolution: {
          resolvedAt: new Date().toISOString(),
          conflictingUpdates: updates.length,
          strategy: 'conservative' // Take most conservative values
        }
      }
    };

    const updated = await tx
      .update(inventory)
      .set({
        ...resolved,
        updatedAt: new Date()
      })
      .where(eq(inventory.id, inventoryId))
      .returning();

    return updated[0];
  });
}