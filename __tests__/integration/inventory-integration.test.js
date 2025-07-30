import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { db } from '../../src/config/database.js';
import { sql } from 'drizzle-orm';
import * as inventoryQueries from '../../src/db/inventory-queries.js';
import * as supplierQueries from '../../src/db/supplier-queries.js';
import * as customerQueries from '../../src/db/customer-queries.js';
import { realtimeService } from '../../src/services/realtime-service.js';
import { 
  inventory, 
  inventoryMovements, 
  products, 
  suppliers, 
  customers 
} from '../../src/db/schema.js';

/**
 * Integration Tests for Inventory System
 * Tests the complete workflow from API to database with real data
 */

describe('Inventory System Integration Tests', () => {
  let testData = {
    suppliers: [],
    products: [],
    customers: [],
    inventoryItems: [],
    warehouses: []
  };

  // Test user context
  const testUser = {
    id: 'test-user-001',
    email: 'test@example.com'
  };

  beforeAll(async () => {
    // Initialize real-time service for testing
    await realtimeService.initialize();
    
    // Clean up any existing test data
    await cleanupTestData();
    
    // Setup test data
    await setupTestData();
  });

  afterAll(async () => {
    // Cleanup test data
    await cleanupTestData();
    
    // Cleanup real-time service
    await realtimeService.cleanup();
  });

  beforeEach(async () => {
    // Reset any mutable test state
    await resetInventoryToInitialState();
  });

  /**
   * Setup comprehensive test data for integration tests
   */
  async function setupTestData() {
    // Create test suppliers
    testData.suppliers = await Promise.all([
      supplierQueries.createSupplier({
        supplierCode: 'SUPPLIER-001',
        companyName: 'Tech Components Ltd',
        email: 'orders@techcomponents.com',
        contactDetails: {
          phone: '+1-555-0101',
          address: '123 Tech Street, Silicon Valley, CA'
        },
        paymentTerms: {
          terms: 'Net 30',
          currency: 'USD'
        }
      }),
      supplierQueries.createSupplier({
        supplierCode: 'SUPPLIER-002',
        companyName: 'Global Electronics Corp',
        email: 'sales@globalelectronics.com',
        contactDetails: {
          phone: '+1-555-0102',
          address: '456 Electronics Ave, Austin, TX'
        },
        paymentTerms: {
          terms: 'Net 15',
          currency: 'USD'
        }
      })
    ]);

    // Create test customers
    testData.customers = await Promise.all([
      customerQueries.createCustomer({
        customerCode: 'CUSTOMER-001',
        companyName: 'Retail Solutions Inc',
        email: 'purchasing@retailsolutions.com',
        phone: '+1-555-0201',
        address: {
          street: '789 Retail Blvd',
          city: 'Commerce City',
          state: 'TX',
          zipCode: '12345'
        },
        metadata: {
          creditLimit: 50000,
          preferredPaymentMethod: 'credit'
        }
      }),
      customerQueries.createCustomer({
        customerCode: 'CUSTOMER-002',
        companyName: 'Enterprise Systems LLC',
        email: 'orders@enterprisesystems.com',
        phone: '+1-555-0202',
        address: {
          street: '321 Business Park Dr',
          city: 'Corporate Center',
          state: 'CA',
          zipCode: '67890'
        },
        metadata: {
          creditLimit: 100000,
          preferredPaymentMethod: 'wire'
        }
      })
    ]);

    // Create test products
    const productData = [
      {
        sku: 'LAPTOP-001',
        name: 'Business Laptop Pro',
        description: 'High-performance laptop for business use',
        category: 'electronics',
        unitPrice: '999.99',
        costPrice: '750.00',
        supplierId: testData.suppliers[0].id
      },
      {
        sku: 'MOUSE-001',
        name: 'Wireless Optical Mouse',
        description: 'Ergonomic wireless mouse',
        category: 'electronics',
        unitPrice: '29.99',
        costPrice: '15.00',
        supplierId: testData.suppliers[0].id
      },
      {
        sku: 'MONITOR-001',
        name: '24" LED Monitor',
        description: '24-inch LED display monitor',
        category: 'electronics',
        unitPrice: '199.99',
        costPrice: '120.00',
        supplierId: testData.suppliers[1].id
      },
      {
        sku: 'KEYBOARD-001',
        name: 'Mechanical Keyboard',
        description: 'RGB mechanical gaming keyboard',
        category: 'electronics',
        unitPrice: '79.99',
        costPrice: '45.00',
        supplierId: testData.suppliers[1].id
      }
    ];

    testData.products = [];
    for (const productInfo of productData) {
      const [product] = await db.insert(products).values(productInfo).returning();
      testData.products.push(product);
    }

    // Define test warehouses
    testData.warehouses = [
      { id: 'warehouse-001', name: 'Main Warehouse' },
      { id: 'warehouse-002', name: 'Secondary Warehouse' }
    ];

    // Create initial inventory records
    const initialInventoryData = [
      {
        productId: testData.products[0].id, // Laptop
        warehouseId: 'warehouse-001',
        quantityOnHand: 50,
        quantityAvailable: 45,
        quantityReserved: 5,
        reorderPoint: 10,
        reorderQuantity: 20,
        averageCost: 750.00,
        stockStatus: 'in_stock'
      },
      {
        productId: testData.products[1].id, // Mouse
        warehouseId: 'warehouse-001',
        quantityOnHand: 200,
        quantityAvailable: 190,
        quantityReserved: 10,
        reorderPoint: 50,
        reorderQuantity: 100,
        averageCost: 15.00,
        stockStatus: 'in_stock'
      },
      {
        productId: testData.products[2].id, // Monitor
        warehouseId: 'warehouse-002',
        quantityOnHand: 25,
        quantityAvailable: 20,
        quantityReserved: 5,
        reorderPoint: 15,
        reorderQuantity: 30,
        averageCost: 120.00,
        stockStatus: 'in_stock'
      },
      {
        productId: testData.products[3].id, // Keyboard
        warehouseId: 'warehouse-002',
        quantityOnHand: 75,
        quantityAvailable: 70,
        quantityReserved: 5,
        reorderPoint: 20,
        reorderQuantity: 50,
        averageCost: 45.00,
        stockStatus: 'in_stock'
      }
    ];

    testData.inventoryItems = [];
    for (const invData of initialInventoryData) {
      const [invItem] = await db.insert(inventory).values(invData).returning();
      testData.inventoryItems.push(invItem);
    }
  }

  /**
   * Reset inventory to initial state for each test
   */
  async function resetInventoryToInitialState() {
    // Update inventory to initial quantities
    const initialStates = [
      { id: testData.inventoryItems[0].id, quantityOnHand: 50, quantityAvailable: 45, quantityReserved: 5 },
      { id: testData.inventoryItems[1].id, quantityOnHand: 200, quantityAvailable: 190, quantityReserved: 10 },
      { id: testData.inventoryItems[2].id, quantityOnHand: 25, quantityAvailable: 20, quantityReserved: 5 },
      { id: testData.inventoryItems[3].id, quantityOnHand: 75, quantityAvailable: 70, quantityReserved: 5 }
    ];

    for (const state of initialStates) {
      await db
        .update(inventory)
        .set({
          quantityOnHand: state.quantityOnHand,
          quantityAvailable: state.quantityAvailable,
          quantityReserved: state.quantityReserved,
          stockStatus: 'in_stock',
          updatedAt: new Date()
        })
        .where(sql`${inventory.id} = ${state.id}`);
    }

    // Clear movement history for clean tests
    await db
      .delete(inventoryMovements)
      .where(sql`${inventoryMovements.notes} LIKE '%TEST%'`);
  }

  /**
   * Cleanup all test data
   */
  async function cleanupTestData() {
    try {
      // Clean up in reverse dependency order
      await db.delete(inventoryMovements)
        .where(sql`${inventoryMovements.notes} LIKE '%TEST%' OR ${inventoryMovements.performedBy} = ${testUser.id}`);
      
      await db.delete(inventory)
        .where(sql`${inventory.productId} IN (SELECT id FROM products WHERE sku LIKE 'LAPTOP-%' OR sku LIKE 'MOUSE-%' OR sku LIKE 'MONITOR-%' OR sku LIKE 'KEYBOARD-%')`);
      
      await db.delete(products)
        .where(sql`${products.sku} LIKE 'LAPTOP-%' OR ${products.sku} LIKE 'MOUSE-%' OR ${products.sku} LIKE 'MONITOR-%' OR ${products.sku} LIKE 'KEYBOARD-%'`);
      
      await db.delete(customers)
        .where(sql`${customers.customerCode} LIKE 'CUSTOMER-%'`);
      
      await db.delete(suppliers)
        .where(sql`${suppliers.supplierCode} LIKE 'SUPPLIER-%'`);
    } catch (error) {
      console.error('Error cleaning up test data:', error);
    }
  }

  describe('Complete Workflow: Receive Goods', () => {
    it('should process complete goods receipt workflow end-to-end', async () => {
      const supplierId = testData.suppliers[0].id;
      const productId = testData.products[0].id; // Laptop
      const warehouseId = 'warehouse-001';
      
      // Get initial inventory state
      const initialInventory = await inventoryQueries.getInventoryById(testData.inventoryItems[0].id);
      expect(initialInventory).toBeTruthy();
      expect(initialInventory.quantityOnHand).toBe(50);

      // Process goods receipt
      const receiptData = {
        supplierId,
        referenceNumber: 'PO-TEST-001',
        items: [
          {
            productId,
            warehouseId,
            quantity: 30,
            unitCost: 740.00
          }
        ],
        performedBy: testUser.id,
        notes: 'TEST: Goods receipt integration test'
      };

      const movements = await supplierQueries.updateInventoryOnPurchaseReceipt(receiptData);

      // Verify movements were created
      expect(movements).toHaveLength(1);
      expect(movements[0].movementType).toBe('purchase');
      expect(movements[0].quantity).toBe(30);
      expect(movements[0].unitCost).toBe(740.00);
      expect(movements[0].referenceNumber).toBe('PO-TEST-001');

      // Verify inventory was updated
      const updatedInventory = await inventoryQueries.getInventoryById(testData.inventoryItems[0].id);
      expect(updatedInventory.quantityOnHand).toBe(80); // 50 + 30
      expect(updatedInventory.quantityAvailable).toBe(75); // 45 + 30
      expect(updatedInventory.quantityReserved).toBe(5); // Unchanged
      expect(updatedInventory.lastPurchaseCost).toBe(740.00);

      // Verify average cost calculation
      const expectedAverageCost = ((750.00 * 50) + (740.00 * 30)) / 80;
      expect(Math.abs(updatedInventory.averageCost - expectedAverageCost)).toBeLessThan(0.01);

      // Verify movement history
      const movementHistory = await inventoryQueries.getMovements({
        inventoryId: testData.inventoryItems[0].id,
        movementType: 'purchase'
      });
      expect(movementHistory.data).toHaveLength(1);
      expect(movementHistory.data[0].quantityAfter).toBe(80);
    });

    it('should handle multiple items in single receipt', async () => {
      const supplierId = testData.suppliers[0].id;
      
      const receiptData = {
        supplierId,
        referenceNumber: 'PO-TEST-002',
        items: [
          {
            productId: testData.products[0].id, // Laptop
            warehouseId: 'warehouse-001',
            quantity: 10,
            unitCost: 745.00
          },
          {
            productId: testData.products[1].id, // Mouse
            warehouseId: 'warehouse-001',
            quantity: 50,
            unitCost: 14.50
          }
        ],
        performedBy: testUser.id,
        notes: 'TEST: Multi-item receipt'
      };

      const movements = await supplierQueries.updateInventoryOnPurchaseReceipt(receiptData);

      // Verify two movements were created
      expect(movements).toHaveLength(2);
      
      // Verify laptop inventory
      const laptopInventory = await inventoryQueries.getInventoryById(testData.inventoryItems[0].id);
      expect(laptopInventory.quantityOnHand).toBe(60); // 50 + 10
      
      // Verify mouse inventory
      const mouseInventory = await inventoryQueries.getInventoryById(testData.inventoryItems[1].id);
      expect(mouseInventory.quantityOnHand).toBe(250); // 200 + 50
    });

    it('should handle receipt for new product (create inventory record)', async () => {
      // Create a new product without existing inventory
      const [newProduct] = await db.insert(products).values({
        sku: 'WEBCAM-001',
        name: 'HD Webcam',
        description: 'High-definition webcam',
        category: 'electronics',
        unitPrice: '89.99',
        costPrice: '55.00',
        supplierId: testData.suppliers[0].id
      }).returning();

      const receiptData = {
        supplierId: testData.suppliers[0].id,
        referenceNumber: 'PO-TEST-003',
        items: [
          {
            productId: newProduct.id,
            warehouseId: 'warehouse-001',
            quantity: 25,
            unitCost: 55.00
          }
        ],
        performedBy: testUser.id,
        notes: 'TEST: New product receipt'
      };

      const movements = await supplierQueries.updateInventoryOnPurchaseReceipt(receiptData);

      // Verify movement was created
      expect(movements).toHaveLength(1);
      expect(movements[0].quantity).toBe(25);

      // Verify new inventory record was created
      const newInventory = await db
        .select()
        .from(inventory)
        .where(sql`${inventory.productId} = ${newProduct.id}`)
        .limit(1);

      expect(newInventory).toHaveLength(1);
      expect(newInventory[0].quantityOnHand).toBe(25);
      expect(newInventory[0].quantityAvailable).toBe(25);
      expect(newInventory[0].averageCost).toBe(55.00);

      // Cleanup
      await db.delete(inventory).where(sql`${inventory.productId} = ${newProduct.id}`);
      await db.delete(products).where(sql`${products.id} = ${newProduct.id}`);
    });
  });

  describe('Complete Workflow: Sell Items', () => {
    it('should process complete sales workflow end-to-end', async () => {
      const customerId = testData.customers[0].id;
      const productId = testData.products[1].id; // Mouse
      const warehouseId = 'warehouse-001';
      
      // Get initial inventory and customer state
      const initialInventory = await inventoryQueries.getInventoryById(testData.inventoryItems[1].id);
      const initialCustomer = await customerQueries.getCustomerById(customerId);
      
      expect(initialInventory.quantityAvailable).toBe(190);
      expect(initialCustomer).toBeTruthy();

      // Process sale
      const saleData = {
        customerId,
        items: [
          {
            productId,
            warehouseId,
            quantity: 15,
            unitPrice: 29.99
          }
        ],
        referenceNumber: 'SO-TEST-001',
        performedBy: testUser.id,
        notes: 'TEST: Sales integration test'
      };

      const saleResult = await customerQueries.processSale(saleData);

      // Verify sale result
      expect(saleResult.movements).toHaveLength(1);
      expect(saleResult.totalSaleValue).toBe(449.85); // 15 * 29.99
      expect(saleResult.saleRecord.amount).toBe(449.85);

      // Verify inventory was updated
      const updatedInventory = await inventoryQueries.getInventoryById(testData.inventoryItems[1].id);
      expect(updatedInventory.quantityOnHand).toBe(185); // 200 - 15
      expect(updatedInventory.quantityAvailable).toBe(175); // 190 - 15
      expect(updatedInventory.quantityReserved).toBe(10); // Unchanged

      // Verify movement was recorded
      const movement = saleResult.movements[0];
      expect(movement.movementType).toBe('sale');
      expect(movement.quantity).toBe(-15); // Negative for outbound
      expect(movement.referenceNumber).toBe('SO-TEST-001');
      expect(movement.quantityAfter).toBe(185);

      // Verify customer purchase history was updated
      const updatedCustomer = await customerQueries.getCustomerById(customerId);
      expect(updatedCustomer.purchaseHistory.orders).toHaveLength(1);
      expect(updatedCustomer.purchaseHistory.totalLifetimeValue).toBe(449.85);
    });

    it('should prevent overselling (insufficient stock)', async () => {
      const customerId = testData.customers[0].id;
      const productId = testData.products[2].id; // Monitor (only 20 available)
      const warehouseId = 'warehouse-002';
      
      const saleData = {
        customerId,
        items: [
          {
            productId,
            warehouseId,
            quantity: 25, // More than available (20)
            unitPrice: 199.99
          }
        ],
        referenceNumber: 'SO-TEST-002',
        performedBy: testUser.id,
        notes: 'TEST: Overselling test'
      };

      // Should throw error for insufficient stock
      await expect(customerQueries.processSale(saleData)).rejects.toThrow('Insufficient available stock');

      // Verify inventory unchanged
      const inventory = await inventoryQueries.getInventoryById(testData.inventoryItems[2].id);
      expect(inventory.quantityAvailable).toBe(20); // Should remain unchanged
    });

    it('should handle multi-item sales correctly', async () => {
      const customerId = testData.customers[1].id;
      
      const saleData = {
        customerId,
        items: [
          {
            productId: testData.products[1].id, // Mouse
            warehouseId: 'warehouse-001',
            quantity: 5,
            unitPrice: 29.99
          },
          {
            productId: testData.products[3].id, // Keyboard
            warehouseId: 'warehouse-002',
            quantity: 3,
            unitPrice: 79.99
          }
        ],
        referenceNumber: 'SO-TEST-003',
        performedBy: testUser.id,
        notes: 'TEST: Multi-item sale'
      };

      const saleResult = await customerQueries.processSale(saleData);

      // Verify sale result
      expect(saleResult.movements).toHaveLength(2);
      expect(saleResult.totalSaleValue).toBe(389.92); // (5 * 29.99) + (3 * 79.99)

      // Verify mouse inventory
      const mouseInventory = await inventoryQueries.getInventoryById(testData.inventoryItems[1].id);
      expect(mouseInventory.quantityOnHand).toBe(195); // 200 - 5

      // Verify keyboard inventory
      const keyboardInventory = await inventoryQueries.getInventoryById(testData.inventoryItems[3].id);
      expect(keyboardInventory.quantityOnHand).toBe(72); // 75 - 3
    });
  });

  describe('Complete Workflow: Stock Adjustments', () => {
    it('should process stock adjustment workflow correctly', async () => {
      const inventoryId = testData.inventoryItems[0].id; // Laptop
      const initialQuantity = 50;
      const adjustedQuantity = 47; // Found 3 damaged units
      
      // Perform stock adjustment
      const adjustmentResult = await inventoryQueries.adjustStock(
        inventoryId,
        adjustedQuantity,
        'Physical count - damaged units found',
        testUser.id,
        'TEST: Found 3 damaged laptop units during physical count'
      );

      // Verify adjustment result
      expect(adjustmentResult.quantityOnHand).toBe(47);
      expect(adjustmentResult.quantityAvailable).toBe(42); // 47 - 5 reserved

      // Verify movement was recorded
      const movements = await inventoryQueries.getMovements({
        inventoryId,
        movementType: 'adjustment'
      });
      expect(movements.data).toHaveLength(1);
      expect(movements.data[0].quantity).toBe(-3); // Negative adjustment
      expect(movements.data[0].quantityAfter).toBe(47);
    });

    it('should handle positive adjustments (found inventory)', async () => {
      const inventoryId = testData.inventoryItems[1].id; // Mouse
      const initialQuantity = 200;
      const adjustedQuantity = 205; // Found 5 extra units
      
      const adjustmentResult = await inventoryQueries.adjustStock(
        inventoryId,
        adjustedQuantity,
        'Physical count - found additional inventory',
        testUser.id,
        'TEST: Found 5 additional mouse units'
      );

      expect(adjustmentResult.quantityOnHand).toBe(205);
      expect(adjustmentResult.quantityAvailable).toBe(195); // 205 - 10 reserved
    });

    it('should trigger low stock alerts after adjustment', async () => {
      const inventoryId = testData.inventoryItems[2].id; // Monitor (reorder point: 15)
      const adjustedQuantity = 10; // Below reorder point
      
      // Set up real-time event listener
      const alertPromise = new Promise((resolve) => {
        realtimeService.once('stock_alert', resolve);
      });

      // Perform adjustment that should trigger alert
      await inventoryQueries.adjustStock(
        inventoryId,
        adjustedQuantity,
        'Physical count - low stock detected',
        testUser.id,
        'TEST: Adjustment below reorder point'
      );

      // Verify stock status updated
      const updatedInventory = await inventoryQueries.getInventoryById(inventoryId);
      expect(updatedInventory.stockStatus).toBe('low_stock');

      // Wait for and verify alert was triggered
      const alert = await Promise.race([
        alertPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Alert timeout')), 5000))
      ]);

      expect(alert.type).toBe('stock_alert');
      expect(alert.data.alertType).toBe('low_stock');
      expect(alert.data.currentQuantity).toBe(10);
    });
  });

  describe('Real-time Notifications Integration', () => {
    it('should emit inventory change notifications', async () => {
      const inventoryId = testData.inventoryItems[0].id;
      
      // Set up event listener
      const changePromise = new Promise((resolve) => {
        realtimeService.once('inventory_change', resolve);
      });

      // Trigger inventory change
      await inventoryQueries.adjustStock(
        inventoryId,
        55,
        'TEST adjustment',
        testUser.id,
        'TEST: Real-time notification test'
      );

      // Verify notification was emitted
      const changeEvent = await Promise.race([
        changePromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Notification timeout')), 5000))
      ]);

      expect(changeEvent.type).toBe('inventory_change');
      expect(changeEvent.data.inventoryId).toBe(inventoryId);
      expect(changeEvent.data.newQuantity).toBe(55);
    });

    it('should emit movement notifications for sales', async () => {
      // Set up event listener
      const movementPromise = new Promise((resolve) => {
        realtimeService.once('inventory_movement', resolve);
      });

      // Process a sale
      const saleData = {
        customerId: testData.customers[0].id,
        items: [{
          productId: testData.products[1].id,
          warehouseId: 'warehouse-001',
          quantity: 1,
          unitPrice: 29.99
        }],
        referenceNumber: 'SO-RT-TEST-001',
        performedBy: testUser.id,
        notes: 'TEST: Real-time movement test'
      };

      await customerQueries.processSale(saleData);

      // Verify movement notification
      const movementEvent = await Promise.race([
        movementPromise,
        new Promise((_, reject) => setTimeout(() => reject(new Error('Movement notification timeout')), 5000))
      ]);

      expect(movementEvent.type).toBe('inventory_movement');
      expect(movementEvent.data.movementType).toBe('sale');
      expect(movementEvent.data.quantity).toBe(-1);
    });
  });

  describe('Concurrent Operations & Conflict Resolution', () => {
    it('should handle concurrent stock operations safely', async () => {
      const inventoryId = testData.inventoryItems[1].id; // Mouse
      const initialQuantity = 200;
      
      // Simulate concurrent operations
      const operations = [
        () => inventoryQueries.adjustStock(inventoryId, 195, 'Concurrent test 1', testUser.id, 'TEST: Concurrent 1'),
        () => inventoryQueries.adjustStock(inventoryId, 190, 'Concurrent test 2', testUser.id, 'TEST: Concurrent 2'),
        () => inventoryQueries.adjustStock(inventoryId, 185, 'Concurrent test 3', testUser.id, 'TEST: Concurrent 3')
      ];

      // Execute operations concurrently
      const results = await Promise.allSettled(operations.map(op => op()));

      // At least one should succeed
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(0);

      // Final inventory should be consistent
      const finalInventory = await inventoryQueries.getInventoryById(inventoryId);
      expect([195, 190, 185]).toContain(finalInventory.quantityOnHand);
    });

    it('should prevent double-spending in concurrent sales', async () => {
      const productId = testData.products[2].id; // Monitor (only 20 available)
      const warehouseId = 'warehouse-002';
      const customerId = testData.customers[0].id;
      
      // Create concurrent sales that would exceed available stock
      const sales = [
        {
          customerId,
          items: [{ productId, warehouseId, quantity: 12, unitPrice: 199.99 }],
          referenceNumber: 'SO-CONCURRENT-001',
          performedBy: testUser.id,
          notes: 'TEST: Concurrent sale 1'
        },
        {
          customerId,
          items: [{ productId, warehouseId, quantity: 12, unitPrice: 199.99 }],
          referenceNumber: 'SO-CONCURRENT-002',
          performedBy: testUser.id,
          notes: 'TEST: Concurrent sale 2'
        }
      ];

      // Execute concurrent sales
      const results = await Promise.allSettled(
        sales.map(sale => customerQueries.processSale(sale))
      );

      // Only one should succeed (total would be 24, but only 20 available)
      const successful = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');
      
      expect(successful.length).toBe(1);
      expect(failed.length).toBe(1);
      expect(failed[0].reason.message).toContain('Insufficient available stock');
    });
  });

  describe('Analytics Integration', () => {
    it('should provide accurate analytics after operations', async () => {
      // Perform several operations to generate data
      await supplierQueries.updateInventoryOnPurchaseReceipt({
        supplierId: testData.suppliers[0].id,
        referenceNumber: 'PO-ANALYTICS-001',
        items: [{
          productId: testData.products[0].id,
          warehouseId: 'warehouse-001',
          quantity: 20,
          unitCost: 750.00
        }],
        performedBy: testUser.id,
        notes: 'TEST: Analytics test purchase'
      });

      await customerQueries.processSale({
        customerId: testData.customers[0].id,
        items: [{
          productId: testData.products[0].id,
          warehouseId: 'warehouse-001',
          quantity: 5,
          unitPrice: 999.99
        }],
        referenceNumber: 'SO-ANALYTICS-001',
        performedBy: testUser.id,
        notes: 'TEST: Analytics test sale'
      });

      // Get analytics data
      const analytics = await inventoryQueries.getInventoryAnalytics({
        warehouseId: 'warehouse-001'
      });

      // Verify analytics accuracy
      expect(analytics.summary).toBeDefined();
      expect(parseInt(analytics.summary.totalItems)).toBeGreaterThan(0);
      expect(parseFloat(analytics.summary.totalValue)).toBeGreaterThan(0);

      // Verify movement analytics
      const movements = await inventoryQueries.getMovements({
        productId: testData.products[0].id,
        limit: 10
      });
      
      expect(movements.data.length).toBeGreaterThan(0);
      
      // Find our test movements
      const testMovements = movements.data.filter(m => 
        m.referenceNumber === 'PO-ANALYTICS-001' || 
        m.referenceNumber === 'SO-ANALYTICS-001'
      );
      expect(testMovements.length).toBe(2);
    });

    it('should calculate turnover ratios correctly', async () => {
      // Get initial turnover data
      const turnoverAnalysis = await inventoryQueries.getAdvancedInventoryAnalytics({
        analysisType: 'turnover',
        productId: testData.products[1].id // Mouse
      });

      expect(turnoverAnalysis.turnoverAnalysis).toBeDefined();
      expect(Array.isArray(turnoverAnalysis.turnoverAnalysis)).toBe(true);
    });
  });

  describe('Performance Testing', () => {
    it('should handle large batch operations efficiently', async () => {
      const batchSize = 100;
      const startTime = Date.now();
      
      // Create batch receipt data
      const batchItems = Array.from({ length: batchSize }, (_, i) => ({
        productId: testData.products[1].id, // Mouse
        warehouseId: 'warehouse-001',
        quantity: 1,
        unitCost: 15.00
      }));

      // Process large batch
      const receiptData = {
        supplierId: testData.suppliers[0].id,
        referenceNumber: 'PO-BATCH-001',
        items: batchItems,
        performedBy: testUser.id,
        notes: 'TEST: Large batch performance test'
      };

      await supplierQueries.updateInventoryOnPurchaseReceipt(receiptData);

      const executionTime = Date.now() - startTime;
      
      // Should complete within reasonable time (adjust threshold as needed)
      expect(executionTime).toBeLessThan(10000); // 10 seconds max
      
      // Verify batch was processed correctly
      const finalInventory = await inventoryQueries.getInventoryById(testData.inventoryItems[1].id);
      expect(finalInventory.quantityOnHand).toBe(200 + batchSize);
    });

    it('should handle high-frequency operations', async () => {
      const operationCount = 50;
      const operations = [];
      
      // Create many small adjustment operations
      for (let i = 0; i < operationCount; i++) {
        operations.push(
          inventoryQueries.recordMovement({
            inventoryId: testData.inventoryItems[1].id,
            productId: testData.products[1].id,
            warehouseId: 'warehouse-001',
            movementType: 'adjustment',
            quantity: i % 2 === 0 ? 1 : -1, // Alternate positive/negative
            referenceType: 'adjustment',
            referenceNumber: `ADJ-PERF-${i}`,
            performedBy: testUser.id,
            notes: `TEST: High-frequency operation ${i}`
          })
        );
      }

      const startTime = Date.now();
      await Promise.all(operations);
      const executionTime = Date.now() - startTime;

      // Should handle high frequency efficiently
      expect(executionTime).toBeLessThan(15000); // 15 seconds max
      
      // Verify operations were recorded
      const movements = await inventoryQueries.getMovements({
        inventoryId: testData.inventoryItems[1].id,
        limit: operationCount + 10
      });
      
      const testMovements = movements.data.filter(m => 
        m.referenceNumber && m.referenceNumber.startsWith('ADJ-PERF-')
      );
      expect(testMovements.length).toBe(operationCount);
    });
  });

  describe('Data Integrity & Consistency', () => {
    it('should maintain data consistency across all operations', async () => {
      const inventoryId = testData.inventoryItems[0].id;
      
      // Record initial state
      const initialInventory = await inventoryQueries.getInventoryById(inventoryId);
      const initialMovements = await inventoryQueries.getMovements({ inventoryId });
      
      // Perform series of operations
      const operations = [
        { type: 'purchase', quantity: 10, cost: 750 },
        { type: 'sale', quantity: -5, cost: 750 },
        { type: 'adjustment', quantity: -2, cost: 750 },
        { type: 'purchase', quantity: 8, cost: 760 },
        { type: 'sale', quantity: -3, cost: 755 }
      ];

      let expectedQuantity = initialInventory.quantityOnHand;
      
      for (const [index, operation] of operations.entries()) {
        if (operation.type === 'purchase') {
          await supplierQueries.updateInventoryOnPurchaseReceipt({
            supplierId: testData.suppliers[0].id,
            referenceNumber: `PO-CONSISTENCY-${index}`,
            items: [{
              productId: testData.products[0].id,
              warehouseId: 'warehouse-001',
              quantity: operation.quantity,
              unitCost: operation.cost
            }],
            performedBy: testUser.id,
            notes: `TEST: Consistency ${operation.type} ${index}`
          });
          expectedQuantity += operation.quantity;
        } else if (operation.type === 'sale') {
          await customerQueries.processSale({
            customerId: testData.customers[0].id,
            items: [{
              productId: testData.products[0].id,
              warehouseId: 'warehouse-001',
              quantity: Math.abs(operation.quantity),
              unitPrice: 999.99
            }],
            referenceNumber: `SO-CONSISTENCY-${index}`,
            performedBy: testUser.id,
            notes: `TEST: Consistency ${operation.type} ${index}`
          });
          expectedQuantity += operation.quantity; // operation.quantity is negative
        } else if (operation.type === 'adjustment') {
          expectedQuantity += operation.quantity; // operation.quantity is negative
          await inventoryQueries.adjustStock(
            inventoryId,
            expectedQuantity,
            `Consistency test adjustment ${index}`,
            testUser.id,
            `TEST: Consistency ${operation.type} ${index}`
          );
        }
      }

      // Verify final consistency
      const finalInventory = await inventoryQueries.getInventoryById(inventoryId);
      expect(finalInventory.quantityOnHand).toBe(expectedQuantity);

      // Verify movement history integrity
      const finalMovements = await inventoryQueries.getMovements({ inventoryId });
      const newMovements = finalMovements.data.length - initialMovements.data.length;
      expect(newMovements).toBe(operations.length);

      // Verify each movement has correct running total
      const testMovements = finalMovements.data
        .filter(m => m.notes && m.notes.includes('TEST: Consistency'))
        .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

      for (let i = 0; i < testMovements.length; i++) {
        const movement = testMovements[i];
        expect(movement.quantityAfter).toBe(movement.runningTotal);
        
        if (i > 0) {
          const previousMovement = testMovements[i - 1];
          const expectedAfter = previousMovement.quantityAfter + movement.quantity;
          expect(movement.quantityAfter).toBe(expectedAfter);
        }
      }
    });

    it('should rollback failed transactions properly', async () => {
      const inventoryId = testData.inventoryItems[2].id; // Monitor
      const initialInventory = await inventoryQueries.getInventoryById(inventoryId);
      
      // Attempt a sale that should fail (insufficient stock)
      const saleData = {
        customerId: testData.customers[0].id,
        items: [
          {
            productId: testData.products[2].id,
            warehouseId: 'warehouse-002',
            quantity: 15, // Should succeed
            unitPrice: 199.99
          },
          {
            productId: testData.products[2].id,
            warehouseId: 'warehouse-002',
            quantity: 20, // Should fail - not enough stock remaining
            unitPrice: 199.99
          }
        ],
        referenceNumber: 'SO-ROLLBACK-TEST',
        performedBy: testUser.id,
        notes: 'TEST: Transaction rollback test'
      };

      // Should fail and rollback
      await expect(customerQueries.processSale(saleData)).rejects.toThrow();

      // Verify inventory unchanged
      const finalInventory = await inventoryQueries.getInventoryById(inventoryId);
      expect(finalInventory.quantityOnHand).toBe(initialInventory.quantityOnHand);
      expect(finalInventory.quantityAvailable).toBe(initialInventory.quantityAvailable);

      // Verify no movements were recorded
      const movements = await inventoryQueries.getMovements({
        inventoryId,
        referenceNumber: 'SO-ROLLBACK-TEST'
      });
      expect(movements.data.length).toBe(0);
    });
  });
});