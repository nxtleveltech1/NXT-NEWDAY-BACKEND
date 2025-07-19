import { describe, it, expect, beforeAll, afterAll, jest } from '@jest/globals';
import * as supplierQueries from '../supplier-queries.js';
import { db } from '../../config/database.js';
import { suppliers, priceLists } from '../schema.js';
import { eq } from 'drizzle-orm';

// Mock database
jest.mock('../../config/database.js');

describe('Supplier Queries', () => {
  const mockSupplier = {
    id: '123e4567-e89b-12d3-a456-426614174000',
    supplierCode: 'SUP001',
    companyName: 'Test Supplier Co',
    email: 'test@supplier.com',
    contactDetails: { phone: '+1234567890', address: '123 Test St' },
    paymentTerms: { days: 30, method: 'bank_transfer' },
    isActive: true,
    createdAt: new Date()
  };

  beforeAll(() => {
    // Setup mock implementations
    db.select = jest.fn().mockReturnThis();
    db.from = jest.fn().mockReturnThis();
    db.where = jest.fn().mockReturnThis();
    db.orderBy = jest.fn().mockReturnThis();
    db.limit = jest.fn().mockReturnThis();
    db.offset = jest.fn().mockReturnThis();
    db.leftJoin = jest.fn().mockReturnThis();
    db.insert = jest.fn().mockReturnThis();
    db.values = jest.fn().mockReturnThis();
    db.returning = jest.fn().mockResolvedValue([mockSupplier]);
    db.update = jest.fn().mockReturnThis();
    db.set = jest.fn().mockReturnThis();
    db.delete = jest.fn().mockReturnThis();
  });

  describe('getSuppliers', () => {
    it('should return paginated suppliers list', async () => {
      const mockResults = [mockSupplier];
      const mockCount = [{ count: '1' }];
      
      db.limit.mockResolvedValueOnce(mockResults);
      db.where.mockResolvedValueOnce(mockCount);

      const result = await supplierQueries.getSuppliers({
        page: 1,
        limit: 10,
        search: 'Test'
      });

      expect(result).toHaveProperty('suppliers');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination.total).toBe(1);
      expect(result.pagination.page).toBe(1);
      expect(result.pagination.limit).toBe(10);
    });

    it('should filter by active status', async () => {
      const mockResults = [mockSupplier];
      const mockCount = [{ count: '1' }];
      
      db.limit.mockResolvedValueOnce(mockResults);
      db.where.mockResolvedValueOnce(mockCount);

      const result = await supplierQueries.getSuppliers({
        isActive: true
      });

      expect(db.where).toHaveBeenCalled();
      expect(result.suppliers).toHaveLength(1);
    });
  });

  describe('getSupplierById', () => {
    it('should return supplier by ID', async () => {
      db.limit.mockResolvedValueOnce([mockSupplier]);

      const result = await supplierQueries.getSupplierById(mockSupplier.id);

      expect(result).toEqual(mockSupplier);
      expect(db.where).toHaveBeenCalled();
      expect(db.limit).toHaveBeenCalledWith(1);
    });

    it('should return null if supplier not found', async () => {
      db.limit.mockResolvedValueOnce([]);

      const result = await supplierQueries.getSupplierById('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('createSupplier', () => {
    it('should create new supplier', async () => {
      const newSupplierData = {
        supplierCode: 'SUP002',
        companyName: 'New Supplier',
        email: 'new@supplier.com',
        contactDetails: {},
        paymentTerms: {}
      };

      db.returning.mockResolvedValueOnce([{ ...mockSupplier, ...newSupplierData }]);

      const result = await supplierQueries.createSupplier(newSupplierData);

      expect(result).toHaveProperty('id');
      expect(result.supplierCode).toBe(newSupplierData.supplierCode);
      expect(db.insert).toHaveBeenCalledWith(suppliers);
      expect(db.values).toHaveBeenCalledWith(newSupplierData);
    });
  });

  describe('updateSupplier', () => {
    it('should update existing supplier', async () => {
      const updateData = {
        companyName: 'Updated Supplier Co'
      };

      db.returning.mockResolvedValueOnce([{ ...mockSupplier, ...updateData }]);

      const result = await supplierQueries.updateSupplier(mockSupplier.id, updateData);

      expect(result.companyName).toBe(updateData.companyName);
      expect(db.update).toHaveBeenCalledWith(suppliers);
      expect(db.where).toHaveBeenCalled();
    });

    it('should return null if supplier not found', async () => {
      db.returning.mockResolvedValueOnce([]);

      const result = await supplierQueries.updateSupplier('non-existent-id', {});

      expect(result).toBeNull();
    });
  });

  describe('deactivateSupplier', () => {
    it('should deactivate supplier', async () => {
      db.returning.mockResolvedValueOnce([{ ...mockSupplier, isActive: false }]);

      const result = await supplierQueries.deactivateSupplier(mockSupplier.id);

      expect(result.isActive).toBe(false);
      expect(db.set).toHaveBeenCalledWith(expect.objectContaining({
        isActive: false
      }));
    });
  });

  describe('getSupplierWithPriceLists', () => {
    it('should return supplier with active price lists', async () => {
      const mockPriceLists = [
        {
          id: 'pl-001',
          supplierId: mockSupplier.id,
          name: 'Q1 2024 Price List',
          isActive: true,
          status: 'approved'
        }
      ];

      // Mock getSupplierById
      jest.spyOn(supplierQueries, 'getSupplierById').mockResolvedValueOnce(mockSupplier);
      db.orderBy.mockResolvedValueOnce(mockPriceLists);

      const result = await supplierQueries.getSupplierWithPriceLists(mockSupplier.id);

      expect(result).toHaveProperty('priceLists');
      expect(result.priceLists).toHaveLength(1);
      expect(result.id).toBe(mockSupplier.id);
    });

    it('should return null if supplier not found', async () => {
      jest.spyOn(supplierQueries, 'getSupplierById').mockResolvedValueOnce(null);

      const result = await supplierQueries.getSupplierWithPriceLists('non-existent-id');

      expect(result).toBeNull();
    });
  });

  describe('supplierExistsByEmail', () => {
    it('should return true if email exists', async () => {
      db.where.mockResolvedValueOnce([{ count: '1' }]);

      const result = await supplierQueries.supplierExistsByEmail('test@supplier.com');

      expect(result).toBe(true);
    });

    it('should return false if email does not exist', async () => {
      db.where.mockResolvedValueOnce([{ count: '0' }]);

      const result = await supplierQueries.supplierExistsByEmail('new@supplier.com');

      expect(result).toBe(false);
    });
  });

  describe('getSupplierStatistics', () => {
    it('should return supplier statistics', async () => {
      const mockStats = {
        totalSuppliers: '10',
        activeSuppliers: '8',
        totalPriceLists: '25',
        pendingPriceLists: '3'
      };

      db.leftJoin.mockResolvedValueOnce([mockStats]);

      const result = await supplierQueries.getSupplierStatistics();

      expect(result).toEqual(mockStats);
      expect(db.select).toHaveBeenCalled();
      expect(db.leftJoin).toHaveBeenCalledWith(priceLists, expect.any(Object));
    });
  });
});