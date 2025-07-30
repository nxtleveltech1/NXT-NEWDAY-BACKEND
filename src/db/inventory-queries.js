import { eq, and, or, desc, asc, sql, gte, lte, isNull, isNotNull } from 'drizzle-orm';
import { db } from '../config/database.js';
import { inventory, inventoryMovements, products, suppliers } from './schema.js';
import { realtimeService } from '../services/realtime-service.js';

// ==================== INVENTORY LEVEL MANAGEMENT ====================

/**
 * Get inventory with filters, pagination, and sorting
 */
export async function getInventory(params = {}) {
  const {
    page = 1,
    limit = 10,
    search = '',
    warehouseId = null,
    stockStatus = null,
    belowReorderPoint = false,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = params;

  const offset = (page - 1) * limit;

  // Build where conditions
  let whereConditions = [];
  
  if (search) {
    whereConditions.push(
      or(
        sql`${products.name} ILIKE ${`%${search}%`}`,
        sql`${products.sku} ILIKE ${`%${search}%`}`
      )
    );
  }

  if (warehouseId) {
    whereConditions.push(eq(inventory.warehouseId, warehouseId));
  }

  if (stockStatus) {
    whereConditions.push(eq(inventory.stockStatus, stockStatus));
  }

  if (belowReorderPoint) {
    whereConditions.push(
      and(
        isNotNull(inventory.reorderPoint),
        sql`${inventory.quantityAvailable} <= ${inventory.reorderPoint}`
      )
    );
  }

  const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

  // Build sort
  const sortColumn = inventory[sortBy] || inventory.createdAt;
  const orderFn = sortOrder === 'asc' ? asc : desc;

  // Get total count
  const countResult = await db
    .select({ count: sql`COUNT(*)` })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .where(whereClause);

  const total = Number(countResult[0].count);

  // Get inventory data
  const inventoryData = await db
    .select({
      // Inventory fields
      id: inventory.id,
      productId: inventory.productId,
      warehouseId: inventory.warehouseId,
      locationId: inventory.locationId,
      quantityOnHand: inventory.quantityOnHand,
      quantityAvailable: inventory.quantityAvailable,
      quantityReserved: inventory.quantityReserved,
      quantityInTransit: inventory.quantityInTransit,
      lastStockCheck: inventory.lastStockCheck,
      lastMovement: inventory.lastMovement,
      stockStatus: inventory.stockStatus,
      reorderPoint: inventory.reorderPoint,
      reorderQuantity: inventory.reorderQuantity,
      maxStockLevel: inventory.maxStockLevel,
      minStockLevel: inventory.minStockLevel,
      averageCost: inventory.averageCost,
      lastPurchaseCost: inventory.lastPurchaseCost,
      metadata: inventory.metadata,
      createdAt: inventory.createdAt,
      updatedAt: inventory.updatedAt,
      // Product fields
      productSku: products.sku,
      productName: products.name,
      productDescription: products.description,
      productCategory: products.category,
      productUnitPrice: products.unitPrice,
      productCostPrice: products.costPrice,
      productIsActive: products.isActive,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(limit)
    .offset(offset);

  return {
    data: inventoryData,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

/**
 * Get single inventory record by ID
 */
export async function getInventoryById(id) {
  const result = await db
    .select({
      // Inventory fields
      id: inventory.id,
      productId: inventory.productId,
      warehouseId: inventory.warehouseId,
      locationId: inventory.locationId,
      quantityOnHand: inventory.quantityOnHand,
      quantityAvailable: inventory.quantityAvailable,
      quantityReserved: inventory.quantityReserved,
      quantityInTransit: inventory.quantityInTransit,
      lastStockCheck: inventory.lastStockCheck,
      lastMovement: inventory.lastMovement,
      stockStatus: inventory.stockStatus,
      reorderPoint: inventory.reorderPoint,
      reorderQuantity: inventory.reorderQuantity,
      maxStockLevel: inventory.maxStockLevel,
      minStockLevel: inventory.minStockLevel,
      averageCost: inventory.averageCost,
      lastPurchaseCost: inventory.lastPurchaseCost,
      metadata: inventory.metadata,
      createdAt: inventory.createdAt,
      updatedAt: inventory.updatedAt,
      // Product fields
      productSku: products.sku,
      productName: products.name,
      productDescription: products.description,
      productCategory: products.category,
      productUnitPrice: products.unitPrice,
      productCostPrice: products.costPrice,
      productIsActive: products.isActive,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .where(eq(inventory.id, id))
    .limit(1);

  return result[0] || null;
}

/**
 * Get inventory by product and warehouse
 */
export async function getInventoryByProductWarehouse(productId, warehouseId) {
  const result = await db
    .select()
    .from(inventory)
    .where(
      and(
        eq(inventory.productId, productId),
        eq(inventory.warehouseId, warehouseId)
      )
    )
    .limit(1);

  return result[0] || null;
}

/**
 * Create or update inventory record
 */
export async function upsertInventory(data) {
  const {
    productId,
    warehouseId,
    locationId = null,
    quantityOnHand = 0,
    reorderPoint = 0,
    reorderQuantity = 0,
    maxStockLevel = null,
    minStockLevel = 0,
    metadata = {}
  } = data;

  // Check if inventory record exists
  const existing = await getInventoryByProductWarehouse(productId, warehouseId);

  if (existing) {
    // Update existing
    const updated = await db
      .update(inventory)
      .set({
        locationId,
        quantityOnHand,
        quantityAvailable: quantityOnHand,
        reorderPoint,
        reorderQuantity,
        maxStockLevel,
        minStockLevel,
        metadata,
        stockStatus: calculateStockStatus(quantityOnHand, reorderPoint, minStockLevel),
        updatedAt: new Date()
      })
      .where(eq(inventory.id, existing.id))
      .returning();

    return updated[0];
  } else {
    // Create new
    const created = await db
      .insert(inventory)
      .values({
        productId,
        warehouseId,
        locationId,
        quantityOnHand,
        quantityAvailable: quantityOnHand,
        quantityReserved: 0,
        quantityInTransit: 0,
        lastStockCheck: new Date(),
        stockStatus: calculateStockStatus(quantityOnHand, reorderPoint, minStockLevel),
        reorderPoint,
        reorderQuantity,
        maxStockLevel,
        minStockLevel,
        metadata
      })
      .returning();

    return created[0];
  }
}

// ==================== STOCK MOVEMENT MANAGEMENT ====================

/**
 * Record inventory movement and update stock levels
 */
export async function recordMovement(movementData) {
  const {
    inventoryId,
    productId,
    warehouseId,
    movementType,
    quantity,
    fromLocation = null,
    toLocation = null,
    unitCost = null,
    referenceType = null,
    referenceId = null,
    referenceNumber = null,
    performedBy = null,
    notes = null,
    batchNumber = null,
    serialNumbers = [],
    expiryDate = null
  } = movementData;

  return await db.transaction(async (tx) => {
    // Get current inventory
    const currentInventory = await tx
      .select()
      .from(inventory)
      .where(eq(inventory.id, inventoryId))
      .limit(1);

    if (!currentInventory[0]) {
      throw new Error('Inventory record not found');
    }

    const current = currentInventory[0];
    const quantityAfter = current.quantityOnHand + quantity;
    const availableAfter = current.quantityAvailable + quantity;

    // Validate movement
    if (quantity < 0 && Math.abs(quantity) > current.quantityAvailable) {
      throw new Error('Insufficient available stock');
    }

    // Calculate costs
    const totalCost = unitCost ? unitCost * Math.abs(quantity) : null;
    let newAverageCost = current.averageCost;

    // Update average cost for positive movements (inbound)
    if (quantity > 0 && unitCost && current.quantityOnHand > 0) {
      const totalValue = (current.averageCost * current.quantityOnHand) + (unitCost * quantity);
      newAverageCost = totalValue / quantityAfter;
    } else if (quantity > 0 && unitCost && current.quantityOnHand === 0) {
      newAverageCost = unitCost;
    }

    // Record movement
    const movement = await tx
      .insert(inventoryMovements)
      .values({
        inventoryId,
        productId,
        warehouseId,
        movementType,
        quantity,
        fromLocation,
        toLocation,
        unitCost,
        totalCost,
        referenceType,
        referenceId,
        referenceNumber,
        performedBy,
        notes,
        batchNumber,
        serialNumbers,
        expiryDate,
        quantityAfter,
        runningTotal: quantityAfter
      })
      .returning();

    // Update inventory levels
    const stockStatus = calculateStockStatus(
      quantityAfter,
      current.reorderPoint,
      current.minStockLevel
    );

    const updatedInventory = await tx
      .update(inventory)
      .set({
        quantityOnHand: quantityAfter,
        quantityAvailable: Math.max(0, availableAfter),
        averageCost: newAverageCost,
        lastPurchaseCost: quantity > 0 && unitCost ? unitCost : current.lastPurchaseCost,
        lastMovement: new Date(),
        stockStatus,
        updatedAt: new Date()
      })
      .where(eq(inventory.id, inventoryId))
      .returning();

    // Clear reorder suggestions cache when inventory changes
    clearReorderSuggestionsCache();

    // Trigger real-time notifications
    const result = {
      movement: movement[0],
      inventory: updatedInventory[0]
    };

    // Notify inventory change
    await realtimeService.notifyInventoryChange({
      id: inventoryId,
      productId,
      warehouseId,
      oldQuantity: current.quantityOnHand,
      newQuantity: quantityAfter,
      quantityAvailable: Math.max(0, availableAfter),
      stockStatus,
      changeReason: `movement_${movementType}`
    });

    // Notify inventory movement
    await realtimeService.notifyInventoryMovement({
      id: movement[0].id,
      inventoryId,
      productId,
      warehouseId,
      movementType,
      quantity,
      quantityAfter,
      performedBy,
      referenceNumber
    });

    // Check for stock alerts
    if (stockStatus === 'low_stock' || stockStatus === 'out_of_stock' || stockStatus === 'critical_stock') {
      const product = await tx
        .select({ sku: products.sku, name: products.name })
        .from(products)
        .where(eq(products.id, productId))
        .limit(1);

      if (product[0]) {
        await realtimeService.notifyStockAlert({
          inventoryId,
          productId,
          productSku: product[0].sku,
          productName: product[0].name,
          warehouseId,
          currentQuantity: quantityAfter,
          reorderPoint: current.reorderPoint,
          alertType: stockStatus,
          priority: stockStatus === 'out_of_stock' ? 'critical' : 'high',
          message: `${stockStatus.replace('_', ' ').toUpperCase()}: ${product[0].name} (${product[0].sku}) - ${quantityAfter} remaining`
        });
      }
    }

    return result;
  });
}

/**
 * Reserve stock for orders
 */
export async function reserveStock(productId, warehouseId, quantity) {
  return await db.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.productId, productId),
          eq(inventory.warehouseId, warehouseId)
        )
      )
      .limit(1);

    if (!current[0]) {
      throw new Error('Inventory record not found');
    }

    if (current[0].quantityAvailable < quantity) {
      throw new Error('Insufficient available stock for reservation');
    }

    const updated = await tx
      .update(inventory)
      .set({
        quantityAvailable: current[0].quantityAvailable - quantity,
        quantityReserved: current[0].quantityReserved + quantity,
        updatedAt: new Date()
      })
      .where(eq(inventory.id, current[0].id))
      .returning();

    return updated[0];
  });
}

/**
 * Release reserved stock
 */
export async function releaseReservedStock(productId, warehouseId, quantity) {
  return await db.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(inventory)
      .where(
        and(
          eq(inventory.productId, productId),
          eq(inventory.warehouseId, warehouseId)
        )
      )
      .limit(1);

    if (!current[0]) {
      throw new Error('Inventory record not found');
    }

    if (current[0].quantityReserved < quantity) {
      throw new Error('Cannot release more than reserved quantity');
    }

    const updated = await tx
      .update(inventory)
      .set({
        quantityAvailable: current[0].quantityAvailable + quantity,
        quantityReserved: current[0].quantityReserved - quantity,
        updatedAt: new Date()
      })
      .where(eq(inventory.id, current[0].id))
      .returning();

    return updated[0];
  });
}

