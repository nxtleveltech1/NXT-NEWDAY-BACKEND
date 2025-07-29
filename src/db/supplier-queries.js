import { eq, and, sql, desc, asc, ilike } from 'drizzle-orm'
import { db } from '../config/database.js'
import { suppliers, priceLists, priceListItems, products, inventory, inventoryMovements } from './schema.js'

// Get all suppliers with optional filtering and pagination
export async function getSuppliers(params = {}) {
  const {
    page = 1,
    limit = 10,
    search = '',
    isActive = null,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = params

  const offset = (page - 1) * limit
  const orderBy = sortOrder === 'asc' ? asc(suppliers[sortBy]) : desc(suppliers[sortBy])

  let conditions = []
  
  if (search) {
    conditions.push(
      sql`${suppliers.companyName} ILIKE ${`%${search}%`} OR 
          ${suppliers.supplierCode} ILIKE ${`%${search}%`} OR 
          ${suppliers.email} ILIKE ${`%${search}%`}`
    )
  }

  if (isActive !== null) {
    conditions.push(eq(suppliers.isActive, isActive))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const [results, totalCount] = await Promise.all([
    db
      .select()
      .from(suppliers)
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    
    db
      .select({ count: sql`count(*)` })
      .from(suppliers)
      .where(whereClause)
  ])

  return {
    suppliers: results,
    pagination: {
      total: Number(totalCount[0].count),
      page,
      limit,
      totalPages: Math.ceil(Number(totalCount[0].count) / limit)
    }
  }
}

// Get supplier by ID
export async function getSupplierById(id) {
  const result = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.id, id))
    .limit(1)

  return result[0] || null
}

// Get supplier by code
export async function getSupplierByCode(supplierCode) {
  const result = await db
    .select()
    .from(suppliers)
    .where(eq(suppliers.supplierCode, supplierCode))
    .limit(1)

  return result[0] || null
}

// Create new supplier
export async function createSupplier(supplierData) {
  const result = await db
    .insert(suppliers)
    .values(supplierData)
    .returning()

  return result[0]
}

// Update supplier
export async function updateSupplier(id, supplierData) {
  const result = await db
    .update(suppliers)
    .set({
      ...supplierData,
      updatedAt: new Date()
    })
    .where(eq(suppliers.id, id))
    .returning()

  return result[0] || null
}

// Deactivate supplier (soft delete)
export async function deactivateSupplier(id) {
  const result = await db
    .update(suppliers)
    .set({
      isActive: false,
      updatedAt: new Date()
    })
    .where(eq(suppliers.id, id))
    .returning()

  return result[0] || null
}

// Get supplier with active price lists
export async function getSupplierWithPriceLists(supplierId) {
  const supplier = await getSupplierById(supplierId)
  if (!supplier) return null

  const activePriceLists = await db
    .select()
    .from(priceLists)
    .where(
      and(
        eq(priceLists.supplierId, supplierId),
        eq(priceLists.isActive, true)
      )
    )
    .orderBy(desc(priceLists.effectiveDate))

  return {
    ...supplier,
    priceLists: activePriceLists
  }
}

// Get suppliers with pending price lists
export async function getSuppliersWithPendingPriceLists() {
  const result = await db
    .select({
      supplier: suppliers,
      pendingCount: sql`count(${priceLists.id})`
    })
    .from(suppliers)
    .leftJoin(
      priceLists,
      and(
        eq(suppliers.id, priceLists.supplierId),
        eq(priceLists.status, 'pending')
      )
    )
    .where(eq(suppliers.isActive, true))
    .groupBy(suppliers.id)
    .having(sql`count(${priceLists.id}) > 0`)

  return result
}

// Bulk update suppliers (for vendor->supplier migration)
export async function bulkUpdateSuppliers(updates) {
  const results = []
  
  for (const update of updates) {
    const { id, ...data } = update
    const result = await updateSupplier(id, data)
    results.push(result)
  }
  
  return results
}

// Check if supplier exists by email
export async function supplierExistsByEmail(email) {
  const result = await db
    .select({ count: sql`count(*)` })
    .from(suppliers)
    .where(eq(suppliers.email, email))

  return Number(result[0].count) > 0
}

