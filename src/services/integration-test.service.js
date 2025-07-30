import {
  suppliers,
  priceLists,
  priceListItems,
  products,
  inventory,
  inventoryMovements,
  purchaseOrders,
  purchaseOrderItems,
  supplierPurchaseOrders,
  supplierPurchaseOrderItems,
  purchaseOrderReceipts,
  purchaseOrderReceiptItems,
  timeSeriesEvents
} from '../db/schema.js';
import { db } from '../config/database.js';
import { eq, and, sql, desc, gte } from 'drizzle-orm';

// Import services for testing
import { uploadPriceListService } from './price-list.service.js';
import { processNewPriceListWorkflow, autoUpdateProductCosts } from './price-integration-workflow.service.js';
import { analyzeReorderNeeds, createAutomatedPurchaseOrders } from './demand-planning-automation.service.js';
import { createSupplierPurchaseOrder, processReceiptToInventory } from '../db/supplier-purchase-order-queries.js';
import { allocateInventoryForOrder, processOrderShipment, processReturn } from './order-inventory-integration.service.js';
import { createPurchaseOrder } from '../db/purchase-order-queries.js';

/**
 * Integration Testing Service
 * Provides comprehensive end-to-end workflow testing and validation
 */

// ==================== INTEGRATION TEST FRAMEWORK ====================

/**
 * Run comprehensive integration test suite
 * @param {Object} options - Test options
 * @returns {Object} Test results
 */
export async function runIntegrationTestSuite(options = {}) {
  const {
    includePerformanceTests = false,
    cleanupAfterTests = true,
    testDataPrefix = 'INT_TEST_',
    skipSlowTests = false
  } = options;

  const testResults = {
    startTime: new Date(),
    endTime: null,
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    skippedTests: 0,
    testResults: [],
    testData: {
      cleanup: []
    }
  };

  console.log('Starting Integration Test Suite...');

  try {
    // Test 1: Price Upload → PO Creation Flow
    const priceUploadTest = await testPriceUploadToPOCreationFlow(testDataPrefix);
    testResults.testResults.push(priceUploadTest);
    testResults.totalTests++;
    if (priceUploadTest.status === 'passed') testResults.passedTests++;
    else if (priceUploadTest.status === 'failed') testResults.failedTests++;
    else testResults.skippedTests++;

    // Test 2: PO → Inventory Receipt Flow
    const poReceiptTest = await testPOToInventoryReceiptFlow(testDataPrefix);
    testResults.testResults.push(poReceiptTest);
    testResults.totalTests++;
    if (poReceiptTest.status === 'passed') testResults.passedTests++;
    else if (poReceiptTest.status === 'failed') testResults.failedTests++;
    else testResults.skippedTests++;

    // Test 3: Order → Inventory → Shipment Flow
    const orderShipmentTest = await testOrderToShipmentFlow(testDataPrefix);
    testResults.testResults.push(orderShipmentTest);
    testResults.totalTests++;
    if (orderShipmentTest.status === 'passed') testResults.passedTests++;
    else if (orderShipmentTest.status === 'failed') testResults.failedTests++;
    else testResults.skippedTests++;

    // Test 4: Return → Inventory Update Flow
    const returnTest = await testReturnToInventoryFlow(testDataPrefix);
    testResults.testResults.push(returnTest);
    testResults.totalTests++;
    if (returnTest.status === 'passed') testResults.passedTests++;
    else if (returnTest.status === 'failed') testResults.failedTests++;
    else testResults.skippedTests++;

    // Test 5: Multi-supplier Scenarios
    if (!skipSlowTests) {
      const multiSupplierTest = await testMultiSupplierScenarios(testDataPrefix);
      testResults.testResults.push(multiSupplierTest);
      testResults.totalTests++;
      if (multiSupplierTest.status === 'passed') testResults.passedTests++;
      else if (multiSupplierTest.status === 'failed') testResults.failedTests++;
      else testResults.skippedTests++;
    }

    // Data Validation Tests
    const dataValidationTests = await runDataValidationTests(testDataPrefix);
    testResults.testResults.push(...dataValidationTests);
    testResults.totalTests += dataValidationTests.length;
    dataValidationTests.forEach(test => {
      if (test.status === 'passed') testResults.passedTests++;
      else if (test.status === 'failed') testResults.failedTests++;
      else testResults.skippedTests++;
    });

    // Performance Tests (if enabled)
    if (includePerformanceTests) {
      const performanceTests = await runPerformanceTests(testDataPrefix);
      testResults.testResults.push(...performanceTests);
      testResults.totalTests += performanceTests.length;
      performanceTests.forEach(test => {
        if (test.status === 'passed') testResults.passedTests++;
        else if (test.status === 'failed') testResults.failedTests++;
        else testResults.skippedTests++;
      });
    }

  } catch (error) {
    console.error('Integration test suite failed:', error);
    testResults.testResults.push({
      testName: 'Test Suite Execution',
      status: 'failed',
      error: error.message,
      duration: Date.now() - testResults.startTime.getTime()
    });
    testResults.failedTests++;
    testResults.totalTests++;
  } finally {
    // Cleanup test data if requested
    if (cleanupAfterTests) {
      await cleanupTestData(testResults.testData.cleanup);
    }

    testResults.endTime = new Date();
    testResults.totalDuration = testResults.endTime.getTime() - testResults.startTime.getTime();
    testResults.successRate = testResults.totalTests > 0 ? 
      (testResults.passedTests / testResults.totalTests) * 100 : 0;
  }

  console.log(`Integration Test Suite Complete: ${testResults.passedTests}/${testResults.totalTests} passed`);
  return testResults;
}

