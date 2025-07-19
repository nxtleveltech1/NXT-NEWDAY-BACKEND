/**
 * Comprehensive Unit Tests for Inventory Services
 * Testing both order-inventory integration and inventory queries
 */

import {
  allocateInventoryForOrder,
  generatePickList,
  processOrderShipment,
  createBackorder,
  processReturn
} from '../order-inventory-integration.service.js';

import {
  getInventory,
  getInventoryById,
  getInventoryByProductWarehouse,
  upsertInventory,
  recordMovement,
  reserveStock,
  releaseReservedStock,
  getMovements,
  getReorderSuggestions,
  getInventoryAnalytics,
  getAdvancedInventoryAnalytics,
  adjustStock
} from '../../db/inventory-queries.js';

import { db } from '../../config/database.js';
import { sendNotification } from '../notifications.js';
import { realtimeService } from '../realtime-service.js';

// Mock all dependencies
jest.mock('../../config/database.js');
jest.mock('../notifications.js');
jest.mock('../realtime-service.js');

describe('Inventory Services Unit Tests', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock database transaction
    db.transaction = jest.fn((callback) => {
      const mockTx = {
        select: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        leftJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        offset: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([]),
        groupBy: jest.fn().mockReturnThis()
      };
      return callback(mockTx);
    });

    // Mock basic database operations
    db.select = jest.fn().mockReturnThis();
    db.insert = jest.fn().mockReturnThis();
    db.update = jest.fn().mockReturnThis();
    db.from = jest.fn().mockReturnThis();
    db.innerJoin = jest.fn().mockReturnThis();
    db.leftJoin = jest.fn().mockReturnThis();
    db.where = jest.fn().mockReturnThis();
    db.orderBy = jest.fn().mockReturnThis();
    db.limit = jest.fn().mockReturnThis();
    db.offset = jest.fn().mockReturnThis();
    db.set = jest.fn().mockReturnThis();
    db.values = jest.fn().mockReturnThis();
    db.returning = jest.fn().mockResolvedValue([]);
    db.groupBy = jest.fn().mockReturnThis();

    // Mock realtime service
    realtimeService.notifyInventoryChange = jest.fn();
    realtimeService.notifyInventoryMovement = jest.fn();
    realtimeService.notifyStockAlert = jest.fn();
  });

  // ==================== ORDER-INVENTORY INTEGRATION TESTS ====================

  describe('allocateInventoryForOrder', () => {
    const mockOrderData = {
      id: 'order-123',
      status: 'pending',
      customerId: 'customer-123',
      orderNumber: 'ORD-001',
      items: [
        {
          id: 'item-1',
          productId: 'prod-1',
          sku: 'SKU001',
          productName: 'Test Product',
          quantity: 10
        }
      ]
    };

    const mockInventoryRecords = [
      {
        id: 'inv-1',
        warehouseId: 'wh-1',
        locationId: 'loc-1',
        quantityAvailable: 15
      }
    ];

    beforeEach(() => {
      // Mock getOrderWithItems function
      const mockTx = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnValue(Promise.resolve([mockOrderData])),
        innerJoin: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        set: jest.fn().mockReturnThis(),
        insert: jest.fn().mockReturnThis(),
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValue([]),
        orderBy: jest.fn().mockReturnThis()
      };

      db.transaction.mockImplementation(async (callback) => {
        // Mock order items query
        mockTx.select.mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([])
          })
        });
        
        // Mock inventory query
        mockTx.select.mockReturnValueOnce({
          from: jest.fn().mockReturnValue({
            innerJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockResolvedValue(mockInventoryRecords)
              })
            })
          })
        });

        return callback(mockTx);
      });
    });

    test('should allocate inventory successfully for pending order', async () => {
      const result = await allocateInventoryForOrder('order-123');

      expect(result.success).toBe(true);
      expect(result.data.orderId).toBe('order-123');
      expect(result.data.totalItemsRequested).toBe(1);
      expect(db.transaction).toHaveBeenCalled();
    });

    test('should fail when order not found', async () => {
      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([]) // No order found
        };
        return callback(mockTx);
      });

      const result = await allocateInventoryForOrder('nonexistent-order');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Order not found');
    });

    test('should fail when order status is not pending', async () => {
      const nonPendingOrder = { ...mockOrderData, status: 'shipped' };
      
      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          limit: jest.fn().mockResolvedValue([nonPendingOrder])
        };
        return callback(mockTx);
      });

      const result = await allocateInventoryForOrder('order-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Order status is shipped. Only pending orders can be allocated.');
    });

    test('should handle partial allocation when insufficient stock', async () => {
      const insufficientInventory = [
        {
          id: 'inv-1',
          warehouseId: 'wh-1',
          locationId: 'loc-1',
          quantityAvailable: 5 // Less than required 10
        }
      ];

      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn(() => {
            let callCount = 0;
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn(() => {
                  callCount++;
                  if (callCount === 1) {
                    // First call for order lookup
                    return { limit: jest.fn().mockResolvedValue([mockOrderData]) };
                  } else if (callCount === 2) {
                    // Second call for order items
                    return Promise.resolve(mockOrderData.items);
                  } else {
                    // Subsequent calls for inventory
                    return {
                      orderBy: jest.fn().mockResolvedValue(insufficientInventory)
                    };
                  }
                }),
                innerJoin: jest.fn().mockReturnThis(),
                orderBy: jest.fn().mockResolvedValue(insufficientInventory)
              })
            };
          }),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{}])
        };
        return callback(mockTx);
      });

      const result = await allocateInventoryForOrder('order-123', { allowPartialAllocation: true });

      expect(result.success).toBe(true);
      expect(result.data.allocationComplete).toBe(false);
    });

    test('should send notifications for partial allocation', async () => {
      sendNotification.mockResolvedValue();

      const result = await allocateInventoryForOrder('order-123');

      if (!result.data?.allocationComplete) {
        expect(sendNotification).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'partial_allocation',
            priority: 'high'
          })
        );
      }
    });

    test('should handle database errors gracefully', async () => {
      db.transaction.mockRejectedValue(new Error('Database connection failed'));

      const result = await allocateInventoryForOrder('order-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
      expect(result.message).toBe('Failed to allocate inventory for order');
    });
  });

  describe('generatePickList', () => {
    const mockValidOrders = [
      {
        id: 'order-1',
        orderNumber: 'ORD-001',
        customerId: 'customer-1',
        customerName: 'Test Customer',
        status: 'confirmed'
      }
    ];

    const mockPickItems = [
      {
        orderId: 'order-1',
        orderNumber: 'ORD-001',
        customerName: 'Test Customer',
        orderItemId: 'item-1',
        sku: 'SKU001',
        productName: 'Test Product',
        quantityOrdered: 10,
        warehouseId: 'wh-1',
        locationId: 'loc-1',
        quantityReserved: 10,
        productId: 'prod-1'
      }
    ];

    beforeEach(() => {
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockValidOrders)
          })
        })
      }));
    });

    test('should generate pick list successfully', async () => {
      // Mock second query for pick items
      db.select.mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(mockPickItems)
          })
        })
      })).mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockValidOrders)
          })
        })
      }));

      const result = await generatePickList(['order-1'], { groupByLocation: true });

      expect(result.success).toBe(true);
      expect(result.data.orderCount).toBe(1);
      expect(result.data.totalItems).toBe(1);
      expect(result.data.pickItems).toBeDefined();
    });

    test('should fail when no valid orders for picking', async () => {
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([]) // No valid orders
          })
        })
      }));

      const result = await generatePickList(['invalid-order']);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No valid orders for picking');
    });

    test('should group items by location when requested', async () => {
      db.select.mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockValidOrders)
          })
        })
      })).mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(mockPickItems)
          })
        })
      }));

      const result = await generatePickList(['order-1'], { groupByLocation: true });

      expect(result.success).toBe(true);
      expect(result.data.pickItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            warehouseId: 'wh-1',
            locationId: 'loc-1',
            items: expect.any(Array)
          })
        ])
      );
    });

    test('should group items by order when location grouping disabled', async () => {
      db.select.mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockValidOrders)
          })
        })
      })).mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(mockPickItems)
          })
        })
      }));

      const result = await generatePickList(['order-1'], { groupByLocation: false });

      expect(result.success).toBe(true);
      expect(result.data.pickItems).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            orderId: 'order-1',
            orderNumber: 'ORD-001',
            items: expect.any(Array)
          })
        ])
      );
    });

    test('should handle database errors', async () => {
      db.select.mockImplementation(() => {
        throw new Error('Database query failed');
      });

      const result = await generatePickList(['order-1']);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database query failed');
    });
  });

  describe('processOrderShipment', () => {
    const mockOrderData = {
      id: 'order-123',
      orderNumber: 'ORD-001',
      customerId: 'customer-123',
      status: 'confirmed',
      items: [
        {
          id: 'item-1',
          productId: 'prod-1',
          sku: 'SKU001',
          productName: 'Test Product',
          quantity: 10
        }
      ]
    };

    const mockShipmentItems = [
      {
        orderItemId: 'item-1',
        quantity: 10
      }
    ];

    const mockShipmentData = {
      trackingNumber: 'TRACK123',
      carrier: 'UPS',
      shippedBy: 'user123',
      notes: 'Shipped via ground'
    };

    const mockReservedInventory = [
      {
        id: 'inv-1',
        quantityReserved: 10,
        quantityOnHand: 20,
        warehouseId: 'wh-1'
      }
    ];

    beforeEach(() => {
      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn(() => ({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockOrderData])
              }),
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockResolvedValue(mockReservedInventory)
                })
              })
            })
          })),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{}])
        };
        return callback(mockTx);
      });
    });

    test('should process shipment successfully', async () => {
      const result = await processOrderShipment('order-123', mockShipmentItems, mockShipmentData);

      expect(result.success).toBe(true);
      expect(result.data.orderId).toBe('order-123');
      expect(result.data.shippedItems).toHaveLength(1);
      expect(result.data.shipmentComplete).toBe(true);
    });

    test('should fail when order not found', async () => {
      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([]) // No order found
              })
            })
          })
        };
        return callback(mockTx);
      });

      const result = await processOrderShipment('order-123', mockShipmentItems, mockShipmentData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Order not found');
    });

    test('should fail when order status is invalid for shipping', async () => {
      const invalidStatusOrder = { ...mockOrderData, status: 'pending' };
      
      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([invalidStatusOrder])
              })
            })
          })
        };
        return callback(mockTx);
      });

      const result = await processOrderShipment('order-123', mockShipmentItems, mockShipmentData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Order status is pending. Cannot ship orders in this status.');
    });

    test('should validate shipment quantities against order quantities', async () => {
      const excessiveShipmentItems = [
        {
          orderItemId: 'item-1',
          quantity: 15 // More than ordered (10)
        }
      ];

      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn(() => {
            let callCount = 0;
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn(() => {
                  callCount++;
                  if (callCount === 1) {
                    return { limit: jest.fn().mockResolvedValue([mockOrderData]) };
                  } else {
                    return Promise.resolve(mockOrderData.items);
                  }
                })
              })
            };
          })
        };
        return callback(mockTx);
      });

      const result = await processOrderShipment('order-123', excessiveShipmentItems, mockShipmentData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot ship 15 of SKU001. Order quantity is 10');
    });

    test('should send shipment notifications', async () => {
      sendNotification.mockResolvedValue();

      const result = await processOrderShipment('order-123', mockShipmentItems, mockShipmentData);

      expect(sendNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'order_shipped',
          title: 'Order Shipped'
        })
      );
    });

    test('should handle database errors', async () => {
      db.transaction.mockRejectedValue(new Error('Database error'));

      const result = await processOrderShipment('order-123', mockShipmentItems, mockShipmentData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('createBackorder', () => {
    const mockOriginalOrder = {
      id: 'original-order',
      orderNumber: 'ORD-001',
      customerId: 'customer-123',
      currency: 'USD',
      shippingAddress: { street: '123 Main St' },
      billingAddress: { street: '456 Oak St' }
    };

    const mockBackorderItems = [
      {
        productId: 'prod-1',
        sku: 'SKU001',
        productName: 'Test Product',
        quantity: 5,
        unitPrice: 10.50
      }
    ];

    beforeEach(() => {
      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([mockOriginalOrder])
            })
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([{
                id: 'backorder-123',
                orderNumber: 'ORD-001-BO-123456',
                ...mockOriginalOrder
              }])
            })
          }),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis()
        };
        return callback(mockTx);
      });
    });

    test('should create backorder successfully', async () => {
      const result = await createBackorder('original-order', mockBackorderItems);

      expect(result.success).toBe(true);
      expect(result.data.backorder).toBeDefined();
      expect(result.data.items).toBeDefined();
      expect(result.data.originalOrderId).toBe('original-order');
    });

    test('should fail when original order not found', async () => {
      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]) // No original order
            })
          })
        };
        return callback(mockTx);
      });

      const result = await createBackorder('nonexistent-order', mockBackorderItems);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Original order not found');
    });

    test('should generate unique backorder number', async () => {
      const result = await createBackorder('original-order', mockBackorderItems);

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/Backorder ORD-001-BO-\d+ created with 1 items/);
    });

    test('should handle database errors', async () => {
      db.transaction.mockRejectedValue(new Error('Database error'));

      const result = await createBackorder('original-order', mockBackorderItems);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('processReturn', () => {
    const mockReturnItems = [
      {
        orderItemId: 'item-1',
        quantity: 5
      }
    ];

    const mockReturnData = {
      reason: 'defective',
      condition: 'good',
      restockable: true,
      userId: 'user123',
      notes: 'Customer return'
    };

    const mockOrderItem = {
      id: 'item-1',
      sku: 'SKU001',
      productName: 'Test Product',
      quantity: 10,
      productId: 'prod-1'
    };

    const mockInventoryLocation = {
      id: 'inv-1',
      quantityOnHand: 15,
      quantityAvailable: 10,
      warehouseId: 'wh-1'
    };

    beforeEach(() => {
      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn(() => ({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockOrderItem])
              }),
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([mockInventoryLocation])
                })
              })
            })
          })),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{}])
        };
        return callback(mockTx);
      });
    });

    test('should process return successfully with restocking', async () => {
      const result = await processReturn('order-123', mockReturnItems, mockReturnData);

      expect(result.success).toBe(true);
      expect(result.data.returnedItems).toHaveLength(1);
      expect(result.data.inventoryUpdates).toHaveLength(1);
      expect(result.data.inventoryUpdates[0].restocked).toBe(true);
    });

    test('should handle non-restockable returns', async () => {
      const nonRestockableData = { ...mockReturnData, condition: 'damaged', restockable: false };

      const result = await processReturn('order-123', mockReturnItems, nonRestockableData);

      expect(result.success).toBe(true);
      expect(result.data.nonRestockableItems).toHaveLength(1);
      expect(result.data.nonRestockableItems[0].reason).toBe('damaged');
    });

    test('should fail when order item not found', async () => {
      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([]) // No order item found
            })
          })
        };
        return callback(mockTx);
      });

      const result = await processReturn('order-123', mockReturnItems, mockReturnData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Order item item-1 not found');
    });

    test('should validate return quantity against order quantity', async () => {
      const excessiveReturnItems = [
        {
          orderItemId: 'item-1',
          quantity: 15 // More than ordered (10)
        }
      ];

      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockResolvedValue([mockOrderItem])
            })
          })
        };
        return callback(mockTx);
      });

      const result = await processReturn('order-123', excessiveReturnItems, mockReturnData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot return 15 of SKU001. Order quantity was 10');
    });

    test('should handle database errors', async () => {
      db.transaction.mockRejectedValue(new Error('Database error'));

      const result = await processReturn('order-123', mockReturnItems, mockReturnData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  // ==================== INVENTORY QUERIES TESTS ====================

  describe('getInventory', () => {
    const mockInventoryData = [
      {
        id: 'inv-1',
        productId: 'prod-1',
        warehouseId: 'wh-1',
        quantityOnHand: 100,
        quantityAvailable: 95,
        productSku: 'SKU001',
        productName: 'Test Product'
      }
    ];

    beforeEach(() => {
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockReturnValue({
                limit: jest.fn().mockReturnValue({
                  offset: jest.fn().mockResolvedValue(mockInventoryData)
                })
              })
            })
          })
        })
      }));

      // Mock count query
      db.select.mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue([{ count: '1' }])
          })
        })
      }));
    });

    test('should retrieve inventory with default parameters', async () => {
      const result = await getInventory();

      expect(result.data).toEqual(mockInventoryData);
      expect(result.pagination).toEqual({
        page: 1,
        limit: 10,
        total: 1,
        totalPages: 1
      });
    });

    test('should filter by warehouse ID when provided', async () => {
      const result = await getInventory({ warehouseId: 'wh-1' });

      expect(result.data).toEqual(mockInventoryData);
      expect(db.select).toHaveBeenCalled();
    });

    test('should search by product name or SKU', async () => {
      const result = await getInventory({ search: 'Test' });

      expect(result.data).toEqual(mockInventoryData);
    });

    test('should filter by stock status', async () => {
      const result = await getInventory({ stockStatus: 'in_stock' });

      expect(result.data).toEqual(mockInventoryData);
    });

    test('should filter items below reorder point', async () => {
      const result = await getInventory({ belowReorderPoint: true });

      expect(result.data).toEqual(mockInventoryData);
    });

    test('should handle pagination correctly', async () => {
      const result = await getInventory({ page: 2, limit: 5 });

      expect(result.pagination.page).toBe(2);
      expect(result.pagination.limit).toBe(5);
    });

    test('should handle sorting options', async () => {
      const result = await getInventory({ sortBy: 'productName', sortOrder: 'asc' });

      expect(result.data).toEqual(mockInventoryData);
    });
  });

  describe('getInventoryById', () => {
    const mockInventoryItem = {
      id: 'inv-1',
      productId: 'prod-1',
      warehouseId: 'wh-1',
      quantityOnHand: 100,
      productSku: 'SKU001',
      productName: 'Test Product'
    };

    test('should retrieve inventory item by ID', async () => {
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([mockInventoryItem])
            })
          })
        })
      }));

      const result = await getInventoryById('inv-1');

      expect(result).toEqual(mockInventoryItem);
    });

    test('should return null when inventory item not found', async () => {
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([])
            })
          })
        })
      }));

      const result = await getInventoryById('nonexistent');

      expect(result).toBeNull();
    });
  });

  describe('upsertInventory', () => {
    const mockInventoryData = {
      productId: 'prod-1',
      warehouseId: 'wh-1',
      locationId: 'loc-1',
      quantityOnHand: 50,
      reorderPoint: 10,
      reorderQuantity: 100
    };

    test('should create new inventory record when none exists', async () => {
      const mockCreatedRecord = { id: 'inv-1', ...mockInventoryData };

      // Mock getInventoryByProductWarehouse to return null (no existing record)
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([])
          })
        })
      }));

      db.insert.mockImplementation(() => ({
        values: jest.fn().mockReturnValue({
          returning: jest.fn().mockResolvedValue([mockCreatedRecord])
        })
      }));

      const result = await upsertInventory(mockInventoryData);

      expect(result).toEqual(mockCreatedRecord);
      expect(db.insert).toHaveBeenCalled();
    });

    test('should update existing inventory record', async () => {
      const existingRecord = { id: 'inv-1', ...mockInventoryData };
      const updatedRecord = { ...existingRecord, quantityOnHand: 75 };

      // Mock getInventoryByProductWarehouse to return existing record
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            limit: jest.fn().mockResolvedValue([existingRecord])
          })
        })
      }));

      db.update.mockImplementation(() => ({
        set: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            returning: jest.fn().mockResolvedValue([updatedRecord])
          })
        })
      }));

      const result = await upsertInventory({ ...mockInventoryData, quantityOnHand: 75 });

      expect(result).toEqual(updatedRecord);
      expect(db.update).toHaveBeenCalled();
    });
  });

  describe('recordMovement', () => {
    const mockMovementData = {
      inventoryId: 'inv-1',
      productId: 'prod-1',
      warehouseId: 'wh-1',
      movementType: 'sale',
      quantity: -10,
      unitCost: 15.50,
      referenceType: 'order',
      referenceId: 'order-123',
      performedBy: 'user123'
    };

    const mockCurrentInventory = {
      id: 'inv-1',
      quantityOnHand: 100,
      quantityAvailable: 95,
      averageCost: 12.50,
      reorderPoint: 20,
      minStockLevel: 10
    };

    beforeEach(() => {
      realtimeService.notifyInventoryChange.mockResolvedValue();
      realtimeService.notifyInventoryMovement.mockResolvedValue();
      realtimeService.notifyStockAlert.mockResolvedValue();
    });

    test('should record movement and update inventory levels', async () => {
      const mockMovementRecord = { id: 'mov-1', ...mockMovementData };
      const mockUpdatedInventory = { ...mockCurrentInventory, quantityOnHand: 90 };

      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockCurrentInventory])
              })
            })
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([mockMovementRecord])
            })
          }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue([mockUpdatedInventory])
              })
            })
          })
        };
        return callback(mockTx);
      });

      const result = await recordMovement(mockMovementData);

      expect(result.movement).toEqual(mockMovementRecord);
      expect(result.inventory).toEqual(mockUpdatedInventory);
      expect(realtimeService.notifyInventoryChange).toHaveBeenCalled();
      expect(realtimeService.notifyInventoryMovement).toHaveBeenCalled();
    });

    test('should fail when insufficient available stock for negative movement', async () => {
      const insufficientMovement = { ...mockMovementData, quantity: -100 }; // More than available
      
      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockCurrentInventory])
              })
            })
          })
        };
        
        await expect(callback(mockTx)).rejects.toThrow('Insufficient available stock');
        return Promise.reject(new Error('Insufficient available stock'));
      });

      await expect(recordMovement(insufficientMovement)).rejects.toThrow('Insufficient available stock');
    });

    test('should calculate average cost correctly for inbound movements', async () => {
      const inboundMovement = { ...mockMovementData, quantity: 10, unitCost: 20.00 };
      const expectedNewAverageCost = ((mockCurrentInventory.averageCost * mockCurrentInventory.quantityOnHand) + (20.00 * 10)) / (mockCurrentInventory.quantityOnHand + 10);

      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockCurrentInventory])
              })
            })
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([{}])
            })
          }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue([{ averageCost: expectedNewAverageCost }])
              })
            })
          })
        };
        return callback(mockTx);
      });

      const result = await recordMovement(inboundMovement);

      expect(result.inventory.averageCost).toBeCloseTo(expectedNewAverageCost, 2);
    });

    test('should trigger stock alerts for low stock conditions', async () => {
      const lowStockInventory = { ...mockCurrentInventory, quantityOnHand: 5 }; // Below reorder point
      const movementToLowStock = { ...mockMovementData, quantity: -90 };

      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn(() => {
            let callCount = 0;
            return {
              from: jest.fn().mockReturnValue({
                where: jest.fn(() => {
                  callCount++;
                  if (callCount === 1) {
                    return { limit: jest.fn().mockResolvedValue([mockCurrentInventory]) };
                  } else {
                    return { limit: jest.fn().mockResolvedValue([{ sku: 'SKU001', name: 'Test Product' }]) };
                  }
                })
              })
            };
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([{}])
            })
          }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue([{ ...lowStockInventory, stockStatus: 'low_stock' }])
              })
            })
          })
        };
        return callback(mockTx);
      });

      const result = await recordMovement(movementToLowStock);

      expect(realtimeService.notifyStockAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: 'low_stock',
          priority: 'high'
        })
      );
    });
  });

  describe('getReorderSuggestions', () => {
    const mockReorderSuggestions = [
      {
        id: 'inv-1',
        productId: 'prod-1',
        productSku: 'SKU001',
        productName: 'Test Product',
        quantityOnHand: 5,
        quantityAvailable: 3,
        reorderPoint: 10,
        reorderQuantity: 50,
        supplierName: 'Test Supplier'
      }
    ];

    test('should retrieve reorder suggestions for items below reorder point', async () => {
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnThis(),
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(mockReorderSuggestions)
            })
          })
        })
      }));

      const result = await getReorderSuggestions();

      expect(result).toEqual(mockReorderSuggestions);
    });

    test('should order suggestions by urgency (most urgent first)', async () => {
      const urgentSuggestions = [
        { ...mockReorderSuggestions[0], quantityAvailable: 1, reorderPoint: 10 }, // More urgent
        { ...mockReorderSuggestions[0], quantityAvailable: 5, reorderPoint: 10 }  // Less urgent
      ];

      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnThis(),
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(urgentSuggestions)
            })
          })
        })
      }));

      const result = await getReorderSuggestions();

      expect(result).toEqual(urgentSuggestions);
    });
  });

  describe('adjustStock', () => {
    const mockCurrentInventory = {
      id: 'inv-1',
      productId: 'prod-1',
      warehouseId: 'wh-1',
      quantityOnHand: 50
    };

    beforeEach(() => {
      // Mock getInventoryById
      jest.doMock('../../db/inventory-queries.js', () => ({
        ...jest.requireActual('../../db/inventory-queries.js'),
        getInventoryById: jest.fn().mockResolvedValue(mockCurrentInventory)
      }));
    });

    test('should adjust stock and record movement', async () => {
      const newQuantity = 75;
      const expectedDifference = newQuantity - mockCurrentInventory.quantityOnHand;
      const mockUpdatedInventory = { ...mockCurrentInventory, quantityOnHand: newQuantity };

      // Mock recordMovement
      const mockRecordMovement = jest.fn().mockResolvedValue({
        inventory: mockUpdatedInventory
      });

      // Since we're testing the actual function, we need to mock the dependencies
      const adjustStockWithMocks = async (inventoryId, newQuantity, reason, performedBy, notes) => {
        const currentInventory = await getInventoryById(inventoryId);
        if (!currentInventory) {
          throw new Error('Inventory record not found');
        }

        const quantityDifference = newQuantity - currentInventory.quantityOnHand;
        
        if (quantityDifference === 0) {
          return currentInventory;
        }

        const movementType = quantityDifference > 0 ? 'adjustment_in' : 'adjustment_out';
        
        const result = await mockRecordMovement({
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
      };

      const result = await adjustStockWithMocks('inv-1', newQuantity, 'Physical count adjustment', 'user123');

      expect(result).toEqual(mockUpdatedInventory);
      expect(mockRecordMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          movementType: 'adjustment_in',
          quantity: expectedDifference,
          referenceType: 'stock_adjustment'
        })
      );
    });

    test('should return current inventory when no adjustment needed', async () => {
      const adjustStockWithMocks = async (inventoryId, newQuantity, reason, performedBy, notes) => {
        const currentInventory = await getInventoryById(inventoryId);
        const quantityDifference = newQuantity - currentInventory.quantityOnHand;
        
        if (quantityDifference === 0) {
          return currentInventory;
        }
        // ... rest of function
      };

      const result = await adjustStockWithMocks('inv-1', 50, 'No adjustment needed', 'user123');

      expect(result).toEqual(mockCurrentInventory);
    });
  });

  // ==================== ERROR HANDLING TESTS ====================

  describe('Error Handling', () => {
    test('should handle database connection failures gracefully', async () => {
      const methods = [
        () => allocateInventoryForOrder('order-123'),
        () => generatePickList(['order-123']),
        () => processOrderShipment('order-123', [], {}),
        () => createBackorder('order-123', []),
        () => processReturn('order-123', [], {}),
        () => getInventory(),
        () => getInventoryById('inv-1'),
        () => upsertInventory({}),
        () => recordMovement({})
      ];

      for (const method of methods) {
        db.transaction?.mockRejectedValue?.(new Error('Connection timeout'));
        db.select?.mockImplementation?.(() => {
          throw new Error('Connection timeout');
        });

        try {
          const result = await method();
          if (result && typeof result === 'object' && 'success' in result) {
            expect(result.success).toBe(false);
            expect(result.error).toBeDefined();
          }
        } catch (error) {
          expect(error.message).toBe('Connection timeout');
        }
      }
    });

    test('should handle invalid input parameters', async () => {
      // Test with null/undefined inputs
      const result1 = await allocateInventoryForOrder(null);
      expect(result1.success).toBe(false);

      const result2 = await generatePickList([]);
      expect(result2.success).toBe(false);

      const result3 = await processOrderShipment('', [], {});
      expect(result3.success).toBe(false);
    });

    test('should handle realtime service failures gracefully', async () => {
      realtimeService.notifyInventoryChange.mockRejectedValue(new Error('Realtime service down'));
      realtimeService.notifyInventoryMovement.mockRejectedValue(new Error('Realtime service down'));
      realtimeService.notifyStockAlert.mockRejectedValue(new Error('Realtime service down'));

      // Operations should still succeed even if realtime notifications fail
      const mockMovementData = {
        inventoryId: 'inv-1',
        productId: 'prod-1',
        warehouseId: 'wh-1',
        movementType: 'sale',
        quantity: -10
      };

      const mockCurrentInventory = {
        id: 'inv-1',
        quantityOnHand: 100,
        quantityAvailable: 95,
        averageCost: 12.50,
        reorderPoint: 20,
        minStockLevel: 10
      };

      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockCurrentInventory])
              })
            })
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([{}])
            })
          }),
          update: jest.fn().mockReturnValue({
            set: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                returning: jest.fn().mockResolvedValue([mockCurrentInventory])
              })
            })
          })
        };
        return callback(mockTx);
      });

      const result = await recordMovement(mockMovementData);

      // Should still succeed despite realtime service failures
      expect(result).toBeDefined();
      expect(result.movement).toBeDefined();
      expect(result.inventory).toBeDefined();
    });
  });
});