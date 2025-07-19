import { 
  supplierPurchaseOrders, 
  supplierPurchaseOrderItems, 
  purchaseOrderReceipts, 
  purchaseOrderReceiptItems,
  suppliers,
  products,
  priceListItems,
  inventory,
  inventoryMovements
} from './schema.js';
import { eq, and, desc, sql, inArray, gte, lte, isNull, count, sum } from 'drizzle-orm';
import { db } from './index.js';

/**
 * Supplier Purchase Order Management Queries
 * These handle the procurement workflow from suppliers
 */

// ==================== PURCHASE ORDER CREATION ====================

/**
 * Create a new supplier purchase order
 * @param {Object} orderData - Purchase order data
 * @param {Array} items - Array of order items
 * @returns {Object} Created purchase order with items
 */
export async function createSupplierPurchaseOrder(orderData, items = []) {
  return await db.transaction(async (tx) => {
    // Create the purchase order
    const [purchaseOrder] = await tx
      .insert(supplierPurchaseOrders)
      .values({
        ...orderData,
        status: orderData.status || 'draft',
        approvalStatus: orderData.approvalStatus || 'pending'
      })
      .returning();

    // Create order items if provided
    const orderItems = [];
    if (items.length > 0) {
      const itemsWithOrderId = items.map(item => ({
        ...item,
        supplierPurchaseOrderId: purchaseOrder.id,
        lineTotal: parseFloat(item.unitPrice) * parseFloat(item.quantityOrdered) - parseFloat(item.discountAmount || 0)
      }));

      const createdItems = await tx
        .insert(supplierPurchaseOrderItems)
        .values(itemsWithOrderId)
        .returning();

      orderItems.push(...createdItems);

      // Update order totals
      const subtotal = orderItems.reduce((sum, item) => sum + parseFloat(item.lineTotal), 0);
      await tx
        .update(supplierPurchaseOrders)
        .set({
          subtotal: subtotal.toString(),
          totalAmount: (subtotal + parseFloat(orderData.taxAmount || 0) + parseFloat(orderData.shippingAmount || 0) - parseFloat(orderData.discountAmount || 0)).toString()
        })
        .where(eq(supplierPurchaseOrders.id, purchaseOrder.id));
    }

    return { ...purchaseOrder, items: orderItems };
  });
}

/**
 * Create purchase order from price list items
 * @param {string} supplierId - Supplier ID
 * @param {Array} priceListItemIds - Array of price list item IDs
 * @param {Object} orderOptions - Additional order options
 * @returns {Object} Created purchase order
 */
export async function createPurchaseOrderFromPriceList(supplierId, priceListItemIds, orderOptions = {}) {
  return await db.transaction(async (tx) => {
    // Get price list items with current pricing
    const priceItems = await tx
      .select({
        id: priceListItems.id,
        sku: priceListItems.sku,
        description: priceListItems.description,
        unitPrice: priceListItems.unitPrice,
        minQuantity: priceListItems.minQuantity,
        priceListId: priceListItems.priceListId
      })
      .from(priceListItems)
      .where(inArray(priceListItems.id, priceListItemIds));

    if (priceItems.length === 0) {
      throw new Error('No valid price list items found');
    }

    // Create purchase order
    const orderData = {
      supplierId,
      priceListId: priceItems[0].priceListId,
      status: 'draft',
      approvalStatus: 'pending',
      ...orderOptions
    };

    const [purchaseOrder] = await tx
      .insert(supplierPurchaseOrders)
      .values(orderData)
      .returning();

    // Create order items from price list items
    const orderItems = priceItems.map(item => ({
      supplierPurchaseOrderId: purchaseOrder.id,
      priceListItemId: item.id,
      sku: item.sku,
      productName: item.description || item.sku,
      quantityOrdered: orderOptions.defaultQuantity || item.minQuantity || 1,
      unitPrice: item.unitPrice,
      lineTotal: parseFloat(item.unitPrice) * (orderOptions.defaultQuantity || item.minQuantity || 1)
    }));

    const createdItems = await tx
      .insert(supplierPurchaseOrderItems)
      .values(orderItems)
      .returning();

    // Update order totals
    const subtotal = createdItems.reduce((sum, item) => sum + parseFloat(item.lineTotal), 0);
    await tx
      .update(supplierPurchaseOrders)
      .set({
        subtotal: subtotal.toString(),
        totalAmount: subtotal.toString()
      })
      .where(eq(supplierPurchaseOrders.id, purchaseOrder.id));

    return { ...purchaseOrder, items: createdItems };
  });
}