// ==================== MOVEMENT HISTORY ====================

/**
 * Get inventory movements with filters and pagination
 */
export async function getMovements(params = {}) {
  const {
    page = 1,
    limit = 10,
    inventoryId = null,
    productId = null,
    warehouseId = null,
    movementType = null,
    dateFrom = null,
    dateTo = null,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = params;

  const offset = (page - 1) * limit;

  // Build where conditions
  let whereConditions = [];
  
  if (inventoryId) {
    whereConditions.push(eq(inventoryMovements.inventoryId, inventoryId));
  }

  if (productId) {
    whereConditions.push(eq(inventoryMovements.productId, productId));
  }

  if (warehouseId) {
    whereConditions.push(eq(inventoryMovements.warehouseId, warehouseId));
  }

  if (movementType) {
    whereConditions.push(eq(inventoryMovements.movementType, movementType));
  }

  if (dateFrom) {
    whereConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
  }

  if (dateTo) {
    whereConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));
  }

  const whereClause = whereConditions.length > 0 ? and(...whereConditions) : undefined;

  // Build sort
  const sortColumn = inventoryMovements[sortBy] || inventoryMovements.createdAt;
  const orderFn = sortOrder === 'asc' ? asc : desc;

  // Get total count
  const countResult = await db
    .select({ count: sql`COUNT(*)` })
    .from(inventoryMovements)
    .where(whereClause);

  const total = Number(countResult[0].count);

  // Get movements data
  const movements = await db
    .select({
      // Movement fields
      id: inventoryMovements.id,
      inventoryId: inventoryMovements.inventoryId,
      productId: inventoryMovements.productId,
      warehouseId: inventoryMovements.warehouseId,
      movementType: inventoryMovements.movementType,
      quantity: inventoryMovements.quantity,
      fromLocation: inventoryMovements.fromLocation,
      toLocation: inventoryMovements.toLocation,
      unitCost: inventoryMovements.unitCost,
      totalCost: inventoryMovements.totalCost,
      referenceType: inventoryMovements.referenceType,
      referenceId: inventoryMovements.referenceId,
      referenceNumber: inventoryMovements.referenceNumber,
      performedBy: inventoryMovements.performedBy,
      notes: inventoryMovements.notes,
      batchNumber: inventoryMovements.batchNumber,
      serialNumbers: inventoryMovements.serialNumbers,
      expiryDate: inventoryMovements.expiryDate,
      quantityAfter: inventoryMovements.quantityAfter,
      runningTotal: inventoryMovements.runningTotal,
      createdAt: inventoryMovements.createdAt,
      // Product fields
      productSku: products.sku,
      productName: products.name,
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .where(whereClause)
    .orderBy(orderFn(sortColumn))
    .limit(limit)
    .offset(offset);

  return {
    data: movements,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit)
    }
  };
}

