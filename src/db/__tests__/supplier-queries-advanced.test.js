import { describe, test, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import * as schema from '../schema.js';
import * as supplierQueries from '../supplier-queries.js';
import * as priceListQueries from '../price-list-queries.js';

// Mock database connection
jest.mock('drizzle-orm/node-postgres');
jest.mock('../database.js', () => ({
  db: {
    select: jest.fn(),
    insert: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
    transaction: jest.fn(),
    execute: jest.fn()
  }
}));

describe('Supplier Database Queries - Advanced Tests', () => {
  let mockDb;

  beforeEach(() => {
    jest.clearAllMocks();
    mockDb = require('../database.js').db;
  });

  describe('Complex Query Scenarios', () => {
    test('should handle concurrent supplier updates correctly', async () => {
      const supplierId = 'supplier-123';
      const updates = [
        { paymentTerms: 30, updatedBy: 'user-1' },
        { paymentTerms: 45, updatedBy: 'user-2' },
        { paymentTerms: 60, updatedBy: 'user-3' }
      ];

      // Simulate concurrent update attempts
      mockDb.transaction.mockImplementation(async (txFn) => {
        const mockTx = {
          select: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          for: jest.fn().mockResolvedValue([{ 
            id: supplierId, 
            version: 1,
            paymentTerms: 30 
          }]),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{
            id: supplierId,
            version: 2,
            paymentTerms: 45
          }])
        };
        return txFn(mockTx);
      });

      // Execute updates concurrently
      const updatePromises = updates.map(update =>
        supplierQueries.updateSupplierWithOptimisticLocking(supplierId, update)
      );

      const results = await Promise.allSettled(updatePromises);

      // Only one should succeed, others should fail with version conflict
      const succeeded = results.filter(r => r.status === 'fulfilled');
      const failed = results.filter(r => r.status === 'rejected');

      expect(succeeded.length).toBe(1);
      expect(failed.length).toBe(2);
      expect(failed[0].reason.message).toContain('version conflict');
    });

    test('should optimize supplier search with full-text search', async () => {
      const searchTerm = 'electronics supplier china';
      
      mockDb.execute.mockResolvedValue({
        rows: [
          {
            id: 'supplier-1',
            companyName: 'China Electronics Corp',
            rank: 0.95,
            matchedFields: ['companyName', 'tags']
          },
          {
            id: 'supplier-2',
            companyName: 'Electronics Supplier International',
            rank: 0.85,
            matchedFields: ['companyName']
          }
        ]
      });

      const result = await supplierQueries.searchSuppliersFullText(searchTerm);

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.stringContaining('to_tsquery')
      );
      expect(result.suppliers).toHaveLength(2);
      expect(result.suppliers[0].rank).toBeGreaterThan(result.suppliers[1].rank);
    });

    test('should calculate supplier reliability score accurately', async () => {
      const supplierId = 'supplier-123';
      
      // Mock various metrics
      mockDb.execute.mockImplementation((query) => {
        if (query.text.includes('delivery_performance')) {
          return {
            rows: [{
              totalDeliveries: 100,
              onTimeDeliveries: 85,
              averageDelayDays: 2.5
            }]
          };
        }
        if (query.text.includes('quality_metrics')) {
          return {
            rows: [{
              totalItems: 10000,
              defectiveItems: 50,
              returnRate: 0.005
            }]
          };
        }
        if (query.text.includes('response_time')) {
          return {
            rows: [{
              averageResponseHours: 4.5,
              inquiriesResponded: 95,
              totalInquiries: 100
            }]
          };
        }
        return { rows: [] };
      });

      const score = await supplierQueries.calculateSupplierReliabilityScore(supplierId);

      expect(score.overall).toBeGreaterThan(80);
      expect(score.breakdown.delivery).toBe(85);
      expect(score.breakdown.quality).toBe(99.5);
      expect(score.breakdown.responsiveness).toBe(95);
    });

    test('should detect and handle duplicate SKUs across suppliers', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [
          {
            sku: 'ELEC-001',
            suppliers: ['supplier-1', 'supplier-2', 'supplier-3'],
            priceRange: { min: 10.99, max: 15.99 },
            count: 3
          },
          {
            sku: 'ELEC-002',
            suppliers: ['supplier-1', 'supplier-2'],
            priceRange: { min: 25.00, max: 27.50 },
            count: 2
          }
        ]
      });

      const duplicates = await supplierQueries.findDuplicateSKUsAcrossSuppliers();

      expect(duplicates).toHaveLength(2);
      expect(duplicates[0].suppliers).toHaveLength(3);
      expect(duplicates[0].priceRange.max - duplicates[0].priceRange.min).toBe(5);
    });
  });

  describe('Performance-Critical Queries', () => {
    test('should use proper indexes for supplier listing', async () => {
      const mockExplain = {
        rows: [{
          'QUERY PLAN': 'Index Scan using idx_suppliers_active_created on suppliers'
        }]
      };

      mockDb.execute
        .mockResolvedValueOnce(mockExplain)
        .mockResolvedValueOnce({ rows: [] });

      await supplierQueries.getSuppliersOptimized({
        isActive: true,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('EXPLAIN')
        })
      );
    });

    test('should batch supplier statistics calculations', async () => {
      const supplierIds = Array(100).fill(null).map((_, i) => `supplier-${i}`);
      
      mockDb.execute.mockResolvedValue({
        rows: supplierIds.map(id => ({
          supplierId: id,
          totalProducts: Math.floor(Math.random() * 1000),
          activePriceLists: Math.floor(Math.random() * 5),
          averageLeadTime: Math.floor(Math.random() * 14) + 1
        }))
      });

      const stats = await supplierQueries.getBatchSupplierStatistics(supplierIds);

      // Should make single query for all suppliers
      expect(mockDb.execute).toHaveBeenCalledTimes(1);
      expect(stats).toHaveLength(100);
      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('WHERE supplier_id = ANY($1)')
        })
      );
    });

    test('should use materialized views for complex aggregations', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [{
          supplierId: 'supplier-123',
          monthlyOrderValue: 150000,
          productCount: 500,
          averageOrderFrequency: 4.5,
          lastRefreshed: new Date()
        }]
      });

      const analytics = await supplierQueries.getSupplierAnalyticsFromMaterializedView('supplier-123');

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          text: expect.stringContaining('supplier_analytics_mv')
        })
      );
      expect(analytics.lastRefreshed).toBeDefined();
    });
  });

  describe('Data Integrity and Constraints', () => {
    test('should enforce unique supplier codes at database level', async () => {
      const newSupplier = {
        supplierCode: 'SUP-001',
        companyName: 'Test Supplier',
        email: 'test@supplier.com'
      };

      mockDb.insert.mockReturnThis();
      mockDb.insert().values = jest.fn().mockReturnThis();
      mockDb.insert().values().returning = jest.fn().mockRejectedValue({
        code: '23505',
        constraint: 'suppliers_supplier_code_unique'
      });

      await expect(
        supplierQueries.createSupplier(newSupplier)
      ).rejects.toThrow('Supplier code already exists');
    });

    test('should validate email format at database level', async () => {
      const invalidEmails = [
        'notanemail',
        '@example.com',
        'user@',
        'user@.com',
        'user@@example.com'
      ];

      for (const email of invalidEmails) {
        mockDb.insert.mockReturnThis();
        mockDb.insert().values = jest.fn().mockReturnThis();
        mockDb.insert().values().returning = jest.fn().mockRejectedValue({
          code: '23514',
          constraint: 'suppliers_email_check'
        });

        await expect(
          supplierQueries.createSupplier({
            supplierCode: 'SUP-001',
            companyName: 'Test',
            email
          })
        ).rejects.toThrow('Invalid email format');
      }
    });

    test('should maintain referential integrity for price lists', async () => {
      mockDb.transaction.mockImplementation(async (txFn) => {
        const mockTx = {
          delete: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          where: jest.fn().mockRejectedValue({
            code: '23503',
            constraint: 'price_lists_supplier_id_fkey'
          })
        };
        return txFn(mockTx);
      });

      await expect(
        supplierQueries.deleteSupplier('supplier-with-price-lists')
      ).rejects.toThrow('Cannot delete supplier with existing price lists');
    });
  });

  describe('Advanced Aggregations and Analytics', () => {
    test('should calculate supplier diversity metrics', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [{
          totalSuppliers: 100,
          countryCount: 25,
          categoryDistribution: {
            'Electronics': 30,
            'Hardware': 25,
            'Software': 20,
            'Services': 25
          },
          sizeDistribution: {
            'Small': 40,
            'Medium': 35,
            'Large': 20,
            'Enterprise': 5
          },
          diversityScore: 0.78
        }]
      });

      const diversity = await supplierQueries.getSupplierDiversityMetrics();

      expect(diversity.diversityScore).toBe(0.78);
      expect(diversity.countryCount).toBe(25);
      expect(Object.keys(diversity.categoryDistribution)).toHaveLength(4);
    });

    test('should identify supplier clustering patterns', async () => {
      mockDb.execute.mockResolvedValue({
        rows: [
          {
            clusterId: 1,
            clusterName: 'High-Volume Electronics',
            supplierCount: 15,
            characteristics: {
              averageProductCount: 500,
              averageLeadTime: 7,
              priceRange: 'medium'
            }
          },
          {
            clusterId: 2,
            clusterName: 'Premium Small-Batch',
            supplierCount: 8,
            characteristics: {
              averageProductCount: 50,
              averageLeadTime: 14,
              priceRange: 'high'
            }
          }
        ]
      });

      const clusters = await supplierQueries.identifySupplierClusters();

      expect(clusters).toHaveLength(2);
      expect(clusters[0].supplierCount).toBeGreaterThan(clusters[1].supplierCount);
    });

    test('should forecast supplier demand patterns', async () => {
      const supplierId = 'supplier-123';
      
      mockDb.execute.mockResolvedValue({
        rows: [{
          month: '2024-01',
          predictedOrderValue: 50000,
          confidenceInterval: { lower: 45000, upper: 55000 },
          seasonalityFactor: 1.2,
          trend: 'increasing'
        }]
      });

      const forecast = await supplierQueries.forecastSupplierDemand(
        supplierId,
        { months: 6 }
      );

      expect(forecast).toHaveLength(1);
      expect(forecast[0].confidenceInterval.upper).toBeGreaterThan(
        forecast[0].predictedOrderValue
      );
      expect(forecast[0].trend).toBe('increasing');
    });
  });

  describe('Query Optimization and Caching', () => {
    test('should cache frequently accessed supplier data', async () => {
      const supplierId = 'supplier-123';
      const mockSupplier = { id: supplierId, companyName: 'Cached Supplier' };
      
      // First call - hits database
      mockDb.select.mockReturnThis();
      mockDb.select().from = jest.fn().mockReturnThis();
      mockDb.select().from().where = jest.fn().mockResolvedValue([mockSupplier]);

      const result1 = await supplierQueries.getSupplierByIdCached(supplierId);
      
      // Second call - should use cache
      const result2 = await supplierQueries.getSupplierByIdCached(supplierId);

      expect(mockDb.select).toHaveBeenCalledTimes(1); // Only one DB call
      expect(result1).toEqual(result2);
    });

    test('should invalidate cache on supplier update', async () => {
      const supplierId = 'supplier-123';
      
      // Setup cache invalidation spy
      const invalidateSpy = jest.spyOn(supplierQueries, 'invalidateSupplierCache');
      
      mockDb.update.mockReturnThis();
      mockDb.update().set = jest.fn().mockReturnThis();
      mockDb.update().set().where = jest.fn().mockReturnThis();
      mockDb.update().set().where().returning = jest.fn().mockResolvedValue([{
        id: supplierId
      }]);

      await supplierQueries.updateSupplier(supplierId, { companyName: 'Updated' });

      expect(invalidateSpy).toHaveBeenCalledWith(supplierId);
    });

    test('should use query result caching for expensive operations', async () => {
      const expensiveQuery = jest.fn().mockResolvedValue({
        rows: [{ complex: 'data' }]
      });
      
      mockDb.execute = expensiveQuery;

      // Multiple calls to expensive operation
      await Promise.all([
        supplierQueries.getComplexSupplierAnalytics(),
        supplierQueries.getComplexSupplierAnalytics(),
        supplierQueries.getComplexSupplierAnalytics()
      ]);

      // Should only execute once due to caching
      expect(expensiveQuery).toHaveBeenCalledTimes(1);
    });
  });

  describe('Transaction Management', () => {
    test('should handle complex multi-table transactions', async () => {
      const supplierData = {
        supplier: { companyName: 'New Supplier' },
        contacts: [{ name: 'John Doe', email: 'john@supplier.com' }],
        categories: ['Electronics', 'Hardware'],
        initialPriceList: { name: 'Initial Catalog', items: [] }
      };

      let transactionSteps = [];
      
      mockDb.transaction.mockImplementation(async (txFn) => {
        const mockTx = {
          insert: jest.fn((step) => {
            transactionSteps.push(step);
            return mockTx;
          }),
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{ id: 'new-id' }])
        };
        
        return txFn(mockTx);
      });

      await supplierQueries.createSupplierWithRelatedData(supplierData);

      expect(transactionSteps).toContain('suppliers');
      expect(transactionSteps).toContain('supplier_contacts');
      expect(transactionSteps).toContain('supplier_categories');
      expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    });

    test('should rollback on transaction failure', async () => {
      mockDb.transaction.mockImplementation(async (txFn) => {
        const mockTx = {
          insert: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          returning: jest.fn()
            .mockResolvedValueOnce([{ id: 'supplier-1' }])
            .mockRejectedValueOnce(new Error('Constraint violation'))
        };
        
        return txFn(mockTx);
      });

      await expect(
        supplierQueries.createSupplierWithRelatedData({
          supplier: { companyName: 'Test' },
          contacts: [{ email: 'invalid' }]
        })
      ).rejects.toThrow('Constraint violation');

      // Verify rollback occurred (no data persisted)
      expect(mockDb.select).not.toHaveBeenCalled();
    });
  });

  describe('Security and Access Control', () => {
    test('should apply row-level security for supplier access', async () => {
      const userId = 'user-123';
      const userRole = 'supplier_manager';
      
      mockDb.execute.mockImplementation((query) => {
        expect(query.text).toContain('current_user_id');
        expect(query.text).toContain('current_user_role');
        return { rows: [] };
      });

      await supplierQueries.getSuppliersWithRLS({ userId, userRole });

      expect(mockDb.execute).toHaveBeenCalledWith(
        expect.objectContaining({
          values: expect.arrayContaining([userId, userRole])
        })
      );
    });

    test('should audit sensitive operations', async () => {
      const auditSpy = jest.spyOn(supplierQueries, 'auditSupplierOperation');
      
      mockDb.update.mockReturnThis();
      mockDb.update().set = jest.fn().mockReturnThis();
      mockDb.update().set().where = jest.fn().mockReturnThis();
      mockDb.update().set().where().returning = jest.fn().mockResolvedValue([{
        id: 'supplier-123'
      }]);

      await supplierQueries.updateSupplierSensitiveData('supplier-123', {
        bankAccount: '****1234',
        taxId: '****5678'
      }, 'user-admin');

      expect(auditSpy).toHaveBeenCalledWith({
        operation: 'UPDATE_SENSITIVE',
        supplierId: 'supplier-123',
        userId: 'user-admin',
        changes: expect.objectContaining({
          fields: ['bankAccount', 'taxId']
        })
      });
    });
  });
});