// ==================== PURCHASE ORDER RETRIEVAL ====================

/**
 * Get supplier purchase order by ID with items and supplier details
 * @param {string} id - Purchase order ID
 * @returns {Object|null} Purchase order with related data
 */
export async function getSupplierPurchaseOrderById(id) {
  const [purchaseOrder] = await db
    .select({
      // Purchase order fields
      id: supplierPurchaseOrders.id,
      poNumber: supplierPurchaseOrders.poNumber,
      supplierId: supplierPurchaseOrders.supplierId,
      orderDate: supplierPurchaseOrders.orderDate,
      expectedDeliveryDate: supplierPurchaseOrders.expectedDeliveryDate,
      status: supplierPurchaseOrders.status,
      approvalStatus: supplierPurchaseOrders.approvalStatus,
      subtotal: supplierPurchaseOrders.subtotal,
      taxAmount: supplierPurchaseOrders.taxAmount,
      totalAmount: supplierPurchaseOrders.totalAmount,
      currency: supplierPurchaseOrders.currency,
      paymentTerms: supplierPurchaseOrders.paymentTerms,
      deliveryAddress: supplierPurchaseOrders.deliveryAddress,
      notes: supplierPurchaseOrders.notes,
      createdAt: supplierPurchaseOrders.createdAt,
      // Supplier fields
      supplierName: suppliers.companyName,
      supplierEmail: suppliers.email,
      supplierCode: suppliers.supplierCode
    })
    .from(supplierPurchaseOrders)
    .leftJoin(suppliers, eq(supplierPurchaseOrders.supplierId, suppliers.id))
    .where(eq(supplierPurchaseOrders.id, id));

  if (!purchaseOrder) return null;

  // Get order items
  const items = await db
    .select()
    .from(supplierPurchaseOrderItems)
    .where(eq(supplierPurchaseOrderItems.supplierPurchaseOrderId, id))
    .orderBy(supplierPurchaseOrderItems.createdAt);

  return { ...purchaseOrder, items };
}

/**
 * Get supplier purchase orders with filtering and pagination
 * @param {Object} options - Filter and pagination options
 * @returns {Object} Purchase orders with pagination info
 */
export async function getSupplierPurchaseOrders(options = {}) {
  const {
    supplierId,
    status,
    approvalStatus,
    dateFrom,
    dateTo,
    limit = 50,
    offset = 0,
    orderBy = 'created_at',
    orderDirection = 'desc'
  } = options;

  let query = db
    .select({
      id: supplierPurchaseOrders.id,
      poNumber: supplierPurchaseOrders.poNumber,
      supplierId: supplierPurchaseOrders.supplierId,
      supplierName: suppliers.companyName,
      orderDate: supplierPurchaseOrders.orderDate,
      expectedDeliveryDate: supplierPurchaseOrders.expectedDeliveryDate,
      status: supplierPurchaseOrders.status,
      approvalStatus: supplierPurchaseOrders.approvalStatus,
      totalAmount: supplierPurchaseOrders.totalAmount,
      currency: supplierPurchaseOrders.currency,
      createdAt: supplierPurchaseOrders.createdAt
    })
    .from(supplierPurchaseOrders)
    .leftJoin(suppliers, eq(supplierPurchaseOrders.supplierId, suppliers.id));

  // Apply filters
  const conditions = [];
  if (supplierId) conditions.push(eq(supplierPurchaseOrders.supplierId, supplierId));
  if (status) conditions.push(eq(supplierPurchaseOrders.status, status));
  if (approvalStatus) conditions.push(eq(supplierPurchaseOrders.approvalStatus, approvalStatus));
  if (dateFrom) conditions.push(gte(supplierPurchaseOrders.orderDate, dateFrom));
  if (dateTo) conditions.push(lte(supplierPurchaseOrders.orderDate, dateTo));

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  // Apply ordering
  const orderColumn = supplierPurchaseOrders[orderBy] || supplierPurchaseOrders.createdAt;
  query = orderDirection === 'asc' 
    ? query.orderBy(orderColumn)
    : query.orderBy(desc(orderColumn));

  // Apply pagination
  const results = await query.limit(limit).offset(offset);

  // Get total count
  let countQuery = db
    .select({ count: count() })
    .from(supplierPurchaseOrders);

  if (conditions.length > 0) {
    countQuery = countQuery.where(and(...conditions));
  }

  const [{ count: totalCount }] = await countQuery;

  return {
    data: results,
    pagination: {
      total: totalCount,
      limit,
      offset,
      pages: Math.ceil(totalCount / limit),
      currentPage: Math.floor(offset / limit) + 1
    }
  };
}