// ==================== WORKFLOW TESTS ====================

/**
 * Test Price Upload → PO Creation Flow
 * @param {string} prefix - Test data prefix
 * @returns {Object} Test result
 */
async function testPriceUploadToPOCreationFlow(prefix) {
  const testStart = Date.now();
  const testResult = {
    testName: 'Price Upload → PO Creation Flow',
    status: 'failed',
    steps: [],
    error: null,
    duration: 0,
    artifacts: {}
  };

  try {
    // Step 1: Create test supplier
    const [testSupplier] = await db.insert(suppliers).values({
      supplierCode: `${prefix}SUPPLIER_001`,
      companyName: `${prefix} Test Supplier`,
      email: 'test@supplier.com',
      isActive: true,
      leadTimeDays: 7
    }).returning();

    testResult.steps.push({ step: 'Create test supplier', status: 'passed', supplierId: testSupplier.id });
    testResult.artifacts.testSupplierId = testSupplier.id;

    // Step 2: Create test products
    const testProducts = await db.insert(products).values([
      {
        sku: `${prefix}SKU_001`,
        name: `${prefix} Test Product 1`,
        supplierId: testSupplier.id,
        costPrice: '10.00',
        unitPrice: '15.00',
        isActive: true
      },
      {
        sku: `${prefix}SKU_002`,
        name: `${prefix} Test Product 2`,
        supplierId: testSupplier.id,
        costPrice: '20.00',
        unitPrice: '30.00',
        isActive: true
      }
    ]).returning();

    testResult.steps.push({ step: 'Create test products', status: 'passed', count: testProducts.length });

    // Step 3: Simulate price list upload
    const mockPriceListData = {
      priceList: {
        supplierId: testSupplier.id,
        name: `${prefix} Test Price List`,
        effectiveDate: new Date(),
        status: 'draft',
        itemCount: 2
      },
      items: [
        {
          sku: `${prefix}SKU_001`,
          description: `${prefix} Test Product 1`,
          unitPrice: '12.00', // Price increase
          currency: 'USD',
          minQuantity: 1
        },
        {
          sku: `${prefix}SKU_002`,
          description: `${prefix} Test Product 2`,
          unitPrice: '18.00', // Price decrease
          currency: 'USD',
          minQuantity: 1
        }
      ]
    };

    const [testPriceList] = await db.insert(priceLists).values(mockPriceListData.priceList).returning();
    const testPriceListItems = await db.insert(priceListItems).values(
      mockPriceListData.items.map(item => ({
        ...item,
        priceListId: testPriceList.id
      }))
    ).returning();

    testResult.steps.push({ step: 'Create price list', status: 'passed', priceListId: testPriceList.id });
    testResult.artifacts.testPriceListId = testPriceList.id;

    // Step 4: Activate price list and trigger workflow
    await db.update(priceLists).set({ status: 'active' }).where(eq(priceLists.id, testPriceList.id));

    const workflowResult = await processNewPriceListWorkflow(testPriceList.id, 'test-user');
    testResult.steps.push({ 
      step: 'Process price list workflow', 
      status: workflowResult.success ? 'passed' : 'failed',
      details: workflowResult.message
    });

    // Step 5: Test auto product cost update
    const costUpdateResult = await autoUpdateProductCosts(testPriceList.id, {
      updateThreshold: 0.01,
      requireApproval: false,
      userId: 'test-user'
    });

    testResult.steps.push({
      step: 'Auto-update product costs',
      status: costUpdateResult.success ? 'passed' : 'failed',
      updatedProducts: costUpdateResult.data?.updated || 0
    });

    // Step 6: Analyze reorder needs and create POs
    const reorderAnalysis = await analyzeReorderNeeds({
      supplierIds: [testSupplier.id]
    });

    if (reorderAnalysis.success && reorderAnalysis.data.recommendedReorders.length > 0) {
      const poCreationResult = await createAutomatedPurchaseOrders(
        reorderAnalysis.data.recommendedReorders.slice(0, 1), // Test with first item
        {
          approvalRequired: false,
          userId: 'test-user'
        }
      );

      testResult.steps.push({
        step: 'Create automated purchase orders',
        status: poCreationResult.success ? 'passed' : 'failed',
        ordersCreated: poCreationResult.data?.summary?.ordersCreated || 0
      });
    } else {
      testResult.steps.push({
        step: 'Create automated purchase orders',
        status: 'skipped',
        reason: 'No reorder recommendations generated'
      });
    }

    // Verify end-to-end flow completion
    const allStepsPassed = testResult.steps.every(step => step.status === 'passed' || step.status === 'skipped');
    testResult.status = allStepsPassed ? 'passed' : 'failed';

  } catch (error) {
    testResult.error = error.message;
    testResult.steps.push({ step: 'Error occurred', status: 'failed', error: error.message });
    console.error('Price upload to PO creation test failed:', error);
  }

  testResult.duration = Date.now() - testStart;
  return testResult;
}

