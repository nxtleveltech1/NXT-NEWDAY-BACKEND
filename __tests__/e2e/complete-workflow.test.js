/**
 * Complete End-to-End Workflow Tests
 * 
 * Tests the entire business workflow from supplier onboarding to customer fulfillment
 * - Supplier registration and approval
 * - Price list upload and validation
 * - Product catalog management
 * - Inventory management
 * - Purchase order creation and fulfillment
 * - Customer order processing
 * - Returns and refunds
 * - Analytics and reporting
 */

import { describe, beforeAll, afterAll, beforeEach, test, expect } from '@jest/globals';
import { db } from '../../src/config/database.js';
import { 
  suppliers, 
  priceLists, 
  priceListItems, 
  products, 
  inventory, 
  inventoryMovements,
  supplierPurchaseOrders,
  supplierPurchaseOrderItems,
  purchaseOrders,
  purchaseOrderItems,
  customers,
  timeSeriesEvents
} from '../../src/db/schema.js';

// Import all services
import { CustomerService } from '../../src/services/customer.service.js';
import { 
  getSuppliersService,
  getSupplierByIdService,
  createSupplierService,
  updateSupplierService,
  getSupplierPerformanceService
} from '../../src/services/supplier.service.js';
import {
  allocateInventoryForOrder,
  generatePickList,
  processOrderShipment,
  createBackorder,
  processReturn
} from '../../src/services/order-inventory-integration.service.js';
import { AnalyticsService } from '../../src/services/analytics.service.js';
import { eq, and, desc } from 'drizzle-orm';