// ==================== PURCHASE ORDER UPDATES ====================

/**
 * Update supplier purchase order status
 * @param {string} id - Purchase order ID
 * @param {string} status - New status
 * @param {Object} additionalData - Additional fields to update
 * @returns {Object} Updated purchase order
 */
export async function updateSupplierPurchaseOrderStatus(id, status, additionalData = {}) {
  const updateData = { status, ...additionalData };

  // Set timestamp fields based on status
  switch (status) {
    case 'approved':
      updateData.approvedAt = new Date();
      updateData.approvalStatus = 'approved';
      break;
    case 'sent':
      updateData.sentAt = new Date();
      break;
    case 'acknowledged':
      updateData.acknowledgedAt = new Date();
      break;
    case 'delivered':
      updateData.deliveredAt = new Date();
      break;
  }

  const [updatedOrder] = await db
    .update(supplierPurchaseOrders)
    .set(updateData)
    .where(eq(supplierPurchaseOrders.id, id))
    .returning();

  return updatedOrder;
}

/**
 * Update purchase order item quantities
 * @param {string} itemId - Purchase order item ID
 * @param {Object} quantities - Quantity updates
 * @returns {Object} Updated item
 */
export async function updatePurchaseOrderItemQuantities(itemId, quantities) {
  const updateData = { ...quantities };

  // Recalculate line total if unit price or quantity changed
  if (quantities.quantityOrdered || quantities.unitPrice) {
    const [currentItem] = await db
      .select({ unitPrice: supplierPurchaseOrderItems.unitPrice, quantityOrdered: supplierPurchaseOrderItems.quantityOrdered })
      .from(supplierPurchaseOrderItems)
      .where(eq(supplierPurchaseOrderItems.id, itemId));

    if (currentItem) {
      const newQuantity = quantities.quantityOrdered || currentItem.quantityOrdered;
      const newUnitPrice = quantities.unitPrice || currentItem.unitPrice;
      updateData.lineTotal = (parseFloat(newUnitPrice) * parseFloat(newQuantity)).toString();
    }
  }

  const [updatedItem] = await db
    .update(supplierPurchaseOrderItems)
    .set(updateData)
    .where(eq(supplierPurchaseOrderItems.id, itemId))
    .returning();

  return updatedItem;
}

// ==================== PURCHASE ORDER RECEIPTS ====================

/**
 * Create a receipt for a purchase order
 * @param {string} supplierPurchaseOrderId - Purchase order ID
 * @param {Object} receiptData - Receipt details
 * @param {Array} receiptItems - Items being received
 * @returns {Object} Created receipt
 */
export async function createPurchaseOrderReceipt(supplierPurchaseOrderId, receiptData, receiptItems = []) {
  return await db.transaction(async (tx) => {
    // Create receipt
    const [receipt] = await tx
      .insert(purchaseOrderReceipts)
      .values({
        ...receiptData,
        supplierPurchaseOrderId,
        status: receiptData.status || 'draft'
      })
      .returning();

    // Create receipt items
    const createdReceiptItems = [];
    if (receiptItems.length > 0) {
      const itemsWithReceiptId = receiptItems.map(item => ({
        ...item,
        receiptId: receipt.id
      }));

      const items = await tx
        .insert(purchaseOrderReceiptItems)
        .values(itemsWithReceiptId)
        .returning();

      createdReceiptItems.push(...items);

      // Update purchase order item quantities
      for (const item of items) {
        await tx
          .update(supplierPurchaseOrderItems)
          .set({
            quantityReceived: sql`${supplierPurchaseOrderItems.quantityReceived} + ${item.quantityReceived}`,
            quantityAccepted: sql`${supplierPurchaseOrderItems.quantityAccepted} + ${item.quantityAccepted}`,
            quantityRejected: sql`${supplierPurchaseOrderItems.quantityRejected} + ${item.quantityRejected}`
          })
          .where(eq(supplierPurchaseOrderItems.id, item.supplierPurchaseOrderItemId));
      }
    }

    return { ...receipt, items: createdReceiptItems };
  });
}