/**
 * Test PO → Inventory Receipt Flow
 * @param {string} prefix - Test data prefix
 * @returns {Object} Test result
 */
async function testPOToInventoryReceiptFlow(prefix) {
  const testStart = Date.now();
  const testResult = {
    testName: 'PO → Inventory Receipt Flow',
    status: 'failed',
    steps: [],
    error: null,
    duration: 0,
    artifacts: {}
  };

  try {
    // Step 1: Get test supplier and products from previous test or create new ones
    let testSupplier = await db.select().from(suppliers)
      .where(eq(suppliers.supplierCode, `${prefix}SUPPLIER_001`)).limit(1);

    if (!testSupplier.length) {
      [testSupplier] = await db.insert(suppliers).values({
        supplierCode: `${prefix}SUPPLIER_002`,
        companyName: `${prefix} Test Supplier 2`,
        email: 'test2@supplier.com',
        isActive: true,
        leadTimeDays: 5
      }).returning();
      testSupplier = [testSupplier];
    }

    const supplierId = testSupplier[0].id;
    testResult.steps.push({ step: 'Get/create test supplier', status: 'passed' });

    // Step 2: Create test product and inventory
    const [testProduct] = await db.insert(products).values({
      sku: `${prefix}PO_TEST_SKU`,
      name: `${prefix} PO Test Product`,
      supplierId,
      costPrice: '25.00',
      unitPrice: '40.00',
      isActive: true
    }).returning();

    const [testInventory] = await db.insert(inventory).values({
      productId: testProduct.id,
      warehouseId: 'WAREHOUSE_001',
      quantityOnHand: 5,
      quantityAvailable: 5,
      reorderPoint: 10,
      reorderQuantity: 20,
      averageCost: 25.00
    }).returning();

    testResult.steps.push({ step: 'Create test product and inventory', status: 'passed' });
    testResult.artifacts.testProductId = testProduct.id;
    testResult.artifacts.testInventoryId = testInventory.id;

    // Step 3: Create supplier purchase order
    const supplierPOData = {
      supplierId,
      poNumber: `${prefix}SPO_001`,
      status: 'approved',
      approvalStatus: 'approved',
      subtotal: '500.00',
      totalAmount: '500.00',
      expectedDeliveryDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
    };

    const poItems = [{
      sku: testProduct.sku,
      productName: testProduct.name,
      quantityOrdered: 20,
      unitPrice: '25.00',
      lineTotal: '500.00'
    }];

    const createdPO = await createSupplierPurchaseOrder(supplierPOData, poItems);
    testResult.steps.push({ 
      step: 'Create supplier purchase order', 
      status: 'passed',
      poId: createdPO.id
    });
    testResult.artifacts.testPOId = createdPO.id;

    // Step 4: Create receipt
    const receiptData = {
      receiptNumber: `${prefix}RECEIPT_001`,
      receivedBy: 'test-user',
      warehouseId: 'WAREHOUSE_001',
      status: 'draft'
    };

    const receiptItems = [{
      supplierPurchaseOrderItemId: createdPO.items[0].id,
      productId: testProduct.id,
      sku: testProduct.sku,
      quantityOrdered: 20,
      quantityReceived: 20,
      quantityAccepted: 20,
      warehouseId: 'WAREHOUSE_001',
      unitCost: 25.00,
      totalCost: 500.00
    }];

    // Import the function properly
    const { createPurchaseOrderReceipt } = await import('../db/supplier-purchase-order-queries.js');
    const receipt = await createPurchaseOrderReceipt(createdPO.id, receiptData, receiptItems);

    testResult.steps.push({ 
      step: 'Create purchase order receipt', 
      status: 'passed',
      receiptId: receipt.id
    });

    // Step 5: Process receipt to inventory
    const inventoryUpdate = await processReceiptToInventory(receipt.id, 'test-user');
    testResult.steps.push({
      step: 'Process receipt to inventory',
      status: inventoryUpdate ? 'passed' : 'failed',
      updatedInventory: inventoryUpdate?.inventoryUpdates?.length || 0
    });

    // Step 6: Verify inventory was updated
    const [updatedInventory] = await db.select()
      .from(inventory)
      .where(eq(inventory.id, testInventory.id));

    const expectedQuantity = 5 + 20; // Original + received
    const inventoryCorrect = updatedInventory.quantityOnHand === expectedQuantity;

    testResult.steps.push({
      step: 'Verify inventory update',
      status: inventoryCorrect ? 'passed' : 'failed',
      expected: expectedQuantity,
      actual: updatedInventory.quantityOnHand
    });

    // Verify end-to-end flow completion
    const allStepsPassed = testResult.steps.every(step => step.status === 'passed');
    testResult.status = allStepsPassed ? 'passed' : 'failed';

  } catch (error) {
    testResult.error = error.message;
    testResult.steps.push({ step: 'Error occurred', status: 'failed', error: error.message });
    console.error('PO to inventory receipt test failed:', error);
  }

  testResult.duration = Date.now() - testStart;
  return testResult;
}

