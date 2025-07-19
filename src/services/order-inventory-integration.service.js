import {
  purchaseOrders,
  purchaseOrderItems,
  inventory,
  inventoryMovements,
  products,
  customers,
  timeSeriesEvents
} from '../db/schema.js';
import { db } from '../config/database.js';
import { eq, and, sql, inArray, gte, lte, desc } from 'drizzle-orm';
import { sendNotification } from './notifications.js';

/**
 * Order-Inventory Integration Service
 * Handles the complete order-to-fulfillment workflow with inventory management
 */

// ==================== STOCK ALLOCATION ====================

/**
 * Allocate inventory for a customer order
 * @param {string} orderId - Purchase order ID
 * @param {Object} options - Allocation options
 * @returns {Object} Allocation results
 */
export async function allocateInventoryForOrder(orderId, options = {}) {
  const {
    allowPartialAllocation = true,
    createBackorders = true,
    userId = null
  } = options;

  try {
    return await db.transaction(async (tx) => {
      // Get order with items
      const orderData = await getOrderWithItems(orderId, tx);
      
      if (!orderData) {
        throw new Error('Order not found');
      }

      if (orderData.status !== 'pending') {
        throw new Error(`Order status is ${orderData.status}. Only pending orders can be allocated.`);
      }

      const allocationResults = {
        orderId,
        allocatedItems: [],
        partialAllocations: [],
        backorders: [],
        unavailableItems: [],
        totalItemsRequested: orderData.items.length,
        totalItemsAllocated: 0,
        allocationComplete: true
      };

      // Process each order item
      for (const orderItem of orderData.items) {
        const allocationResult = await allocateItemInventory(
          orderItem,
          orderData.id,
          allowPartialAllocation,
          tx
        );

        if (allocationResult.allocated === allocationResult.requested) {
          // Full allocation
          allocationResults.allocatedItems.push(allocationResult);
          allocationResults.totalItemsAllocated++;
        } else if (allocationResult.allocated > 0) {
          // Partial allocation
          allocationResults.partialAllocations.push(allocationResult);
          allocationResults.allocationComplete = false;
          
          if (createBackorders) {
            const backorderQuantity = allocationResult.requested - allocationResult.allocated;
            allocationResults.backorders.push({
              ...allocationResult,
              backorderQuantity
            });
          }
        } else {
          // No allocation possible
          allocationResults.unavailableItems.push(allocationResult);
          allocationResults.allocationComplete = false;
          
          if (createBackorders) {
            allocationResults.backorders.push({
              ...allocationResult,
              backorderQuantity: allocationResult.requested
            });
          }
        }
      }

      // Update order status based on allocation results
      let newOrderStatus = 'confirmed';
      if (!allocationResults.allocationComplete) {
        newOrderStatus = allowPartialAllocation ? 'partially_allocated' : 'pending';
      }

      await tx
        .update(purchaseOrders)
        .set({
          status: newOrderStatus,
          updatedAt: new Date(),
          metadata: sql`${purchaseOrders.metadata} || ${JSON.stringify({
            allocationResults,
            allocatedAt: new Date().toISOString(),
            allocatedBy: userId
          })}`
        })
        .where(eq(purchaseOrders.id, orderId));

      // Log allocation event
      await logEvent('inventory_allocated', {
        orderId,
        customerId: orderData.customerId,
        allocationResults,
        userId
      }, tx);

      // Send notifications
      await sendAllocationNotifications(orderData, allocationResults);

      return {
        success: true,
        data: allocationResults,
        message: `Allocation complete: ${allocationResults.totalItemsAllocated}/${allocationResults.totalItemsRequested} items fully allocated`
      };
    });

  } catch (error) {
    console.error('Error allocating inventory:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to allocate inventory for order'
    };
  }
}

/**
 * Allocate inventory for a specific order item
 * @param {Object} orderItem - Order item data
 * @param {string} orderId - Order ID
 * @param {boolean} allowPartial - Allow partial allocation
 * @param {Object} tx - Database transaction
 * @returns {Object} Item allocation result
 */
