import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import {
  getSuppliersService,
  getSupplierByIdService,
  createSupplierService,
  updateSupplierService,
  deactivateSupplierService,
  getSupplierPerformanceService,
  processPurchaseReceiptService,
  bulkUpdateSuppliersService,
  getSupplierSystemStatisticsService
} from '../supplier.service.js';

// Mock the database queries
jest.mock('../../db/supplier-queries.js', () => ({
  getSuppliers: jest.fn(),
  getSupplierById: jest.fn(),
  getSupplierByCode: jest.fn(),
  createSupplier: jest.fn(),
  updateSupplier: jest.fn(),
  deactivateSupplier: jest.fn(),
  getSupplierWithPriceLists: jest.fn(),
  getSuppliersWithPendingPriceLists: jest.fn(),
  bulkUpdateSuppliers: jest.fn(),
  supplierExistsByEmail: jest.fn(),
  getSupplierStatistics: jest.fn(),
  getSupplierWithInventory: jest.fn(),
  updateInventoryOnPurchaseReceipt: jest.fn(),
  getSupplierLeadTimes: jest.fn(),
  getSupplierReorderSuggestions: jest.fn()
}));

jest.mock('../../db/price-list-queries.js', () => ({
  getPriceLists: jest.fn(),
  getPriceListById: jest.fn(),
  createPriceList: jest.fn(),
  createPriceListItems: jest.fn(),
  activatePriceList: jest.fn(),
  updatePriceListStatus: jest.fn(),
  deletePriceList: jest.fn(),
  getSupplierPrice: jest.fn(),
  getBulkSupplierPrices: jest.fn(),
  getSupplierPriceHistory: jest.fn(),
  getPriceListStatistics: jest.fn()
}));

