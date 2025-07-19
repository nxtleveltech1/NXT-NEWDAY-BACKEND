import { eq, and, sql, desc, asc, gte, lte, inArray } from 'drizzle-orm'
import { db } from '../config/database.js'
import { priceLists, priceListItems, suppliers, products } from './schema.js'

// Get price lists by supplier ID
export async function getPriceListsBySupplier(supplierId) {
  try {
    const result = await db
      .select()
      .from(priceLists)
      .where(eq(priceLists.supplierId, supplierId))
      .orderBy(desc(priceLists.createdAt))
    
    return result
  } catch (error) {
    console.error('Error getting price lists by supplier:', error)
    throw error
  }
}

// Get all price lists with optional filtering
export async function getPriceLists(params = {}) {
  const {
    page = 1,
    limit = 10,
    supplierId = null,
    status = null,
    isActive = null,
    sortBy = 'createdAt',
    sortOrder = 'desc'
  } = params

  const offset = (page - 1) * limit
  const orderBy = sortOrder === 'asc' ? asc(priceLists[sortBy]) : desc(priceLists[sortBy])

  let conditions = []
  
  if (supplierId) {
    conditions.push(eq(priceLists.supplierId, supplierId))
  }

  if (status) {
    conditions.push(eq(priceLists.status, status))
  }

  if (isActive !== null) {
    conditions.push(eq(priceLists.isActive, isActive))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const [results, totalCount] = await Promise.all([
    db
      .select({
        priceList: priceLists,
        supplier: suppliers
      })
      .from(priceLists)
      .leftJoin(suppliers, eq(priceLists.supplierId, suppliers.id))
      .where(whereClause)
      .orderBy(orderBy)
      .limit(limit)
      .offset(offset),
    
    db
      .select({ count: sql`count(*)` })
      .from(priceLists)
      .where(whereClause)
  ])

  return {
    priceLists: results,
    pagination: {
      total: Number(totalCount[0].count),
      page,
      limit,
      totalPages: Math.ceil(Number(totalCount[0].count) / limit)
    }
  }
}

// Get price list by ID with items
export async function getPriceListById(id) {
  const priceList = await db
    .select({
      priceList: priceLists,
      supplier: suppliers
    })
    .from(priceLists)
    .leftJoin(suppliers, eq(priceLists.supplierId, suppliers.id))
    .where(eq(priceLists.id, id))
    .limit(1)

  if (!priceList[0]) return null

  const items = await db
    .select()
    .from(priceListItems)
    .where(eq(priceListItems.priceListId, id))
    .orderBy(asc(priceListItems.sku))

  return {
    ...priceList[0].priceList,
    supplier: priceList[0].supplier,
    items
  }
}

// Create new price list
export async function createPriceList(priceListData) {
  const result = await db
    .insert(priceLists)
    .values({
      ...priceListData,
      status: 'pending',
      version: 1
    })
    .returning()

  return result[0]
}

// Create price list items
export async function createPriceListItems(items) {
  if (!items || items.length === 0) return []

  const result = await db
    .insert(priceListItems)
    .values(items)
    .returning()

  return result
}

// Update price list status
export async function updatePriceListStatus(id, status, approvedBy = null) {
  const updateData = {
    status,
    updatedAt: new Date()
  }

  if (status === 'approved' && approvedBy) {
    updateData.approvedBy = approvedBy
    updateData.approvedAt = new Date()
  }

  const result = await db
    .update(priceLists)
    .set(updateData)
    .where(eq(priceLists.id, id))
    .returning()

  return result[0] || null
}

// Activate price list (deactivate others for same supplier)
export async function activatePriceList(id) {
  // Get the price list to activate
  const priceList = await db
    .select()
    .from(priceLists)
    .where(eq(priceLists.id, id))
    .limit(1)

  if (!priceList[0] || priceList[0].status !== 'approved') {
    throw new Error('Price list must be approved before activation')
  }

  // Start transaction
  const result = await db.transaction(async (tx) => {
    // Deactivate all other price lists for this supplier
    await tx
      .update(priceLists)
      .set({
        isActive: false,
        updatedAt: new Date()
      })
      .where(
        and(
          eq(priceLists.supplierId, priceList[0].supplierId),
          eq(priceLists.isActive, true)
        )
      )

    // Activate the selected price list
    const activated = await tx
      .update(priceLists)
      .set({
        isActive: true,
        effectiveDate: new Date(),
        updatedAt: new Date()
      })
      .where(eq(priceLists.id, id))
      .returning()

    return activated[0]
  })

  return result
}

// Get active price for a product from supplier
export async function getSupplierPrice(supplierId, sku, quantity = 1) {
  // Get active price list for supplier
  const activePriceList = await db
    .select()
    .from(priceLists)
    .where(
      and(
        eq(priceLists.supplierId, supplierId),
        eq(priceLists.isActive, true)
      )
    )
    .limit(1)

  if (!activePriceList[0]) return null

  // Get price list item for the SKU
  const priceItem = await db
    .select()
    .from(priceListItems)
    .where(
      and(
        eq(priceListItems.priceListId, activePriceList[0].id),
        eq(priceListItems.sku, sku)
      )
    )
    .limit(1)

  if (!priceItem[0]) return null

  // Calculate price based on quantity tiers
  const tierPricing = priceItem[0].tierPricing
  let unitPrice = priceItem[0].unitPrice

  if (tierPricing && Array.isArray(tierPricing)) {
    // Find applicable tier
    const applicableTier = tierPricing
      .filter(tier => quantity >= tier.minQuantity)
      .sort((a, b) => b.minQuantity - a.minQuantity)[0]

    if (applicableTier) {
      unitPrice = applicableTier.price
    }
  }

  return {
    sku: priceItem[0].sku,
    unitPrice,
    currency: priceItem[0].currency,
    quantity,
    totalPrice: unitPrice * quantity,
    minimumOrderQuantity: priceItem[0].minimumOrderQuantity,
    priceListId: activePriceList[0].id,
    supplierId
  }
}

// Get price history for a SKU from supplier
export async function getSupplierPriceHistory(supplierId, sku, limit = 10) {
  const history = await db
    .select({
      priceList: priceLists,
      priceItem: priceListItems
    })
    .from(priceLists)
    .innerJoin(
      priceListItems,
      and(
        eq(priceLists.id, priceListItems.priceListId),
        eq(priceListItems.sku, sku)
      )
    )
    .where(eq(priceLists.supplierId, supplierId))
    .orderBy(desc(priceLists.createdAt))
    .limit(limit)

  return history.map(h => ({
    ...h.priceItem,
    effectiveDate: h.priceList.effectiveDate,
    status: h.priceList.status,
    version: h.priceList.version
  }))
}

// Delete price list (only if pending)
export async function deletePriceList(id) {
  // Check if price list is pending
  const priceList = await db
    .select()
    .from(priceLists)
    .where(eq(priceLists.id, id))
    .limit(1)

  if (!priceList[0] || priceList[0].status !== 'pending') {
    throw new Error('Only pending price lists can be deleted')
  }

  // Delete items first, then price list
  await db.transaction(async (tx) => {
    await tx
      .delete(priceListItems)
      .where(eq(priceListItems.priceListId, id))

    await tx
      .delete(priceLists)
      .where(eq(priceLists.id, id))
  })

  return true
}

// Bulk get prices for multiple SKUs
export async function getBulkSupplierPrices(supplierId, skus) {
  if (!skus || skus.length === 0) return []

  // Get active price list
  const activePriceList = await db
    .select()
    .from(priceLists)
    .where(
      and(
        eq(priceLists.supplierId, supplierId),
        eq(priceLists.isActive, true)
      )
    )
    .limit(1)

  if (!activePriceList[0]) return []

  // Get all price items for the SKUs
  const priceItems = await db
    .select()
    .from(priceListItems)
    .where(
      and(
        eq(priceListItems.priceListId, activePriceList[0].id),
        inArray(priceListItems.sku, skus)
      )
    )

  return priceItems.map(item => ({
    ...item,
    priceListId: activePriceList[0].id,
    supplierId
  }))
}

// Get price list statistics
export async function getPriceListStatistics(supplierId = null) {
  let conditions = []
  if (supplierId) {
    conditions.push(eq(priceLists.supplierId, supplierId))
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined

  const stats = await db
    .select({
      totalPriceLists: sql`count(distinct ${priceLists.id})`,
      pendingPriceLists: sql`count(distinct ${priceLists.id}) filter (where ${priceLists.status} = 'pending')`,
      approvedPriceLists: sql`count(distinct ${priceLists.id}) filter (where ${priceLists.status} = 'approved')`,
      activePriceLists: sql`count(distinct ${priceLists.id}) filter (where ${priceLists.isActive} = true)`,
      totalItems: sql`count(distinct ${priceListItems.id})`,
      uniqueSkus: sql`count(distinct ${priceListItems.sku})`
    })
    .from(priceLists)
    .leftJoin(priceListItems, eq(priceLists.id, priceListItems.priceListId))
    .where(whereClause)

  return stats[0]
}