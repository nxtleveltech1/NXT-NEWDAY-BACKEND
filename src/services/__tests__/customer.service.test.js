import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { CustomerService } from '../customer.service.js';

// Skipped: requires mocking, not allowed in integration-only test policy.


























describe.skip('CustomerService', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCustomer', () => {
    test('should create a customer with valid data', async () => {
      const mockCustomer = {
        id: '123',
        customerCode: 'CUST001',
        companyName: 'Test Company',
        email: 'test@company.com',
        phone: '123-456-7890',
        address: {},
        metadata: {}
      };

      const { createCustomer, getCustomerByCode } = await import('../../db/customer-queries.js');
      getCustomerByCode.mockResolvedValue(null); // Customer code doesn't exist
      createCustomer.mockResolvedValue(mockCustomer);

      const customerData = {
        customerCode: 'CUST001',
        companyName: 'Test Company',
        email: 'test@company.com',
        phone: '123-456-7890'
      };

      const result = await CustomerService.createCustomer(customerData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockCustomer);
      expect(createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          customerCode: 'CUST001',
          companyName: 'Test Company',
          email: 'test@company.com',
          phone: '123-456-7890'
        })
      );
    });

    test('should fail when required fields are missing', async () => {
      const result = await CustomerService.createCustomer({
        companyName: 'Test Company'
        // Missing customerCode and email
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('customerCode is required');
    });

    test('should fail with invalid email format', async () => {
      const result = await CustomerService.createCustomer({
        customerCode: 'CUST001',
        companyName: 'Test Company',
        email: 'invalid-email'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid email format');
    });

    test('should fail when customer code already exists', async () => {
      const { getCustomerByCode } = await import('../../db/customer-queries.js');
      getCustomerByCode.mockResolvedValue({ id: '456', customerCode: 'CUST001' });

      const result = await CustomerService.createCustomer({
        customerCode: 'CUST001',
        companyName: 'Test Company',
        email: 'test@company.com'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer code already exists');
    });
  });

  describe('getCustomerById', () => {
    test('should return customer when found', async () => {
      const mockCustomer = {
        id: '123',
        customerCode: 'CUST001',
        companyName: 'Test Company',
        email: 'test@company.com'
      };

      const { getCustomerById } = await import('../../db/customer-queries.js');
      getCustomerById.mockResolvedValue(mockCustomer);

      const result = await CustomerService.getCustomerById('123');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockCustomer);
    });

    test('should fail when customer not found', async () => {
      const { getCustomerById } = await import('../../db/customer-queries.js');
      getCustomerById.mockResolvedValue(null);

      const result = await CustomerService.getCustomerById('999');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer not found');
    });
  });

  describe('getAllCustomers', () => {
    test('should return paginated customers', async () => {
      const mockCustomers = [
        { id: '1', customerCode: 'CUST001', companyName: 'Company 1' },
        { id: '2', customerCode: 'CUST002', companyName: 'Company 2' }
      ];

      const { getAllCustomers, getTotalCustomersCount } = await import('../../db/customer-queries.js');
      getAllCustomers.mockResolvedValue(mockCustomers);
      getTotalCustomersCount.mockResolvedValue(2);

      const result = await CustomerService.getAllCustomers({
        page: 1,
        pageSize: 10
      });

      expect(result.success).toBe(true);
      expect(result.data.customers).toEqual(mockCustomers);
      expect(result.data.pagination.totalCount).toBe(2);
      expect(result.data.pagination.totalPages).toBe(1);
    });

    test('should handle search functionality', async () => {
      const mockCustomers = [
        { id: '1', customerCode: 'CUST001', companyName: 'Test Company' }
      ];

      const { searchCustomers } = await import('../../db/customer-queries.js');
      searchCustomers.mockResolvedValue(mockCustomers);

      const result = await CustomerService.getAllCustomers({
        page: 1,
        pageSize: 10,
        search: 'Test'
      });

      expect(result.success).toBe(true);
      expect(result.data.customers).toEqual(mockCustomers);
      expect(searchCustomers).toHaveBeenCalledWith('Test', 1, 10);
    });
  });

  describe('updateCustomer', () => {
    test('should update customer with valid data', async () => {
      const existingCustomer = {
        id: '123',
        customerCode: 'CUST001',
        companyName: 'Old Company',
        email: 'old@company.com'
      };

      const updatedCustomer = {
        ...existingCustomer,
        companyName: 'Updated Company'
      };

      const { getCustomerById, updateCustomer } = await import('../../db/customer-queries.js');
      getCustomerById.mockResolvedValue(existingCustomer);
      updateCustomer.mockResolvedValue(updatedCustomer);

      const result = await CustomerService.updateCustomer('123', {
        companyName: 'Updated Company'
      });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(updatedCustomer);
    });

    test('should fail when customer not found', async () => {
      const { getCustomerById } = await import('../../db/customer-queries.js');
      getCustomerById.mockResolvedValue(null);

      const result = await CustomerService.updateCustomer('999', {
        companyName: 'Updated Company'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer not found');
    });

    test('should validate email format during update', async () => {
      const existingCustomer = {
        id: '123',
        customerCode: 'CUST001',
        companyName: 'Test Company',
        email: 'test@company.com'
      };

      const { getCustomerById } = await import('../../db/customer-queries.js');
      getCustomerById.mockResolvedValue(existingCustomer);

      const result = await CustomerService.updateCustomer('123', {
        email: 'invalid-email'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid email format');
    });
  });

  describe('processCustomerMetadata', () => {
    test('should process metadata into 4 sets correctly', () => {
      const inputMetadata = {
        contactPerson: 'John Doe',
        taxId: 'TAX123',
        communicationMethod: 'email',
        customField1: 'value1',
        customField2: 'value2'
      };

      const result = CustomerService.processCustomerMetadata(inputMetadata);

      expect(result.basicInfo).toEqual(
        expect.objectContaining({
          contactPerson: 'John Doe'
        })
      );

      expect(result.businessInfo).toEqual(
        expect.objectContaining({
          taxId: 'TAX123'
        })
      );

      expect(result.preferences).toEqual(
        expect.objectContaining({
          communicationMethod: 'email'
        })
      );

      expect(result.customFields).toEqual(
        expect.objectContaining({
          customField1: 'value1',
          customField2: 'value2'
        })
      );

      expect(result.isActive).toBe(true);
      expect(result.version).toBe(1);
    });

    test('should merge with existing metadata sets', () => {
      const inputMetadata = {
        basicInfo: {
          contactPerson: 'Jane Doe',
          title: 'Manager'
        },
        customFields: {
          existingField: 'existing'
        },
        newCustomField: 'new value'
      };

      const result = CustomerService.processCustomerMetadata(inputMetadata);

      expect(result.basicInfo).toEqual(
        expect.objectContaining({
          contactPerson: 'Jane Doe',
          title: 'Manager'
        })
      );

      expect(result.customFields).toEqual(
        expect.objectContaining({
          existingField: 'existing',
          newCustomField: 'new value'
        })
      );
    });
  });

  describe('validateMetadata', () => {
    test('should pass validation for valid metadata', () => {
      const metadata = {
        businessInfo: {
          creditLimit: 10000
        },
        preferences: {
          communicationMethod: 'email',
          deliveryPreference: 'standard',
          paymentMethod: 'invoice'
        }
      };

      const errors = CustomerService.validateMetadata(metadata);
      expect(errors).toHaveLength(0);
    });

    test('should catch negative credit limit', () => {
      const metadata = {
        businessInfo: {
          creditLimit: -1000
        }
      };

      const errors = CustomerService.validateMetadata(metadata);
      expect(errors).toContain('Credit limit cannot be negative');
    });

    test('should catch invalid communication method', () => {
      const metadata = {
        preferences: {
          communicationMethod: 'invalid'
        }
      };

      const errors = CustomerService.validateMetadata(metadata);
      expect(errors).toContain('Invalid communication method');
    });

    test('should catch invalid delivery preference', () => {
      const metadata = {
        preferences: {
          deliveryPreference: 'invalid'
        }
      };

      const errors = CustomerService.validateMetadata(metadata);
      expect(errors).toContain('Invalid delivery preference');
    });

    test('should catch invalid payment method', () => {
      const metadata = {
        preferences: {
          paymentMethod: 'invalid'
        }
      };

      const errors = CustomerService.validateMetadata(metadata);
      expect(errors).toContain('Invalid payment method');
    });
  });

  describe('createPurchaseOrder', () => {
    test('should create purchase order with valid data', async () => {
      const mockOrder = {
        id: 'order-123',
        orderNumber: 'PO-001',
        customerId: 'customer-123',
        items: []
      };

      const { getCustomerById } = await import('../../db/customer-queries.js');
      const { createPurchaseOrder } = await import('../../db/purchase-order-queries.js');
      
      getCustomerById.mockResolvedValue({ id: 'customer-123' });
      createPurchaseOrder.mockResolvedValue(mockOrder);

      const orderData = {
        customerId: 'customer-123',
        items: [{
          productId: 'prod-1',
          sku: 'SKU001',
          productName: 'Test Product',
          quantity: 2,
          unitPrice: 10.00
        }]
      };

      const result = await CustomerService.createPurchaseOrder(orderData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockOrder);
    });

    test('should fail when customer not found', async () => {
      const { getCustomerById } = await import('../../db/customer-queries.js');
      getCustomerById.mockResolvedValue(null);

      const orderData = {
        customerId: 'nonexistent',
        items: [{
          productId: 'prod-1',
          sku: 'SKU001',
          productName: 'Test Product',
          quantity: 2,
          unitPrice: 10.00
        }]
      };

      const result = await CustomerService.createPurchaseOrder(orderData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer not found');
    });

    test('should validate required fields', async () => {
      const result = await CustomerService.createPurchaseOrder({
        customerId: 'customer-123'
        // Missing items
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('items is required');
    });

    test('should validate item fields', async () => {
      const { getCustomerById } = await import('../../db/customer-queries.js');
      getCustomerById.mockResolvedValue({ id: 'customer-123' });

      const result = await CustomerService.createPurchaseOrder({
        customerId: 'customer-123',
        items: [{
          productId: 'prod-1',
          // Missing required fields
        }]
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('must have productId, sku, productName, quantity, and unitPrice');
    });

    test('should validate positive quantities and prices', async () => {
      const { getCustomerById } = await import('../../db/customer-queries.js');
      getCustomerById.mockResolvedValue({ id: 'customer-123' });

      const result = await CustomerService.createPurchaseOrder({
        customerId: 'customer-123',
        items: [{
          productId: 'prod-1',
          sku: 'SKU001',
          productName: 'Test Product',
          quantity: -1, // Invalid
          unitPrice: 10.00
        }]
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Quantity and unit price must be positive numbers');
    });
  });

  describe('getCustomerAnalytics', () => {
    test('should return comprehensive analytics', async () => {
      const mockAnalytics = {
        customerLifetimeValue: { historicalCLV: 5000 },
        averageOrderValue: { avgOrderValue: 250 },
        purchaseFrequency: { averageDaysBetweenOrders: 30 },
        churnRisk: { churnRisk: 'Low', churnScore: 10 },
        salesVelocity: { totalQuantitySold: 100 }
      };

      const {
        calculateCustomerLifetimeValue,
        calculateAverageOrderValue,
        calculatePurchaseFrequency,
        calculateChurnPredictionIndicators,
        getCustomerSalesVelocity
      } = await import('../../db/customer-queries.js');

      calculateCustomerLifetimeValue.mockResolvedValue(mockAnalytics.customerLifetimeValue);
      calculateAverageOrderValue.mockResolvedValue(mockAnalytics.averageOrderValue);
      calculatePurchaseFrequency.mockResolvedValue(mockAnalytics.purchaseFrequency);
      calculateChurnPredictionIndicators.mockResolvedValue(mockAnalytics.churnRisk);
      getCustomerSalesVelocity.mockResolvedValue(mockAnalytics.salesVelocity);

      const result = await CustomerService.getCustomerAnalytics('customer-123');

      expect(result.success).toBe(true);
      expect(result.data.customerLifetimeValue).toEqual(mockAnalytics.customerLifetimeValue);
      expect(result.data.averageOrderValue).toEqual(mockAnalytics.averageOrderValue);
      expect(result.data.purchaseFrequency).toEqual(mockAnalytics.purchaseFrequency);
      expect(result.data.churnRisk).toEqual(mockAnalytics.churnRisk);
      expect(result.data.salesVelocity).toEqual(mockAnalytics.salesVelocity);
    });

    test('should handle analytics errors gracefully', async () => {
      const {
        calculateCustomerLifetimeValue
      } = await import('../../db/customer-queries.js');

      calculateCustomerLifetimeValue.mockRejectedValue(new Error('Database error'));

      const result = await CustomerService.getCustomerAnalytics('customer-123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
    });
  });

  describe('processSale', () => {
    test('should process sale with valid data', async () => {
      const mockSale = {
        id: 'sale-123',
        customerId: 'customer-123',
        items: [{
          productId: 'prod-1',
          warehouseId: 'wh-1',
          quantity: 2,
          unitPrice: 10.00
        }],
        totalAmount: 20.00
      };

      const { processSale } = await import('../../db/customer-queries.js');
      processSale.mockResolvedValue(mockSale);

      const saleData = {
        customerId: 'customer-123',
        items: [{
          productId: 'prod-1',
          warehouseId: 'wh-1',
          quantity: 2,
          unitPrice: 10.00
        }],
        referenceNumber: 'SALE-001',
        performedBy: 'user-123',
        notes: 'Test sale'
      };

      const result = await CustomerService.processSale(saleData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSale);
      expect(processSale).toHaveBeenCalledWith(
        expect.objectContaining({
          customerId: 'customer-123',
          items: saleData.items,
          performedBy: 'user-123',
          notes: 'Test sale'
        })
      );
    });

    test('should validate required fields for sale', async () => {
      const result = await CustomerService.processSale({
        customerId: 'customer-123'
        // Missing items
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Customer ID and items are required');
    });

    test('should validate sale item fields', async () => {
      const result = await CustomerService.processSale({
        customerId: 'customer-123',
        items: [{
          productId: 'prod-1'
          // Missing required fields
        }]
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('must have productId, warehouseId, quantity, and unitPrice');
    });

    test('should generate reference number if not provided', async () => {
      const mockSale = { id: 'sale-123' };
      const { processSale } = await import('../../db/customer-queries.js');
      processSale.mockResolvedValue(mockSale);

      const result = await CustomerService.processSale({
        customerId: 'customer-123',
        items: [{
          productId: 'prod-1',
          warehouseId: 'wh-1',
          quantity: 2,
          unitPrice: 10.00
        }]
      });

      expect(result.success).toBe(true);
      expect(processSale).toHaveBeenCalledWith(
        expect.objectContaining({
          referenceNumber: expect.stringMatching(/^SALE-\d+$/)
        })
      );
    });
  });

  describe('searchCustomers', () => {
    test('should search customers successfully', async () => {
      const mockCustomers = [
        { id: '1', customerCode: 'CUST001', companyName: 'Test Company' }
      ];

      const { searchCustomers } = await import('../../db/customer-queries.js');
      searchCustomers.mockResolvedValue(mockCustomers);

      const result = await CustomerService.searchCustomers('Test', {
        page: 1,
        pageSize: 10
      });

      expect(result.success).toBe(true);
      expect(result.data.customers).toEqual(mockCustomers);
      expect(result.data.searchTerm).toBe('Test');
    });
  });

  describe('deleteCustomer', () => {
    test('should soft delete customer', async () => {
      const existingCustomer = {
        id: '123',
        customerCode: 'CUST001',
        companyName: 'Test Company'
      };

      const updatedCustomer = {
        ...existingCustomer,
        metadata: { isActive: false }
      };

      const { getCustomerById, updateCustomerMetadata } = await import('../../db/customer-queries.js');
      getCustomerById.mockResolvedValue(existingCustomer);
      updateCustomerMetadata.mockResolvedValue(updatedCustomer);

      const result = await CustomerService.deleteCustomer('123');

      expect(result.success).toBe(true);
      expect(updateCustomerMetadata).toHaveBeenCalledWith('123', 
        expect.objectContaining({
          isActive: false,
          deletedAt: expect.any(String)
        })
      );
    });
  });

  describe('updatePurchaseOrderStatus', () => {
    test('should update order status with valid status', async () => {
      const mockOrder = {
        id: 'order-123',
        status: 'confirmed'
      };

      const { updatePurchaseOrderStatus } = await import('../../db/purchase-order-queries.js');
      updatePurchaseOrderStatus.mockResolvedValue(mockOrder);

      const result = await CustomerService.updatePurchaseOrderStatus('order-123', 'confirmed');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockOrder);
    });

    test('should reject invalid status', async () => {
      const result = await CustomerService.updatePurchaseOrderStatus('order-123', 'invalid-status');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid status');
    });
  });

  describe('updatePurchaseOrderPaymentStatus', () => {
    test('should update payment status with valid status', async () => {
      const mockOrder = {
        id: 'order-123',
        paymentStatus: 'paid'
      };

      const { updatePurchaseOrderPaymentStatus } = await import('../../db/purchase-order-queries.js');
      updatePurchaseOrderPaymentStatus.mockResolvedValue(mockOrder);

      const result = await CustomerService.updatePurchaseOrderPaymentStatus('order-123', 'paid', 'credit_card');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockOrder);
    });

    test('should reject invalid payment status', async () => {
      const result = await CustomerService.updatePurchaseOrderPaymentStatus('order-123', 'invalid-status');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid payment status');
    });
  });

  describe('getCustomerPurchaseHistory', () => {
    test('should return comprehensive purchase history', async () => {
      const mockCustomer = {
        id: 'customer-123',
        customerCode: 'CUST001',
        companyName: 'Test Company',
        email: 'test@company.com'
      };

      const mockSummary = { totalOrders: 10, totalSpent: 5000 };
      const mockOrders = { orders: [{ id: 'order-1' }] };
      const mockTopProducts = [{ productId: 'prod-1', quantity: 50 }];
      const mockFrequency = { averageDaysBetweenOrders: 30 };

      const { getCustomerById } = await import('../../db/customer-queries.js');
      const {
        getCustomerPurchaseHistorySummary,
        getCustomerPurchaseOrders,
        getCustomerTopProducts,
        getCustomerPurchaseFrequency
      } = await import('../../db/purchase-order-queries.js');

      getCustomerById.mockResolvedValue(mockCustomer);
      getCustomerPurchaseHistorySummary.mockResolvedValue(mockSummary);
      getCustomerPurchaseOrders.mockResolvedValue(mockOrders);
      getCustomerTopProducts.mockResolvedValue(mockTopProducts);
      getCustomerPurchaseFrequency.mockResolvedValue(mockFrequency);

      const result = await CustomerService.getCustomerPurchaseHistory('customer-123');

      expect(result.success).toBe(true);
      expect(result.data.customer).toEqual({
        id: 'customer-123',
        customerCode: 'CUST001',
        companyName: 'Test Company',
        email: 'test@company.com'
      });
      expect(result.data.summary).toEqual(mockSummary);
      expect(result.data.topProducts).toEqual(mockTopProducts);
    });
  });

  describe('edge cases and error handling', () => {
    test('should handle database connection errors', async () => {
      const { getCustomerById } = await import('../../db/customer-queries.js');
      getCustomerById.mockRejectedValue(new Error('Database connection failed'));

      const result = await CustomerService.getCustomerById('123');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection failed');
    });

    test('should handle malformed customer data', async () => {
      const result = await CustomerService.createCustomer({
        customerCode: '',
        companyName: null,
        email: undefined
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('customerCode is required');
    });

    test('should handle concurrent customer code conflicts', async () => {
      const { getCustomerByCode, createCustomer } = await import('../../db/customer-queries.js');
      
      // First call returns null (code available)
      getCustomerByCode.mockResolvedValueOnce(null);
      // But creation fails due to race condition
      createCustomer.mockRejectedValue(new Error('Customer code already exists'));

      const result = await CustomerService.createCustomer({
        customerCode: 'CUST001',
        companyName: 'Test Company',
        email: 'test@company.com'
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer code already exists');
    });
  });
});