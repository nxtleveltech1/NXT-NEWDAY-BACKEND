import {
  createCustomer,
  getCustomerById,
  getCustomerByCode,
  getAllCustomers,
  searchCustomers,
  updateCustomer,
  updateCustomerMetadata,
  deleteCustomer,
  getTotalCustomersCount,
  addPurchaseToHistory,
  getCustomersByMetadataField,
  getHighValueCustomers,
  processSale,
  reserveStockForCustomer,
  releaseCustomerReservation,
  getCustomerSalesVelocity,
  getCustomerBackorders,
  calculatePurchaseFrequency,
  calculateAverageOrderValue,
  calculateCustomerLifetimeValue,
  calculateChurnPredictionIndicators,
  performCustomerSegmentation,
  analyzePurchasePatterns,
  getCustomersAnalyticsOverview,
  getTopCustomersByValue,
  getRecentCustomerActivity,
  getHighChurnRiskCustomers
} from '../db/customer-queries.js';

import {
  createPurchaseOrder,
  getPurchaseOrderById,
  getCustomerPurchaseOrders,
  searchPurchaseOrders,
  updatePurchaseOrderStatus,
  updatePurchaseOrderPaymentStatus,
  getCustomerPurchaseHistorySummary,
  getCustomerTopProducts,
  getCustomerPurchaseFrequency
} from '../db/purchase-order-queries.js';

import cacheService from './cache.service.js';

/**
 * Customer Service Layer
 * Handles business logic for customer operations
 */
export class CustomerService {
  /**
   * Create a new customer with validation
   */
  static async createCustomer(customerData) {
    try {
      // Validate required fields
      const requiredFields = ['customerCode', 'companyName', 'email'];
      for (const field of requiredFields) {
        if (!customerData[field]) {
          throw new Error(`${field} is required`);
        }
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(customerData.email)) {
        throw new Error('Invalid email format');
      }

      // Check if customer code already exists
      const existingCustomer = await getCustomerByCode(customerData.customerCode);
      if (existingCustomer) {
        throw new Error('Customer code already exists');
      }

      // Process metadata sets
      const processedMetadata = this.processCustomerMetadata(customerData.metadata || {});

      const customerPayload = {
        ...customerData,
        metadata: processedMetadata,
        address: customerData.address || {},
        purchaseHistory: { orders: [], totalLifetimeValue: 0 }
      };

      const newCustomer = await createCustomer(customerPayload);
      return {
        success: true,
        data: newCustomer,
        message: 'Customer created successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to create customer'
      };
    }
  }