describe('Complete E2E Workflow Tests', () => {
  let testData = {};
  let analyticsService;

  beforeAll(async () => {
    analyticsService = new AnalyticsService();
    await analyticsService.initialize();
    await setupCompleteTestEnvironment();
  });

  afterAll(async () => {
    await cleanupCompleteTestEnvironment();
  });

  beforeEach(async () => {
    // Reset test state without full cleanup
    await resetWorkflowState();
  });

  // ==================== SETUP AND TEARDOWN ====================

  async function setupCompleteTestEnvironment() {
    console.log('Setting up complete E2E test environment...');

    // Create test warehouse
    testData.warehouseId = '550e8400-e29b-41d4-a716-446655440001';

    // Create test users
    testData.users = {
      admin: 'user-admin-001',
      procurement: 'user-procurement-001',
      warehouse: 'user-warehouse-001',
      sales: 'user-sales-001'
    };

    console.log('E2E test environment setup complete');
  }

  async function cleanupCompleteTestEnvironment() {
    console.log('Cleaning up complete E2E test environment...');
    
    // Clean up in dependency order
    const tables = [
      purchaseOrderItems,
      purchaseOrders,
      supplierPurchaseOrderItems,
      supplierPurchaseOrders,
      inventoryMovements,
      inventory,
      priceListItems,
      priceLists,
      products,
      customers,
      suppliers,
      timeSeriesEvents
    ];

    for (const table of tables) {
      try {
        await db.delete(table);
      } catch (error) {
        console.warn(`Failed to clean table: ${error.message}`);
      }
    }

    console.log('E2E test environment cleanup complete');
  }

  async function resetWorkflowState() {
    // Reset inventory quantities and states
    try {
      await db.update(inventory)
        .set({
          quantityOnHand: 0,
          quantityAvailable: 0,
          quantityReserved: 0,
          quantityInTransit: 0,
          stockStatus: 'out_of_stock'
        });
    } catch (error) {
      // Ignore if no inventory exists yet
    }

    // Clear dynamic data but keep master data
    await db.delete(purchaseOrderItems);
    await db.delete(purchaseOrders);
    await db.delete(supplierPurchaseOrderItems);
    await db.delete(supplierPurchaseOrders);
    await db.delete(inventoryMovements);
  }

  // ==================== COMPLETE BUSINESS WORKFLOW TEST ====================

  describe('Complete Business Workflow', () => {
    test('end-to-end business process from supplier onboarding to customer fulfillment', async () => {
      // Track workflow performance
      const workflowStart = Date.now();
      const checkpoints = {};

      // ========== PHASE 1: SUPPLIER ONBOARDING ==========
      console.log('Phase 1: Supplier Onboarding');
      checkpoints.supplierStart = Date.now();

      // Step 1.1: Create new supplier
      const supplierData = {
        supplierCode: 'SUP-E2E-001',
        companyName: 'E2E Test Supplier Corp',
        email: 'supplier@e2etest.com',
        phone: '+1-555-0100',
        address: {
          street: '100 Supplier Boulevard',
          city: 'Supply City',
          state: 'SC',
          zip: '10001',
          country: 'USA'
        },
        contactDetails: {
          primaryContact: {
            name: 'John Supplier',
            email: 'john@e2etest.com',
            phone: '+1-555-0101',
            title: 'Sales Manager'
          },
          secondaryContact: {
            name: 'Jane Supplier',
            email: 'jane@e2etest.com',
            phone: '+1-555-0102',
            title: 'Account Manager'
          }
        },
        paymentTerms: {
          terms: 'NET30',
          discountTerms: '2/10 NET30',
          currency: 'USD'
        },
        leadTimeDays: 5,
        minimumOrderValue: 1000,
        performanceRating: 0, // New supplier
        certifications: ['ISO9001', 'ISO14001'],
        taxId: 'TAX123456789',
        businessType: 'Corporation',
        industry: 'Manufacturing',
        isActive: true,
        isApproved: false // Requires approval
      };

      const supplierResult = await createSupplierService(supplierData, testData.users.admin);
      expect(supplierResult.success).toBe(true);
      testData.supplier = supplierResult.data;

      // Step 1.2: Approve supplier (simulate approval workflow)
      const approvalResult = await updateSupplierService(
        testData.supplier.id,
        { 
          isApproved: true,
          approvedBy: testData.users.admin,
          approvedAt: new Date().toISOString()
        },
        testData.users.admin
      );
      expect(approvalResult.success).toBe(true);

      checkpoints.supplierComplete = Date.now();
      console.log(`Supplier onboarding: ${checkpoints.supplierComplete - checkpoints.supplierStart}ms`);

      // ========== PHASE 2: PRODUCT CATALOG SETUP ==========
      console.log('Phase 2: Product Catalog Setup');
      checkpoints.catalogStart = Date.now();

      // Step 2.1: Create product categories and products
      const productData = [
        {
          sku: 'E2E-WIDGET-001',
          name: 'Premium Widget A',
          description: 'High-quality widget for professional use',
          category: 'Widgets',
          subcategory: 'Premium',
          unitPrice: 49.99,
          costPrice: 29.99,
          weight: 1.5,
          dimensions: { length: 10, width: 5, height: 3 },
          supplierId: testData.supplier.id,
          manufacturerPartNumber: 'MPN-WIDGET-A',
          barcode: '1234567890123',
          tags: ['premium', 'widget', 'professional'],
          specifications: {
            material: 'Aluminum',
            color: 'Silver',
            warranty: '2 years'
          },
          isActive: true,
          isDiscontinued: false
        },
        {
          sku: 'E2E-WIDGET-002',
          name: 'Standard Widget B',
          description: 'Standard widget for general use',
          category: 'Widgets',
          subcategory: 'Standard',
          unitPrice: 24.99,
          costPrice: 14.99,
          weight: 1.0,
          dimensions: { length: 8, width: 4, height: 2 },
          supplierId: testData.supplier.id,
          manufacturerPartNumber: 'MPN-WIDGET-B',
          barcode: '1234567890124',
          tags: ['standard', 'widget', 'general'],
          specifications: {
            material: 'Plastic',
            color: 'Black',
            warranty: '1 year'
          },
          isActive: true,
          isDiscontinued: false
        },
        {
          sku: 'E2E-GADGET-001',
          name: 'Electronic Gadget Pro',
          description: 'Advanced electronic gadget with smart features',
          category: 'Electronics',
          subcategory: 'Gadgets',
          unitPrice: 199.99,
          costPrice: 119.99,
          weight: 0.8,
          dimensions: { length: 6, width: 4, height: 1 },
          supplierId: testData.supplier.id,
          manufacturerPartNumber: 'MPN-GADGET-PRO',
          barcode: '1234567890125',
          tags: ['electronic', 'gadget', 'smart', 'pro'],
          specifications: {
            battery: 'Li-ion 3000mAh',
            connectivity: 'WiFi, Bluetooth',
            display: '5 inch OLED',
            warranty: '3 years'
          },
          isActive: true,
          isDiscontinued: false
        }
      ];

      const insertedProducts = await db.insert(products)
        .values(productData)
        .returning();
      testData.products = insertedProducts;

      // Step 2.2: Create price list
      const [priceList] = await db.insert(priceLists)
        .values({
          supplierId: testData.supplier.id,
          name: 'E2E Test Price List 2024',
          description: 'Comprehensive price list for E2E testing',
          effectiveDate: new Date(),
          expiryDate: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
          status: 'active',
          validationStatus: 'validated',
          currency: 'USD',
          itemCount: testData.products.length,
          totalValue: testData.products.reduce((sum, p) => sum + parseFloat(p.costPrice), 0),
          createdBy: testData.users.procurement,
          metadata: {
            source: 'e2e_test',
            version: '1.0',
            notes: 'Initial price list for E2E testing'
          }
        })
        .returning();
      testData.priceList = priceList;

      // Step 2.3: Create price list items
      const priceItems = testData.products.map(product => ({
        priceListId: testData.priceList.id,
        sku: product.sku,
        description: product.description,
        unitPrice: parseFloat(product.costPrice),
        currency: 'USD',
        minimumQuantity: 1,
        maximumQuantity: 1000,
        leadTimeDays: 5,
        isActive: true,
        discountTiers: [
          { minQuantity: 10, discountPercent: 5 },
          { minQuantity: 50, discountPercent: 10 },
          { minQuantity: 100, discountPercent: 15 }
        ]
      }));

      await db.insert(priceListItems).values(priceItems);

      checkpoints.catalogComplete = Date.now();
      console.log(`Product catalog setup: ${checkpoints.catalogComplete - checkpoints.catalogStart}ms`);

      // ========== PHASE 3: INVENTORY INITIALIZATION ==========
      console.log('Phase 3: Inventory Initialization');
      checkpoints.inventoryStart = Date.now();

      // Step 3.1: Create initial inventory records
      const inventoryData = testData.products.map((product, index) => ({
        productId: product.id,
        warehouseId: testData.warehouseId,
        locationId: `A${index + 1}-01-${String(index + 1).padStart(2, '0')}`,
        quantityOnHand: 0, // Start with zero, will add via PO
        quantityAvailable: 0,
        quantityReserved: 0,
        quantityInTransit: 0,
        reorderPoint: 20,
        reorderQuantity: 100,
        averageCost: parseFloat(product.costPrice),
        lastPurchaseCost: parseFloat(product.costPrice),
        fifoLayers: [],
        stockStatus: 'out_of_stock',
        lastStockDate: new Date(),
        lastCountDate: new Date(),
        lastMovement: new Date(),
        ABC_classification: index === 0 ? 'A' : index === 1 ? 'B' : 'C',
        velocityCode: 'medium',
        seasonalityCode: 'none',
        metadata: {
          binType: 'standard',
          storageRequirements: 'normal',
          handlingInstructions: 'standard'
        }
      }));

      await db.insert(inventory).values(inventoryData);
      testData.inventory = inventoryData;

      checkpoints.inventoryComplete = Date.now();
      console.log(`Inventory initialization: ${checkpoints.inventoryComplete - checkpoints.inventoryStart}ms`);

      // ========== PHASE 4: SUPPLIER PURCHASE ORDER ==========
      console.log('Phase 4: Supplier Purchase Order');
      checkpoints.purchaseStart = Date.now();

      // Step 4.1: Create supplier purchase order for initial stock
      const poData = {
        supplierId: testData.supplier.id,
        orderNumber: `SPO-E2E-${Date.now()}`,
        description: 'Initial stock purchase for E2E testing',
        currency: 'USD',
        paymentTerms: 'NET30',
        deliveryTerms: 'FOB Origin',
        requestedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        warehouseId: testData.warehouseId,
        status: 'draft',
        priority: 'normal',
        createdBy: testData.users.procurement,
        metadata: {
          source: 'e2e_test',
          orderType: 'initial_stock',
          approvalRequired: true
        }
      };

      const [supplierPO] = await db.insert(supplierPurchaseOrders)
        .values(poData)
        .returning();
      testData.supplierPO = supplierPO;

      // Step 4.2: Add items to supplier PO
      const poItems = testData.products.map((product, index) => ({
        supplierPurchaseOrderId: testData.supplierPO.id,
        productId: product.id,
        sku: product.sku,
        productName: product.name,
        description: product.description,
        quantityOrdered: 50 + (index * 25), // 50, 75, 100
        unitCost: parseFloat(product.costPrice),
        lineTotal: (50 + (index * 25)) * parseFloat(product.costPrice),
        warehouseId: testData.warehouseId,
        requestedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        notes: `Initial stock order for ${product.name}`
      }));

      const insertedPOItems = await db.insert(supplierPurchaseOrderItems)
        .values(poItems)
        .returning();

      // Step 4.3: Calculate totals and approve PO
      const totalAmount = poItems.reduce((sum, item) => sum + item.lineTotal, 0);
      
      await db.update(supplierPurchaseOrders)
        .set({
          subtotal: totalAmount,
          totalAmount: totalAmount,
          status: 'approved',
          approvedBy: testData.users.admin,
          approvedAt: new Date()
        })
        .where(eq(supplierPurchaseOrders.id, testData.supplierPO.id));

      // Step 4.4: Simulate receiving the goods
      for (let i = 0; i < poItems.length; i++) {
        const item = poItems[i];
        const product = testData.products[i];
        
        // Update inventory
        await db.update(inventory)
          .set({
            quantityOnHand: item.quantityOrdered,
            quantityAvailable: item.quantityOrdered,
            stockStatus: 'in_stock',
            lastMovement: new Date(),
            lastStockDate: new Date()
          })
          .where(and(
            eq(inventory.productId, product.id),
            eq(inventory.warehouseId, testData.warehouseId)
          ));

        // Record inventory movement
        await db.insert(inventoryMovements)
          .values({
            inventoryId: i + 1, // Simplified for test
            productId: product.id,
            warehouseId: testData.warehouseId,
            movementType: 'purchase',
            quantity: item.quantityOrdered,
            unitCost: item.unitCost,
            totalCost: item.lineTotal,
            referenceType: 'supplier_purchase_order',
            referenceId: testData.supplierPO.id,
            referenceNumber: testData.supplierPO.orderNumber,
            performedBy: testData.users.warehouse,
            notes: `Received from supplier: ${testData.supplier.companyName}`,
            quantityAfter: item.quantityOrdered,
            runningTotal: item.quantityOrdered
          });
      }

      checkpoints.purchaseComplete = Date.now();
      console.log(`Supplier purchase order: ${checkpoints.purchaseComplete - checkpoints.purchaseStart}ms`);

      // ========== PHASE 5: CUSTOMER MANAGEMENT ==========
      console.log('Phase 5: Customer Management');
      checkpoints.customerStart = Date.now();

      // Step 5.1: Create test customers
      const customerData = [
        {
          customerCode: 'CUST-E2E-001',
          companyName: 'E2E Test Customer Corp',
          email: 'customer@e2etest.com',
          phone: '+1-555-0200',
          website: 'https://e2etest.com',
          address: {
            billing: {
              street: '200 Customer Street',
              city: 'Customer City',
              state: 'CC',
              zip: '20002',
              country: 'USA'
            },
            shipping: {
              street: '201 Shipping Lane',
              city: 'Customer City',
              state: 'CC',
              zip: '20003',
              country: 'USA'
            }
          },
          metadata: {
            basicInfo: {
              contactPerson: 'Alice Customer',
              title: 'Procurement Manager',
              department: 'Operations'
            },
            businessInfo: {
              taxId: 'CUST-TAX-001',
              businessType: 'Corporation',
              industry: 'Retail',
              creditLimit: 50000,
              creditTerms: 'NET30',
              paymentTerms: 'NET30'
            },
            preferences: {
              communicationMethod: 'email',
              deliveryPreference: 'standard',
              paymentMethod: 'invoice',
              currency: 'USD',
              language: 'en',
              timezone: 'America/New_York',
              notifications: {
                orderUpdates: true,
                promotions: false,
                invoices: true
              }
            }
          },
          purchaseHistory: { orders: [], totalLifetimeValue: 0 }
        },
        {
          customerCode: 'CUST-E2E-002',
          companyName: 'E2E Premium Customer Inc',
          email: 'premium@e2etest.com',
          phone: '+1-555-0300',
          address: {
            billing: {
              street: '300 Premium Avenue',
              city: 'Premium City',
              state: 'PC',
              zip: '30003',
              country: 'USA'
            }
          },
          metadata: {
            basicInfo: {
              contactPerson: 'Bob Premium',
              title: 'CEO',
              department: 'Executive'
            },
            businessInfo: {
              taxId: 'PREM-TAX-002',
              businessType: 'Corporation',
              industry: 'Technology',
              creditLimit: 100000,
              creditTerms: 'NET15',
              paymentTerms: 'NET15'
            },
            preferences: {
              communicationMethod: 'phone',
              deliveryPreference: 'express',
              paymentMethod: 'credit_card',
              currency: 'USD'
            }
          }
        }
      ];

      const customerResults = [];
      for (const customer of customerData) {
        const result = await CustomerService.createCustomer(customer);
        expect(result.success).toBe(true);
        customerResults.push(result.data);
      }
      testData.customers = customerResults;

      checkpoints.customerComplete = Date.now();
      console.log(`Customer management: ${checkpoints.customerComplete - checkpoints.customerStart}ms`);

      // ========== PHASE 6: CUSTOMER ORDER PROCESSING ==========
      console.log('Phase 6: Customer Order Processing');
      checkpoints.orderStart = Date.now();

      // Step 6.1: Create customer orders
      const orderData = {
        customerId: testData.customers[0].id,
        orderNumber: `CO-E2E-${Date.now()}`,
        orderDate: new Date(),
        requestedDeliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000), // 3 days
        priority: 'normal',
        currency: 'USD',
        status: 'pending',
        paymentStatus: 'pending',
        paymentMethod: 'invoice',
        shippingMethod: 'standard',
        shippingAddress: testData.customers[0].address.shipping || testData.customers[0].address.billing,
        billingAddress: testData.customers[0].address.billing,
        notes: 'E2E test order for workflow validation',
        createdBy: testData.users.sales,
        metadata: {
          source: 'e2e_test',
          orderType: 'standard',
          channel: 'direct'
        }
      };

      const [customerOrder] = await db.insert(purchaseOrders)
        .values(orderData)
        .returning();
      testData.customerOrder = customerOrder;

      // Step 6.2: Add order items
      const orderItems = [
        {
          purchaseOrderId: testData.customerOrder.id,
          productId: testData.products[0].id,
          sku: testData.products[0].sku,
          productName: testData.products[0].name,
          description: testData.products[0].description,
          quantity: 10,
          unitPrice: parseFloat(testData.products[0].unitPrice),
          lineTotal: 10 * parseFloat(testData.products[0].unitPrice),
          warehouseId: testData.warehouseId,
          requestedDeliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          notes: 'Premium widgets for project Alpha'
        },
        {
          purchaseOrderId: testData.customerOrder.id,
          productId: testData.products[1].id,
          sku: testData.products[1].sku,
          productName: testData.products[1].name,
          description: testData.products[1].description,
          quantity: 25,
          unitPrice: parseFloat(testData.products[1].unitPrice),
          lineTotal: 25 * parseFloat(testData.products[1].unitPrice),
          warehouseId: testData.warehouseId,
          requestedDeliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          notes: 'Standard widgets for general use'
        },
        {
          purchaseOrderId: testData.customerOrder.id,
          productId: testData.products[2].id,
          sku: testData.products[2].sku,
          productName: testData.products[2].name,
          description: testData.products[2].description,
          quantity: 5,
          unitPrice: parseFloat(testData.products[2].unitPrice),
          lineTotal: 5 * parseFloat(testData.products[2].unitPrice),
          warehouseId: testData.warehouseId,
          requestedDeliveryDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
          notes: 'Electronic gadgets for tech integration'
        }
      ];

      await db.insert(purchaseOrderItems).values(orderItems);

      // Step 6.3: Calculate order totals
      const orderTotal = orderItems.reduce((sum, item) => sum + item.lineTotal, 0);
      const tax = orderTotal * 0.08; // 8% tax
      const shipping = 25.00; // Flat shipping

      await db.update(purchaseOrders)
        .set({
          subtotal: orderTotal,
          taxAmount: tax,
          shippingAmount: shipping,
          totalAmount: orderTotal + tax + shipping
        })
        .where(eq(purchaseOrders.id, testData.customerOrder.id));

      // Step 6.4: Allocate inventory
      const allocationResult = await allocateInventoryForOrder(testData.customerOrder.id, {
        allowPartialAllocation: true,
        createBackorders: false,
        userId: testData.users.warehouse
      });

      expect(allocationResult.success).toBe(true);
      expect(allocationResult.data.allocationComplete).toBe(true);

      // Step 6.5: Generate pick list
      const pickListResult = await generatePickList([testData.customerOrder.id], {
        warehouseId: testData.warehouseId,
        groupByLocation: true,
        priority: 'normal',
        userId: testData.users.warehouse
      });

      expect(pickListResult.success).toBe(true);
      testData.pickList = pickListResult.data;

      // Step 6.6: Process shipment
      const shipmentItems = orderItems.map(item => ({
        orderItemId: item.id,
        quantity: item.quantity
      }));

      const shipmentResult = await processOrderShipment(
        testData.customerOrder.id,
        shipmentItems,
        {
          trackingNumber: 'E2E-TRACK-001',
          carrier: 'UPS',
          shippedBy: testData.users.warehouse,
          notes: 'E2E test shipment'
        }
      );

      expect(shipmentResult.success).toBe(true);
      expect(shipmentResult.data.shipmentComplete).toBe(true);

      checkpoints.orderComplete = Date.now();
      console.log(`Customer order processing: ${checkpoints.orderComplete - checkpoints.orderStart}ms`);

      // ========== PHASE 7: RETURNS PROCESSING ==========
      console.log('Phase 7: Returns Processing');
      checkpoints.returnStart = Date.now();

      // Step 7.1: Process a return
      const returnItems = [
        {
          orderItemId: orderItems[0].id,
          quantity: 2 // Return 2 out of 10 premium widgets
        }
      ];

      const returnResult = await processReturn(
        testData.customerOrder.id,
        returnItems,
        {
          reason: 'customer_return',
          condition: 'good',
          restockable: true,
          userId: testData.users.warehouse,
          notes: 'Customer changed requirements'
        }
      );

      expect(returnResult.success).toBe(true);
      expect(returnResult.data.returnedItems.length).toBe(1);
      expect(returnResult.data.inventoryUpdates.length).toBe(1);

      checkpoints.returnComplete = Date.now();
      console.log(`Returns processing: ${checkpoints.returnComplete - checkpoints.returnStart}ms`);

      // ========== PHASE 8: ANALYTICS AND REPORTING ==========
      console.log('Phase 8: Analytics and Reporting');
      checkpoints.analyticsStart = Date.now();

      // Step 8.1: Generate customer analytics
      const customerAnalytics = await CustomerService.getCustomerAnalytics(testData.customers[0].id);
      expect(customerAnalytics.success).toBe(true);

      // Step 8.2: Generate supplier performance analytics
      const supplierPerformance = await getSupplierPerformanceService(testData.supplier.id, {
        includeLeadTimes: true,
        includeReorderSuggestions: true
      });
      expect(supplierPerformance.success).toBe(true);

      // Step 8.3: Generate comprehensive analytics
      const dashboardAnalytics = await analyticsService.getDashboardAnalytics();
      expect(dashboardAnalytics.data).toBeDefined();

      checkpoints.analyticsComplete = Date.now();
      console.log(`Analytics and reporting: ${checkpoints.analyticsComplete - checkpoints.analyticsStart}ms`);

      // ========== WORKFLOW COMPLETION ==========
      const workflowEnd = Date.now();
      const totalDuration = workflowEnd - workflowStart;

      console.log('='.repeat(60));
      console.log('E2E WORKFLOW PERFORMANCE SUMMARY');
      console.log('='.repeat(60));
      console.log(`Total workflow duration: ${totalDuration}ms`);
      console.log(`Supplier onboarding: ${checkpoints.supplierComplete - checkpoints.supplierStart}ms`);
      console.log(`Product catalog setup: ${checkpoints.catalogComplete - checkpoints.catalogStart}ms`);
      console.log(`Inventory initialization: ${checkpoints.inventoryComplete - checkpoints.inventoryStart}ms`);
      console.log(`Purchase order processing: ${checkpoints.purchaseComplete - checkpoints.purchaseStart}ms`);
      console.log(`Customer management: ${checkpoints.customerComplete - checkpoints.customerStart}ms`);
      console.log(`Order processing: ${checkpoints.orderComplete - checkpoints.orderStart}ms`);
      console.log(`Returns processing: ${checkpoints.returnComplete - checkpoints.returnStart}ms`);
      console.log(`Analytics generation: ${checkpoints.analyticsComplete - checkpoints.analyticsStart}ms`);
      console.log('='.repeat(60));

      // Verify final state
      expect(totalDuration).toBeLessThan(60000); // Should complete within 60 seconds
      expect(testData.supplier.isApproved).toBe(true);
      expect(testData.products.length).toBe(3);
      expect(testData.customers.length).toBe(2);
      expect(allocationResult.data.allocationComplete).toBe(true);
      expect(shipmentResult.data.shipmentComplete).toBe(true);
      expect(returnResult.data.returnedItems.length).toBe(1);

      // Verify business rules
      const finalInventory = await db.select()
        .from(inventory)
        .where(eq(inventory.warehouseId, testData.warehouseId));

      expect(finalInventory.length).toBe(3);
      
      // Verify movement tracking
      const movements = await db.select()
        .from(inventoryMovements)
        .where(eq(inventoryMovements.warehouseId, testData.warehouseId))
        .orderBy(desc(inventoryMovements.createdAt));

      expect(movements.length).toBeGreaterThan(0);

      // Log test data for verification
      testData.performanceMetrics = {
        totalDuration,
        checkpoints,
        finalInventory,
        movements: movements.length
      };

      console.log('E2E workflow test completed successfully!');
    });
  });

  // ==================== DATA CONSISTENCY TESTS ==========

  describe('Data Consistency Validation', () => {
    test('should maintain referential integrity across all modules', async () => {
      // Run a complete workflow first
      await test('end-to-end business process from supplier onboarding to customer fulfillment');

      // Verify referential integrity
      const suppliers = await db.select().from(suppliers);
      const products = await db.select().from(products);
      const customers = await db.select().from(customers);
      const orders = await db.select().from(purchaseOrders);
      const inventory = await db.select().from(inventory);

      // Check supplier-product relationships
      for (const product of products) {
        const supplier = suppliers.find(s => s.id === product.supplierId);
        expect(supplier).toBeDefined();
      }

      // Check product-inventory relationships
      for (const inv of inventory) {
        const product = products.find(p => p.id === inv.productId);
        expect(product).toBeDefined();
      }

      // Check customer-order relationships
      for (const order of orders) {
        const customer = customers.find(c => c.id === order.customerId);
        expect(customer).toBeDefined();
      }
    });

    test('should maintain accurate inventory balances', async () => {
      const inventory = await db.select()
        .from(inventory)
        .where(eq(inventory.warehouseId, testData.warehouseId));

      for (const inv of inventory) {
        // Available + Reserved should equal OnHand
        expect(inv.quantityAvailable + inv.quantityReserved).toBe(inv.quantityOnHand);
        
        // Quantities should not be negative
        expect(inv.quantityOnHand).toBeGreaterThanOrEqual(0);
        expect(inv.quantityAvailable).toBeGreaterThanOrEqual(0);
        expect(inv.quantityReserved).toBeGreaterThanOrEqual(0);
      }
    });
  });

  // ==================== PERFORMANCE BENCHMARKS ==========

  describe('Performance Benchmarks', () => {
    test('should meet performance targets for each workflow phase', async () => {
      if (!testData.performanceMetrics) {
        console.log('Skipping performance test - no metrics available');
        return;
      }

      const { checkpoints } = testData.performanceMetrics;

      // Performance targets (in milliseconds)
      const targets = {
        supplier: 5000,    // Supplier onboarding should be < 5s
        catalog: 5000,     // Product catalog setup should be < 5s
        inventory: 2000,   // Inventory initialization should be < 2s
        purchase: 5000,    // Purchase order processing should be < 5s
        customer: 3000,    // Customer management should be < 3s
        order: 8000,       // Order processing should be < 8s
        return: 2000,      // Returns processing should be < 2s
        analytics: 5000    // Analytics generation should be < 5s
      };

      expect(checkpoints.supplierComplete - checkpoints.supplierStart).toBeLessThan(targets.supplier);
      expect(checkpoints.catalogComplete - checkpoints.catalogStart).toBeLessThan(targets.catalog);
      expect(checkpoints.inventoryComplete - checkpoints.inventoryStart).toBeLessThan(targets.inventory);
      expect(checkpoints.purchaseComplete - checkpoints.purchaseStart).toBeLessThan(targets.purchase);
      expect(checkpoints.customerComplete - checkpoints.customerStart).toBeLessThan(targets.customer);
      expect(checkpoints.orderComplete - checkpoints.orderStart).toBeLessThan(targets.order);
      expect(checkpoints.returnComplete - checkpoints.returnStart).toBeLessThan(targets.return);
      expect(checkpoints.analyticsComplete - checkpoints.analyticsStart).toBeLessThan(targets.analytics);
    });
  });

  // ==================== ERROR SCENARIOS ==========

  describe('Error Scenario Handling', () => {
    test('should handle insufficient inventory gracefully', async () => {
      // Create an order with quantity exceeding available inventory
      const orderData = {
        customerId: testData.customers[0].id,
        orderNumber: `CO-ERROR-${Date.now()}`,
        status: 'pending'
      };

      const [errorOrder] = await db.insert(purchaseOrders)
        .values(orderData)
        .returning();

      const errorOrderItems = [{
        purchaseOrderId: errorOrder.id,
        productId: testData.products[0].id,
        sku: testData.products[0].sku,
        productName: testData.products[0].name,
        quantity: 1000, // Exceeds available inventory
        unitPrice: parseFloat(testData.products[0].unitPrice),
        lineTotal: 1000 * parseFloat(testData.products[0].unitPrice)
      }];

      await db.insert(purchaseOrderItems).values(errorOrderItems);

      // Allocation should handle insufficient inventory
      const allocationResult = await allocateInventoryForOrder(errorOrder.id, {
        allowPartialAllocation: true,
        createBackorders: true,
        userId: testData.users.warehouse
      });

      expect(allocationResult.success).toBe(true);
      expect(allocationResult.data.allocationComplete).toBe(false);
      expect(allocationResult.data.partialAllocations.length).toBeGreaterThan(0);
    });

    test('should handle concurrent order processing', async () => {
      // Create two orders for the same product simultaneously
      const order1Data = {
        customerId: testData.customers[0].id,
        orderNumber: `CO-CONCURRENT-1-${Date.now()}`,
        status: 'pending'
      };

      const order2Data = {
        customerId: testData.customers[1].id,
        orderNumber: `CO-CONCURRENT-2-${Date.now()}`,
        status: 'pending'
      };

      const [order1, order2] = await Promise.all([
        db.insert(purchaseOrders).values(order1Data).returning(),
        db.insert(purchaseOrders).values(order2Data).returning()
      ]);

      // Add identical items to both orders
      const item1 = {
        purchaseOrderId: order1[0].id,
        productId: testData.products[0].id,
        sku: testData.products[0].sku,
        productName: testData.products[0].name,
        quantity: 30, // Large quantity
        unitPrice: parseFloat(testData.products[0].unitPrice),
        lineTotal: 30 * parseFloat(testData.products[0].unitPrice)
      };

      const item2 = {
        purchaseOrderId: order2[0].id,
        productId: testData.products[0].id,
        sku: testData.products[0].sku,
        productName: testData.products[0].name,
        quantity: 30, // Large quantity
        unitPrice: parseFloat(testData.products[0].unitPrice),
        lineTotal: 30 * parseFloat(testData.products[0].unitPrice)
      };

      await Promise.all([
        db.insert(purchaseOrderItems).values([item1]),
        db.insert(purchaseOrderItems).values([item2])
      ]);

      // Process allocations concurrently
      const allocationPromises = [
        allocateInventoryForOrder(order1[0].id, {
          allowPartialAllocation: true,
          createBackorders: true,
          userId: testData.users.warehouse
        }),
        allocateInventoryForOrder(order2[0].id, {
          allowPartialAllocation: true,
          createBackorders: true,
          userId: testData.users.warehouse
        })
      ];

      const allocationResults = await Promise.all(allocationPromises);

      // Both should succeed, but one or both should be partial
      expect(allocationResults[0].success).toBe(true);
      expect(allocationResults[1].success).toBe(true);

      // At least one should be partial due to inventory constraints
      const hasPartialAllocation = allocationResults.some(r => !r.data.allocationComplete);
      expect(hasPartialAllocation).toBe(true);
    });
  });
});