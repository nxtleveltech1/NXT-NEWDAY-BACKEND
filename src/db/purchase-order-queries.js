import { eq, desc, asc, and, or, sql, between, ilike } from 'drizzle-orm';
import { db } from '../config/database.js';
import { purchaseOrders, purchaseOrderItems, customers, products } from './schema.js';

/**
 * Purchase Order Query Functions
 * These handle comprehensive purchase order management for customer purchase history
 */

// ==================== PURCHASE ORDER CRUD ====================

/**
 * Create a new purchase order with items
 */
export async function createPurchaseOrder(orderData) {
  const { customerId, orderNumber, items, shippingAddress, billingAddress, metadata = {} } = orderData;

  return await db.transaction(async (tx) => {
    // Calculate totals
    let subtotal = 0;
    let totalTaxAmount = 0;
    const processedItems = [];

    for (const item of items) {
      const lineTotal = item.quantity * item.unitPrice;
      const discountAmount = (item.discountPercent || 0) * lineTotal / 100;
      const lineTotalAfterDiscount = lineTotal - discountAmount;
      const taxAmount = (item.taxRate || 0) * lineTotalAfterDiscount / 100;
      
      subtotal += lineTotalAfterDiscount;
      totalTaxAmount += taxAmount;
      
      processedItems.push({
        ...item,
        lineTotal: lineTotalAfterDiscount,
        discountAmount,
        taxAmount
      });
    }

    const shippingAmount = orderData.shippingAmount || 0;
    const totalAmount = subtotal + totalTaxAmount + shippingAmount;

    // Create purchase order
    const [newOrder] = await tx
      .insert(purchaseOrders)
      .values({
        orderNumber: orderNumber || `PO-${Date.now()}`,
        customerId,
        status: orderData.status || 'pending',
        subtotal,
        taxAmount: totalTaxAmount,
        shippingAmount,
        discountAmount: orderData.discountAmount || 0,
        totalAmount,
        currency: orderData.currency || 'USD',
        paymentStatus: orderData.paymentStatus || 'pending',
        paymentMethod: orderData.paymentMethod,
        paymentTerms: orderData.paymentTerms || 'NET30',
        shippingAddress: shippingAddress || {},
        billingAddress: billingAddress || {},
        notes: orderData.notes,
        internalNotes: orderData.internalNotes,
        referenceNumber: orderData.referenceNumber,
        createdBy: orderData.createdBy,
        metadata
      })
      .returning();

    // Create order items
    const orderItems = [];
    for (const item of processedItems) {
      const [orderItem] = await tx
        .insert(purchaseOrderItems)
        .values({
          purchaseOrderId: newOrder.id,
          productId: item.productId,
          sku: item.sku,
          productName: item.productName,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          discountPercent: item.discountPercent || 0,
          discountAmount: item.discountAmount,
          lineTotal: item.lineTotal,
          taxRate: item.taxRate || 0,
          taxAmount: item.taxAmount,
          warehouseId: item.warehouseId,
          notes: item.notes,
          metadata: item.metadata || {}
        })
        .returning();
      
      orderItems.push(orderItem);
    }

    return {
      ...newOrder,
      items: orderItems
    };
  });
}

/**
 * Get purchase order by ID with items
 */
