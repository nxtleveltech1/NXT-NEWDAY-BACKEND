/**
 * Supply Chain Integration Tests
 * 
 * Comprehensive end-to-end testing for all supply chain integration workflows:
 * - Price upload → Product cost update → PO creation flow
 * - Purchase Order → Inventory receipt → Stock update flow  
 * - Customer Order → Stock allocation → Fulfillment flow
 * - Return → Inventory update flow
 * - Multi-supplier scenarios
 * - Error handling and recovery
 * - Performance testing
 */

import { describe, beforeAll, afterAll, beforeEach, test, expect } from '@jest/globals';
import { db } from '../../src/db/index.js';
import { 
  suppliers, 
  priceLists, 
  priceListItems, 
  products, 
  inventory, 
  inventoryMovements,
  supplierPurchaseOrders,
  supplierPurchaseOrderItems,
  purchaseOrderReceipts,
  purchaseOrderReceiptItems,
  purchaseOrders,
  purchaseOrderItems,
  customers,
  timeSeriesEvents
} from '../../src/db/schema.js';
import { supplyChainIntegrationService } from '../../src/services/supply-chain-integration.service.js';
import { integrationMonitoringService } from '../../src/services/integration-monitoring.service.js';
import { eq, and } from 'drizzle-orm';

describe('Supply Chain Integration Tests', () => {
  let testSupplier;
  let testCustomer;
  let testProducts = [];
  let testWarehouseId;
  let testPriceList;

  beforeAll(async () => {
    // Set up test data
    await setupTestData();
  });

  afterAll(async () => {
    // Clean up test data
    await cleanupTestData();
  });

  beforeEach(async () => {
    // Reset inventory and orders for each test
    await resetTestState();
  });

  // ==================== SETUP AND TEARDOWN ====================

  async function setupTestData() {
    // Create test supplier
    const [supplier] = await db.insert(suppliers)
      .values({
        supplierCode: 'TEST-SUPPLIER-001',
        companyName: 'Test Supplier Co.',
        email: 'test@testsupplier.com',
        phone: '+1-555-0123',
        address: { 
          street: '123 Supplier St',
          city: 'Test City',
          state: 'TS',
          zip: '12345'
        },
        contactDetails: {
          primaryContact: {
            name: 'John Supplier',
            email: 'john@testsupplier.com',
            phone: '+1-555-0124'
          }
        },
        paymentTerms: { terms: 'NET30' },
        leadTimeDays: 7,
        performanceRating: 4.5,
        isActive: true,
        isApproved: true
      })
      .returning();
    testSupplier = supplier;

    // Create test customer
    const [customer] = await db.insert(customers)
      .values({
        customerCode: 'TEST-CUSTOMER-001',
        companyName: 'Test Customer Inc.',
        email: 'test@testcustomer.com',
        phone: '+1-555-0200',
        address: {
          billing: {
            street: '456 Customer Ave',
            city: 'Test City',
            state: 'TC',
            zip: '54321'
          }
        }
      })
      .returning();
    testCustomer = customer;

    // Set test warehouse ID
    testWarehouseId = '550e8400-e29b-41d4-a716-446655440000';

    // Create test products
    const productData = [
      {
        sku: 'TEST-PROD-001',
        name: 'Test Product 1',
        description: 'Test product for integration testing',
        category: 'Test Category',
        unitPrice: 10.00,
        costPrice: 6.00,
        supplierId: testSupplier.id,
        isActive: true
      },
      {
        sku: 'TEST-PROD-002',
        name: 'Test Product 2',
        description: 'Second test product',
        category: 'Test Category',
        unitPrice: 25.00,
        costPrice: 15.00,
        supplierId: testSupplier.id,
        isActive: true
      },
      {
        sku: 'TEST-PROD-003',
        name: 'Test Product 3',
        description: 'Third test product',
        category: 'Test Category',
        unitPrice: 50.00,
        costPrice: 30.00,
        supplierId: testSupplier.id,
        isActive: true
      }
    ];

    const insertedProducts = await db.insert(products)
      .values(productData)
      .returning();
    testProducts = insertedProducts;

    // Create initial inventory
    const inventoryData = testProducts.map(product => ({
      productId: product.id,
      warehouseId: testWarehouseId,
      quantityOnHand: 100,
      quantityAvailable: 90,
      quantityReserved: 10,
      quantityInTransit: 0,
      reorderPoint: 20,
      reorderQuantity: 100,
      averageCost: product.costPrice,
      lastPurchaseCost: product.costPrice,
      stockStatus: 'in_stock'
    }));

    await db.insert(inventory).values(inventoryData);
  }

  async function cleanupTestData() {
    // Delete in reverse dependency order
    await db.delete(purchaseOrderItems);
    await db.delete(purchaseOrders);
    await db.delete(purchaseOrderReceiptItems);
    await db.delete(purchaseOrderReceipts);
    await db.delete(supplierPurchaseOrderItems);
    await db.delete(supplierPurchaseOrders);
    await db.delete(inventoryMovements);
    await db.delete(inventory);
    await db.delete(priceListItems);
    await db.delete(priceLists);
    await db.delete(products);
    await db.delete(customers).where(eq(customers.customerCode, 'TEST-CUSTOMER-001'));
    await db.delete(suppliers).where(eq(suppliers.supplierCode, 'TEST-SUPPLIER-001'));
    await db.delete(timeSeriesEvents).where(eq(timeSeriesEvents.eventCategory, 'test'));
  }

  async function resetTestState() {
    // Reset inventory quantities
    await db.update(inventory)
      .set({
        quantityOnHand: 100,
        quantityAvailable: 90,
        quantityReserved: 10,
        stockStatus: 'in_stock'
      })
      .where(eq(inventory.warehouseId, testWarehouseId));

    // Clean up any test orders
    await db.delete(purchaseOrderItems);
    await db.delete(purchaseOrders);
    await db.delete(supplierPurchaseOrderItems);
    await db.delete(supplierPurchaseOrders);
  }

  // ==================== PRICE UPLOAD INTEGRATION TESTS ====================

  describe('Price Upload Integration', () => {
    test('should process price list upload and update product costs', async () => {
      // Create test price list
      const [priceList] = await db.insert(priceLists)
        .values({
          supplierId: testSupplier.id,
          name: 'Test Price List 2024',
          effectiveDate: new Date(),
          status: 'active',
          validationStatus: 'validated',
          itemCount: 3
        })
        .returning();

      // Create price list items with updated prices
      const priceItems = [
        {
          priceListId: priceList.id,
          sku: 'TEST-PROD-001',
          description: 'Test Product 1',
          unitPrice: 7.50, // Increased from 6.00
          currency: 'USD',
          minQuantity: 1
        },
        {
          priceListId: priceList.id,
          sku: 'TEST-PROD-002',
          description: 'Test Product 2',
          unitPrice: 18.00, // Increased from 15.00
          currency: 'USD',
          minQuantity: 1
        },
        {
          priceListId: priceList.id,
          sku: 'TEST-PROD-003',
          description: 'Test Product 3',
          unitPrice: 25.00, // Decreased from 30.00
          currency: 'USD',
          minQuantity: 1
        }
      ];

      await db.insert(priceListItems).values(priceItems);

      // Process price list
      const result = await supplyChainIntegrationService.processPriceListUpload(
        priceList.id,
        { 
          triggerReorderSuggestions: false, // Don't trigger reorder for this test
          priceChangeThreshold: 15 // Alert if price changes > 15%
        }
      );

      // Verify results
      expect(result.processed).toBe(3);
      expect(result.updated).toBe(3);
      expect(result.created).toBe(0);
      expect(result.warnings.length).toBeGreaterThan(0); // Should have warnings for significant price changes

      // Verify product costs were updated
      const updatedProducts = await db.select()
        .from(products)
        .where(eq(products.supplierId, testSupplier.id));

      const product1 = updatedProducts.find(p => p.sku === 'TEST-PROD-001');
      const product3 = updatedProducts.find(p => p.sku === 'TEST-PROD-003');

      expect(parseFloat(product1.costPrice)).toBe(7.50);
      expect(parseFloat(product3.costPrice)).toBe(25.00);

      // Clean up
      await db.delete(priceListItems).where(eq(priceListItems.priceListId, priceList.id));
      await db.delete(priceLists).where(eq(priceLists.id, priceList.id));
    });

    test('should generate reorder suggestions after price update', async () => {
      // Set low stock levels to trigger reorder
      await db.update(inventory)
        .set({
          quantityOnHand: 15,
          quantityAvailable: 15,
          stockStatus: 'low_stock'
        })
        .where(and(
          eq(inventory.warehouseId, testWarehouseId),
          eq(inventory.productId, testProducts[0].id)
        ));

      const suggestions = await supplyChainIntegrationService.generateReorderSuggestions(
        testSupplier.id
      );

      expect(suggestions.suggestions.length).toBeGreaterThan(0);
      expect(suggestions.suggestions[0].sku).toBe('TEST-PROD-001');
      expect(suggestions.suggestions[0].currentStock).toBe(15);
      expect(suggestions.suggestions[0].reorderQuantity).toBeGreaterThan(0);
    });
  });

  // ==================== PURCHASE ORDER INTEGRATION TESTS ====================

  describe('Purchase Order Integration', () => {
    test('should create supplier purchase order from reorder suggestions', async () => {
      const items = [
        {
          productId: testProducts[0].id,
          quantity: 100,
          unitPrice: 7.50,
          warehouseId: testWarehouseId,
          currentStock: 15,
          reorderPoint: 20
        },
        {
          productId: testProducts[1].id,
          quantity: 50,
          unitPrice: 18.00,
          warehouseId: testWarehouseId,
          currentStock: 10,
          reorderPoint: 20
        }
      ];

      const result = await supplyChainIntegrationService.createSupplierPurchaseOrder(
        testSupplier.id,
        items,
        {
          autoApprove: true,
          createdBy: 'test-user',
          notes: 'Test purchase order creation'
        }
      );

      expect(result.purchaseOrder).toBeDefined();
      expect(result.items.length).toBe(2);
      expect(result.summary.itemCount).toBe(2);
      expect(result.summary.status).toBe('approved');
      expect(parseFloat(result.summary.totalAmount)).toBeGreaterThan(0);

      // Verify PO items were created correctly
      const poItems = await db.select()
        .from(supplierPurchaseOrderItems)
        .where(eq(supplierPurchaseOrderItems.supplierPurchaseOrderId, result.purchaseOrder.id));

      expect(poItems.length).toBe(2);
      expect(poItems[0].quantityOrdered).toBe(100);
      expect(poItems[1].quantityOrdered).toBe(50);
    });

    test('should process purchase order receipt and update inventory', async () => {
      // First create a purchase order
      const items = [
        {
          productId: testProducts[0].id,
          quantity: 100,
          unitPrice: 7.50,
          warehouseId: testWarehouseId
        }
      ];

      const poResult = await supplyChainIntegrationService.createSupplierPurchaseOrder(
        testSupplier.id,
        items,
        { autoApprove: true }
      );

      // Get initial inventory levels
      const initialInventory = await db.select()
        .from(inventory)
        .where(and(
          eq(inventory.productId, testProducts[0].id),
          eq(inventory.warehouseId, testWarehouseId)
        ))
        .limit(1);

      const initialQuantity = initialInventory[0].quantityOnHand;

      // Process receipt
      const receiptData = {
        purchaseOrderId: poResult.purchaseOrder.id,
        warehouseId: testWarehouseId,
        receivedBy: 'test-user',
        items: [
          {
            purchaseOrderItemId: poResult.items[0].id,
            productId: testProducts[0].id,
            sku: testProducts[0].sku,
            quantityOrdered: 100,
            quantityReceived: 100,
            quantityAccepted: 100,
            unitCost: 7.50,
            batchNumber: 'BATCH-001'
          }
        ]
      };

      const receiptResult = await supplyChainIntegrationService.processPurchaseOrderReceipt(
        receiptData
      );

      expect(receiptResult.receipt).toBeDefined();
      expect(receiptResult.items.length).toBe(1);
      expect(receiptResult.hasDiscrepancies).toBe(false);

      // Verify inventory was updated
      const updatedInventory = await db.select()
        .from(inventory)
        .where(and(
          eq(inventory.productId, testProducts[0].id),
          eq(inventory.warehouseId, testWarehouseId)
        ))
        .limit(1);

      expect(updatedInventory[0].quantityOnHand).toBe(initialQuantity + 100);
      expect(updatedInventory[0].quantityAvailable).toBe(initialInventory[0].quantityAvailable + 100);

      // Verify inventory movement was recorded
      const movements = await db.select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.productId, testProducts[0].id))
        .orderBy(inventoryMovements.createdAt);

      const purchaseMovement = movements.find(m => m.movementType === 'purchase');
      expect(purchaseMovement).toBeDefined();
      expect(purchaseMovement.quantity).toBe(100);
      expect(parseFloat(purchaseMovement.unitCost)).toBe(7.50);
    });

    test('should handle receipt discrepancies correctly', async () => {
      // Create purchase order
      const items = [
        {
          productId: testProducts[1].id,
          quantity: 50,
          unitPrice: 18.00,
          warehouseId: testWarehouseId
        }
      ];

      const poResult = await supplyChainIntegrationService.createSupplierPurchaseOrder(
        testSupplier.id,
        items,
        { autoApprove: true }
      );

      // Process receipt with discrepancies
      const receiptData = {
        purchaseOrderId: poResult.purchaseOrder.id,
        warehouseId: testWarehouseId,
        receivedBy: 'test-user',
        items: [
          {
            purchaseOrderItemId: poResult.items[0].id,
            productId: testProducts[1].id,
            sku: testProducts[1].sku,
            quantityOrdered: 50,
            quantityReceived: 45, // Short delivery
            quantityAccepted: 40, // Some damaged
            quantityRejected: 5,
            unitCost: 18.00,
            discrepancyType: 'quantity_short',
            discrepancyNotes: 'Short delivery and damaged items'
          }
        ]
      };

      const receiptResult = await supplyChainIntegrationService.processPurchaseOrderReceipt(
        receiptData
      );

      expect(receiptResult.hasDiscrepancies).toBe(true);
      expect(receiptResult.items[0].quantityReceived).toBe(45);
      expect(receiptResult.items[0].quantityAccepted).toBe(40);
      expect(receiptResult.items[0].quantityRejected).toBe(5);
      expect(receiptResult.items[0].discrepancyType).toBe('quantity_short');
    });
  });

  // ==================== CUSTOMER ORDER INTEGRATION TESTS ====================

  describe('Customer Order Integration', () => {
    test('should process customer order and allocate inventory', async () => {
      const orderData = {
        customerId: testCustomer.id,
        warehouseId: testWarehouseId,
        items: [
          {
            productId: testProducts[0].id,
            sku: testProducts[0].sku,
            productName: testProducts[0].name,
            quantity: 10,
            unitPrice: 10.00
          },
          {
            productId: testProducts[1].id,
            sku: testProducts[1].sku,
            productName: testProducts[1].name,
            quantity: 5,
            unitPrice: 25.00
          }
        ],
        shippingAddress: {
          street: '789 Delivery St',
          city: 'Test City',
          state: 'TC',
          zip: '98765'
        },
        billingAddress: {
          street: '456 Customer Ave',
          city: 'Test City',
          state: 'TC',
          zip: '54321'
        }
      };

      const result = await supplyChainIntegrationService.processCustomerOrder(orderData);

      expect(result.order).toBeDefined();
      expect(result.items.length).toBe(2);
      expect(result.allocations.length).toBe(2);
      expect(result.summary.fullyAllocated).toBe(true);
      expect(result.summary.backorderedItems).toBe(0);

      // Verify inventory allocation
      const updatedInventory = await db.select()
        .from(inventory)
        .where(eq(inventory.warehouseId, testWarehouseId));

      const product1Inventory = updatedInventory.find(i => i.productId === testProducts[0].id);
      const product2Inventory = updatedInventory.find(i => i.productId === testProducts[1].id);

      expect(product1Inventory.quantityAvailable).toBe(80); // 90 - 10
      expect(product1Inventory.quantityReserved).toBe(20); // 10 + 10
      expect(product2Inventory.quantityAvailable).toBe(85); // 90 - 5
      expect(product2Inventory.quantityReserved).toBe(15); // 10 + 5

      // Verify allocation movements were recorded
      const movements = await db.select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.movementType, 'allocation'));

      expect(movements.length).toBe(2);
      expect(movements[0].quantity).toBe(-10); // Negative for allocation
      expect(movements[1].quantity).toBe(-5);
    });

    test('should handle backorders when insufficient inventory', async () => {
      const orderData = {
        customerId: testCustomer.id,
        warehouseId: testWarehouseId,
        items: [
          {
            productId: testProducts[0].id,
            sku: testProducts[0].sku,
            productName: testProducts[0].name,
            quantity: 150, // More than available (90)
            unitPrice: 10.00
          }
        ],
        shippingAddress: { street: '789 Delivery St' }
      };

      const result = await supplyChainIntegrationService.processCustomerOrder(
        orderData,
        { allowBackorders: true }
      );

      expect(result.summary.fullyAllocated).toBe(false);
      expect(result.summary.backorderedItems).toBe(1);
      expect(result.allocations[0].status).toBe('backorder');
      expect(result.allocations[0].allocatedQuantity).toBe(90);
      expect(result.allocations[0].backordered).toBe(60);
    });

    test('should reject order when insufficient inventory and backorders not allowed', async () => {
      const orderData = {
        customerId: testCustomer.id,
        warehouseId: testWarehouseId,
        items: [
          {
            productId: testProducts[0].id,
            sku: testProducts[0].sku,
            productName: testProducts[0].name,
            quantity: 150,
            unitPrice: 10.00
          }
        ]
      };

      await expect(
        supplyChainIntegrationService.processCustomerOrder(
          orderData,
          { allowBackorders: false }
        )
      ).rejects.toThrow(/Insufficient inventory/);
    });
  });

  // ==================== END-TO-END WORKFLOW TESTS ====================

  describe('End-to-End Workflow Tests', () => {
    test('complete price upload → PO creation → receipt → order fulfillment flow', async () => {
      // Step 1: Process price list upload
      const [priceList] = await db.insert(priceLists)
        .values({
          supplierId: testSupplier.id,
          name: 'E2E Test Price List',
          effectiveDate: new Date(),
          status: 'active',
          validationStatus: 'validated',
          itemCount: 1
        })
        .returning();

      await db.insert(priceListItems)
        .values({
          priceListId: priceList.id,
          sku: 'TEST-PROD-001',
          description: 'Test Product 1',
          unitPrice: 8.00, // New price
          currency: 'USD'
        });

      const priceResult = await supplyChainIntegrationService.processPriceListUpload(
        priceList.id,
        { triggerReorderSuggestions: false }
      );

      expect(priceResult.updated).toBe(1);

      // Step 2: Set low inventory to trigger reorder
      await db.update(inventory)
        .set({
          quantityOnHand: 10,
          quantityAvailable: 10,
          stockStatus: 'low_stock'
        })
        .where(and(
          eq(inventory.productId, testProducts[0].id),
          eq(inventory.warehouseId, testWarehouseId)
        ));

      // Step 3: Generate reorder suggestions and create PO
      const suggestions = await supplyChainIntegrationService.generateReorderSuggestions(
        testSupplier.id
      );

      expect(suggestions.suggestions.length).toBeGreaterThan(0);

      const poItems = suggestions.suggestions.map(s => ({
        productId: s.productId,
        quantity: s.reorderQuantity,
        unitPrice: s.estimatedCost,
        warehouseId: testWarehouseId
      }));

      const poResult = await supplyChainIntegrationService.createSupplierPurchaseOrder(
        testSupplier.id,
        poItems,
        { autoApprove: true }
      );

      expect(poResult.purchaseOrder.status).toBe('approved');

      // Step 4: Process PO receipt
      const receiptData = {
        purchaseOrderId: poResult.purchaseOrder.id,
        warehouseId: testWarehouseId,
        receivedBy: 'e2e-test-user',
        items: poResult.items.map(item => ({
          purchaseOrderItemId: item.id,
          productId: item.productId,
          sku: item.sku,
          quantityOrdered: item.quantityOrdered,
          quantityReceived: item.quantityOrdered,
          quantityAccepted: item.quantityOrdered,
          unitCost: item.unitPrice
        }))
      };

      const receiptResult = await supplyChainIntegrationService.processPurchaseOrderReceipt(
        receiptData
      );

      expect(receiptResult.receipt.status).toBe('completed');

      // Step 5: Process customer order
      const orderData = {
        customerId: testCustomer.id,
        warehouseId: testWarehouseId,
        items: [
          {
            productId: testProducts[0].id,
            sku: testProducts[0].sku,
            productName: testProducts[0].name,
            quantity: 20,
            unitPrice: 10.00
          }
        ],
        shippingAddress: { street: '123 E2E Test St' }
      };

      const orderResult = await supplyChainIntegrationService.processCustomerOrder(orderData);

      expect(orderResult.summary.fullyAllocated).toBe(true);

      // Verify final inventory state
      const finalInventory = await db.select()
        .from(inventory)
        .where(and(
          eq(inventory.productId, testProducts[0].id),
          eq(inventory.warehouseId, testWarehouseId)
        ))
        .limit(1);

      const expectedOnHand = 10 + poItems[0].quantity; // Initial + received
      const expectedAvailable = expectedOnHand - 20; // Minus allocated for order

      expect(finalInventory[0].quantityOnHand).toBe(expectedOnHand);
      expect(finalInventory[0].quantityAvailable).toBe(expectedAvailable);

      // Clean up
      await db.delete(priceListItems).where(eq(priceListItems.priceListId, priceList.id));
      await db.delete(priceLists).where(eq(priceLists.id, priceList.id));
    });
  });

  // ==================== MONITORING AND HEALTH TESTS ====================

  describe('Integration Monitoring', () => {
    test('should perform health check and return status', async () => {
      const healthStatus = await integrationMonitoringService.performHealthCheck();

      expect(healthStatus).toBeDefined();
      expect(healthStatus.healthy).toBeDefined();
      expect(healthStatus.checks).toBeDefined();
      expect(healthStatus.checks.database).toBeDefined();
      expect(healthStatus.checks.inventoryIntegrity).toBeDefined();
      expect(healthStatus.duration).toBeGreaterThan(0);
    });

    test('should start and stop monitoring', async () => {
      // Start monitoring
      await integrationMonitoringService.startMonitoring({ interval: 5000 });
      expect(integrationMonitoringService.isMonitoring).toBe(true);

      // Stop monitoring
      integrationMonitoringService.stopMonitoring();
      expect(integrationMonitoringService.isMonitoring).toBe(false);
    });

    test('should log events during integration operations', async () => {
      // Perform an operation that logs events
      const suggestions = await supplyChainIntegrationService.generateReorderSuggestions(
        testSupplier.id
      );

      // Check that events were logged
      const events = await db.select()
        .from(timeSeriesEvents)
        .where(eq(timeSeriesEvents.eventType, 'reorder_suggestions_generated'));

      expect(events.length).toBeGreaterThan(0);
    });
  });

  // ==================== PERFORMANCE TESTS ====================

  describe('Performance Tests', () => {
    test('price list processing should complete within threshold', async () => {
      // Create large price list
      const [priceList] = await db.insert(priceLists)
        .values({
          supplierId: testSupplier.id,
          name: 'Performance Test Price List',
          effectiveDate: new Date(),
          status: 'active',
          validationStatus: 'validated',
          itemCount: 100
        })
        .returning();

      // Create 100 price items
      const priceItems = [];
      for (let i = 1; i <= 100; i++) {
        priceItems.push({
          priceListId: priceList.id,
          sku: `PERF-TEST-${i.toString().padStart(3, '0')}`,
          description: `Performance Test Product ${i}`,
          unitPrice: Math.random() * 100,
          currency: 'USD'
        });
      }

      await db.insert(priceListItems).values(priceItems);

      // Measure processing time
      const startTime = Date.now();
      
      const result = await supplyChainIntegrationService.processPriceListUpload(
        priceList.id,
        { 
          autoCreateProducts: true,
          triggerReorderSuggestions: false 
        }
      );

      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(30000); // Should complete within 30 seconds
      expect(result.processed).toBe(100);

      // Clean up
      await db.delete(priceListItems).where(eq(priceListItems.priceListId, priceList.id));
      await db.delete(priceLists).where(eq(priceLists.id, priceList.id));
    });

    test('inventory allocation should be fast', async () => {
      const orderData = {
        customerId: testCustomer.id,
        warehouseId: testWarehouseId,
        items: testProducts.map(product => ({
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          quantity: 5,
          unitPrice: parseFloat(product.unitPrice)
        }))
      };

      const startTime = Date.now();
      
      const result = await supplyChainIntegrationService.processCustomerOrder(orderData);
      
      const duration = Date.now() - startTime;

      expect(duration).toBeLessThan(2000); // Should complete within 2 seconds
      expect(result.summary.fullyAllocated).toBe(true);
    });
  });

  // ==================== ERROR HANDLING TESTS ====================

  describe('Error Handling', () => {
    test('should handle invalid supplier ID gracefully', async () => {
      await expect(
        supplyChainIntegrationService.generateReorderSuggestions('invalid-supplier-id')
      ).rejects.toThrow();
    });

    test('should handle invalid price list ID gracefully', async () => {
      await expect(
        supplyChainIntegrationService.processPriceListUpload('invalid-price-list-id')
      ).rejects.toThrow();
    });

    test('should handle inventory concurrency issues', async () => {
      // Create two concurrent orders for the same product
      const orderData1 = {
        customerId: testCustomer.id,
        warehouseId: testWarehouseId,
        items: [{
          productId: testProducts[0].id,
          sku: testProducts[0].sku,
          productName: testProducts[0].name,
          quantity: 60, // Large quantity
          unitPrice: 10.00
        }]
      };

      const orderData2 = {
        customerId: testCustomer.id,
        warehouseId: testWarehouseId,
        items: [{
          productId: testProducts[0].id,
          sku: testProducts[0].sku,
          productName: testProducts[0].name,
          quantity: 50, // Another large quantity
          unitPrice: 10.00
        }]
      };

      // Process orders concurrently
      const promises = [
        supplyChainIntegrationService.processCustomerOrder(orderData1, { allowBackorders: true }),
        supplyChainIntegrationService.processCustomerOrder(orderData2, { allowBackorders: true })
      ];

      const results = await Promise.all(promises);

      // Both should succeed, but at least one should have backorders
      expect(results[0]).toBeDefined();
      expect(results[1]).toBeDefined();
      
      const hasBackorders = results.some(r => !r.summary.fullyAllocated);
      expect(hasBackorders).toBe(true);
    });
  });
});