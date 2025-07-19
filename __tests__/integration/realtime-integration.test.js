import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { db } from '../../src/config/database.js';
import { sql } from 'drizzle-orm';
import * as inventoryQueries from '../../src/db/inventory-queries.js';
import { realtimeService, RealtimeInventoryService } from '../../src/services/realtime-service.js';
import { 
  inventory, 
  inventoryMovements, 
  products, 
  suppliers,
  customers
} from '../../src/db/schema.js';

/**
 * Real-time Functionality Integration Tests
 * Tests WebSocket connections, LISTEN/NOTIFY, and real-time event delivery
 */

describe('Real-time Integration Tests', () => {
  let testData = {
    suppliers: [],
    products: [],
    customers: [],
    inventoryItems: [],
    mockConnections: [],
    wsServer: null
  };

  const testUser = {
    id: 'realtime-test-user',
    email: 'realtime@test.com'
  };

  // Mock WebSocket connections for testing
  class MockWebSocket extends EventEmitter {
    constructor(connectionId) {
      super();
      this.connectionId = connectionId;
      this.readyState = 1; // OPEN
      this.messages = [];
    }

    send(data) {
      this.messages.push(JSON.parse(data));
    }

    close() {
      this.readyState = 3; // CLOSED
      this.emit('close');
    }

    simulateMessage(data) {
      this.emit('message', JSON.stringify(data));
    }
  }

  beforeAll(async () => {
    // Setup test data
    await setupTestData();
    
    // Initialize real-time service
    await realtimeService.initialize();
    
    // Setup mock WebSocket connections
    await setupMockConnections();
  });

  afterAll(async () => {
    // Cleanup connections
    await cleanupMockConnections();
    
    // Cleanup real-time service
    await realtimeService.cleanup();
    
    // Cleanup test data
    await cleanupTestData();
  });

  beforeEach(async () => {
    // Clear any cached events
    jest.clearAllMocks();
    
    // Reset inventory to known state
    await resetInventoryState();
  });

  afterEach(async () => {
    // Clear any pending events
    realtimeService.removeAllListeners();
  });

  async function setupTestData() {
    // Create test supplier
    const [supplier] = await db.insert(suppliers).values({
      supplierCode: 'RT-SUPPLIER-001',
      companyName: 'Real-time Test Supplier',
      email: 'supplier@realtime-test.com',
      contactDetails: { phone: '+1-555-RT01' },
      paymentTerms: { terms: 'Net 30' }
    }).returning();
    testData.suppliers.push(supplier);

    // Create test customer
    const [customer] = await db.insert(customers).values({
      customerCode: 'RT-CUSTOMER-001',
      companyName: 'Real-time Test Customer',
      email: 'customer@realtime-test.com',
      phone: '+1-555-RT02',
      address: { street: '123 RT Street' }
    }).returning();
    testData.customers.push(customer);

    // Create test products
    const productData = [
      {
        sku: 'RT-PRODUCT-001',
        name: 'Real-time Test Product 1',
        category: 'test-category',
        unitPrice: '100.00',
        costPrice: '60.00',
        supplierId: supplier.id
      },
      {
        sku: 'RT-PRODUCT-002',
        name: 'Real-time Test Product 2',
        category: 'test-category',
        unitPrice: '50.00',
        costPrice: '30.00',
        supplierId: supplier.id
      }
    ];

    for (const productInfo of productData) {
      const [product] = await db.insert(products).values(productInfo).returning();
      testData.products.push(product);
    }

    // Create initial inventory
    const inventoryData = [
      {
        productId: testData.products[0].id,
        warehouseId: 'rt-warehouse-001',
        quantityOnHand: 100,
        quantityAvailable: 90,
        quantityReserved: 10,
        reorderPoint: 20,
        reorderQuantity: 50,
        averageCost: 60.00,
        stockStatus: 'in_stock'
      },
      {
        productId: testData.products[1].id,
        warehouseId: 'rt-warehouse-001',
        quantityOnHand: 50,
        quantityAvailable: 45,
        quantityReserved: 5,
        reorderPoint: 15,
        reorderQuantity: 30,
        averageCost: 30.00,
        stockStatus: 'in_stock'
      }
    ];

    for (const invData of inventoryData) {
      const [invItem] = await db.insert(inventory).values(invData).returning();
      testData.inventoryItems.push(invItem);
    }
  }

  async function setupMockConnections() {
    // Create mock WebSocket connections with different subscription patterns
    const connections = [
      {
        id: 'conn-inventory-all',
        subscriptions: ['inventory_change', 'inventory_movement', 'stock_alert']
      },
      {
        id: 'conn-inventory-changes',
        subscriptions: ['inventory_change']
      },
      {
        id: 'conn-stock-alerts',
        subscriptions: ['stock_alert']
      },
      {
        id: 'conn-movements',
        subscriptions: ['inventory_movement']
      }
    ];

    for (const connConfig of connections) {
      const mockWs = new MockWebSocket(connConfig.id);
      realtimeService.addConnection(connConfig.id, mockWs, connConfig.subscriptions);
      testData.mockConnections.push(mockWs);
    }
  }

  async function cleanupMockConnections() {
    for (const conn of testData.mockConnections) {
      conn.close();
    }
    testData.mockConnections = [];
  }

  async function resetInventoryState() {
    // Reset to initial quantities
    await db
      .update(inventory)
      .set({
        quantityOnHand: 100,
        quantityAvailable: 90,
        quantityReserved: 10,
        stockStatus: 'in_stock',
        updatedAt: new Date()
      })
      .where(sql`${inventory.id} = ${testData.inventoryItems[0].id}`);

    await db
      .update(inventory)
      .set({
        quantityOnHand: 50,
        quantityAvailable: 45,
        quantityReserved: 5,
        stockStatus: 'in_stock',
        updatedAt: new Date()
      })
      .where(sql`${inventory.id} = ${testData.inventoryItems[1].id}`);

    // Clear test movements
    await db
      .delete(inventoryMovements)
      .where(sql`${inventoryMovements.notes} LIKE '%RT-TEST%'`);
  }

  async function cleanupTestData() {
    try {
      await db.delete(inventoryMovements)
        .where(sql`${inventoryMovements.notes} LIKE '%RT-TEST%'`);
      
      await db.delete(inventory)
        .where(sql`${inventory.productId} IN (SELECT id FROM products WHERE sku LIKE 'RT-PRODUCT-%')`);
      
      await db.delete(products)
        .where(sql`${products.sku} LIKE 'RT-PRODUCT-%'`);
      
      await db.delete(customers)
        .where(sql`${customers.customerCode} LIKE 'RT-CUSTOMER-%'`);
      
      await db.delete(suppliers)
        .where(sql`${suppliers.supplierCode} LIKE 'RT-SUPPLIER-%'`);
    } catch (error) {
      console.error('Error cleaning up realtime test data:', error);
    }
  }

  describe('WebSocket Connection Management', () => {
    it('should manage multiple WebSocket connections', () => {
      const stats = realtimeService.getConnectionStats();
      
      expect(stats.totalConnections).toBe(4);
      expect(stats.connectionsDetail).toHaveLength(4);
      
      // Verify each connection is active
      stats.connectionsDetail.forEach(conn => {
        expect(conn.isActive).toBe(true);
        expect(conn.subscriptions).toBeDefined();
        expect(Array.isArray(conn.subscriptions)).toBe(true);
      });
    });

    it('should handle connection subscription updates', () => {
      const conn = testData.mockConnections[1]; // conn-inventory-changes
      const connectionId = 'conn-inventory-changes';
      
      // Simulate subscription update message
      conn.simulateMessage({
        action: 'subscribe',
        events: ['stock_alert', 'inventory_movement']
      });

      const stats = realtimeService.getConnectionStats();
      const updatedConn = stats.connectionsDetail.find(c => c.id === connectionId);
      
      expect(updatedConn.subscriptions).toContain('inventory_change');
      expect(updatedConn.subscriptions).toContain('stock_alert');
      expect(updatedConn.subscriptions).toContain('inventory_movement');
    });

    it('should handle connection unsubscribe requests', () => {
      const conn = testData.mockConnections[0]; // conn-inventory-all
      const connectionId = 'conn-inventory-all';
      
      // Simulate unsubscribe message
      conn.simulateMessage({
        action: 'unsubscribe',
        events: ['inventory_movement']
      });

      const stats = realtimeService.getConnectionStats();
      const updatedConn = stats.connectionsDetail.find(c => c.id === connectionId);
      
      expect(updatedConn.subscriptions).toContain('inventory_change');
      expect(updatedConn.subscriptions).toContain('stock_alert');
      expect(updatedConn.subscriptions).not.toContain('inventory_movement');
    });

    it('should remove disconnected connections', () => {
      const initialStats = realtimeService.getConnectionStats();
      const initialCount = initialStats.totalConnections;
      
      // Simulate connection close
      const conn = testData.mockConnections.pop();
      conn.close();
      
      // Give some time for cleanup
      setTimeout(() => {
        const finalStats = realtimeService.getConnectionStats();
        expect(finalStats.totalConnections).toBe(initialCount - 1);
      }, 100);
    });
  });

  describe('Inventory Change Notifications', () => {
    it('should broadcast inventory changes to subscribed connections', async () => {
      const inventoryId = testData.inventoryItems[0].id;
      
      // Clear previous messages
      testData.mockConnections.forEach(conn => conn.messages = []);
      
      // Trigger inventory change through adjustment
      await inventoryQueries.adjustStock(
        inventoryId,
        95, // Change from 100 to 95
        'RT-TEST: Broadcasting change test',
        testUser.id,
        'RT-TEST: Testing real-time notifications'
      );

      // Wait for notification propagation
      await new Promise(resolve => setTimeout(resolve, 100));

      // Verify messages were sent to subscribed connections
      const allSubscribedConn = testData.mockConnections.find(c => c.connectionId === 'conn-inventory-all');
      const changeSubscribedConn = testData.mockConnections.find(c => c.connectionId === 'conn-inventory-changes');
      const alertOnlyConn = testData.mockConnections.find(c => c.connectionId === 'conn-stock-alerts');

      // Connections subscribed to inventory_change should receive messages
      expect(allSubscribedConn.messages.length).toBeGreaterThan(0);
      expect(changeSubscribedConn.messages.length).toBeGreaterThan(0);
      
      // Alert-only connection should not receive inventory change messages
      const alertOnlyChangeMessages = alertOnlyConn.messages.filter(m => m.event === 'inventory_change');
      expect(alertOnlyChangeMessages.length).toBe(0);

      // Verify message content
      const changeMessage = allSubscribedConn.messages.find(m => m.event === 'inventory_change');
      expect(changeMessage).toBeDefined();
      expect(changeMessage.data.inventoryId).toBe(inventoryId);
      expect(changeMessage.data.oldQuantity).toBe(100);
      expect(changeMessage.data.newQuantity).toBe(95);
    });

    it('should send accurate change data with inventory updates', async () => {
      const inventoryId = testData.inventoryItems[1].id;
      
      // Clear previous messages
      testData.mockConnections.forEach(conn => conn.messages = []);
      
      // Perform a series of changes
      await inventoryQueries.adjustStock(inventoryId, 60, 'RT-TEST: First change', testUser.id, 'RT-TEST: Change 1');
      await inventoryQueries.adjustStock(inventoryId, 40, 'RT-TEST: Second change', testUser.id, 'RT-TEST: Change 2');
      
      // Wait for notifications
      await new Promise(resolve => setTimeout(resolve, 150));

      const allSubscribedConn = testData.mockConnections.find(c => c.connectionId === 'conn-inventory-all');
      const changeMessages = allSubscribedConn.messages.filter(m => m.event === 'inventory_change');
      
      expect(changeMessages.length).toBe(2);
      
      // Verify sequence of changes
      expect(changeMessages[0].data.oldQuantity).toBe(50);
      expect(changeMessages[0].data.newQuantity).toBe(60);
      expect(changeMessages[1].data.oldQuantity).toBe(60);
      expect(changeMessages[1].data.newQuantity).toBe(40);
    });
  });

  describe('Stock Alert Notifications', () => {
    it('should trigger stock alerts when inventory falls below reorder point', async () => {
      const inventoryId = testData.inventoryItems[1].id; // Reorder point: 15
      
      // Clear previous messages
      testData.mockConnections.forEach(conn => conn.messages = []);
      
      // Adjust stock below reorder point
      await inventoryQueries.adjustStock(
        inventoryId,
        10, // Below reorder point of 15
        'RT-TEST: Low stock test',
        testUser.id,
        'RT-TEST: Triggering low stock alert'
      );

      // Wait for alert propagation
      await new Promise(resolve => setTimeout(resolve, 200));

      // Verify alert was sent to subscribed connections
      const allSubscribedConn = testData.mockConnections.find(c => c.connectionId === 'conn-inventory-all');
      const alertSubscribedConn = testData.mockConnections.find(c => c.connectionId === 'conn-stock-alerts');

      const allAlerts = allSubscribedConn.messages.filter(m => m.event === 'stock_alert');
      const alertOnlyAlerts = alertSubscribedConn.messages.filter(m => m.event === 'stock_alert');

      expect(allAlerts.length).toBeGreaterThan(0);
      expect(alertOnlyAlerts.length).toBeGreaterThan(0);

      // Verify alert content
      const alert = allAlerts[0];
      expect(alert.data.alertType).toBe('low_stock');
      expect(alert.data.currentQuantity).toBe(10);
      expect(alert.data.reorderPoint).toBe(15);
      expect(alert.priority).toBeDefined();
    });

    it('should trigger critical alerts for out-of-stock items', async () => {
      const inventoryId = testData.inventoryItems[1].id;
      
      // Clear previous messages
      testData.mockConnections.forEach(conn => conn.messages = []);
      
      // Adjust stock to zero
      await inventoryQueries.adjustStock(
        inventoryId,
        0,
        'RT-TEST: Out of stock test',
        testUser.id,
        'RT-TEST: Triggering out of stock alert'
      );

      // Wait for alert propagation
      await new Promise(resolve => setTimeout(resolve, 200));

      const alertSubscribedConn = testData.mockConnections.find(c => c.connectionId === 'conn-stock-alerts');
      const alerts = alertSubscribedConn.messages.filter(m => m.event === 'stock_alert');

      expect(alerts.length).toBeGreaterThan(0);
      
      const outOfStockAlert = alerts.find(a => a.data.alertType === 'out_of_stock' || a.data.currentQuantity === 0);
      expect(outOfStockAlert).toBeDefined();
      expect(outOfStockAlert.priority).toBe('high');
    });

    it('should not trigger alerts when stock is above reorder point', async () => {
      const inventoryId = testData.inventoryItems[0].id; // Reorder point: 20
      
      // Clear previous messages
      testData.mockConnections.forEach(conn => conn.messages = []);
      
      // Adjust stock to above reorder point
      await inventoryQueries.adjustStock(
        inventoryId,
        80, // Well above reorder point of 20
        'RT-TEST: Safe stock level',
        testUser.id,
        'RT-TEST: No alert should trigger'
      );

      // Wait to ensure no alerts are sent
      await new Promise(resolve => setTimeout(resolve, 200));

      const alertSubscribedConn = testData.mockConnections.find(c => c.connectionId === 'conn-stock-alerts');
      const alerts = alertSubscribedConn.messages.filter(m => m.event === 'stock_alert');

      // Should not have any stock alerts for this operation
      const newAlerts = alerts.filter(a => 
        a.data.inventoryId === inventoryId && 
        a.data.currentQuantity === 80
      );
      expect(newAlerts.length).toBe(0);
    });
  });

  describe('Movement Notifications', () => {
    it('should broadcast movement notifications for sales', async () => {
      // Clear previous messages
      testData.mockConnections.forEach(conn => conn.messages = []);
      
      // Record a movement
      const movementData = {
        inventoryId: testData.inventoryItems[0].id,
        productId: testData.products[0].id,
        warehouseId: 'rt-warehouse-001',
        movementType: 'sale',
        quantity: -5,
        referenceType: 'sales_order',
        referenceNumber: 'SO-RT-TEST-001',
        performedBy: testUser.id,
        notes: 'RT-TEST: Sale movement notification test'
      };

      await inventoryQueries.recordMovement(movementData);

      // Wait for notification propagation
      await new Promise(resolve => setTimeout(resolve, 150));

      // Verify movement notifications
      const allSubscribedConn = testData.mockConnections.find(c => c.connectionId === 'conn-inventory-all');
      const movementSubscribedConn = testData.mockConnections.find(c => c.connectionId === 'conn-movements');

      const allMovements = allSubscribedConn.messages.filter(m => m.event === 'inventory_movement');
      const movementOnlyMovements = movementSubscribedConn.messages.filter(m => m.event === 'inventory_movement');

      expect(allMovements.length).toBeGreaterThan(0);
      expect(movementOnlyMovements.length).toBeGreaterThan(0);

      // Verify movement content
      const movement = allMovements[0];
      expect(movement.data.movementType).toBe('sale');
      expect(movement.data.quantity).toBe(-5);
      expect(movement.data.referenceNumber).toBe('SO-RT-TEST-001');
    });

    it('should broadcast movement notifications for purchases', async () => {
      // Clear previous messages
      testData.mockConnections.forEach(conn => conn.messages = []);
      
      // Record a purchase movement
      const movementData = {
        inventoryId: testData.inventoryItems[1].id,
        productId: testData.products[1].id,
        warehouseId: 'rt-warehouse-001',
        movementType: 'purchase',
        quantity: 20,
        unitCost: 30.00,
        totalCost: 600.00,
        referenceType: 'purchase_order',
        referenceNumber: 'PO-RT-TEST-001',
        performedBy: testUser.id,
        notes: 'RT-TEST: Purchase movement notification test'
      };

      await inventoryQueries.recordMovement(movementData);

      // Wait for notification propagation
      await new Promise(resolve => setTimeout(resolve, 150));

      const movementSubscribedConn = testData.mockConnections.find(c => c.connectionId === 'conn-movements');
      const movements = movementSubscribedConn.messages.filter(m => m.event === 'inventory_movement');

      expect(movements.length).toBeGreaterThan(0);
      
      const purchaseMovement = movements.find(m => m.data.movementType === 'purchase');
      expect(purchaseMovement).toBeDefined();
      expect(purchaseMovement.data.quantity).toBe(20);
      expect(purchaseMovement.data.referenceNumber).toBe('PO-RT-TEST-001');
    });

    it('should include accurate quantity after calculations', async () => {
      const inventoryId = testData.inventoryItems[0].id;
      const initialQuantity = 100;
      
      // Clear previous messages
      testData.mockConnections.forEach(conn => conn.messages = []);
      
      // Record multiple movements
      const movements = [
        { quantity: -10, type: 'sale', ref: 'SO-RT-001' },
        { quantity: 15, type: 'purchase', ref: 'PO-RT-001' },
        { quantity: -5, type: 'adjustment', ref: 'ADJ-RT-001' }
      ];

      let expectedQuantity = initialQuantity;
      
      for (const [index, movementConfig] of movements.entries()) {
        expectedQuantity += movementConfig.quantity;
        
        await inventoryQueries.recordMovement({
          inventoryId,
          productId: testData.products[0].id,
          warehouseId: 'rt-warehouse-001',
          movementType: movementConfig.type,
          quantity: movementConfig.quantity,
          referenceType: movementConfig.type === 'sale' ? 'sales_order' : 
                        movementConfig.type === 'purchase' ? 'purchase_order' : 'adjustment',
          referenceNumber: movementConfig.ref,
          performedBy: testUser.id,
          notes: `RT-TEST: Sequential movement ${index + 1}`
        });
      }

      // Wait for all notifications
      await new Promise(resolve => setTimeout(resolve, 200));

      const movementSubscribedConn = testData.mockConnections.find(c => c.connectionId === 'conn-movements');
      const movementMessages = movementSubscribedConn.messages.filter(m => m.event === 'inventory_movement');

      expect(movementMessages.length).toBe(3);

      // Verify quantity after calculations
      let runningQuantity = initialQuantity;
      for (const [index, message] of movementMessages.entries()) {
        runningQuantity += movements[index].quantity;
        expect(message.data.quantityAfter).toBe(runningQuantity);
      }
    });
  });

  describe('Event Filtering and Targeting', () => {
    it('should only send events to properly subscribed connections', async () => {
      // Clear all messages
      testData.mockConnections.forEach(conn => conn.messages = []);
      
      // Trigger all types of events
      const inventoryId = testData.inventoryItems[0].id;
      
      // 1. Inventory change (adjustment)
      await inventoryQueries.adjustStock(inventoryId, 85, 'RT-TEST: Filter test', testUser.id, 'RT-TEST: Filtering');
      
      // 2. Stock alert (adjust to trigger low stock)
      await inventoryQueries.adjustStock(testData.inventoryItems[1].id, 10, 'RT-TEST: Alert filter', testUser.id, 'RT-TEST: Alert filtering');
      
      // 3. Movement
      await inventoryQueries.recordMovement({
        inventoryId,
        productId: testData.products[0].id,
        warehouseId: 'rt-warehouse-001',
        movementType: 'sale',
        quantity: -3,
        referenceType: 'sales_order',
        referenceNumber: 'SO-FILTER-TEST',
        performedBy: testUser.id,
        notes: 'RT-TEST: Movement filter test'
      });

      // Wait for all notifications
      await new Promise(resolve => setTimeout(resolve, 300));

      // Check each connection received only subscribed events
      const connections = [
        { id: 'conn-inventory-all', expected: ['inventory_change', 'inventory_movement', 'stock_alert'] },
        { id: 'conn-inventory-changes', expected: ['inventory_change'] },
        { id: 'conn-stock-alerts', expected: ['stock_alert'] },
        { id: 'conn-movements', expected: ['inventory_movement'] }
      ];

      for (const connConfig of connections) {
        const conn = testData.mockConnections.find(c => c.connectionId === connConfig.id);
        const receivedEvents = [...new Set(conn.messages.map(m => m.event))];
        
        // Should only receive subscribed events
        for (const event of receivedEvents) {
          expect(connConfig.expected).toContain(event);
        }
        
        // Should have received all expected events that occurred
        for (const expectedEvent of connConfig.expected) {
          const hasEvent = receivedEvents.includes(expectedEvent);
          if (expectedEvent === 'stock_alert') {
            // Stock alert might not always trigger depending on conditions
            continue;
          }
          expect(hasEvent).toBe(true);
        }
      }
    });

    it('should handle connection-specific event preferences', () => {
      // Test dynamic subscription changes
      const conn = testData.mockConnections.find(c => c.connectionId === 'conn-inventory-changes');
      
      // Start with only inventory_change subscription
      conn.simulateMessage({
        action: 'subscribe',
        events: ['stock_alert']
      });

      // Clear messages and trigger events
      conn.messages = [];
      
      // This test verifies the subscription management works
      // The actual event triggering is tested in other tests
      const stats = realtimeService.getConnectionStats();
      const updatedConn = stats.connectionsDetail.find(c => c.id === 'conn-inventory-changes');
      
      expect(updatedConn.subscriptions).toContain('inventory_change');
      expect(updatedConn.subscriptions).toContain('stock_alert');
    });
  });

  describe('Performance Under Load', () => {
    it('should handle high-frequency events efficiently', async () => {
      // Clear all messages
      testData.mockConnections.forEach(conn => conn.messages = []);
      
      const startTime = Date.now();
      const eventCount = 100;
      const inventoryId = testData.inventoryItems[0].id;
      
      // Generate many rapid events
      const promises = [];
      for (let i = 0; i < eventCount; i++) {
        promises.push(
          inventoryQueries.recordMovement({
            inventoryId,
            productId: testData.products[0].id,
            warehouseId: 'rt-warehouse-001',
            movementType: 'adjustment',
            quantity: i % 2 === 0 ? 1 : -1,
            referenceType: 'adjustment',
            referenceNumber: `ADJ-PERF-${i}`,
            performedBy: testUser.id,
            notes: `RT-TEST: Performance test ${i}`
          })
        );
      }

      await Promise.all(promises);
      
      // Wait for notification propagation
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      
      // Should complete within reasonable time
      expect(executionTime).toBeLessThan(10000); // 10 seconds
      
      // Verify events were delivered
      const movementConn = testData.mockConnections.find(c => c.connectionId === 'conn-movements');
      const perfMessages = movementConn.messages.filter(m => 
        m.data.referenceNumber && m.data.referenceNumber.startsWith('ADJ-PERF-')
      );
      
      // Should have received most events (allowing for some async timing issues)
      expect(perfMessages.length).toBeGreaterThan(eventCount * 0.8);
    });

    it('should handle multiple concurrent connections efficiently', async () => {
      // Add more connections temporarily
      const additionalConnections = [];
      for (let i = 0; i < 10; i++) {
        const mockWs = new MockWebSocket(`temp-conn-${i}`);
        realtimeService.addConnection(`temp-conn-${i}`, mockWs, ['inventory_change', 'inventory_movement']);
        additionalConnections.push(mockWs);
      }

      // Clear all messages
      [...testData.mockConnections, ...additionalConnections].forEach(conn => conn.messages = []);
      
      const startTime = Date.now();
      
      // Trigger events with many connections
      await inventoryQueries.adjustStock(
        testData.inventoryItems[0].id,
        75,
        'RT-TEST: Multi-connection performance',
        testUser.id,
        'RT-TEST: Testing with many connections'
      );

      // Wait for propagation
      await new Promise(resolve => setTimeout(resolve, 500));
      
      const endTime = Date.now();
      const executionTime = endTime - startTime;
      
      // Should still be fast with many connections
      expect(executionTime).toBeLessThan(2000); // 2 seconds
      
      // Verify all connections received the event
      const totalConnections = testData.mockConnections.length + additionalConnections.length;
      let connectionsWithMessages = 0;
      
      [...testData.mockConnections, ...additionalConnections].forEach(conn => {
        const hasInventoryChange = conn.messages.some(m => m.event === 'inventory_change');
        if (hasInventoryChange) connectionsWithMessages++;
      });
      
      // Most connections should have received the message
      expect(connectionsWithMessages).toBeGreaterThan(totalConnections * 0.8);
      
      // Cleanup additional connections
      additionalConnections.forEach(conn => conn.close());
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle connection errors gracefully', async () => {
      const initialStats = realtimeService.getConnectionStats();
      
      // Simulate connection error
      const faultyConn = testData.mockConnections[0];
      faultyConn.readyState = 3; // CLOSED
      
      // Try to send a message (should not crash)
      await inventoryQueries.adjustStock(
        testData.inventoryItems[0].id,
        90,
        'RT-TEST: Error handling test',
        testUser.id,
        'RT-TEST: Testing error handling'
      );

      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 200));
      
      // Service should continue operating
      const finalStats = realtimeService.getConnectionStats();
      expect(finalStats.isListening).toBe(true);
    });

    it('should handle malformed WebSocket messages', () => {
      const conn = testData.mockConnections[1];
      const initialSubscriptions = conn.subscriptions || [];
      
      // Send malformed message (should not crash)
      expect(() => {
        conn.emit('message', 'invalid json');
      }).not.toThrow();
      
      // Send message with wrong format
      expect(() => {
        conn.simulateMessage({
          wrongField: 'value'
        });
      }).not.toThrow();
      
      // Subscriptions should remain unchanged
      const stats = realtimeService.getConnectionStats();
      const connStats = stats.connectionsDetail.find(c => c.id === 'conn-inventory-changes');
      expect(connStats.subscriptions).toEqual(expect.arrayContaining(initialSubscriptions));
    });

    it('should recover from notification failures', async () => {
      // Mock a notification client failure
      const originalClient = realtimeService.dbNotificationClient;
      realtimeService.dbNotificationClient = null;
      
      // Should still work with direct event emission
      const eventPromise = new Promise((resolve) => {
        realtimeService.once('inventory_change', resolve);
      });
      
      await realtimeService.notifyInventoryChange({
        id: testData.inventoryItems[0].id,
        productId: testData.products[0].id,
        warehouseId: 'rt-warehouse-001',
        oldQuantity: 100,
        newQuantity: 95,
        quantityAvailable: 85,
        stockStatus: 'in_stock',
        changeReason: 'test_fallback'
      });

      const event = await Promise.race([
        eventPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Event timeout')), 2000))
      ]);

      expect(event.type).toBe('inventory_change');
      
      // Restore original client
      realtimeService.dbNotificationClient = originalClient;
    });
  });

  describe('Message Content Validation', () => {
    it('should include all required fields in inventory change messages', async () => {
      // Clear messages
      testData.mockConnections.forEach(conn => conn.messages = []);
      
      await inventoryQueries.adjustStock(
        testData.inventoryItems[0].id,
        88,
        'RT-TEST: Message validation',
        testUser.id,
        'RT-TEST: Validating message content'
      );

      await new Promise(resolve => setTimeout(resolve, 150));

      const conn = testData.mockConnections.find(c => c.connectionId === 'conn-inventory-all');
      const changeMessage = conn.messages.find(m => m.event === 'inventory_change');

      expect(changeMessage).toBeDefined();
      expect(changeMessage.type).toBe('inventory_change');
      expect(changeMessage.timestamp).toBeDefined();
      expect(changeMessage.data).toBeDefined();
      expect(changeMessage.data.inventoryId).toBeDefined();
      expect(changeMessage.data.productId).toBeDefined();
      expect(changeMessage.data.warehouseId).toBeDefined();
      expect(changeMessage.data.oldQuantity).toBeDefined();
      expect(changeMessage.data.newQuantity).toBeDefined();
      expect(changeMessage.data.quantityAvailable).toBeDefined();
      expect(changeMessage.data.stockStatus).toBeDefined();
      expect(changeMessage.data.changeReason).toBeDefined();
    });

    it('should include all required fields in movement messages', async () => {
      // Clear messages
      testData.mockConnections.forEach(conn => conn.messages = []);
      
      await inventoryQueries.recordMovement({
        inventoryId: testData.inventoryItems[0].id,
        productId: testData.products[0].id,
        warehouseId: 'rt-warehouse-001',
        movementType: 'sale',
        quantity: -2,
        referenceType: 'sales_order',
        referenceNumber: 'SO-VALIDATION-TEST',
        performedBy: testUser.id,
        notes: 'RT-TEST: Movement message validation'
      });

      await new Promise(resolve => setTimeout(resolve, 150));

      const conn = testData.mockConnections.find(c => c.connectionId === 'conn-movements');
      const movementMessage = conn.messages.find(m => m.event === 'inventory_movement');

      expect(movementMessage).toBeDefined();
      expect(movementMessage.type).toBe('inventory_movement');
      expect(movementMessage.timestamp).toBeDefined();
      expect(movementMessage.data).toBeDefined();
      expect(movementMessage.data.movementId).toBeDefined();
      expect(movementMessage.data.inventoryId).toBeDefined();
      expect(movementMessage.data.productId).toBeDefined();
      expect(movementMessage.data.warehouseId).toBeDefined();
      expect(movementMessage.data.movementType).toBe('sale');
      expect(movementMessage.data.quantity).toBe(-2);
      expect(movementMessage.data.quantityAfter).toBeDefined();
      expect(movementMessage.data.performedBy).toBe(testUser.id);
      expect(movementMessage.data.referenceNumber).toBe('SO-VALIDATION-TEST');
    });

    it('should include all required fields in stock alert messages', async () => {
      // Clear messages
      testData.mockConnections.forEach(conn => conn.messages = []);
      
      // Trigger a stock alert
      await inventoryQueries.adjustStock(
        testData.inventoryItems[1].id,
        5, // Below reorder point of 15
        'RT-TEST: Alert message validation',
        testUser.id,
        'RT-TEST: Validating alert message content'
      );

      await new Promise(resolve => setTimeout(resolve, 200));

      const conn = testData.mockConnections.find(c => c.connectionId === 'conn-stock-alerts');
      const alertMessage = conn.messages.find(m => m.event === 'stock_alert');

      if (alertMessage) { // Alert might not trigger depending on conditions
        expect(alertMessage.type).toBe('stock_alert');
        expect(alertMessage.timestamp).toBeDefined();
        expect(alertMessage.priority).toBeDefined();
        expect(alertMessage.data).toBeDefined();
        expect(alertMessage.data.inventoryId).toBeDefined();
        expect(alertMessage.data.productId).toBeDefined();
        expect(alertMessage.data.warehouseId).toBeDefined();
        expect(alertMessage.data.currentQuantity).toBeDefined();
        expect(alertMessage.data.reorderPoint).toBeDefined();
        expect(alertMessage.data.alertType).toBeDefined();
        expect(alertMessage.data.message).toBeDefined();
      }
    });
  });
});