export async function getPurchaseOrderById(id) {
  const order = await db
    .select({
      // Order fields
      id: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
      customerId: purchaseOrders.customerId,
      orderDate: purchaseOrders.orderDate,
      status: purchaseOrders.status,
      subtotal: purchaseOrders.subtotal,
      taxAmount: purchaseOrders.taxAmount,
      shippingAmount: purchaseOrders.shippingAmount,
      discountAmount: purchaseOrders.discountAmount,
      totalAmount: purchaseOrders.totalAmount,
      currency: purchaseOrders.currency,
      paymentStatus: purchaseOrders.paymentStatus,
      paymentMethod: purchaseOrders.paymentMethod,
      paymentTerms: purchaseOrders.paymentTerms,
      shippingAddress: purchaseOrders.shippingAddress,
      billingAddress: purchaseOrders.billingAddress,
      notes: purchaseOrders.notes,
      internalNotes: purchaseOrders.internalNotes,
      referenceNumber: purchaseOrders.referenceNumber,
      createdBy: purchaseOrders.createdBy,
      processedBy: purchaseOrders.processedBy,
      shippedDate: purchaseOrders.shippedDate,
      deliveredDate: purchaseOrders.deliveredDate,
      metadata: purchaseOrders.metadata,
      createdAt: purchaseOrders.createdAt,
      updatedAt: purchaseOrders.updatedAt,
      // Customer fields
      customerCode: customers.customerCode,
      companyName: customers.companyName,
      customerEmail: customers.email
    })
    .from(purchaseOrders)
    .innerJoin(customers, eq(purchaseOrders.customerId, customers.id))
    .where(eq(purchaseOrders.id, id))
    .limit(1);

  if (!order[0]) {
    return null;
  }

  // Get order items
  const items = await db
    .select({
      id: purchaseOrderItems.id,
      productId: purchaseOrderItems.productId,
      sku: purchaseOrderItems.sku,
      productName: purchaseOrderItems.productName,
      quantity: purchaseOrderItems.quantity,
      unitPrice: purchaseOrderItems.unitPrice,
      discountPercent: purchaseOrderItems.discountPercent,
      discountAmount: purchaseOrderItems.discountAmount,
      lineTotal: purchaseOrderItems.lineTotal,
      taxRate: purchaseOrderItems.taxRate,
      taxAmount: purchaseOrderItems.taxAmount,
      warehouseId: purchaseOrderItems.warehouseId,
      notes: purchaseOrderItems.notes,
      metadata: purchaseOrderItems.metadata,
      // Product details
      productCategory: products.category,
      productDescription: products.description
    })
    .from(purchaseOrderItems)
    .leftJoin(products, eq(purchaseOrderItems.productId, products.id))
    .where(eq(purchaseOrderItems.purchaseOrderId, id))
    .orderBy(purchaseOrderItems.createdAt);

  return {
    ...order[0],
    items
  };
}

/**
 * Get customer purchase orders with pagination and filtering
 */