// Get supplier statistics
export async function getSupplierStatistics() {
  const stats = await db
    .select({
      totalSuppliers: sql`count(distinct ${suppliers.id})`,
      activeSuppliers: sql`count(distinct ${suppliers.id}) filter (where ${suppliers.isActive} = true)`,
      totalPriceLists: sql`count(distinct ${priceLists.id})`,
      pendingPriceLists: sql`count(distinct ${priceLists.id}) filter (where ${priceLists.status} = 'pending')`
    })
    .from(suppliers)
    .leftJoin(priceLists, eq(suppliers.id, priceLists.supplierId))

  return stats[0]
}

// ==================== SUPPLIER INVENTORY INTEGRATION ====================

/**
 * Get supplier with their products and inventory levels
 */
export async function getSupplierWithInventory(supplierId) {
  const supplier = await getSupplierById(supplierId);
  if (!supplier) {
    return null;
  }

  // Get products for this supplier with inventory levels
  const supplierProducts = await db
    .select({
      // Product fields
      productId: products.id,
      sku: products.sku,
      name: products.name,
      description: products.description,
      category: products.category,
      unitPrice: products.unitPrice,
      costPrice: products.costPrice,
      isActive: products.isActive,
      // Inventory summary
      totalOnHand: sql`COALESCE(SUM(${inventory.quantityOnHand}), 0)`,
      totalAvailable: sql`COALESCE(SUM(${inventory.quantityAvailable}), 0)`,
      totalReserved: sql`COALESCE(SUM(${inventory.quantityReserved}), 0)`,
      warehouseCount: sql`COUNT(DISTINCT ${inventory.warehouseId})`,
      averageCost: sql`AVG(${inventory.averageCost})`,
      lastPurchaseCost: sql`MAX(${inventory.lastPurchaseCost})`,
      lastMovement: sql`MAX(${inventory.lastMovement})`,
    })
    .from(products)
    .leftJoin(inventory, eq(products.id, inventory.productId))
    .where(eq(products.supplierId, supplierId))
    .groupBy(
      products.id,
      products.sku,
      products.name,
      products.description,
      products.category,
      products.unitPrice,
      products.costPrice,
      products.isActive
    )
    .orderBy(products.name);

  return {
    ...supplier,
    products: supplierProducts
  };
}

/**
 * Update inventory on purchase order receipt
 */
export async function updateInventoryOnPurchaseReceipt(receiptData) {
  const {
    supplierId,
    referenceNumber,
    items, // Array of { productId, warehouseId, quantity, unitCost }
    performedBy,
    notes = null
  } = receiptData;

  return await db.transaction(async (tx) => {
    const movements = [];

    for (const item of items) {
      const { productId, warehouseId, quantity, unitCost } = item;

      // Get or create inventory record
      let inventoryRecord = await tx
        .select()
        .from(inventory)
        .where(
          and(
            eq(inventory.productId, productId),
            eq(inventory.warehouseId, warehouseId)
          )
        )
        .limit(1);

      if (!inventoryRecord[0]) {
        // Create new inventory record
        inventoryRecord = await tx
          .insert(inventory)
          .values({
            productId,
            warehouseId,
            quantityOnHand: quantity,
            quantityAvailable: quantity,
            quantityReserved: 0,
            quantityInTransit: 0,
            lastStockCheck: new Date(),
            stockStatus: quantity > 0 ? 'in_stock' : 'out_of_stock',
            reorderPoint: 0,
            reorderQuantity: 0,
            minStockLevel: 0,
            averageCost: unitCost,
            lastPurchaseCost: unitCost,
            metadata: {}
          })
          .returning();
      } else {
        // Update existing inventory
        const current = inventoryRecord[0];
        const newQuantity = current.quantityOnHand + quantity;
        const newAverageCost = current.quantityOnHand === 0 ? unitCost :
          ((current.averageCost * current.quantityOnHand) + (unitCost * quantity)) / newQuantity;

        inventoryRecord = await tx
          .update(inventory)
          .set({
            quantityOnHand: newQuantity,
            quantityAvailable: current.quantityAvailable + quantity,
            averageCost: newAverageCost,
            lastPurchaseCost: unitCost,
            lastMovement: new Date(),
            stockStatus: newQuantity > 0 ? 'in_stock' : 'out_of_stock',
            updatedAt: new Date()
          })
          .where(eq(inventory.id, current.id))
          .returning();
      }

      // Record movement
      const movement = await tx
        .insert(inventoryMovements)
        .values({
          inventoryId: inventoryRecord[0].id,
          productId,
          warehouseId,
          movementType: 'purchase',
          quantity: quantity,
          unitCost: unitCost,
          totalCost: unitCost * quantity,
          referenceType: 'purchase_order',
          referenceNumber,
          performedBy,
          notes: notes || `Purchase receipt from supplier`,
          quantityAfter: inventoryRecord[0].quantityOnHand,
          runningTotal: inventoryRecord[0].quantityOnHand
        })
        .returning();

      movements.push(movement[0]);
    }

    return movements;
  });
}