async function allocateItemInventory(orderItem, orderId, allowPartial, tx) {
  // Find available inventory for this product
  const availableInventory = await tx
    .select({
      id: inventory.id,
      warehouseId: inventory.warehouseId,
      quantityAvailable: inventory.quantityAvailable,
      locationId: inventory.locationId
    })
    .from(inventory)
    .innerJoin(products, eq(inventory.productId, products.id))
    .where(
      and(
        eq(products.sku, orderItem.sku),
        gte(inventory.quantityAvailable, 1)
      )
    )
    .orderBy(desc(inventory.quantityAvailable)); // Prioritize locations with more stock

  let quantityToAllocate = orderItem.quantity;
  let quantityAllocated = 0;
  const allocations = [];

  // Allocate from available inventory locations
  for (const inventoryRecord of availableInventory) {
    if (quantityToAllocate <= 0) break;

    const allocateFromThis = Math.min(quantityToAllocate, inventoryRecord.quantityAvailable);
    
    if (allocateFromThis > 0) {
      // Update inventory - reserve the quantity
      await tx
        .update(inventory)
        .set({
          quantityAvailable: sql`${inventory.quantityAvailable} - ${allocateFromThis}`,
          quantityReserved: sql`${inventory.quantityReserved} + ${allocateFromThis}`,
          lastMovement: new Date()
        })
        .where(eq(inventory.id, inventoryRecord.id));

      // Create inventory movement record
      await tx.insert(inventoryMovements).values({
        inventoryId: inventoryRecord.id,
        productId: orderItem.productId,
        warehouseId: inventoryRecord.warehouseId,
        movementType: 'reservation',
        quantity: allocateFromThis,
        referenceType: 'purchase_order',
        referenceId: orderId,
        notes: `Reserved for order ${orderId}`,
        quantityAfter: inventoryRecord.quantityAvailable - allocateFromThis,
        runningTotal: inventoryRecord.quantityAvailable - allocateFromThis
      });

      allocations.push({
        inventoryId: inventoryRecord.id,
        warehouseId: inventoryRecord.warehouseId,
        locationId: inventoryRecord.locationId,
        quantity: allocateFromThis
      });

      quantityAllocated += allocateFromThis;
      quantityToAllocate -= allocateFromThis;
    }
  }

  return {
    orderItemId: orderItem.id,
    sku: orderItem.sku,
    productName: orderItem.productName,
    requested: orderItem.quantity,
    allocated: quantityAllocated,
    remaining: quantityToAllocate,
    allocations,
    allocationComplete: quantityToAllocate === 0
  };
}

// ==================== PICK LISTS ====================

/**
 * Generate pick list for confirmed orders
 * @param {Array} orderIds - Array of order IDs
 * @param {Object} options - Pick list options
 * @returns {Object} Generated pick list
 */
export async function generatePickList(orderIds, options = {}) {
  const {
    warehouseId = null,
    groupByLocation = true,
    includeBarcode = true,
    priority = 'standard',
    userId = null
  } = options;

  try {
    // Validate orders are ready for picking
    const validOrders = await db
      .select({
        id: purchaseOrders.id,
        orderNumber: purchaseOrders.orderNumber,
        customerId: purchaseOrders.customerId,
        customerName: customers.companyName,
        status: purchaseOrders.status
      })
      .from(purchaseOrders)
      .innerJoin(customers, eq(purchaseOrders.customerId, customers.id))
      .where(
        and(
          inArray(purchaseOrders.id, orderIds),
          inArray(purchaseOrders.status, ['confirmed', 'partially_allocated'])
        )
      );

    if (validOrders.length === 0) {
      return {
        success: false,
        error: 'No valid orders for picking',
        message: 'Orders must be confirmed or partially allocated to generate pick lists'
      };
    }

    // Get all order items with their inventory locations
    const pickItems = await db
      .select({
        orderId: purchaseOrderItems.purchaseOrderId,
        orderNumber: purchaseOrders.orderNumber,
        customerName: customers.companyName,
        orderItemId: purchaseOrderItems.id,
        sku: purchaseOrderItems.sku,
        productName: purchaseOrderItems.productName,
        quantityOrdered: purchaseOrderItems.quantity,
        warehouseId: inventory.warehouseId,
        locationId: inventory.locationId,
        quantityReserved: inventory.quantityReserved,
        productId: products.id
      })
      .from(purchaseOrderItems)
      .innerJoin(purchaseOrders, eq(purchaseOrderItems.purchaseOrderId, purchaseOrders.id))
      .innerJoin(customers, eq(purchaseOrders.customerId, customers.id))
      .innerJoin(products, eq(purchaseOrderItems.productId, products.id))
      .innerJoin(inventory, eq(products.id, inventory.productId))
      .where(
        and(
          inArray(purchaseOrderItems.purchaseOrderId, orderIds),
          gte(inventory.quantityReserved, 1),
          warehouseId ? eq(inventory.warehouseId, warehouseId) : sql`true`
        )
      )
      .orderBy(
        inventory.warehouseId,
        inventory.locationId,
        purchaseOrderItems.sku
      );

    // Group items by location if requested
    let organizedItems;
    if (groupByLocation) {
      organizedItems = groupPickItemsByLocation(pickItems);
    } else {
      organizedItems = groupPickItemsByOrder(pickItems);
    }

    const pickListId = `PL-${Date.now()}`;
    
    const pickList = {
      id: pickListId,
      generatedAt: new Date(),
      generatedBy: userId,
      warehouseId,
      priority,
      status: 'pending',
      orderCount: validOrders.length,
      totalItems: pickItems.length,
      orders: validOrders,
      pickItems: organizedItems,
      statistics: {
        totalQuantity: pickItems.reduce((sum, item) => sum + item.quantityOrdered, 0),
        uniqueSkus: new Set(pickItems.map(item => item.sku)).size,
        locations: new Set(pickItems.map(item => `${item.warehouseId}-${item.locationId}`)).size
      }
    };

    // Log pick list generation
    await logEvent('pick_list_generated', {
      pickListId,
      orderIds,
      warehouseId,
      itemCount: pickItems.length,
      userId
    });

    return {
      success: true,
      data: pickList,
      message: `Pick list generated for ${validOrders.length} orders with ${pickItems.length} items`
    };

  } catch (error) {
    console.error('Error generating pick list:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to generate pick list'
    };
  }
}

