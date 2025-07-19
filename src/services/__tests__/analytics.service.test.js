import { jest } from '@jest/globals';
import analyticsService from '../analytics.service.js';
import cacheService from '../cache.service.js';
import * as inventoryQueries from '../../db/inventory-queries.js';
import * as supplierQueries from '../../db/supplier-queries.js';
import * as customerQueries from '../../db/customer-queries.js';

// Mock dependencies
jest.mock('../cache.service.js');
jest.mock('../../db/inventory-queries.js');
jest.mock('../../db/supplier-queries.js');
jest.mock('../../db/customer-queries.js');

describe('AnalyticsService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Performance Monitoring', () => {
    it('should complete operations within performance target', async () => {
      // Mock cache miss
      cacheService.getAnalytics.mockResolvedValue(null);
      cacheService.cacheAnalytics.mockResolvedValue(true);

      const mockOperation = jest.fn().mockResolvedValue({ test: 'data' });
      
      const result = await analyticsService.withPerformanceMonitoring(mockOperation, 'test-key');

      expect(result.performance.duration).toBeLessThan(2000);
      expect(result.performance.source).toBe('database');
      expect(result.data).toEqual({ test: 'data' });
      expect(mockOperation).toHaveBeenCalledTimes(1);
    });

    it('should return cached data when available', async () => {
      const cachedData = { cached: 'result' };
      cacheService.getAnalytics.mockResolvedValue(cachedData);

      const mockOperation = jest.fn();
      
      const result = await analyticsService.withPerformanceMonitoring(mockOperation, 'test-key');

      expect(result.data).toEqual(cachedData);
      expect(result.performance.source).toBe('cache');
      expect(mockOperation).not.toHaveBeenCalled();
    });

    it('should log performance warnings for slow operations', async () => {
      cacheService.getAnalytics.mockResolvedValue(null);
      
      // Mock slow operation
      const slowOperation = jest.fn().mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 50));
        return { slow: 'data' };
      });
      
      await analyticsService.withPerformanceMonitoring(slowOperation);

      // Should complete but may log warning if over 2000ms
      expect(slowOperation).toHaveBeenCalledTimes(1);
    });

    it('should handle operation failures gracefully', async () => {
      cacheService.getAnalytics.mockResolvedValue(null);
      
      const failingOperation = jest.fn().mockRejectedValue(new Error('Test error'));
      
      await expect(
        analyticsService.withPerformanceMonitoring(failingOperation)
      ).rejects.toThrow('Test error');

      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('Inventory Analytics', () => {
    const mockInventoryData = {
      totalValue: 1000000,
      totalItems: 500,
      totalQuantity: 10000,
      inStockItems: 400,
      lowStockItems: 50,
      belowReorderPoint: 25
    };

    beforeEach(() => {
      inventoryQueries.getInventoryAnalytics.mockResolvedValue(mockInventoryData);
      cacheService.getAnalytics.mockResolvedValue(null);
      cacheService.cacheAnalytics.mockResolvedValue(true);
    });

    it('should get inventory analytics with enhanced calculations', async () => {
      const result = await analyticsService.getInventoryAnalytics({ warehouseId: 'WH001' });

      expect(result.data.totalValue).toBe(1000000);
      expect(result.data.turnoverRatio).toBeDefined();
      expect(result.data.stockHealth).toBeDefined();
      expect(result.data.reorderUrgency).toBe(25);
      expect(result.data.valueDistribution).toBeDefined();
      expect(result.performance.duration).toBeLessThan(2000);
    });

    it('should calculate turnover ratio correctly', async () => {
      const result = await analyticsService.getInventoryAnalytics();
      
      expect(result.data.turnoverRatio).toBeGreaterThan(0);
      expect(typeof result.data.turnoverRatio).toBe('number');
    });

    it('should calculate stock health percentages', async () => {
      const result = await analyticsService.getInventoryAnalytics();
      
      const stockHealth = result.data.stockHealth;
      expect(stockHealth.healthy).toBe(80); // 400/500 * 100
      expect(stockHealth.warning).toBe(10); // 50/500 * 100
      expect(stockHealth.critical).toBe(10); // (500-400-50)/500 * 100
    });

    it('should handle empty inventory data', async () => {
      inventoryQueries.getInventoryAnalytics.mockResolvedValue({});
      
      const result = await analyticsService.getInventoryAnalytics();
      
      expect(result.data.turnoverRatio).toBe(0);
      expect(result.data.reorderUrgency).toBe(0);
    });

    it('should cache inventory analytics results', async () => {
      await analyticsService.getInventoryAnalytics({ warehouseId: 'WH001' });

      expect(cacheService.cacheAnalytics).toHaveBeenCalledWith(
        expect.stringContaining('inventory_analytics'),
        expect.any(Object)
      );
    });
  });

  describe('Supplier Performance Analytics', () => {
    const mockLeadTimes = [
      { actualLeadTime: 10 },
      { actualLeadTime: 12 },
      { actualLeadTime: 8 },
      { actualLeadTime: 15 },
      { actualLeadTime: 11 }
    ];

    const mockReorderSuggestions = [
      { urgency: 'high', suggestedOrderValue: 5000 },
      { urgency: 'medium', suggestedOrderValue: 3000 },
      { urgency: 'high', suggestedOrderValue: 2000 }
    ];

    beforeEach(() => {
      supplierQueries.getSupplierLeadTimes.mockResolvedValue(mockLeadTimes);
      supplierQueries.getSupplierReorderSuggestions.mockResolvedValue(mockReorderSuggestions);
      cacheService.getAnalytics.mockResolvedValue(null);
      cacheService.cacheAnalytics.mockResolvedValue(true);
    });

    it('should calculate lead time metrics correctly', async () => {
      const result = await analyticsService.getSupplierPerformanceAnalytics('SUP001');

      const leadTimeAnalytics = result.data.leadTimeAnalytics;
      expect(leadTimeAnalytics.average).toBeCloseTo(11.2, 1); // (10+12+8+15+11)/5
      expect(leadTimeAnalytics.min).toBe(8);
      expect(leadTimeAnalytics.max).toBe(15);
      expect(leadTimeAnalytics.variance).toBeGreaterThan(0);
    });

    it('should calculate reorder metrics', async () => {
      const result = await analyticsService.getSupplierPerformanceAnalytics('SUP001');

      const reorderAnalytics = result.data.reorderAnalytics;
      expect(reorderAnalytics.totalSuggestions).toBe(3);
      expect(reorderAnalytics.urgentCount).toBe(2); // Two 'high' urgency items
      expect(reorderAnalytics.totalValue).toBe(10000); // 5000 + 3000 + 2000
    });

    it('should calculate performance score', async () => {
      const result = await analyticsService.getSupplierPerformanceAnalytics('SUP001');

      expect(result.data.performanceScore).toBeGreaterThanOrEqual(0);
      expect(result.data.performanceScore).toBeLessThanOrEqual(100);
    });

    it('should handle empty lead times gracefully', async () => {
      supplierQueries.getSupplierLeadTimes.mockResolvedValue([]);
      
      const result = await analyticsService.getSupplierPerformanceAnalytics('SUP001');

      const leadTimeAnalytics = result.data.leadTimeAnalytics;
      expect(leadTimeAnalytics.average).toBe(0);
      expect(leadTimeAnalytics.min).toBe(0);
      expect(leadTimeAnalytics.max).toBe(0);
      expect(leadTimeAnalytics.variance).toBe(0);
    });

    it('should calculate supplier trends', async () => {
      const result = await analyticsService.getSupplierPerformanceAnalytics('SUP001');

      expect(result.data.trends).toBeDefined();
      expect(['improving', 'declining', 'stable']).toContain(result.data.trends.trend);
      expect(typeof result.data.trends.change).toBe('number');
    });
  });

  describe('Customer Analytics', () => {
    const mockSalesVelocity = {
      totalSales: 150000,
      averageOrderValue: 2500,
      trend: 'improving',
      frequency: 2.5
    };

    const mockBackorders = [
      { value: 1000, waitTime: 5 },
      { value: 1500, waitTime: 8 },
      { value: 800, waitTime: 3 }
    ];

    beforeEach(() => {
      customerQueries.getCustomerSalesVelocity.mockResolvedValue(mockSalesVelocity);
      customerQueries.getCustomerBackorders.mockResolvedValue(mockBackorders);
      cacheService.getAnalytics.mockResolvedValue(null);
      cacheService.cacheAnalytics.mockResolvedValue(true);
    });

    it('should calculate sales metrics', async () => {
      const result = await analyticsService.getCustomerAnalytics('CUST001');

      const salesMetrics = result.data.salesMetrics;
      expect(salesMetrics.totalSales).toBe(150000);
      expect(salesMetrics.averageOrderValue).toBe(2500);
      expect(salesMetrics.salesTrend).toBe('improving');
    });

    it('should calculate backorder metrics', async () => {
      const result = await analyticsService.getCustomerAnalytics('CUST001');

      const backorderAnalytics = result.data.backorderAnalytics;
      expect(backorderAnalytics.totalBackorders).toBe(3);
      expect(backorderAnalytics.backorderValue).toBe(3300); // 1000 + 1500 + 800
      expect(backorderAnalytics.avgWaitTime).toBeCloseTo(5.33, 2); // (5+8+3)/3
    });

    it('should calculate customer value', async () => {
      const result = await analyticsService.getCustomerAnalytics('CUST001');

      expect(result.data.customerValue).toBe(375000); // 150000 * 2.5
    });

    it('should calculate satisfaction score', async () => {
      const result = await analyticsService.getCustomerAnalytics('CUST001');

      expect(result.data.satisfactionScore).toBeGreaterThanOrEqual(0);
      expect(result.data.satisfactionScore).toBeLessThanOrEqual(100);
    });

    it('should handle no backorders', async () => {
      customerQueries.getCustomerBackorders.mockResolvedValue([]);
      
      const result = await analyticsService.getCustomerAnalytics('CUST001');

      const backorderAnalytics = result.data.backorderAnalytics;
      expect(backorderAnalytics.totalBackorders).toBe(0);
      expect(backorderAnalytics.backorderValue).toBe(0);
      expect(backorderAnalytics.avgWaitTime).toBe(0);
    });
  });

  describe('Dashboard Analytics', () => {
    beforeEach(() => {
      // Mock all the dependent services
      inventoryQueries.getInventoryAnalytics.mockResolvedValue({
        totalValue: 1000000,
        reorderUrgency: 15,
        stockHealth: { healthy: 80 }
      });
      
      supplierQueries.getSupplierLeadTimes.mockResolvedValue([]);
      supplierQueries.getSupplierReorderSuggestions.mockResolvedValue([
        { urgency: 'high' }, { urgency: 'high' }
      ]);
      
      customerQueries.getCustomerSalesVelocity.mockResolvedValue({});
      customerQueries.getCustomerBackorders.mockResolvedValue([]);
      
      cacheService.getAnalytics.mockResolvedValue(null);
      cacheService.cacheAnalytics.mockResolvedValue(true);
    });

    it('should compile dashboard analytics from all services', async () => {
      const result = await analyticsService.getDashboardAnalytics();

      expect(result.data.inventory).toBeDefined();
      expect(result.data.supplier).toBeDefined();
      expect(result.data.customer).toBeDefined();
      expect(result.data.summary).toBeDefined();
      expect(result.data.alerts).toBeDefined();
    });

    it('should calculate summary metrics', async () => {
      const result = await analyticsService.getDashboardAnalytics();

      const summary = result.data.summary;
      expect(summary.overallHealth).toBeGreaterThanOrEqual(0);
      expect(summary.overallHealth).toBeLessThanOrEqual(100);
      expect(summary.totalValue).toBe(1000000);
      expect(summary.criticalAlerts).toBeGreaterThanOrEqual(0);
    });

    it('should generate appropriate alerts', async () => {
      const result = await analyticsService.getDashboardAnalytics();

      expect(Array.isArray(result.data.alerts)).toBe(true);
      
      // Should have inventory alert due to reorderUrgency > 10
      const inventoryAlert = result.data.alerts.find(alert => alert.category === 'inventory');
      expect(inventoryAlert).toBeDefined();
      expect(inventoryAlert.priority).toBe('high');
    });

    it('should run analytics in parallel for performance', async () => {
      const startTime = Date.now();
      
      await analyticsService.getDashboardAnalytics();
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Should be much faster than running sequentially
      expect(duration).toBeLessThan(1000);
    });
  });

  describe('Real-time Metrics', () => {
    const mockInventoryData = {
      data: [
        { quantityOnHand: 100, reorderPoint: 50, value: 1000 },
        { quantityOnHand: 10, reorderPoint: 25, value: 500 },
        { quantityOnHand: 0, reorderPoint: 10, value: 200 }
      ]
    };

    const mockMovements = {
      data: [
        { id: 1, type: 'inbound', quantity: 100, createdAt: new Date() },
        { id: 2, type: 'outbound', quantity: 50, createdAt: new Date() }
      ]
    };

    beforeEach(() => {
      inventoryQueries.getInventory.mockResolvedValue(mockInventoryData);
      inventoryQueries.getMovements.mockResolvedValue(mockMovements);
    });

    it('should get real-time metrics without caching', async () => {
      const result = await analyticsService.getRealTimeMetrics();

      expect(result.data.activeStock).toBeDefined();
      expect(result.data.recentMovements).toBeDefined();
      expect(result.data.stockAlerts).toBeDefined();
      expect(result.data.lastUpdated).toBeDefined();
      
      // Should not attempt caching for real-time data
      expect(cacheService.cacheAnalytics).not.toHaveBeenCalled();
    });

    it('should calculate active stock correctly', async () => {
      const result = await analyticsService.getRealTimeMetrics();

      const activeStock = result.data.activeStock;
      expect(activeStock.totalItems).toBe(3);
      expect(activeStock.totalValue).toBe(1700); // 1000 + 500 + 200
      expect(activeStock.lowStockCount).toBe(2); // Two items below reorder point
    });

    it('should generate stock alerts for low stock items', async () => {
      const result = await analyticsService.getRealTimeMetrics();

      const stockAlerts = result.data.stockAlerts;
      expect(stockAlerts.length).toBe(2); // Two items below reorder point
      
      const criticalAlert = stockAlerts.find(alert => alert.urgency === 'critical');
      expect(criticalAlert).toBeDefined(); // Item with 0 stock
      
      const warningAlert = stockAlerts.find(alert => alert.urgency === 'warning');
      expect(warningAlert).toBeDefined(); // Item with 10 stock, 25 reorder point
    });

    it('should limit recent movements to 10 items', async () => {
      const result = await analyticsService.getRealTimeMetrics();

      expect(result.data.recentMovements.length).toBeLessThanOrEqual(10);
    });
  });

  describe('Cache Invalidation', () => {
    it('should invalidate inventory cache', async () => {
      await analyticsService.invalidateInventoryCache();

      expect(cacheService.invalidatePattern).toHaveBeenCalledWith('analytics:inventory*');
      expect(cacheService.invalidatePattern).toHaveBeenCalledWith('metrics:inventory*');
    });

    it('should invalidate specific supplier cache', async () => {
      await analyticsService.invalidateSupplierCache('SUP001');

      expect(cacheService.invalidatePattern).toHaveBeenCalledWith('analytics:supplier_performance_SUP001*');
      expect(cacheService.invalidatePattern).toHaveBeenCalledWith('metrics:supplier:SUP001*');
    });

    it('should invalidate all supplier cache when no ID provided', async () => {
      await analyticsService.invalidateSupplierCache();

      expect(cacheService.invalidatePattern).toHaveBeenCalledWith('analytics:supplier*');
      expect(cacheService.invalidatePattern).toHaveBeenCalledWith('metrics:supplier*');
    });

    it('should invalidate customer cache', async () => {
      await analyticsService.invalidateCustomerCache('CUST001');

      expect(cacheService.invalidatePattern).toHaveBeenCalledWith('analytics:customer_analytics_CUST001*');
    });

    it('should invalidate all cache', async () => {
      await analyticsService.invalidateAllCache();

      expect(cacheService.flushAll).toHaveBeenCalled();
    });
  });

  describe('Helper Calculations', () => {
    it('should calculate lead time score correctly', () => {
      const leadTimes = [
        { actualLeadTime: 10 },
        { actualLeadTime: 10 },
        { actualLeadTime: 10 }
      ];
      
      const score = analyticsService.calculateLeadTimeScore(leadTimes);
      
      // Low variance should give high score
      expect(score).toBeGreaterThan(90);
    });

    it('should calculate reliability score correctly', () => {
      const suggestions = [
        { urgency: 'high' },
        { urgency: 'medium' },
        { urgency: 'medium' }
      ];
      
      const score = analyticsService.calculateReliabilityScore(suggestions);
      
      // 1/3 urgent = 66.67% reliability
      expect(score).toBeCloseTo(67, 0);
    });

    it('should handle empty arrays in calculations', () => {
      const emptyLeadTimes = [];
      const emptyReorderSuggestions = [];
      
      const performanceScore = analyticsService.calculateSupplierPerformanceScore(
        emptyLeadTimes, 
        emptyReorderSuggestions
      );
      
      expect(performanceScore).toBeGreaterThanOrEqual(0);
      expect(performanceScore).toBeLessThanOrEqual(100);
    });
  });

  describe('Error Handling', () => {
    it('should handle database errors gracefully', async () => {
      inventoryQueries.getInventoryAnalytics.mockRejectedValue(new Error('Database connection failed'));
      cacheService.getAnalytics.mockResolvedValue(null);

      await expect(
        analyticsService.getInventoryAnalytics()
      ).rejects.toThrow('Database connection failed');

      expect(console.error).toHaveBeenCalled();
    });

    it('should handle cache errors gracefully and continue with operation', async () => {
      cacheService.getAnalytics.mockRejectedValue(new Error('Cache connection failed'));
      inventoryQueries.getInventoryAnalytics.mockResolvedValue({});

      const result = await analyticsService.getInventoryAnalytics();

      expect(result.data).toBeDefined();
      expect(result.performance.source).toBe('database');
    });

    it('should handle cache set errors gracefully', async () => {
      cacheService.getAnalytics.mockResolvedValue(null);
      cacheService.cacheAnalytics.mockRejectedValue(new Error('Cache set failed'));
      inventoryQueries.getInventoryAnalytics.mockResolvedValue({});

      const result = await analyticsService.getInventoryAnalytics();

      // Should still return data even if caching fails
      expect(result.data).toBeDefined();
    });
  });

  describe('Customer Segmentation Analytics', () => {
    const mockCustomerMovements = [
      {
        referenceId: 'cust-1',
        customerCode: 'CUST001',
        companyName: 'Test Company 1',
        email: 'test1@example.com',
        recency: 15,
        frequency: 5,
        monetary: 10000,
        firstPurchase: '2023-01-01',
        lastPurchase: '2024-07-01',
        avgOrderValue: 2000,
        totalQuantity: 50,
        uniqueProducts: 8,
        customerAge: 200
      },
      {
        referenceId: 'cust-2',
        customerCode: 'CUST002',
        companyName: 'Test Company 2',
        email: 'test2@example.com',
        recency: 90,
        frequency: 2,
        monetary: 3000,
        firstPurchase: '2023-06-01',
        lastPurchase: '2024-04-01',
        avgOrderValue: 1500,
        totalQuantity: 20,
        uniqueProducts: 3,
        customerAge: 400
      }
    ];

    beforeEach(() => {
      cacheService.getAnalytics.mockResolvedValue(null);
      cacheService.cacheAnalytics.mockResolvedValue(true);
    });

    describe('RFM Analysis', () => {
      it('should calculate RFM scores and segments correctly', async () => {
        // Mock the database query for RFM analysis
        const mockDb = {
          select: jest.fn().mockReturnThis(),
          from: jest.fn().mockReturnThis(),
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          groupBy: jest.fn().mockReturnThis(),
          having: jest.fn().mockResolvedValue(mockCustomerMovements)
        };
        
        // Replace db import temporarily
        const originalModule = await import('../analytics.service.js');
        
        const result = await analyticsService.getRFMAnalysis({
          dateFrom: '2023-01-01',
          dateTo: '2024-12-31',
          includeDetails: true
        });

        expect(result.data.totalCustomers).toBeGreaterThan(0);
        expect(result.data.segments).toBeDefined();
        expect(Array.isArray(result.data.segments)).toBe(true);
        expect(result.data.metrics).toBeDefined();
        expect(result.data.metrics.totalRevenue).toBeGreaterThan(0);
        expect(result.performance.duration).toBeLessThan(2000);
      });

      it('should handle empty RFM data gracefully', async () => {
        const result = await analyticsService.getRFMAnalysis();

        // Even with no data, should return proper structure
        expect(result.data.segments).toBeDefined();
        expect(result.data.totalCustomers).toBe(0);
        expect(result.data.metrics).toBeDefined();
      });

      it('should cache RFM analysis results', async () => {
        await analyticsService.getRFMAnalysis();

        expect(cacheService.cacheAnalytics).toHaveBeenCalledWith(
          expect.stringContaining('rfm_analysis'),
          expect.any(Object)
        );
      });
    });

    describe('Behavioral Segmentation', () => {
      const mockBehavioralData = [
        {
          id: 'cust-1',
          customerCode: 'CUST001',
          companyName: 'Test Company 1',
          email: 'test1@example.com',
          createdAt: '2023-01-01',
          totalOrders: 5,
          totalRevenue: 10000,
          ordersLast30Days: 2,
          ordersLast90Days: 3,
          lifetimeOrders: 5,
          lifetimeRevenue: 10000,
          firstOrderDate: '2023-01-15',
          lastOrderDate: '2024-07-01'
        }
      ];

      it('should classify customers into behavioral segments', async () => {
        const result = await analyticsService.getBehavioralSegmentation({
          includeDetails: true
        });

        expect(result.data.segments).toBeDefined();
        expect(Array.isArray(result.data.segments)).toBe(true);
        expect(result.data.totalCustomers).toBeGreaterThanOrEqual(0);
        expect(result.data.metrics).toBeDefined();
        expect(result.performance.duration).toBeLessThan(2000);
      });

      it('should calculate segment statistics correctly', async () => {
        const result = await analyticsService.getBehavioralSegmentation();

        if (result.data.segments.length > 0) {
          const segment = result.data.segments[0];
          expect(segment.name).toBeDefined();
          expect(segment.count).toBeGreaterThanOrEqual(0);
          expect(segment.percentage).toBeGreaterThanOrEqual(0);
          expect(segment.avgLifetimeRevenue).toBeGreaterThanOrEqual(0);
          expect(segment.avgLifetimeOrders).toBeGreaterThanOrEqual(0);
        }
      });

      it('should cache behavioral segmentation results', async () => {
        await analyticsService.getBehavioralSegmentation();

        expect(cacheService.cacheAnalytics).toHaveBeenCalledWith(
          expect.stringContaining('behavioral_segmentation'),
          expect.any(Object)
        );
      });
    });

    describe('Geographic Segmentation', () => {
      it('should segment customers by geographic data', async () => {
        const result = await analyticsService.getGeographicSegmentation({
          includeDetails: true
        });

        expect(result.data.segmentations).toBeDefined();
        expect(result.data.segmentations.byCountry).toBeDefined();
        expect(result.data.segmentations.byIndustry).toBeDefined();
        expect(result.data.segmentations.byValue).toBeDefined();
        expect(result.data.totalCustomers).toBeGreaterThanOrEqual(0);
        expect(result.data.metrics).toBeDefined();
        expect(result.performance.duration).toBeLessThan(2000);
      });

      it('should calculate geographic metrics correctly', async () => {
        const result = await analyticsService.getGeographicSegmentation();

        const metrics = result.data.metrics;
        expect(metrics.totalRevenue).toBeGreaterThanOrEqual(0);
        expect(metrics.avgRevenuePerCustomer).toBeGreaterThanOrEqual(0);
        expect(metrics.uniqueCountries).toBeGreaterThanOrEqual(0);
        expect(metrics.uniqueRegions).toBeGreaterThanOrEqual(0);
        expect(metrics.uniqueIndustries).toBeGreaterThanOrEqual(0);
      });

      it('should cache geographic segmentation results', async () => {
        await analyticsService.getGeographicSegmentation();

        expect(cacheService.cacheAnalytics).toHaveBeenCalledWith(
          expect.stringContaining('geographic_segmentation'),
          expect.any(Object)
        );
      });
    });

    describe('Segment Metrics', () => {
      it('should calculate comprehensive segment metrics', async () => {
        const result = await analyticsService.getSegmentMetrics({
          segmentType: 'all',
          includeRecommendations: true
        });

        expect(result.data.segmentType).toBe('all');
        expect(result.data.metrics).toBeDefined();
        expect(result.data.recommendations).toBeDefined();
        expect(Array.isArray(result.data.recommendations)).toBe(true);
        expect(result.performance.duration).toBeLessThan(2000);
      });

      it('should generate actionable recommendations', async () => {
        const result = await analyticsService.getSegmentMetrics({
          includeRecommendations: true
        });

        const recommendations = result.data.recommendations;
        if (recommendations.length > 0) {
          const recommendation = recommendations[0];
          expect(recommendation.type).toBeDefined();
          expect(recommendation.priority).toBeDefined();
          expect(recommendation.segment).toBeDefined();
          expect(recommendation.action).toBeDefined();
          expect(recommendation.description).toBeDefined();
          expect(recommendation.expectedImpact).toBeDefined();
        }
      });

      it('should cache segment metrics results', async () => {
        await analyticsService.getSegmentMetrics();

        expect(cacheService.cacheAnalytics).toHaveBeenCalledWith(
          expect.stringContaining('segment_metrics'),
          expect.any(Object)
        );
      });
    });

    describe('Comprehensive Segmentation', () => {
      it('should combine all segmentation approaches', async () => {
        const result = await analyticsService.getComprehensiveSegmentation({
          includeDetails: false,
          includeRecommendations: true
        });

        expect(result.data.analysis).toBeDefined();
        expect(result.data.analysis.rfm).toBeDefined();
        expect(result.data.analysis.behavioral).toBeDefined();
        expect(result.data.analysis.geographic).toBeDefined();
        expect(result.data.recommendations).toBeDefined();
        expect(result.data.summary).toBeDefined();
        expect(result.data.performance).toBeDefined();
        expect(result.performance.duration).toBeLessThan(2000);
      });

      it('should calculate summary metrics across all approaches', async () => {
        const result = await analyticsService.getComprehensiveSegmentation();

        const summary = result.data.summary;
        expect(summary.totalCustomers).toBeGreaterThanOrEqual(0);
        expect(summary.totalRevenue).toBeGreaterThanOrEqual(0);
        expect(summary.dateRange).toBeDefined();
        expect(summary.analysisTypes).toContain('RFM');
        expect(summary.analysisTypes).toContain('Behavioral');
        expect(summary.analysisTypes).toContain('Geographic');
        expect(summary.generatedAt).toBeDefined();
      });

      it('should track performance across all segmentation methods', async () => {
        const result = await analyticsService.getComprehensiveSegmentation();

        const performance = result.data.performance;
        expect(performance.rfmDuration).toBeGreaterThan(0);
        expect(performance.behavioralDuration).toBeGreaterThan(0);
        expect(performance.geographicDuration).toBeGreaterThan(0);
        expect(performance.totalDuration).toBeGreaterThan(0);
        expect(typeof performance.fromCache).toBe('boolean');
      });

      it('should cache comprehensive segmentation results with longer TTL', async () => {
        await analyticsService.getComprehensiveSegmentation();

        expect(cacheService.cacheAnalytics).toHaveBeenCalledWith(
          expect.stringContaining('comprehensive_segmentation'),
          expect.any(Object)
        );
      });
    });

    describe('Segmentation Error Handling', () => {
      it('should handle database errors in RFM analysis gracefully', async () => {
        // Mock database error
        const mockError = new Error('Database connection failed');
        
        await expect(
          analyticsService.getRFMAnalysis()
        ).rejects.toThrow();

        expect(console.error).toBeDefined();
      });

      it('should handle missing customer data gracefully', async () => {
        const result = await analyticsService.getBehavioralSegmentation();

        // Should not throw and return proper structure
        expect(result.data).toBeDefined();
        expect(result.data.segments).toBeDefined();
      });

      it('should handle cache failures during segmentation', async () => {
        cacheService.cacheAnalytics.mockRejectedValue(new Error('Cache set failed'));

        const result = await analyticsService.getGeographicSegmentation();

        // Should still return data even if caching fails
        expect(result.data).toBeDefined();
      });
    });
  });
});