export async function getCustomerPurchaseOrders(customerId, params = {}) {
  const {
    page = 1,
    pageSize = 10,
    status = null,
    paymentStatus = null,
    dateFrom = null,
    dateTo = null,
    sortBy = 'orderDate',
    sortOrder = 'desc'
  } = params;

  const offset = (page - 1) * pageSize;

  let whereConditions = [eq(purchaseOrders.customerId, customerId)];

  if (status) {
    whereConditions.push(eq(purchaseOrders.status, status));
  }

  if (paymentStatus) {
    whereConditions.push(eq(purchaseOrders.paymentStatus, paymentStatus));
  }

  if (dateFrom) {
    whereConditions.push(sql`${purchaseOrders.orderDate} >= ${new Date(dateFrom)}`);
  }

  if (dateTo) {
    whereConditions.push(sql`${purchaseOrders.orderDate} <= ${new Date(dateTo)}`);
  }

  const sortField = purchaseOrders[sortBy] || purchaseOrders.orderDate;
  const sortDirection = sortOrder === 'asc' ? asc : desc;

  const orders = await db
    .select({
      id: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
      orderDate: purchaseOrders.orderDate,
      status: purchaseOrders.status,
      totalAmount: purchaseOrders.totalAmount,
      currency: purchaseOrders.currency,
      paymentStatus: purchaseOrders.paymentStatus,
      referenceNumber: purchaseOrders.referenceNumber,
      itemCount: sql`COUNT(${purchaseOrderItems.id})`,
      createdAt: purchaseOrders.createdAt
    })
    .from(purchaseOrders)
    .leftJoin(purchaseOrderItems, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
    .where(and(...whereConditions))
    .groupBy(
      purchaseOrders.id,
      purchaseOrders.orderNumber,
      purchaseOrders.orderDate,
      purchaseOrders.status,
      purchaseOrders.totalAmount,
      purchaseOrders.currency,
      purchaseOrders.paymentStatus,
      purchaseOrders.referenceNumber,
      purchaseOrders.createdAt
    )
    .orderBy(sortDirection(sortField))
    .limit(pageSize)
    .offset(offset);

  // Get total count for pagination
  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(purchaseOrders)
    .where(and(...whereConditions));

  return {
    orders,
    pagination: {
      page,
      pageSize,
      totalCount: count,
      totalPages: Math.ceil(count / pageSize),
      hasNext: page < Math.ceil(count / pageSize),
      hasPrev: page > 1
    }
  };
}

/**
 * Search purchase orders across all customers
 */
export async function searchPurchaseOrders(searchTerm, params = {}) {
  const {
    page = 1,
    pageSize = 10,
    status = null,
    dateFrom = null,
    dateTo = null
  } = params;

  const offset = (page - 1) * pageSize;

  let whereConditions = [
    or(
      ilike(purchaseOrders.orderNumber, `%${searchTerm}%`),
      ilike(purchaseOrders.referenceNumber, `%${searchTerm}%`),
      ilike(customers.companyName, `%${searchTerm}%`),
      ilike(customers.customerCode, `%${searchTerm}%`)
    )
  ];

  if (status) {
    whereConditions.push(eq(purchaseOrders.status, status));
  }

  if (dateFrom) {
    whereConditions.push(sql`${purchaseOrders.orderDate} >= ${new Date(dateFrom)}`);
  }

  if (dateTo) {
    whereConditions.push(sql`${purchaseOrders.orderDate} <= ${new Date(dateTo)}`);
  }

  const orders = await db
    .select({
      id: purchaseOrders.id,
      orderNumber: purchaseOrders.orderNumber,
      orderDate: purchaseOrders.orderDate,
      status: purchaseOrders.status,
      totalAmount: purchaseOrders.totalAmount,
      currency: purchaseOrders.currency,
      paymentStatus: purchaseOrders.paymentStatus,
      referenceNumber: purchaseOrders.referenceNumber,
      customerId: purchaseOrders.customerId,
      customerCode: customers.customerCode,
      companyName: customers.companyName,
      createdAt: purchaseOrders.createdAt
    })
    .from(purchaseOrders)
    .innerJoin(customers, eq(purchaseOrders.customerId, customers.id))
    .where(and(...whereConditions))
    .orderBy(desc(purchaseOrders.orderDate))
    .limit(pageSize)
    .offset(offset);

  return orders;
}

/**
 * Update purchase order status
 */
export async function updatePurchaseOrderStatus(id, status, metadata = {}) {
  const updateData = {
    status,
    updatedAt: new Date(),
    metadata: {
      ...metadata,
      statusUpdatedAt: new Date().toISOString()
    }
  };

  // Add specific date fields based on status
  if (status === 'shipped' && !metadata.shippedDate) {
    updateData.shippedDate = new Date();
  }
  
  if (status === 'delivered' && !metadata.deliveredDate) {
    updateData.deliveredDate = new Date();
  }

  const [updatedOrder] = await db
    .update(purchaseOrders)
    .set(updateData)
    .where(eq(purchaseOrders.id, id))
    .returning();

  return updatedOrder;
}

/**
 * Update purchase order payment status
 */
export async function updatePurchaseOrderPaymentStatus(id, paymentStatus, paymentMethod = null) {
  const [updatedOrder] = await db
    .update(purchaseOrders)
    .set({
      paymentStatus,
      paymentMethod,
      updatedAt: new Date(),
      metadata: sql`${purchaseOrders.metadata} || ${{
        paymentStatusUpdatedAt: new Date().toISOString(),
        paymentMethod
      }}`
    })
    .where(eq(purchaseOrders.id, id))
    .returning();

  return updatedOrder;
}

// ==================== PURCHASE HISTORY ANALYTICS ====================

/**
 * Get customer purchase history summary
 */
export async function getCustomerPurchaseHistorySummary(customerId, params = {}) {
  const { dateFrom = null, dateTo = null } = params;

  let whereConditions = [eq(purchaseOrders.customerId, customerId)];

  if (dateFrom) {
    whereConditions.push(sql`${purchaseOrders.orderDate} >= ${new Date(dateFrom)}`);
  }

  if (dateTo) {
    whereConditions.push(sql`${purchaseOrders.orderDate} <= ${new Date(dateTo)}`);
  }

  const [summary] = await db
    .select({
      totalOrders: sql`COUNT(*)`,
      totalValue: sql`SUM(${purchaseOrders.totalAmount})`,
      avgOrderValue: sql`AVG(${purchaseOrders.totalAmount})`,
      firstOrder: sql`MIN(${purchaseOrders.orderDate})`,
      lastOrder: sql`MAX(${purchaseOrders.orderDate})`,
      pendingOrders: sql`COUNT(CASE WHEN ${purchaseOrders.status} = 'pending' THEN 1 END)`,
      completedOrders: sql`COUNT(CASE WHEN ${purchaseOrders.status} = 'delivered' THEN 1 END)`,
      cancelledOrders: sql`COUNT(CASE WHEN ${purchaseOrders.status} = 'cancelled' THEN 1 END)`,
      unpaidOrders: sql`COUNT(CASE WHEN ${purchaseOrders.paymentStatus} IN ('pending', 'partial') THEN 1 END)`,
      paidOrders: sql`COUNT(CASE WHEN ${purchaseOrders.paymentStatus} = 'paid' THEN 1 END)`
    })
    .from(purchaseOrders)
    .where(and(...whereConditions));

  return {
    ...summary,
    totalValue: parseFloat(summary.totalValue || 0),
    avgOrderValue: parseFloat(summary.avgOrderValue || 0),
    totalOrders: parseInt(summary.totalOrders || 0),
    pendingOrders: parseInt(summary.pendingOrders || 0),
    completedOrders: parseInt(summary.completedOrders || 0),
    cancelledOrders: parseInt(summary.cancelledOrders || 0),
    unpaidOrders: parseInt(summary.unpaidOrders || 0),
    paidOrders: parseInt(summary.paidOrders || 0)
  };
}

/**
 * Get customer's most purchased products
 */
export async function getCustomerTopProducts(customerId, limit = 10) {
  return await db
    .select({
      productId: purchaseOrderItems.productId,
      sku: purchaseOrderItems.sku,
      productName: purchaseOrderItems.productName,
      totalQuantity: sql`SUM(${purchaseOrderItems.quantity})`,
      totalValue: sql`SUM(${purchaseOrderItems.lineTotal})`,
      orderCount: sql`COUNT(DISTINCT ${purchaseOrderItems.purchaseOrderId})`,
      avgQuantityPerOrder: sql`AVG(${purchaseOrderItems.quantity})`,
      lastOrderDate: sql`MAX(${purchaseOrders.orderDate})`
    })
    .from(purchaseOrderItems)
    .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
    .where(eq(purchaseOrders.customerId, customerId))
    .groupBy(
      purchaseOrderItems.productId,
      purchaseOrderItems.sku,
      purchaseOrderItems.productName
    )
    .orderBy(desc(sql`SUM(${purchaseOrderItems.quantity})`))
    .limit(limit);
}

/**
 * Get customer purchase frequency analysis
 */
export async function getCustomerPurchaseFrequency(customerId) {
  const orders = await db
    .select({
      orderDate: purchaseOrders.orderDate,
      totalAmount: purchaseOrders.totalAmount
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.customerId, customerId))
    .orderBy(purchaseOrders.orderDate);

  if (orders.length < 2) {
    return {
      averageDaysBetweenOrders: null,
      orderFrequency: 'Insufficient data',
      predictedNextOrder: null,
      orders: orders.length
    };
  }

  // Calculate days between consecutive orders
  const daysBetweenOrders = [];
  for (let i = 1; i < orders.length; i++) {
    const daysDiff = Math.floor(
      (new Date(orders[i].orderDate) - new Date(orders[i - 1].orderDate)) / (1000 * 60 * 60 * 24)
    );
    daysBetweenOrders.push(daysDiff);
  }

  const averageDays = daysBetweenOrders.reduce((sum, days) => sum + days, 0) / daysBetweenOrders.length;
  const lastOrderDate = new Date(orders[orders.length - 1].orderDate);
  const predictedNextOrder = new Date(lastOrderDate.getTime() + (averageDays * 24 * 60 * 60 * 1000));

  let frequency = 'Irregular';
  if (averageDays <= 7) frequency = 'Weekly';
  else if (averageDays <= 14) frequency = 'Bi-weekly';
  else if (averageDays <= 30) frequency = 'Monthly';
  else if (averageDays <= 90) frequency = 'Quarterly';
  else if (averageDays <= 180) frequency = 'Semi-annual';
  else if (averageDays <= 365) frequency = 'Annual';

  return {
    averageDaysBetweenOrders: Math.round(averageDays),
    orderFrequency: frequency,
    predictedNextOrder: predictedNextOrder.toISOString(),
    orders: orders.length,
    daysBetweenOrders
  };
}

/**
 * Get purchase order statistics for the dashboard
 */
export async function getPurchaseOrderStatistics(params = {}) {
  const { supplierId = null, dateFrom = null, dateTo = null, status = null } = params;

  let whereConditions = [];

  if (supplierId) {
    whereConditions.push(eq(customers.id, supplierId)); // This would need to be adapted for supplier-based POs
  }

  if (dateFrom) {
    whereConditions.push(sql`${purchaseOrders.orderDate} >= ${new Date(dateFrom)}`);
  }

  if (dateTo) {
    whereConditions.push(sql`${purchaseOrders.orderDate} <= ${new Date(dateTo)}`);
  }

  if (status) {
    whereConditions.push(eq(purchaseOrders.status, status));
  }

  const [statistics] = await db
    .select({
      totalOrders: sql`COUNT(*)`,
      pendingApproval: sql`COUNT(CASE WHEN ${purchaseOrders.status} = 'pending' THEN 1 END)`,
      approved: sql`COUNT(CASE WHEN ${purchaseOrders.status} = 'approved' THEN 1 END)`,
      rejected: sql`COUNT(CASE WHEN ${purchaseOrders.status} = 'rejected' THEN 1 END)`,
      totalValue: sql`SUM(${purchaseOrders.totalAmount})`,
      avgOrderValue: sql`AVG(${purchaseOrders.totalAmount})`
    })
    .from(purchaseOrders)
    .leftJoin(customers, eq(purchaseOrders.customerId, customers.id))
    .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);

  return {
    totalOrders: parseInt(statistics.totalOrders || 0),
    pendingApproval: parseInt(statistics.pendingApproval || 0),
    approved: parseInt(statistics.approved || 0),
    rejected: parseInt(statistics.rejected || 0),
    totalValue: parseFloat(statistics.totalValue || 0),
    avgOrderValue: parseFloat(statistics.avgOrderValue || 0)
  };
}