/**
 * Group pick items by location for efficient picking
 * @param {Array} pickItems - Pick items
 * @returns {Array} Items grouped by location
 */
function groupPickItemsByLocation(pickItems) {
  const locationGroups = new Map();

  for (const item of pickItems) {
    const locationKey = `${item.warehouseId}-${item.locationId}`;
    if (!locationGroups.has(locationKey)) {
      locationGroups.set(locationKey, {
        warehouseId: item.warehouseId,
        locationId: item.locationId,
        items: []
      });
    }
    locationGroups.get(locationKey).items.push(item);
  }

  return Array.from(locationGroups.values());
}

/**
 * Group pick items by order
 * @param {Array} pickItems - Pick items
 * @returns {Array} Items grouped by order
 */
function groupPickItemsByOrder(pickItems) {
  const orderGroups = new Map();

  for (const item of pickItems) {
    if (!orderGroups.has(item.orderId)) {
      orderGroups.set(item.orderId, {
        orderId: item.orderId,
        orderNumber: item.orderNumber,
        customerName: item.customerName,
        items: []
      });
    }
    orderGroups.get(item.orderId).items.push(item);
  }

  return Array.from(orderGroups.values());
}

// ==================== SHIPMENT PROCESSING ====================

/**
 * Process order shipment and update inventory
 * @param {string} orderId - Order ID
 * @param {Array} shipmentItems - Items being shipped
 * @param {Object} shipmentData - Shipment details
 * @returns {Object} Shipment processing results
 */
