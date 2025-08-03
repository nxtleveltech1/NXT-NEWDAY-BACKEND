import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';
import express from 'express';
import customerRoutes from '../customer.routes.js';

// Mock the customer service
jest.mock('../../services/customer.service.js', () => ({
  CustomerService: {
    createCustomer: jest.fn(),
    getCustomerById: jest.fn(),
    getCustomerByCode: jest.fn(),
    getAllCustomers: jest.fn(),
    updateCustomer: jest.fn(),
    updateCustomerMetadata: jest.fn(),
    deleteCustomer: jest.fn(),
    processSale: jest.fn(),
    getCustomerAnalytics: jest.fn(),
    searchCustomers: jest.fn(),
    getAnalyticsOverview: jest.fn(),
    getCustomerSegmentation: jest.fn(),
    getHighValueCustomers: jest.fn(),
    reserveStock: jest.fn(),
    releaseReservation: jest.fn(),
    getCustomerBackorders: jest.fn()
  }
}));

import { CustomerService } from '../../services/customer.service.js';

/**
 * Skipped: unit/mocked test file, not allowed under integration-only test policy.
 */
describe.skip('Customer Routes', () => {
  let app;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use('/api/customers', customerRoutes);
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  describe('GET /api/customers', () => {
    it('should return paginated customers', async () => {
      const mockResponse = {
        success: true,
        data: {
          customers: [
            { id: 'uuid-1', customerCode: 'CUST001', companyName: 'Company 1' },
            { id: 'uuid-2', customerCode: 'CUST002', companyName: 'Company 2' }
          ],
          pagination: {
            page: 1,
            pageSize: 10,
            totalCount: 2,
            totalPages: 1,
            hasNext: false,
            hasPrev: false
          }
        }
      };

      CustomerService.getAllCustomers.mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/api/customers')
        .expect(200);

      expect(response.body).toEqual(mockResponse);
      expect(CustomerService.getAllCustomers).toHaveBeenCalledWith({
        page: 1,
        pageSize: 10,
        search: undefined,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });
    });

    it('should handle query parameters', async () => {
      const mockResponse = {
        success: true,
        data: {
          customers: [],
          pagination: {
            page: 2,
            pageSize: 5,
            totalCount: 0,
            totalPages: 0,
            hasNext: false,
            hasPrev: true
          }
        }
      };

      CustomerService.getAllCustomers.mockResolvedValue(mockResponse);

      await request(app)
        .get('/api/customers?page=2&pageSize=5&search=test&sortBy=companyName&sortOrder=asc')
        .expect(200);

      expect(CustomerService.getAllCustomers).toHaveBeenCalledWith({
        page: 2,
        pageSize: 5,
        search: 'test',
        sortBy: 'companyName',
        sortOrder: 'asc'
      });
    });

    it('should handle service errors', async () => {
      CustomerService.getAllCustomers.mockResolvedValue({
        success: false,
        error: 'Database error',
        message: 'Failed to retrieve customers'
      });

      const response = await request(app)
        .get('/api/customers')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Database error');
    });
  });

  describe('GET /api/customers/:id', () => {
    it('should return customer by ID', async () => {
      const mockCustomer = {
        success: true,
        data: {
          id: 'uuid-123',
          customerCode: 'CUST001',
          companyName: 'Test Company',
          email: 'test@company.com'
        }
      };

      CustomerService.getCustomerById.mockResolvedValue(mockCustomer);

      const response = await request(app)
        .get('/api/customers/uuid-123')
        .expect(200);

      expect(response.body).toEqual(mockCustomer);
      expect(CustomerService.getCustomerById).toHaveBeenCalledWith('uuid-123');
    });

    it('should return 404 when customer not found', async () => {
      CustomerService.getCustomerById.mockResolvedValue({
        success: false,
        error: 'Customer not found',
        message: 'Customer not found'
      });

      const response = await request(app)
        .get('/api/customers/non-existent-id')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Customer not found');
    });
  });

  describe('POST /api/customers', () => {
    it('should create customer successfully', async () => {
      const customerData = {
        customerCode: 'CUST001',
        companyName: 'Test Company',
        email: 'test@company.com',
        phone: '123-456-7890',
        address: { street: '123 Main St' },
        metadata: { contactPerson: 'John Doe' }
      };

      const mockResponse = {
        success: true,
        data: {
          id: 'uuid-123',
          ...customerData,
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString()
        },
        message: 'Customer created successfully'
      };

      CustomerService.createCustomer.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/customers')
        .send(customerData)
        .expect(201);

      expect(response.body).toEqual(mockResponse);
      expect(CustomerService.createCustomer).toHaveBeenCalledWith(customerData);
    });

    it('should return 400 for validation errors', async () => {
      const invalidData = {
        companyName: 'Test Company'
        // Missing required fields
      };

      CustomerService.createCustomer.mockResolvedValue({
        success: false,
        error: 'customerCode is required',
        message: 'Failed to create customer'
      });

      const response = await request(app)
        .post('/api/customers')
        .send(invalidData)
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('customerCode is required');
    });
  });

  describe('PUT /api/customers/:id', () => {
    it('should update customer successfully', async () => {
      const updateData = {
        companyName: 'Updated Company',
        phone: '987-654-3210'
      };

      const mockResponse = {
        success: true,
        data: {
          id: 'uuid-123',
          customerCode: 'CUST001',
          ...updateData,
          updatedAt: new Date().toISOString()
        },
        message: 'Customer updated successfully'
      };

      CustomerService.updateCustomer.mockResolvedValue(mockResponse);

      const response = await request(app)
        .put('/api/customers/uuid-123')
        .send(updateData)
        .expect(200);

      expect(response.body).toEqual(mockResponse);
      expect(CustomerService.updateCustomer).toHaveBeenCalledWith('uuid-123', updateData);
    });

    it('should return 404 when customer not found', async () => {
      CustomerService.updateCustomer.mockResolvedValue({
        success: false,
        error: 'Customer not found',
        message: 'Failed to update customer'
      });

      const response = await request(app)
        .put('/api/customers/non-existent-id')
        .send({ companyName: 'Updated' })
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Customer not found');
    });
  });

  describe('DELETE /api/customers/:id', () => {
    it('should delete customer successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          id: 'uuid-123',
          metadata: { isActive: false, deletedAt: new Date().toISOString() }
        },
        message: 'Customer deleted successfully'
      };

      CustomerService.deleteCustomer.mockResolvedValue(mockResponse);

      const response = await request(app)
        .delete('/api/customers/uuid-123')
        .expect(200);

      expect(response.body).toEqual(mockResponse);
      expect(CustomerService.deleteCustomer).toHaveBeenCalledWith('uuid-123');
    });

    it('should return 404 when customer not found', async () => {
      CustomerService.deleteCustomer.mockResolvedValue({
        success: false,
        error: 'Customer not found',
        message: 'Failed to delete customer'
      });

      const response = await request(app)
        .delete('/api/customers/non-existent-id')
        .expect(404);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Customer not found');
    });
  });

  describe('GET /api/customers/:id/metadata', () => {
    it('should return customer metadata', async () => {
      const mockCustomer = {
        success: true,
        data: {
          id: 'uuid-123',
          metadata: {
            basicInfo: { contactPerson: 'John Doe' },
            businessInfo: { taxId: 'TAX123' },
            preferences: { currency: 'USD' },
            customFields: { custom1: 'value1' }
          }
        }
      };

      CustomerService.getCustomerById.mockResolvedValue(mockCustomer);

      const response = await request(app)
        .get('/api/customers/uuid-123/metadata')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toEqual(mockCustomer.data.metadata);
    });
  });

  describe('PUT /api/customers/:id/metadata', () => {
    it('should update customer metadata', async () => {
      const metadataUpdate = {
        basicInfo: { contactPerson: 'Jane Doe' },
        customFields: { newField: 'newValue' }
      };

      const mockResponse = {
        success: true,
        data: {
          id: 'uuid-123',
          metadata: {
            basicInfo: { contactPerson: 'Jane Doe' },
            businessInfo: {},
            preferences: {},
            customFields: { newField: 'newValue' }
          }
        },
        message: 'Customer metadata updated successfully'
      };

      CustomerService.updateCustomerMetadata.mockResolvedValue(mockResponse);

      const response = await request(app)
        .put('/api/customers/uuid-123/metadata')
        .send(metadataUpdate)
        .expect(200);

      expect(response.body).toEqual(mockResponse);
      expect(CustomerService.updateCustomerMetadata).toHaveBeenCalledWith('uuid-123', metadataUpdate);
    });
  });

  describe('GET /api/customers/:id/analytics', () => {
    it('should return customer analytics', async () => {
      const mockAnalytics = {
        success: true,
        data: {
          customerLifetimeValue: { historicalCLV: 5000 },
          averageOrderValue: { averageOrderValue: 250 },
          purchaseFrequency: { avgDaysBetweenOrders: 30 },
          churnRisk: { churnScore: 25 },
          salesVelocity: { totalQuantitySold: 100 }
        }
      };

      CustomerService.getCustomerAnalytics.mockResolvedValue(mockAnalytics);

      const response = await request(app)
        .get('/api/customers/uuid-123/analytics')
        .expect(200);

      expect(response.body).toEqual(mockAnalytics);
      expect(CustomerService.getCustomerAnalytics).toHaveBeenCalledWith('uuid-123');
    });
  });

  describe('POST /api/customers/:id/sales', () => {
    it('should process sale successfully', async () => {
      const saleData = {
        items: [
          {
            productId: 'prod-1',
            warehouseId: 'wh-1',
            quantity: 5,
            unitPrice: 10.50
          }
        ],
        referenceNumber: 'SALE-001',
        notes: 'Test sale'
      };

      const mockResponse = {
        success: true,
        data: {
          movements: [{ id: 'movement-1' }],
          totalSaleValue: 52.50,
          saleRecord: { amount: 52.50 }
        },
        message: 'Sale processed successfully'
      };

      CustomerService.processSale.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/customers/uuid-123/sales')
        .send(saleData)
        .expect(201);

      expect(response.body).toEqual(mockResponse);
      expect(CustomerService.processSale).toHaveBeenCalledWith({
        customerId: 'uuid-123',
        ...saleData
      });
    });
  });

  describe('POST /api/customers/:id/reserve', () => {
    it('should reserve stock successfully', async () => {
      const reservationData = {
        items: [
          {
            productId: 'prod-1',
            warehouseId: 'wh-1',
            quantity: 5
          }
        ]
      };

      const mockResponse = {
        success: true,
        data: [
          {
            inventoryId: 1,
            productId: 'prod-1',
            warehouseId: 'wh-1',
            quantityReserved: 5,
            customerId: 'uuid-123'
          }
        ],
        message: 'Stock reserved successfully'
      };

      CustomerService.reserveStock.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/customers/uuid-123/reserve')
        .send(reservationData)
        .expect(201);

      expect(response.body).toEqual(mockResponse);
      expect(CustomerService.reserveStock).toHaveBeenCalledWith('uuid-123', reservationData.items);
    });
  });

  describe('POST /api/customers/:id/release', () => {
    it('should release reservation successfully', async () => {
      const releaseData = {
        items: [
          {
            productId: 'prod-1',
            warehouseId: 'wh-1',
            quantity: 5
          }
        ]
      };

      const mockResponse = {
        success: true,
        data: [
          {
            inventoryId: 1,
            productId: 'prod-1',
            warehouseId: 'wh-1',
            quantityReleased: 5,
            customerId: 'uuid-123'
          }
        ],
        message: 'Stock reservation released successfully'
      };

      CustomerService.releaseReservation.mockResolvedValue(mockResponse);

      const response = await request(app)
        .post('/api/customers/uuid-123/release')
        .send(releaseData)
        .expect(200);

      expect(response.body).toEqual(mockResponse);
      expect(CustomerService.releaseReservation).toHaveBeenCalledWith('uuid-123', releaseData.items);
    });
  });

  describe('GET /api/customers/:id/backorders', () => {
    it('should return customer backorders', async () => {
      const mockBackorders = {
        success: true,
        data: {
          customer: { id: 'uuid-123', customerCode: 'CUST001' },
          reservedItems: [],
          backorders: []
        }
      };

      CustomerService.getCustomerBackorders.mockResolvedValue(mockBackorders);

      const response = await request(app)
        .get('/api/customers/uuid-123/backorders')
        .expect(200);

      expect(response.body).toEqual(mockBackorders);
      expect(CustomerService.getCustomerBackorders).toHaveBeenCalledWith('uuid-123');
    });
  });

  describe('GET /api/customers/search', () => {
    it('should search customers successfully', async () => {
      const mockResponse = {
        success: true,
        data: {
          customers: [
            { id: 'uuid-1', customerCode: 'CUST001', companyName: 'Search Match' }
          ],
          searchTerm: 'Search Match',
          pagination: {
            page: 1,
            pageSize: 10,
            totalCount: 1
          }
        }
      };

      CustomerService.searchCustomers.mockResolvedValue(mockResponse);

      const response = await request(app)
        .get('/api/customers/search?q=Search Match&page=1&pageSize=10')
        .expect(200);

      expect(response.body).toEqual(mockResponse);
      expect(CustomerService.searchCustomers).toHaveBeenCalledWith('Search Match', {
        page: 1,
        pageSize: 10
      });
    });

    it('should return 400 when search term is missing', async () => {
      const response = await request(app)
        .get('/api/customers/search')
        .expect(400);

      expect(response.body.success).toBe(false);
      expect(response.body.error).toBe('Search term is required');
    });
  });

  describe('GET /api/customers/analytics/overview', () => {
    it('should return analytics overview', async () => {
      const mockOverview = {
        success: true,
        data: {
          segmentation: { totalCustomers: 100 },
          topCustomers: [],
          recentActivity: [],
          churnRisks: [],
          generatedAt: new Date().toISOString()
        }
      };

      CustomerService.getAnalyticsOverview.mockResolvedValue(mockOverview);

      const response = await request(app)
        .get('/api/customers/analytics/overview?limit=50')
        .expect(200);

      expect(response.body).toEqual(mockOverview);
      expect(CustomerService.getAnalyticsOverview).toHaveBeenCalledWith({
        dateFrom: undefined,
        dateTo: undefined,
        limit: 50
      });
    });
  });

  describe('GET /api/customers/analytics/segmentation', () => {
    it('should return customer segmentation', async () => {
      const mockSegmentation = {
        success: true,
        data: {
          totalCustomers: 100,
          segmentCounts: {
            champions: 10,
            loyalCustomers: 20,
            atRisk: 5
          }
        }
      };

      CustomerService.getCustomerSegmentation.mockResolvedValue(mockSegmentation);

      const response = await request(app)
        .get('/api/customers/analytics/segmentation')
        .expect(200);

      expect(response.body).toEqual(mockSegmentation);
      expect(CustomerService.getCustomerSegmentation).toHaveBeenCalled();
    });
  });

  describe('GET /api/customers/high-value', () => {
    it('should return high value customers', async () => {
      const mockHighValue = {
        success: true,
        data: {
          customers: [
            { id: 'uuid-1', customerCode: 'CUST001', totalValue: 15000 }
          ],
          threshold: 10000,
          totalCount: 1
        }
      };

      CustomerService.getHighValueCustomers.mockResolvedValue(mockHighValue);

      const response = await request(app)
        .get('/api/customers/high-value?threshold=10000&limit=50')
        .expect(200);

      expect(response.body).toEqual(mockHighValue);
      expect(CustomerService.getHighValueCustomers).toHaveBeenCalledWith(10000, 50);
    });
  });
});