/**
 * Get purchase orders with pagination and filtering (for internal procurement)
 */
export async function getPurchaseOrders(params = {}) {
  const {
    page = 1,
    limit = 10,
    supplierId = null,
    status = null,
    dateFrom = null,
    dateTo = null,
    priority = null,
    search = '',
    sortBy = 'orderDate',
    sortOrder = 'desc'
  } = params;

  const offset = (page - 1) * limit;

  let whereConditions = [];

  if (supplierId) {
    whereConditions.push(eq(customers.id, supplierId)); // This would need supplier relationship
  }

  if (status) {
    whereConditions.push(eq(purchaseOrders.status, status));
  }

  if (dateFrom) {
    whereConditions.push(sql`${purchaseOrders.orderDate} >= ${new Date(dateFrom)}`);
  }

  if (dateTo) {
    whereConditions.push(sql`${purchaseOrders.orderDate} <= ${new Date(dateTo)}`);
  }

  if (search) {
    whereConditions.push(
      or(
        ilike(purchaseOrders.orderNumber, `%${search}%`),
        ilike(purchaseOrders.referenceNumber, `%${search}%`),
        ilike(customers.companyName, `%${search}%`)
      )
    );
  }

  const sortField = purchaseOrders[sortBy] || purchaseOrders.orderDate;
  const sortDirection = sortOrder === 'asc' ? asc : desc;

  const orders = await db
    .select({
      id: purchaseOrders.id,
      poNumber: purchaseOrders.orderNumber,
      supplierId: purchaseOrders.customerId,
      supplierName: customers.companyName,
      status: purchaseOrders.status,
      createdDate: purchaseOrders.orderDate,
      requiredDate: purchaseOrders.orderDate, // This would need a proper required_date field
      totalAmount: purchaseOrders.totalAmount,
      currency: purchaseOrders.currency,
      items: sql`COALESCE(
        (SELECT JSON_AGG(
          JSON_BUILD_OBJECT(
            'id', poi.id,
            'description', poi.product_name,
            'quantity', poi.quantity,
            'unitPrice', poi.unit_price,
            'totalPrice', poi.line_total
          )
        ) FROM purchase_order_items poi WHERE poi.purchase_order_id = ${purchaseOrders.id}),
        '[]'::json
      )`,
      createdBy: purchaseOrders.createdBy,
      notes: purchaseOrders.notes,
      createdAt: purchaseOrders.createdAt
    })
    .from(purchaseOrders)
    .leftJoin(customers, eq(purchaseOrders.customerId, customers.id))
    .where(whereConditions.length > 0 ? and(...whereConditions) : undefined)
    .orderBy(sortDirection(sortField))
    .limit(limit)
    .offset(offset);

  // Get total count for pagination
  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(purchaseOrders)
    .leftJoin(customers, eq(purchaseOrders.customerId, customers.id))
    .where(whereConditions.length > 0 ? and(...whereConditions) : undefined);

  return {
    purchaseOrders: orders,
    pagination: {
      page,
      limit,
      totalCount: count,
      totalPages: Math.ceil(count / limit),
      hasNext: page < Math.ceil(count / limit),
      hasPrev: page > 1
    }
  };
}

export default {
  createPurchaseOrder,
  getPurchaseOrderById,
  getCustomerPurchaseOrders,
  searchPurchaseOrders,
  updatePurchaseOrderStatus,
  updatePurchaseOrderPaymentStatus,
  getCustomerPurchaseHistorySummary,
  getCustomerTopProducts,
  getCustomerPurchaseFrequency,
  getPurchaseOrderStatistics,
  getPurchaseOrders
};
