import { eq, ilike, and, or, desc, asc, sql } from 'drizzle-orm';
import { db } from '../config/database.js';
import { customers, inventory, inventoryMovements, products, purchaseOrders, purchaseOrderItems } from './schema.js';

/**
 * Customer Query Examples
 * These demonstrate how to use the Customer schema with Drizzle ORM
 */

// Create a new customer
export async function createCustomer(customerData) {
  const [newCustomer] = await db
    .insert(customers)
    .values({
      customerCode: customerData.customerCode,
      companyName: customerData.companyName,
      email: customerData.email,
      phone: customerData.phone,
      address: customerData.address,
      metadata: customerData.metadata || {},
      purchaseHistory: customerData.purchaseHistory || { orders: [], totalLifetimeValue: 0 }
    })
    .returning();
  
  return newCustomer;
}

// Get customer by ID
export async function getCustomerById(id) {
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  
  return customer;
}

// Get customer by customer code
export async function getCustomerByCode(customerCode) {
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.customerCode, customerCode))
    .limit(1);
  
  return customer;
}

// Get all customers with pagination
export async function getAllCustomers(page = 1, pageSize = 10) {
  const offset = (page - 1) * pageSize;
  
  const result = await db
    .select()
    .from(customers)
    .orderBy(desc(customers.createdAt))
    .limit(pageSize)
    .offset(offset);
  
  return result;
}

// Search customers by company name or email
export async function searchCustomers(searchTerm, page = 1, pageSize = 10) {
  const offset = (page - 1) * pageSize;
  
  const result = await db
    .select()
    .from(customers)
    .where(
      or(
        ilike(customers.companyName, `%${searchTerm}%`),
        ilike(customers.email, `%${searchTerm}%`)
      )
    )
    .orderBy(asc(customers.companyName))
    .limit(pageSize)
    .offset(offset);
  
  return result;
}

// Update customer
export async function updateCustomer(id, updateData) {
  const [updatedCustomer] = await db
    .update(customers)
    .set({
      ...updateData,
      updatedAt: new Date()
    })
    .where(eq(customers.id, id))
    .returning();
  
  return updatedCustomer;
}

// Update customer metadata (merge with existing)
export async function updateCustomerMetadata(id, newMetadata) {
  const [customer] = await db
    .select({ metadata: customers.metadata })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  
  if (!customer) {
    throw new Error('Customer not found');
  }
  
  const mergedMetadata = {
    ...(customer.metadata || {}),
    ...newMetadata
  };
  
  const [updatedCustomer] = await db
    .update(customers)
    .set({
      metadata: mergedMetadata,
      updatedAt: new Date()
    })
    .where(eq(customers.id, id))
    .returning();
  
  return updatedCustomer;
}

// Add purchase to history
export async function addPurchaseToHistory(id, purchase) {
  const [customer] = await db
    .select({ purchaseHistory: customers.purchaseHistory })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  
  if (!customer) {
    throw new Error('Customer not found');
  }
  
  const currentHistory = customer.purchaseHistory || { orders: [], totalLifetimeValue: 0 };
  
  const updatedHistory = {
    orders: [...(currentHistory.orders || []), purchase],
    totalLifetimeValue: (currentHistory.totalLifetimeValue || 0) + (purchase.amount || 0),
    lastPurchaseDate: purchase.date || new Date().toISOString()
  };
  
  const [updatedCustomer] = await db
    .update(customers)
    .set({
      purchaseHistory: updatedHistory,
      updatedAt: new Date()
    })
    .where(eq(customers.id, id))
    .returning();
  
  return updatedCustomer;
}

// Delete customer
export async function deleteCustomer(id) {
  const [deletedCustomer] = await db
    .delete(customers)
    .where(eq(customers.id, id))
    .returning();
  
  return deletedCustomer;
}

// Get customers by metadata field
export async function getCustomersByMetadataField(fieldPath, value) {
  // Using JSON operators for JSONB queries
  const result = await db
    .select()
    .from(customers)
    .where(sql`${customers.metadata}->>${fieldPath} = ${value}`)
    .orderBy(asc(customers.companyName));
  
  return result;
}

// Get customers with purchase history above threshold
export async function getHighValueCustomers(threshold = 1000) {
  const result = await db
    .select()
    .from(customers)
    .where(sql`(${customers.purchaseHistory}->>'totalLifetimeValue')::numeric > ${threshold}`)
    .orderBy(desc(sql`(${customers.purchaseHistory}->>'totalLifetimeValue')::numeric`));
  
  return result;
}

// Count total customers
export async function getTotalCustomersCount() {
  const [{ count }] = await db
    .select({ count: sql`count(*)::int` })
    .from(customers);
  
  return count;
}

// ==================== CUSTOMER INVENTORY INTEGRATION ====================

/**
 * Process customer sale and update inventory
 */