/**
 * Process receipt and update inventory
 * @param {string} receiptId - Receipt ID
 * @param {string} processedBy - User processing the receipt
 * @returns {Object} Processing results
 */
export async function processReceiptToInventory(receiptId, processedBy) {
  return await db.transaction(async (tx) => {
    // Get receipt with items
    const [receipt] = await tx
      .select()
      .from(purchaseOrderReceipts)
      .where(eq(purchaseOrderReceipts.id, receiptId));

    if (!receipt) {
      throw new Error('Receipt not found');
    }

    const receiptItems = await tx
      .select()
      .from(purchaseOrderReceiptItems)
      .where(eq(purchaseOrderReceiptItems.receiptId, receiptId));

    const inventoryUpdates = [];
    const movementRecords = [];

    for (const item of receiptItems) {
      if (item.quantityAccepted > 0) {
        // Find existing inventory record
        const [existingInventory] = await tx
          .select()
          .from(inventory)
          .where(
            and(
              eq(inventory.productId, item.productId),
              eq(inventory.warehouseId, item.warehouseId)
            )
          );

        if (existingInventory) {
          // Update existing inventory
          await tx
            .update(inventory)
            .set({
              quantityOnHand: sql`${inventory.quantityOnHand} + ${item.quantityAccepted}`,
              quantityAvailable: sql`${inventory.quantityAvailable} + ${item.quantityAccepted}`,
              lastMovement: new Date(),
              lastPurchaseCost: item.unitCost
            })
            .where(eq(inventory.id, existingInventory.id));

          inventoryUpdates.push({
            action: 'updated',
            inventoryId: existingInventory.id,
            quantityAdded: item.quantityAccepted
          });
        } else {
          // Create new inventory record
          const [newInventory] = await tx
            .insert(inventory)
            .values({
              productId: item.productId,
              warehouseId: item.warehouseId,
              locationId: item.locationId,
              quantityOnHand: item.quantityAccepted,
              quantityAvailable: item.quantityAccepted,
              lastMovement: new Date(),
              lastPurchaseCost: item.unitCost,
              averageCost: item.unitCost
            })
            .returning();

          inventoryUpdates.push({
            action: 'created',
            inventoryId: newInventory.id,
            quantityAdded: item.quantityAccepted
          });
        }

        // Create inventory movement record
        const movementRecord = {
          productId: item.productId,
          warehouseId: item.warehouseId,
          movementType: 'purchase',
          quantity: item.quantityAccepted,
          unitCost: item.unitCost,
          totalCost: item.totalCost,
          referenceType: 'purchase_order_receipt',
          referenceId: receiptId,
          referenceNumber: receipt.receiptNumber,
          performedBy: processedBy,
          notes: `Received from PO receipt ${receipt.receiptNumber}`,
          batchNumber: item.batchNumber,
          serialNumbers: item.serialNumbers,
          expiryDate: item.expiryDate,
          quantityAfter: (existingInventory?.quantityOnHand || 0) + item.quantityAccepted,
          runningTotal: (existingInventory?.quantityOnHand || 0) + item.quantityAccepted
        };

        const [movement] = await tx
          .insert(inventoryMovements)
          .values(movementRecord)
          .returning();

        movementRecords.push(movement);
      }
    }

    // Update receipt status
    await tx
      .update(purchaseOrderReceipts)
      .set({
        status: 'completed',
        processedAt: new Date(),
        processedBy
      })
      .where(eq(purchaseOrderReceipts.id, receiptId));

    return {
      receiptId,
      inventoryUpdates,
      movementRecords,
      processedAt: new Date()
    };
  });
}

// ==================== ANALYTICS AND REPORTING ====================

/**
 * Get purchase order analytics
 * @param {Object} options - Filter options
 * @returns {Object} Analytics data
 */
