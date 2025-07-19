/**
 * Comprehensive Unit Tests for Customer Service
 * Testing all customer service methods with various scenarios
 */

import { CustomerService } from '../customer.service.js';
import * as customerQueries from '../../db/customer-queries.js';
import * as purchaseOrderQueries from '../../db/purchase-order-queries.js';

// Mock all database queries
jest.mock('../../db/customer-queries.js');
jest.mock('../../db/purchase-order-queries.js');

describe('CustomerService Unit Tests', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ==================== CREATE CUSTOMER TESTS ====================
  
  describe('createCustomer', () => {
    const validCustomerData = {
      customerCode: 'CUST001',
      companyName: 'Test Company Ltd',
      email: 'test@company.com',
      phone: '+1234567890',
      address: {
        street: '123 Main St',
        city: 'Test City',
        country: 'Test Country'
      },
      metadata: {
        contactPerson: 'John Doe',
        businessType: 'Retail'
      }
    };

    test('should create customer successfully with valid data', async () => {
      const mockCustomer = { id: 1, ...validCustomerData };
      customerQueries.getCustomerByCode.mockResolvedValue(null);
      customerQueries.createCustomer.mockResolvedValue(mockCustomer);

      const result = await CustomerService.createCustomer(validCustomerData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockCustomer);
      expect(result.message).toBe('Customer created successfully');
      expect(customerQueries.createCustomer).toHaveBeenCalledWith(
        expect.objectContaining({
          ...validCustomerData,
          metadata: expect.objectContaining({
            basicInfo: expect.any(Object),
            businessInfo: expect.any(Object),
            preferences: expect.any(Object),
            customFields: expect.any(Object)
          }),
          purchaseHistory: { orders: [], totalLifetimeValue: 0 }
        })
      );
    });

    test('should fail when required fields are missing', async () => {
      const invalidData = { companyName: 'Test Company' };
      
      const result = await CustomerService.createCustomer(invalidData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('customerCode is required');
      expect(customerQueries.createCustomer).not.toHaveBeenCalled();
    });

    test('should fail when email format is invalid', async () => {
      const invalidEmailData = {
        ...validCustomerData,
        email: 'invalid-email'
      };

      const result = await CustomerService.createCustomer(invalidEmailData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid email format');
      expect(customerQueries.createCustomer).not.toHaveBeenCalled();
    });

    test('should fail when customer code already exists', async () => {
      customerQueries.getCustomerByCode.mockResolvedValue({ id: 1, customerCode: 'CUST001' });

      const result = await CustomerService.createCustomer(validCustomerData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer code already exists');
      expect(customerQueries.createCustomer).not.toHaveBeenCalled();
    });

    test('should handle database errors gracefully', async () => {
      customerQueries.getCustomerByCode.mockResolvedValue(null);
      customerQueries.createCustomer.mockRejectedValue(new Error('Database error'));

      const result = await CustomerService.createCustomer(validCustomerData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database error');
      expect(result.message).toBe('Failed to create customer');
    });
  });

  // ==================== GET CUSTOMER TESTS ====================

  describe('getCustomerById', () => {
    test('should return customer when found', async () => {
      const mockCustomer = { id: 1, customerCode: 'CUST001', companyName: 'Test Company' };
      customerQueries.getCustomerById.mockResolvedValue(mockCustomer);

      const result = await CustomerService.getCustomerById(1);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockCustomer);
      expect(customerQueries.getCustomerById).toHaveBeenCalledWith(1);
    });

    test('should return error when customer not found', async () => {
      customerQueries.getCustomerById.mockResolvedValue(null);

      const result = await CustomerService.getCustomerById(999);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer not found');
    });

    test('should handle database errors', async () => {
      customerQueries.getCustomerById.mockRejectedValue(new Error('Database connection lost'));

      const result = await CustomerService.getCustomerById(1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Database connection lost');
    });
  });

  describe('getCustomerByCode', () => {
    test('should return customer when found by code', async () => {
      const mockCustomer = { id: 1, customerCode: 'CUST001', companyName: 'Test Company' };
      customerQueries.getCustomerByCode.mockResolvedValue(mockCustomer);

      const result = await CustomerService.getCustomerByCode('CUST001');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockCustomer);
    });

    test('should return error when customer code not found', async () => {
      customerQueries.getCustomerByCode.mockResolvedValue(null);

      const result = await CustomerService.getCustomerByCode('NONEXISTENT');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer not found');
    });
  });

  describe('getAllCustomers', () => {
    test('should return paginated customers without search', async () => {
      const mockCustomers = [
        { id: 1, customerCode: 'CUST001' },
        { id: 2, customerCode: 'CUST002' }
      ];
      customerQueries.getAllCustomers.mockResolvedValue(mockCustomers);
      customerQueries.getTotalCustomersCount.mockResolvedValue(25);

      const result = await CustomerService.getAllCustomers({ page: 2, pageSize: 10 });

      expect(result.success).toBe(true);
      expect(result.data.customers).toEqual(mockCustomers);
      expect(result.data.pagination).toEqual({
        page: 2,
        pageSize: 10,
        totalCount: 25,
        totalPages: 3,
        hasNext: true,
        hasPrev: true
      });
    });

    test('should return search results when search term provided', async () => {
      const mockCustomers = [{ id: 1, customerCode: 'CUST001', companyName: 'Test Company' }];
      customerQueries.searchCustomers.mockResolvedValue(mockCustomers);

      const result = await CustomerService.getAllCustomers({ 
        page: 1, 
        pageSize: 10, 
        search: 'Test' 
      });

      expect(result.success).toBe(true);
      expect(result.data.customers).toEqual(mockCustomers);
      expect(customerQueries.searchCustomers).toHaveBeenCalledWith('Test', 1, 10);
    });

    test('should handle default pagination parameters', async () => {
      const mockCustomers = [];
      customerQueries.getAllCustomers.mockResolvedValue(mockCustomers);
      customerQueries.getTotalCustomersCount.mockResolvedValue(0);

      const result = await CustomerService.getAllCustomers();

      expect(result.success).toBe(true);
      expect(customerQueries.getAllCustomers).toHaveBeenCalledWith(1, 10);
    });
  });

  // ==================== UPDATE CUSTOMER TESTS ====================

  describe('updateCustomer', () => {
    const mockExistingCustomer = {
      id: 1,
      customerCode: 'CUST001',
      companyName: 'Old Company',
      email: 'old@company.com'
    };

    test('should update customer successfully', async () => {
      const updateData = { companyName: 'New Company Name' };
      const mockUpdatedCustomer = { ...mockExistingCustomer, ...updateData };
      
      customerQueries.getCustomerById.mockResolvedValue(mockExistingCustomer);
      customerQueries.updateCustomer.mockResolvedValue(mockUpdatedCustomer);

      const result = await CustomerService.updateCustomer(1, updateData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedCustomer);
      expect(customerQueries.updateCustomer).toHaveBeenCalledWith(1, updateData);
    });

    test('should fail when customer does not exist', async () => {
      customerQueries.getCustomerById.mockResolvedValue(null);

      const result = await CustomerService.updateCustomer(999, { companyName: 'New Name' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer not found');
      expect(customerQueries.updateCustomer).not.toHaveBeenCalled();
    });

    test('should validate email format when updating email', async () => {
      customerQueries.getCustomerById.mockResolvedValue(mockExistingCustomer);

      const result = await CustomerService.updateCustomer(1, { email: 'invalid-email' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid email format');
      expect(customerQueries.updateCustomer).not.toHaveBeenCalled();
    });

    test('should check for customer code conflicts when updating code', async () => {
      customerQueries.getCustomerById.mockResolvedValue(mockExistingCustomer);
      customerQueries.getCustomerByCode.mockResolvedValue({ id: 2, customerCode: 'CUST002' });

      const result = await CustomerService.updateCustomer(1, { customerCode: 'CUST002' });

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer code already exists');
      expect(customerQueries.updateCustomer).not.toHaveBeenCalled();
    });

    test('should allow updating to same customer code', async () => {
      const updateData = { customerCode: 'CUST001', companyName: 'Updated Company' };
      const mockUpdatedCustomer = { ...mockExistingCustomer, ...updateData };
      
      customerQueries.getCustomerById.mockResolvedValue(mockExistingCustomer);
      customerQueries.updateCustomer.mockResolvedValue(mockUpdatedCustomer);

      const result = await CustomerService.updateCustomer(1, updateData);

      expect(result.success).toBe(true);
      expect(customerQueries.getCustomerByCode).not.toHaveBeenCalled();
    });

    test('should process metadata when provided in update', async () => {
      const updateData = { 
        metadata: { 
          contactPerson: 'Jane Doe',
          businessType: 'Wholesale' 
        } 
      };
      
      customerQueries.getCustomerById.mockResolvedValue(mockExistingCustomer);
      customerQueries.updateCustomer.mockResolvedValue(mockExistingCustomer);

      const result = await CustomerService.updateCustomer(1, updateData);

      expect(result.success).toBe(true);
      expect(customerQueries.updateCustomer).toHaveBeenCalledWith(1, expect.objectContaining({
        metadata: expect.objectContaining({
          basicInfo: expect.objectContaining({
            contactPerson: 'Jane Doe'
          }),
          businessInfo: expect.objectContaining({
            businessType: 'Wholesale'
          })
        })
      }));
    });
  });

  // ==================== DELETE CUSTOMER TESTS ====================

  describe('deleteCustomer', () => {
    test('should soft delete customer successfully', async () => {
      const mockCustomer = { id: 1, customerCode: 'CUST001' };
      const mockUpdatedCustomer = { ...mockCustomer, metadata: { isActive: false } };
      
      customerQueries.getCustomerById.mockResolvedValue(mockCustomer);
      customerQueries.updateCustomerMetadata.mockResolvedValue(mockUpdatedCustomer);

      const result = await CustomerService.deleteCustomer(1);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedCustomer);
      expect(customerQueries.updateCustomerMetadata).toHaveBeenCalledWith(1, expect.objectContaining({
        isActive: false,
        deletedAt: expect.any(String)
      }));
    });

    test('should fail when customer does not exist', async () => {
      customerQueries.getCustomerById.mockResolvedValue(null);

      const result = await CustomerService.deleteCustomer(999);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer not found');
      expect(customerQueries.updateCustomerMetadata).not.toHaveBeenCalled();
    });
  });

  // ==================== SALES PROCESSING TESTS ====================

  describe('processSale', () => {
    const validSaleData = {
      customerId: 1,
      items: [
        {
          productId: 'PROD001',
          warehouseId: 'WH001',
          quantity: 5,
          unitPrice: 10.50
        }
      ],
      referenceNumber: 'SALE-12345',
      performedBy: 'user123',
      notes: 'Test sale'
    };

    test('should process sale successfully with valid data', async () => {
      const mockSaleResult = { id: 1, status: 'completed', ...validSaleData };
      customerQueries.processSale.mockResolvedValue(mockSaleResult);

      const result = await CustomerService.processSale(validSaleData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockSaleResult);
      expect(customerQueries.processSale).toHaveBeenCalledWith(expect.objectContaining({
        ...validSaleData,
        referenceNumber: 'SALE-12345'
      }));
    });

    test('should generate reference number when not provided', async () => {
      const saleDataWithoutRef = { ...validSaleData };
      delete saleDataWithoutRef.referenceNumber;
      
      const mockSaleResult = { id: 1, status: 'completed' };
      customerQueries.processSale.mockResolvedValue(mockSaleResult);

      const result = await CustomerService.processSale(saleDataWithoutRef);

      expect(result.success).toBe(true);
      expect(customerQueries.processSale).toHaveBeenCalledWith(expect.objectContaining({
        referenceNumber: expect.stringMatching(/^SALE-\d+$/)
      }));
    });

    test('should fail when customer ID is missing', async () => {
      const invalidSaleData = { ...validSaleData };
      delete invalidSaleData.customerId;

      const result = await CustomerService.processSale(invalidSaleData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer ID and items are required');
      expect(customerQueries.processSale).not.toHaveBeenCalled();
    });

    test('should fail when items array is empty', async () => {
      const invalidSaleData = { ...validSaleData, items: [] };

      const result = await CustomerService.processSale(invalidSaleData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer ID and items are required');
    });

    test('should validate each item has required fields', async () => {
      const invalidSaleData = {
        ...validSaleData,
        items: [{ productId: 'PROD001', quantity: 5 }] // Missing required fields
      };

      const result = await CustomerService.processSale(invalidSaleData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Each item must have productId, warehouseId, quantity, and unitPrice');
    });

    test('should validate positive quantities and prices', async () => {
      const invalidSaleData = {
        ...validSaleData,
        items: [{ ...validSaleData.items[0], quantity: -1 }]
      };

      const result = await CustomerService.processSale(invalidSaleData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Quantity and unit price must be positive numbers');
    });
  });

  // ==================== ANALYTICS TESTS ====================

  describe('getCustomerAnalytics', () => {
    test('should return comprehensive analytics data', async () => {
      const mockAnalytics = {
        clv: 15000,
        aov: 250,
        frequency: 12,
        churnRisk: 0.2,
        salesVelocity: 8.5
      };

      customerQueries.calculateCustomerLifetimeValue.mockResolvedValue(mockAnalytics.clv);
      customerQueries.calculateAverageOrderValue.mockResolvedValue(mockAnalytics.aov);
      customerQueries.calculatePurchaseFrequency.mockResolvedValue(mockAnalytics.frequency);
      customerQueries.calculateChurnPredictionIndicators.mockResolvedValue(mockAnalytics.churnRisk);
      customerQueries.getCustomerSalesVelocity.mockResolvedValue(mockAnalytics.salesVelocity);

      const result = await CustomerService.getCustomerAnalytics(1);

      expect(result.success).toBe(true);
      expect(result.data).toEqual({
        customerLifetimeValue: mockAnalytics.clv,
        averageOrderValue: mockAnalytics.aov,
        purchaseFrequency: mockAnalytics.frequency,
        churnRisk: mockAnalytics.churnRisk,
        salesVelocity: mockAnalytics.salesVelocity
      });
    });

    test('should handle analytics calculation errors', async () => {
      customerQueries.calculateCustomerLifetimeValue.mockRejectedValue(new Error('CLV calculation failed'));

      const result = await CustomerService.getCustomerAnalytics(1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('CLV calculation failed');
    });
  });

  // ==================== METADATA PROCESSING TESTS ====================

  describe('processCustomerMetadata', () => {
    test('should organize metadata into correct structure', () => {
      const inputMetadata = {
        contactPerson: 'John Doe',
        title: 'Manager',
        taxId: '123456789',
        businessType: 'Retail',
        communicationMethod: 'email',
        currency: 'USD',
        customField1: 'value1',
        customField2: 'value2'
      };

      const result = CustomerService.processCustomerMetadata(inputMetadata);

      expect(result).toEqual({
        basicInfo: expect.objectContaining({
          contactPerson: 'John Doe',
          title: 'Manager'
        }),
        businessInfo: expect.objectContaining({
          taxId: '123456789',
          businessType: 'Retail'
        }),
        preferences: expect.objectContaining({
          communicationMethod: 'email',
          currency: 'USD'
        }),
        customFields: expect.objectContaining({
          customField1: 'value1',
          customField2: 'value2'
        }),
        isActive: true,
        lastUpdated: expect.any(String),
        version: 1
      });
    });

    test('should handle existing metadata structure', () => {
      const inputMetadata = {
        basicInfo: { contactPerson: 'Jane Doe' },
        businessInfo: { taxId: '987654321' },
        preferences: { currency: 'EUR' },
        customFields: { field1: 'value1' },
        version: 5
      };

      const result = CustomerService.processCustomerMetadata(inputMetadata);

      expect(result.basicInfo).toEqual(expect.objectContaining({
        contactPerson: 'Jane Doe'
      }));
      expect(result.version).toBe(6); // Should increment
    });

    test('should set default notification preferences', () => {
      const result = CustomerService.processCustomerMetadata({});

      expect(result.preferences.notifications).toEqual({
        orderUpdates: true,
        promotions: true,
        invoices: true
      });
    });
  });

  // ==================== METADATA VALIDATION TESTS ====================

  describe('validateMetadata', () => {
    test('should return no errors for valid metadata', () => {
      const validMetadata = {
        businessInfo: { creditLimit: 10000 },
        preferences: {
          communicationMethod: 'email',
          deliveryPreference: 'standard',
          paymentMethod: 'invoice'
        }
      };

      const errors = CustomerService.validateMetadata(validMetadata);
      expect(errors).toEqual([]);
    });

    test('should detect negative credit limit', () => {
      const invalidMetadata = {
        businessInfo: { creditLimit: -1000 }
      };

      const errors = CustomerService.validateMetadata(invalidMetadata);
      expect(errors).toContain('Credit limit cannot be negative');
    });

    test('should detect invalid communication method', () => {
      const invalidMetadata = {
        preferences: { communicationMethod: 'telepathy' }
      };

      const errors = CustomerService.validateMetadata(invalidMetadata);
      expect(errors).toContain('Invalid communication method');
    });

    test('should detect invalid delivery preference', () => {
      const invalidMetadata = {
        preferences: { deliveryPreference: 'teleportation' }
      };

      const errors = CustomerService.validateMetadata(invalidMetadata);
      expect(errors).toContain('Invalid delivery preference');
    });

    test('should detect invalid payment method', () => {
      const invalidMetadata = {
        preferences: { paymentMethod: 'magic_beans' }
      };

      const errors = CustomerService.validateMetadata(invalidMetadata);
      expect(errors).toContain('Invalid payment method');
    });

    test('should return multiple errors when multiple issues exist', () => {
      const invalidMetadata = {
        businessInfo: { creditLimit: -1000 },
        preferences: {
          communicationMethod: 'telepathy',
          paymentMethod: 'magic_beans'
        }
      };

      const errors = CustomerService.validateMetadata(invalidMetadata);
      expect(errors).toHaveLength(3);
    });
  });

  // ==================== SEARCH CUSTOMERS TESTS ====================

  describe('searchCustomers', () => {
    test('should search customers successfully', async () => {
      const mockCustomers = [
        { id: 1, customerCode: 'CUST001', companyName: 'Test Company' }
      ];
      customerQueries.searchCustomers.mockResolvedValue(mockCustomers);

      const result = await CustomerService.searchCustomers('Test', { page: 1, pageSize: 10 });

      expect(result.success).toBe(true);
      expect(result.data.customers).toEqual(mockCustomers);
      expect(result.data.searchTerm).toBe('Test');
      expect(customerQueries.searchCustomers).toHaveBeenCalledWith('Test', 1, 10);
    });

    test('should use default options when not provided', async () => {
      customerQueries.searchCustomers.mockResolvedValue([]);

      const result = await CustomerService.searchCustomers('Test');

      expect(result.success).toBe(true);
      expect(customerQueries.searchCustomers).toHaveBeenCalledWith('Test', 1, 10);
    });
  });

  // ==================== HIGH VALUE CUSTOMERS TESTS ====================

  describe('getHighValueCustomers', () => {
    test('should return high value customers with threshold', async () => {
      const mockCustomers = [
        { id: 1, customerCode: 'CUST001', lifetimeValue: 15000 },
        { id: 2, customerCode: 'CUST002', lifetimeValue: 25000 }
      ];
      customerQueries.getHighValueCustomers.mockResolvedValue(mockCustomers);

      const result = await CustomerService.getHighValueCustomers(10000, 50);

      expect(result.success).toBe(true);
      expect(result.data.customers).toEqual(mockCustomers);
      expect(result.data.threshold).toBe(10000);
      expect(result.data.totalCount).toBe(2);
      expect(customerQueries.getHighValueCustomers).toHaveBeenCalledWith(10000);
    });

    test('should use default parameters when not provided', async () => {
      customerQueries.getHighValueCustomers.mockResolvedValue([]);

      const result = await CustomerService.getHighValueCustomers();

      expect(result.success).toBe(true);
      expect(customerQueries.getHighValueCustomers).toHaveBeenCalledWith(10000);
    });

    test('should limit results when more customers than limit', async () => {
      const mockCustomers = new Array(100).fill(null).map((_, i) => ({
        id: i + 1,
        customerCode: `CUST${String(i + 1).padStart(3, '0')}`,
        lifetimeValue: 15000
      }));
      customerQueries.getHighValueCustomers.mockResolvedValue(mockCustomers);

      const result = await CustomerService.getHighValueCustomers(10000, 25);

      expect(result.success).toBe(true);
      expect(result.data.customers).toHaveLength(25);
      expect(result.data.totalCount).toBe(100);
    });
  });

  // ==================== STOCK OPERATIONS TESTS ====================

  describe('reserveStock', () => {
    test('should reserve stock successfully', async () => {
      const items = [{ productId: 'PROD001', quantity: 5, warehouseId: 'WH001' }];
      const mockReservations = { success: true, reservations: [{ id: 1, status: 'reserved' }] };
      customerQueries.reserveStockForCustomer.mockResolvedValue(mockReservations);

      const result = await CustomerService.reserveStock(1, items);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockReservations);
      expect(customerQueries.reserveStockForCustomer).toHaveBeenCalledWith(1, items);
    });

    test('should handle reservation errors', async () => {
      const items = [{ productId: 'PROD001', quantity: 5 }];
      customerQueries.reserveStockForCustomer.mockRejectedValue(new Error('Insufficient stock'));

      const result = await CustomerService.reserveStock(1, items);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Insufficient stock');
    });
  });

  describe('releaseReservation', () => {
    test('should release reservation successfully', async () => {
      const items = [{ productId: 'PROD001', quantity: 5 }];
      const mockReleases = { success: true, released: [{ id: 1, status: 'released' }] };
      customerQueries.releaseCustomerReservation.mockResolvedValue(mockReleases);

      const result = await CustomerService.releaseReservation(1, items);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockReleases);
    });
  });

  // ==================== PURCHASE ORDER TESTS ====================

  describe('createPurchaseOrder', () => {
    const validOrderData = {
      customerId: 1,
      items: [{
        productId: 'PROD001',
        sku: 'SKU001',
        productName: 'Test Product',
        quantity: 5,
        unitPrice: 10.50
      }],
      orderNumber: 'PO-12345'
    };

    test('should create purchase order successfully', async () => {
      const mockOrder = { id: 1, ...validOrderData };
      customerQueries.getCustomerById.mockResolvedValue({ id: 1, customerCode: 'CUST001' });
      purchaseOrderQueries.createPurchaseOrder.mockResolvedValue(mockOrder);

      const result = await CustomerService.createPurchaseOrder(validOrderData);

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockOrder);
      expect(purchaseOrderQueries.createPurchaseOrder).toHaveBeenCalledWith(validOrderData);
    });

    test('should fail when customer does not exist', async () => {
      customerQueries.getCustomerById.mockResolvedValue(null);

      const result = await CustomerService.createPurchaseOrder(validOrderData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer not found');
      expect(purchaseOrderQueries.createPurchaseOrder).not.toHaveBeenCalled();
    });

    test('should validate required fields', async () => {
      const invalidOrderData = { customerId: 1 }; // Missing items

      const result = await CustomerService.createPurchaseOrder(invalidOrderData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('items is required');
    });

    test('should validate items array is not empty', async () => {
      const invalidOrderData = { customerId: 1, items: [] };

      const result = await CustomerService.createPurchaseOrder(invalidOrderData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('At least one item is required');
    });

    test('should validate item fields', async () => {
      const invalidOrderData = {
        customerId: 1,
        items: [{ productId: 'PROD001', quantity: 5 }] // Missing required fields
      };

      const result = await CustomerService.createPurchaseOrder(invalidOrderData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Each item must have productId, sku, productName, quantity, and unitPrice');
    });

    test('should validate positive quantities and prices', async () => {
      const invalidOrderData = {
        customerId: 1,
        items: [{
          productId: 'PROD001',
          sku: 'SKU001',
          productName: 'Test Product',
          quantity: -1,
          unitPrice: 10.50
        }]
      };

      const result = await CustomerService.createPurchaseOrder(invalidOrderData);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Quantity and unit price must be positive numbers');
    });
  });

  describe('updatePurchaseOrderStatus', () => {
    test('should update order status successfully', async () => {
      const mockUpdatedOrder = { id: 1, status: 'shipped' };
      purchaseOrderQueries.updatePurchaseOrderStatus.mockResolvedValue(mockUpdatedOrder);

      const result = await CustomerService.updatePurchaseOrderStatus(1, 'shipped', { notes: 'Shipped via UPS' });

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedOrder);
      expect(purchaseOrderQueries.updatePurchaseOrderStatus).toHaveBeenCalledWith(1, 'shipped', { notes: 'Shipped via UPS' });
    });

    test('should validate status values', async () => {
      const result = await CustomerService.updatePurchaseOrderStatus(1, 'invalid_status');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid status. Must be one of: pending, confirmed, shipped, delivered, cancelled');
      expect(purchaseOrderQueries.updatePurchaseOrderStatus).not.toHaveBeenCalled();
    });

    test('should handle order not found', async () => {
      purchaseOrderQueries.updatePurchaseOrderStatus.mockResolvedValue(null);

      const result = await CustomerService.updatePurchaseOrderStatus(999, 'shipped');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Purchase order not found');
    });
  });

  describe('updatePurchaseOrderPaymentStatus', () => {
    test('should update payment status successfully', async () => {
      const mockUpdatedOrder = { id: 1, paymentStatus: 'paid' };
      purchaseOrderQueries.updatePurchaseOrderPaymentStatus.mockResolvedValue(mockUpdatedOrder);

      const result = await CustomerService.updatePurchaseOrderPaymentStatus(1, 'paid', 'credit_card');

      expect(result.success).toBe(true);
      expect(result.data).toEqual(mockUpdatedOrder);
    });

    test('should validate payment status values', async () => {
      const result = await CustomerService.updatePurchaseOrderPaymentStatus(1, 'invalid_payment_status');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid payment status. Must be one of: pending, paid, partial, failed');
    });
  });

  // ==================== PURCHASE HISTORY TESTS ====================

  describe('getCustomerPurchaseHistory', () => {
    test('should return comprehensive purchase history', async () => {
      const mockCustomer = { id: 1, customerCode: 'CUST001', companyName: 'Test Company', email: 'test@company.com' };
      const mockSummary = { totalOrders: 10, totalValue: 5000 };
      const mockOrders = { orders: [{ id: 1, orderNumber: 'PO-001' }] };
      const mockTopProducts = [{ productId: 'PROD001', totalQuantity: 100 }];
      const mockFrequency = { avgDaysBetweenOrders: 30 };

      customerQueries.getCustomerById.mockResolvedValue(mockCustomer);
      purchaseOrderQueries.getCustomerPurchaseHistorySummary.mockResolvedValue(mockSummary);
      purchaseOrderQueries.getCustomerPurchaseOrders.mockResolvedValue(mockOrders);
      purchaseOrderQueries.getCustomerTopProducts.mockResolvedValue(mockTopProducts);
      purchaseOrderQueries.getCustomerPurchaseFrequency.mockResolvedValue(mockFrequency);

      const result = await CustomerService.getCustomerPurchaseHistory(1);

      expect(result.success).toBe(true);
      expect(result.data.customer).toEqual({
        id: 1,
        customerCode: 'CUST001',
        companyName: 'Test Company',
        email: 'test@company.com'
      });
      expect(result.data.summary).toEqual(mockSummary);
      expect(result.data.recentOrders).toEqual(mockOrders.orders);
      expect(result.data.topProducts).toEqual(mockTopProducts);
      expect(result.data.frequency).toEqual(mockFrequency);
    });

    test('should fail when customer not found', async () => {
      customerQueries.getCustomerById.mockResolvedValue(null);

      const result = await CustomerService.getCustomerPurchaseHistory(999);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Customer not found');
    });
  });

  // ==================== ERROR HANDLING TESTS ====================

  describe('Error Handling', () => {
    test('should handle unexpected errors gracefully across all methods', async () => {
      const methods = [
        () => CustomerService.createCustomer({}),
        () => CustomerService.getCustomerById(1),
        () => CustomerService.getAllCustomers(),
        () => CustomerService.updateCustomer(1, {}),
        () => CustomerService.deleteCustomer(1),
        () => CustomerService.processSale({}),
        () => CustomerService.getCustomerAnalytics(1),
        () => CustomerService.searchCustomers('test'),
        () => CustomerService.getHighValueCustomers(),
        () => CustomerService.reserveStock(1, []),
        () => CustomerService.releaseReservation(1, []),
        () => CustomerService.createPurchaseOrder({})
      ];

      for (const method of methods) {
        // Mock all database functions to throw errors
        Object.keys(customerQueries).forEach(key => {
          if (typeof customerQueries[key] === 'function') {
            customerQueries[key].mockRejectedValue(new Error('Database error'));
          }
        });
        
        Object.keys(purchaseOrderQueries).forEach(key => {
          if (typeof purchaseOrderQueries[key] === 'function') {
            purchaseOrderQueries[key].mockRejectedValue(new Error('Database error'));
          }
        });

        const result = await method();
        expect(result.success).toBe(false);
        expect(result.error).toBeDefined();
      }
    });
  });
});