/**
 * Get supplier lead times analysis
 */
export async function getSupplierLeadTimes(supplierId, params = {}) {
  const { productId = null, dateFrom = null, dateTo = null } = params;

  let whereConditions = [
    eq(products.supplierId, supplierId),
    eq(inventoryMovements.movementType, 'purchase')
  ];

  if (productId) {
    whereConditions.push(eq(inventoryMovements.productId, productId));
  }

  if (dateFrom) {
    whereConditions.push(sql`${inventoryMovements.createdAt} >= ${new Date(dateFrom)}`);
  }

  if (dateTo) {
    whereConditions.push(sql`${inventoryMovements.createdAt} <= ${new Date(dateTo)}`);
  }

  const leadTimeData = await db
    .select({
      productId: products.id,
      productSku: products.sku,
      productName: products.name,
      totalDeliveries: sql`COUNT(*)`,
      averageLeadTime: sql`AVG(EXTRACT(days FROM ${inventoryMovements.createdAt} - LAG(${inventoryMovements.createdAt}) OVER (PARTITION BY ${products.id} ORDER BY ${inventoryMovements.createdAt})))`,
      minLeadTime: sql`MIN(EXTRACT(days FROM ${inventoryMovements.createdAt} - LAG(${inventoryMovements.createdAt}) OVER (PARTITION BY ${products.id} ORDER BY ${inventoryMovements.createdAt})))`,
      maxLeadTime: sql`MAX(EXTRACT(days FROM ${inventoryMovements.createdAt} - LAG(${inventoryMovements.createdAt}) OVER (PARTITION BY ${products.id} ORDER BY ${inventoryMovements.createdAt})))`,
      lastDelivery: sql`MAX(${inventoryMovements.createdAt})`,
      totalQuantityReceived: sql`SUM(${inventoryMovements.quantity})`,
      averageOrderQuantity: sql`AVG(${inventoryMovements.quantity})`
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .where(and(...whereConditions))
    .groupBy(products.id, products.sku, products.name)
    .orderBy(products.name);

  return leadTimeData;
}

/**
 * Generate reorder suggestions for supplier
 */
export async function getSupplierReorderSuggestions(supplierId) {
  const suggestions = await db
    .select({
      productId: products.id,
      productSku: products.sku,
      productName: products.name,
      category: products.category,
      totalOnHand: sql`SUM(${inventory.quantityOnHand})`,
      totalAvailable: sql`SUM(${inventory.quantityAvailable})`,
      totalReorderPoint: sql`SUM(COALESCE(${inventory.reorderPoint}, 0))`,
      totalReorderQuantity: sql`SUM(COALESCE(${inventory.reorderQuantity}, 0))`,
      averageCost: sql`AVG(${inventory.averageCost})`,
      lastPurchaseCost: sql`MAX(${inventory.lastPurchaseCost})`,
      warehouseCount: sql`COUNT(DISTINCT ${inventory.warehouseId})`,
      needsReorder: sql`BOOL_OR(${inventory.quantityAvailable} <= COALESCE(${inventory.reorderPoint}, 0))`
    })
    .from(products)
    .innerJoin(inventory, eq(products.id, inventory.productId))
    .where(
      and(
        eq(products.supplierId, supplierId),
        eq(products.isActive, true)
      )
    )
    .groupBy(products.id, products.sku, products.name, products.category)
    .having(sql`BOOL_OR(${inventory.quantityAvailable} <= COALESCE(${inventory.reorderPoint}, 0))`)
    .orderBy(
      desc(sql`SUM(COALESCE(${inventory.reorderPoint}, 0)) - SUM(${inventory.quantityAvailable})`)
    );

  return suggestions;
}