// ==================== REORDER MANAGEMENT ====================

// Cache for reorder suggestions to prevent excessive database queries
let reorderSuggestionsCache = null;
let lastReorderCacheTime = 0;
const REORDER_CACHE_TTL = 300000; // 5 minutes cache

/**
 * Get reorder suggestions with caching and memory optimization
 */
export async function getReorderSuggestions() {
  const now = Date.now();
  
  // Return cached results if still valid
  if (reorderSuggestionsCache && (now - lastReorderCacheTime) < REORDER_CACHE_TTL) {
    return reorderSuggestionsCache;
  }
  
  try {
    const suggestions = await db
      .select({
        id: inventory.id,
        productId: inventory.productId,
        warehouseId: inventory.warehouseId,
        quantityOnHand: inventory.quantityOnHand,
        quantityAvailable: inventory.quantityAvailable,
        reorderPoint: inventory.reorderPoint,
        reorderQuantity: inventory.reorderQuantity,
        averageCost: inventory.averageCost,
        productSku: products.sku,
        productName: products.name,
        productCategory: products.category,
        supplierName: suppliers.companyName,
        supplierId: products.supplierId,
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .leftJoin(suppliers, eq(products.supplierId, suppliers.id))
      .where(
        and(
          isNotNull(inventory.reorderPoint),
          sql`${inventory.quantityAvailable} <= ${inventory.reorderPoint}`,
          eq(products.isActive, true),
          sql`${inventory.reorderPoint} > 0`
        )
      )
      .orderBy(
        desc(sql`(${inventory.reorderPoint} - ${inventory.quantityAvailable})`)
      )
      .limit(100); // Prevent memory issues with large result sets

    // Cache the results
    reorderSuggestionsCache = suggestions;
    lastReorderCacheTime = now;
    
    return suggestions;
  } catch (error) {
    console.error('Error fetching reorder suggestions:', error);
    // Return cached data if available, empty array otherwise
    return reorderSuggestionsCache || [];
  }
}

/**
 * Clear reorder suggestions cache (call when inventory is updated)
 */
export function clearReorderSuggestionsCache() {
  reorderSuggestionsCache = null;
  lastReorderCacheTime = 0;
}

// ==================== ANALYTICS ====================

/**
 * Get inventory analytics
 */
export async function getInventoryAnalytics(params = {}) {
  const { warehouseId = null, categoryFilter = null } = params;

  let whereConditions = [eq(products.isActive, true)];
  
  if (warehouseId) {
    whereConditions.push(eq(inventory.warehouseId, warehouseId));
  }

  if (categoryFilter) {
    whereConditions.push(eq(products.category, categoryFilter));
  }

  const whereClause = and(...whereConditions);

  // Basic inventory metrics
  const metrics = await db
    .select({
      totalItems: sql`COUNT(*)`,
      totalValue: sql`SUM(${inventory.quantityOnHand} * ${inventory.averageCost})`,
      totalOnHand: sql`SUM(${inventory.quantityOnHand})`,
      totalReserved: sql`SUM(${inventory.quantityReserved})`,
      totalAvailable: sql`SUM(${inventory.quantityAvailable})`,
      itemsBelowReorder: sql`SUM(CASE WHEN ${inventory.quantityAvailable} <= ${inventory.reorderPoint} AND ${inventory.reorderPoint} IS NOT NULL THEN 1 ELSE 0 END)`,
      itemsOutOfStock: sql`SUM(CASE WHEN ${inventory.quantityAvailable} = 0 THEN 1 ELSE 0 END)`,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .where(whereClause);

  // Category breakdown
  const categoryBreakdown = await db
    .select({
      category: products.category,
      itemCount: sql`COUNT(*)`,
      totalValue: sql`SUM(${inventory.quantityOnHand} * ${inventory.averageCost})`,
      totalQuantity: sql`SUM(${inventory.quantityOnHand})`,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .where(whereClause)
    .groupBy(products.category)
    .orderBy(desc(sql`SUM(${inventory.quantityOnHand} * ${inventory.averageCost})`));

  // Stock status breakdown
  const stockStatusBreakdown = await db
    .select({
      stockStatus: inventory.stockStatus,
      count: sql`COUNT(*)`,
      totalValue: sql`SUM(${inventory.quantityOnHand} * ${inventory.averageCost})`,
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .where(whereClause)
    .groupBy(inventory.stockStatus);

  return {
    summary: metrics[0],
    categoryBreakdown,
    stockStatusBreakdown
  };
}

/**
 * Get advanced inventory analytics with turnover, aging, and trends
 */
export async function getAdvancedInventoryAnalytics(params = {}) {
  const { 
    warehouseId = null, 
    categoryFilter = null,
    dateFrom = null,
    dateTo = null,
    analysisType = 'all' // 'turnover', 'aging', 'trends', 'forecast', 'all'
  } = params;

  let baseWhereConditions = [eq(products.isActive, true)];
  
  if (warehouseId) {
    baseWhereConditions.push(eq(inventory.warehouseId, warehouseId));
  }

  if (categoryFilter) {
    baseWhereConditions.push(eq(products.category, categoryFilter));
  }

  const results = {};

  // 1. Inventory Turnover Analysis
  if (analysisType === 'all' || analysisType === 'turnover') {
    let movementWhereConditions = [...baseWhereConditions, eq(inventoryMovements.movementType, 'sale')];
    
    if (dateFrom) {
      movementWhereConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
    }
    if (dateTo) {
      movementWhereConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));
    }

    const turnoverData = await db
      .select({
        productId: products.id,
        productSku: products.sku,
        productName: products.name,
        category: products.category,
        currentStock: inventory.quantityOnHand,
        averageCost: inventory.averageCost,
        totalSold: sql`SUM(ABS(${inventoryMovements.quantity}))`,
        totalSalesValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
        avgInventoryValue: sql`${inventory.quantityOnHand} * ${inventory.averageCost}`,
        turnoverRatio: sql`
          CASE 
            WHEN ${inventory.quantityOnHand} > 0 
            THEN SUM(ABS(${inventoryMovements.quantity})) / ${inventory.quantityOnHand}
            ELSE NULL 
          END
        `,
        daysOfInventory: sql`
          CASE 
            WHEN SUM(ABS(${inventoryMovements.quantity})) > 0 
            THEN (${inventory.quantityOnHand} * 365.0) / SUM(ABS(${inventoryMovements.quantity}))
            ELSE NULL 
          END
        `,
        monthsSinceLastSale: sql`
          EXTRACT(days FROM NOW() - MAX(${inventoryMovements.createdAt})) / 30.0
        `
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .leftJoin(inventoryMovements, 
        and(
          eq(inventory.productId, inventoryMovements.productId),
          eq(inventory.warehouseId, inventoryMovements.warehouseId),
          ...movementWhereConditions
        )
      )
      .where(and(...baseWhereConditions))
      .groupBy(
        products.id, products.sku, products.name, products.category,
        inventory.quantityOnHand, inventory.averageCost
      )
      .orderBy(desc(sql`SUM(ABS(${inventoryMovements.quantity}))`));

    results.turnoverAnalysis = turnoverData;
  }

  // 2. Stock Aging Analysis
  if (analysisType === 'all' || analysisType === 'aging') {
    const agingData = await db
      .select({
        productId: products.id,
        productSku: products.sku,
        productName: products.name,
        category: products.category,
        currentStock: inventory.quantityOnHand,
        lastReceived: inventory.lastMovement,
        daysSinceLastReceived: sql`EXTRACT(days FROM NOW() - ${inventory.lastMovement})`,
        agingCategory: sql`
          CASE 
            WHEN ${inventory.lastMovement} IS NULL THEN 'Unknown'
            WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) <= 30 THEN 'Fresh (0-30 days)'
            WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) <= 90 THEN 'Recent (31-90 days)'
            WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) <= 180 THEN 'Aging (91-180 days)'
            WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) <= 365 THEN 'Stale (181-365 days)'
            ELSE 'Dead Stock (>365 days)'
          END
        `,
        inventoryValue: sql`${inventory.quantityOnHand} * ${inventory.averageCost}`,
        riskLevel: sql`
          CASE 
            WHEN ${inventory.lastMovement} IS NULL THEN 'High'
            WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) > 365 THEN 'Critical'
            WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) > 180 THEN 'High'
            WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) > 90 THEN 'Medium'
            ELSE 'Low'
          END
        `
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .where(and(...baseWhereConditions))
      .orderBy(desc(sql`EXTRACT(days FROM NOW() - ${inventory.lastMovement})`));

    // Aging summary
    const agingSummary = await db
      .select({
        agingCategory: sql`
          CASE 
            WHEN ${inventory.lastMovement} IS NULL THEN 'Unknown'
            WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) <= 30 THEN 'Fresh (0-30 days)'
            WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) <= 90 THEN 'Recent (31-90 days)'
            WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) <= 180 THEN 'Aging (91-180 days)'
            WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) <= 365 THEN 'Stale (181-365 days)'
            ELSE 'Dead Stock (>365 days)'
          END
        `,
        itemCount: sql`COUNT(*)`,
        totalValue: sql`SUM(${inventory.quantityOnHand} * ${inventory.averageCost})`,
        totalQuantity: sql`SUM(${inventory.quantityOnHand})`
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .where(and(...baseWhereConditions))
      .groupBy(sql`
        CASE 
          WHEN ${inventory.lastMovement} IS NULL THEN 'Unknown'
          WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) <= 30 THEN 'Fresh (0-30 days)'
          WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) <= 90 THEN 'Recent (31-90 days)'
          WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) <= 180 THEN 'Aging (91-180 days)'
          WHEN EXTRACT(days FROM NOW() - ${inventory.lastMovement}) <= 365 THEN 'Stale (181-365 days)'
          ELSE 'Dead Stock (>365 days)'
        END
      `);

    results.agingAnalysis = {
      details: agingData,
      summary: agingSummary
    };
  }

  // 3. Movement Trends Analysis
  if (analysisType === 'all' || analysisType === 'trends') {
    let trendWhereConditions = [];
    
    if (dateFrom) {
      trendWhereConditions.push(gte(inventoryMovements.createdAt, new Date(dateFrom)));
    }
    if (dateTo) {
      trendWhereConditions.push(lte(inventoryMovements.createdAt, new Date(dateTo)));
    }

    // Daily movement trends
    const dailyTrends = await db
      .select({
        date: sql`DATE(${inventoryMovements.createdAt})`,
        inboundMovements: sql`COUNT(CASE WHEN ${inventoryMovements.quantity} > 0 THEN 1 END)`,
        outboundMovements: sql`COUNT(CASE WHEN ${inventoryMovements.quantity} < 0 THEN 1 END)`,
        totalInbound: sql`SUM(CASE WHEN ${inventoryMovements.quantity} > 0 THEN ${inventoryMovements.quantity} ELSE 0 END)`,
        totalOutbound: sql`ABS(SUM(CASE WHEN ${inventoryMovements.quantity} < 0 THEN ${inventoryMovements.quantity} ELSE 0 END))`,
        netMovement: sql`SUM(${inventoryMovements.quantity})`,
        movementValue: sql`SUM(ABS(${inventoryMovements.quantity}) * COALESCE(${inventoryMovements.unitCost}, 0))`
      })
      .from(inventoryMovements)
      .where(and(...trendWhereConditions))
      .groupBy(sql`DATE(${inventoryMovements.createdAt})`)
      .orderBy(sql`DATE(${inventoryMovements.createdAt})`);

    // Category trends
    const categoryTrends = await db
      .select({
        category: products.category,
        totalMovements: sql`COUNT(*)`,
        inboundQuantity: sql`SUM(CASE WHEN ${inventoryMovements.quantity} > 0 THEN ${inventoryMovements.quantity} ELSE 0 END)`,
        outboundQuantity: sql`ABS(SUM(CASE WHEN ${inventoryMovements.quantity} < 0 THEN ${inventoryMovements.quantity} ELSE 0 END))`,
        netQuantity: sql`SUM(${inventoryMovements.quantity})`,
        movementValue: sql`SUM(ABS(${inventoryMovements.quantity}) * COALESCE(${inventoryMovements.unitCost}, 0))`
      })
      .from(inventoryMovements)
      .innerJoin(products, eq(inventoryMovements.productId, products.id))
      .where(and(...trendWhereConditions))
      .groupBy(products.category)
      .orderBy(desc(sql`SUM(ABS(${inventoryMovements.quantity}) * COALESCE(${inventoryMovements.unitCost}, 0))`));

    results.trendAnalysis = {
      dailyTrends,
      categoryTrends
    };
  }

  // 4. Simple Forecast Model (based on historical trends)
  if (analysisType === 'all' || analysisType === 'forecast') {
    const forecastData = await db
      .select({
        productId: products.id,
        productSku: products.sku,
        productName: products.name,
        category: products.category,
        currentStock: inventory.quantityOnHand,
        reorderPoint: inventory.reorderPoint,
        avgMonthlySales: sql`
          AVG(monthly_sales.sales_quantity) OVER (PARTITION BY ${products.id})
        `,
        salesTrend: sql`
          CASE 
            WHEN COUNT(monthly_sales.sales_quantity) > 1 THEN
              (LAST_VALUE(monthly_sales.sales_quantity) OVER (
                PARTITION BY ${products.id} 
                ORDER BY monthly_sales.month_year 
                ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
              ) - FIRST_VALUE(monthly_sales.sales_quantity) OVER (
                PARTITION BY ${products.id} 
                ORDER BY monthly_sales.month_year 
                ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
              )) / COUNT(monthly_sales.sales_quantity)
            ELSE 0
          END
        `,
        forecastedMonthlySales: sql`
          AVG(monthly_sales.sales_quantity) OVER (PARTITION BY ${products.id}) +
          CASE 
            WHEN COUNT(monthly_sales.sales_quantity) > 1 THEN
              (LAST_VALUE(monthly_sales.sales_quantity) OVER (
                PARTITION BY ${products.id} 
                ORDER BY monthly_sales.month_year 
                ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
              ) - FIRST_VALUE(monthly_sales.sales_quantity) OVER (
                PARTITION BY ${products.id} 
                ORDER BY monthly_sales.month_year 
                ROWS BETWEEN UNBOUNDED PRECEDING AND UNBOUNDED FOLLOWING
              )) / COUNT(monthly_sales.sales_quantity)
            ELSE 0
          END
        `,
        stockoutRisk: sql`
          CASE 
            WHEN AVG(monthly_sales.sales_quantity) OVER (PARTITION BY ${products.id}) > 0 THEN
              ROUND((${inventory.quantityOnHand} * 30.0) / AVG(monthly_sales.sales_quantity) OVER (PARTITION BY ${products.id}), 0)
            ELSE NULL
          END
        `
      })
      .from(inventory)
      .innerJoin(products, eq(inventory.productId, products.id))
      .leftJoin(
        db.select({
          productId: inventoryMovements.productId,
          monthYear: sql`DATE_TRUNC('month', ${inventoryMovements.createdAt})`,
          salesQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`
        })
        .from(inventoryMovements)
        .where(eq(inventoryMovements.movementType, 'sale'))
        .groupBy(inventoryMovements.productId, sql`DATE_TRUNC('month', ${inventoryMovements.createdAt})`)
        .as('monthly_sales'),
        eq(inventory.productId, sql`monthly_sales.product_id`)
      )
      .where(and(...baseWhereConditions))
      .groupBy(
        products.id, products.sku, products.name, products.category,
        inventory.quantityOnHand, inventory.reorderPoint
      );

    results.forecastAnalysis = forecastData;
  }

  return results;
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Calculate stock status based on quantities and thresholds
 */
function calculateStockStatus(quantityOnHand, reorderPoint, minStockLevel) {
  if (quantityOnHand === 0) {
    return 'out_of_stock';
  }
  
  if (reorderPoint && quantityOnHand <= reorderPoint) {
    return 'low_stock';
  }
  
  if (minStockLevel && quantityOnHand <= minStockLevel) {
    return 'critical_stock';
  }
  
  return 'in_stock';
}

/**
 * Stock adjustment with automatic movement recording
 */
export async function adjustStock(inventoryId, newQuantity, reason, performedBy, notes = null) {
  const currentInventory = await getInventoryById(inventoryId);
  if (!currentInventory) {
    throw new Error('Inventory record not found');
  }

  const quantityDifference = newQuantity - currentInventory.quantityOnHand;
  
  if (quantityDifference === 0) {
    return currentInventory;
  }

  const movementType = quantityDifference > 0 ? 'adjustment_in' : 'adjustment_out';
  
  const result = await recordMovement({
    inventoryId,
    productId: currentInventory.productId,
    warehouseId: currentInventory.warehouseId,
    movementType,
    quantity: quantityDifference,
    referenceType: 'stock_adjustment',
    referenceNumber: `ADJ-${Date.now()}`,
    performedBy,
    notes: notes || `Stock adjustment: ${reason}`
  });

  return result.inventory;
}