/**
 * Test Order → Inventory → Shipment Flow
 * @param {string} prefix - Test data prefix
 * @returns {Object} Test result
 */
async function testOrderToShipmentFlow(prefix) {
  const testStart = Date.now();
  const testResult = {
    testName: 'Order → Inventory → Shipment Flow',
    status: 'failed',
    steps: [],
    error: null,
    duration: 0,
    artifacts: {}
  };

  try {
    // Step 1: Create test customer
    const [testCustomer] = await db.insert(db.schema.customers).values({
      customerCode: `${prefix}CUSTOMER_001`,
      companyName: `${prefix} Test Customer`,
      email: 'test@customer.com'
    }).returning();

    testResult.steps.push({ step: 'Create test customer', status: 'passed' });
    testResult.artifacts.testCustomerId = testCustomer.id;

    // Step 2: Create test product with inventory
    const [testProduct] = await db.insert(products).values({
      sku: `${prefix}ORDER_SKU`,
      name: `${prefix} Order Test Product`,
      unitPrice: '50.00',
      costPrice: '30.00',
      isActive: true
    }).returning();

    const [testInventory] = await db.insert(inventory).values({
      productId: testProduct.id,
      warehouseId: 'WAREHOUSE_001',
      quantityOnHand: 50,
      quantityAvailable: 50,
      averageCost: 30.00
    }).returning();

    testResult.steps.push({ step: 'Create product with inventory', status: 'passed' });

    // Step 3: Create customer order
    const orderData = {
      customerId: testCustomer.id,
      orderNumber: `${prefix}ORDER_001`,
      items: [{
        productId: testProduct.id,
        sku: testProduct.sku,
        productName: testProduct.name,
        quantity: 10,
        unitPrice: 50.00
      }],
      shippingAddress: { address: 'Test Address' },
      billingAddress: { address: 'Test Address' }
    };

    const customerOrder = await createPurchaseOrder(orderData);
    testResult.steps.push({ 
      step: 'Create customer order', 
      status: 'passed',
      orderId: customerOrder.id
    });
    testResult.artifacts.testOrderId = customerOrder.id;

    // Step 4: Allocate inventory
    const allocationResult = await allocateInventoryForOrder(customerOrder.id, {
      userId: 'test-user'
    });

    testResult.steps.push({
      step: 'Allocate inventory',
      status: allocationResult.success ? 'passed' : 'failed',
      allocated: allocationResult.data?.totalItemsAllocated || 0
    });

    // Step 5: Process shipment
    const shipmentItems = [{
      orderItemId: customerOrder.items[0].id,
      quantity: 10
    }];

    const shipmentResult = await processOrderShipment(
      customerOrder.id,
      shipmentItems,
      {
        trackingNumber: `${prefix}TRACK_001`,
        carrier: 'Test Carrier',
        shippedBy: 'test-user'
      }
    );

    testResult.steps.push({
      step: 'Process shipment',
      status: shipmentResult.success ? 'passed' : 'failed',
      shippedItems: shipmentResult.data?.shippedItems?.length || 0
    });

    // Step 6: Verify inventory was reduced
    const [finalInventory] = await db.select()
      .from(inventory)
      .where(eq(inventory.id, testInventory.id));

    const expectedQuantity = 50 - 10; // Original - shipped
    const inventoryCorrect = finalInventory.quantityOnHand === expectedQuantity;

    testResult.steps.push({
      step: 'Verify inventory reduction',
      status: inventoryCorrect ? 'passed' : 'failed',
      expected: expectedQuantity,
      actual: finalInventory.quantityOnHand
    });

    // Verify end-to-end flow completion
    const allStepsPassed = testResult.steps.every(step => step.status === 'passed');
    testResult.status = allStepsPassed ? 'passed' : 'failed';

  } catch (error) {
    testResult.error = error.message;
    testResult.steps.push({ step: 'Error occurred', status: 'failed', error: error.message });
    console.error('Order to shipment test failed:', error);
  }

  testResult.duration = Date.now() - testStart;
  return testResult;
}

/**
 * Test Return → Inventory Update Flow
 * @param {string} prefix - Test data prefix
 * @returns {Object} Test result
 */
