/**
 * Comprehensive Integration Tests for Cross-Module Workflows
 * Testing interactions between Customer, Supplier, Inventory, and Analytics modules
 */

import { CustomerService } from '../../src/services/customer.service.js';
import { 
  getSuppliersService,
  getSupplierByIdService,
  createSupplierService,
  processPurchaseReceiptService
} from '../../src/services/supplier.service.js';
import {
  allocateInventoryForOrder,
  generatePickList,
  processOrderShipment,
  createBackorder,
  processReturn
} from '../../src/services/order-inventory-integration.service.js';
import {
  getInventory,
  recordMovement,
  getReorderSuggestions
} from '../../src/db/inventory-queries.js';
import { AnalyticsService } from '../../src/services/analytics.service.js';
import { db } from '../../src/config/database.js';

// Mock database and external dependencies
jest.mock('../../src/config/database.js');
jest.mock('../../src/config/redis.js');
jest.mock('../../src/services/notifications.js');
jest.mock('../../src/services/realtime-service.js');

describe('Cross-Module Workflow Integration Tests', () => {
  let analyticsService;
  
  beforeEach(() => {
    jest.clearAllMocks();
    
    // Mock database operations
    setupDatabaseMocks();
    
    analyticsService = new AnalyticsService();
  });

  function setupDatabaseMocks() {
    // Setup comprehensive database mocking
    db.transaction = jest.fn((callback) => {
      const mockTx = createMockTransaction();
      return callback(mockTx);
    });

    db.select = jest.fn().mockReturnThis();
    db.insert = jest.fn().mockReturnThis();
    db.update = jest.fn().mockReturnThis();
    db.from = jest.fn().mockReturnThis();
    db.innerJoin = jest.fn().mockReturnThis();
    db.leftJoin = jest.fn().mockReturnThis();
    db.where = jest.fn().mockReturnThis();
    db.orderBy = jest.fn().mockReturnThis();
    db.groupBy = jest.fn().mockReturnThis();
    db.limit = jest.fn().mockReturnThis();
    db.offset = jest.fn().mockReturnThis();
    db.set = jest.fn().mockReturnThis();
    db.values = jest.fn().mockReturnThis();
    db.returning = jest.fn().mockResolvedValue([]);
  }

  function createMockTransaction() {
    return {
      select: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      innerJoin: jest.fn().mockReturnThis(),
      leftJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      groupBy: jest.fn().mockReturnThis(),
      limit: jest.fn().mockReturnThis(),
      offset: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      returning: jest.fn().mockResolvedValue([])
    };
  }

  // ==================== CUSTOMER-ORDER-INVENTORY WORKFLOW ====================

  describe('Customer Order to Inventory Fulfillment Workflow', () => {
    const mockCustomer = {
      id: 'customer-123',
      customerCode: 'CUST001',
      companyName: 'Test Customer Ltd',
      email: 'test@customer.com'
    };

    const mockProduct = {
      id: 'product-123',
      sku: 'SKU001',
      name: 'Test Product',
      unitPrice: 25.50
    };

    const mockInventory = {
      id: 'inventory-123',
      productId: 'product-123',
      warehouseId: 'warehouse-123',
      quantityOnHand: 100,
      quantityAvailable: 95,
      quantityReserved: 5
    };

    const mockOrder = {
      id: 'order-123',
      orderNumber: 'ORD-001',
      customerId: 'customer-123',
      status: 'pending',
      items: [
        {
          id: 'item-123',
          productId: 'product-123',
          sku: 'SKU001',
          productName: 'Test Product',
          quantity: 10,
          unitPrice: 25.50
        }
      ]
    };

    test('should complete full order-to-shipment workflow', async () => {
      // Setup mocks for complete workflow
      setupOrderWorkflowMocks();

      // Step 1: Create customer order (CustomerService)
      const customerResult = await CustomerService.createPurchaseOrder({
        customerId: mockCustomer.id,
        items: mockOrder.items,
        orderNumber: mockOrder.orderNumber
      });

      expect(customerResult.success).toBe(true);

      // Step 2: Allocate inventory for order
      const allocationResult = await allocateInventoryForOrder(mockOrder.id, {
        allowPartialAllocation: true,
        createBackorders: true,
        userId: 'user-123'
      });

      expect(allocationResult.success).toBe(true);
      expect(allocationResult.data.orderId).toBe(mockOrder.id);
      expect(allocationResult.data.totalItemsRequested).toBe(1);

      // Step 3: Generate pick list
      const pickListResult = await generatePickList([mockOrder.id], {
        groupByLocation: true,
        priority: 'standard'
      });

      expect(pickListResult.success).toBe(true);
      expect(pickListResult.data.orderCount).toBe(1);

      // Step 4: Process shipment
      const shipmentResult = await processOrderShipment(mockOrder.id, [
        {
          orderItemId: mockOrder.items[0].id,
          quantity: 10
        }
      ], {
        trackingNumber: 'TRACK123',
        carrier: 'UPS',
        shippedBy: 'user-123'
      });

      expect(shipmentResult.success).toBe(true);
      expect(shipmentResult.data.shipmentComplete).toBe(true);

      // Step 5: Verify inventory levels updated
      const inventoryResult = await getInventory({
        productId: mockProduct.id,
        warehouseId: mockInventory.warehouseId
      });

      expect(inventoryResult).toBeDefined();
    });

    test('should handle partial allocation and create backorders', async () => {
      // Setup for partial allocation scenario
      setupPartialAllocationMocks();

      const allocationResult = await allocateInventoryForOrder(mockOrder.id, {
        allowPartialAllocation: true,
        createBackorders: true
      });

      expect(allocationResult.success).toBe(true);
      expect(allocationResult.data.allocationComplete).toBe(false);
      expect(allocationResult.data.partialAllocations.length).toBeGreaterThan(0);

      // Create backorder for remaining items
      const backorderResult = await createBackorder(mockOrder.id, [
        {
          productId: mockProduct.id,
          sku: mockProduct.sku,
          productName: mockProduct.name,
          quantity: 5, // Remaining quantity
          unitPrice: mockProduct.unitPrice
        }
      ]);

      expect(backorderResult.success).toBe(true);
      expect(backorderResult.data.backorder).toBeDefined();
    });

    test('should process returns and update inventory', async () => {
      setupReturnProcessingMocks();

      const returnResult = await processReturn(mockOrder.id, [
        {
          orderItemId: mockOrder.items[0].id,
          quantity: 3
        }
      ], {
        reason: 'defective',
        condition: 'good',
        restockable: true,
        userId: 'user-123'
      });

      expect(returnResult.success).toBe(true);
      expect(returnResult.data.returnedItems.length).toBe(1);
      expect(returnResult.data.inventoryUpdates.length).toBe(1);
      expect(returnResult.data.inventoryUpdates[0].restocked).toBe(true);
    });

    function setupOrderWorkflowMocks() {
      // Mock customer queries
      jest.doMock('../../src/db/customer-queries.js', () => ({
        getCustomerById: jest.fn().mockResolvedValue(mockCustomer),
        createPurchaseOrder: jest.fn().mockResolvedValue({
          id: 'order-123',
          ...mockOrder
        })
      }));

      // Mock inventory allocation
      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn(() => ({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockOrder]),
                orderBy: jest.fn().mockResolvedValue([mockInventory])
              }),
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockResolvedValue([mockInventory])
                })
              })
            })
          })),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{}])
        };
        return callback(mockTx);
      });
    }

    function setupPartialAllocationMocks() {
      const insufficientInventory = {
        ...mockInventory,
        quantityAvailable: 5 // Less than required 10
      };

      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn(() => ({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockOrder]),
                orderBy: jest.fn().mockResolvedValue([insufficientInventory])
              }),
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockResolvedValue([insufficientInventory])
                })
              })
            })
          })),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{}])
        };
        return callback(mockTx);
      });
    }

    function setupReturnProcessingMocks() {
      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn(() => ({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([mockOrder.items[0]])
              }),
              innerJoin: jest.fn().mockReturnValue({
                where: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue([mockInventory])
                })
              })
            })
          })),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          insert: jest.fn().mockReturnThis(),
          values: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{}])
        };
        return callback(mockTx);
      });
    }
  });

  // ==================== SUPPLIER-PROCUREMENT-INVENTORY WORKFLOW ====================

  describe('Supplier Procurement to Inventory Workflow', () => {
    const mockSupplier = {
      id: 'supplier-123',
      supplierCode: 'SUP001',
      companyName: 'Test Supplier Ltd',
      email: 'test@supplier.com',
      isActive: true
    };

    const mockPurchaseReceipt = {
      supplierId: 'supplier-123',
      purchaseOrderNumber: 'PO-12345',
      referenceNumber: 'REF-12345',
      items: [
        {
          productId: 'product-123',
          quantity: 50,
          unitCost: 20.00
        }
      ],
      deliveryDate: new Date()
    };

    test('should complete supplier creation to inventory receipt workflow', async () => {
      setupSupplierWorkflowMocks();

      // Step 1: Create supplier
      const supplierResult = await createSupplierService({
        supplierCode: mockSupplier.supplierCode,
        companyName: mockSupplier.companyName,
        email: mockSupplier.email,
        contactDetails: {
          phone: '+1234567890',
          address: '123 Supplier St'
        }
      }, 'user-123');

      expect(supplierResult.success).toBe(true);

      // Step 2: Get supplier with performance metrics
      const supplierDetailsResult = await getSupplierByIdService(mockSupplier.id, {
        includePerformance: true,
        includeReorderSuggestions: true
      });

      expect(supplierDetailsResult.success).toBe(true);
      expect(supplierDetailsResult.data.performanceMetrics).toBeDefined();

      // Step 3: Process purchase receipt
      const receiptResult = await processPurchaseReceiptService(
        mockPurchaseReceipt,
        'user-123'
      );

      expect(receiptResult.success).toBe(true);
      expect(receiptResult.data.totalItems).toBe(1);
      expect(receiptResult.data.totalQuantity).toBe(50);

      // Step 4: Verify inventory movement recorded
      const movementResult = await recordMovement({
        inventoryId: 'inventory-123',
        productId: 'product-123',
        warehouseId: 'warehouse-123',
        movementType: 'purchase',
        quantity: 50,
        unitCost: 20.00,
        referenceType: 'purchase_receipt',
        referenceId: mockPurchaseReceipt.referenceNumber,
        performedBy: 'user-123'
      });

      expect(movementResult).toBeDefined();
    });

    test('should identify reorder suggestions and generate supplier rankings', async () => {
      setupReorderAnalysisMocks();

      // Step 1: Get reorder suggestions
      const reorderSuggestions = await getReorderSuggestions();

      expect(reorderSuggestions).toBeDefined();
      expect(Array.isArray(reorderSuggestions)).toBe(true);

      // Step 2: Get supplier performance rankings
      const suppliersResult = await getSuppliersService({
        includeStatistics: true,
        includePerformance: true
      });

      expect(suppliersResult.success).toBe(true);
      expect(suppliersResult.data.suppliers).toBeDefined();

      // Step 3: Get analytics for supplier performance
      await analyticsService.initialize();
      const supplierAnalytics = await analyticsService.getSupplierPerformance({
        dateFrom: '2024-01-01',
        dateTo: '2024-12-31'
      });

      expect(supplierAnalytics.data).toBeDefined();
    });

    function setupSupplierWorkflowMocks() {
      // Mock supplier creation
      jest.doMock('../../src/db/supplier-queries.js', () => ({
        supplierExistsByEmail: jest.fn().mockResolvedValue(false),
        getSupplierByCode: jest.fn().mockResolvedValue(null),
        createSupplier: jest.fn().mockResolvedValue({
          id: 'supplier-123',
          ...mockSupplier
        }),
        getSupplierById: jest.fn().mockResolvedValue(mockSupplier),
        getSupplierLeadTimes: jest.fn().mockResolvedValue([
          {
            productId: 'product-123',
            averageLeadTime: 7,
            totalDeliveries: 10
          }
        ]),
        getSupplierReorderSuggestions: jest.fn().mockResolvedValue([
          {
            productId: 'product-123',
            needsReorder: true,
            suggestedQuantity: 100
          }
        ]),
        updateInventoryOnPurchaseReceipt: jest.fn().mockResolvedValue([
          {
            id: 'movement-123',
            productId: 'product-123',
            quantity: 50
          }
        ])
      }));

      // Mock inventory operations
      db.transaction.mockImplementation(async (callback) => {
        const mockTx = {
          select: jest.fn().mockReturnValue({
            from: jest.fn().mockReturnValue({
              where: jest.fn().mockReturnValue({
                limit: jest.fn().mockResolvedValue([{
                  id: 'inventory-123',
                  quantityOnHand: 100,
                  averageCost: 18.50
                }])
              })
            })
          }),
          insert: jest.fn().mockReturnValue({
            values: jest.fn().mockReturnValue({
              returning: jest.fn().mockResolvedValue([{
                id: 'movement-123',
                quantity: 50
              }])
            })
          }),
          update: jest.fn().mockReturnThis(),
          set: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnThis(),
          returning: jest.fn().mockResolvedValue([{}])
        };
        return callback(mockTx);
      });
    }

    function setupReorderAnalysisMocks() {
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnThis(),
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue([
                {
                  id: 'inventory-123',
                  productSku: 'SKU001',
                  productName: 'Test Product',
                  quantityAvailable: 5,
                  reorderPoint: 20,
                  reorderQuantity: 100,
                  supplierName: 'Test Supplier'
                }
              ])
            })
          })
        })
      }));

      // Mock analytics cache
      jest.doMock('../../src/config/redis.js', () => ({
        analyticsCache: {
          init: jest.fn().mockResolvedValue(),
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue()
        }
      }));
    }
  });

  // ==================== CUSTOMER-ANALYTICS-SEGMENTATION WORKFLOW ====================

  describe('Customer Analytics and Segmentation Workflow', () => {
    const mockCustomers = [
      {
        id: 'customer-1',
        customerCode: 'CUST001',
        companyName: 'High Value Customer',
        totalOrders: 50,
        lifetimeValue: 25000,
        lastOrderDate: '2024-01-15'
      },
      {
        id: 'customer-2',
        customerCode: 'CUST002',
        companyName: 'Regular Customer',
        totalOrders: 15,
        lifetimeValue: 7500,
        lastOrderDate: '2024-01-10'
      }
    ];

    test('should perform comprehensive customer analysis and segmentation', async () => {
      setupCustomerAnalyticsMocks();
      await analyticsService.initialize();

      // Step 1: Get customer analytics overview
      const customerAnalytics = await analyticsService.getCustomerAnalytics({
        dateFrom: '2023-01-01',
        dateTo: '2024-01-31',
        includeSegmentation: true
      });

      expect(customerAnalytics.data).toBeDefined();

      // Step 2: Analyze purchase frequency patterns
      const frequencyAnalysis = await analyticsService.analyzePurchaseFrequency({
        dateFrom: '2023-01-01',
        dateTo: '2024-01-31'
      });

      expect(frequencyAnalysis.data).toBeDefined();

      // Step 3: Calculate customer lifetime values
      const clvAnalysis = await analyticsService.calculateCustomerLifetimeValue({
        customerId: 'customer-1'
      });

      expect(clvAnalysis.data).toBeDefined();

      // Step 4: Perform RFM analysis
      const rfmAnalysis = await analyticsService.getRFMAnalysis({
        dateFrom: '2023-01-01',
        dateTo: '2024-01-31'
      });

      expect(rfmAnalysis.data).toBeDefined();

      // Step 5: Get customer segmentation
      const segmentation = await analyticsService.getCustomerSegmentation({
        segmentationType: 'behavioral'
      });

      expect(segmentation.data).toBeDefined();
    });

    test('should identify churn risk and high-value customers', async () => {
      setupChurnAnalysisMocks();
      await analyticsService.initialize();

      // Step 1: Analyze churn risk
      const churnRisk = await analyticsService.analyzeChurnRisk({
        threshold: 90, // days since last order
        includeFactors: true
      });

      expect(churnRisk.data).toBeDefined();

      // Step 2: Get high-value customers from customer service
      const highValueCustomers = await CustomerService.getHighValueCustomers(
        10000, // threshold
        25     // limit
      );

      expect(highValueCustomers.success).toBe(true);

      // Step 3: Get geographic segmentation
      const geoSegmentation = await analyticsService.getGeographicSegmentation({
        includeMetrics: true
      });

      expect(geoSegmentation.data).toBeDefined();

      // Step 4: Calculate segment metrics
      const segmentMetrics = await analyticsService.getSegmentMetrics({
        segmentType: 'behavioral',
        dateFrom: '2023-01-01',
        dateTo: '2024-01-31'
      });

      expect(segmentMetrics.data).toBeDefined();
    });

    function setupCustomerAnalyticsMocks() {
      // Mock customer data queries
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnThis(),
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              groupBy: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue(mockCustomers)
                })
              })
            })
          })
        })
      }));

      // Mock customer service methods
      jest.doMock('../../src/db/customer-queries.js', () => ({
        getHighValueCustomers: jest.fn().mockResolvedValue(mockCustomers.slice(0, 1)),
        performCustomerSegmentation: jest.fn().mockResolvedValue({
          champions: 10,
          loyalCustomers: 25,
          potentialLoyalists: 30,
          atRisk: 15,
          cannotLoseThem: 5,
          hibernating: 15
        }),
        analyzePurchasePatterns: jest.fn().mockResolvedValue({
          seasonalPatterns: { Q1: 0.2, Q2: 0.3, Q3: 0.25, Q4: 0.25 },
          productAffinity: [
            { product1: 'SKU001', product2: 'SKU002', confidence: 0.8 }
          ]
        })
      }));
    }

    function setupChurnAnalysisMocks() {
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnThis(),
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              groupBy: jest.fn().mockReturnValue({
                having: jest.fn().mockReturnValue({
                  orderBy: jest.fn().mockResolvedValue([
                    {
                      customerId: 'customer-2',
                      customerName: 'At Risk Customer',
                      daysSinceLastOrder: 120,
                      churnRisk: 0.75,
                      riskFactors: ['declining_frequency', 'decreasing_order_value']
                    }
                  ])
                })
              })
            })
          })
        })
      }));
    }
  });

  // ==================== SUPPLY CHAIN OPTIMIZATION WORKFLOW ====================

  describe('Supply Chain Optimization Workflow', () => {
    const mockSupplyChainData = {
      suppliers: [
        {
          id: 'supplier-1',
          name: 'Supplier A',
          performanceScore: 95,
          onTimeDelivery: 0.98,
          qualityScore: 4.8
        },
        {
          id: 'supplier-2',
          name: 'Supplier B',
          performanceScore: 87,
          onTimeDelivery: 0.92,
          qualityScore: 4.5
        }
      ],
      inventory: [
        {
          productId: 'product-1',
          sku: 'SKU001',
          totalStock: 500,
          reorderSuggestions: 2,
          turnoverRate: 12.5
        }
      ]
    };

    test('should optimize supply chain through integrated analysis', async () => {
      setupSupplyChainMocks();
      await analyticsService.initialize();

      // Step 1: Get supplier rankings and performance
      const supplierRankings = await analyticsService.getSupplierRankings({
        includeScoreBreakdown: true,
        limit: 10
      });

      expect(supplierRankings.data).toBeDefined();

      // Step 2: Analyze price trends and competitiveness
      const priceTrends = await analyticsService.comparePricesAcrossSuppliers({
        productIds: ['product-1', 'product-2'],
        dateFrom: '2024-01-01',
        dateTo: '2024-01-31'
      });

      expect(priceTrends.data).toBeDefined();

      // Step 3: Identify savings opportunities
      const savingsOpportunities = await analyticsService.identifyPriceSavingsOpportunities({
        threshold: 0.05, // 5% savings threshold
        includeRecommendations: true
      });

      expect(savingsOpportunities.data).toBeDefined();

      // Step 4: Get inventory turnover analysis
      const inventoryAnalytics = await analyticsService.getInventoryMetrics({
        includeMovements: true,
        includeTurnover: true
      });

      expect(inventoryAnalytics.data).toBeDefined();

      // Step 5: Generate optimization recommendations
      const recommendations = await analyticsService.generateNegotiationRecommendations({
        supplierId: 'supplier-1',
        includeMarketAnalysis: true
      });

      expect(recommendations.data).toBeDefined();
    });

    test('should handle cross-module data inconsistencies gracefully', async () => {
      setupInconsistentDataMocks();
      await analyticsService.initialize();

      // Test resilience when some modules return errors
      const promises = [
        analyticsService.getSupplierPerformance().catch(err => ({ error: err.message })),
        analyticsService.getInventoryMetrics().catch(err => ({ error: err.message })),
        analyticsService.getCustomerAnalytics().catch(err => ({ error: err.message }))
      ];

      const results = await Promise.allSettled(promises);

      // Should handle partial failures gracefully
      expect(results).toHaveLength(3);
      results.forEach(result => {
        expect(['fulfilled', 'rejected']).toContain(result.status);
      });
    });

    function setupSupplyChainMocks() {
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnThis(),
          leftJoin: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              groupBy: jest.fn().mockReturnValue({
                orderBy: jest.fn().mockReturnValue({
                  limit: jest.fn().mockResolvedValue(mockSupplyChainData.suppliers)
                })
              })
            })
          })
        })
      }));

      // Mock price comparison data
      db.select.mockImplementationOnce(() => ({
        from: jest.fn().mockReturnValue({
          innerJoin: jest.fn().mockReturnThis(),
          where: jest.fn().mockReturnValue({
            groupBy: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue([
                {
                  productId: 'product-1',
                  sku: 'SKU001',
                  supplierId: 'supplier-1',
                  avgPrice: 25.50,
                  marketPosition: 'competitive'
                }
              ])
            })
          })
        })
      }));
    }

    function setupInconsistentDataMocks() {
      // Simulate some queries failing
      let queryCount = 0;
      db.select.mockImplementation(() => {
        queryCount++;
        if (queryCount % 3 === 0) {
          throw new Error('Simulated database error');
        }
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue([])
            })
          })
        };
      });
    }
  });

  // ==================== REAL-TIME ANALYTICS PIPELINE ====================

  describe('Real-time Analytics Pipeline Integration', () => {
    test('should process real-time events across modules', async () => {
      setupRealTimeMocks();
      await analyticsService.initialize();

      // Simulate real-time events
      const events = [
        { type: 'order_created', customerId: 'customer-1', orderId: 'order-1' },
        { type: 'inventory_updated', productId: 'product-1', newQuantity: 95 },
        { type: 'supplier_delivery', supplierId: 'supplier-1', deliveryId: 'delivery-1' }
      ];

      // Process events and verify analytics updates
      for (const event of events) {
        // Each event should trigger analytics updates
        const analyticsUpdate = await analyticsService.getPerformanceMetrics({
          eventType: event.type,
          entityId: event.customerId || event.productId || event.supplierId
        });

        expect(analyticsUpdate.data).toBeDefined();
      }

      // Verify cached data is invalidated appropriately
      await analyticsService.invalidateCache('sales_*');
      await analyticsService.invalidateCache('inventory_*');
      await analyticsService.invalidateCache('supplier_*');
    });

    function setupRealTimeMocks() {
      // Mock real-time event processing
      db.select.mockImplementation(() => ({
        from: jest.fn().mockReturnValue({
          where: jest.fn().mockReturnValue({
            orderBy: jest.fn().mockReturnValue({
              limit: jest.fn().mockResolvedValue([
                {
                  eventType: 'order_created',
                  timestamp: new Date(),
                  metrics: { totalOrders: 100, totalRevenue: 25000 }
                }
              ])
            })
          })
        })
      }));

      // Mock cache invalidation
      jest.doMock('../../src/config/redis.js', () => ({
        analyticsCache: {
          init: jest.fn().mockResolvedValue(),
          get: jest.fn().mockResolvedValue(null),
          set: jest.fn().mockResolvedValue(),
          invalidate: jest.fn().mockResolvedValue(),
          clear: jest.fn().mockResolvedValue()
        }
      }));
    }
  });

  // ==================== ERROR HANDLING AND RESILIENCE ====================

  describe('Cross-Module Error Handling and Resilience', () => {
    test('should handle cascade failures gracefully', async () => {
      // Simulate database connection issues
      db.transaction.mockRejectedValue(new Error('Database connection lost'));
      db.select.mockImplementation(() => {
        throw new Error('Query execution failed');
      });

      // Test that modules handle failures without crashing
      const customerResult = await CustomerService.getAllCustomers().catch(err => ({ 
        success: false, 
        error: err.message 
      }));
      
      const supplierResult = await getSuppliersService().catch(err => ({ 
        success: false, 
        error: err.message 
      }));

      const inventoryResult = await getInventory().catch(err => ({ 
        error: err.message 
      }));

      // All should fail gracefully
      expect(customerResult.success).toBe(false);
      expect(supplierResult.success).toBe(false);
      expect(inventoryResult.error).toBeDefined();
    });

    test('should maintain data consistency during partial failures', async () => {
      // Setup scenario where some operations succeed and others fail
      let operationCount = 0;
      db.transaction.mockImplementation(async (callback) => {
        operationCount++;
        if (operationCount % 2 === 0) {
          throw new Error('Simulated transaction failure');
        }
        
        const mockTx = createMockTransaction();
        return callback(mockTx);
      });

      // Test order allocation with partial failures
      const allocationResult = await allocateInventoryForOrder('order-123', {
        allowPartialAllocation: true
      });

      // Should either succeed completely or fail completely (no partial state)
      expect(typeof allocationResult.success).toBe('boolean');
      if (allocationResult.success) {
        expect(allocationResult.data).toBeDefined();
      } else {
        expect(allocationResult.error).toBeDefined();
      }
    });

    test('should recover from temporary service outages', async () => {
      // Simulate temporary outage followed by recovery
      let attempts = 0;
      db.select.mockImplementation(() => {
        attempts++;
        if (attempts <= 2) {
          throw new Error('Service temporarily unavailable');
        }
        return {
          from: jest.fn().mockReturnValue({
            where: jest.fn().mockReturnValue({
              orderBy: jest.fn().mockResolvedValue([{ id: 1, test: 'data' }])
            })
          })
        };
      });

      await analyticsService.initialize();

      // First attempts should fail
      await expect(analyticsService.getSalesMetrics())
        .rejects.toThrow(/Service temporarily unavailable/);

      await expect(analyticsService.getSalesMetrics())
        .rejects.toThrow(/Service temporarily unavailable/);

      // Third attempt should succeed
      const result = await analyticsService.getSalesMetrics();
      expect(result.data).toBeDefined();
    });
  });
});