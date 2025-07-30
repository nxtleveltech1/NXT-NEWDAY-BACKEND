/**
 * Supply Chain Performance Tests
 * 
 * Tests to ensure supply chain integration meets performance requirements:
 * - Price list upload: <30 seconds for 10,000 items
 * - PO creation: <2 seconds
 * - Inventory update: Real-time (<500ms)
 * - Dashboard refresh: <3 seconds
 * - Concurrent operations under load
 * - Memory and resource usage
 */

import { describe, beforeAll, afterAll, test, expect } from '@jest/globals';
import { performance } from 'perf_hooks';
import { db } from '../../src/db/index.js';
import { 
  suppliers, 
  priceLists, 
  priceListItems, 
  products, 
  inventory,
  customers
} from '../../src/db/schema.js';
import { supplyChainIntegrationService } from '../../src/services/supply-chain-integration.service.js';
import { integrationMonitoringService } from '../../src/services/integration-monitoring.service.js';
import { supplyChainDashboardService } from '../../src/services/supply-chain-dashboard.service.js';
import { eq } from 'drizzle-orm';

describe('Supply Chain Performance Tests', () => {
  let testSupplier;
  let testCustomer;
  let testWarehouseId;
  let largePriceList;

  beforeAll(async () => {
    // Set up performance test data
    await setupPerformanceTestData();
  }, 60000); // Allow 60 seconds for setup

  afterAll(async () => {
    // Clean up test data
    await cleanupPerformanceTestData();
  }, 30000);

  // ==================== SETUP AND TEARDOWN ====================

  async function setupPerformanceTestData() {
    // Create test supplier
    const [supplier] = await db.insert(suppliers)
      .values({
        supplierCode: 'PERF-SUPPLIER-001',
        companyName: 'Performance Test Supplier',
        email: 'perf@test.com',
        phone: '+1-555-9999',
        address: { street: '123 Performance St' },
        isActive: true,
        isApproved: true,
        leadTimeDays: 5,
        performanceRating: 4.0
      })
      .returning();
    testSupplier = supplier;

    // Create test customer
    const [customer] = await db.insert(customers)
      .values({
        customerCode: 'PERF-CUSTOMER-001',
        companyName: 'Performance Test Customer',
        email: 'customer@test.com',
        phone: '+1-555-8888',
        address: { street: '456 Customer Ave' }
      })
      .returning();
    testCustomer = customer;

    testWarehouseId = '550e8400-e29b-41d4-a716-446655440000';

    // Create large price list for performance testing
    const [priceList] = await db.insert(priceLists)
      .values({
        supplierId: testSupplier.id,
        name: 'Performance Test Large Price List',
        effectiveDate: new Date(),
        status: 'active',
        validationStatus: 'validated',
        itemCount: 10000
      })
      .returning();
    largePriceList = priceList;

    console.log('Creating 10,000 price list items for performance testing...');
    
    // Create large batch of price items in chunks
    const batchSize = 1000;
    const totalItems = 10000;
    
    for (let i = 0; i < totalItems; i += batchSize) {
      const batch = [];
      const end = Math.min(i + batchSize, totalItems);
      
      for (let j = i; j < end; j++) {
        batch.push({
          priceListId: largePriceList.id,
          sku: `PERF-ITEM-${j.toString().padStart(5, '0')}`,
          description: `Performance Test Item ${j}`,
          unitPrice: Math.round((Math.random() * 100 + 1) * 100) / 100,
          currency: 'USD',
          minQuantity: 1
        });
      }
      
      await db.insert(priceListItems).values(batch);
      
      if (i % 2000 === 0) {
        console.log(`Created ${i + batch.length} price items...`);
      }
    }

    console.log('Performance test data setup complete');
  }

  async function cleanupPerformanceTestData() {
    // Delete in order to respect foreign key constraints
    await db.delete(priceListItems).where(eq(priceListItems.priceListId, largePriceList.id));
    await db.delete(priceLists).where(eq(priceLists.id, largePriceList.id));
    await db.delete(products).where(eq(products.supplierId, testSupplier.id));
    await db.delete(inventory).where(eq(inventory.warehouseId, testWarehouseId));
    await db.delete(customers).where(eq(customers.id, testCustomer.id));
    await db.delete(suppliers).where(eq(suppliers.id, testSupplier.id));
  }

  // ==================== PRICE LIST PROCESSING PERFORMANCE ====================

  describe('Price List Processing Performance', () => {
    test('should process 10,000 items within 30 seconds', async () => {
      const startTime = performance.now();
      
      const result = await supplyChainIntegrationService.processPriceListUpload(
        largePriceList.id,
        {
          autoCreateProducts: true,
          triggerReorderSuggestions: false, // Skip for performance test
          priceChangeThreshold: 50 // Higher threshold to reduce warnings
        }
      );

      const endTime = performance.now();
      const duration = endTime - startTime;
      const durationSeconds = duration / 1000;

      console.log(`Processed ${result.processed} items in ${durationSeconds.toFixed(2)} seconds`);
      console.log(`Processing rate: ${(result.processed / durationSeconds).toFixed(0)} items/second`);

      // Verify performance requirement
      expect(durationSeconds).toBeLessThan(30);
      
      // Verify all items were processed
      expect(result.processed).toBe(10000);
      expect(result.created).toBe(10000); // All should be new products
      expect(result.errors.length).toBe(0);

      // Verify processing rate is reasonable (at least 333 items/second)
      const processingRate = result.processed / durationSeconds;
      expect(processingRate).toBeGreaterThan(333);

    }, 35000); // Allow 35 seconds for the test

    test('should handle concurrent price list uploads efficiently', async () => {
      // Create smaller price lists for concurrent testing
      const concurrentPriceLists = [];
      const itemsPerList = 1000;
      const numberOfLists = 5;

      for (let i = 0; i < numberOfLists; i++) {
        const [priceList] = await db.insert(priceLists)
          .values({
            supplierId: testSupplier.id,
            name: `Concurrent Test List ${i + 1}`,
            effectiveDate: new Date(),
            status: 'active',
            validationStatus: 'validated',
            itemCount: itemsPerList
          })
          .returning();

        const items = [];
        for (let j = 0; j < itemsPerList; j++) {
          items.push({
            priceListId: priceList.id,
            sku: `CONC-${i}-${j.toString().padStart(4, '0')}`,
            description: `Concurrent Item ${i}-${j}`,
            unitPrice: Math.round((Math.random() * 50 + 1) * 100) / 100,
            currency: 'USD'
          });
        }

        await db.insert(priceListItems).values(items);
        concurrentPriceLists.push(priceList);
      }

      const startTime = performance.now();

      // Process all price lists concurrently
      const promises = concurrentPriceLists.map(priceList =>
        supplyChainIntegrationService.processPriceListUpload(
          priceList.id,
          {
            autoCreateProducts: true,
            triggerReorderSuggestions: false
          }
        )
      );

      const results = await Promise.all(promises);
      
      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;

      console.log(`Processed ${numberOfLists} concurrent uploads (${itemsPerList * numberOfLists} total items) in ${duration.toFixed(2)} seconds`);

      // Verify all uploads succeeded
      results.forEach((result, index) => {
        expect(result.processed).toBe(itemsPerList);
        expect(result.errors.length).toBe(0);
      });

      // Should be faster than sequential processing due to concurrency
      expect(duration).toBeLessThan(20);

      // Cleanup concurrent test data
      for (const priceList of concurrentPriceLists) {
        await db.delete(priceListItems).where(eq(priceListItems.priceListId, priceList.id));
        await db.delete(priceLists).where(eq(priceLists.id, priceList.id));
      }

    }, 30000);
  });

  // ==================== PURCHASE ORDER PERFORMANCE ====================

  describe('Purchase Order Performance', () => {
    test('should create purchase order within 2 seconds', async () => {
      // Create test products first
      const testProducts = [];
      for (let i = 0; i < 10; i++) {
        const [product] = await db.insert(products)
          .values({
            sku: `PO-PERF-${i.toString().padStart(3, '0')}`,
            name: `PO Performance Product ${i}`,
            costPrice: 10.00 + i,
            unitPrice: 15.00 + i,
            supplierId: testSupplier.id,
            isActive: true
          })
          .returning();
        testProducts.push(product);
      }

      // Create inventory for the products
      const inventoryData = testProducts.map(product => ({
        productId: product.id,
        warehouseId: testWarehouseId,
        quantityOnHand: 5, // Low stock to trigger reorder
        quantityAvailable: 5,
        reorderPoint: 10,
        reorderQuantity: 100,
        averageCost: product.costPrice,
        stockStatus: 'low_stock'
      }));

      await db.insert(inventory).values(inventoryData);

      const items = testProducts.map(product => ({
        productId: product.id,
        quantity: 100,
        unitPrice: product.costPrice,
        warehouseId: testWarehouseId
      }));

      const startTime = performance.now();

      const result = await supplyChainIntegrationService.createSupplierPurchaseOrder(
        testSupplier.id,
        items,
        {
          autoApprove: true,
          createdBy: 'performance-test'
        }
      );

      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;

      console.log(`Created PO with ${items.length} items in ${duration.toFixed(3)} seconds`);

      // Verify performance requirement
      expect(duration).toBeLessThan(2.0);
      
      // Verify PO was created correctly
      expect(result.purchaseOrder).toBeDefined();
      expect(result.items.length).toBe(10);
      expect(result.summary.status).toBe('approved');

    }, 10000);

    test('should generate reorder suggestions quickly', async () => {
      const startTime = performance.now();

      const suggestions = await supplyChainIntegrationService.generateReorderSuggestions(
        testSupplier.id
      );

      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;

      console.log(`Generated reorder suggestions in ${duration.toFixed(3)} seconds`);

      // Should be very fast
      expect(duration).toBeLessThan(1.0);
      expect(suggestions.suggestions.length).toBeGreaterThan(0);

    }, 5000);
  });

  // ==================== INVENTORY UPDATE PERFORMANCE ====================

  describe('Inventory Update Performance', () => {
    test('should update inventory in real-time (<500ms)', async () => {
      // Create a test product and inventory
      const [product] = await db.insert(products)
        .values({
          sku: 'INV-PERF-001',
          name: 'Inventory Performance Product',
          costPrice: 20.00,
          unitPrice: 30.00,
          supplierId: testSupplier.id,
          isActive: true
        })
        .returning();

      const [inventoryRecord] = await db.insert(inventory)
        .values({
          productId: product.id,
          warehouseId: testWarehouseId,
          quantityOnHand: 100,
          quantityAvailable: 90,
          quantityReserved: 10,
          averageCost: 20.00,
          stockStatus: 'in_stock'
        })
        .returning();

      // Test inventory allocation (simulating customer order)
      const startTime = performance.now();

      const orderData = {
        customerId: testCustomer.id,
        warehouseId: testWarehouseId,
        items: [{
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          quantity: 10,
          unitPrice: 30.00
        }]
      };

      const result = await supplyChainIntegrationService.processCustomerOrder(orderData);

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`Processed customer order with inventory allocation in ${duration.toFixed(1)}ms`);

      // Verify performance requirement (should be under 500ms)
      expect(duration).toBeLessThan(500);
      
      // Verify order was processed correctly
      expect(result.summary.fullyAllocated).toBe(true);
      expect(result.allocations.length).toBe(1);

    }, 5000);

    test('should handle batch inventory updates efficiently', async () => {
      // Create multiple products for batch testing
      const batchProducts = [];
      for (let i = 0; i < 50; i++) {
        const [product] = await db.insert(products)
          .values({
            sku: `BATCH-PERF-${i.toString().padStart(3, '0')}`,
            name: `Batch Performance Product ${i}`,
            costPrice: 15.00,
            unitPrice: 25.00,
            supplierId: testSupplier.id,
            isActive: true
          })
          .returning();
        batchProducts.push(product);
      }

      // Create inventory records
      const inventoryData = batchProducts.map(product => ({
        productId: product.id,
        warehouseId: testWarehouseId,
        quantityOnHand: 50,
        quantityAvailable: 45,
        quantityReserved: 5,
        averageCost: 15.00,
        stockStatus: 'in_stock'
      }));

      await db.insert(inventory).values(inventoryData);

      // Test batch customer order
      const startTime = performance.now();

      const batchOrderData = {
        customerId: testCustomer.id,
        warehouseId: testWarehouseId,
        items: batchProducts.slice(0, 25).map(product => ({
          productId: product.id,
          sku: product.sku,
          productName: product.name,
          quantity: 5,
          unitPrice: 25.00
        }))
      };

      const result = await supplyChainIntegrationService.processCustomerOrder(batchOrderData);

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`Processed batch order with ${batchOrderData.items.length} items in ${duration.toFixed(1)}ms`);

      // Should handle batch updates efficiently
      expect(duration).toBeLessThan(2000); // 2 seconds for 25 items
      expect(result.summary.fullyAllocated).toBe(true);
      expect(result.allocations.length).toBe(25);

    }, 10000);
  });

  // ==================== DASHBOARD PERFORMANCE ====================

  describe('Dashboard Performance', () => {
    test('should refresh dashboard within 3 seconds', async () => {
      const startTime = performance.now();

      const dashboardData = await supplyChainDashboardService.getDashboardData('24h');

      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;

      console.log(`Dashboard refresh completed in ${duration.toFixed(3)} seconds`);

      // Verify performance requirement
      expect(duration).toBeLessThan(3.0);
      
      // Verify dashboard data is complete
      expect(dashboardData.overview).toBeDefined();
      expect(dashboardData.inventoryMetrics).toBeDefined();
      expect(dashboardData.orderMetrics).toBeDefined();
      expect(dashboardData.healthScore).toBeGreaterThanOrEqual(0);

    }, 10000);

    test('should handle concurrent dashboard requests efficiently', async () => {
      const numberOfRequests = 10;
      const startTime = performance.now();

      // Make concurrent dashboard requests
      const promises = Array(numberOfRequests).fill().map(() =>
        supplyChainDashboardService.getDashboardData('24h')
      );

      const results = await Promise.all(promises);

      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;

      console.log(`Handled ${numberOfRequests} concurrent dashboard requests in ${duration.toFixed(3)} seconds`);

      // Should benefit from caching
      expect(duration).toBeLessThan(5.0);
      
      // All requests should succeed
      results.forEach(result => {
        expect(result.overview).toBeDefined();
        expect(result.generatedAt).toBeDefined();
      });

    }, 15000);
  });

  // ==================== MONITORING PERFORMANCE ====================

  describe('Integration Monitoring Performance', () => {
    test('should perform health check quickly', async () => {
      const startTime = performance.now();

      const healthStatus = await integrationMonitoringService.performHealthCheck();

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`Health check completed in ${duration.toFixed(1)}ms`);

      // Health check should be very fast
      expect(duration).toBeLessThan(1000); // 1 second
      expect(healthStatus.healthy).toBeDefined();
      expect(healthStatus.checks).toBeDefined();

    }, 5000);

    test('should log events without significant performance impact', async () => {
      const numberOfEvents = 100;
      const startTime = performance.now();

      // Log multiple events
      const promises = [];
      for (let i = 0; i < numberOfEvents; i++) {
        promises.push(
          integrationMonitoringService.logEvent('performance_test_event', 'test', {
            eventNumber: i,
            testData: `Performance test event ${i}`
          })
        );
      }

      await Promise.all(promises);

      const endTime = performance.now();
      const duration = endTime - startTime;

      console.log(`Logged ${numberOfEvents} events in ${duration.toFixed(1)}ms`);

      // Event logging should be very fast
      expect(duration).toBeLessThan(2000); // 2 seconds for 100 events

    }, 5000);
  });

  // ==================== STRESS TESTING ====================

  describe('Stress Testing', () => {
    test('should handle high concurrent load', async () => {
      // Create test products for stress testing
      const stressProducts = [];
      for (let i = 0; i < 20; i++) {
        const [product] = await db.insert(products)
          .values({
            sku: `STRESS-${i.toString().padStart(3, '0')}`,
            name: `Stress Test Product ${i}`,
            costPrice: 10.00,
            unitPrice: 20.00,
            supplierId: testSupplier.id,
            isActive: true
          })
          .returning();
        stressProducts.push(product);
      }

      // Create inventory
      const stressInventoryData = stressProducts.map(product => ({
        productId: product.id,
        warehouseId: testWarehouseId,
        quantityOnHand: 1000,
        quantityAvailable: 900,
        quantityReserved: 100,
        averageCost: 10.00,
        stockStatus: 'in_stock'
      }));

      await db.insert(inventory).values(stressInventoryData);

      const startTime = performance.now();
      const numberOfOrders = 50;

      // Create many concurrent orders
      const orderPromises = [];
      for (let i = 0; i < numberOfOrders; i++) {
        const orderData = {
          customerId: testCustomer.id,
          warehouseId: testWarehouseId,
          items: [{
            productId: stressProducts[i % stressProducts.length].id,
            sku: stressProducts[i % stressProducts.length].sku,
            productName: stressProducts[i % stressProducts.length].name,
            quantity: 5,
            unitPrice: 20.00
          }]
        };

        orderPromises.push(
          supplyChainIntegrationService.processCustomerOrder(orderData)
        );
      }

      const results = await Promise.all(orderPromises);

      const endTime = performance.now();
      const duration = (endTime - startTime) / 1000;

      console.log(`Processed ${numberOfOrders} concurrent orders in ${duration.toFixed(3)} seconds`);

      // Should handle stress load reasonably
      expect(duration).toBeLessThan(10.0); // 10 seconds for 50 concurrent orders
      
      // All orders should succeed
      results.forEach(result => {
        expect(result.summary.fullyAllocated).toBe(true);
      });

      // Verify no data corruption occurred
      const finalInventory = await db.select()
        .from(inventory)
        .where(eq(inventory.warehouseId, testWarehouseId));

      finalInventory.forEach(inv => {
        expect(inv.quantityOnHand).toBeGreaterThanOrEqual(0);
        expect(inv.quantityAvailable).toBeGreaterThanOrEqual(0);
        expect(inv.quantityReserved).toBeGreaterThanOrEqual(0);
      });

    }, 20000);
  });

  // ==================== MEMORY AND RESOURCE USAGE ====================

  describe('Resource Usage', () => {
    test('should not cause memory leaks during extended operations', async () => {
      const initialMemory = process.memoryUsage();
      console.log('Initial memory usage:', initialMemory);

      // Perform many operations to test for memory leaks
      for (let i = 0; i < 100; i++) {
        await supplyChainDashboardService.getDashboardData('1h');
        await integrationMonitoringService.performHealthCheck();
        
        // Force garbage collection every 25 iterations if available
        if (i % 25 === 0 && global.gc) {
          global.gc();
        }
      }

      const finalMemory = process.memoryUsage();
      console.log('Final memory usage:', finalMemory);

      // Memory growth should be reasonable (less than 50MB increase)
      const memoryGrowthMB = (finalMemory.heapUsed - initialMemory.heapUsed) / 1024 / 1024;
      console.log(`Memory growth: ${memoryGrowthMB.toFixed(2)}MB`);

      expect(memoryGrowthMB).toBeLessThan(50);

    }, 30000);
  });
});