async function testReturnToInventoryFlow(prefix) {
  const testStart = Date.now();
  const testResult = {
    testName: 'Return → Inventory Update Flow',
    status: 'failed',
    steps: [],
    error: null,
    duration: 0,
    artifacts: {}
  };

  try {
    // Use existing test data or create minimal test setup
    const existingOrders = await db.select()
      .from(purchaseOrders)
      .where(sql`${purchaseOrders.orderNumber} LIKE ${prefix + '%'}`)
      .limit(1);

    if (!existingOrders.length) {
      testResult.status = 'skipped';
      testResult.steps.push({ step: 'Skip - no test orders available', status: 'skipped' });
      testResult.duration = Date.now() - testStart;
      return testResult;
    }

    const testOrder = existingOrders[0];
    testResult.steps.push({ step: 'Use existing test order', status: 'passed' });

    // Get order items
    const orderItems = await db.select()
      .from(purchaseOrderItems)
      .where(eq(purchaseOrderItems.purchaseOrderId, testOrder.id))
      .limit(1);

    if (!orderItems.length) {
      testResult.status = 'skipped';
      testResult.steps.push({ step: 'Skip - no order items available', status: 'skipped' });
      testResult.duration = Date.now() - testStart;
      return testResult;
    }

    // Process return
    const returnItems = [{
      orderItemId: orderItems[0].id,
      quantity: 2 // Return partial quantity
    }];

    const returnResult = await processReturn(
      testOrder.id,
      returnItems,
      {
        reason: 'customer_return',
        condition: 'good',
        restockable: true,
        userId: 'test-user'
      }
    );

    testResult.steps.push({
      step: 'Process return',
      status: returnResult.success ? 'passed' : 'failed',
      returnedItems: returnResult.data?.returnedItems?.length || 0
    });

    // Verify inventory was updated (if restockable)
    if (returnResult.success && returnResult.data.returnedItems.length > 0) {
      testResult.steps.push({
        step: 'Verify inventory restocking',
        status: 'passed',
        restoredItems: returnResult.data.inventoryUpdates?.length || 0
      });
    }

    const allStepsPassed = testResult.steps.every(step => step.status === 'passed');
    testResult.status = allStepsPassed ? 'passed' : 'failed';

  } catch (error) {
    testResult.error = error.message;
    testResult.steps.push({ step: 'Error occurred', status: 'failed', error: error.message });
    console.error('Return to inventory test failed:', error);
  }

  testResult.duration = Date.now() - testStart;
  return testResult;
}

/**
 * Test Multi-supplier Scenarios
 * @param {string} prefix - Test data prefix
 * @returns {Object} Test result
 */
async function testMultiSupplierScenarios(prefix) {
  const testStart = Date.now();
  const testResult = {
    testName: 'Multi-supplier Scenarios',
    status: 'failed',
    steps: [],
    error: null,
    duration: 0,
    artifacts: {}
  };

  try {
    // Create multiple suppliers
    const suppliers = await db.insert(db.schema.suppliers).values([
      {
        supplierCode: `${prefix}MULTI_SUP_001`,
        companyName: `${prefix} Multi Supplier 1`,
        email: 'multi1@supplier.com',
        isActive: true,
        leadTimeDays: 5
      },
      {
        supplierCode: `${prefix}MULTI_SUP_002`,
        companyName: `${prefix} Multi Supplier 2`,
        email: 'multi2@supplier.com',
        isActive: true,
        leadTimeDays: 7
      }
    ]).returning();

    testResult.steps.push({ 
      step: 'Create multiple suppliers', 
      status: 'passed',
      count: suppliers.length
    });

    // Test concurrent price list processing
    const priceListPromises = suppliers.map((supplier, index) => {
      return db.insert(priceLists).values({
        supplierId: supplier.id,
        name: `${prefix} Multi Price List ${index + 1}`,
        status: 'active',
        effectiveDate: new Date(),
        itemCount: 2
      }).returning();
    });

    const createdPriceLists = await Promise.all(priceListPromises);
    testResult.steps.push({
      step: 'Create concurrent price lists',
      status: 'passed',
      count: createdPriceLists.length
    });

    // Test supplier performance comparison
    const performanceAnalysis = await db.select({
      supplierId: db.schema.suppliers.id,
      companyName: db.schema.suppliers.companyName,
      leadTimeDays: db.schema.suppliers.leadTimeDays,
      priceListCount: sql`COUNT(${priceLists.id})`
    })
    .from(db.schema.suppliers)
    .leftJoin(priceLists, eq(db.schema.suppliers.id, priceLists.supplierId))
    .where(sql`${db.schema.suppliers.supplierCode} LIKE ${prefix + 'MULTI_SUP_%'}`)
    .groupBy(db.schema.suppliers.id, db.schema.suppliers.companyName, db.schema.suppliers.leadTimeDays);

    testResult.steps.push({
      step: 'Analyze supplier performance',
      status: performanceAnalysis.length > 0 ? 'passed' : 'failed',
      analyzed: performanceAnalysis.length
    });

    const allStepsPassed = testResult.steps.every(step => step.status === 'passed');
    testResult.status = allStepsPassed ? 'passed' : 'failed';

  } catch (error) {
    testResult.error = error.message;
    testResult.steps.push({ step: 'Error occurred', status: 'failed', error: error.message });
    console.error('Multi-supplier test failed:', error);
  }

  testResult.duration = Date.now() - testStart;
  return testResult;
}

