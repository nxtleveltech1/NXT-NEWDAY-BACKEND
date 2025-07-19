/**
 * Comprehensive Unit Tests for Analytics Service
 * Testing all analytics service methods with various scenarios
 */

import { AnalyticsService } from '../analytics.service.js';
import { db } from '../../config/database.js';
import { analyticsCache } from '../../config/redis.js';
import crypto from 'crypto';

// Mock all dependencies
jest.mock('../../config/database.js');
jest.mock('../../config/redis.js');
jest.mock('crypto');
jest.mock('mathjs');

describe('Analytics Service Unit Tests', () => {
  let analyticsService;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock database operations
    db.select = jest.fn().mockReturnThis();
    db.from = jest.fn().mockReturnThis();
    db.innerJoin = jest.fn().mockReturnThis();
    db.leftJoin = jest.fn().mockReturnThis();
    db.where = jest.fn().mockReturnThis();
    db.orderBy = jest.fn().mockReturnThis();
    db.groupBy = jest.fn().mockReturnThis();
    db.limit = jest.fn().mockReturnThis();
    db.offset = jest.fn().mockReturnThis();
    
    // Mock cache operations
    analyticsCache.init = jest.fn().mockResolvedValue();
    analyticsCache.get = jest.fn().mockResolvedValue(null);
    analyticsCache.set = jest.fn().mockResolvedValue();
    analyticsCache.invalidate = jest.fn().mockResolvedValue();
    analyticsCache.clear = jest.fn().mockResolvedValue();
    
    // Mock crypto
    crypto.randomBytes = jest.fn().mockReturnValue({ toString: () => 'mockhash' });
    
    analyticsService = new AnalyticsService();
  });

  // ==================== INITIALIZATION TESTS ====================

  describe('initialization', () => {
    test('should initialize successfully', async () => {
      analyticsCache.init.mockResolvedValue();
      
      await analyticsService.initialize();
      
      expect(analyticsService.initialized).toBe(true);
      expect(analyticsCache.init).toHaveBeenCalled();
    });

    test('should handle initialization failure gracefully', async () => {
      analyticsCache.init.mockRejectedValue(new Error('Cache connection failed'));
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();
      
      await analyticsService.initialize();
      
      expect(analyticsService.initialized).toBe(false);
      expect(consoleSpy).toHaveBeenCalledWith('Failed to initialize analytics service:', expect.any(Error));
      
      consoleSpy.mockRestore();
    });
  });

  // ==================== CORRELATION TRACKING TESTS ====================

  describe('correlation tracking', () => {
    test('should generate unique correlation IDs', () => {
      const id1 = analyticsService.generateCorrelationId();
      const id2 = analyticsService.generateCorrelationId();
      
      expect(id1).toMatch(/^analytics_\d+_mockhash$/);
      expect(id2).toMatch(/^analytics_\d+_mockhash$/);
      expect(id1).not.toBe(id2);
    });

    test('should track query execution', () => {
      const correlationId = 'test-correlation-id';
      const startTime = Date.now();
      
      analyticsService.trackQuery(correlationId, 'getSalesMetrics', { dateFrom: '2024-01-01' }, startTime);
      
      expect(analyticsService.correlationMap.has(correlationId)).toBe(true);
      expect(analyticsService.correlationMap.get(correlationId)).toEqual({
        queryType: 'getSalesMetrics',
        params: { dateFrom: '2024-01-01' },
        startTime,
        timestamp: expect.any(Date)
      });
    });

    test('should finish query tracking with metrics', () => {
      const correlationId = 'test-correlation-id';
      analyticsService.trackQuery(correlationId, 'test', {}, Date.now());
      
      analyticsService.finishQuery(correlationId, 150, 10);
      
      const query = analyticsService.correlationMap.get(correlationId);
      expect(query.endTime).toBeDefined();
      expect(query.duration).toBe(150);
      expect(query.resultCount).toBe(10);
      expect(query.completed).toBe(true);
    });

    test('should clean up old correlation entries when limit exceeded', () => {
      // Add more than 1000 entries
      for (let i = 0; i < 1005; i++) {
        analyticsService.trackQuery(`id-${i}`, 'test', {}, Date.now());
      }
      
      // Add one more to trigger cleanup
      analyticsService.trackQuery('final-id', 'test', {}, Date.now());
      
      expect(analyticsService.correlationMap.size).toBeLessThanOrEqual(1000);
      expect(analyticsService.correlationMap.has('final-id')).toBe(true);
    });

    test('should calculate query metrics correctly', () => {
      const correlationId1 = 'test-1';
      const correlationId2 = 'test-2';
      const correlationId3 = 'test-3';
      
      analyticsService.trackQuery(correlationId1, 'test', {}, Date.now());
      analyticsService.trackQuery(correlationId2, 'test', {}, Date.now());
      analyticsService.trackQuery(correlationId3, 'test', {}, Date.now());
      
      analyticsService.finishQuery(correlationId1, 100, 5);
      analyticsService.finishQuery(correlationId2, 200, 10);
      analyticsService.finishQuery(correlationId3, 3000, 15); // Slow query
      
      const metrics = analyticsService.getQueryMetrics();
      
      expect(metrics.totalQueries).toBe(3);
      expect(metrics.completedQueries).toBe(3);
      expect(metrics.averageDuration).toBe((100 + 200 + 3000) / 3);
      expect(metrics.slowQueries).toHaveLength(1);
      expect(metrics.slowQueries[0].duration).toBe(3000);
    });
  });

  // ==================== CACHING TESTS ====================

  describe('executeWithCache', () => {
    beforeEach(async () => {
      await analyticsService.initialize();
    });

    test('should return cached data when available', async () => {
      const cachedData = { test: 'cached result' };
      analyticsCache.get.mockResolvedValue(cachedData);
      
      const queryFn = jest.fn();
      const result = await analyticsService.executeWithCache(queryFn, 'test-cache-key');
      
      expect(result.data).toEqual(cachedData);
      expect(result.fromCache).toBe(true);
      expect(result.correlationId).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(queryFn).not.toHaveBeenCalled();
    });

    test('should execute query and cache result when cache miss', async () => {
      const queryResult = { test: 'query result' };
      analyticsCache.get.mockResolvedValue(null);
      const queryFn = jest.fn().mockResolvedValue(queryResult);
      
      const result = await analyticsService.executeWithCache(queryFn, 'test-cache-key', 600);
      
      expect(result.data).toEqual(queryResult);
      expect(result.fromCache).toBe(false);
      expect(result.correlationId).toBeDefined();
      expect(result.duration).toBeGreaterThanOrEqual(0);
      expect(queryFn).toHaveBeenCalled();
      expect(analyticsCache.set).toHaveBeenCalledWith('test-cache-key', queryResult, 600);
    });

    test('should work without cache when not initialized', async () => {
      analyticsService.initialized = false;
      const queryResult = { test: 'query result' };
      const queryFn = jest.fn().mockResolvedValue(queryResult);
      
      const result = await analyticsService.executeWithCache(queryFn, 'test-cache-key');
      
      expect(result.data).toEqual(queryResult);
      expect(result.fromCache).toBe(false);
      expect(queryFn).toHaveBeenCalled();
      expect(analyticsCache.get).not.toHaveBeenCalled();
      expect(analyticsCache.set).not.toHaveBeenCalled();
    });

    test('should handle query errors and wrap them with correlation ID', async () => {
      analyticsCache.get.mockResolvedValue(null);
      const queryError = new Error('Database connection failed');
      const queryFn = jest.fn().mockRejectedValue(queryError);
      
      await expect(analyticsService.executeWithCache(queryFn, 'test-cache-key'))
        .rejects.toThrow(/Analytics query failed \[analytics_\d+_mockhash\]: Database connection failed/);
    });

    test('should not cache null or undefined results', async () => {
      analyticsCache.get.mockResolvedValue(null);
      const queryFn = jest.fn().mockResolvedValue(null);
      
      const result = await analyticsService.executeWithCache(queryFn, 'test-cache-key');
      
      expect(result.data).toBeNull();
      expect(analyticsCache.set).not.toHaveBeenCalled();
    });
  });

  // ==================== SALES ANALYTICS TESTS ====================

  describe('getSalesMetrics', () => {
    beforeEach(async () => {
      await analyticsService.initialize();
    });

    test('should get daily sales metrics with default parameters', async () => {
      const mockSalesData = [
        {
          period: '2024-01-01',
          salesCount: 5,
          salesQuantity: 100,
          salesRevenue: 5000,
          salesCost: 3000,
          salesProfit: 2000
        }
      ];
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            groupBy: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(mockSalesData)
            })
          })
        })
      }));
      
      const result = await analyticsService.getSalesMetrics();
      
      expect(result.data).toEqual(mockSalesData);
      expect(result.fromCache).toBe(false);
      expect(db.select).toHaveBeenCalled();
    });

    test('should get monthly sales metrics when aggregation is monthly', async () => {
      const mockMonthlySalesData = [
        {
          period: '2024-01',
          salesCount: 150,
          salesQuantity: 3000,
          salesRevenue: 150000,
          salesCost: 90000,
          salesProfit: 60000
        }
      ];
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            groupBy: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(mockMonthlySalesData)
            })
          })
        })
      }));
      
      const result = await analyticsService.getSalesMetrics({
        aggregation: 'monthly',
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31'
      });
      
      expect(result.data).toEqual(mockMonthlySalesData);
    });

    test('should filter by dimension and dimension ID', async () => {
      const mockFilteredData = [
        {
          period: '2024-01-01',
          salesCount: 2,
          salesQuantity: 50,
          salesRevenue: 2500,
          salesCost: 1500,
          salesProfit: 1000
        }
      ];
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            groupBy: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue(mockFilteredData)
            })
          })
        })
      }));
      
      const result = await analyticsService.getSalesMetrics({
        dimension: 'customer',
        dimensionId: 'customer-123'
      });
      
      expect(result.data).toEqual(mockFilteredData);
    });

    test('should use cache when available', async () => {
      const cachedSalesData = [{ period: '2024-01-01', salesCount: 10 }];
      analyticsCache.get.mockResolvedValue(cachedSalesData);
      
      const result = await analyticsService.getSalesMetrics({ dateFrom: '2024-01-01' });
      
      expect(result.data).toEqual(cachedSalesData);
      expect(result.fromCache).toBe(true);
      expect(db.select).not.toHaveBeenCalled();
    });
  });

  // ==================== INVENTORY ANALYTICS TESTS ====================

  describe('getInventoryMetrics', () => {
    beforeEach(async () => {
      await analyticsService.initialize();
    });

    test('should get inventory metrics with default parameters', async () => {
      const mockInventoryData = [
        {
          totalItems: 100,
          totalValue: 50000,
          totalOnHand: 5000,
          totalReserved: 500,
          totalAvailable: 4500,
          itemsBelowReorder: 10,
          itemsOutOfStock: 2
        }
      ];
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockInventoryData)
          })
        })
      }));
      
      const result = await analyticsService.getInventoryMetrics();
      
      expect(result.data).toEqual(mockInventoryData);
      expect(result.fromCache).toBe(false);
    });

    test('should filter by warehouse ID', async () => {
      const mockWarehouseData = [
        {
          totalItems: 50,
          totalValue: 25000,
          totalOnHand: 2500,
          totalReserved: 250,
          totalAvailable: 2250,
          itemsBelowReorder: 5,
          itemsOutOfStock: 1
        }
      ];
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockWarehouseData)
          })
        })
      }));
      
      const result = await analyticsService.getInventoryMetrics({ warehouseId: 'warehouse-1' });
      
      expect(result.data).toEqual(mockWarehouseData);
    });

    test('should include movement analysis when requested', async () => {
      const mockInventoryWithMovements = [
        {
          totalItems: 100,
          totalValue: 50000,
          movements: {
            inbound: 100,
            outbound: 80,
            adjustments: 5
          }
        }
      ];
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockResolvedValue(mockInventoryWithMovements)
          })
        })
      }));
      
      const result = await analyticsService.getInventoryMetrics({ includeMovements: true });
      
      expect(result.data).toEqual(mockInventoryWithMovements);
    });
  });

  // ==================== CUSTOMER ANALYTICS TESTS ====================

  describe('getCustomerAnalytics', () => {
    beforeEach(async () => {
      await analyticsService.initialize();
    });

    test('should get comprehensive customer analytics', async () => {
      const mockCustomerData = {
        totalCustomers: 500,
        activeCustomers: 450,
        newCustomers: 25,
        avgOrderValue: 250.75,
        totalLifetimeValue: 1250000,
        topCustomers: [
          {
            id: 'customer-1',
            name: 'Top Customer',
            lifetimeValue: 50000,
            orderCount: 100
          }
        ]
      };
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                groupBy: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockReturnValue({
                    limit: jest.fn().mockResolvedValue(mockCustomerData.topCustomers)
                  })
                })
              })
            })
          })
        })
      }));
      
      // Mock additional queries for summary metrics
      db.select.mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([{
            totalCustomers: mockCustomerData.totalCustomers,
            activeCustomers: mockCustomerData.activeCustomers
          }])
        })
      }));
      
      const result = await analyticsService.getCustomerAnalytics({
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31'
      });
      
      expect(result.data).toBeDefined();
      expect(result.fromCache).toBe(false);
    });

    test('should include behavioral segmentation when requested', async () => {
      const mockCustomerWithSegments = {
        totalCustomers: 500,
        segments: {
          champions: 50,
          loyalCustomers: 100,
          potentialLoyalists: 150,
          atRisk: 75,
          cannotLoseThem: 25,
          hibernating: 100
        }
      };
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue([mockCustomerWithSegments])
        })
      }));
      
      const result = await analyticsService.getCustomerAnalytics({
        includeSegmentation: true
      });
      
      expect(result.data).toBeDefined();
    });
  });

  // ==================== PURCHASE FREQUENCY ANALYSIS TESTS ====================

  describe('analyzePurchaseFrequency', () => {
    beforeEach(async () => {
      await analyticsService.initialize();
    });

    test('should analyze purchase frequency patterns', async () => {
      const mockFrequencyData = [
        {
          customerId: 'customer-1',
          customerName: 'Test Customer',
          totalOrders: 12,
          avgDaysBetweenOrders: 30,
          lastOrderDate: '2024-01-15',
          frequency: 'monthly',
          trend: 'stable'
        }
      ];
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              groupBy: jest.fn().mockReturnValue({
                having: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockResolvedValue(mockFrequencyData)
                })
              })
            })
          })
        })
      }));
      
      const result = await analyticsService.analyzePurchaseFrequency({
        customerId: 'customer-1',
        dateFrom: '2023-01-01',
        dateTo: '2024-01-31'
      });
      
      expect(result.data).toEqual(mockFrequencyData);
    });

    test('should handle frequency analysis for all customers', async () => {
      const mockAllCustomersFrequency = [
        { frequency: 'weekly', customerCount: 50, avgOrderValue: 150 },
        { frequency: 'monthly', customerCount: 200, avgOrderValue: 300 },
        { frequency: 'quarterly', customerCount: 100, avgOrderValue: 500 }
      ];
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              groupBy: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockResolvedValue(mockAllCustomersFrequency)
              })
            })
          })
        })
      }));
      
      const result = await analyticsService.analyzePurchaseFrequency({
        dateFrom: '2023-01-01',
        dateTo: '2024-01-31'
      });
      
      expect(result.data).toEqual(mockAllCustomersFrequency);
    });
  });

  // ==================== SUPPLIER ANALYTICS TESTS ====================

  describe('getSupplierPerformance', () => {
    beforeEach(async () => {
      await analyticsService.initialize();
    });

    test('should get comprehensive supplier performance metrics', async () => {
      const mockSupplierPerformance = [
        {
          supplierId: 'supplier-1',
          supplierName: 'Test Supplier',
          totalOrders: 50,
          onTimeDeliveryRate: 0.92,
          qualityScore: 4.5,
          priceCompetitiveness: 0.85,
          overallScore: 87.5,
          rank: 1
        }
      ];
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                groupBy: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockResolvedValue(mockSupplierPerformance)
                })
              })
            })
          })
        })
      }));
      
      const result = await analyticsService.getSupplierPerformance({
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31'
      });
      
      expect(result.data).toEqual(mockSupplierPerformance);
    });

    test('should filter performance by supplier ID', async () => {
      const mockSingleSupplierPerformance = [
        {
          supplierId: 'supplier-1',
          supplierName: 'Test Supplier',
          detailedMetrics: {
            avgDeliveryTime: 5.2,
            defectRate: 0.02,
            responseTime: 24
          }
        }
      ];
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockResolvedValue(mockSingleSupplierPerformance)
        })
      }));
      
      const result = await analyticsService.getSupplierPerformance({
        supplierId: 'supplier-1'
      });
      
      expect(result.data).toEqual(mockSingleSupplierPerformance);
    });
  });

  describe('getSupplierRankings', () => {
    beforeEach(async () => {
      await analyticsService.initialize();
    });

    test('should get supplier rankings with comprehensive scoring', async () => {
      const mockRankings = [
        {
          supplierId: 'supplier-1',
          supplierName: 'Top Supplier',
          rank: 1,
          totalScore: 95.5,
          scores: {
            delivery: 98,
            quality: 95,
            price: 92,
            reliability: 97
          }
        },
        {
          supplierId: 'supplier-2',
          supplierName: 'Second Supplier',
          rank: 2,
          totalScore: 88.2,
          scores: {
            delivery: 85,
            quality: 90,
            price: 89,
            reliability: 89
          }
        }
      ];
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            leftJoin: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                groupBy: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockResolvedValue(mockRankings)
                })
              })
            })
          })
        })
      }));
      
      const result = await analyticsService.getSupplierRankings({
        includeScoreBreakdown: true,
        limit: 10
      });
      
      expect(result.data).toEqual(mockRankings);
    });

    test('should filter rankings by category', async () => {
      const mockCategoryRankings = [
        {
          supplierId: 'supplier-1',
          supplierName: 'Electronics Supplier',
          rank: 1,
          category: 'Electronics',
          totalScore: 92.5
        }
      ];
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              groupBy: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockResolvedValue(mockCategoryRankings)
              })
            })
          })
        })
      }));
      
      const result = await analyticsService.getSupplierRankings({
        category: 'Electronics'
      });
      
      expect(result.data).toEqual(mockCategoryRankings);
    });
  });

  // ==================== CACHE MANAGEMENT TESTS ====================

  describe('cache management', () => {
    beforeEach(async () => {
      await analyticsService.initialize();
    });

    test('should invalidate cache by pattern', async () => {
      analyticsCache.invalidate.mockResolvedValue();
      
      await analyticsService.invalidateCache('sales_*');
      
      expect(analyticsCache.invalidate).toHaveBeenCalledWith('sales_*');
    });

    test('should clear all analytics cache', async () => {
      analyticsCache.clear.mockResolvedValue();
      
      await analyticsService.clearAllCache();
      
      expect(analyticsCache.clear).toHaveBeenCalled();
    });

    test('should use default pattern for cache invalidation', async () => {
      analyticsCache.invalidate.mockResolvedValue();
      
      await analyticsService.invalidateCache();
      
      expect(analyticsCache.invalidate).toHaveBeenCalledWith('analytics:*');
    });
  });

  // ==================== HEALTH CHECK TESTS ====================

  describe('healthCheck', () => {
    beforeEach(async () => {
      await analyticsService.initialize();
    });

    test('should perform health check successfully', async () => {
      const mockHealthData = {
        status: 'healthy',
        database: 'connected',
        cache: 'connected',
        queryMetrics: {
          totalQueries: 100,
          averageDuration: 150,
          slowQueries: 2
        }
      };
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ test: 'ok' }])
        })
      }));
      
      analyticsCache.get.mockResolvedValue('test');
      
      // Mock some query metrics
      analyticsService.trackQuery('test-1', 'test', {}, Date.now());
      analyticsService.finishQuery('test-1', 100, 5);
      
      const result = await analyticsService.healthCheck();
      
      expect(result.data).toBeDefined();
      expect(result.data.status).toBeDefined();
      expect(result.data.queryMetrics).toBeDefined();
    });

    test('should detect database connection issues', async () => {
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          limit: jest.fn().mockRejectedValue(new Error('Database error'))
        })
      }));
      
      const result = await analyticsService.healthCheck();
      
      expect(result.data.database).toBe('error');
    });

    test('should detect cache connection issues', async () => {
      analyticsCache.get.mockRejectedValue(new Error('Cache error'));
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ test: 'ok' }])
        })
      }));
      
      const result = await analyticsService.healthCheck();
      
      expect(result.data.cache).toBe('error');
    });
  });

  // ==================== ERROR HANDLING TESTS ====================

  describe('error handling', () => {
    beforeEach(async () => {
      await analyticsService.initialize();
    });

    test('should handle database errors gracefully', async () => {
      const dbError = new Error('Database connection lost');
      db.select.mockImplementation(() => {
        throw dbError;
      });
      
      await expect(analyticsService.getSalesMetrics())
        .rejects.toThrow(/Analytics query failed.*Database connection lost/);
    });

    test('should handle cache errors gracefully and continue with query execution', async () => {
      analyticsCache.get.mockRejectedValue(new Error('Cache error'));
      analyticsCache.set.mockRejectedValue(new Error('Cache error'));
      
      const mockData = [{ test: 'data' }];
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(mockData)
          })
        })
      }));
      
      const result = await analyticsService.getSalesMetrics();
      
      expect(result.data).toEqual(mockData);
      expect(result.fromCache).toBe(false);
    });

    test('should handle malformed parameters gracefully', async () => {
      const mockData = [];
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(mockData)
          })
        })
      }));
      
      // Test with invalid date formats
      const result = await analyticsService.getSalesMetrics({
        dateFrom: 'invalid-date',
        dateTo: 'also-invalid'
      });
      
      expect(result.data).toEqual(mockData);
    });

    test('should handle null/undefined parameters', async () => {
      const mockData = [];
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(mockData)
          })
        })
      }));
      
      const result = await analyticsService.getSalesMetrics({
        dateFrom: null,
        dateTo: undefined,
        dimension: '',
        dimensionId: null
      });
      
      expect(result.data).toEqual(mockData);
    });
  });

  // ==================== PERFORMANCE TESTS ====================

  describe('performance tracking', () => {
    beforeEach(async () => {
      await analyticsService.initialize();
    });

    test('should track query execution time accurately', async () => {
      const mockData = [{ test: 'data' }];
      let queryExecutionDelay = 100;
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockImplementation(async () => {
              await new Promise(resolve => setTimeout(resolve, queryExecutionDelay));
              return mockData;
            })
          })
        })
      }));
      
      const result = await analyticsService.getSalesMetrics();
      
      expect(result.duration).toBeGreaterThanOrEqual(queryExecutionDelay);
      expect(result.correlationId).toBeDefined();
    });

    test('should identify slow queries correctly', async () => {
      const slowQueryDelay = 2500; // > 2 seconds
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockImplementation(async () => {
              await new Promise(resolve => setTimeout(resolve, slowQueryDelay));
              return [];
            })
          })
        })
      }));
      
      await analyticsService.getSalesMetrics();
      
      const metrics = analyticsService.getQueryMetrics();
      expect(metrics.slowQueries.length).toBeGreaterThan(0);
    });
  });

  // ==================== INTEGRATION SCENARIOS TESTS ====================

  describe('integration scenarios', () => {
    beforeEach(async () => {
      await analyticsService.initialize();
    });

    test('should handle concurrent analytics requests', async () => {
      const mockData = [{ test: 'data' }];
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(mockData)
          })
        })
      }));
      
      const promises = [
        analyticsService.getSalesMetrics({ dateFrom: '2024-01-01' }),
        analyticsService.getInventoryMetrics({ warehouseId: 'wh-1' }),
        analyticsService.getCustomerAnalytics({ includeSegmentation: true })
      ];
      
      const results = await Promise.all(promises);
      
      results.forEach(result => {
        expect(result.data).toEqual(mockData);
        expect(result.correlationId).toBeDefined();
      });
    });

    test('should handle partial cache failures in concurrent requests', async () => {
      const mockData = [{ test: 'data' }];
      
      // Make cache fail for some requests
      let cacheCallCount = 0;
      analyticsCache.get.mockImplementation(() => {
        cacheCallCount++;
        if (cacheCallCount % 2 === 0) {
          throw new Error('Cache error');
        }
        return null;
      });
      
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockResolvedValue(mockData)
          })
        })
      }));
      
      const promises = [
        analyticsService.getSalesMetrics({ dateFrom: '2024-01-01' }),
        analyticsService.getSalesMetrics({ dateFrom: '2024-02-01' }),
        analyticsService.getSalesMetrics({ dateFrom: '2024-03-01' }),
        analyticsService.getSalesMetrics({ dateFrom: '2024-04-01' })
      ];
      
      const results = await Promise.all(promises);
      
      results.forEach(result => {
        expect(result.data).toEqual(mockData);
        expect(result.fromCache).toBe(false);
      });
    });
  });
});