export async function processOrderShipment(orderId, shipmentItems, shipmentData = {}) {
  const {
    trackingNumber = null,
    carrier = null,
    shippedBy = null,
    notes = null
  } = shipmentData;

  try {
    return await db.transaction(async (tx) => {
      // Get order details
      const orderData = await getOrderWithItems(orderId, tx);
      
      if (!orderData) {
        throw new Error('Order not found');
      }

      if (!['confirmed', 'partially_allocated', 'processing'].includes(orderData.status)) {
        throw new Error(`Order status is ${orderData.status}. Cannot ship orders in this status.`);
      }

      const shipmentResults = {
        orderId,
        shippedItems: [],
        inventoryUpdates: [],
        remainingItems: [],
        shipmentComplete: true
      };

      // Process each shipped item
      for (const shipmentItem of shipmentItems) {
        const orderItem = orderData.items.find(item => item.id === shipmentItem.orderItemId);
        
        if (!orderItem) {
          throw new Error(`Order item ${shipmentItem.orderItemId} not found`);
        }

        const quantityShipped = shipmentItem.quantity;
        
        if (quantityShipped > orderItem.quantity) {
          throw new Error(`Cannot ship ${quantityShipped} of ${orderItem.sku}. Order quantity is ${orderItem.quantity}`);
        }

        // Find reserved inventory for this item
        const reservedInventory = await tx
          .select()
          .from(inventory)
          .innerJoin(products, eq(inventory.productId, products.id))
          .where(
            and(
              eq(products.sku, orderItem.sku),
              gte(inventory.quantityReserved, 1)
            )
          )
          .orderBy(desc(inventory.quantityReserved));

        // Release reserved inventory and update on-hand quantities
        let remainingToShip = quantityShipped;
        const inventoryUpdatesForItem = [];

        for (const inventoryRecord of reservedInventory) {
          if (remainingToShip <= 0) break;

          const releaseFromThis = Math.min(remainingToShip, inventoryRecord.quantityReserved);
          
          if (releaseFromThis > 0) {
            // Update inventory - remove from reserved and on-hand
            await tx
              .update(inventory)
              .set({
                quantityOnHand: sql`${inventory.quantityOnHand} - ${releaseFromThis}`,
                quantityReserved: sql`${inventory.quantityReserved} - ${releaseFromThis}`,
                lastMovement: new Date()
              })
              .where(eq(inventory.id, inventoryRecord.id));

            // Create inventory movement record
            await tx.insert(inventoryMovements).values({
              inventoryId: inventoryRecord.id,
              productId: orderItem.productId,
              warehouseId: inventoryRecord.warehouseId,
              movementType: 'sale',
              quantity: -releaseFromThis, // Negative for outbound
              referenceType: 'shipment',
              referenceId: orderId,
              referenceNumber: trackingNumber,
              notes: `Shipped for order ${orderData.orderNumber}`,
              quantityAfter: inventoryRecord.quantityOnHand - releaseFromThis,
              runningTotal: inventoryRecord.quantityOnHand - releaseFromThis
            });

            inventoryUpdatesForItem.push({
              inventoryId: inventoryRecord.id,
              warehouseId: inventoryRecord.warehouseId,
              quantityShipped: releaseFromThis
            });

            remainingToShip -= releaseFromThis;
          }
        }

        shipmentResults.shippedItems.push({
          orderItemId: orderItem.id,
          sku: orderItem.sku,
          productName: orderItem.productName,
          quantityOrdered: orderItem.quantity,
          quantityShipped,
          inventoryUpdates: inventoryUpdatesForItem
        });

        shipmentResults.inventoryUpdates.push(...inventoryUpdatesForItem);

        // Check if order item is fully shipped
        if (quantityShipped < orderItem.quantity) {
          shipmentResults.remainingItems.push({
            orderItemId: orderItem.id,
            sku: orderItem.sku,
            quantityRemaining: orderItem.quantity - quantityShipped
          });
          shipmentResults.shipmentComplete = false;
        }
      }

      // Update order status
      const newOrderStatus = shipmentResults.shipmentComplete ? 'shipped' : 'partially_shipped';
      const updateData = {
        status: newOrderStatus,
        updatedAt: new Date(),
        metadata: sql`${purchaseOrders.metadata} || ${JSON.stringify({
          shipmentProcessed: new Date().toISOString(),
          trackingNumber,
          carrier,
          shippedBy
        })}`
      };

      if (newOrderStatus === 'shipped') {
        updateData.shippedDate = new Date();
      }

      await tx
        .update(purchaseOrders)
        .set(updateData)
        .where(eq(purchaseOrders.id, orderId));

      // Log shipment event
      await logEvent('order_shipped', {
        orderId,
        customerId: orderData.customerId,
        trackingNumber,
        carrier,
        shipmentResults,
        shippedBy
      }, tx);

      // Send shipment notifications
      await sendShipmentNotifications(orderData, shipmentResults, { trackingNumber, carrier });

      return {
        success: true,
        data: shipmentResults,
        message: `Shipment processed: ${shipmentResults.shippedItems.length} items shipped`
      };
    });

  } catch (error) {
    console.error('Error processing shipment:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to process order shipment'
    };
  }
}

// ==================== BACKORDER MANAGEMENT ====================

/**
 * Create backorder for unavailable items
 * @param {string} orderId - Original order ID
 * @param {Array} backorderItems - Items to backorder
 * @param {Object} options - Backorder options
 * @returns {Object} Backorder creation results
 */
