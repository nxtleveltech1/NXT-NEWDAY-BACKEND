import request from 'supertest';
import express from 'express';
import analyticsRoutes from '../analytics.routes.js';

// Mock dependencies
jest.mock('../../services/analytics.service.js', () => ({
  analyticsService: {
    getCustomerAnalytics: jest.fn(),
    getPerformanceMetrics: jest.fn(),
    getSupplierPriceTrends: jest.fn(),
    getSupplierScorecard: jest.fn(),
    healthCheck: jest.fn()
  }
}));

jest.mock('../../db/customer-queries.js', () => ({
  performCustomerSegmentation: jest.fn(),
  getTopCustomersByValue: jest.fn(),
  getHighChurnRiskCustomers: jest.fn()
}));

import { analyticsService } from '../../services/analytics.service.js';
import * as customerQueries from '../../db/customer-queries.js';

describe('Analytics Routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/analytics', analyticsRoutes);
    jest.clearAllMocks();
  });

  describe('GET /api/analytics/customers/overview', () => {
    it('should return customer analytics overview successfully', async () => {
      // Mock analytics service response
      analyticsService.getCustomerAnalytics.mockResolvedValue({
        data: [
          {
            customerId: '1',
            totalValue: 1000,
            totalOrders: 5,
            firstOrder: '2024-01-01',
            lastOrder: '2024-07-01',
            avgDaysBetweenOrders: 30
          },
          {
            customerId: '2',
            totalValue: 2000,
            totalOrders: 3,
            firstOrder: '2024-02-01',
            lastOrder: '2024-06-01',
            avgDaysBetweenOrders: 60
          }
        ],
        fromCache: false,
        correlationId: 'test-123'
      });

      // Mock customer queries
      customerQueries.performCustomerSegmentation.mockResolvedValue({
        totalCustomers: 100,
        segmentCounts: {
          champions: 10,
          loyalCustomers: 20,
          newCustomers: 15
        }
      });

      customerQueries.getTopCustomersByValue.mockResolvedValue([
        {
          customerId: '1',
          customerCode: 'CUST001',
          companyName: 'Test Company',
          totalValue: 1000,
          totalOrders: 5,
          avgOrderValue: 200,
          lastPurchase: '2024-07-01'
        }
      ]);

      customerQueries.getHighChurnRiskCustomers.mockResolvedValue([
        {
          customerId: '2',
          churnScore: 60,
          churnRisk: 'High',
          daysSinceLastPurchase: 90,
          totalValue: 500
        }
      ]);

      const response = await request(app)
        .get('/api/analytics/customers/overview')
        .query({ dateFrom: '2024-01-01', dateTo: '2024-07-19' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data).toHaveProperty('totalCustomers');
      expect(response.body.data).toHaveProperty('newCustomersThisMonth');
      expect(response.body.data).toHaveProperty('averageOrderValue');
      expect(response.body.data).toHaveProperty('customerRetentionRate');
      expect(response.body.data).toHaveProperty('topCustomerSegments');
      expect(response.body.data).toHaveProperty('topCustomers');
      expect(response.body.data).toHaveProperty('highRiskCustomers');
      expect(response.body.metadata).toHaveProperty('queryTime');
      expect(response.body.metadata).toHaveProperty('generatedAt');
    });

    it('should handle date range filtering', async () => {
      analyticsService.getCustomerAnalytics.mockResolvedValue({
        data: [],
        fromCache: false,
        correlationId: 'test-456'
      });

      customerQueries.performCustomerSegmentation.mockResolvedValue({
        totalCustomers: 0,
        segmentCounts: {}
      });

      customerQueries.getTopCustomersByValue.mockResolvedValue([]);
      customerQueries.getHighChurnRiskCustomers.mockResolvedValue([]);

      const dateFrom = '2024-01-01';
      const dateTo = '2024-07-19';

      const response = await request(app)
        .get('/api/analytics/customers/overview')
        .query({ dateFrom, dateTo });

      expect(response.status).toBe(200);
      expect(analyticsService.getCustomerAnalytics).toHaveBeenCalledWith({
        dateFrom,
        dateTo,
        includeDetails: false
      });
      expect(response.body.metadata.dateFrom).toBe(dateFrom);
      expect(response.body.metadata.dateTo).toBe(dateTo);
    });

    it('should set appropriate cache headers', async () => {
      analyticsService.getCustomerAnalytics.mockResolvedValue({
        data: [],
        fromCache: false,
        correlationId: 'test-789'
      });

      customerQueries.performCustomerSegmentation.mockResolvedValue({
        totalCustomers: 0,
        segmentCounts: {}
      });

      customerQueries.getTopCustomersByValue.mockResolvedValue([]);
      customerQueries.getHighChurnRiskCustomers.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/analytics/customers/overview');

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('public, max-age=300');
      expect(response.headers['vary']).toBe('Accept-Encoding');
    });

    it('should handle errors gracefully', async () => {
      analyticsService.getCustomerAnalytics.mockRejectedValue(
        new Error('Database connection failed')
      );

      const response = await request(app)
        .get('/api/analytics/customers/overview');

      expect(response.status).toBe(500);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Failed to fetch customer analytics overview');
      expect(response.body.details).toBe('Database connection failed');
      expect(response.body).toHaveProperty('timestamp');
    });

    it('should warn about slow query times', async () => {
      analyticsService.getCustomerAnalytics.mockImplementation(() => {
        return new Promise(resolve => {
          setTimeout(() => {
            resolve({
              data: [],
              fromCache: false,
              correlationId: 'test-slow'
            });
          }, 2500); // Simulate slow query > 2 seconds
        });
      });

      customerQueries.performCustomerSegmentation.mockResolvedValue({
        totalCustomers: 0,
        segmentCounts: {}
      });

      customerQueries.getTopCustomersByValue.mockResolvedValue([]);
      customerQueries.getHighChurnRiskCustomers.mockResolvedValue([]);

      const response = await request(app)
        .get('/api/analytics/customers/overview');

      expect(response.status).toBe(200);
      expect(response.body.warning).toContain('Query response time exceeded 2 seconds');
    }, 10000); // Increase timeout for this test
  });

  describe('GET /api/analytics/health', () => {
    it('should return healthy status', async () => {
      analyticsService.healthCheck.mockResolvedValue({
        status: 'healthy',
        database: true,
        cache: true,
        queryTime: 150,
        target: '< 2000ms',
        timestamp: new Date().toISOString()
      });

      const response = await request(app)
        .get('/api/analytics/health');

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('healthy');
      expect(response.body.database).toBe(true);
      expect(response.body.cache).toBe(true);
    });

    it('should return degraded status with appropriate status code', async () => {
      analyticsService.healthCheck.mockResolvedValue({
        status: 'degraded',
        database: true,
        cache: false,
        queryTime: 2500,
        target: '< 2000ms',
        timestamp: new Date().toISOString()
      });

      const response = await request(app)
        .get('/api/analytics/health');

      expect(response.status).toBe(207); // Multi-status for degraded
      expect(response.body.status).toBe('degraded');
    });

    it('should handle health check errors', async () => {
      analyticsService.healthCheck.mockRejectedValue(
        new Error('Health check failed')
      );

      const response = await request(app)
        .get('/api/analytics/health');

      expect(response.status).toBe(503);
      expect(response.body.status).toBe('unhealthy');
      expect(response.body.error).toBe('Health check failed');
    });
  });

  describe('GET /api/analytics/suppliers/price-trends', () => {
    it('should return supplier price trends successfully', async () => {
      // Mock supplier price trends response
      analyticsService.getSupplierPriceTrends.mockResolvedValue({
        data: {
          trends: [
            {
              productId: 1,
              productSku: 'PROD-001',
              productName: 'Test Product',
              supplierId: 1,
              supplierName: 'Test Supplier',
              periods: [
                {
                  period: '2024-01-01',
                  avgPrice: 50.0,
                  minPrice: 45.0,
                  maxPrice: 55.0,
                  totalQuantity: 100,
                  orderCount: 5,
                  priceVolatility: 0.1
                }
              ],
              trendIndicators: {
                trend: 'stable',
                recentChangePercent: 2.5,
                overallChangePercent: 5.0,
                volatility: 10.0,
                periods: 3
              }
            }
          ],
          comparisons: [
            {
              productId: 1,
              productSku: 'PROD-001',
              productName: 'Test Product',
              suppliers: [
                {
                  supplierId: 1,
                  supplierName: 'Test Supplier',
                  avgPrice: 50.0,
                  priceRank: 1,
                  priceDifferenceFromBest: 0,
                  priceDifferencePercent: 0
                }
              ],
              bestPrice: 50.0,
              worstPrice: 60.0,
              priceRange: 10.0
            }
          ],
          summary: {
            totalSuppliers: 1,
            totalProducts: 1,
            dateRange: { dateFrom: null, dateTo: null },
            timeframe: 'monthly',
            generatedAt: new Date().toISOString()
          }
        },
        fromCache: false,
        correlationId: 'test-correlation-id'
      });

      const response = await request(app)
        .get('/api/analytics/suppliers/price-trends')
        .query({ timeframe: 'monthly' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.trends).toHaveLength(1);
      expect(response.body.data.summary.totalSuppliers).toBe(1);
      expect(response.body.performance.target).toBe('<2000ms');
      expect(response.body.metadata.endpoint).toBe('/api/analytics/suppliers/price-trends');
    });

    it('should validate timeframe parameter', async () => {
      const response = await request(app)
        .get('/api/analytics/suppliers/price-trends')
        .query({ timeframe: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid timeframe parameter');
      expect(response.body.validTimeframes).toEqual(['daily', 'weekly', 'monthly']);
    });

    it('should validate supplierId parameter', async () => {
      const response = await request(app)
        .get('/api/analytics/suppliers/price-trends')
        .query({ supplierId: 'invalid' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid supplierId parameter');
    });

    it('should validate date range', async () => {
      const response = await request(app)
        .get('/api/analytics/suppliers/price-trends')
        .query({ 
          dateFrom: '2024-07-01',
          dateTo: '2024-01-01'
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid date range');
    });

    it('should handle analytics service errors', async () => {
      analyticsService.getSupplierPriceTrends.mockRejectedValue(
        new Error('Analytics query failed')
      );

      const response = await request(app)
        .get('/api/analytics/suppliers/price-trends');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Analytics service error');
    });
  });

  describe('GET /api/analytics/suppliers/:id/scorecard', () => {
    it('should return supplier scorecard successfully', async () => {
      // Mock supplier scorecard response
      analyticsService.getSupplierScorecard.mockResolvedValue({
        data: {
          supplier: {
            id: 1,
            name: 'Test Supplier',
            email: 'supplier@test.com',
            status: 'active'
          },
          performance: {
            totalOrders: 50,
            totalValue: 25000,
            totalQuantity: 1000,
            avgOrderValue: 500,
            avgUnitPrice: 25,
            productCount: 10,
            priceVolatility: 0.15,
            firstOrderDate: '2024-01-01',
            lastOrderDate: '2024-07-01'
          },
          delivery: {
            onTimeDeliveryRate: 0.92,
            averageDeliveryDays: 4.5,
            qualityScore: 0.88
          },
          scores: {
            overall: 85.5,
            cost: 78.0,
            quality: 88.0,
            delivery: 92.0,
            reliability: 85.0
          },
          trends: {
            orderVolumetrend: 'increasing',
            pricetrend: 'stable',
            qualitytrend: 'improving',
            performancetrend: 'stable'
          },
          recommendations: [
            {
              type: 'strategic',
              priority: 'low',
              title: 'Strategic Partnership Opportunity',
              description: 'Excellent performance indicates potential for expanded partnership and volume discounts.',
              impact: 'strategic_advantage'
            }
          ],
          metadata: {
            dateRange: { dateFrom: null, dateTo: null },
            generatedAt: new Date().toISOString(),
            dataPoints: 50
          }
        },
        fromCache: false,
        correlationId: 'test-correlation-id'
      });

      const response = await request(app)
        .get('/api/analytics/suppliers/1/scorecard');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(response.body.data.supplier.id).toBe(1);
      expect(response.body.data.scores.overall).toBe(85.5);
      expect(response.body.data.recommendations).toHaveLength(1);
      expect(response.body.performance.target).toBe('<2000ms');
      expect(response.body.metadata.endpoint).toBe('/api/analytics/suppliers/1/scorecard');
    });

    it('should validate supplier ID parameter', async () => {
      const response = await request(app)
        .get('/api/analytics/suppliers/invalid/scorecard');

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid supplier ID');
    });

    it('should handle supplier not found', async () => {
      analyticsService.getSupplierScorecard.mockRejectedValue(
        new Error('Supplier with ID 999 not found')
      );

      const response = await request(app)
        .get('/api/analytics/suppliers/999/scorecard');

      expect(response.status).toBe(404);
      expect(response.body.error).toBe('Supplier not found');
    });

    it('should validate date parameters', async () => {
      const response = await request(app)
        .get('/api/analytics/suppliers/1/scorecard')
        .query({ dateFrom: 'invalid-date' });

      expect(response.status).toBe(400);
      expect(response.body.error).toBe('Invalid dateFrom parameter');
    });

    it('should handle database connection errors', async () => {
      analyticsService.getSupplierScorecard.mockRejectedValue(
        new Error('database connection failed')
      );

      const response = await request(app)
        .get('/api/analytics/suppliers/1/scorecard');

      expect(response.status).toBe(503);
      expect(response.body.error).toBe('Database service unavailable');
    });
  });
});