  /**
   * Get customer by ID with enhanced data
   */
  static async getCustomerById(id) {
    try {
      // Generate cache key
      const cacheKey = cacheService.generateKey('customers', 'detail', id);
      
      // Try to get from cache first
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return {
          success: true,
          data: cached,
          fromCache: true
        };
      }

      const customer = await getCustomerById(id);
      if (!customer) {
        return {
          success: false,
          error: 'Customer not found',
          message: 'Customer not found'
        };
      }

      // Cache the result for 10 minutes
      await cacheService.set(cacheKey, customer, 600);

      return {
        success: true,
        data: customer
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve customer'
      };
    }
  }

  /**
   * Get customer by customer code
   */
  static async getCustomerByCode(customerCode) {
    try {
      const customer = await getCustomerByCode(customerCode);
      if (!customer) {
        return {
          success: false,
          error: 'Customer not found',
          message: 'Customer not found'
        };
      }

      return {
        success: true,
        data: customer
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve customer'
      };
    }
  }

  /**
   * Get all customers with pagination and search
   */
  static async getAllCustomers(options = {}) {
    try {
      const {
        page = 1,
        pageSize = 10,
        search = null,
        sortBy = 'createdAt',
        sortOrder = 'desc'
      } = options;

      // Generate cache key based on query parameters
      const cacheKey = cacheService.generateKey('customers', 'list', JSON.stringify(options));
      
      // Try to get from cache first
      const cached = await cacheService.get(cacheKey);
      if (cached) {
        return {
          success: true,
          data: cached,
          fromCache: true
        };
      }

      let customers;
      let totalCount;

      if (search) {
        customers = await searchCustomers(search, page, pageSize);
        // Note: For simplicity, we're not getting exact count for search results
        totalCount = customers.length;
      } else {
        [customers, totalCount] = await Promise.all([
          getAllCustomers(page, pageSize),
          getTotalCustomersCount()
        ]);
      }

      const totalPages = Math.ceil(totalCount / pageSize);

      const result = {
        customers,
        pagination: {
          page,
          pageSize,
          totalCount,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1
        }
      };

      // Cache the result for 5 minutes
      await cacheService.set(cacheKey, result, 300);

      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve customers'
      };
    }
  }

  /**
   * Update customer with validation
   */
  static async updateCustomer(id, updateData) {
    try {
      // Check if customer exists
      const existingCustomer = await getCustomerById(id);
      if (!existingCustomer) {
        return {
          success: false,
          error: 'Customer not found',
          message: 'Customer not found'
        };
      }

      // Validate email if provided
      if (updateData.email) {
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(updateData.email)) {
          throw new Error('Invalid email format');
        }
      }

      // Check if customer code already exists for different customer
      if (updateData.customerCode && updateData.customerCode !== existingCustomer.customerCode) {
        const codeExists = await getCustomerByCode(updateData.customerCode);
        if (codeExists && codeExists.id !== id) {
          throw new Error('Customer code already exists');
        }
      }

      // Process metadata if provided
      if (updateData.metadata) {
        updateData.metadata = this.processCustomerMetadata(updateData.metadata);
      }

      const updatedCustomer = await updateCustomer(id, updateData);
      return {
        success: true,
        data: updatedCustomer,
        message: 'Customer updated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to update customer'
      };
    }
  }

  /**
   * Update customer metadata (merge with existing)
   */
  static async updateCustomerMetadata(id, metadataUpdate) {
    try {
      const processedMetadata = this.processCustomerMetadata(metadataUpdate);
      const updatedCustomer = await updateCustomerMetadata(id, processedMetadata);
      
      return {
        success: true,
        data: updatedCustomer,
        message: 'Customer metadata updated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to update customer metadata'
      };
    }
  }

  /**
   * Soft delete customer
   */
  static async deleteCustomer(id) {
    try {
      // Check if customer exists
      const existingCustomer = await getCustomerById(id);
      if (!existingCustomer) {
        return {
          success: false,
          error: 'Customer not found',
          message: 'Customer not found'
        };
      }

      // Instead of hard delete, mark as inactive in metadata
      const updatedCustomer = await updateCustomerMetadata(id, {
        isActive: false,
        deletedAt: new Date().toISOString()
      });

      return {
        success: true,
        data: updatedCustomer,
        message: 'Customer deleted successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to delete customer'
      };
    }
  }

  /**
   * Process customer sale transaction
   */
  static async processSale(saleData) {
    try {
      const { customerId, items, referenceNumber, performedBy, notes } = saleData;

      // Validate required fields
      if (!customerId || !items || !Array.isArray(items) || items.length === 0) {
        throw new Error('Customer ID and items are required');
      }

      // Validate items
      for (const item of items) {
        if (!item.productId || !item.warehouseId || !item.quantity || !item.unitPrice) {
          throw new Error('Each item must have productId, warehouseId, quantity, and unitPrice');
        }
        if (item.quantity <= 0 || item.unitPrice <= 0) {
          throw new Error('Quantity and unit price must be positive numbers');
        }
      }

      const result = await processSale({
        customerId,
        items,
        referenceNumber: referenceNumber || `SALE-${Date.now()}`,
        performedBy,
        notes
      });

      return {
        success: true,
        data: result,
        message: 'Sale processed successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to process sale'
      };
    }
  }

  /**
   * Get customer analytics data
   */
  static async getCustomerAnalytics(customerId) {
    try {
      const [
        clv,
        aov,
        frequency,
        churnRisk,
        salesVelocity
      ] = await Promise.all([
        calculateCustomerLifetimeValue(customerId),
        calculateAverageOrderValue(customerId),
        calculatePurchaseFrequency(customerId),
        calculateChurnPredictionIndicators(customerId),
        getCustomerSalesVelocity(customerId)
      ]);

      return {
        success: true,
        data: {
          customerLifetimeValue: clv,
          averageOrderValue: aov,
          purchaseFrequency: frequency,
          churnRisk: churnRisk,
          salesVelocity: salesVelocity
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve customer analytics'
      };
    }
  }

  /**
   * Get customers analytics overview
   */
  static async getAnalyticsOverview(params = {}) {
    try {
      const overview = await getCustomersAnalyticsOverview(params);
      return {
        success: true,
        data: overview
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve analytics overview'
      };
    }
  }

  /**
   * Process customer metadata according to the 4 sets structure
   */
  static processCustomerMetadata(metadata) {
    const processedMetadata = {
      // Set 1: Basic Information
      basicInfo: {
        contactPerson: metadata.contactPerson || '',
        title: metadata.title || '',
        department: metadata.department || '',
        notes: metadata.notes || '',
        ...((metadata.basicInfo || {}))
      },

      // Set 2: Business Information
      businessInfo: {
        taxId: metadata.taxId || '',
        businessType: metadata.businessType || '',
        industry: metadata.industry || '',
        creditLimit: metadata.creditLimit || 0,
        creditTerms: metadata.creditTerms || 'NET30',
        paymentTerms: metadata.paymentTerms || 'NET30',
        ...((metadata.businessInfo || {}))
      },

      // Set 3: Preferences
      preferences: {
        communicationMethod: metadata.communicationMethod || 'email',
        deliveryPreference: metadata.deliveryPreference || 'standard',
        paymentMethod: metadata.paymentMethod || 'invoice',
        currency: metadata.currency || 'USD',
        language: metadata.language || 'en',
        timezone: metadata.timezone || 'UTC',
        notifications: {
          orderUpdates: metadata.orderUpdates !== false,
          promotions: metadata.promotions !== false,
          invoices: metadata.invoices !== false,
          ...(metadata.notifications || {})
        },
        ...((metadata.preferences || {}))
      },

      // Set 4: Custom Fields (flexible key-value pairs)
      customFields: {
        ...((metadata.customFields || {})),
        // Move any unrecognized fields to custom fields
        ...Object.keys(metadata).reduce((acc, key) => {
          if (!['basicInfo', 'businessInfo', 'preferences', 'customFields'].includes(key) &&
              !['contactPerson', 'title', 'department', 'notes', 'taxId', 'businessType', 
                'industry', 'creditLimit', 'creditTerms', 'paymentTerms', 'communicationMethod',
                'deliveryPreference', 'paymentMethod', 'currency', 'language', 'timezone',
                'notifications', 'orderUpdates', 'promotions', 'invoices'].includes(key)) {
            acc[key] = metadata[key];
          }
          return acc;
        }, {})
      },

      // System metadata
      isActive: metadata.isActive !== false,
      lastUpdated: new Date().toISOString(),
      version: (metadata.version || 0) + 1
    };

    return processedMetadata;
  }

  /**
   * Validate customer metadata structure
   */
  static validateMetadata(metadata) {
    const errors = [];

    // Validate business info
    if (metadata.businessInfo) {
      if (metadata.businessInfo.creditLimit && metadata.businessInfo.creditLimit < 0) {
        errors.push('Credit limit cannot be negative');
      }
    }

    // Validate preferences
    if (metadata.preferences) {
      const validCommunicationMethods = ['email', 'phone', 'sms', 'postal'];
      if (metadata.preferences.communicationMethod && 
          !validCommunicationMethods.includes(metadata.preferences.communicationMethod)) {
        errors.push('Invalid communication method');
      }

      const validDeliveryPreferences = ['standard', 'express', 'priority', 'economy'];
      if (metadata.preferences.deliveryPreference && 
          !validDeliveryPreferences.includes(metadata.preferences.deliveryPreference)) {
        errors.push('Invalid delivery preference');
      }

      const validPaymentMethods = ['invoice', 'credit_card', 'bank_transfer', 'check', 'cash'];
      if (metadata.preferences.paymentMethod && 
          !validPaymentMethods.includes(metadata.preferences.paymentMethod)) {
        errors.push('Invalid payment method');
      }
    }

    return errors;
  }

  /**
   * Search customers by various criteria
   */
  static async searchCustomers(searchTerm, options = {}) {
    try {
      const {
        page = 1,
        pageSize = 10,
        searchFields = ['companyName', 'email', 'customerCode']
      } = options;

      const customers = await searchCustomers(searchTerm, page, pageSize);

      return {
        success: true,
        data: {
          customers,
          searchTerm,
          pagination: {
            page,
            pageSize,
            totalCount: customers.length // Approximate for search results
          }
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to search customers'
      };
    }
  }

  /**
   * Get high value customers
   */
  static async getHighValueCustomers(threshold = 10000, limit = 50) {
    try {
      const customers = await getHighValueCustomers(threshold);
      
      return {
        success: true,
        data: {
          customers: customers.slice(0, limit),
          threshold,
          totalCount: customers.length
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve high value customers'
      };
    }
  }

  /**
   * Get customer segmentation
   */
  static async getCustomerSegmentation() {
    try {
      const segmentation = await performCustomerSegmentation();
      
      return {
        success: true,
        data: segmentation
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to perform customer segmentation'
      };
    }
  }

  /**
   * Get purchase patterns analysis
   */
  static async getPurchasePatterns(customerId, params = {}) {
    try {
      const patterns = await analyzePurchasePatterns(customerId, params);
      
      return {
        success: true,
        data: patterns
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to analyze purchase patterns'
      };
    }
  }

  /**
   * Reserve stock for customer
   */
  static async reserveStock(customerId, items) {
    try {
      const reservations = await reserveStockForCustomer(customerId, items);
      
      return {
        success: true,
        data: reservations,
        message: 'Stock reserved successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to reserve stock'
      };
    }
  }

  /**
   * Release reserved stock
   */
  static async releaseReservation(customerId, items) {
    try {
      const releases = await releaseCustomerReservation(customerId, items);
      
      return {
        success: true,
        data: releases,
        message: 'Stock reservation released successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to release stock reservation'
      };
    }
  }

  /**
   * Get customer backorders
   */
  static async getCustomerBackorders(customerId) {
    try {
      const backorders = await getCustomerBackorders(customerId);
      
      return {
        success: true,
        data: backorders
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve customer backorders'
      };
    }
  }

  // ==================== PURCHASE ORDER MANAGEMENT ====================

  /**
   * Create a new purchase order for customer
   */
  static async createPurchaseOrder(orderData) {
    try {
      // Validate required fields
      const requiredFields = ['customerId', 'items'];
      for (const field of requiredFields) {
        if (!orderData[field]) {
          throw new Error(`${field} is required`);
        }
      }

      // Validate items
      if (!Array.isArray(orderData.items) || orderData.items.length === 0) {
        throw new Error('At least one item is required');
      }

      for (const item of orderData.items) {
        if (!item.productId || !item.sku || !item.productName || !item.quantity || !item.unitPrice) {
          throw new Error('Each item must have productId, sku, productName, quantity, and unitPrice');
        }
        if (item.quantity <= 0 || item.unitPrice <= 0) {
          throw new Error('Quantity and unit price must be positive numbers');
        }
      }

      // Check if customer exists
      const customer = await getCustomerById(orderData.customerId);
      if (!customer) {
        throw new Error('Customer not found');
      }

      const newOrder = await createPurchaseOrder(orderData);
      
      return {
        success: true,
        data: newOrder,
        message: 'Purchase order created successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to create purchase order'
      };
    }
  }

  /**
   * Get purchase order by ID
   */
  static async getPurchaseOrderById(id) {
    try {
      const order = await getPurchaseOrderById(id);
      if (!order) {
        return {
          success: false,
          error: 'Purchase order not found',
          message: 'Purchase order not found'
        };
      }

      return {
        success: true,
        data: order
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve purchase order'
      };
    }
  }

  /**
   * Get customer purchase orders with filtering and pagination
   */
  static async getCustomerPurchaseOrders(customerId, params = {}) {
    try {
      // Check if customer exists
      const customer = await getCustomerById(customerId);
      if (!customer) {
        return {
          success: false,
          error: 'Customer not found',
          message: 'Customer not found'
        };
      }

      const result = await getCustomerPurchaseOrders(customerId, params);
      
      return {
        success: true,
        data: result
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve customer purchase orders'
      };
    }
  }

  /**
   * Search purchase orders
   */
  static async searchPurchaseOrders(searchTerm, params = {}) {
    try {
      if (!searchTerm) {
        throw new Error('Search term is required');
      }

      const orders = await searchPurchaseOrders(searchTerm, params);
      
      return {
        success: true,
        data: {
          orders,
          searchTerm,
          pagination: {
            page: params.page || 1,
            pageSize: params.pageSize || 10,
            totalCount: orders.length
          }
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to search purchase orders'
      };
    }
  }

  /**
   * Update purchase order status
   */
  static async updatePurchaseOrderStatus(id, status, metadata = {}) {
    try {
      const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled'];
      if (!validStatuses.includes(status)) {
        throw new Error(`Invalid status. Must be one of: ${validStatuses.join(', ')}`);
      }

      const updatedOrder = await updatePurchaseOrderStatus(id, status, metadata);
      if (!updatedOrder) {
        throw new Error('Purchase order not found');
      }

      return {
        success: true,
        data: updatedOrder,
        message: 'Purchase order status updated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to update purchase order status'
      };
    }
  }

  /**
   * Update purchase order payment status
   */
  static async updatePurchaseOrderPaymentStatus(id, paymentStatus, paymentMethod = null) {
    try {
      const validPaymentStatuses = ['pending', 'paid', 'partial', 'failed'];
      if (!validPaymentStatuses.includes(paymentStatus)) {
        throw new Error(`Invalid payment status. Must be one of: ${validPaymentStatuses.join(', ')}`);
      }

      const updatedOrder = await updatePurchaseOrderPaymentStatus(id, paymentStatus, paymentMethod);
      if (!updatedOrder) {
        throw new Error('Purchase order not found');
      }

      return {
        success: true,
        data: updatedOrder,
        message: 'Purchase order payment status updated successfully'
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to update purchase order payment status'
      };
    }
  }

  // ==================== ENHANCED PURCHASE HISTORY ANALYTICS ====================

  /**
   * Get comprehensive customer purchase history
   */
  static async getCustomerPurchaseHistory(customerId, params = {}) {
    try {
      // Check if customer exists
      const customer = await getCustomerById(customerId);
      if (!customer) {
        return {
          success: false,
          error: 'Customer not found',
          message: 'Customer not found'
        };
      }

      const [
        summary,
        orders,
        topProducts,
        frequency
      ] = await Promise.all([
        getCustomerPurchaseHistorySummary(customerId, params),
        getCustomerPurchaseOrders(customerId, { ...params, pageSize: 10 }),
        getCustomerTopProducts(customerId, 5),
        getCustomerPurchaseFrequency(customerId)
      ]);

      return {
        success: true,
        data: {
          customer: {
            id: customer.id,
            customerCode: customer.customerCode,
            companyName: customer.companyName,
            email: customer.email
          },
          summary,
          recentOrders: orders.orders,
          topProducts,
          frequency,
          generatedAt: new Date().toISOString()
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to retrieve customer purchase history'
      };
    }
  }

  /**
   * Get customer purchase trends and patterns
   */
  static async getCustomerPurchaseTrends(customerId, params = {}) {
    try {
      const [
        patterns,
        frequency,
        topProducts
      ] = await Promise.all([
        analyzePurchasePatterns(customerId, params),
        getCustomerPurchaseFrequency(customerId),
        getCustomerTopProducts(customerId, 10)
      ]);

      return {
        success: true,
        data: {
          patterns,
          frequency,
          topProducts,
          customerId
        }
      };
    } catch (error) {
      return {
        success: false,
        error: error.message,
        message: 'Failed to analyze customer purchase trends'
      };
    }
  }
}

export default CustomerService;