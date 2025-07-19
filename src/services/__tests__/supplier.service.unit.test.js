/**
 * Comprehensive Unit Tests for Supplier Service
 * Testing all supplier service methods with various scenarios
 */

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

import * as supplierQueries from '../../db/supplier-queries.js';
import * as priceListQueries from '../../db/price-list-queries.js';

// Mock all database queries
jest.mock('../../db/supplier-queries.js');
jest.mock('../../db/price-list-queries.js');
jest.mock('../../utils/file-parsers/index.js');

describe('Supplier Service Unit Tests', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== GET SUPPLIERS TESTS ====================
  
  describe('getSuppliersService', () => {
    const mockSuppliersResult = {
      suppliers: [
        { id: 1, supplierCode: 'SUP001', companyName: 'Supplier One', isActive: true },
        { id: 2, supplierCode: 'SUP002', companyName: 'Supplier Two', isActive: true }
      ],
      totalCount: 2,
      page: 1,
      limit: 10
    };

    test('should retrieve suppliers with basic parameters', async () => {
      supplierQueries.getSuppliers.mockResolvedValue(mockSuppliersResult);

      const result = await getSuppliersService({ page: 1, limit: 10 });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSuppliersResult);
      expect(result.message).toBe('Retrieved 2 suppliers');
      expect(supplierQueries.getSuppliers).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        search: '',
        isActive: null,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });
    });

    test('should use default parameters when none provided', async () => {
      supplierQueries.getSuppliers.mockResolvedValue(mockSuppliersResult);

      const result = await getSuppliersService();

      expect(result.success).toBe(true);
      expect(supplierQueries.getSuppliers).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        search: '',
        isActive: null,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });
    });

    test('should include statistics when requested', async () => {
      supplierQueries.getSuppliers.mockResolvedValue(mockSuppliersResult);
      supplierQueries.getSupplierReorderSuggestions.mockResolvedValue([
        { productId: 'PROD001', needsReorder: true }
      ]);
      supplierQueries.getSupplierLeadTimes.mockResolvedValue([
        { productId: 'PROD001', averageLeadTime: 15, totalDeliveries: 10 }
      ]);

      const result = await getSuppliersService({ includeStatistics: true });

      expect(result.success).toBe(true);
      expect(result.data.suppliers[0]).toHaveProperty('statistics');
      expect(result.data.suppliers[0].statistics).toEqual({
        totalProducts: 1,
        itemsNeedingReorder: 1,
        averageLeadTime: 15,
        totalDeliveries: 10
      });
    });

    test('should include price lists when requested', async () => {
      const mockSupplierWithPriceLists = {
        ...mockSuppliersResult.suppliers[0],
        priceLists: [{ id: 1, status: 'active' }]
      };
      
      supplierQueries.getSuppliers.mockResolvedValue(mockSuppliersResult);
      supplierQueries.getSupplierWithPriceLists.mockResolvedValue(mockSupplierWithPriceLists);

      const result = await getSuppliersService({ includePriceLists: true });

      expect(result.success).toBe(true);
      expect(result.data.suppliers[0]).toHaveProperty('priceLists');
      expect(supplierQueries.getSupplierWithPriceLists).toHaveBeenCalledWith(1);
    });

    test('should handle search parameters', async () => {
      supplierQueries.getSuppliers.mockResolvedValue(mockSuppliersResult);

      const result = await getSuppliersService({
        search: 'Supplier One',
        isActive: true,
        sortBy: 'companyName',
        sortOrder: 'asc'
      });

      expect(result.success).toBe(true);
      expect(supplierQueries.getSuppliers).toHaveBeenCalledWith({
        page: 1,
        limit: 10,
        search: 'Supplier One',
        isActive: true,
        sortBy: 'companyName',
        sortOrder: 'asc'
      });
    });

    test('should handle database errors', async () => {
      supplierQueries.getSuppliers.mockRejectedValue(new Error('Database connection failed'));

      const result = await getSuppliersService();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
      expect(result.message).toBe('Failed to retrieve suppliers');
    });
  });

  // ==================== GET SUPPLIER BY ID TESTS ====================

  describe('getSupplierByIdService', () => {
    const mockSupplier = {
      id: 1,
      supplierCode: 'SUP001',
      companyName: 'Test Supplier',
      email: 'test@supplier.com',
      isActive: true
    };

    test('should retrieve supplier by ID successfully', async () => {
      supplierQueries.getSupplierById.mockResolvedValue(mockSupplier);

      const result = await getSupplierByIdService(1);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSupplier);
      expect(result.message).toBe('Supplier retrieved successfully');
      expect(supplierQueries.getSupplierById).toHaveBeenCalledWith(1);
    });

    test('should return error when supplier not found', async () => {
      supplierQueries.getSupplierById.mockResolvedValue(null);

      const result = await getSupplierByIdService(999);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier not found');
      expect(result.message).toBe('No supplier found with ID: 999');
    });

    test('should include inventory when requested', async () => {
      const mockSupplierWithInventory = {
        ...mockSupplier,
        inventory: [{ productId: 'PROD001', quantity: 100 }]
      };
      
      supplierQueries.getSupplierById.mockResolvedValue(mockSupplier);
      supplierQueries.getSupplierWithInventory.mockResolvedValue(mockSupplierWithInventory);

      const result = await getSupplierByIdService(1, { includeInventory: true });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSupplierWithInventory);
      expect(supplierQueries.getSupplierWithInventory).toHaveBeenCalledWith(1);
    });

    test('should include price lists when requested', async () => {
      const mockSupplierWithPriceLists = {
        ...mockSupplier,
        priceLists: [{ id: 1, status: 'active' }]
      };
      
      supplierQueries.getSupplierById.mockResolvedValue(mockSupplier);
      supplierQueries.getSupplierWithPriceLists.mockResolvedValue(mockSupplierWithPriceLists);

      const result = await getSupplierByIdService(1, { includePriceLists: true });

      expect(result.success).toBe(true);
      expect(result.data.priceLists).toEqual(mockSupplierWithPriceLists.priceLists);
    });

    test('should include performance metrics when requested', async () => {
      const mockLeadTimes = [
        { productId: 'PROD001', averageLeadTime: 15, totalDeliveries: 10 }
      ];
      
      supplierQueries.getSupplierById.mockResolvedValue(mockSupplier);
      supplierQueries.getSupplierLeadTimes.mockResolvedValue(mockLeadTimes);

      const result = await getSupplierByIdService(1, { includePerformance: true });

      expect(result.success).toBe(true);
      expect(result.data.performanceMetrics).toEqual({
        leadTimeAnalysis: mockLeadTimes,
        averageLeadTime: 15,
        totalProducts: 1,
        totalDeliveries: 10
      });
    });

    test('should include reorder suggestions when requested', async () => {
      const mockReorderSuggestions = [
        { productId: 'PROD001', needsReorder: true, suggestedQuantity: 50 }
      ];
      
      supplierQueries.getSupplierById.mockResolvedValue(mockSupplier);
      supplierQueries.getSupplierReorderSuggestions.mockResolvedValue(mockReorderSuggestions);

      const result = await getSupplierByIdService(1, { includeReorderSuggestions: true });

      expect(result.success).toBe(true);
      expect(result.data.reorderSuggestions).toEqual(mockReorderSuggestions);
    });

    test('should handle database errors', async () => {
      supplierQueries.getSupplierById.mockRejectedValue(new Error('Database error'));

      const result = await getSupplierByIdService(1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
      expect(result.message).toBe('Failed to retrieve supplier');
    });
  });

  // ==================== CREATE SUPPLIER TESTS ====================

  describe('createSupplierService', () => {
    const validSupplierData = {
      supplierCode: 'SUP001',
      companyName: 'Test Supplier Ltd',
      email: 'test@supplier.com',
      phone: '+1234567890',
      contactDetails: {
        address: '123 Supplier St',
        city: 'Supplier City'
      },
      paymentTerms: {
        net: 30,
        currency: 'USD'
      }
    };

    test('should create supplier successfully with valid data', async () => {
      const mockCreatedSupplier = { id: 1, ...validSupplierData, isActive: true };
      
      supplierQueries.supplierExistsByEmail.mockResolvedValue(false);
      supplierQueries.getSupplierByCode.mockResolvedValue(null);
      supplierQueries.createSupplier.mockResolvedValue(mockCreatedSupplier);

      const result = await createSupplierService(validSupplierData, 'user123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockCreatedSupplier);
      expect(result.message).toBe('Supplier created successfully');
      expect(supplierQueries.createSupplier).toHaveBeenCalledWith(
        expect.objectContaining({
          ...validSupplierData,
          isActive: true,
          createdBy: 'user123'
        })
      );
    });

    test('should fail when required fields are missing', async () => {
      const invalidData = { companyName: 'Test Supplier' };

      const result = await createSupplierService(invalidData, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('supplierCode is required');
      expect(result.message).toBe('Validation failed');
      expect(supplierQueries.createSupplier).not.toHaveBeenCalled();
    });

    test('should fail when email already exists', async () => {
      supplierQueries.supplierExistsByEmail.mockResolvedValue(true);

      const result = await createSupplierService(validSupplierData, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Email already exists');
      expect(result.message).toBe(`A supplier with email ${validSupplierData.email} already exists`);
      expect(supplierQueries.createSupplier).not.toHaveBeenCalled();
    });

    test('should fail when supplier code already exists', async () => {
      supplierQueries.supplierExistsByEmail.mockResolvedValue(false);
      supplierQueries.getSupplierByCode.mockResolvedValue({ id: 1, supplierCode: 'SUP001' });

      const result = await createSupplierService(validSupplierData, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier code already exists');
      expect(result.message).toBe(`A supplier with code ${validSupplierData.supplierCode} already exists`);
      expect(supplierQueries.createSupplier).not.toHaveBeenCalled();
    });

    test('should set default values when not provided', async () => {
      const minimalData = {
        supplierCode: 'SUP001',
        companyName: 'Test Supplier',
        email: 'test@supplier.com'
      };
      
      supplierQueries.supplierExistsByEmail.mockResolvedValue(false);
      supplierQueries.getSupplierByCode.mockResolvedValue(null);
      supplierQueries.createSupplier.mockResolvedValue({ id: 1, ...minimalData });

      const result = await createSupplierService(minimalData, 'user123');

      expect(result.success).toBe(true);
      expect(supplierQueries.createSupplier).toHaveBeenCalledWith(
        expect.objectContaining({
          ...minimalData,
          isActive: true,
          contactDetails: {},
          paymentTerms: {},
          createdBy: 'user123'
        })
      );
    });

    test('should handle database errors', async () => {
      supplierQueries.supplierExistsByEmail.mockResolvedValue(false);
      supplierQueries.getSupplierByCode.mockResolvedValue(null);
      supplierQueries.createSupplier.mockRejectedValue(new Error('Database constraint violation'));

      const result = await createSupplierService(validSupplierData, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database constraint violation');
      expect(result.message).toBe('Failed to create supplier');
    });
  });

  // ==================== UPDATE SUPPLIER TESTS ====================

  describe('updateSupplierService', () => {
    const mockExistingSupplier = {
      id: 1,
      supplierCode: 'SUP001',
      companyName: 'Old Supplier Name',
      email: 'old@supplier.com',
      isActive: true
    };

    test('should update supplier successfully', async () => {
      const updateData = { companyName: 'New Supplier Name' };
      const mockUpdatedSupplier = { ...mockExistingSupplier, ...updateData };
      
      supplierQueries.getSupplierById.mockResolvedValue(mockExistingSupplier);
      supplierQueries.updateSupplier.mockResolvedValue(mockUpdatedSupplier);

      const result = await updateSupplierService(1, updateData, 'user123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedSupplier);
      expect(result.message).toBe('Supplier updated successfully');
      expect(supplierQueries.updateSupplier).toHaveBeenCalledWith(1, {
        ...updateData,
        updatedBy: 'user123'
      });
    });

    test('should fail when supplier does not exist', async () => {
      supplierQueries.getSupplierById.mockResolvedValue(null);

      const result = await updateSupplierService(999, { companyName: 'New Name' }, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier not found');
      expect(result.message).toBe('No supplier found with ID: 999');
      expect(supplierQueries.updateSupplier).not.toHaveBeenCalled();
    });

    test('should validate email uniqueness when updating email', async () => {
      supplierQueries.getSupplierById.mockResolvedValue(mockExistingSupplier);
      supplierQueries.supplierExistsByEmail.mockResolvedValue(true);

      const result = await updateSupplierService(1, { email: 'new@supplier.com' }, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Email already exists');
      expect(result.message).toBe('A supplier with email new@supplier.com already exists');
      expect(supplierQueries.updateSupplier).not.toHaveBeenCalled();
    });

    test('should allow updating to same email', async () => {
      const updateData = { email: 'old@supplier.com', companyName: 'Updated Name' };
      const mockUpdatedSupplier = { ...mockExistingSupplier, ...updateData };
      
      supplierQueries.getSupplierById.mockResolvedValue(mockExistingSupplier);
      supplierQueries.updateSupplier.mockResolvedValue(mockUpdatedSupplier);

      const result = await updateSupplierService(1, updateData, 'user123');

      expect(result.success).toBe(true);
      expect(supplierQueries.supplierExistsByEmail).not.toHaveBeenCalled();
    });

    test('should validate supplier code uniqueness when updating code', async () => {
      supplierQueries.getSupplierById.mockResolvedValue(mockExistingSupplier);
      supplierQueries.getSupplierByCode.mockResolvedValue({ id: 2, supplierCode: 'SUP002' });

      const result = await updateSupplierService(1, { supplierCode: 'SUP002' }, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier code already exists');
      expect(result.message).toBe('A supplier with code SUP002 already exists');
      expect(supplierQueries.updateSupplier).not.toHaveBeenCalled();
    });

    test('should handle update failure', async () => {
      supplierQueries.getSupplierById.mockResolvedValue(mockExistingSupplier);
      supplierQueries.updateSupplier.mockResolvedValue(null);

      const result = await updateSupplierService(1, { companyName: 'New Name' }, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Update failed');
      expect(result.message).toBe('Failed to update supplier');
    });
  });

  // ==================== DEACTIVATE SUPPLIER TESTS ====================

  describe('deactivateSupplierService', () => {
    const mockActiveSupplier = {
      id: 1,
      supplierCode: 'SUP001',
      companyName: 'Test Supplier',
      isActive: true
    };

    test('should deactivate supplier successfully', async () => {
      const mockDeactivatedSupplier = { ...mockActiveSupplier, isActive: false };
      
      supplierQueries.getSupplierById.mockResolvedValue(mockActiveSupplier);
      supplierQueries.getSupplierWithPriceLists.mockResolvedValue({ 
        ...mockActiveSupplier, 
        priceLists: [] 
      });
      supplierQueries.deactivateSupplier.mockResolvedValue(mockDeactivatedSupplier);

      const result = await deactivateSupplierService(1, 'user123', 'Business closure');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockDeactivatedSupplier);
      expect(result.message).toBe('Supplier deactivated successfully');
      expect(supplierQueries.deactivateSupplier).toHaveBeenCalledWith(1);
    });

    test('should fail when supplier not found', async () => {
      supplierQueries.getSupplierById.mockResolvedValue(null);

      const result = await deactivateSupplierService(999, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier not found');
      expect(result.message).toBe('No supplier found with ID: 999');
      expect(supplierQueries.deactivateSupplier).not.toHaveBeenCalled();
    });

    test('should fail when supplier already inactive', async () => {
      const mockInactiveSupplier = { ...mockActiveSupplier, isActive: false };
      supplierQueries.getSupplierById.mockResolvedValue(mockInactiveSupplier);

      const result = await deactivateSupplierService(1, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier already inactive');
      expect(result.message).toBe('Supplier is already deactivated');
      expect(supplierQueries.deactivateSupplier).not.toHaveBeenCalled();
    });

    test('should fail when supplier has active price lists', async () => {
      supplierQueries.getSupplierById.mockResolvedValue(mockActiveSupplier);
      supplierQueries.getSupplierWithPriceLists.mockResolvedValue({
        ...mockActiveSupplier,
        priceLists: [
          { id: 1, status: 'active' },
          { id: 2, status: 'inactive' }
        ]
      });

      const result = await deactivateSupplierService(1, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Cannot deactivate supplier with active price lists');
      expect(result.message).toBe('Supplier has 1 active price list(s). Please deactivate them first.');
      expect(result.data.activePriceLists).toBe(1);
      expect(supplierQueries.deactivateSupplier).not.toHaveBeenCalled();
    });

    test('should log deactivation reason when provided', async () => {
      const consoleSpy = jest.spyOn(console, 'log').mockImplementation();
      
      supplierQueries.getSupplierById.mockResolvedValue(mockActiveSupplier);
      supplierQueries.getSupplierWithPriceLists.mockResolvedValue({ 
        ...mockActiveSupplier, 
        priceLists: [] 
      });
      supplierQueries.deactivateSupplier.mockResolvedValue({ ...mockActiveSupplier, isActive: false });

      const result = await deactivateSupplierService(1, 'user123', 'Contract expired');

      expect(result.success).toBe(true);
      expect(consoleSpy).toHaveBeenCalledWith('Supplier 1 deactivated by user123. Reason: Contract expired');
      
      consoleSpy.mockRestore();
    });
  });

  // ==================== SUPPLIER PERFORMANCE TESTS ====================

  describe('getSupplierPerformanceService', () => {
    const mockSupplier = {
      id: 1,
      supplierCode: 'SUP001',
      companyName: 'Test Supplier'
    };

    test('should return comprehensive performance metrics', async () => {
      const mockLeadTimes = [
        { productId: 'PROD001', averageLeadTime: 15, totalDeliveries: 10, minLeadTime: 10, maxLeadTime: 20 }
      ];
      const mockReorderSuggestions = [
        { productId: 'PROD001', needsReorder: true, totalReorderQuantity: 50, lastPurchaseCost: 10 }
      ];
      const mockPriceListStats = { activePriceLists: 2, pendingPriceLists: 1 };

      supplierQueries.getSupplierById.mockResolvedValue(mockSupplier);
      supplierQueries.getSupplierLeadTimes.mockResolvedValue(mockLeadTimes);
      supplierQueries.getSupplierReorderSuggestions.mockResolvedValue(mockReorderSuggestions);
      priceListQueries.getPriceListStatistics.mockResolvedValue(mockPriceListStats);

      const result = await getSupplierPerformanceService(1);

      expect(result.success).toBe(true);
      expect(result.data.supplier).toEqual({
        id: 1,
        code: 'SUP001',
        name: 'Test Supplier'
      });
      expect(result.data.leadTimeMetrics).toEqual({
        totalProducts: 1,
        totalDeliveries: 10,
        averageLeadTime: 15,
        minLeadTime: 10,
        maxLeadTime: 20,
        productBreakdown: mockLeadTimes
      });
      expect(result.data.inventoryMetrics).toEqual({
        totalProductsManaged: 1,
        itemsNeedingReorder: 1,
        totalValueAtRisk: 500,
        reorderSuggestions: mockReorderSuggestions
      });
      expect(result.data.priceListMetrics).toEqual(mockPriceListStats);
      expect(result.data.overallScore).toBeDefined();
    });

    test('should fail when supplier not found', async () => {
      supplierQueries.getSupplierById.mockResolvedValue(null);

      const result = await getSupplierPerformanceService(999);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier not found');
      expect(result.message).toBe('No supplier found with ID: 999');
    });

    test('should handle optional parameters', async () => {
      supplierQueries.getSupplierById.mockResolvedValue(mockSupplier);
      supplierQueries.getSupplierLeadTimes.mockResolvedValue([]);
      priceListQueries.getPriceListStatistics.mockResolvedValue({});

      const options = {
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31',
        includeLeadTimes: false,
        includeReorderSuggestions: false
      };

      const result = await getSupplierPerformanceService(1, options);

      expect(result.success).toBe(true);
      expect(result.data.period).toEqual({
        from: '2024-01-01',
        to: '2024-12-31'
      });
      expect(result.data.leadTimeMetrics).toBeUndefined();
      expect(result.data.inventoryMetrics).toBeUndefined();
    });

    test('should calculate performance score correctly', async () => {
      const mockLeadTimes = [{ averageLeadTime: 10, totalDeliveries: 5 }];
      const mockReorderSuggestions = [
        { needsReorder: false },
        { needsReorder: false }
      ];
      const mockPriceListStats = { activePriceLists: 1, pendingPriceLists: 0 };

      supplierQueries.getSupplierById.mockResolvedValue(mockSupplier);
      supplierQueries.getSupplierLeadTimes.mockResolvedValue(mockLeadTimes);
      supplierQueries.getSupplierReorderSuggestions.mockResolvedValue(mockReorderSuggestions);
      priceListQueries.getPriceListStatistics.mockResolvedValue(mockPriceListStats);

      const result = await getSupplierPerformanceService(1);

      expect(result.success).toBe(true);
      expect(result.data.overallScore.overall).toBeGreaterThan(90); // Should be high score
      expect(result.data.overallScore.factors).toHaveLength(3);
    });
  });

  // ==================== PURCHASE RECEIPT PROCESSING TESTS ====================

  describe('processPurchaseReceiptService', () => {
    const validReceiptData = {
      supplierId: 1,
      purchaseOrderNumber: 'PO-12345',
      referenceNumber: 'REF-12345',
      items: [
        {
          productId: 'PROD001',
          quantity: 10,
          unitCost: 25.50
        }
      ],
      notes: 'Test delivery',
      deliveryDate: '2024-01-15'
    };

    const mockSupplier = {
      id: 1,
      supplierCode: 'SUP001',
      companyName: 'Test Supplier'
    };

    test('should process purchase receipt successfully', async () => {
      const mockMovements = [{ id: 1, productId: 'PROD001', quantity: 10 }];
      
      supplierQueries.getSupplierById.mockResolvedValue(mockSupplier);
      supplierQueries.updateInventoryOnPurchaseReceipt.mockResolvedValue(mockMovements);

      const result = await processPurchaseReceiptService(validReceiptData, 'user123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        supplierId: 1,
        supplier: 'Test Supplier',
        referenceNumber: 'REF-12345',
        totalItems: 1,
        totalQuantity: 10,
        totalValue: 255,
        movements: mockMovements,
        processedAt: expect.any(Date)
      });
      expect(result.message).toBe('Purchase receipt processed successfully. 10 units received across 1 items.');
    });

    test('should fail when supplier not found', async () => {
      supplierQueries.getSupplierById.mockResolvedValue(null);

      const result = await processPurchaseReceiptService(validReceiptData, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Supplier not found');
      expect(result.message).toBe('No supplier found with ID: 1');
      expect(supplierQueries.updateInventoryOnPurchaseReceipt).not.toHaveBeenCalled();
    });

    test('should fail when no items provided', async () => {
      const invalidReceiptData = { ...validReceiptData, items: [] };

      const result = await processPurchaseReceiptService(invalidReceiptData, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No items provided');
      expect(result.message).toBe('Receipt must contain at least one item');
    });

    test('should use purchase order number as reference when reference number not provided', async () => {
      const receiptDataWithoutRef = { ...validReceiptData };
      delete receiptDataWithoutRef.referenceNumber;
      
      supplierQueries.getSupplierById.mockResolvedValue(mockSupplier);
      supplierQueries.updateInventoryOnPurchaseReceipt.mockResolvedValue([]);

      const result = await processPurchaseReceiptService(receiptDataWithoutRef, 'user123');

      expect(result.success).toBe(true);
      expect(result.data.referenceNumber).toBe('PO-12345');
      expect(supplierQueries.updateInventoryOnPurchaseReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceNumber: 'PO-12345'
        })
      );
    });

    test('should generate default notes when not provided', async () => {
      const receiptDataWithoutNotes = { ...validReceiptData };
      delete receiptDataWithoutNotes.notes;
      
      supplierQueries.getSupplierById.mockResolvedValue(mockSupplier);
      supplierQueries.updateInventoryOnPurchaseReceipt.mockResolvedValue([]);

      const result = await processPurchaseReceiptService(receiptDataWithoutNotes, 'user123');

      expect(result.success).toBe(true);
      expect(supplierQueries.updateInventoryOnPurchaseReceipt).toHaveBeenCalledWith(
        expect.objectContaining({
          notes: 'Purchase receipt from Test Supplier'
        })
      );
    });
  });

  // ==================== BULK OPERATIONS TESTS ====================

  describe('bulkUpdateSuppliersService', () => {
    test('should process bulk updates successfully', async () => {
      const updates = [
        { id: 1, data: { companyName: 'Updated Supplier 1' } },
        { id: 2, data: { companyName: 'Updated Supplier 2' } }
      ];

      // Mock successful individual updates
      supplierQueries.getSupplierById.mockResolvedValue({ id: 1, companyName: 'Old Name' });
      supplierQueries.updateSupplier.mockResolvedValue({ id: 1, companyName: 'Updated Supplier 1' });

      const result = await bulkUpdateSuppliersService(updates, 'user123');

      expect(result.success).toBe(true);
      expect(result.data.summary).toEqual({
        total: 2,
        successful: 2,
        failed: 0
      });
      expect(result.data.updated).toHaveLength(2);
      expect(result.data.errors).toHaveLength(0);
    });

    test('should handle partial failures in bulk update', async () => {
      const updates = [
        { id: 1, data: { companyName: 'Updated Supplier 1' } },
        { id: 999, data: { companyName: 'Non-existent Supplier' } }
      ];

      // Mock one successful, one failed update
      supplierQueries.getSupplierById
        .mockResolvedValueOnce({ id: 1, companyName: 'Old Name' })
        .mockResolvedValueOnce(null);
      supplierQueries.updateSupplier.mockResolvedValue({ id: 1, companyName: 'Updated Supplier 1' });

      const result = await bulkUpdateSuppliersService(updates, 'user123');

      expect(result.success).toBe(false);
      expect(result.data.summary).toEqual({
        total: 2,
        successful: 1,
        failed: 1
      });
      expect(result.data.updated).toHaveLength(1);
      expect(result.data.errors).toHaveLength(1);
      expect(result.data.errors[0]).toEqual({
        index: 1,
        id: 999,
        error: 'Supplier not found'
      });
    });

    test('should fail when updates array is empty', async () => {
      const result = await bulkUpdateSuppliersService([], 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No updates provided');
      expect(result.message).toBe('Updates array is required and must not be empty');
    });

    test('should fail when updates is not an array', async () => {
      const result = await bulkUpdateSuppliersService(null, 'user123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('No updates provided');
    });
  });

  // ==================== SYSTEM STATISTICS TESTS ====================

  describe('getSupplierSystemStatisticsService', () => {
    test('should return comprehensive system statistics', async () => {
      const mockStats = {
        totalSuppliers: 50,
        activeSuppliers: 45,
        totalPriceLists: 120,
        pendingPriceLists: 15
      };
      const mockPendingSuppliers = [
        { id: 1, supplierCode: 'SUP001' },
        { id: 2, supplierCode: 'SUP002' }
      ];

      supplierQueries.getSupplierStatistics.mockResolvedValue(mockStats);
      supplierQueries.getSuppliersWithPendingPriceLists.mockResolvedValue(mockPendingSuppliers);

      const result = await getSupplierSystemStatisticsService();

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        ...mockStats,
        suppliersWithPendingPriceLists: 2,
        systemHealth: {
          activeSupplierRatio: 0.9,
          priceListCoverageRatio: expect.closeTo(2.33, 2)
        }
      });
      expect(result.message).toBe('System statistics retrieved successfully');
    });

    test('should handle zero suppliers gracefully', async () => {
      const mockStats = {
        totalSuppliers: 0,
        activeSuppliers: 0,
        totalPriceLists: 0,
        pendingPriceLists: 0
      };

      supplierQueries.getSupplierStatistics.mockResolvedValue(mockStats);
      supplierQueries.getSuppliersWithPendingPriceLists.mockResolvedValue([]);

      const result = await getSupplierSystemStatisticsService();

      expect(result.success).toBe(true);
      expect(result.data.systemHealth).toEqual({
        activeSupplierRatio: 0,
        priceListCoverageRatio: 0
      });
    });

    test('should handle database errors', async () => {
      supplierQueries.getSupplierStatistics.mockRejectedValue(new Error('Database connection failed'));

      const result = await getSupplierSystemStatisticsService();

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
      expect(result.message).toBe('Failed to retrieve system statistics');
    });
  });

  // ==================== ERROR HANDLING TESTS ====================

  describe('Error Handling', () => {
    test('should handle unexpected errors gracefully across all methods', async () => {
      const methods = [
        () => getSuppliersService(),
        () => getSupplierByIdService(1),
        () => createSupplierService({}, 'user'),
        () => updateSupplierService(1, {}, 'user'),
        () => deactivateSupplierService(1, 'user'),
        () => getSupplierPerformanceService(1),
        () => processPurchaseReceiptService({}, 'user'),
        () => bulkUpdateSuppliersService([{}], 'user'),
        () => getSupplierSystemStatisticsService()
      ];

      for (const method of methods) {
        // Mock all functions to throw errors
        Object.keys(supplierQueries).forEach(key => {
          if (typeof supplierQueries[key] === 'function') {
            supplierQueries[key].mockRejectedValue(new Error('Unexpected error'));
          }
        });
        
        Object.keys(priceListQueries).forEach(key => {
          if (typeof priceListQueries[key] === 'function') {
            priceListQueries[key].mockRejectedValue(new Error('Unexpected error'));
          }
        });

        const result = await method();
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      }
    });
  });
});