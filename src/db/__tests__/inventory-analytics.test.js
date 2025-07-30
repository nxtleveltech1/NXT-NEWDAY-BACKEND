import { describe, test, expect, beforeAll, afterAll } from '@jest/globals';
import { db } from '../index.js';
import * as inventoryAnalytics from '../inventory-analytics.js';
import { inventory, inventoryMovements, products, suppliers } from '../schema.js';

describe('Inventory Analytics', () => {
  // Sample test data
  const testData = {
    suppliers: [],
    products: [],
    inventoryRecords: [],
    movements: []
  };

  beforeAll(async () => {
    // Clean up any existing test data
    await db.delete(inventoryMovements);
    await db.delete(inventory);
    await db.delete(products);
    await db.delete(suppliers);

    // Create test suppliers
    const supplierData = await db.insert(suppliers).values([
      {
        supplierCode: 'SUP001',
        companyName: 'Test Supplier 1',
        email: 'supplier1@test.com',
        contactDetails: {},
        paymentTerms: {},
        isActive: true
      },
      {
        supplierCode: 'SUP002', 
        companyName: 'Test Supplier 2',
        email: 'supplier2@test.com',
        contactDetails: {},
        paymentTerms: {},
        isActive: true
      }
    ]).returning();
    testData.suppliers = supplierData;

    // Create test products
    const productData = await db.insert(products).values([
      {
        sku: 'PROD001',
        name: 'Fast Moving Product',
        description: 'High demand product',
        category: 'Electronics',
        unitPrice: '100.00',
        costPrice: '60.00',
        supplierId: supplierData[0].id,
        isActive: true
      },
      {
        sku: 'PROD002',
        name: 'Slow Moving Product',
        description: 'Low demand product',
        category: 'Electronics',
        unitPrice: '200.00',
        costPrice: '120.00',
        supplierId: supplierData[1].id,
        isActive: true
      },
      {
        sku: 'PROD003',
        name: 'Dead Stock Product',
        description: 'No demand product',
        category: 'Accessories',
        unitPrice: '50.00',
        costPrice: '30.00',
        supplierId: supplierData[0].id,
        isActive: true
      }
    ]).returning();
    testData.products = productData;

    // Create test inventory records
    const warehouseId = crypto.randomUUID();
    const inventoryData = await db.insert(inventory).values([
      {
        productId: productData[0].id,
        warehouseId: warehouseId,
        quantityOnHand: 100,
        quantityAvailable: 80,
        quantityReserved: 20,
        reorderPoint: 20,
        reorderQuantity: 50,
        minStockLevel: 10,
        averageCost: '60.00',
        lastPurchaseCost: '60.00',
        stockStatus: 'in_stock'
      },
      {
        productId: productData[1].id,
        warehouseId: warehouseId,
        quantityOnHand: 50,
        quantityAvailable: 50,
        quantityReserved: 0,
        reorderPoint: 15,
        reorderQuantity: 25,
        minStockLevel: 5,
        averageCost: '120.00',
        lastPurchaseCost: '120.00',
        stockStatus: 'in_stock'
      },
      {
        productId: productData[2].id,
        warehouseId: warehouseId,
        quantityOnHand: 200,
        quantityAvailable: 200,
        quantityReserved: 0,
        reorderPoint: 10,
        reorderQuantity: 20,
        minStockLevel: 5,
        averageCost: '30.00',
        lastPurchaseCost: '30.00',
        stockStatus: 'in_stock'
      }
    ]).returning();
    testData.inventoryRecords = inventoryData;

    // Create test movements (simulating sales and purchases)
    const currentDate = new Date();
    const movements = [];

    // Fast moving product - regular sales
    for (let i = 0; i < 30; i++) {
      const date = new Date(currentDate.getTime() - i * 24 * 60 * 60 * 1000);
      movements.push({
        inventoryId: inventoryData[0].id,
        productId: productData[0].id,
        warehouseId: warehouseId,
        movementType: 'sale',
        quantity: -Math.floor(Math.random() * 5) - 1, // -1 to -5 units
        unitCost: '60.00',
        totalCost: String(Math.abs(movements.length) * 60),
        quantityAfter: 100 - (i * 2),
        runningTotal: 100 - (i * 2),
        createdAt: date
      });
    }

    // Slow moving product - occasional sales
    for (let i = 0; i < 10; i++) {
      const date = new Date(currentDate.getTime() - i * 7 * 24 * 60 * 60 * 1000);
      movements.push({
        inventoryId: inventoryData[1].id,
        productId: productData[1].id,
        warehouseId: warehouseId,
        movementType: 'sale',
        quantity: -1,
        unitCost: '120.00',
        totalCost: '120.00',
        quantityAfter: 50 - i,
        runningTotal: 50 - i,
        createdAt: date
      });
    }

    // Dead stock product - no recent sales (only old movements)
    const oldDate = new Date(currentDate.getTime() - 200 * 24 * 60 * 60 * 1000);
    movements.push({
      inventoryId: inventoryData[2].id,
      productId: productData[2].id,
      warehouseId: warehouseId,
      movementType: 'sale',
      quantity: -5,
      unitCost: '30.00',
      totalCost: '150.00',
      quantityAfter: 195,
      runningTotal: 195,
      createdAt: oldDate
    });

    await db.insert(inventoryMovements).values(movements);
    testData.movements = movements;
  });

  afterAll(async () => {
    // Clean up test data
    await db.delete(inventoryMovements);
    await db.delete(inventory);
    await db.delete(products);
    await db.delete(suppliers);
  });

  describe('Inventory Turnover Calculations', () => {
    test('should calculate turnover ratio correctly', async () => {
      const result = await inventoryAnalytics.calculateInventoryTurnover({
        groupBy: 'product',
        lookbackDays: 90
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBeGreaterThan(0);

      // Fast moving product should have higher turnover
      const fastMovingProduct = result.find(item => item.productSku === 'PROD001');
      expect(fastMovingProduct).toBeDefined();
      expect(fastMovingProduct.turnoverRatio).toBeGreaterThan(0);
      expect(fastMovingProduct.turnoverHealth).toBeDefined();
    });

    test('should calculate turnover trends', async () => {
      const result = await inventoryAnalytics.getInventoryTurnoverTrends({
        periodType: 'monthly',
        periodsBack: 3
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });

  describe('Stock Level Optimization', () => {
    test('should calculate optimal stock levels using EOQ', async () => {
      const result = await inventoryAnalytics.calculateOptimalStockLevels({
        analysisMethod: 'economic_order_quantity',
        lookbackDays: 90,
        serviceLevel: 0.95,
        leadTimeDays: 7
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      
      if (result.length > 0) {
        const item = result[0];
        expect(item.optimizedReorderPoint).toBeDefined();
        expect(item.optimizedReorderQuantity).toBeDefined();
        expect(item.safetyStock).toBeDefined();
        expect(item.recommendation).toBeDefined();
      }
    });

    test('should perform ABC analysis', async () => {
      const result = await inventoryAnalytics.performABCAnalysis({
        lookbackDays: 90,
        criteriaType: 'revenue'
      });

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);

      if (result.items.length > 0) {
        const item = result.items[0];
        expect(item.abcClass).toMatch(/^[ABC]$/);
        expect(item.recommendedStrategy).toBeDefined();
      }
    });
  });

  describe('Dead Stock Identification', () => {
    test('should identify dead and slow-moving stock', async () => {
      const result = await inventoryAnalytics.identifyDeadStock({
        deadStockDays: 180,
        slowMovingDays: 90,
        includeSlowMoving: true
      });

      expect(result).toBeDefined();
      expect(result.items).toBeDefined();
      expect(result.summary).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);

      // Should identify the dead stock product
      const deadStockItem = result.items.find(item => item.productSku === 'PROD003');
      if (deadStockItem) {
        expect(deadStockItem.stockStatus).toMatch(/^(dead|slow_moving)$/);
        expect(deadStockItem.riskLevel).toBeDefined();
        expect(Array.isArray(deadStockItem.recommendations)).toBe(true);
      }
    });
  });

  describe('Reorder Point Calculations', () => {
    test('should calculate optimized reorder points', async () => {
      const result = await inventoryAnalytics.calculateOptimizedReorderPoints({
        serviceLevel: 0.95,
        leadTimeDays: 7,
        lookbackDays: 90,
        method: 'statistical'
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);

      if (result.length > 0) {
        const item = result[0];
        expect(item.optimizedReorderPoint).toBeDefined();
        expect(item.safetyStock).toBeDefined();
        expect(item.leadTimeDemand).toBeDefined();
        expect(item.confidence).toMatch(/^(low|medium|high)$/);
        expect(item.recommendation).toBeDefined();
        expect(item.priority).toMatch(/^(low|medium|high)$/);
      }
    });
  });

  describe('Performance and Edge Cases', () => {
    test('should handle empty data gracefully', async () => {
      // Test with non-existent warehouse
      const result = await inventoryAnalytics.calculateInventoryTurnover({
        warehouseId: 'non-existent-warehouse'
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(0);
    });

    test('should handle invalid parameters', async () => {
      const result = await inventoryAnalytics.calculateOptimalStockLevels({
        serviceLevel: 1.5, // Invalid service level > 1
        leadTimeDays: -1,  // Invalid negative lead time
        lookbackDays: 0    // Invalid zero lookback
      });

      expect(result).toBeDefined();
      expect(Array.isArray(result)).toBe(true);
    });
  });
});

describe('Integration Tests', () => {
  test('should handle complex multi-parameter queries', async () => {
    const turnoverResult = await inventoryAnalytics.calculateInventoryTurnover({
      groupBy: 'category',
      dateFrom: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(),
      dateTo: new Date().toISOString()
    });

    const deadStockResult = await inventoryAnalytics.identifyDeadStock({
      deadStockDays: 180,
      slowMovingDays: 90
    });

    expect(turnoverResult).toBeDefined();
    expect(deadStockResult).toBeDefined();
  });
});