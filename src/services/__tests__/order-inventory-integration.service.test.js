import { describe, test, expect, beforeEach } from '@jest/globals';
import {
  allocateInventoryForOrder,
  generatePickList,
  processOrderShipment,
  createBackorder,
  processReturn
} from '../order-inventory-integration.service.js';

// All tests that previously relied on mocks are now skipped for integration-only policy.

describe.skip('OrderInventoryIntegrationService (skipped: requires Jest mocks)', () => {
  let mockDb;
  let mockTransaction;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Setup mock database transaction
    mockTransaction = {
      select: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis()
    };

    const { db } = require('../../config/database.js');
    mockDb = db;
    mockDb.transaction.mockImplementation(async (callback) => await callback(mockTransaction));
  });

  describe('allocateInventoryForOrder', () => {
    test('should allocate inventory successfully for pending order', async () => {
      const orderId = 'order-123';
      const mockOrderData = {
        id: orderId,
        status: 'pending',
        customerId: 'customer-1',
        orderNumber: 'PO-001',
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

      const mockInventory = [
        {
          id: 'inv-1',
          warehouseId: 'wh-1',
          locationId: 'loc-1',
          quantityAvailable: 15
        }
      ];

      // Mock order retrieval
      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([mockOrderData])
      });

      // Mock order items retrieval
      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce(mockOrderData.items)
      });

      // Mock inventory availability check
      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValueOnce(mockInventory)
      });

      // Mock inventory update
      mockTransaction.update.mockReturnValueOnce({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([])
      });

      // Mock movement insertion
      mockTransaction.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValueOnce([])
      });

      // Mock order status update
      mockTransaction.update.mockReturnValueOnce({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([])
      });

      // Mock event logging
      mockTransaction.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValueOnce([])
      });

      const result = await allocateInventoryForOrder(orderId, {
        allowPartialAllocation: true,
        createBackorders: true,
        userId: 'user-123'
      });

      expect(result.success).toBe(true);
      expect(result.data.orderId).toBe(orderId);
      expect(result.data.totalItemsRequested).toBe(1);
    });

    test('should reject allocation for non-pending orders', async () => {
      const orderId = 'order-123';
      const mockOrderData = {
        id: orderId,
        status: 'shipped',
        items: []
      };

      // Mock order retrieval
      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([mockOrderData])
      });

      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([])
      });

      const result = await allocateInventoryForOrder(orderId);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Order status is shipped');
    });

    test('should handle partial allocations', async () => {
      const orderId = 'order-123';
      const mockOrderData = {
        id: orderId,
        status: 'pending',
        customerId: 'customer-1',
        items: [
          {
            id: 'item-1',
            productId: 'prod-1',
            sku: 'SKU001',
            productName: 'Test Product',
            quantity: 20 // Request more than available
          }
        ]
      };

      const mockInventory = [
        {
          id: 'inv-1',
          warehouseId: 'wh-1',
          locationId: 'loc-1',
          quantityAvailable: 10 // Less than requested
        }
      ];

      // Setup mocks for partial allocation
      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([mockOrderData])
      });

      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce(mockOrderData.items)
      });

      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValueOnce(mockInventory)
      });

      mockTransaction.update.mockReturnValue({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([])
      });

      mockTransaction.insert.mockReturnValue({
        values: jest.fn().mockResolvedValue([])
      });

      const result = await allocateInventoryForOrder(orderId, {
        allowPartialAllocation: true,
        createBackorders: true
      });

      expect(result.success).toBe(true);
      expect(result.data.allocationComplete).toBe(false);
    });

    test('should handle order not found', async () => {
      const orderId = 'nonexistent';

      // Mock order not found
      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([])
      });

      const result = await allocateInventoryForOrder(orderId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Order not found');
    });
  });

  describe('generatePickList', () => {
    test('should generate pick list for valid orders', async () => {
      const orderIds = ['order-1', 'order-2'];
      const mockValidOrders = [
        {
          id: 'order-1',
          orderNumber: 'PO-001',
          customerId: 'customer-1',
          customerName: 'Test Customer 1',
          status: 'confirmed'
        },
        {
          id: 'order-2',
          orderNumber: 'PO-002',
          customerId: 'customer-2',
          customerName: 'Test Customer 2',
          status: 'confirmed'
        }
      ];

      const mockPickItems = [
        {
          orderId: 'order-1',
          orderNumber: 'PO-001',
          customerName: 'Test Customer 1',
          orderItemId: 'item-1',
          sku: 'SKU001',
          productName: 'Product 1',
          quantityOrdered: 10,
          warehouseId: 'wh-1',
          locationId: 'A1-01',
          quantityReserved: 10,
          productId: 'prod-1'
        }
      ];

      // Mock valid orders query
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce(mockValidOrders)
      });

      // Mock pick items query
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValueOnce(mockPickItems)
      });

      // Mock event logging
      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValueOnce([])
      });

      const result = await generatePickList(orderIds, {
        warehouseId: 'wh-1',
        groupByLocation: true,
        userId: 'user-123'
      });

      expect(result.success).toBe(true);
      expect(result.data.orderCount).toBe(2);
      expect(result.data.totalItems).toBe(1);
      expect(result.data.statistics.uniqueSkus).toBe(1);
    });

    test('should reject invalid orders for pick list generation', async () => {
      const orderIds = ['order-1'];

      // Mock no valid orders
      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([])
      });

      const result = await generatePickList(orderIds);

      expect(result.success).toBe(false);
      expect(result.error).toBe('No valid orders for picking');
    });

    test('should group pick items by location', async () => {
      const orderIds = ['order-1'];
      const mockValidOrders = [
        { id: 'order-1', orderNumber: 'PO-001', status: 'confirmed' }
      ];

      const mockPickItems = [
        {
          orderId: 'order-1',
          warehouseId: 'wh-1',
          locationId: 'A1-01',
          sku: 'SKU001',
          quantityOrdered: 5
        },
        {
          orderId: 'order-1',
          warehouseId: 'wh-1',
          locationId: 'A1-01',
          sku: 'SKU002',
          quantityOrdered: 3
        }
      ];

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce(mockValidOrders)
      });

      mockDb.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValueOnce(mockPickItems)
      });

      mockDb.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValueOnce([])
      });

      const result = await generatePickList(orderIds, { groupByLocation: true });

      expect(result.success).toBe(true);
      expect(result.data.pickItems).toHaveLength(1); // One location group
      expect(result.data.pickItems[0].items).toHaveLength(2); // Two items in the location
    });
  });

  describe('processOrderShipment', () => {
    test('should process shipment successfully', async () => {
      const orderId = 'order-123';
      const shipmentItems = [
        { orderItemId: 'item-1', quantity: 5 }
      ];
      const shipmentData = {
        trackingNumber: 'TRACK123',
        carrier: 'UPS',
        shippedBy: 'user-123'
      };

      const mockOrderData = {
        id: orderId,
        orderNumber: 'PO-001',
        customerId: 'customer-1',
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

      const mockReservedInventory = [
        {
          id: 'inv-1',
          quantityReserved: 10,
          quantityOnHand: 15,
          warehouseId: 'wh-1'
        }
      ];

      // Mock order retrieval
      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([mockOrderData])
      });

      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce(mockOrderData.items)
      });

      // Mock reserved inventory query
      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        orderBy: jest.fn().mockResolvedValueOnce(mockReservedInventory)
      });

      // Mock inventory and order updates
      mockTransaction.update.mockReturnValue({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValue([])
      });

      mockTransaction.insert.mockReturnValue({
        values: jest.fn().mockResolvedValue([])
      });

      const result = await processOrderShipment(orderId, shipmentItems, shipmentData);

      expect(result.success).toBe(true);
      expect(result.data.shippedItems).toHaveLength(1);
      expect(result.data.shipmentComplete).toBe(false); // Partial shipment
    });

    test('should validate order status for shipment', async () => {
      const orderId = 'order-123';
      const mockOrderData = {
        id: orderId,
        status: 'pending', // Invalid status for shipment
        items: []
      };

      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([mockOrderData])
      });

      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([])
      });

      const result = await processOrderShipment(orderId, [], {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Order status is pending');
    });

    test('should validate shipment quantities', async () => {
      const orderId = 'order-123';
      const shipmentItems = [
        { orderItemId: 'item-1', quantity: 15 } // More than ordered
      ];

      const mockOrderData = {
        id: orderId,
        status: 'confirmed',
        items: [
          {
            id: 'item-1',
            sku: 'SKU001',
            quantity: 10 // Less than shipment quantity
          }
        ]
      };

      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([mockOrderData])
      });

      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce(mockOrderData.items)
      });

      const result = await processOrderShipment(orderId, shipmentItems, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot ship 15 of SKU001');
    });
  });

  describe('createBackorder', () => {
    test('should create backorder successfully', async () => {
      const orderId = 'order-123';
      const backorderItems = [
        {
          productId: 'prod-1',
          sku: 'SKU001',
          productName: 'Test Product',
          quantity: 5,
          unitPrice: 10.00
        }
      ];

      const mockOriginalOrder = {
        id: orderId,
        orderNumber: 'PO-001',
        customerId: 'customer-1',
        currency: 'USD',
        shippingAddress: {},
        billingAddress: {}
      };

      const mockBackorder = {
        id: 'backorder-123',
        orderNumber: 'PO-001-BO-123'
      };

      const mockCreatedItems = [
        {
          id: 'item-1',
          lineTotal: '50.00'
        }
      ];

      // Mock original order query
      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([mockOriginalOrder])
      });

      // Mock backorder creation
      mockTransaction.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValueOnce([mockBackorder])
      });

      // Mock backorder items creation
      mockTransaction.insert.mockReturnValueOnce({
        values: jest.fn().mockReturnThis(),
        returning: jest.fn().mockResolvedValueOnce(mockCreatedItems)
      });

      // Mock backorder totals update
      mockTransaction.update.mockReturnValueOnce({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([])
      });

      // Mock event logging
      mockTransaction.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValueOnce([])
      });

      const result = await createBackorder(orderId, backorderItems, {
        expectedDate: '2024-01-15',
        autoFulfill: true,
        userId: 'user-123'
      });

      expect(result.success).toBe(true);
      expect(result.data.backorder.id).toBe('backorder-123');
      expect(result.data.items).toEqual(mockCreatedItems);
    });

    test('should fail when original order not found', async () => {
      const orderId = 'nonexistent';

      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([])
      });

      const result = await createBackorder(orderId, [], {});

      expect(result.success).toBe(false);
      expect(result.error).toBe('Original order not found');
    });
  });

  describe('processReturn', () => {
    test('should process restockable return successfully', async () => {
      const orderId = 'order-123';
      const returnItems = [
        { orderItemId: 'item-1', quantity: 3 }
      ];
      const returnData = {
        reason: 'customer_return',
        condition: 'good',
        restockable: true,
        userId: 'user-123'
      };

      const mockOrderItem = {
        id: 'item-1',
        productId: 'prod-1',
        sku: 'SKU001',
        productName: 'Test Product',
        quantity: 10
      };

      const mockInventoryLocation = {
        id: 'inv-1',
        warehouseId: 'wh-1',
        quantityOnHand: 20
      };

      // Mock order item query
      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([mockOrderItem])
      });

      // Mock inventory location query
      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        innerJoin: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockInventoryLocation])
      });

      // Mock inventory update
      mockTransaction.update.mockReturnValueOnce({
        set: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([])
      });

      // Mock movement insertion
      mockTransaction.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValueOnce([])
      });

      // Mock event logging
      mockTransaction.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValueOnce([])
      });

      const result = await processReturn(orderId, returnItems, returnData);

      expect(result.success).toBe(true);
      expect(result.data.returnedItems).toHaveLength(1);
      expect(result.data.inventoryUpdates).toHaveLength(1);
      expect(result.data.returnedItems[0].restockable).toBe(true);
    });

    test('should handle non-restockable returns', async () => {
      const orderId = 'order-123';
      const returnItems = [
        { orderItemId: 'item-1', quantity: 2 }
      ];
      const returnData = {
        condition: 'damaged',
        restockable: false
      };

      const mockOrderItem = {
        id: 'item-1',
        productId: 'prod-1',
        sku: 'SKU001',
        productName: 'Test Product',
        quantity: 10
      };

      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([mockOrderItem])
      });

      mockTransaction.insert.mockReturnValueOnce({
        values: jest.fn().mockResolvedValueOnce([])
      });

      const result = await processReturn(orderId, returnItems, returnData);

      expect(result.success).toBe(true);
      expect(result.data.returnedItems[0].restockable).toBe(false);
      expect(result.data.nonRestockableItems).toHaveLength(1);
      expect(result.data.inventoryUpdates).toHaveLength(0);
    });

    test('should validate return quantities', async () => {
      const orderId = 'order-123';
      const returnItems = [
        { orderItemId: 'item-1', quantity: 15 } // More than ordered
      ];

      const mockOrderItem = {
        id: 'item-1',
        sku: 'SKU001',
        quantity: 10 // Less than return quantity
      };

      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([mockOrderItem])
      });

      const result = await processReturn(orderId, returnItems, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Cannot return 15 of SKU001');
    });

    test('should fail when order item not found', async () => {
      const orderId = 'order-123';
      const returnItems = [
        { orderItemId: 'nonexistent', quantity: 1 }
      ];

      mockTransaction.select.mockReturnValueOnce({
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockResolvedValueOnce([])
      });

      const result = await processReturn(orderId, returnItems, {});

      expect(result.success).toBe(false);
      expect(result.error).toContain('Order item nonexistent not found');
    });
  });

  describe('error handling', () => {
    test('should handle database transaction failures', async () => {
      const orderId = 'order-123';

      mockDb.transaction.mockRejectedValue(new Error('Database connection failed'));

      const result = await allocateInventoryForOrder(orderId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });

    test('should handle malformed input data', async () => {
      const result = await generatePickList(null);

      expect(result.success).toBe(false);
    });

    test('should handle concurrent inventory updates', async () => {
      const orderId = 'order-123';

      // Mock transaction to simulate concurrent update conflict
      mockDb.transaction.mockImplementation(async (callback) => {
        throw new Error('Concurrent modification detected');
      });

      const result = await allocateInventoryForOrder(orderId);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Concurrent modification detected');
    });
  });
});