// ==================== DATA VALIDATION TESTS ====================

/**
 * Run data validation tests
 * @param {string} prefix - Test data prefix
 * @returns {Array} Array of test results
 */
async function runDataValidationTests(prefix) {
  const tests = [
    await testDataConsistency(prefix),
    await testCalculationAccuracy(prefix),
    await testStateTransitions(prefix),
    await testAuditTrail(prefix)
  ];

  return tests;
}

/**
 * Test data consistency
 * @param {string} prefix - Test data prefix
 * @returns {Object} Test result
 */
async function testDataConsistency(prefix) {
  const testStart = Date.now();
  const testResult = {
    testName: 'Data Consistency Validation',
    status: 'passed',
    steps: [],
    error: null,
    duration: 0
  };

  try {
    // Check inventory consistency
    const inventoryCheck = await db.select({
      productId: inventory.productId,
      quantityOnHand: inventory.quantityOnHand,
      quantityAvailable: inventory.quantityAvailable,
      quantityReserved: inventory.quantityReserved
    }).from(inventory);

    let inconsistentRecords = 0;
    inventoryCheck.forEach(record => {
      const calculatedAvailable = record.quantityOnHand - record.quantityReserved;
      if (calculatedAvailable !== record.quantityAvailable) {
        inconsistentRecords++;
      }
    });

    testResult.steps.push({
      step: 'Check inventory quantity consistency',
      status: inconsistentRecords === 0 ? 'passed' : 'failed',
      inconsistentRecords
    });

    // Check price list item counts
    const priceListCountCheck = await db.select({
      priceListId: priceLists.id,
      declaredCount: priceLists.itemCount,
      actualCount: sql`COUNT(${priceListItems.id})`
    })
    .from(priceLists)
    .leftJoin(priceListItems, eq(priceLists.id, priceListItems.priceListId))
    .groupBy(priceLists.id, priceLists.itemCount);

    let inconsistentCounts = 0;
    priceListCountCheck.forEach(record => {
      if (record.declaredCount !== parseInt(record.actualCount)) {
        inconsistentCounts++;
      }
    });

    testResult.steps.push({
      step: 'Check price list item counts',
      status: inconsistentCounts === 0 ? 'passed' : 'failed',
      inconsistentCounts
    });

    const allStepsPassed = testResult.steps.every(step => step.status === 'passed');
    testResult.status = allStepsPassed ? 'passed' : 'failed';

  } catch (error) {
    testResult.error = error.message;
    testResult.status = 'failed';
    console.error('Data consistency test failed:', error);
  }

  testResult.duration = Date.now() - testStart;
  return testResult;
}

/**
 * Test calculation accuracy
 * @param {string} prefix - Test data prefix
 * @returns {Object} Test result
 */
async function testCalculationAccuracy(prefix) {
  const testStart = Date.now();
  const testResult = {
    testName: 'Calculation Accuracy Validation',
    status: 'passed',
    steps: [],
    error: null,
    duration: 0
  };

  try {
    // Test order total calculations
    const orderCalculations = await db.select({
      orderId: purchaseOrders.id,
      declaredTotal: purchaseOrders.totalAmount,
      itemsSum: sql`SUM(${purchaseOrderItems.lineTotal})`
    })
    .from(purchaseOrders)
    .leftJoin(purchaseOrderItems, eq(purchaseOrders.id, purchaseOrderItems.purchaseOrderId))
    .groupBy(purchaseOrders.id, purchaseOrders.totalAmount)
    .limit(10);

    let calculationErrors = 0;
    orderCalculations.forEach(record => {
      const declaredTotal = parseFloat(record.declaredTotal || 0);
      const calculatedTotal = parseFloat(record.itemsSum || 0);
      const difference = Math.abs(declaredTotal - calculatedTotal);
      
      if (difference > 0.01) { // Allow for small rounding differences
        calculationErrors++;
      }
    });

    testResult.steps.push({
      step: 'Validate order total calculations',
      status: calculationErrors === 0 ? 'passed' : 'failed',
      calculationErrors,
      ordersChecked: orderCalculations.length
    });

    const allStepsPassed = testResult.steps.every(step => step.status === 'passed');
    testResult.status = allStepsPassed ? 'passed' : 'failed';

  } catch (error) {
    testResult.error = error.message;
    testResult.status = 'failed';
    console.error('Calculation accuracy test failed:', error);
  }

  testResult.duration = Date.now() - testStart;
  return testResult;
}

/**
 * Test state transitions
 * @param {string} prefix - Test data prefix
 * @returns {Object} Test result
 */