export async function processSale(saleData) {
  const {
    customerId,
    items, // Array of { productId, warehouseId, quantity, unitPrice }
    referenceNumber,
    performedBy,
    notes = null
  } = saleData;

  return await db.transaction(async (tx) => {
    const movements = [];
    let totalSaleValue = 0;

    for (const item of items) {
      const { productId, warehouseId, quantity, unitPrice } = item;
      const itemTotal = unitPrice * quantity;
      totalSaleValue += itemTotal;

      // Get inventory record
      const inventoryRecord = await tx
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
        throw new Error(`No inventory found for product ${productId} in warehouse ${warehouseId}`);
      }

      const current = inventoryRecord[0];
      
      if (current.quantityAvailable < quantity) {
        throw new Error(`Insufficient available stock for product ${productId}. Available: ${current.quantityAvailable}, Requested: ${quantity}`);
      }

      // Update inventory levels
      const newQuantityOnHand = current.quantityOnHand - quantity;
      const newQuantityAvailable = current.quantityAvailable - quantity;

      const updatedInventory = await tx
        .update(inventory)
        .set({
          quantityOnHand: newQuantityOnHand,
          quantityAvailable: newQuantityAvailable,
          lastMovement: new Date(),
          stockStatus: newQuantityOnHand === 0 ? 'out_of_stock' : 
                      (current.reorderPoint && newQuantityOnHand <= current.reorderPoint) ? 'low_stock' : 'in_stock',
          updatedAt: new Date()
        })
        .where(eq(inventory.id, current.id))
        .returning();

      // Record movement
      const movement = await tx
        .insert(inventoryMovements)
        .values({
          inventoryId: current.id,
          productId,
          warehouseId,
          movementType: 'sale',
          quantity: -quantity, // Negative for outbound
          unitCost: current.averageCost,
          totalCost: current.averageCost * quantity,
          referenceType: 'sales_order',
          referenceId: customerId,
          referenceNumber,
          performedBy,
          notes: notes || `Sale to customer ${customerId}`,
          quantityAfter: newQuantityOnHand,
          runningTotal: newQuantityOnHand
        })
        .returning();

      movements.push(movement[0]);
    }

    // Update customer purchase history
    const saleRecord = {
      date: new Date().toISOString(),
      amount: totalSaleValue,
      referenceNumber,
      itemCount: items.length,
      items: items.map(item => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        total: item.unitPrice * item.quantity
      }))
    };

    await addPurchaseToHistory(customerId, saleRecord);

    return {
      movements,
      totalSaleValue,
      saleRecord
    };
  });
}

/**
 * Reserve stock for customer order
 */
export async function reserveStockForCustomer(customerId, items) {
  // items: Array of { productId, warehouseId, quantity }
  
  return await db.transaction(async (tx) => {
    const reservations = [];

    for (const item of items) {
      const { productId, warehouseId, quantity } = item;

      // Get current inventory
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
        throw new Error(`No inventory found for product ${productId} in warehouse ${warehouseId}`);
      }

      if (current[0].quantityAvailable < quantity) {
        throw new Error(`Insufficient available stock for product ${productId}. Available: ${current[0].quantityAvailable}, Requested: ${quantity}`);
      }

      // Update reservation
      const updated = await tx
        .update(inventory)
        .set({
          quantityAvailable: current[0].quantityAvailable - quantity,
          quantityReserved: current[0].quantityReserved + quantity,
          updatedAt: new Date()
        })
        .where(eq(inventory.id, current[0].id))
        .returning();

      reservations.push({
        inventoryId: current[0].id,
        productId,
        warehouseId,
        quantityReserved: quantity,
        customerId
      });
    }

    return reservations;
  });
}

/**
 * Release reserved stock for customer order
 */
export async function releaseCustomerReservation(customerId, items) {
  // items: Array of { productId, warehouseId, quantity }
  
  return await db.transaction(async (tx) => {
    const releases = [];

    for (const item of items) {
      const { productId, warehouseId, quantity } = item;

      // Get current inventory
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
        throw new Error(`No inventory found for product ${productId} in warehouse ${warehouseId}`);
      }

      if (current[0].quantityReserved < quantity) {
        throw new Error(`Cannot release more than reserved quantity for product ${productId}. Reserved: ${current[0].quantityReserved}, Requested: ${quantity}`);
      }

      // Release reservation
      const updated = await tx
        .update(inventory)
        .set({
          quantityAvailable: current[0].quantityAvailable + quantity,
          quantityReserved: current[0].quantityReserved - quantity,
          updatedAt: new Date()
        })
        .where(eq(inventory.id, current[0].id))
        .returning();

      releases.push({
        inventoryId: current[0].id,
        productId,
        warehouseId,
        quantityReleased: quantity,
        customerId
      });
    }

    return releases;
  });
}

/**
 * Get customer sales velocity analysis
 */
