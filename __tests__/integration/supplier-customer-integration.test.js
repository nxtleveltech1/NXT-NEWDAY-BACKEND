import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { db } from '../../src/config/database.js';
import { sql } from 'drizzle-orm';
import * as supplierQueries from '../../src/db/supplier-queries.js';
import * as customerQueries from '../../src/db/customer-queries.js';
import * as inventoryQueries from '../../src/db/inventory-queries.js';
import { realtimeService } from '../../src/services/realtime-service.js';
import { 
  inventory, 
  inventoryMovements, 
  products, 
  suppliers, 
  customers,
  priceLists,
  priceListItems
} from '../../src/db/schema.js';

/**
 * Cross-Module Integration Tests
 * Tests the complete workflow from suppliers through inventory to customers
 */

describe('Supplier-Customer Integration Tests', () => {
  let testData = {
    suppliers: [],
    customers: [],
    products: [],
    inventoryItems: [],
    priceLists: [],
    priceListItems: [],
    warehouses: []
  };

  const testUser = {
    id: 'integration-test-user',
    email: 'integration@test.com'
  };

  beforeAll(async () => {
    // Initialize real-time service
    await realtimeService.initialize();
    
    // Setup comprehensive test data
    await setupIntegrationTestData();
  });

  afterAll(async () => {
    // Cleanup test data
    await cleanupIntegrationTestData();
    
    // Cleanup real-time service
    await realtimeService.cleanup();
  });

  beforeEach(async () => {
    // Reset inventory to known state for each test
    await resetInventoryState();
  });

  async function setupIntegrationTestData() {
    // Create test suppliers
    testData.suppliers = await Promise.all([
      supplierQueries.createSupplier({
        supplierCode: 'INT-SUPPLIER-001',
        companyName: 'Integration Electronics Co.',
        email: 'orders@integration-electronics.com',
        contactDetails: {
          phone: '+1-555-0301',
          address: '100 Integration St, Tech City, TX 75001',
          contactPerson: 'John Smith',
          department: 'Sales'
        },
        paymentTerms: {
          terms: 'Net 30',
          currency: 'USD',
          discountPercent: 2,
          discountDays: 10
        }
      }),
      supplierQueries.createSupplier({
        supplierCode: 'INT-SUPPLIER-002',
        companyName: 'Premium Components Ltd.',
        email: 'sales@premium-components.com',
        contactDetails: {
          phone: '+1-555-0302',
          address: '200 Premium Ave, Quality City, CA 90001',
          contactPerson: 'Jane Doe',
          department: 'Account Management'
        },
        paymentTerms: {
          terms: 'Net 15',
          currency: 'USD',
          discountPercent: 1.5,
          discountDays: 5
        }
      })
    ]);

    // Create test customers
    testData.customers = await Promise.all([
      customerQueries.createCustomer({
        customerCode: 'INT-CUSTOMER-001',
        companyName: 'TechCorp Solutions',
        email: 'procurement@techcorp.com',
        phone: '+1-555-0401',
        address: {
          street: '500 Corporate Blvd',
          city: 'Business Park',
          state: 'TX',
          zipCode: '75002',
          country: 'USA'
        },
        metadata: {
          creditLimit: 100000,
          preferredPaymentMethod: 'credit',
          industryType: 'technology',
          accountManager: 'Alice Johnson',
          establishedDate: '2020-01-15'
        }
      }),
      customerQueries.createCustomer({
        customerCode: 'INT-CUSTOMER-002',
        companyName: 'Enterprise Manufacturing Inc.',
        email: 'purchasing@enterprise-mfg.com',
        phone: '+1-555-0402',
        address: {
          street: '1000 Manufacturing Dr',
          city: 'Industrial Zone',
          state: 'CA',
          zipCode: '90002',
          country: 'USA'
        },
        metadata: {
          creditLimit: 250000,
          preferredPaymentMethod: 'wire',
          industryType: 'manufacturing',
          accountManager: 'Bob Wilson',
          establishedDate: '2018-06-01'
        }
      }),
      customerQueries.createCustomer({
        customerCode: 'INT-CUSTOMER-003',
        companyName: 'Retail Chain Partners',
        email: 'buyers@retail-chain.com',
        phone: '+1-555-0403',
        address: {
          street: '2000 Retail Row',
          city: 'Commerce Center',
          state: 'NY',
          zipCode: '10001',
          country: 'USA'
        },
        metadata: {
          creditLimit: 75000,
          preferredPaymentMethod: 'credit',
          industryType: 'retail',
          accountManager: 'Carol Davis',
          establishedDate: '2019-03-20'
        }
      })
    ]);

    // Create comprehensive product catalog
    const productData = [
      {
        sku: 'INT-LAPTOP-PRO-001',
        name: 'Professional Laptop 15"',
        description: 'High-performance laptop for business professionals',
        category: 'computers',
        unitPrice: '1299.99',
        costPrice: '920.00',
        supplierId: testData.suppliers[0].id,
        metadata: {
          brand: 'TechBrand',
          model: 'Pro-15-2024',
          specifications: {
            processor: 'Intel i7',
            memory: '16GB',
            storage: '512GB SSD',
            display: '15.6" 4K'
          }
        }
      },
      {
        sku: 'INT-MONITOR-4K-001',
        name: '27" 4K Professional Monitor',
        description: '27-inch 4K display for professional workstations',
        category: 'displays',
        unitPrice: '399.99',
        costPrice: '280.00',
        supplierId: testData.suppliers[0].id,
        metadata: {
          brand: 'DisplayTech',
          model: '4K-Pro-27',
          specifications: {
            resolution: '3840x2160',
            refreshRate: '60Hz',
            colorGamut: '99% sRGB'
          }
        }
      },
      {
        sku: 'INT-KEYBOARD-MECH-001',
        name: 'Mechanical Gaming Keyboard',
        description: 'RGB mechanical keyboard with premium switches',
        category: 'peripherals',
        unitPrice: '129.99',
        costPrice: '75.00',
        supplierId: testData.suppliers[1].id,
        metadata: {
          brand: 'GameTech',
          model: 'Mech-RGB-Pro',
          specifications: {
            switches: 'Cherry MX Blue',
            backlighting: 'RGB',
            connectivity: 'USB-C'
          }
        }
      },
      {
        sku: 'INT-MOUSE-WIRELESS-001',
        name: 'Wireless Precision Mouse',
        description: 'High-precision wireless mouse for professionals',
        category: 'peripherals',
        unitPrice: '79.99',
        costPrice: '45.00',
        supplierId: testData.suppliers[1].id,
        metadata: {
          brand: 'PrecisionTech',
          model: 'Wireless-Pro-V2',
          specifications: {
            dpi: '16000',
            battery: '70 hours',
            connectivity: 'Wireless 2.4GHz + Bluetooth'
          }
        }
      },
      {
        sku: 'INT-TABLET-PRO-001',
        name: 'Professional Tablet 12"',
        description: '12-inch professional tablet with stylus support',
        category: 'tablets',
        unitPrice: '899.99',
        costPrice: '650.00',
        supplierId: testData.suppliers[0].id,
        metadata: {
          brand: 'TabletPro',
          model: 'Pro-12-2024',
          specifications: {
            display: '12.9" Retina',
            storage: '256GB',
            connectivity: 'WiFi + Cellular'
          }
        }
      }
    ];

    testData.products = [];
    for (const productInfo of productData) {
      const [product] = await db.insert(products).values(productInfo).returning();
      testData.products.push(product);
    }

    // Create price lists for suppliers
    const priceListData = [
      {
        supplierId: testData.suppliers[0].id,
        name: '2024 Q1 Electronics Catalog',
        effectiveDate: new Date('2024-01-01'),
        expiryDate: new Date('2024-03-31'),
        status: 'active',
        uploadFormat: 'manual'
      },
      {
        supplierId: testData.suppliers[1].id,
        name: '2024 Peripherals Price List',
        effectiveDate: new Date('2024-01-01'),
        expiryDate: new Date('2024-12-31'),
        status: 'active',
        uploadFormat: 'manual'
      }
    ];

    testData.priceLists = [];
    for (const priceListInfo of priceListData) {
      const [priceList] = await db.insert(priceLists).values(priceListInfo).returning();
      testData.priceLists.push(priceList);
    }

    // Create price list items
    const priceItemsData = [
      // Supplier 1 pricing
      {
        priceListId: testData.priceLists[0].id,
        sku: 'INT-LAPTOP-PRO-001',
        description: 'Professional Laptop 15" - Volume Pricing',
        unitPrice: '920.00',
        currency: 'USD',
        minQuantity: 1,
        discountPercent: '0.00',
        tierPricing: [
          { minQty: 1, price: 920.00, discount: 0 },
          { minQty: 10, price: 900.00, discount: 2.17 },
          { minQty: 25, price: 880.00, discount: 4.35 },
          { minQty: 50, price: 850.00, discount: 7.61 }
        ]
      },
      {
        priceListId: testData.priceLists[0].id,
        sku: 'INT-MONITOR-4K-001',
        description: '27" 4K Professional Monitor',
        unitPrice: '280.00',
        currency: 'USD',
        minQuantity: 1,
        discountPercent: '0.00',
        tierPricing: [
          { minQty: 1, price: 280.00, discount: 0 },
          { minQty: 5, price: 270.00, discount: 3.57 },
          { minQty: 10, price: 260.00, discount: 7.14 }
        ]
      },
      {
        priceListId: testData.priceLists[0].id,
        sku: 'INT-TABLET-PRO-001',
        description: 'Professional Tablet 12"',
        unitPrice: '650.00',
        currency: 'USD',
        minQuantity: 1,
        discountPercent: '0.00',
        tierPricing: [
          { minQty: 1, price: 650.00, discount: 0 },
          { minQty: 5, price: 630.00, discount: 3.08 },
          { minQty: 15, price: 610.00, discount: 6.15 }
        ]
      },
      // Supplier 2 pricing
      {
        priceListId: testData.priceLists[1].id,
        sku: 'INT-KEYBOARD-MECH-001',
        description: 'Mechanical Gaming Keyboard',
        unitPrice: '75.00',
        currency: 'USD',
        minQuantity: 1,
        discountPercent: '0.00',
        tierPricing: [
          { minQty: 1, price: 75.00, discount: 0 },
          { minQty: 12, price: 72.00, discount: 4.00 },
          { minQty: 24, price: 68.00, discount: 9.33 }
        ]
      },
      {
        priceListId: testData.priceLists[1].id,
        sku: 'INT-MOUSE-WIRELESS-001',
        description: 'Wireless Precision Mouse',
        unitPrice: '45.00',
        currency: 'USD',
        minQuantity: 1,
        discountPercent: '0.00',
        tierPricing: [
          { minQty: 1, price: 45.00, discount: 0 },
          { minQty: 20, price: 43.00, discount: 4.44 },
          { minQty: 50, price: 40.00, discount: 11.11 }
        ]
      }
    ];

    testData.priceListItems = [];
    for (const itemData of priceItemsData) {
      const [item] = await db.insert(priceListItems).values(itemData).returning();
      testData.priceListItems.push(item);
    }

    // Define warehouses
    testData.warehouses = [
      { id: 'int-warehouse-main', name: 'Main Distribution Center', location: 'Dallas, TX' },
      { id: 'int-warehouse-west', name: 'West Coast Warehouse', location: 'Los Angeles, CA' },
      { id: 'int-warehouse-east', name: 'East Coast Warehouse', location: 'Atlanta, GA' }
    ];

    // Create initial inventory across multiple warehouses
    const initialInventoryData = [
      // Main warehouse
      {
        productId: testData.products[0].id, // Laptop
        warehouseId: 'int-warehouse-main',
        quantityOnHand: 100,
        quantityAvailable: 85,
        quantityReserved: 15,
        reorderPoint: 25,
        reorderQuantity: 50,
        averageCost: 920.00,
        stockStatus: 'in_stock'
      },
      {
        productId: testData.products[1].id, // Monitor
        warehouseId: 'int-warehouse-main',
        quantityOnHand: 150,
        quantityAvailable: 140,
        quantityReserved: 10,
        reorderPoint: 30,
        reorderQuantity: 75,
        averageCost: 280.00,
        stockStatus: 'in_stock'
      },
      {
        productId: testData.products[2].id, // Keyboard
        warehouseId: 'int-warehouse-main',
        quantityOnHand: 200,
        quantityAvailable: 180,
        quantityReserved: 20,
        reorderPoint: 50,
        reorderQuantity: 100,
        averageCost: 75.00,
        stockStatus: 'in_stock'
      },
      {
        productId: testData.products[3].id, // Mouse
        warehouseId: 'int-warehouse-main',
        quantityOnHand: 300,
        quantityAvailable: 280,
        quantityReserved: 20,
        reorderPoint: 75,
        reorderQuantity: 150,
        averageCost: 45.00,
        stockStatus: 'in_stock'
      },
      {
        productId: testData.products[4].id, // Tablet
        warehouseId: 'int-warehouse-main',
        quantityOnHand: 75,
        quantityAvailable: 65,
        quantityReserved: 10,
        reorderPoint: 20,
        reorderQuantity: 40,
        averageCost: 650.00,
        stockStatus: 'in_stock'
      },
      // West warehouse
      {
        productId: testData.products[0].id, // Laptop
        warehouseId: 'int-warehouse-west',
        quantityOnHand: 50,
        quantityAvailable: 45,
        quantityReserved: 5,
        reorderPoint: 15,
        reorderQuantity: 30,
        averageCost: 920.00,
        stockStatus: 'in_stock'
      },
      {
        productId: testData.products[1].id, // Monitor
        warehouseId: 'int-warehouse-west',
        quantityOnHand: 80,
        quantityAvailable: 75,
        quantityReserved: 5,
        reorderPoint: 20,
        reorderQuantity: 40,
        averageCost: 280.00,
        stockStatus: 'in_stock'
      },
      // East warehouse
      {
        productId: testData.products[2].id, // Keyboard
        warehouseId: 'int-warehouse-east',
        quantityOnHand: 120,
        quantityAvailable: 110,
        quantityReserved: 10,
        reorderPoint: 30,
        reorderQuantity: 60,
        averageCost: 75.00,
        stockStatus: 'in_stock'
      },
      {
        productId: testData.products[3].id, // Mouse
        warehouseId: 'int-warehouse-east',
        quantityOnHand: 180,
        quantityAvailable: 170,
        quantityReserved: 10,
        reorderPoint: 45,
        reorderQuantity: 90,
        averageCost: 45.00,
        stockStatus: 'in_stock'
      }
    ];

    testData.inventoryItems = [];
    for (const invData of initialInventoryData) {
      const [invItem] = await db.insert(inventory).values(invData).returning();
      testData.inventoryItems.push(invItem);
    }
  }

  async function resetInventoryState() {
    // Reset to initial inventory quantities
    const resetData = [
      { warehouseId: 'int-warehouse-main', productIndex: 0, onHand: 100, available: 85, reserved: 15 },
      { warehouseId: 'int-warehouse-main', productIndex: 1, onHand: 150, available: 140, reserved: 10 },
      { warehouseId: 'int-warehouse-main', productIndex: 2, onHand: 200, available: 180, reserved: 20 },
      { warehouseId: 'int-warehouse-main', productIndex: 3, onHand: 300, available: 280, reserved: 20 },
      { warehouseId: 'int-warehouse-main', productIndex: 4, onHand: 75, available: 65, reserved: 10 },
      { warehouseId: 'int-warehouse-west', productIndex: 0, onHand: 50, available: 45, reserved: 5 },
      { warehouseId: 'int-warehouse-west', productIndex: 1, onHand: 80, available: 75, reserved: 5 },
      { warehouseId: 'int-warehouse-east', productIndex: 2, onHand: 120, available: 110, reserved: 10 },
      { warehouseId: 'int-warehouse-east', productIndex: 3, onHand: 180, available: 170, reserved: 10 }
    ];

    for (const reset of resetData) {
      await db
        .update(inventory)
        .set({
          quantityOnHand: reset.onHand,
          quantityAvailable: reset.available,
          quantityReserved: reset.reserved,
          stockStatus: 'in_stock',
          updatedAt: new Date()
        })
        .where(sql`${inventory.productId} = ${testData.products[reset.productIndex].id} AND ${inventory.warehouseId} = ${reset.warehouseId}`);
    }

    // Clear test movements
    await db
      .delete(inventoryMovements)
      .where(sql`${inventoryMovements.notes} LIKE '%INT-TEST%'`);
  }

  async function cleanupIntegrationTestData() {
    try {
      // Cleanup in reverse dependency order
      await db.delete(inventoryMovements)
        .where(sql`${inventoryMovements.notes} LIKE '%INT-TEST%'`);
      
      await db.delete(inventory)
        .where(sql`${inventory.productId} IN (SELECT id FROM products WHERE sku LIKE 'INT-%')`);
      
      await db.delete(priceListItems)
        .where(sql`${priceListItems.sku} LIKE 'INT-%'`);
      
      await db.delete(priceLists)
        .where(sql`${priceLists.supplierId} IN (SELECT id FROM suppliers WHERE supplier_code LIKE 'INT-SUPPLIER-%')`);
      
      await db.delete(products)
        .where(sql`${products.sku} LIKE 'INT-%'`);
      
      await db.delete(customers)
        .where(sql`${customers.customerCode} LIKE 'INT-CUSTOMER-%'`);
      
      await db.delete(suppliers)
        .where(sql`${suppliers.supplierCode} LIKE 'INT-SUPPLIER-%'`);
    } catch (error) {
      console.error('Error cleaning up integration test data:', error);
    }
  }

  describe('Complete Purchase-to-Sale Workflow', () => {
    it('should handle complete workflow: supplier purchase receipt to customer sale', async () => {
      const supplierId = testData.suppliers[0].id;
      const customerId = testData.customers[0].id;
      const laptopProductId = testData.products[0].id;
      const warehouseId = 'int-warehouse-main';
      
      // Step 1: Get initial inventory state
      const initialLaptopInventory = testData.inventoryItems.find(
        item => item.productId === laptopProductId && item.warehouseId === warehouseId
      );
      expect(initialLaptopInventory.quantityOnHand).toBe(100);
      expect(initialLaptopInventory.quantityAvailable).toBe(85);

      // Step 2: Process supplier purchase receipt (receive 25 laptops)
      const receiptData = {
        supplierId,
        referenceNumber: 'PO-INT-001',
        items: [
          {
            productId: laptopProductId,
            warehouseId,
            quantity: 25,
            unitCost: 910.00 // Slightly better cost
          }
        ],
        performedBy: testUser.id,
        notes: 'INT-TEST: Purchase receipt for laptop restocking'
      };

      const receiptMovements = await supplierQueries.updateInventoryOnPurchaseReceipt(receiptData);
      expect(receiptMovements).toHaveLength(1);
      expect(receiptMovements[0].movementType).toBe('purchase');
      expect(receiptMovements[0].quantity).toBe(25);

      // Step 3: Verify inventory updated after receipt
      const afterReceiptInventory = await inventoryQueries.getInventoryById(initialLaptopInventory.id);
      expect(afterReceiptInventory.quantityOnHand).toBe(125); // 100 + 25
      expect(afterReceiptInventory.quantityAvailable).toBe(110); // 85 + 25
      
      // Verify average cost recalculation
      const expectedAverageCost = ((920.00 * 100) + (910.00 * 25)) / 125;
      expect(Math.abs(afterReceiptInventory.averageCost - expectedAverageCost)).toBeLessThan(0.01);

      // Step 4: Process customer order (reserve 10 laptops)
      const reservationItems = [
        {
          productId: laptopProductId,
          warehouseId,
          quantity: 10
        }
      ];

      const reservations = await customerQueries.reserveStockForCustomer(customerId, reservationItems);
      expect(reservations).toHaveLength(1);
      expect(reservations[0].quantityReserved).toBe(10);

      // Step 5: Verify reservation updated inventory
      const afterReservationInventory = await inventoryQueries.getInventoryById(initialLaptopInventory.id);
      expect(afterReservationInventory.quantityOnHand).toBe(125); // Unchanged
      expect(afterReservationInventory.quantityAvailable).toBe(100); // 110 - 10
      expect(afterReservationInventory.quantityReserved).toBe(25); // 15 + 10

      // Step 6: Process customer sale (fulfill 10 reserved laptops)
      const saleData = {
        customerId,
        items: [
          {
            productId: laptopProductId,
            warehouseId,
            quantity: 10,
            unitPrice: 1299.99
          }
        ],
        referenceNumber: 'SO-INT-001',
        performedBy: testUser.id,
        notes: 'INT-TEST: Customer sale fulfillment'
      };

      const saleResult = await customerQueries.processSale(saleData);
      expect(saleResult.movements).toHaveLength(1);
      expect(saleResult.totalSaleValue).toBe(12999.90); // 10 * 1299.99
      expect(saleResult.saleRecord.itemCount).toBe(1);

      // Step 7: Verify final inventory state
      const finalInventory = await inventoryQueries.getInventoryById(initialLaptopInventory.id);
      expect(finalInventory.quantityOnHand).toBe(115); // 125 - 10
      expect(finalInventory.quantityAvailable).toBe(100); // No change from step 5 (available was reduced by sale)
      expect(finalInventory.quantityReserved).toBe(15); // 25 - 10 (reservation released)

      // Step 8: Verify customer purchase history updated
      const updatedCustomer = await customerQueries.getCustomerById(customerId);
      expect(updatedCustomer.purchaseHistory.orders).toHaveLength(1);
      expect(updatedCustomer.purchaseHistory.totalLifetimeValue).toBe(12999.90);
      expect(updatedCustomer.purchaseHistory.orders[0].referenceNumber).toBe('SO-INT-001');

      // Step 9: Verify complete movement history
      const allMovements = await inventoryQueries.getMovements({
        productId: laptopProductId,
        warehouseId,
        limit: 10
      });

      const testMovements = allMovements.data.filter(m => 
        m.referenceNumber === 'PO-INT-001' || m.referenceNumber === 'SO-INT-001'
      );
      expect(testMovements).toHaveLength(2);
      
      const purchaseMovement = testMovements.find(m => m.movementType === 'purchase');
      const saleMovement = testMovements.find(m => m.movementType === 'sale');
      
      expect(purchaseMovement.quantity).toBe(25);
      expect(saleMovement.quantity).toBe(-10);
    });

    it('should handle complex multi-item, multi-warehouse operations', async () => {
      const customerId = testData.customers[1].id; // Enterprise Manufacturing
      
      // Process multi-warehouse sale
      const complexSaleData = {
        customerId,
        items: [
          {
            productId: testData.products[0].id, // Laptop from main warehouse
            warehouseId: 'int-warehouse-main',
            quantity: 5,
            unitPrice: 1299.99
          },
          {
            productId: testData.products[1].id, // Monitor from west warehouse
            warehouseId: 'int-warehouse-west',
            quantity: 8,
            unitPrice: 399.99
          },
          {
            productId: testData.products[2].id, // Keyboard from east warehouse
            warehouseId: 'int-warehouse-east',
            quantity: 12,
            unitPrice: 129.99
          }
        ],
        referenceNumber: 'SO-INT-COMPLEX-001',
        performedBy: testUser.id,
        notes: 'INT-TEST: Complex multi-warehouse order'
      };

      const complexSaleResult = await customerQueries.processSale(complexSaleData);

      // Verify sale result
      expect(complexSaleResult.movements).toHaveLength(3);
      const expectedTotal = (5 * 1299.99) + (8 * 399.99) + (12 * 129.99);
      expect(Math.abs(complexSaleResult.totalSaleValue - expectedTotal)).toBeLessThan(0.01);

      // Verify each warehouse inventory was updated correctly
      const mainWarehouseLaptop = testData.inventoryItems.find(
        item => item.productId === testData.products[0].id && item.warehouseId === 'int-warehouse-main'
      );
      const updatedMainLaptop = await inventoryQueries.getInventoryById(mainWarehouseLaptop.id);
      expect(updatedMainLaptop.quantityOnHand).toBe(95); // 100 - 5

      const westWarehouseMonitor = testData.inventoryItems.find(
        item => item.productId === testData.products[1].id && item.warehouseId === 'int-warehouse-west'
      );
      const updatedWestMonitor = await inventoryQueries.getInventoryById(westWarehouseMonitor.id);
      expect(updatedWestMonitor.quantityOnHand).toBe(72); // 80 - 8

      const eastWarehouseKeyboard = testData.inventoryItems.find(
        item => item.productId === testData.products[2].id && item.warehouseId === 'int-warehouse-east'
      );
      const updatedEastKeyboard = await inventoryQueries.getInventoryById(eastWarehouseKeyboard.id);
      expect(updatedEastKeyboard.quantityOnHand).toBe(108); // 120 - 12
    });
  });

  describe('Supplier Lead Time Analysis', () => {
    it('should calculate accurate supplier lead times based on purchase history', async () => {
      const supplierId = testData.suppliers[0].id;
      const laptopProductId = testData.products[0].id;
      
      // Create multiple purchase receipts over time to establish lead time patterns
      const receipts = [
        {
          date: new Date('2024-01-15'),
          referenceNumber: 'PO-LT-001',
          quantity: 20,
          cost: 920.00
        },
        {
          date: new Date('2024-02-20'),
          referenceNumber: 'PO-LT-002',
          quantity: 15,
          cost: 915.00
        },
        {
          date: new Date('2024-03-25'),
          referenceNumber: 'PO-LT-003',
          quantity: 25,
          cost: 925.00
        }
      ];

      // Process receipts
      for (const receipt of receipts) {
        await supplierQueries.updateInventoryOnPurchaseReceipt({
          supplierId,
          referenceNumber: receipt.referenceNumber,
          items: [{
            productId: laptopProductId,
            warehouseId: 'int-warehouse-main',
            quantity: receipt.quantity,
            unitCost: receipt.cost
          }],
          performedBy: testUser.id,
          notes: 'INT-TEST: Lead time analysis purchase'
        });

        // Update movement timestamps to simulate historical data
        await db
          .update(inventoryMovements)
          .set({ createdAt: receipt.date })
          .where(sql`${inventoryMovements.referenceNumber} = ${receipt.referenceNumber}`);
      }

      // Get lead time analysis
      const leadTimeData = await supplierQueries.getSupplierLeadTimes(supplierId, {
        productId: laptopProductId,
        dateFrom: '2024-01-01',
        dateTo: '2024-04-01'
      });

      expect(leadTimeData).toHaveLength(1);
      const laptopLeadTime = leadTimeData[0];
      
      expect(laptopLeadTime.productSku).toBe('INT-LAPTOP-PRO-001');
      expect(laptopLeadTime.totalDeliveries).toBe('3');
      expect(parseInt(laptopLeadTime.totalQuantityReceived)).toBe(60); // 20 + 15 + 25
      expect(parseFloat(laptopLeadTime.averageOrderQuantity)).toBe(20); // 60 / 3
    });

    it('should generate accurate reorder suggestions for suppliers', async () => {
      const supplierId = testData.suppliers[1].id;
      
      // Reduce stock levels to trigger reorder suggestions
      const keyboardInventoryId = testData.inventoryItems.find(
        item => item.productId === testData.products[2].id && item.warehouseId === 'int-warehouse-main'
      ).id;
      
      const mouseInventoryId = testData.inventoryItems.find(
        item => item.productId === testData.products[3].id && item.warehouseId === 'int-warehouse-main'
      ).id;

      // Adjust stock to below reorder points
      await inventoryQueries.adjustStock(
        keyboardInventoryId,
        40, // Below reorder point of 50
        'INT-TEST: Triggering reorder suggestion',
        testUser.id,
        'INT-TEST: Stock adjustment for reorder test'
      );

      await inventoryQueries.adjustStock(
        mouseInventoryId,
        60, // Below reorder point of 75
        'INT-TEST: Triggering reorder suggestion',
        testUser.id,
        'INT-TEST: Stock adjustment for reorder test'
      );

      // Get reorder suggestions
      const suggestions = await supplierQueries.getSupplierReorderSuggestions(supplierId);

      expect(suggestions.length).toBeGreaterThan(0);
      
      const keyboardSuggestion = suggestions.find(s => s.productSku === 'INT-KEYBOARD-MECH-001');
      const mouseSuggestion = suggestions.find(s => s.productSku === 'INT-MOUSE-WIRELESS-001');

      expect(keyboardSuggestion).toBeDefined();
      expect(keyboardSuggestion.needsReorder).toBe(true);
      expect(parseInt(keyboardSuggestion.totalAvailable)).toBeLessThanOrEqual(parseInt(keyboardSuggestion.totalReorderPoint));

      expect(mouseSuggestion).toBeDefined();
      expect(mouseSuggestion.needsReorder).toBe(true);
      expect(parseInt(mouseSuggestion.totalAvailable)).toBeLessThanOrEqual(parseInt(mouseSuggestion.totalReorderPoint));
    });
  });

  describe('Customer Analytics Integration', () => {
    it('should calculate comprehensive customer metrics after multiple transactions', async () => {
      const customerId = testData.customers[2].id; // Retail Chain Partners
      
      // Create purchase history with multiple orders over time
      const orders = [
        {
          items: [
            { productId: testData.products[1].id, warehouseId: 'int-warehouse-main', quantity: 5, unitPrice: 399.99 },
            { productId: testData.products[2].id, warehouseId: 'int-warehouse-main', quantity: 10, unitPrice: 129.99 }
          ],
          referenceNumber: 'SO-ANALYTICS-001',
          date: new Date('2024-01-10')
        },
        {
          items: [
            { productId: testData.products[3].id, warehouseId: 'int-warehouse-main', quantity: 20, unitPrice: 79.99 }
          ],
          referenceNumber: 'SO-ANALYTICS-002',
          date: new Date('2024-02-15')
        },
        {
          items: [
            { productId: testData.products[0].id, warehouseId: 'int-warehouse-main', quantity: 2, unitPrice: 1299.99 },
            { productId: testData.products[4].id, warehouseId: 'int-warehouse-main', quantity: 3, unitPrice: 899.99 }
          ],
          referenceNumber: 'SO-ANALYTICS-003',
          date: new Date('2024-03-20')
        }
      ];

      // Process orders
      for (const order of orders) {
        const saleResult = await customerQueries.processSale({
          customerId,
          items: order.items,
          referenceNumber: order.referenceNumber,
          performedBy: testUser.id,
          notes: 'INT-TEST: Customer analytics order'
        });

        // Update movement timestamps to simulate historical data
        for (const movement of saleResult.movements) {
          await db
            .update(inventoryMovements)
            .set({ createdAt: order.date })
            .where(sql`${inventoryMovements.id} = ${movement.id}`);
        }
      }

      // Calculate comprehensive analytics
      const [
        purchaseFrequency,
        averageOrderValue,
        lifetimeValue,
        churnPrediction,
        salesVelocity
      ] = await Promise.all([
        customerQueries.calculatePurchaseFrequency(customerId, {
          dateFrom: '2024-01-01',
          dateTo: '2024-04-01'
        }),
        customerQueries.calculateAverageOrderValue(customerId, {
          dateFrom: '2024-01-01',
          dateTo: '2024-04-01'
        }),
        customerQueries.calculateCustomerLifetimeValue(customerId),
        customerQueries.calculateChurnPredictionIndicators(customerId),
        customerQueries.getCustomerSalesVelocity(customerId, {
          dateFrom: '2024-01-01',
          dateTo: '2024-04-01'
        })
      ]);

      // Verify purchase frequency calculations
      expect(purchaseFrequency.totalOrders).toBe(3);
      expect(purchaseFrequency.avgDaysBetweenOrders).toBeGreaterThan(0);

      // Verify average order value
      expect(averageOrderValue.totalOrders).toBe(3);
      expect(averageOrderValue.averageOrderValue).toBeGreaterThan(0);
      
      // Calculate expected AOV
      const order1Total = (5 * 399.99) + (10 * 129.99);
      const order2Total = 20 * 79.99;
      const order3Total = (2 * 1299.99) + (3 * 899.99);
      const expectedAOV = (order1Total + order2Total + order3Total) / 3;
      expect(Math.abs(averageOrderValue.averageOrderValue - expectedAOV)).toBeLessThan(1);

      // Verify lifetime value
      expect(lifetimeValue.historicalCLV).toBeGreaterThan(0);
      expect(lifetimeValue.totalOrders).toBe(3);

      // Verify churn prediction
      expect(churnPrediction.churnScore).toBeGreaterThanOrEqual(0);
      expect(['Low', 'Medium', 'High', 'Critical']).toContain(churnPrediction.churnRisk);

      // Verify sales velocity includes product preferences
      expect(salesVelocity.length).toBeGreaterThan(0);
      const totalProducts = salesVelocity.reduce((sum, item) => sum + parseInt(item.totalQuantitySold), 0);
      expect(totalProducts).toBe(40); // 5+10+20+2+3
    });

    it('should perform accurate customer segmentation analysis', async () => {
      // Get segmentation analysis
      const segmentation = await customerQueries.performCustomerSegmentation();

      expect(segmentation.totalCustomers).toBeGreaterThan(0);
      expect(segmentation.segmentCounts).toBeDefined();
      expect(segmentation.thresholds).toBeDefined();
      expect(segmentation.segments).toBeDefined();

      // Verify all segment categories exist
      const expectedSegments = [
        'champions', 'loyalCustomers', 'potentialLoyalists', 'newCustomers',
        'promissingCustomers', 'needsAttention', 'aboutToSleep', 'atRisk',
        'cannotLoseThem', 'hibernating', 'lost'
      ];

      expectedSegments.forEach(segment => {
        expect(segmentation.segmentCounts).toHaveProperty(segment);
        expect(segmentation.segments).toHaveProperty(segment);
      });

      // Verify total customers across segments matches
      const totalInSegments = Object.values(segmentation.segmentCounts)
        .reduce((sum, count) => sum + count, 0);
      expect(totalInSegments).toBe(segmentation.totalCustomers);
    });
  });

  describe('Real-time Cross-Module Notifications', () => {
    it('should emit notifications for cross-module operations', async () => {
      // Set up event listeners
      const inventoryChangePromise = new Promise((resolve) => {
        realtimeService.once('inventory_change', resolve);
      });

      const movementPromise = new Promise((resolve) => {
        realtimeService.once('inventory_movement', resolve);
      });

      // Process a supplier receipt (should trigger both events)
      await supplierQueries.updateInventoryOnPurchaseReceipt({
        supplierId: testData.suppliers[0].id,
        referenceNumber: 'PO-RT-CROSS-001',
        items: [{
          productId: testData.products[0].id,
          warehouseId: 'int-warehouse-main',
          quantity: 15,
          unitCost: 925.00
        }],
        performedBy: testUser.id,
        notes: 'INT-TEST: Cross-module real-time test'
      });

      // Wait for notifications
      const [inventoryChange, movement] = await Promise.all([
        Promise.race([
          inventoryChangePromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Inventory change timeout')), 5000))
        ]),
        Promise.race([
          movementPromise,
          new Promise((_, reject) => setTimeout(() => reject(new Error('Movement timeout')), 5000))
        ])
      ]);

      // Verify inventory change notification
      expect(inventoryChange.type).toBe('inventory_change');
      expect(inventoryChange.data.productId).toBe(testData.products[0].id);
      expect(inventoryChange.data.warehouseId).toBe('int-warehouse-main');

      // Verify movement notification
      expect(movement.type).toBe('inventory_movement');
      expect(movement.data.movementType).toBe('purchase');
      expect(movement.data.quantity).toBe(15);
    });

    it('should handle notification sequence for complex transactions', async () => {
      const events = [];
      
      // Set up comprehensive event listener
      const eventTypes = ['inventory_change', 'inventory_movement', 'stock_alert'];
      eventTypes.forEach(eventType => {
        realtimeService.on(eventType, (event) => {
          events.push({ type: eventType, timestamp: Date.now(), data: event });
        });
      });

      // Process complex sale with potential stock alerts
      const customerId = testData.customers[0].id;
      
      // Reduce stock to trigger low stock alert
      const tabletInventoryId = testData.inventoryItems.find(
        item => item.productId === testData.products[4].id && item.warehouseId === 'int-warehouse-main'
      ).id;

      await inventoryQueries.adjustStock(
        tabletInventoryId,
        15, // Near reorder point of 20
        'INT-TEST: Preparing for alert test',
        testUser.id,
        'INT-TEST: Stock adjustment before sale'
      );

      // Clear accumulated events
      events.length = 0;

      // Process sale that should trigger low stock alert
      await customerQueries.processSale({
        customerId,
        items: [{
          productId: testData.products[4].id,
          warehouseId: 'int-warehouse-main',
          quantity: 8, // Will result in 7 remaining (below reorder point)
          unitPrice: 899.99
        }],
        referenceNumber: 'SO-RT-ALERT-001',
        performedBy: testUser.id,
        notes: 'INT-TEST: Sale triggering stock alert'
      });

      // Wait for all events to propagate
      await new Promise(resolve => setTimeout(resolve, 500));

      // Verify event sequence
      expect(events.length).toBeGreaterThan(0);
      
      const movementEvents = events.filter(e => e.type === 'inventory_movement');
      const changeEvents = events.filter(e => e.type === 'inventory_change');
      
      expect(movementEvents.length).toBeGreaterThan(0);
      expect(changeEvents.length).toBeGreaterThan(0);

      // Cleanup event listeners
      eventTypes.forEach(eventType => {
        realtimeService.removeAllListeners(eventType);
      });
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large-scale cross-module operations efficiently', async () => {
      const startTime = Date.now();
      
      // Process large supplier receipt
      const largeReceiptItems = testData.products.map(product => ({
        productId: product.id,
        warehouseId: 'int-warehouse-main',
        quantity: 50,
        unitCost: parseFloat(product.costPrice)
      }));

      await supplierQueries.updateInventoryOnPurchaseReceipt({
        supplierId: testData.suppliers[0].id,
        referenceNumber: 'PO-LARGE-001',
        items: largeReceiptItems,
        performedBy: testUser.id,
        notes: 'INT-TEST: Large-scale supplier receipt'
      });

      // Process large customer sale
      const largeSaleItems = testData.products.slice(0, 3).map(product => ({
        productId: product.id,
        warehouseId: 'int-warehouse-main',
        quantity: 10,
        unitPrice: parseFloat(product.unitPrice)
      }));

      await customerQueries.processSale({
        customerId: testData.customers[0].id,
        items: largeSaleItems,
        referenceNumber: 'SO-LARGE-001',
        performedBy: testUser.id,
        notes: 'INT-TEST: Large-scale customer sale'
      });

      const executionTime = Date.now() - startTime;
      
      // Should complete within reasonable time
      expect(executionTime).toBeLessThan(10000); // 10 seconds

      // Verify all operations completed successfully
      const movements = await inventoryQueries.getMovements({
        limit: 20,
        sortBy: 'createdAt',
        sortOrder: 'desc'
      });

      const testMovements = movements.data.filter(m => 
        m.referenceNumber === 'PO-LARGE-001' || m.referenceNumber === 'SO-LARGE-001'
      );

      expect(testMovements.length).toBe(8); // 5 purchase + 3 sale movements
    });

    it('should maintain data integrity under concurrent cross-module operations', async () => {
      const laptopProductId = testData.products[0].id;
      const warehouseId = 'int-warehouse-main';
      
      // Get initial inventory state
      const initialInventory = testData.inventoryItems.find(
        item => item.productId === laptopProductId && item.warehouseId === warehouseId
      );
      const initialQuantity = 100; // From reset

      // Create concurrent operations
      const operations = [
        // Supplier receipts
        () => supplierQueries.updateInventoryOnPurchaseReceipt({
          supplierId: testData.suppliers[0].id,
          referenceNumber: 'PO-CONCURRENT-001',
          items: [{ productId: laptopProductId, warehouseId, quantity: 10, unitCost: 920.00 }],
          performedBy: testUser.id,
          notes: 'INT-TEST: Concurrent operation 1'
        }),
        () => supplierQueries.updateInventoryOnPurchaseReceipt({
          supplierId: testData.suppliers[0].id,
          referenceNumber: 'PO-CONCURRENT-002',
          items: [{ productId: laptopProductId, warehouseId, quantity: 15, unitCost: 915.00 }],
          performedBy: testUser.id,
          notes: 'INT-TEST: Concurrent operation 2'
        }),
        // Customer sales
        () => customerQueries.processSale({
          customerId: testData.customers[0].id,
          items: [{ productId: laptopProductId, warehouseId, quantity: 5, unitPrice: 1299.99 }],
          referenceNumber: 'SO-CONCURRENT-001',
          performedBy: testUser.id,
          notes: 'INT-TEST: Concurrent sale 1'
        }),
        () => customerQueries.processSale({
          customerId: testData.customers[1].id,
          items: [{ productId: laptopProductId, warehouseId, quantity: 8, unitPrice: 1299.99 }],
          referenceNumber: 'SO-CONCURRENT-002',
          performedBy: testUser.id,
          notes: 'INT-TEST: Concurrent sale 2'
        })
      ];

      // Execute operations concurrently
      const results = await Promise.allSettled(operations.map(op => op()));

      // Most operations should succeed
      const successful = results.filter(r => r.status === 'fulfilled');
      expect(successful.length).toBeGreaterThan(2);

      // Verify final inventory consistency
      const finalInventory = await inventoryQueries.getInventoryById(initialInventory.id);
      
      // Calculate expected quantity based on successful operations
      const movements = await inventoryQueries.getMovements({
        productId: laptopProductId,
        warehouseId,
        limit: 10
      });

      const concurrentMovements = movements.data.filter(m => 
        m.referenceNumber && (
          m.referenceNumber.includes('CONCURRENT')
        )
      );

      let expectedQuantity = initialQuantity;
      concurrentMovements.forEach(movement => {
        expectedQuantity += movement.quantity;
      });

      expect(finalInventory.quantityOnHand).toBe(expectedQuantity);
      
      // Verify movement history integrity
      const sortedMovements = concurrentMovements.sort((a, b) => 
        new Date(a.createdAt) - new Date(b.createdAt)
      );

      let runningTotal = initialQuantity;
      for (const movement of sortedMovements) {
        runningTotal += movement.quantity;
        expect(movement.quantityAfter).toBe(runningTotal);
      }
    });
  });

  describe('End-to-End Analytics Validation', () => {
    it('should provide accurate analytics after complete business workflows', async () => {
      // Execute complete business cycle
      const supplierId = testData.suppliers[0].id;
      const customerId = testData.customers[0].id;
      
      // Multiple receipts and sales to generate analytics data
      const workflows = [
        {
          receipt: {
            referenceNumber: 'PO-ANALYTICS-CYCLE-001',
            items: [
              { productId: testData.products[0].id, warehouseId: 'int-warehouse-main', quantity: 20, unitCost: 920.00 },
              { productId: testData.products[1].id, warehouseId: 'int-warehouse-main', quantity: 30, unitCost: 280.00 }
            ]
          },
          sale: {
            referenceNumber: 'SO-ANALYTICS-CYCLE-001',
            items: [
              { productId: testData.products[0].id, warehouseId: 'int-warehouse-main', quantity: 8, unitPrice: 1299.99 },
              { productId: testData.products[1].id, warehouseId: 'int-warehouse-main', quantity: 12, unitPrice: 399.99 }
            ]
          }
        },
        {
          receipt: {
            referenceNumber: 'PO-ANALYTICS-CYCLE-002',
            items: [
              { productId: testData.products[2].id, warehouseId: 'int-warehouse-main', quantity: 50, unitCost: 75.00 }
            ]
          },
          sale: {
            referenceNumber: 'SO-ANALYTICS-CYCLE-002',
            items: [
              { productId: testData.products[2].id, warehouseId: 'int-warehouse-main', quantity: 25, unitPrice: 129.99 }
            ]
          }
        }
      ];

      // Execute workflows
      for (const workflow of workflows) {
        // Process receipt
        await supplierQueries.updateInventoryOnPurchaseReceipt({
          supplierId,
          ...workflow.receipt,
          performedBy: testUser.id,
          notes: 'INT-TEST: Analytics cycle receipt'
        });

        // Process sale
        await customerQueries.processSale({
          customerId,
          ...workflow.sale,
          performedBy: testUser.id,
          notes: 'INT-TEST: Analytics cycle sale'
        });
      }

      // Get comprehensive analytics
      const [
        inventoryAnalytics,
        supplierWithInventory,
        customerMetrics
      ] = await Promise.all([
        inventoryQueries.getInventoryAnalytics({ warehouseId: 'int-warehouse-main' }),
        supplierQueries.getSupplierWithInventory(supplierId),
        customerQueries.calculateCustomerLifetimeValue(customerId)
      ]);

      // Verify inventory analytics
      expect(inventoryAnalytics.summary).toBeDefined();
      expect(parseInt(inventoryAnalytics.summary.totalItems)).toBeGreaterThan(0);
      expect(parseFloat(inventoryAnalytics.summary.totalValue)).toBeGreaterThan(0);

      // Verify supplier analytics
      expect(supplierWithInventory.products).toHaveLength(testData.products.filter(p => 
        p.supplierId === supplierId
      ).length);

      supplierWithInventory.products.forEach(product => {
        expect(parseInt(product.totalOnHand)).toBeGreaterThan(0);
        expect(parseFloat(product.averageCost)).toBeGreaterThan(0);
      });

      // Verify customer analytics
      expect(customerMetrics.historicalCLV).toBeGreaterThan(0);
      expect(customerMetrics.totalOrders).toBeGreaterThan(0);

      // Verify movement consistency
      const allMovements = await inventoryQueries.getMovements({
        warehouseId: 'int-warehouse-main',
        limit: 50
      });

      const analyticsMovements = allMovements.data.filter(m => 
        m.referenceNumber && m.referenceNumber.includes('ANALYTICS-CYCLE')
      );

      expect(analyticsMovements.length).toBe(6); // 3 receipt + 3 sale movements

      // Verify purchase vs sale totals
      const purchaseMovements = analyticsMovements.filter(m => m.movementType === 'purchase');
      const saleMovements = analyticsMovements.filter(m => m.movementType === 'sale');

      expect(purchaseMovements.length).toBe(3);
      expect(saleMovements.length).toBe(3);

      const totalPurchaseQuantity = purchaseMovements.reduce((sum, m) => sum + m.quantity, 0);
      const totalSaleQuantity = Math.abs(saleMovements.reduce((sum, m) => sum + m.quantity, 0));

      expect(totalPurchaseQuantity).toBe(100); // 20+30+50
      expect(totalSaleQuantity).toBe(45); // 8+12+25
    });
  });
});