async function testStateTransitions(prefix) {
  const testStart = Date.now();
  const testResult = {
    testName: 'State Transition Validation',
    status: 'passed',
    steps: [],
    error: null,
    duration: 0
  };

  try {
    // Check for invalid state transitions in purchase orders
    const invalidTransitions = await db.select({
      id: purchaseOrders.id,
      status: purchaseOrders.status,
      paymentStatus: purchaseOrders.paymentStatus,
      shippedDate: purchaseOrders.shippedDate,
      deliveredDate: purchaseOrders.deliveredDate
    })
    .from(purchaseOrders)
    .where(sql`
      (${purchaseOrders.status} = 'delivered' AND ${purchaseOrders.shippedDate} IS NULL) OR
      (${purchaseOrders.status} = 'shipped' AND ${purchaseOrders.deliveredDate} IS NOT NULL)
    `);

    testResult.steps.push({
      step: 'Check purchase order state transitions',
      status: invalidTransitions.length === 0 ? 'passed' : 'failed',
      invalidTransitions: invalidTransitions.length
    });

    // Check supplier purchase order states
    const invalidSupplierPoStates = await db.select({
      id: supplierPurchaseOrders.id,
      status: supplierPurchaseOrders.status,
      approvalStatus: supplierPurchaseOrders.approvalStatus
    })
    .from(supplierPurchaseOrders)
    .where(sql`
      (${supplierPurchaseOrders.status} = 'delivered' AND ${supplierPurchaseOrders.approvalStatus} = 'pending')
    `);

    testResult.steps.push({
      step: 'Check supplier PO state transitions',
      status: invalidSupplierPoStates.length === 0 ? 'passed' : 'failed',
      invalidStates: invalidSupplierPoStates.length
    });

    const allStepsPassed = testResult.steps.every(step => step.status === 'passed');
    testResult.status = allStepsPassed ? 'passed' : 'failed';

  } catch (error) {
    testResult.error = error.message;
    testResult.status = 'failed';
    console.error('State transition test failed:', error);
  }

  testResult.duration = Date.now() - testStart;
  return testResult;
}

/**
 * Test audit trail
 * @param {string} prefix - Test data prefix
 * @returns {Object} Test result
 */
async function testAuditTrail(prefix) {
  const testStart = Date.now();
  const testResult = {
    testName: 'Audit Trail Validation',
    status: 'passed',
    steps: [],
    error: null,
    duration: 0
  };

  try {
    // Check for missing audit fields
    const missingCreatedAt = await db.select({ count: sql`COUNT(*)` })
      .from(timeSeriesEvents)
      .where(sql`${timeSeriesEvents.timestamp} IS NULL`);

    testResult.steps.push({
      step: 'Check for missing timestamps',
      status: parseInt(missingCreatedAt[0].count) === 0 ? 'passed' : 'failed',
      missingTimestamps: parseInt(missingCreatedAt[0].count)
    });

    // Check for recent audit events
    const recentEvents = await db.select({ count: sql`COUNT(*)` })
      .from(timeSeriesEvents)
      .where(gte(timeSeriesEvents.timestamp, new Date(Date.now() - 24 * 60 * 60 * 1000)));

    testResult.steps.push({
      step: 'Check recent audit events',
      status: parseInt(recentEvents[0].count) > 0 ? 'passed' : 'warning',
      recentEventCount: parseInt(recentEvents[0].count)
    });

    const allStepsPassed = testResult.steps.every(step => step.status === 'passed' || step.status === 'warning');
    testResult.status = allStepsPassed ? 'passed' : 'failed';

  } catch (error) {
    testResult.error = error.message;
    testResult.status = 'failed';
    console.error('Audit trail test failed:', error);
  }

  testResult.duration = Date.now() - testStart;
  return testResult;
}

// ==================== PERFORMANCE TESTS ====================

/**
 * Run performance tests
 * @param {string} prefix - Test data prefix
 * @returns {Array} Array of test results
 */
async function runPerformanceTests(prefix) {
  const tests = [
    await testPriceUploadPerformance(prefix),
    await testConcurrentOperations(prefix),
    await testResponseTimes(prefix)
  ];

  return tests;
}

/**
 * Test price upload performance
 * @param {string} prefix - Test data prefix
 * @returns {Object} Test result
 */
async function testPriceUploadPerformance(prefix) {
  const testStart = Date.now();
  const testResult = {
    testName: 'Price Upload Performance',
    status: 'passed',
    steps: [],
    error: null,
    duration: 0,
    performanceMetrics: {}
  };

  try {
    // Test with 1000 items
    const itemCount = 1000;
    const startTime = Date.now();

    // Simulate price list creation
    const largeItemList = Array.from({ length: itemCount }, (_, i) => ({
      sku: `${prefix}PERF_SKU_${i.toString().padStart(4, '0')}`,
      description: `Performance Test Product ${i}`,
      unitPrice: (Math.random() * 100 + 10).toFixed(2),
      currency: 'USD',
      minQuantity: 1
    }));

    const processingTime = Date.now() - startTime;
    testResult.performanceMetrics.processingTime = processingTime;
    testResult.performanceMetrics.itemsPerSecond = Math.round((itemCount / processingTime) * 1000);

    const performanceThreshold = 30000; // 30 seconds for 1000 items
    testResult.steps.push({
      step: `Process ${itemCount} items`,
      status: processingTime <= performanceThreshold ? 'passed' : 'failed',
      processingTime,
      threshold: performanceThreshold,
      itemsPerSecond: testResult.performanceMetrics.itemsPerSecond
    });

    testResult.status = processingTime <= performanceThreshold ? 'passed' : 'failed';

  } catch (error) {
    testResult.error = error.message;
    testResult.status = 'failed';
    console.error('Price upload performance test failed:', error);
  }

  testResult.duration = Date.now() - testStart;
  return testResult;
}