export async function getCustomerSalesVelocity(customerId, params = {}) {
  const { 
    dateFrom = null, 
    dateTo = null,
    productId = null 
  } = params;

  let whereConditions = [
    eq(inventoryMovements.referenceId, customerId),
    eq(inventoryMovements.movementType, 'sale')
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

  const salesData = await db
    .select({
      productId: products.id,
      productSku: products.sku,
      productName: products.name,
      category: products.category,
      totalQuantitySold: sql`SUM(ABS(${inventoryMovements.quantity}))`,
      totalSalesValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
      averageQuantityPerOrder: sql`AVG(ABS(${inventoryMovements.quantity}))`,
      salesCount: sql`COUNT(*)`,
      firstSale: sql`MIN(${inventoryMovements.createdAt})`,
      lastSale: sql`MAX(${inventoryMovements.createdAt})`,
      averageDaysBetweenOrders: sql`AVG(EXTRACT(days FROM ${inventoryMovements.createdAt} - LAG(${inventoryMovements.createdAt}) OVER (PARTITION BY ${products.id} ORDER BY ${inventoryMovements.createdAt})))`
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .where(and(...whereConditions))
    .groupBy(products.id, products.sku, products.name, products.category)
    .orderBy(desc(sql`SUM(ABS(${inventoryMovements.quantity}))`));

  return salesData;
}

/**
 * Get customer backorder management
 */
export async function getCustomerBackorders(customerId) {
  // This would typically involve a separate backorders table, 
  // but for now we'll track via metadata or reserved quantities
  const customer = await getCustomerById(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }

  // Get any reserved inventory for this customer
  const reservedInventory = await db
    .select({
      productId: inventory.productId,
      productSku: products.sku,
      productName: products.name,
      warehouseId: inventory.warehouseId,
      quantityReserved: inventory.quantityReserved,
      quantityOnHand: inventory.quantityOnHand,
      quantityAvailable: inventory.quantityAvailable,
      reorderPoint: inventory.reorderPoint,
      stockStatus: inventory.stockStatus
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .where(sql`${inventory.quantityReserved} > 0`)
    .orderBy(products.name);

  // Note: In a full implementation, you'd have a proper backorders table
  // that tracks customer orders waiting for stock
  
  return {
    customer,
    reservedItems: reservedInventory,
    // This would include actual backorder records in a complete system
    backorders: []
  };
}

// ==================== CUSTOMER ANALYTICS ====================

/**
 * Calculate customer purchase frequency analysis
 */
export async function calculatePurchaseFrequency(customerId, params = {}) {
  const { 
    dateFrom = null, 
    dateTo = null 
  } = params;

  const customer = await getCustomerById(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }

  let whereConditions = [
    eq(inventoryMovements.referenceId, customerId),
    eq(inventoryMovements.movementType, 'sale')
  ];

  if (dateFrom) {
    whereConditions.push(sql`${inventoryMovements.createdAt} >= ${new Date(dateFrom)}`);
  }

  if (dateTo) {
    whereConditions.push(sql`${inventoryMovements.createdAt} <= ${new Date(dateTo)}`);
  }

  // Get purchase frequency data
  const frequencyData = await db
    .select({
      totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
      totalTransactions: sql`COUNT(*)`,
      firstPurchase: sql`MIN(${inventoryMovements.createdAt})`,
      lastPurchase: sql`MAX(${inventoryMovements.createdAt})`,
      avgDaysBetweenOrders: sql`
        CASE 
          WHEN COUNT(DISTINCT ${inventoryMovements.referenceNumber}) > 1 
          THEN EXTRACT(days FROM MAX(${inventoryMovements.createdAt}) - MIN(${inventoryMovements.createdAt})) / (COUNT(DISTINCT ${inventoryMovements.referenceNumber}) - 1)
          ELSE NULL 
        END
      `,
      totalDaysAsCustomer: sql`EXTRACT(days FROM MAX(${inventoryMovements.createdAt}) - MIN(${inventoryMovements.createdAt}))`,
      ordersPerMonth: sql`
        CASE 
          WHEN EXTRACT(days FROM MAX(${inventoryMovements.createdAt}) - MIN(${inventoryMovements.createdAt})) > 0 
          THEN COUNT(DISTINCT ${inventoryMovements.referenceNumber}) * 30.0 / EXTRACT(days FROM MAX(${inventoryMovements.createdAt}) - MIN(${inventoryMovements.createdAt}))
          ELSE COUNT(DISTINCT ${inventoryMovements.referenceNumber})
        END
      `
    })
    .from(inventoryMovements)
    .where(and(...whereConditions));

  return {
    customerId,
    customerCode: customer.customerCode,
    companyName: customer.companyName,
    ...frequencyData[0]
  };
}

/**
 * Calculate Average Order Value (AOV)
 */
export async function calculateAverageOrderValue(customerId, params = {}) {
  const { 
    dateFrom = null, 
    dateTo = null 
  } = params;

  const customer = await getCustomerById(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }

  let whereConditions = [
    eq(inventoryMovements.referenceId, customerId),
    eq(inventoryMovements.movementType, 'sale')
  ];

  if (dateFrom) {
    whereConditions.push(sql`${inventoryMovements.createdAt} >= ${new Date(dateFrom)}`);
  }

  if (dateTo) {
    whereConditions.push(sql`${inventoryMovements.createdAt} <= ${new Date(dateTo)}`);
  }

  // Calculate AOV by grouping by reference number (order)
  const aovData = await db
    .select({
      referenceNumber: inventoryMovements.referenceNumber,
      orderValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
      orderQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
      orderDate: sql`MAX(${inventoryMovements.createdAt})`
    })
    .from(inventoryMovements)
    .where(and(...whereConditions))
    .groupBy(inventoryMovements.referenceNumber)
    .orderBy(desc(sql`MAX(${inventoryMovements.createdAt})`));

  const totalOrders = aovData.length;
  const totalValue = aovData.reduce((sum, order) => sum + parseFloat(order.orderValue || 0), 0);
  const totalQuantity = aovData.reduce((sum, order) => sum + parseInt(order.orderQuantity || 0), 0);
  const averageOrderValue = totalOrders > 0 ? totalValue / totalOrders : 0;
  const averageQuantityPerOrder = totalOrders > 0 ? totalQuantity / totalOrders : 0;

  // Calculate value distribution
  const orderValues = aovData.map(order => parseFloat(order.orderValue || 0)).sort((a, b) => a - b);
  const medianOrderValue = orderValues.length > 0 ? 
    (orderValues.length % 2 === 0 ? 
      (orderValues[orderValues.length / 2 - 1] + orderValues[orderValues.length / 2]) / 2 :
      orderValues[Math.floor(orderValues.length / 2)]
    ) : 0;

  return {
    customerId,
    customerCode: customer.customerCode,
    companyName: customer.companyName,
    totalOrders,
    totalValue,
    totalQuantity,
    averageOrderValue,
    medianOrderValue,
    averageQuantityPerOrder,
    minOrderValue: orderValues.length > 0 ? Math.min(...orderValues) : 0,
    maxOrderValue: orderValues.length > 0 ? Math.max(...orderValues) : 0,
    orders: aovData.slice(0, 10) // Latest 10 orders
  };
}

/**
 * Calculate Customer Lifetime Value (CLV)
 */
export async function calculateCustomerLifetimeValue(customerId) {
  const customer = await getCustomerById(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }

  // Get all purchase data
  const purchaseData = await db
    .select({
      totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
      totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
      firstPurchase: sql`MIN(${inventoryMovements.createdAt})`,
      lastPurchase: sql`MAX(${inventoryMovements.createdAt})`,
      avgOrderValue: sql`AVG(order_totals.order_value)`,
      orderFrequency: sql`
        CASE 
          WHEN COUNT(DISTINCT ${inventoryMovements.referenceNumber}) > 1 
          THEN EXTRACT(days FROM MAX(${inventoryMovements.createdAt}) - MIN(${inventoryMovements.createdAt})) / (COUNT(DISTINCT ${inventoryMovements.referenceNumber}) - 1)
          ELSE NULL 
        END
      `
    })
    .from(inventoryMovements)
    .innerJoin(
      db.select({
        referenceNumber: inventoryMovements.referenceNumber,
        orderValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`.as('order_value')
      })
      .from(inventoryMovements)
      .where(
        and(
          eq(inventoryMovements.referenceId, customerId),
          eq(inventoryMovements.movementType, 'sale')
        )
      )
      .groupBy(inventoryMovements.referenceNumber)
      .as('order_totals'),
      eq(inventoryMovements.referenceNumber, sql`order_totals.reference_number`)
    )
    .where(
      and(
        eq(inventoryMovements.referenceId, customerId),
        eq(inventoryMovements.movementType, 'sale')
      )
    );

  const data = purchaseData[0] || {};
  const totalValue = parseFloat(data.totalValue || 0);
  const totalOrders = parseInt(data.totalOrders || 0);
  const avgOrderValue = parseFloat(data.avgOrderValue || 0);
  const orderFrequency = parseFloat(data.orderFrequency || 0);

  // Calculate CLV metrics
  const customerLifespanDays = data.firstPurchase && data.lastPurchase ? 
    (new Date(data.lastPurchase) - new Date(data.firstPurchase)) / (1000 * 60 * 60 * 24) : 0;
  
  const purchaseFrequencyPerYear = orderFrequency > 0 ? 365 / orderFrequency : 0;
  const historicalCLV = totalValue; // Actual value generated so far
  
  // Predictive CLV (simple model based on current behavior)
  const predictedLifespanYears = Math.max(1, customerLifespanDays / 365);
  const predictiveCLV = avgOrderValue * purchaseFrequencyPerYear * predictedLifespanYears;

  // Customer segments based on CLV
  let segment = 'Low Value';
  if (historicalCLV > 10000) segment = 'High Value';
  else if (historicalCLV > 5000) segment = 'Medium Value';
  else if (historicalCLV > 1000) segment = 'Regular';

  return {
    customerId,
    customerCode: customer.customerCode,
    companyName: customer.companyName,
    historicalCLV,
    predictiveCLV,
    totalOrders,
    avgOrderValue,
    orderFrequency,
    purchaseFrequencyPerYear,
    customerLifespanDays,
    firstPurchase: data.firstPurchase,
    lastPurchase: data.lastPurchase,
    segment,
    metrics: {
      totalValue,
      avgOrderValue,
      orderFrequency,
      purchaseFrequencyPerYear
    }
  };
}

/**
 * Calculate churn prediction indicators
 */
export async function calculateChurnPredictionIndicators(customerId) {
  const customer = await getCustomerById(customerId);
  if (!customer) {
    throw new Error('Customer not found');
  }

  // Get recent purchase activity
  const recentActivity = await db
    .select({
      lastPurchase: sql`MAX(${inventoryMovements.createdAt})`,
      totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
      avgDaysBetweenOrders: sql`
        CASE 
          WHEN COUNT(DISTINCT ${inventoryMovements.referenceNumber}) > 1 
          THEN EXTRACT(days FROM MAX(${inventoryMovements.createdAt}) - MIN(${inventoryMovements.createdAt})) / (COUNT(DISTINCT ${inventoryMovements.referenceNumber}) - 1)
          ELSE NULL 
        END
      `,
      last3MonthsOrders: sql`COUNT(DISTINCT CASE WHEN ${inventoryMovements.createdAt} >= NOW() - INTERVAL '3 months' THEN ${inventoryMovements.referenceNumber} END)`,
      last6MonthsOrders: sql`COUNT(DISTINCT CASE WHEN ${inventoryMovements.createdAt} >= NOW() - INTERVAL '6 months' THEN ${inventoryMovements.referenceNumber} END)`,
      last12MonthsOrders: sql`COUNT(DISTINCT CASE WHEN ${inventoryMovements.createdAt} >= NOW() - INTERVAL '12 months' THEN ${inventoryMovements.referenceNumber} END)`
    })
    .from(inventoryMovements)
    .where(
      and(
        eq(inventoryMovements.referenceId, customerId),
        eq(inventoryMovements.movementType, 'sale')
      )
    );

  const data = recentActivity[0] || {};
  const lastPurchase = data.lastPurchase ? new Date(data.lastPurchase) : null;
  const daysSinceLastPurchase = lastPurchase ? 
    Math.floor((new Date() - lastPurchase) / (1000 * 60 * 60 * 24)) : null;
  
  const avgDaysBetweenOrders = parseFloat(data.avgDaysBetweenOrders || 0);
  const last3MonthsOrders = parseInt(data.last3MonthsOrders || 0);
  const last6MonthsOrders = parseInt(data.last6MonthsOrders || 0);
  const last12MonthsOrders = parseInt(data.last12MonthsOrders || 0);

  // Calculate churn risk factors
  let churnScore = 0;
  let churnRisk = 'Low';
  const indicators = [];

  if (daysSinceLastPurchase !== null && avgDaysBetweenOrders > 0) {
    const expectedReorderRatio = daysSinceLastPurchase / avgDaysBetweenOrders;
    
    if (expectedReorderRatio > 3) {
      churnScore += 40;
      indicators.push('Significantly overdue for next purchase');
    } else if (expectedReorderRatio > 2) {
      churnScore += 25;
      indicators.push('Overdue for next purchase');
    } else if (expectedReorderRatio > 1.5) {
      churnScore += 10;
      indicators.push('Slightly delayed next purchase');
    }
  }

  // Activity decline indicators
  if (last3MonthsOrders === 0 && last6MonthsOrders > 0) {
    churnScore += 30;
    indicators.push('No orders in last 3 months');
  } else if (last3MonthsOrders < last6MonthsOrders / 2) {
    churnScore += 15;
    indicators.push('Declining order frequency');
  }

  if (last6MonthsOrders === 0 && last12MonthsOrders > 0) {
    churnScore += 50;
    indicators.push('No orders in last 6 months');
  }

  // Overall churn risk assessment
  if (churnScore >= 60) churnRisk = 'Critical';
  else if (churnScore >= 40) churnRisk = 'High';
  else if (churnScore >= 20) churnRisk = 'Medium';

  return {
    customerId,
    customerCode: customer.customerCode,
    companyName: customer.companyName,
    churnScore,
    churnRisk,
    indicators,
    metrics: {
      daysSinceLastPurchase,
      avgDaysBetweenOrders,
      last3MonthsOrders,
      last6MonthsOrders,
      last12MonthsOrders,
      lastPurchase
    }
  };
}

/**
 * Perform customer segmentation analysis
 */
export async function performCustomerSegmentation() {
  // Get all customers with their purchase metrics
  const customerMetrics = await db
    .select({
      customerId: customers.id,
      customerCode: customers.customerCode,
      companyName: customers.companyName,
      createdAt: customers.createdAt,
      totalValue: sql`COALESCE(SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}), 0)`,
      totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
      lastPurchase: sql`MAX(${inventoryMovements.createdAt})`,
      firstPurchase: sql`MIN(${inventoryMovements.createdAt})`,
      avgOrderValue: sql`
        CASE 
          WHEN COUNT(DISTINCT ${inventoryMovements.referenceNumber}) > 0 
          THEN SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost}) / COUNT(DISTINCT ${inventoryMovements.referenceNumber})
          ELSE 0 
        END
      `,
      orderFrequency: sql`
        CASE 
          WHEN COUNT(DISTINCT ${inventoryMovements.referenceNumber}) > 1 
          THEN EXTRACT(days FROM MAX(${inventoryMovements.createdAt}) - MIN(${inventoryMovements.createdAt})) / (COUNT(DISTINCT ${inventoryMovements.referenceNumber}) - 1)
          ELSE NULL 
        END
      `
    })
    .from(customers)
    .leftJoin(
      inventoryMovements,
      and(
        eq(customers.id, inventoryMovements.referenceId),
        eq(inventoryMovements.movementType, 'sale')
      )
    )
    .groupBy(customers.id, customers.customerCode, customers.companyName, customers.createdAt);

  // Calculate thresholds for segmentation
  const metrics = customerMetrics.map(c => ({
    ...c,
    totalValue: parseFloat(c.totalValue || 0),
    totalOrders: parseInt(c.totalOrders || 0),
    avgOrderValue: parseFloat(c.avgOrderValue || 0),
    orderFrequency: parseFloat(c.orderFrequency || 0),
    daysSinceLastPurchase: c.lastPurchase ? 
      Math.floor((new Date() - new Date(c.lastPurchase)) / (1000 * 60 * 60 * 24)) : null
  }));

  // Calculate percentiles for thresholds
  const values = metrics.filter(m => m.totalValue > 0).map(m => m.totalValue).sort((a, b) => a - b);
  const frequencies = metrics.filter(m => m.orderFrequency > 0).map(m => m.orderFrequency).sort((a, b) => a - b);

  const valueP75 = values.length > 0 ? values[Math.floor(values.length * 0.75)] : 1000;
  const valueP50 = values.length > 0 ? values[Math.floor(values.length * 0.50)] : 500;
  const freqP50 = frequencies.length > 0 ? frequencies[Math.floor(frequencies.length * 0.50)] : 90;

  // Segment customers
  const segments = {
    champions: [],
    loyalCustomers: [],
    potentialLoyalists: [],
    newCustomers: [],
    promissingCustomers: [],
    needsAttention: [],
    aboutToSleep: [],
    atRisk: [],
    cannotLoseThem: [],
    hibernating: [],
    lost: []
  };

  metrics.forEach(customer => {
    const { totalValue, orderFrequency, daysSinceLastPurchase, totalOrders } = customer;
    
    // Recency score (1-5, 5 being most recent)
    let recencyScore = 1;
    if (daysSinceLastPurchase === null) recencyScore = 1;
    else if (daysSinceLastPurchase <= 30) recencyScore = 5;
    else if (daysSinceLastPurchase <= 60) recencyScore = 4;
    else if (daysSinceLastPurchase <= 120) recencyScore = 3;
    else if (daysSinceLastPurchase <= 365) recencyScore = 2;

    // Frequency score (1-5, 5 being most frequent)
    let frequencyScore = 1;
    if (totalOrders >= 10) frequencyScore = 5;
    else if (totalOrders >= 5) frequencyScore = 4;
    else if (totalOrders >= 3) frequencyScore = 3;
    else if (totalOrders >= 2) frequencyScore = 2;

    // Monetary score (1-5, 5 being highest value)
    let monetaryScore = 1;
    if (totalValue >= valueP75) monetaryScore = 5;
    else if (totalValue >= valueP50) monetaryScore = 4;
    else if (totalValue >= valueP50 * 0.5) monetaryScore = 3;
    else if (totalValue > 0) monetaryScore = 2;

    // Assign segment based on RFM scores
    const rfmScore = `${recencyScore}${frequencyScore}${monetaryScore}`;
    
    const customerWithSegment = {
      ...customer,
      recencyScore,
      frequencyScore,
      monetaryScore,
      rfmScore
    };

    // Segmentation logic
    if (recencyScore >= 4 && frequencyScore >= 4 && monetaryScore >= 4) {
      segments.champions.push({ ...customerWithSegment, segment: 'Champions' });
    } else if (recencyScore >= 3 && frequencyScore >= 3 && monetaryScore >= 3) {
      segments.loyalCustomers.push({ ...customerWithSegment, segment: 'Loyal Customers' });
    } else if (recencyScore >= 3 && frequencyScore <= 2 && monetaryScore >= 3) {
      segments.potentialLoyalists.push({ ...customerWithSegment, segment: 'Potential Loyalists' });
    } else if (recencyScore >= 4 && frequencyScore <= 2) {
      segments.newCustomers.push({ ...customerWithSegment, segment: 'New Customers' });
    } else if (recencyScore >= 3 && frequencyScore <= 2 && monetaryScore <= 2) {
      segments.promissingCustomers.push({ ...customerWithSegment, segment: 'Promising Customers' });
    } else if (recencyScore === 3 && frequencyScore >= 3) {
      segments.needsAttention.push({ ...customerWithSegment, segment: 'Customers Needing Attention' });
    } else if (recencyScore === 2 && frequencyScore >= 2) {
      segments.aboutToSleep.push({ ...customerWithSegment, segment: 'About to Sleep' });
    } else if (recencyScore <= 2 && frequencyScore >= 3 && monetaryScore >= 3) {
      segments.cannotLoseThem.push({ ...customerWithSegment, segment: 'Cannot Lose Them' });
    } else if (recencyScore === 2 && frequencyScore <= 2) {
      segments.atRisk.push({ ...customerWithSegment, segment: 'At Risk' });
    } else if (recencyScore === 1 && frequencyScore >= 2) {
      segments.hibernating.push({ ...customerWithSegment, segment: 'Hibernating' });
    } else {
      segments.lost.push({ ...customerWithSegment, segment: 'Lost' });
    }
  });

  return {
    totalCustomers: customerMetrics.length,
    segmentCounts: {
      champions: segments.champions.length,
      loyalCustomers: segments.loyalCustomers.length,
      potentialLoyalists: segments.potentialLoyalists.length,
      newCustomers: segments.newCustomers.length,
      promissingCustomers: segments.promissingCustomers.length,
      needsAttention: segments.needsAttention.length,
      aboutToSleep: segments.aboutToSleep.length,
      atRisk: segments.atRisk.length,
      cannotLoseThem: segments.cannotLoseThem.length,
      hibernating: segments.hibernating.length,
      lost: segments.lost.length
    },
    thresholds: {
      valueP75,
      valueP50,
      freqP50
    },
    segments
  };
}

/**
 * Analyze customer purchase patterns
 */
export async function analyzePurchasePatterns(customerId = null, params = {}) {
  const { 
    dateFrom = null, 
    dateTo = null,
    groupBy = 'month' // month, week, day, category, product
  } = params;

  let whereConditions = [eq(inventoryMovements.movementType, 'sale')];

  if (customerId) {
    whereConditions.push(eq(inventoryMovements.referenceId, customerId));
  }

  if (dateFrom) {
    whereConditions.push(sql`${inventoryMovements.createdAt} >= ${new Date(dateFrom)}`);
  }

  if (dateTo) {
    whereConditions.push(sql`${inventoryMovements.createdAt} <= ${new Date(dateTo)}`);
  }

  let groupByClause, selectClause;
  
  switch (groupBy) {
    case 'month':
      groupByClause = sql`DATE_TRUNC('month', ${inventoryMovements.createdAt})`;
      selectClause = {
        period: sql`DATE_TRUNC('month', ${inventoryMovements.createdAt})`,
        periodLabel: sql`TO_CHAR(DATE_TRUNC('month', ${inventoryMovements.createdAt}), 'YYYY-MM')`
      };
      break;
    case 'week':
      groupByClause = sql`DATE_TRUNC('week', ${inventoryMovements.createdAt})`;
      selectClause = {
        period: sql`DATE_TRUNC('week', ${inventoryMovements.createdAt})`,
        periodLabel: sql`TO_CHAR(DATE_TRUNC('week', ${inventoryMovements.createdAt}), 'YYYY-"W"WW')`
      };
      break;
    case 'day':
      groupByClause = sql`DATE_TRUNC('day', ${inventoryMovements.createdAt})`;
      selectClause = {
        period: sql`DATE_TRUNC('day', ${inventoryMovements.createdAt})`,
        periodLabel: sql`TO_CHAR(DATE_TRUNC('day', ${inventoryMovements.createdAt}), 'YYYY-MM-DD')`
      };
      break;
    case 'category':
      groupByClause = products.category;
      selectClause = {
        period: products.category,
        periodLabel: products.category
      };
      break;
    case 'product':
      groupByClause = sql`${products.id}, ${products.name}`;
      selectClause = {
        period: products.id,
        periodLabel: products.name,
        productSku: products.sku
      };
      break;
    default:
      groupByClause = sql`DATE_TRUNC('month', ${inventoryMovements.createdAt})`;
      selectClause = {
        period: sql`DATE_TRUNC('month', ${inventoryMovements.createdAt})`,
        periodLabel: sql`TO_CHAR(DATE_TRUNC('month', ${inventoryMovements.createdAt}), 'YYYY-MM')`
      };
  }

  const patterns = await db
    .select({
      ...selectClause,
      totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
      totalQuantity: sql`SUM(ABS(${inventoryMovements.quantity}))`,
      totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
      avgOrderValue: sql`AVG(order_values.order_total)`,
      uniqueCustomers: sql`COUNT(DISTINCT ${inventoryMovements.referenceId})`,
      avgQuantityPerOrder: sql`AVG(ABS(${inventoryMovements.quantity}))`
    })
    .from(inventoryMovements)
    .innerJoin(products, eq(inventoryMovements.productId, products.id))
    .innerJoin(
      db.select({
        referenceNumber: inventoryMovements.referenceNumber,
        orderTotal: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`.as('order_total')
      })
      .from(inventoryMovements)
      .where(and(...whereConditions))
      .groupBy(inventoryMovements.referenceNumber)
      .as('order_values'),
      eq(inventoryMovements.referenceNumber, sql`order_values.reference_number`)
    )
    .where(and(...whereConditions))
    .groupBy(groupByClause)
    .orderBy(selectClause.period);

  return {
    customerId,
    groupBy,
    dateFrom,
    dateTo,
    patterns: patterns.map(p => ({
      ...p,
      totalValue: parseFloat(p.totalValue || 0),
      avgOrderValue: parseFloat(p.avgOrderValue || 0),
      totalQuantity: parseInt(p.totalQuantity || 0),
      totalOrders: parseInt(p.totalOrders || 0),
      uniqueCustomers: parseInt(p.uniqueCustomers || 0),
      avgQuantityPerOrder: parseFloat(p.avgQuantityPerOrder || 0)
    }))
  };
}

/**
 * Get comprehensive customer analytics overview
 */
export async function getCustomersAnalyticsOverview(params = {}) {
  const { 
    dateFrom = null, 
    dateTo = null,
    limit = 50
  } = params;

  // Get customer metrics in parallel
  const [
    segmentation,
    topCustomers,
    recentActivity,
    churnRisks
  ] = await Promise.all([
    performCustomerSegmentation(),
    getTopCustomersByValue(limit, { dateFrom, dateTo }),
    getRecentCustomerActivity(limit),
    getHighChurnRiskCustomers(limit)
  ]);

  return {
    segmentation: {
      totalCustomers: segmentation.totalCustomers,
      segmentCounts: segmentation.segmentCounts
    },
    topCustomers,
    recentActivity,
    churnRisks,
    generatedAt: new Date().toISOString()
  };
}

/**
 * Get top customers by value
 */
export async function getTopCustomersByValue(limit = 10, params = {}) {
  const { dateFrom = null, dateTo = null } = params;

  let whereConditions = [eq(inventoryMovements.movementType, 'sale')];

  if (dateFrom) {
    whereConditions.push(sql`${inventoryMovements.createdAt} >= ${new Date(dateFrom)}`);
  }

  if (dateTo) {
    whereConditions.push(sql`${inventoryMovements.createdAt} <= ${new Date(dateTo)}`);
  }

  return await db
    .select({
      customerId: customers.id,
      customerCode: customers.customerCode,
      companyName: customers.companyName,
      totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`,
      totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
      avgOrderValue: sql`AVG(order_totals.order_value)`,
      lastPurchase: sql`MAX(${inventoryMovements.createdAt})`
    })
    .from(customers)
    .innerJoin(inventoryMovements, eq(customers.id, inventoryMovements.referenceId))
    .innerJoin(
      db.select({
        referenceNumber: inventoryMovements.referenceNumber,
        orderValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`.as('order_value')
      })
      .from(inventoryMovements)
      .where(and(...whereConditions))
      .groupBy(inventoryMovements.referenceNumber)
      .as('order_totals'),
      eq(inventoryMovements.referenceNumber, sql`order_totals.reference_number`)
    )
    .where(and(...whereConditions))
    .groupBy(customers.id, customers.customerCode, customers.companyName)
    .orderBy(desc(sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`))
    .limit(limit);
}

/**
 * Get recent customer activity
 */
export async function getRecentCustomerActivity(limit = 10) {
  return await db
    .select({
      customerId: customers.id,
      customerCode: customers.customerCode,
      companyName: customers.companyName,
      lastPurchase: sql`MAX(${inventoryMovements.createdAt})`,
      recentOrdersCount: sql`COUNT(DISTINCT CASE WHEN ${inventoryMovements.createdAt} >= NOW() - INTERVAL '30 days' THEN ${inventoryMovements.referenceNumber} END)`,
      recentValue: sql`SUM(CASE WHEN ${inventoryMovements.createdAt} >= NOW() - INTERVAL '30 days' THEN ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost} ELSE 0 END)`
    })
    .from(customers)
    .leftJoin(
      inventoryMovements,
      and(
        eq(customers.id, inventoryMovements.referenceId),
        eq(inventoryMovements.movementType, 'sale')
      )
    )
    .groupBy(customers.id, customers.customerCode, customers.companyName)
    .having(sql`MAX(${inventoryMovements.createdAt}) IS NOT NULL`)
    .orderBy(desc(sql`MAX(${inventoryMovements.createdAt})`))
    .limit(limit);
}

/**
 * Get customers with high churn risk
 */
export async function getHighChurnRiskCustomers(limit = 10) {
  const customers = await db
    .select({
      customerId: sql`${inventoryMovements.referenceId}`,
      lastPurchase: sql`MAX(${inventoryMovements.createdAt})`,
      avgDaysBetweenOrders: sql`
        CASE 
          WHEN COUNT(DISTINCT ${inventoryMovements.referenceNumber}) > 1 
          THEN EXTRACT(days FROM MAX(${inventoryMovements.createdAt}) - MIN(${inventoryMovements.createdAt})) / (COUNT(DISTINCT ${inventoryMovements.referenceNumber}) - 1)
          ELSE NULL 
        END
      `,
      totalOrders: sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber})`,
      totalValue: sql`SUM(ABS(${inventoryMovements.quantity}) * ${inventoryMovements.unitCost})`
    })
    .from(inventoryMovements)
    .where(eq(inventoryMovements.movementType, 'sale'))
    .groupBy(inventoryMovements.referenceId)
    .having(sql`COUNT(DISTINCT ${inventoryMovements.referenceNumber}) >= 2`);

  // Calculate churn risk for each customer
  const churnRisks = customers
    .map(customer => {
      const daysSinceLastPurchase = customer.lastPurchase ? 
        Math.floor((new Date() - new Date(customer.lastPurchase)) / (1000 * 60 * 60 * 24)) : null;
      
      const avgDaysBetweenOrders = parseFloat(customer.avgDaysBetweenOrders || 0);
      const expectedReorderRatio = (daysSinceLastPurchase && avgDaysBetweenOrders > 0) ? 
        daysSinceLastPurchase / avgDaysBetweenOrders : 0;

      let churnScore = 0;
      if (expectedReorderRatio > 3) churnScore = 80;
      else if (expectedReorderRatio > 2) churnScore = 60;
      else if (expectedReorderRatio > 1.5) churnScore = 40;

      return {
        ...customer,
        daysSinceLastPurchase,
        avgDaysBetweenOrders,
        expectedReorderRatio,
        churnScore,
        churnRisk: churnScore >= 60 ? 'High' : churnScore >= 40 ? 'Medium' : 'Low'
      };
    })
    .filter(customer => customer.churnScore >= 40)
    .sort((a, b) => b.churnScore - a.churnScore)
    .slice(0, limit);

  return churnRisks;
}