export async function getPurchaseOrderAnalytics(options = {}) {
  const { dateFrom, dateTo, supplierId } = options;

  let baseQuery = db
    .select({
      totalOrders: count(),
      totalValue: sum(supplierPurchaseOrders.totalAmount),
      avgOrderValue: sql`AVG(${supplierPurchaseOrders.totalAmount})`,
      status: supplierPurchaseOrders.status
    })
    .from(supplierPurchaseOrders);

  const conditions = [];
  if (dateFrom) conditions.push(gte(supplierPurchaseOrders.orderDate, dateFrom));
  if (dateTo) conditions.push(lte(supplierPurchaseOrders.orderDate, dateTo));
  if (supplierId) conditions.push(eq(supplierPurchaseOrders.supplierId, supplierId));

  if (conditions.length > 0) {
    baseQuery = baseQuery.where(and(...conditions));
  }

  const statusAnalytics = await baseQuery
    .groupBy(supplierPurchaseOrders.status);

  // Get supplier performance data
  const supplierPerformance = await db
    .select({
      supplierId: suppliers.id,
      supplierName: suppliers.companyName,
      totalOrders: count(),
      totalValue: sum(supplierPurchaseOrders.totalAmount),
      avgDeliveryTime: sql`AVG(EXTRACT(DAY FROM (${supplierPurchaseOrders.deliveredAt} - ${supplierPurchaseOrders.orderDate})))`,
      onTimeDeliveryRate: sql`
        (COUNT(CASE WHEN ${supplierPurchaseOrders.deliveredAt} <= ${supplierPurchaseOrders.expectedDeliveryDate} THEN 1 END) * 100.0 / COUNT(*))
      `
    })
    .from(supplierPurchaseOrders)
    .leftJoin(suppliers, eq(supplierPurchaseOrders.supplierId, suppliers.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .groupBy(suppliers.id, suppliers.companyName);

  return {
    statusBreakdown: statusAnalytics,
    supplierPerformance,
    summary: {
      totalOrders: statusAnalytics.reduce((sum, item) => sum + Number(item.totalOrders), 0),
      totalValue: statusAnalytics.reduce((sum, item) => sum + Number(item.totalValue || 0), 0)
    }
  };
}

/**
 * Get pending approvals
 * @returns {Array} Purchase orders pending approval
 */
export async function getPendingApprovals() {
  return await db
    .select({
      id: supplierPurchaseOrders.id,
      poNumber: supplierPurchaseOrders.poNumber,
      supplierName: suppliers.companyName,
      totalAmount: supplierPurchaseOrders.totalAmount,
      orderDate: supplierPurchaseOrders.orderDate,
      createdBy: supplierPurchaseOrders.createdBy
    })
    .from(supplierPurchaseOrders)
    .leftJoin(suppliers, eq(supplierPurchaseOrders.supplierId, suppliers.id))
    .where(eq(supplierPurchaseOrders.approvalStatus, 'pending'))
    .orderBy(desc(supplierPurchaseOrders.createdAt));
}

/**
 * Get orders ready for receiving
 * @returns {Array} Purchase orders ready to receive
 */
export async function getOrdersReadyForReceiving() {
  return await db
    .select({
      id: supplierPurchaseOrders.id,
      poNumber: supplierPurchaseOrders.poNumber,
      supplierName: suppliers.companyName,
      expectedDeliveryDate: supplierPurchaseOrders.expectedDeliveryDate,
      totalAmount: supplierPurchaseOrders.totalAmount
    })
    .from(supplierPurchaseOrders)
    .leftJoin(suppliers, eq(supplierPurchaseOrders.supplierId, suppliers.id))
    .where(
      and(
        eq(supplierPurchaseOrders.status, 'in_transit'),
        lte(supplierPurchaseOrders.expectedDeliveryDate, new Date())
      )
    )
    .orderBy(supplierPurchaseOrders.expectedDeliveryDate);
}

export default {
  // Creation
  createSupplierPurchaseOrder,
  createPurchaseOrderFromPriceList,
  
  // Retrieval
  getSupplierPurchaseOrderById,
  getSupplierPurchaseOrders,
  
  // Updates
  updateSupplierPurchaseOrderStatus,
  updatePurchaseOrderItemQuantities,
  
  // Receipts
  createPurchaseOrderReceipt,
  processReceiptToInventory,
  
  // Analytics
  getPurchaseOrderAnalytics,
  getPendingApprovals,
  getOrdersReadyForReceiving
};