export async function createBackorder(orderId, backorderItems, options = {}) {
  const {
    expectedDate = null,
    autoFulfill = true,
    userId = null
  } = options;

  try {
    return await db.transaction(async (tx) => {
      // Get original order
      const [originalOrder] = await tx
        .select()
        .from(purchaseOrders)
        .where(eq(purchaseOrders.id, orderId));

      if (!originalOrder) {
        throw new Error('Original order not found');
      }

      // Create backorder
      const backorderNumber = `${originalOrder.orderNumber}-BO-${Date.now()}`;
      
      const [backorder] = await tx
        .insert(purchaseOrders)
        .values({
          orderNumber: backorderNumber,
          customerId: originalOrder.customerId,
          status: 'backorder',
          subtotal: '0',
          totalAmount: '0',
          currency: originalOrder.currency,
          shippingAddress: originalOrder.shippingAddress,
          billingAddress: originalOrder.billingAddress,
          notes: `Backorder for ${originalOrder.orderNumber}`,
          metadata: {
            originalOrderId: orderId,
            isBackorder: true,
            expectedDate,
            autoFulfill
          }
        })
        .returning();

      // Add backorder items
      const backorderItemsToInsert = backorderItems.map(item => ({
        purchaseOrderId: backorder.id,
        productId: item.productId,
        sku: item.sku,
        productName: item.productName,
        quantity: item.quantity,
        unitPrice: item.unitPrice || '0',
        lineTotal: (item.quantity * (item.unitPrice || 0)).toString()
      }));

      const createdItems = await tx
        .insert(purchaseOrderItems)
        .values(backorderItemsToInsert)
        .returning();

      // Update backorder totals
      const totalAmount = createdItems.reduce((sum, item) => sum + parseFloat(item.lineTotal), 0);
      
      await tx
        .update(purchaseOrders)
        .set({
          subtotal: totalAmount.toString(),
          totalAmount: totalAmount.toString()
        })
        .where(eq(purchaseOrders.id, backorder.id));

      // Log backorder creation
      await logEvent('backorder_created', {
        originalOrderId: orderId,
        backorderId: backorder.id,
        itemCount: createdItems.length,
        expectedDate,
        userId
      }, tx);

      return {
        success: true,
        data: {
          backorder,
          items: createdItems,
          originalOrderId: orderId
        },
        message: `Backorder ${backorderNumber} created with ${createdItems.length} items`
      };
    });

  } catch (error) {
    console.error('Error creating backorder:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to create backorder'
    };
  }
}

// ==================== RETURNS PROCESSING ====================

/**
 * Process return and update inventory
 * @param {string} orderId - Original order ID
 * @param {Array} returnItems - Items being returned
 * @param {Object} returnData - Return details
 * @returns {Object} Return processing results
 */
export async function processReturn(orderId, returnItems, returnData = {}) {
  const {
    reason = 'customer_return',
    condition = 'good',
    restockable = true,
    userId = null,
    notes = null
  } = returnData;

  try {
    return await db.transaction(async (tx) => {
      const returnResults = {
        orderId,
        returnedItems: [],
        inventoryUpdates: [],
        nonRestockableItems: []
      };

      // Process each returned item
      for (const returnItem of returnItems) {
        const [orderItem] = await tx
          .select()
          .from(purchaseOrderItems)
          .where(
            and(
              eq(purchaseOrderItems.purchaseOrderId, orderId),
              eq(purchaseOrderItems.id, returnItem.orderItemId)
            )
          );

        if (!orderItem) {
          throw new Error(`Order item ${returnItem.orderItemId} not found`);
        }

        if (returnItem.quantity > orderItem.quantity) {
          throw new Error(`Cannot return ${returnItem.quantity} of ${orderItem.sku}. Order quantity was ${orderItem.quantity}`);
        }

        if (restockable && condition === 'good') {
          // Find inventory location to restock (prefer original shipment location)
          const [inventoryLocation] = await tx
            .select()
            .from(inventory)
            .innerJoin(products, eq(inventory.productId, products.id))
            .where(eq(products.sku, orderItem.sku))
            .limit(1);

          if (inventoryLocation) {
            // Restock inventory
            await tx
              .update(inventory)
              .set({
                quantityOnHand: sql`${inventory.quantityOnHand} + ${returnItem.quantity}`,
                quantityAvailable: sql`${inventory.quantityAvailable} + ${returnItem.quantity}`,
                lastMovement: new Date()
              })
              .where(eq(inventory.id, inventoryLocation.id));

            // Create inventory movement record
            await tx.insert(inventoryMovements).values({
              inventoryId: inventoryLocation.id,
              productId: orderItem.productId,
              warehouseId: inventoryLocation.warehouseId,
              movementType: 'return',
              quantity: returnItem.quantity,
              referenceType: 'customer_return',
              referenceId: orderId,
              notes: `Customer return: ${reason}`,
              quantityAfter: inventoryLocation.quantityOnHand + returnItem.quantity,
              runningTotal: inventoryLocation.quantityOnHand + returnItem.quantity
            });

            returnResults.inventoryUpdates.push({
              inventoryId: inventoryLocation.id,
              sku: orderItem.sku,
              quantityReturned: returnItem.quantity,
              restocked: true
            });
          }
        } else {
          // Non-restockable return
          returnResults.nonRestockableItems.push({
            sku: orderItem.sku,
            quantity: returnItem.quantity,
            reason: condition === 'damaged' ? 'damaged' : 'non_restockable'
          });
        }

        returnResults.returnedItems.push({
          orderItemId: orderItem.id,
          sku: orderItem.sku,
          productName: orderItem.productName,
          quantityReturned: returnItem.quantity,
          condition,
          restockable: restockable && condition === 'good'
        });
      }

      // Log return event
      await logEvent('order_return_processed', {
        orderId,
        returnResults,
        reason,
        condition,
        userId
      }, tx);

      return {
        success: true,
        data: returnResults,
        message: `Return processed: ${returnResults.returnedItems.length} items`
      };
    });

  } catch (error) {
    console.error('Error processing return:', error);
    return {
      success: false,
      error: error.message,
      message: 'Failed to process return'
    };
  }
}