describe('SupplierService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getSuppliersService', () => {
    test('should return suppliers with basic parameters', async () => {
      const mockResult = {
        suppliers: [
          { id: '1', supplierCode: 'SUP001', companyName: 'Test Supplier 1' },
          { id: '2', supplierCode: 'SUP002', companyName: 'Test Supplier 2' }
        ],
        totalCount: 2,
        page: 1,
        totalPages: 1
      };

      const { getSuppliers } = await import('../../db/supplier-queries.js');
      getSuppliers.mockResolvedValue(mockResult);

      const result = await getSuppliersService({
        page: 1,
        limit: 10
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockResult);
      expect(getSuppliers).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        search: '',
        isActive: null,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });
    });

    test('should include statistics when requested', async () => {
      const mockResult = {
        suppliers: [{ id: '1', supplierCode: 'SUP001', companyName: 'Test Supplier' }],
        totalCount: 1
      };

      const mockLeadTimes = [
        { productId: 'prod-1', averageLeadTime: 7, totalDeliveries: 10 },
        { productId: 'prod-2', averageLeadTime: 14, totalDeliveries: 5 }
      ];

      const mockReorderSuggestions = [
        { productId: 'prod-1', needsReorder: true },
        { productId: 'prod-2', needsReorder: false }
      ];

      const { getSuppliers, getSupplierLeadTimes, getSupplierReorderSuggestions } = await import('../../db/supplier-queries.js');
      getSuppliers.mockResolvedValue(mockResult);
      getSupplierLeadTimes.mockResolvedValue(mockLeadTimes);
      getSupplierReorderSuggestions.mockResolvedValue(mockReorderSuggestions);

      const result = await getSuppliersService({
        includeStatistics: true
      });

      expect(result.success).toBe(true);
      expect(result.data.suppliers[0].statistics).toBeDefined();
      expect(result.data.suppliers[0].statistics.totalProducts).toBe(2);
      expect(result.data.suppliers[0].statistics.itemsNeedingReorder).toBe(2);
      expect(result.data.suppliers[0].statistics.averageLeadTime).toBe(10.5);
    });

    test('should handle service errors gracefully', async () => {
      const { getSuppliers } = await import('../../db/supplier-queries.js');
      getSuppliers.mockRejectedValue(new Error('Database connection failed'));

      const result = await getSuppliersService();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });
  });

  describe('getSupplierByIdService', () => {
    test('should return supplier by ID', async () => {
      const mockSupplier = {
        id: 'supplier-123',
        supplierCode: 'SUP001',
        companyName: 'Test Supplier',
        email: 'test@supplier.com',
        isActive: true
      };

      const { getSupplierById } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(mockSupplier);

      const result = await getSupplierByIdService('supplier-123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSupplier);
    });

    test('should return error when supplier not found', async () => {
      const { getSupplierById } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(null);

      const result = await getSupplierByIdService('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier not found');
    });

    test('should include performance metrics when requested', async () => {
      const mockSupplier = { id: 'supplier-123', companyName: 'Test Supplier' };
      const mockLeadTimes = [
        { averageLeadTime: 7, totalDeliveries: 10 },
        { averageLeadTime: 14, totalDeliveries: 5 }
      ];

      const { getSupplierById, getSupplierLeadTimes } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(mockSupplier);
      getSupplierLeadTimes.mockResolvedValue(mockLeadTimes);

      const result = await getSupplierByIdService('supplier-123', {
        includePerformance: true
      });

      expect(result.success).toBe(true);
      expect(result.data.performanceMetrics).toBeDefined();
      expect(result.data.performanceMetrics.averageLeadTime).toBe(10.5);
      expect(result.data.performanceMetrics.totalProducts).toBe(2);
    });
  });

  describe('createSupplierService', () => {
    test('should create supplier with valid data', async () => {
      const mockSupplier = {
        id: 'supplier-123',
        supplierCode: 'SUP001',
        companyName: 'Test Supplier',
        email: 'test@supplier.com',
        isActive: true
      };

      const { supplierExistsByEmail, getSupplierByCode, createSupplier } = await import('../../db/supplier-queries.js');
      supplierExistsByEmail.mockResolvedValue(false);
      getSupplierByCode.mockResolvedValue(null);
      createSupplier.mockResolvedValue(mockSupplier);

      const supplierData = {
        supplierCode: 'SUP001',
        companyName: 'Test Supplier',
        email: 'test@supplier.com'
      };

      const result = await createSupplierService(supplierData, 'user-123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSupplier);
      expect(createSupplier).toHaveBeenCalledWith(
        expect.objectContaining({
          supplierCode: 'SUP001',
          companyName: 'Test Supplier',
          email: 'test@supplier.com',
          isActive: true,
          createdBy: 'user-123'
        })
      );
    });

    test('should validate required fields', async () => {
      const result = await createSupplierService({
        companyName: 'Test Supplier'
        // Missing supplierCode and email
      }, 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('supplierCode is required');
    });

    test('should check for duplicate email', async () => {
      const { supplierExistsByEmail } = await import('../../db/supplier-queries.js');
      supplierExistsByEmail.mockResolvedValue(true);

      const supplierData = {
        supplierCode: 'SUP001',
        companyName: 'Test Supplier',
        email: 'existing@supplier.com'
      };

      const result = await createSupplierService(supplierData, 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Email already exists');
    });

    test('should check for duplicate supplier code', async () => {
      const { supplierExistsByEmail, getSupplierByCode } = await import('../../db/supplier-queries.js');
      supplierExistsByEmail.mockResolvedValue(false);
      getSupplierByCode.mockResolvedValue({ id: 'existing', supplierCode: 'SUP001' });

      const supplierData = {
        supplierCode: 'SUP001',
        companyName: 'Test Supplier',
        email: 'test@supplier.com'
      };

      const result = await createSupplierService(supplierData, 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier code already exists');
    });
  });

  describe('updateSupplierService', () => {
    test('should update supplier with valid data', async () => {
      const existingSupplier = {
        id: 'supplier-123',
        supplierCode: 'SUP001',
        companyName: 'Old Company',
        email: 'old@supplier.com'
      };

      const updatedSupplier = {
        ...existingSupplier,
        companyName: 'Updated Company'
      };

      const { getSupplierById, updateSupplier } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(existingSupplier);
      updateSupplier.mockResolvedValue(updatedSupplier);

      const result = await updateSupplierService('supplier-123', {
        companyName: 'Updated Company'
      }, 'user-123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(updatedSupplier);
    });

    test('should validate email updates for duplicates', async () => {
      const existingSupplier = {
        id: 'supplier-123',
        email: 'old@supplier.com'
      };

      const { getSupplierById, supplierExistsByEmail } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(existingSupplier);
      supplierExistsByEmail.mockResolvedValue(true);

      const result = await updateSupplierService('supplier-123', {
        email: 'existing@supplier.com'
      }, 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Email already exists');
    });

    test('should fail when supplier not found', async () => {
      const { getSupplierById } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(null);

      const result = await updateSupplierService('nonexistent', {
        companyName: 'Updated Company'
      }, 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier not found');
    });
  });

  describe('deactivateSupplierService', () => {
    test('should deactivate supplier successfully', async () => {
      const existingSupplier = {
        id: 'supplier-123',
        isActive: true,
        companyName: 'Test Supplier'
      };

      const deactivatedSupplier = {
        ...existingSupplier,
        isActive: false
      };

      const { getSupplierById, getSupplierWithPriceLists, deactivateSupplier } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(existingSupplier);
      getSupplierWithPriceLists.mockResolvedValue({ priceLists: [] });
      deactivateSupplier.mockResolvedValue(deactivatedSupplier);

      const result = await deactivateSupplierService('supplier-123', 'user-123', 'No longer needed');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(deactivatedSupplier);
    });

    test('should prevent deactivation when active price lists exist', async () => {
      const existingSupplier = { id: 'supplier-123', isActive: true };
      const activePriceLists = [
        { id: 'pl-1', status: 'active' },
        { id: 'pl-2', status: 'active' }
      ];

      const { getSupplierById, getSupplierWithPriceLists } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(existingSupplier);
      getSupplierWithPriceLists.mockResolvedValue({ priceLists: activePriceLists });

      const result = await deactivateSupplierService('supplier-123', 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot deactivate supplier with active price lists');
      expect(result.data.activePriceLists).toBe(2);
    });

    test('should fail when supplier already inactive', async () => {
      const existingSupplier = { id: 'supplier-123', isActive: false };

      const { getSupplierById } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(existingSupplier);

      const result = await deactivateSupplierService('supplier-123', 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier already inactive');
    });
  });

  describe('getSupplierPerformanceService', () => {
    test('should return comprehensive performance metrics', async () => {
      const mockSupplier = {
        id: 'supplier-123',
        supplierCode: 'SUP001',
        companyName: 'Test Supplier'
      };

      const mockLeadTimes = [
        { productId: 'prod-1', averageLeadTime: 7, minLeadTime: 5, maxLeadTime: 10, totalDeliveries: 10 },
        { productId: 'prod-2', averageLeadTime: 14, minLeadTime: 10, maxLeadTime: 21, totalDeliveries: 5 }
      ];

      const mockReorderSuggestions = [
        { productId: 'prod-1', needsReorder: true, totalReorderQuantity: 100, lastPurchaseCost: 10 },
        { productId: 'prod-2', needsReorder: false, totalReorderQuantity: 0, lastPurchaseCost: 5 }
      ];

      const mockPriceListStats = {
        activePriceLists: 2,
        pendingPriceLists: 1,
        totalProducts: 50
      };

      const {
        getSupplierById,
        getSupplierLeadTimes,
        getSupplierReorderSuggestions
      } = await import('../../db/supplier-queries.js');
      
      const { getPriceListStatistics } = await import('../../db/price-list-queries.js');

      getSupplierById.mockResolvedValue(mockSupplier);
      getSupplierLeadTimes.mockResolvedValue(mockLeadTimes);
      getSupplierReorderSuggestions.mockResolvedValue(mockReorderSuggestions);
      getPriceListStatistics.mockResolvedValue(mockPriceListStats);

      const result = await getSupplierPerformanceService('supplier-123');

      expect(result.success).toBe(true);
      expect(result.data.supplier.id).toBe('supplier-123');
      expect(result.data.leadTimeMetrics.totalProducts).toBe(2);
      expect(result.data.leadTimeMetrics.averageLeadTime).toBe(10.5);
      expect(result.data.inventoryMetrics.itemsNeedingReorder).toBe(1);
      expect(result.data.inventoryMetrics.totalValueAtRisk).toBe(1000);
      expect(result.data.overallScore).toBeDefined();
      expect(result.data.overallScore.overall).toBeGreaterThanOrEqual(0);
      expect(result.data.overallScore.overall).toBeLessThanOrEqual(100);
    });

    test('should handle supplier not found', async () => {
      const { getSupplierById } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(null);

      const result = await getSupplierPerformanceService('nonexistent');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier not found');
    });
  });

  describe('processPurchaseReceiptService', () => {
    test('should process purchase receipt successfully', async () => {
      const mockSupplier = {
        id: 'supplier-123',
        companyName: 'Test Supplier'
      };

      const mockMovements = [
        { productId: 'prod-1', warehouseId: 'wh-1', quantity: 10, unitCost: 5 },
        { productId: 'prod-2', warehouseId: 'wh-1', quantity: 20, unitCost: 3 }
      ];

      const { getSupplierById, updateInventoryOnPurchaseReceipt } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(mockSupplier);
      updateInventoryOnPurchaseReceipt.mockResolvedValue(mockMovements);

      const receiptData = {
        supplierId: 'supplier-123',
        purchaseOrderNumber: 'PO-001',
        items: [
          { productId: 'prod-1', warehouseId: 'wh-1', quantity: 10, unitCost: 5 },
          { productId: 'prod-2', warehouseId: 'wh-1', quantity: 20, unitCost: 3 }
        ]
      };

      const result = await processPurchaseReceiptService(receiptData, 'user-123');

      expect(result.success).toBe(true);
      expect(result.data.totalItems).toBe(2);
      expect(result.data.totalQuantity).toBe(30);
      expect(result.data.totalValue).toBe(110);
      expect(result.data.movements).toEqual(mockMovements);
    });

    test('should validate supplier exists', async () => {
      const { getSupplierById } = await import('../../db/supplier-queries.js');
      getSupplierById.mockResolvedValue(null);

      const receiptData = {
        supplierId: 'nonexistent',
        items: [{ productId: 'prod-1', quantity: 10, unitCost: 5 }]
      };

      const result = await processPurchaseReceiptService(receiptData, 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier not found');
    });

    test('should validate items are provided', async () => {
      const receiptData = {
        supplierId: 'supplier-123',
        items: []
      };

      const result = await processPurchaseReceiptService(receiptData, 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No items provided');
    });
  });

  describe('bulkUpdateSuppliersService', () => {
    test('should process bulk updates successfully', async () => {
      const mockUpdatedSupplier1 = { id: 'supplier-1', companyName: 'Updated Supplier 1' };
      const mockUpdatedSupplier2 = { id: 'supplier-2', companyName: 'Updated Supplier 2' };

      const { getSupplierById, updateSupplier } = await import('../../db/supplier-queries.js');
      
      // Mock successful updates
      getSupplierById
        .mockResolvedValueOnce({ id: 'supplier-1', companyName: 'Old Supplier 1' })
        .mockResolvedValueOnce({ id: 'supplier-2', companyName: 'Old Supplier 2' });
      
      updateSupplier
        .mockResolvedValueOnce(mockUpdatedSupplier1)
        .mockResolvedValueOnce(mockUpdatedSupplier2);

      const updates = [
        { id: 'supplier-1', data: { companyName: 'Updated Supplier 1' } },
        { id: 'supplier-2', data: { companyName: 'Updated Supplier 2' } }
      ];

      const result = await bulkUpdateSuppliersService(updates, 'user-123');

      expect(result.success).toBe(true);
      expect(result.data.summary.total).toBe(2);
      expect(result.data.summary.successful).toBe(2);
      expect(result.data.summary.failed).toBe(0);
    });

    test('should handle partial failures in bulk updates', async () => {
      const mockUpdatedSupplier = { id: 'supplier-1', companyName: 'Updated Supplier 1' };

      const { getSupplierById, updateSupplier } = await import('../../db/supplier-queries.js');
      
      // First update succeeds, second fails
      getSupplierById
        .mockResolvedValueOnce({ id: 'supplier-1', companyName: 'Old Supplier 1' })
        .mockResolvedValueOnce(null); // Supplier not found
      
      updateSupplier.mockResolvedValueOnce(mockUpdatedSupplier);

      const updates = [
        { id: 'supplier-1', data: { companyName: 'Updated Supplier 1' } },
        { id: 'supplier-2', data: { companyName: 'Updated Supplier 2' } }
      ];

      const result = await bulkUpdateSuppliersService(updates, 'user-123');

      expect(result.success).toBe(false);
      expect(result.data.summary.successful).toBe(1);
      expect(result.data.summary.failed).toBe(1);
      expect(result.data.errors).toHaveLength(1);
    });

    test('should validate updates array', async () => {
      const result = await bulkUpdateSuppliersService([], 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No updates provided');
    });
  });

  describe('getSupplierSystemStatisticsService', () => {
    test('should return comprehensive system statistics', async () => {
      const mockStats = {
        totalSuppliers: 100,
        activeSuppliers: 85,
        totalPriceLists: 200,
        pendingPriceLists: 15
      };

      const mockPendingSuppliers = [
        { id: 'supplier-1' },
        { id: 'supplier-2' }
      ];

      const { getSupplierStatistics, getSuppliersWithPendingPriceLists } = await import('../../db/supplier-queries.js');
      getSupplierStatistics.mockResolvedValue(mockStats);
      getSuppliersWithPendingPriceLists.mockResolvedValue(mockPendingSuppliers);

      const result = await getSupplierSystemStatisticsService();

      expect(result.success).toBe(true);
      expect(result.data.totalSuppliers).toBe(100);
      expect(result.data.activeSuppliers).toBe(85);
      expect(result.data.suppliersWithPendingPriceLists).toBe(2);
      expect(result.data.systemHealth.activeSupplierRatio).toBe(0.85);
      expect(result.data.systemHealth.priceListCoverageRatio).toBeCloseTo(2.18, 2);
    });

    test('should handle zero divisions in health metrics', async () => {
      const mockStats = {
        totalSuppliers: 0,
        activeSuppliers: 0,
        totalPriceLists: 0,
        pendingPriceLists: 0
      };

      const { getSupplierStatistics, getSuppliersWithPendingPriceLists } = await import('../../db/supplier-queries.js');
      getSupplierStatistics.mockResolvedValue(mockStats);
      getSuppliersWithPendingPriceLists.mockResolvedValue([]);

      const result = await getSupplierSystemStatisticsService();

      expect(result.success).toBe(true);
      expect(result.data.systemHealth.activeSupplierRatio).toBe(0);
      expect(result.data.systemHealth.priceListCoverageRatio).toBe(0);
    });
  });

  describe('edge cases and error handling', () => {
    test('should handle database errors gracefully', async () => {
      const { getSupplierById } = await import('../../db/supplier-queries.js');
      getSupplierById.mockRejectedValue(new Error('Database connection failed'));

      const result = await getSupplierByIdService('supplier-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });

    test('should handle malformed supplier data in creation', async () => {
      const result = await createSupplierService({
        supplierCode: '',
        companyName: null,
        email: undefined
      }, 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('supplierCode is required');
    });

    test('should handle concurrent supplier code conflicts', async () => {
      const { supplierExistsByEmail, getSupplierByCode, createSupplier } = await import('../../db/supplier-queries.js');
      
      // Validation passes but creation fails due to race condition
      supplierExistsByEmail.mockResolvedValue(false);
      getSupplierByCode.mockResolvedValue(null);
      createSupplier.mockRejectedValue(new Error('Supplier code already exists'));

      const result = await createSupplierService({
        supplierCode: 'SUP001',
        companyName: 'Test Supplier',
        email: 'test@supplier.com'
      }, 'user-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier code already exists');
    });

    test('should handle missing performance data gracefully', async () => {
      const mockSupplier = { id: 'supplier-123', supplierCode: 'SUP001', companyName: 'Test Supplier' };

      const {
        getSupplierById,
        getSupplierLeadTimes,
        getSupplierReorderSuggestions
      } = await import('../../db/supplier-queries.js');
      
      const { getPriceListStatistics } = await import('../../db/price-list-queries.js');

      getSupplierById.mockResolvedValue(mockSupplier);
      getSupplierLeadTimes.mockResolvedValue([]);
      getSupplierReorderSuggestions.mockResolvedValue([]);
      getPriceListStatistics.mockResolvedValue({});

      const result = await getSupplierPerformanceService('supplier-123');

      expect(result.success).toBe(true);
      expect(result.data.leadTimeMetrics.averageLeadTime).toBeNull();
      expect(result.data.leadTimeMetrics.totalProducts).toBe(0);
      expect(result.data.inventoryMetrics.itemsNeedingReorder).toBe(0);
    });
  });
});