import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, jest } from '@jest/globals';
import * as inventoryQueries from '../inventory-queries.js';
import { db } from '../../config/database.js';
import { inventory, inventoryMovements, products, suppliers } from '../schema.js';
import { eq, and } from 'drizzle-orm';
import { realtimeService } from '../../services/realtime-service.js';

// Mock database and dependencies
jest.mock('../../config/database.js');
jest.mock('../../services/realtime-service.js');

describe('Inventory Queries', () => {
  const mockInventory = {
    id: 'inv-123',
    productId: 'prod-456',
    warehouseId: 'wh-001',
    locationId: 'loc-001',
    quantityOnHand: 100,
    quantityAvailable: 80,
    quantityReserved: 20,
    quantityInTransit: 0,
    lastStockCheck: new Date('2024-01-15T10:00:00Z'),
    lastMovement: new Date('2024-01-15T09:00:00Z'),
    stockStatus: 'in_stock',
    reorderPoint: 50,
    reorderQuantity: 100,
    maxStockLevel: 500,
    minStockLevel: 20,
    averageCost: 10.50,
    lastPurchaseCost: 11.00,
    metadata: { bin: 'A1-01' },
    createdAt: new Date('2024-01-01T00:00:00Z'),
    updatedAt: new Date('2024-01-15T10:00:00Z')
  };

  const mockProduct = {
    id: 'prod-456',
    sku: 'TEST-001',
    name: 'Test Product',
    description: 'Test product description',
    category: 'electronics',
    unitPrice: 15.99,
    costPrice: 10.50,
    supplierId: 'sup-001',
    isActive: true
  };

  const mockMovement = {
    id: 'mov-001',
    inventoryId: 'inv-123',
    productId: 'prod-456',
    warehouseId: 'wh-001',
    movementType: 'sale',
    quantity: -10,
    fromLocation: 'loc-001',
    toLocation: null,
    unitCost: 10.50,
    totalCost: 105.00,
    referenceType: 'order',
    referenceId: 'ord-001',
    referenceNumber: 'ORD-2024-001',
    performedBy: 'user-001',
    notes: 'Sale to customer',
    batchNumber: null,
    serialNumbers: [],
    expiryDate: null,
    quantityAfter: 90,
    runningTotal: 90,
    createdAt: new Date('2024-01-15T14:00:00Z')
  };

  beforeAll(() => {
    // Setup mock implementations
    db.select = jest.fn().mockReturnThis();
    db.from = jest.fn().mockReturnThis();
    db.innerJoin = jest.fn().mockReturnThis();
    db.leftJoin = jest.fn().mockReturnThis();
    db.where = jest.fn().mockReturnThis();
    db.orderBy = jest.fn().mockReturnThis();
    db.groupBy = jest.fn().mockReturnThis();
    db.limit = jest.fn().mockReturnThis();
    db.offset = jest.fn().mockReturnThis();
    db.insert = jest.fn().mockReturnThis();
    db.values = jest.fn().mockReturnThis();
    db.returning = jest.fn().mockReturnThis();
    db.update = jest.fn().mockReturnThis();
    db.set = jest.fn().mockReturnThis();
    db.delete = jest.fn().mockReturnThis();
    db.transaction = jest.fn();
    db.execute = jest.fn();

    // Mock realtime service
    realtimeService.notifyInventoryChange = jest.fn();
    realtimeService.notifyInventoryMovement = jest.fn();
    realtimeService.notifyStockAlert = jest.fn();
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getInventory', () => {
    it('should return paginated inventory list with filters', async () => {
      const mockResults = [{ ...mockInventory, ...mockProduct }];
      const mockCount = [{ count: '1' }];
      
      db.limit.mockResolvedValueOnce(mockResults);
      db.where.mockResolvedValueOnce(mockCount);

      const result = await inventoryQueries.getInventory({
        page: 1,
        limit: 10,
        search: 'Test',
        warehouseId: 'wh-001',
        stockStatus: 'in_stock',
        belowReorderPoint: false,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
      expect(result.data).toHaveLength(1);
    });

    it('should filter by below reorder point', async () => {
      const mockResults = [{ ...mockInventory, quantityAvailable: 30, reorderPoint: 50 }];
      const mockCount = [{ count: '1' }];
      
      db.limit.mockResolvedValueOnce(mockResults);
      db.where.mockResolvedValueOnce(mockCount);

      const result = await inventoryQueries.getInventory({
        belowReorderPoint: true
      });

      expect(db.where).toHaveBeenCalled();
      expect(result.data).toHaveLength(1);
    });

    it('should apply search filters correctly', async () => {
      const mockResults = [];
      const mockCount = [{ count: '0' }];
      
      db.limit.mockResolvedValueOnce(mockResults);
      db.where.mockResolvedValueOnce(mockCount);

      const result = await inventoryQueries.getInventory({
        search: 'nonexistent'
      });

      expect(result.data).toHaveLength(0);
      expect(result.pagination.total).toBe(0);
    });
  });

  describe('getInventoryById', () => {
    it('should return inventory record by ID', async () => {
      const mockResult = { ...mockInventory, ...mockProduct };
      db.limit.mockResolvedValueOnce([mockResult]);

      const result = await inventoryQueries.getInventoryById('inv-123');

      expect(result).toEqual(mockResult);
      expect(db.where).toHaveBeenCalledWith(eq(inventory.id, 'inv-123'));
      expect(db.limit).toHaveBeenCalledWith(1);
    });

    it('should return null if inventory not found', async () => {
      db.limit.mockResolvedValueOnce([]);

      const result = await inventoryQueries.getInventoryById('non-existent');

      expect(result).toBeNull();
    });
  });

  describe('getInventoryByProductWarehouse', () => {
    it('should return inventory by product and warehouse', async () => {
      db.limit.mockResolvedValueOnce([mockInventory]);

      const result = await inventoryQueries.getInventoryByProductWarehouse('prod-456', 'wh-001');

      expect(result).toEqual(mockInventory);
      expect(db.where).toHaveBeenCalledWith(
        and(
          eq(inventory.productId, 'prod-456'),
          eq(inventory.warehouseId, 'wh-001')
        )
      );
    });

    it('should return null if no inventory found', async () => {
      db.limit.mockResolvedValueOnce([]);

      const result = await inventoryQueries.getInventoryByProductWarehouse('prod-999', 'wh-999');

      expect(result).toBeNull();
    });
  });

  describe('upsertInventory', () => {
    it('should create new inventory record when none exists', async () => {
      // Mock no existing inventory
      jest.spyOn(inventoryQueries, 'getInventoryByProductWarehouse').mockResolvedValueOnce(null);
      
      const newInventoryData = {
        productId: 'prod-456',
        warehouseId: 'wh-001',
        locationId: 'loc-001',
        quantityOnHand: 100,
        reorderPoint: 50,
        reorderQuantity: 100,
        maxStockLevel: 500,
        minStockLevel: 20
      };

      db.returning.mockResolvedValueOnce([{ ...mockInventory, ...newInventoryData }]);

      const result = await inventoryQueries.upsertInventory(newInventoryData);

      expect(result).toHaveProperty('id');
      expect(result.productId).toBe(newInventoryData.productId);
      expect(db.insert).toHaveBeenCalledWith(inventory);
    });

    it('should update existing inventory record', async () => {
      // Mock existing inventory
      jest.spyOn(inventoryQueries, 'getInventoryByProductWarehouse').mockResolvedValueOnce(mockInventory);
      
      const updateData = {
        productId: 'prod-456',
        warehouseId: 'wh-001',
        quantityOnHand: 150
      };

      db.returning.mockResolvedValueOnce([{ ...mockInventory, quantityOnHand: 150 }]);

      const result = await inventoryQueries.upsertInventory(updateData);

      expect(result.quantityOnHand).toBe(150);
      expect(db.update).toHaveBeenCalledWith(inventory);
    });
  });

  describe('recordMovement', () => {
    const mockTransaction = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis()
    };

    beforeEach(() => {
      db.transaction.mockImplementation(async (callback) => {
        return await callback(mockTransaction);
      });
    });

    it('should record inventory movement and update stock levels', async () => {
      const movementData = {
        inventoryId: 'inv-123',
        productId: 'prod-456',
        warehouseId: 'wh-001',
        movementType: 'sale',
        quantity: -10,
        unitCost: 10.50,
        referenceType: 'order',
        referenceId: 'ord-001',
        performedBy: 'user-001',
        notes: 'Sale to customer'
      };

      mockTransaction.limit.mockResolvedValueOnce([mockInventory]);
      mockTransaction.returning
        .mockResolvedValueOnce([mockMovement]) // Movement insert
        .mockResolvedValueOnce([{ ...mockInventory, quantityOnHand: 90, quantityAvailable: 70 }]); // Inventory update

      const result = await inventoryQueries.recordMovement(movementData);

      expect(result).toHaveProperty('movement');
      expect(result).toHaveProperty('inventory');
      expect(result.movement.quantity).toBe(-10);
      expect(result.inventory.quantityOnHand).toBe(90);
      expect(mockTransaction.insert).toHaveBeenCalledWith(inventoryMovements);
      expect(mockTransaction.update).toHaveBeenCalledWith(inventory);
    });

    it('should throw error for insufficient stock on outbound movement', async () => {
      const movementData = {
        inventoryId: 'inv-123',
        movementType: 'sale',
        quantity: -150 // More than available (80)
      };

      mockTransaction.limit.mockResolvedValueOnce([mockInventory]);

      await expect(inventoryQueries.recordMovement(movementData))
        .rejects.toThrow('Insufficient available stock');
    });

    it('should throw error if inventory record not found', async () => {
      const movementData = {
        inventoryId: 'non-existent',
        movementType: 'sale',
        quantity: -10
      };

      mockTransaction.limit.mockResolvedValueOnce([]);

      await expect(inventoryQueries.recordMovement(movementData))
        .rejects.toThrow('Inventory record not found');
    });

    it('should calculate average cost for inbound movements', async () => {
      const movementData = {
        inventoryId: 'inv-123',
        productId: 'prod-456',
        warehouseId: 'wh-001',
        movementType: 'purchase',
        quantity: 50,
        unitCost: 12.00
      };

      const currentInventory = { ...mockInventory, quantityOnHand: 100, averageCost: 10.50 };
      mockTransaction.limit.mockResolvedValueOnce([currentInventory]);
      mockTransaction.returning
        .mockResolvedValueOnce([mockMovement])
        .mockResolvedValueOnce([{ ...currentInventory, quantityOnHand: 150, averageCost: 11.00 }]);

      const result = await inventoryQueries.recordMovement(movementData);

      // New average cost should be calculated: ((100 * 10.50) + (50 * 12.00)) / 150 = 11.00
      expect(mockTransaction.set).toHaveBeenCalledWith(expect.objectContaining({
        averageCost: expect.any(Number)
      }));
    });

    it('should notify realtime service of inventory changes', async () => {
      const movementData = {
        inventoryId: 'inv-123',
        productId: 'prod-456',
        warehouseId: 'wh-001',
        movementType: 'sale',
        quantity: -10,
        performedBy: 'user-001'
      };

      mockTransaction.limit.mockResolvedValueOnce([mockInventory]);
      mockTransaction.returning
        .mockResolvedValueOnce([mockMovement])
        .mockResolvedValueOnce([{ ...mockInventory, quantityOnHand: 90 }]);

      await inventoryQueries.recordMovement(movementData);

      expect(realtimeService.notifyInventoryChange).toHaveBeenCalled();
      expect(realtimeService.notifyInventoryMovement).toHaveBeenCalled();
    });

    it('should trigger stock alerts for low stock', async () => {
      const movementData = {
        inventoryId: 'inv-123',
        productId: 'prod-456',
        warehouseId: 'wh-001',
        movementType: 'sale',
        quantity: -60 // This will bring stock to 20, below reorder point of 50
      };

      const lowStockInventory = { ...mockInventory, quantityAvailable: 60 };
      mockTransaction.limit
        .mockResolvedValueOnce([lowStockInventory])
        .mockResolvedValueOnce([mockProduct]);
      
      mockTransaction.returning
        .mockResolvedValueOnce([mockMovement])
        .mockResolvedValueOnce([{ ...lowStockInventory, quantityOnHand: 40, stockStatus: 'low_stock' }]);

      await inventoryQueries.recordMovement(movementData);

      expect(realtimeService.notifyStockAlert).toHaveBeenCalledWith(
        expect.objectContaining({
          alertType: 'low_stock',
          priority: 'high'
        })
      );
    });
  });

  describe('reserveStock', () => {
    const mockTransaction = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis()
    };

    beforeEach(() => {
      db.transaction.mockImplementation(async (callback) => {
        return await callback(mockTransaction);
      });
    });

    it('should reserve stock successfully', async () => {
      const reserveQuantity = 30;
      
      mockTransaction.limit.mockResolvedValueOnce([mockInventory]);
      mockTransaction.returning.mockResolvedValueOnce([{
        ...mockInventory,
        quantityAvailable: 50, // 80 - 30
        quantityReserved: 50   // 20 + 30
      }]);

      const result = await inventoryQueries.reserveStock('prod-456', 'wh-001', reserveQuantity);

      expect(result.quantityAvailable).toBe(50);
      expect(result.quantityReserved).toBe(50);
      expect(mockTransaction.update).toHaveBeenCalledWith(inventory);
    });

    it('should throw error for insufficient available stock', async () => {
      const reserveQuantity = 100; // More than available (80)
      
      mockTransaction.limit.mockResolvedValueOnce([mockInventory]);

      await expect(inventoryQueries.reserveStock('prod-456', 'wh-001', reserveQuantity))
        .rejects.toThrow('Insufficient available stock for reservation');
    });

    it('should throw error if inventory not found', async () => {
      mockTransaction.limit.mockResolvedValueOnce([]);

      await expect(inventoryQueries.reserveStock('prod-999', 'wh-999', 10))
        .rejects.toThrow('Inventory record not found');
    });
  });

  describe('releaseReservedStock', () => {
    const mockTransaction = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis()
    };

    beforeEach(() => {
      db.transaction.mockImplementation(async (callback) => {
        return await callback(mockTransaction);
      });
    });

    it('should release reserved stock successfully', async () => {
      const releaseQuantity = 10;
      
      mockTransaction.limit.mockResolvedValueOnce([mockInventory]);
      mockTransaction.returning.mockResolvedValueOnce([{
        ...mockInventory,
        quantityAvailable: 90, // 80 + 10
        quantityReserved: 10   // 20 - 10
      }]);

      const result = await inventoryQueries.releaseReservedStock('prod-456', 'wh-001', releaseQuantity);

      expect(result.quantityAvailable).toBe(90);
      expect(result.quantityReserved).toBe(10);
    });

    it('should throw error when releasing more than reserved', async () => {
      const releaseQuantity = 30; // More than reserved (20)
      
      mockTransaction.limit.mockResolvedValueOnce([mockInventory]);

      await expect(inventoryQueries.releaseReservedStock('prod-456', 'wh-001', releaseQuantity))
        .rejects.toThrow('Cannot release more than reserved quantity');
    });
  });

  describe('getMovements', () => {
    it('should return paginated movement history', async () => {
      const mockMovements = [{ ...mockMovement, ...mockProduct }];
      const mockCount = [{ count: '1' }];
      
      db.limit.mockResolvedValueOnce(mockMovements);
      db.where.mockResolvedValueOnce(mockCount);

      const result = await inventoryQueries.getMovements({
        page: 1,
        limit: 10,
        inventoryId: 'inv-123',
        movementType: 'sale',
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31'
      });

      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('pagination');
      expect(result.data).toHaveLength(1);
      expect(result.pagination.total).toBe(1);
    });

    it('should filter movements by multiple criteria', async () => {
      const mockMovements = [];
      const mockCount = [{ count: '0' }];
      
      db.limit.mockResolvedValueOnce(mockMovements);
      db.where.mockResolvedValueOnce(mockCount);

      const result = await inventoryQueries.getMovements({
        productId: 'prod-456',
        warehouseId: 'wh-001',
        movementType: 'adjustment'
      });

      expect(db.where).toHaveBeenCalled();
      expect(result.data).toHaveLength(0);
    });
  });

  describe('getReorderSuggestions', () => {
    it('should return items below reorder point', async () => {
      const mockSuggestions = [
        {
          id: 'inv-123',
          productId: 'prod-456',
          warehouseId: 'wh-001',
          quantityOnHand: 30,
          quantityAvailable: 30,
          reorderPoint: 50,
          reorderQuantity: 100,
          averageCost: 10.50,
          productSku: 'TEST-001',
          productName: 'Test Product',
          productCategory: 'electronics',
          supplierName: 'Test Supplier Co',
          supplierId: 'sup-001'
        }
      ];

      db.orderBy.mockResolvedValueOnce(mockSuggestions);

      const result = await inventoryQueries.getReorderSuggestions();

      expect(result).toHaveLength(1);
      expect(result[0].quantityAvailable).toBeLessThanOrEqual(result[0].reorderPoint);
      expect(db.where).toHaveBeenCalled();
    });

    it('should return empty array when no reorders needed', async () => {
      db.orderBy.mockResolvedValueOnce([]);

      const result = await inventoryQueries.getReorderSuggestions();

      expect(result).toHaveLength(0);
    });
  });

  describe('getInventoryAnalytics', () => {
    it('should return comprehensive inventory analytics', async () => {
      const mockMetrics = [{
        totalItems: '500',
        totalValue: '50000.00',
        totalOnHand: '10000',
        totalReserved: '500',
        totalAvailable: '9500',
        itemsBelowReorder: '25',
        itemsOutOfStock: '5'
      }];

      const mockCategoryBreakdown = [
        { category: 'electronics', itemCount: '100', totalValue: '20000.00', totalQuantity: '2000' },
        { category: 'hardware', itemCount: '200', totalValue: '15000.00', totalQuantity: '3000' }
      ];

      const mockStockStatus = [
        { stockStatus: 'in_stock', count: '450', totalValue: '45000.00' },
        { stockStatus: 'low_stock', count: '25', totalValue: '3000.00' },
        { stockStatus: 'out_of_stock', count: '5', totalValue: '0.00' }
      ];

      db.where
        .mockResolvedValueOnce(mockMetrics)
        .mockResolvedValueOnce(mockCategoryBreakdown)
        .mockResolvedValueOnce(mockStockStatus);

      const result = await inventoryQueries.getInventoryAnalytics({
        warehouseId: 'wh-001',
        categoryFilter: null
      });

      expect(result).toHaveProperty('summary');
      expect(result).toHaveProperty('categoryBreakdown');
      expect(result).toHaveProperty('stockStatusBreakdown');
      expect(result.summary.totalItems).toBe('500');
      expect(result.categoryBreakdown).toHaveLength(2);
      expect(result.stockStatusBreakdown).toHaveLength(3);
    });
  });

  describe('getAdvancedInventoryAnalytics', () => {
    it('should return turnover analysis', async () => {
      const mockTurnoverData = [
        {
          productId: 'prod-456',
          productSku: 'TEST-001',
          productName: 'Test Product',
          category: 'electronics',
          currentStock: 100,
          averageCost: 10.50,
          totalSold: 50,
          turnoverRatio: 0.5,
          daysOfInventory: 730
        }
      ];

      db.orderBy.mockResolvedValueOnce(mockTurnoverData);

      const result = await inventoryQueries.getAdvancedInventoryAnalytics({
        analysisType: 'turnover',
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31'
      });

      expect(result).toHaveProperty('turnoverAnalysis');
      expect(result.turnoverAnalysis).toHaveLength(1);
      expect(result.turnoverAnalysis[0].turnoverRatio).toBe(0.5);
    });

    it('should return aging analysis', async () => {
      const mockAgingData = [
        {
          productId: 'prod-456',
          agingCategory: 'Fresh (0-30 days)',
          riskLevel: 'Low',
          daysSinceLastReceived: 15
        }
      ];

      const mockAgingSummary = [
        { agingCategory: 'Fresh (0-30 days)', itemCount: '100', totalValue: '10000.00' }
      ];

      db.orderBy.mockResolvedValueOnce(mockAgingData);
      db.groupBy.mockResolvedValueOnce(mockAgingSummary);

      const result = await inventoryQueries.getAdvancedInventoryAnalytics({
        analysisType: 'aging'
      });

      expect(result).toHaveProperty('agingAnalysis');
      expect(result.agingAnalysis.details).toHaveLength(1);
      expect(result.agingAnalysis.summary).toHaveLength(1);
    });

    it('should return trend analysis', async () => {
      const mockDailyTrends = [
        {
          date: '2024-01-15',
          inboundMovements: 5,
          outboundMovements: 10,
          totalInbound: 100,
          totalOutbound: 150,
          netMovement: -50
        }
      ];

      const mockCategoryTrends = [
        {
          category: 'electronics',
          totalMovements: 15,
          inboundQuantity: 100,
          outboundQuantity: 150,
          netQuantity: -50
        }
      ];

      db.orderBy
        .mockResolvedValueOnce(mockDailyTrends)
        .mockResolvedValueOnce(mockCategoryTrends);

      const result = await inventoryQueries.getAdvancedInventoryAnalytics({
        analysisType: 'trends'
      });

      expect(result).toHaveProperty('trendAnalysis');
      expect(result.trendAnalysis.dailyTrends).toHaveLength(1);
      expect(result.trendAnalysis.categoryTrends).toHaveLength(1);
    });
  });

  describe('adjustStock', () => {
    it('should adjust stock and record movement', async () => {
      jest.spyOn(inventoryQueries, 'getInventoryById').mockResolvedValueOnce(mockInventory);
      jest.spyOn(inventoryQueries, 'recordMovement').mockResolvedValueOnce({
        movement: mockMovement,
        inventory: { ...mockInventory, quantityOnHand: 120 }
      });

      const result = await inventoryQueries.adjustStock(
        'inv-123',
        120, // New quantity
        'Annual count adjustment',
        'user-001',
        'Physical count variance'
      );

      expect(result.quantityOnHand).toBe(120);
      expect(inventoryQueries.recordMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          movementType: 'adjustment_in',
          quantity: 20, // 120 - 100
          referenceType: 'stock_adjustment'
        })
      );
    });

    it('should handle negative adjustments', async () => {
      jest.spyOn(inventoryQueries, 'getInventoryById').mockResolvedValueOnce(mockInventory);
      jest.spyOn(inventoryQueries, 'recordMovement').mockResolvedValueOnce({
        movement: mockMovement,
        inventory: { ...mockInventory, quantityOnHand: 80 }
      });

      const result = await inventoryQueries.adjustStock(
        'inv-123',
        80, // New quantity (decrease)
        'Damaged goods removal',
        'user-001'
      );

      expect(inventoryQueries.recordMovement).toHaveBeenCalledWith(
        expect.objectContaining({
          movementType: 'adjustment_out',
          quantity: -20 // 80 - 100
        })
      );
    });

    it('should return current inventory if no adjustment needed', async () => {
      jest.spyOn(inventoryQueries, 'getInventoryById').mockResolvedValueOnce(mockInventory);

      const result = await inventoryQueries.adjustStock(
        'inv-123',
        100, // Same quantity
        'No change needed',
        'user-001'
      );

      expect(result).toEqual(mockInventory);
      expect(inventoryQueries.recordMovement).not.toHaveBeenCalled();
    });

    it('should throw error if inventory not found', async () => {
      jest.spyOn(inventoryQueries, 'getInventoryById').mockResolvedValueOnce(null);

      await expect(
        inventoryQueries.adjustStock('non-existent', 100, 'test', 'user-001')
      ).rejects.toThrow('Inventory record not found');
    });
  });

  describe('Edge Cases and Error Handling', () => {
    it('should handle database connection errors gracefully', async () => {
      db.limit.mockRejectedValueOnce(new Error('Database connection failed'));

      await expect(inventoryQueries.getInventoryById('inv-123'))
        .rejects.toThrow('Database connection failed');
    });

    it('should handle malformed data gracefully', async () => {
      const invalidMovementData = {
        inventoryId: null,
        movementType: 'invalid_type',
        quantity: 'not_a_number'
      };

      const mockTransaction = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([])
      };

      db.transaction.mockImplementation(async (callback) => {
        return await callback(mockTransaction);
      });

      await expect(inventoryQueries.recordMovement(invalidMovementData))
        .rejects.toThrow('Inventory record not found');
    });

    it('should handle concurrent stock updates', async () => {
      const mockTransaction = {
        select: jest.fn().mockReturnThis(),
        from: jest.fn().mockReturnThis(),
        where: jest.fn().mockReturnThis(),
        limit: jest.fn().mockResolvedValueOnce([mockInventory])
      };

      db.transaction.mockRejectedValueOnce(new Error('Serialization failure'));

      await expect(
        inventoryQueries.reserveStock('prod-456', 'wh-001', 10)
      ).rejects.toThrow('Serialization failure');
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });
});