// ==================== HELPER FUNCTIONS ====================

/**
 * Get order with items
 * @param {string} orderId - Order ID
 * @param {Object} tx - Database transaction (optional)
 * @returns {Object} Order with items
 */
async function getOrderWithItems(orderId, tx = db) {
  const [order] = await tx
    .select()
    .from(purchaseOrders)
    .where(eq(purchaseOrders.id, orderId));

  if (!order) return null;

  const items = await tx
    .select()
    .from(purchaseOrderItems)
    .where(eq(purchaseOrderItems.purchaseOrderId, orderId));

  return { ...order, items };
}

/**
 * Log workflow events
 * @param {string} eventType - Event type
 * @param {Object} eventData - Event data
 * @param {Object} tx - Database transaction (optional)
 */
async function logEvent(eventType, eventData, tx = db) {
  try {
    await tx.insert(timeSeriesEvents).values({
      eventType,
      eventCategory: 'order_fulfillment',
      action: eventType,
      properties: eventData,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error logging event:', error);
  }
}

/**
 * Send allocation notifications
 * @param {Object} orderData - Order data
 * @param {Object} allocationResults - Allocation results
 */
async function sendAllocationNotifications(orderData, allocationResults) {
  try {
    if (!allocationResults.allocationComplete) {
      await sendNotification({
        type: 'partial_allocation',
        title: 'Partial Inventory Allocation',
        message: `Order ${orderData.orderNumber} partially allocated - ${allocationResults.unavailableItems.length} items unavailable`,
        data: {
          orderId: orderData.id,
          orderNumber: orderData.orderNumber,
          unavailableItems: allocationResults.unavailableItems
        },
        priority: 'high',
        category: 'fulfillment'
      });
    }
  } catch (error) {
    console.error('Error sending allocation notifications:', error);
  }
}

/**
 * Send shipment notifications
 * @param {Object} orderData - Order data
 * @param {Object} shipmentResults - Shipment results
 * @param {Object} shipmentInfo - Shipment information
 */
async function sendShipmentNotifications(orderData, shipmentResults, shipmentInfo) {
  try {
    await sendNotification({
      type: 'order_shipped',
      title: 'Order Shipped',
      message: `Order ${orderData.orderNumber} has been shipped`,
      data: {
        orderId: orderData.id,
        orderNumber: orderData.orderNumber,
        trackingNumber: shipmentInfo.trackingNumber,
        carrier: shipmentInfo.carrier,
        itemCount: shipmentResults.shippedItems.length
      },
      priority: 'medium',
      category: 'fulfillment'
    });
  } catch (error) {
    console.error('Error sending shipment notifications:', error);
  }
}

export default {
  allocateInventoryForOrder,
  generatePickList,
  processOrderShipment,
  createBackorder,
  processReturn
};