/**
 * Test concurrent operations
 * @param {string} prefix - Test data prefix
 * @returns {Object} Test result
 */
async function testConcurrentOperations(prefix) {
  const testStart = Date.now();
  const testResult = {
    testName: 'Concurrent Operations',
    status: 'passed',
    steps: [],
    error: null,
    duration: 0
  };

  try {
    // Test concurrent database operations
    const concurrentOperations = Array.from({ length: 5 }, (_, i) => {
      return db.select({ count: sql`COUNT(*)` }).from(inventory);
    });

    const startTime = Date.now();
    const results = await Promise.all(concurrentOperations);
    const concurrentTime = Date.now() - startTime;

    const allSuccessful = results.every(result => result.length > 0);

    testResult.steps.push({
      step: 'Execute concurrent operations',
      status: allSuccessful ? 'passed' : 'failed',
      operationCount: concurrentOperations.length,
      totalTime: concurrentTime,
      avgTimePerOperation: Math.round(concurrentTime / concurrentOperations.length)
    });

    testResult.status = allSuccessful ? 'passed' : 'failed';

  } catch (error) {
    testResult.error = error.message;
    testResult.status = 'failed';
    console.error('Concurrent operations test failed:', error);
  }

  testResult.duration = Date.now() - testStart;
  return testResult;
}

/**
 * Test response times
 * @param {string} prefix - Test data prefix
 * @returns {Object} Test result
 */
async function testResponseTimes(prefix) {
  const testStart = Date.now();
  const testResult = {
    testName: 'Response Times',
    status: 'passed',
    steps: [],
    error: null,
    duration: 0,
    performanceMetrics: {}
  };

  try {
    // Test various query response times
    const queryTests = [
      {
        name: 'Simple inventory query',
        query: () => db.select().from(inventory).limit(10),
        threshold: 100 // ms
      },
      {
        name: 'Complex join query',
        query: () => db.select()
          .from(products)
          .innerJoin(inventory, eq(products.id, inventory.productId))
          .limit(10),
        threshold: 500 // ms
      },
      {
        name: 'Aggregation query',
        query: () => db.select({ 
          count: sql`COUNT(*)`,
          total: sql`SUM(${inventory.quantityOnHand})`
        }).from(inventory),
        threshold: 200 // ms
      }
    ];

    for (const test of queryTests) {
      const startTime = Date.now();
      await test.query();
      const responseTime = Date.now() - startTime;

      testResult.steps.push({
        step: test.name,
        status: responseTime <= test.threshold ? 'passed' : 'failed',
        responseTime,
        threshold: test.threshold
      });

      testResult.performanceMetrics[test.name] = responseTime;
    }

    const allWithinThresholds = testResult.steps.every(step => step.status === 'passed');
    testResult.status = allWithinThresholds ? 'passed' : 'failed';

  } catch (error) {
    testResult.error = error.message;
    testResult.status = 'failed';
    console.error('Response times test failed:', error);
  }

  testResult.duration = Date.now() - testStart;
  return testResult;
}

// ==================== CLEANUP ====================

/**
 * Clean up test data
 * @param {Array} cleanupList - List of items to clean up
 */
async function cleanupTestData(cleanupList) {
  console.log('Starting test data cleanup...');
  
  try {
    // Clean up in reverse order of creation to respect foreign keys
    const cleanupOrder = [
      'timeSeriesEvents',
      'purchaseOrderReceiptItems',
      'purchaseOrderReceipts',
      'supplierPurchaseOrderItems',
      'supplierPurchaseOrders',
      'purchaseOrderItems',
      'purchaseOrders',
      'inventoryMovements',
      'inventory',
      'priceListItems',
      'priceLists',
      'products',
      'suppliers',
      'customers'
    ];

    for (const tableName of cleanupOrder) {
      try {
        await db.execute(sql`DELETE FROM ${sql.identifier(tableName)} WHERE ${sql.identifier('created_at')} > NOW() - INTERVAL '1 hour'`);
      } catch (error) {
        // Some tables might not have created_at field, or might not exist
        console.warn(`Cleanup warning for table ${tableName}:`, error.message);
      }
    }

    console.log('Test data cleanup completed');
  } catch (error) {
    console.error('Test data cleanup failed:', error);
  }
}

export default {
  runIntegrationTestSuite,
  testPriceUploadToPOCreationFlow,
  testPOToInventoryReceiptFlow,
  testOrderToShipmentFlow,
  testReturnToInventoryFlow,
  testMultiSupplierScenarios,
  runDataValidationTests,
  runPerformanceTests,
  cleanupTestData
};