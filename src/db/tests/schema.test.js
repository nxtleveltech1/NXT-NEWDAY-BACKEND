import { jest } from '@jest/globals';
import * as schema from '../schema.js';
import { db, checkConnection, closeConnection, pool } from '../index.js';
import { sql } from 'drizzle-orm';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Test configuration
const TEST_TIMEOUT = 30000;

describe('Database Schema Tests', () => {
  // Setup and teardown
  beforeAll(async () => {
    // Check database connection
    const isConnected = await checkConnection();
    if (!isConnected) {
      throw new Error('Failed to connect to database. Check your DATABASE_URL environment variable.');
    }
  }, TEST_TIMEOUT);

  afterAll(async () => {
    // Close database connection
    await closeConnection();
  }, TEST_TIMEOUT);

  describe('Table Existence Tests', () => {
    test('should have all required tables', async () => {
      const tables = [
        'customers',
        'suppliers',
        'products',
        'inventory',
        'inventory_movements',
        'price_lists',
        'price_list_items',
        'analytics_daily_aggregates',
        'analytics_monthly_aggregates',
        'time_series_metrics',
        'time_series_events',
        'time_series_hourly_metrics'
      ];

      for (const tableName of tables) {
        const result = await db.execute(sql`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_schema = 'public' 
            AND table_name = ${tableName}
          ) as exists
        `);
        
        expect(result.rows[0].exists).toBe(true);
      }
    }, TEST_TIMEOUT);

    test('should have correct columns in customers table', async () => {
      const expectedColumns = [
        'id', 'customer_code', 'company_name', 'email', 'phone',
        'address', 'metadata', 'purchase_history', 'created_at', 'updated_at'
      ];

      const result = await db.execute(sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'customers'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map(row => row.column_name);
      expectedColumns.forEach(col => {
        expect(columns).toContain(col);
      });
    }, TEST_TIMEOUT);

    test('should have correct columns in inventory table', async () => {
      const expectedColumns = [
        'id', 'product_id', 'warehouse_id', 'location_id',
        'quantity_on_hand', 'quantity_available', 'quantity_reserved', 'quantity_in_transit',
        'last_stock_check', 'last_movement', 'stock_status',
        'reorder_point', 'reorder_quantity', 'max_stock_level', 'min_stock_level',
        'average_cost', 'last_purchase_cost', 'metadata',
        'created_at', 'updated_at'
      ];

      const result = await db.execute(sql`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_schema = 'public' 
        AND table_name = 'inventory'
        ORDER BY ordinal_position
      `);

      const columns = result.rows.map(row => row.column_name);
      expectedColumns.forEach(col => {
        expect(columns).toContain(col);
      });
    }, TEST_TIMEOUT);
  });

  describe('Foreign Key Tests', () => {
    test('should have foreign key from products to suppliers', async () => {
      const result = await db.execute(sql`
        SELECT 
          tc.constraint_name,
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'products'
          AND kcu.column_name = 'supplier_id'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].foreign_table_name).toBe('suppliers');
      expect(result.rows[0].foreign_column_name).toBe('id');
    }, TEST_TIMEOUT);

    test('should have foreign key from inventory to products', async () => {
      const result = await db.execute(sql`
        SELECT 
          tc.constraint_name,
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'inventory'
          AND kcu.column_name = 'product_id'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].foreign_table_name).toBe('products');
      expect(result.rows[0].foreign_column_name).toBe('id');
    }, TEST_TIMEOUT);

    test('should have foreign key from inventory_movements to inventory', async () => {
      const result = await db.execute(sql`
        SELECT 
          tc.constraint_name,
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'inventory_movements'
          AND kcu.column_name = 'inventory_id'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].foreign_table_name).toBe('inventory');
      expect(result.rows[0].foreign_column_name).toBe('id');
    }, TEST_TIMEOUT);

    test('should have foreign key from price_lists to suppliers', async () => {
      const result = await db.execute(sql`
        SELECT 
          tc.constraint_name,
          tc.table_name,
          kcu.column_name,
          ccu.table_name AS foreign_table_name,
          ccu.column_name AS foreign_column_name
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.constraint_column_usage AS ccu
          ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'price_lists'
          AND kcu.column_name = 'supplier_id'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].foreign_table_name).toBe('suppliers');
      expect(result.rows[0].foreign_column_name).toBe('id');
    }, TEST_TIMEOUT);

    test('should have cascade delete from price_lists to price_list_items', async () => {
      const result = await db.execute(sql`
        SELECT 
          rc.delete_rule
        FROM information_schema.table_constraints AS tc
        JOIN information_schema.key_column_usage AS kcu
          ON tc.constraint_name = kcu.constraint_name
          AND tc.table_schema = kcu.table_schema
        JOIN information_schema.referential_constraints AS rc
          ON rc.constraint_name = tc.constraint_name
          AND rc.constraint_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_name = 'price_list_items'
          AND kcu.column_name = 'price_list_id'
      `);

      expect(result.rows.length).toBeGreaterThan(0);
      expect(result.rows[0].delete_rule).toBe('CASCADE');
    }, TEST_TIMEOUT);
  });

  describe('JSONB Field Tests', () => {
    test('should create and query customer with JSONB fields', async () => {
      // Create a test customer
      const testCustomer = {
        customerCode: 'TEST-' + Date.now(),
        companyName: 'Test Company',
        email: 'test@example.com',
        phone: '123-456-7890',
        address: {
          street: '123 Test St',
          city: 'Test City',
          state: 'TS',
          zip: '12345',
          country: 'Test Country'
        },
        metadata: {
          category: 'premium',
          tags: ['test', 'automated'],
          customFields: {
            field1: 'value1',
            field2: 123
          }
        },
        purchaseHistory: [
          {
            date: '2024-01-01',
            orderId: 'ORD-001',
            amount: 1000.00,
            items: ['item1', 'item2']
          },
          {
            date: '2024-02-01',
            orderId: 'ORD-002',
            amount: 2000.00,
            items: ['item3', 'item4']
          }
        ]
      };

      // Insert the customer
      const [insertedCustomer] = await db.insert(schema.customers)
        .values(testCustomer)
        .returning();

      expect(insertedCustomer).toBeTruthy();
      expect(insertedCustomer.customerCode).toBe(testCustomer.customerCode);

      // Query JSONB fields
      const result = await db.execute(sql`
        SELECT 
          address->>'city' as city,
          metadata->>'category' as category,
          jsonb_array_length(purchase_history) as purchase_count,
          purchase_history->0->>'orderId' as first_order_id
        FROM customers
        WHERE id = ${insertedCustomer.id}
      `);

      expect(result.rows[0].city).toBe('Test City');
      expect(result.rows[0].category).toBe('premium');
      expect(result.rows[0].purchase_count).toBe(2);
      expect(result.rows[0].first_order_id).toBe('ORD-001');

      // Test JSONB querying with WHERE clause
      const queryResult = await db.execute(sql`
        SELECT * FROM customers
        WHERE metadata->>'category' = 'premium'
        AND address->>'city' = 'Test City'
        AND id = ${insertedCustomer.id}
      `);

      expect(queryResult.rows.length).toBe(1);

      // Clean up
      await db.delete(schema.customers)
        .where(sql`id = ${insertedCustomer.id}`);
    }, TEST_TIMEOUT);

    test('should handle JSONB array operations in inventory_movements', async () => {
      // First, create a supplier and product for testing
      const [testSupplier] = await db.insert(schema.suppliers)
        .values({
          supplierCode: 'SUP-TEST-' + Date.now(),
          companyName: 'Test Supplier',
          email: 'supplier@test.com',
          contactDetails: { phone: '123-456-7890' },
          paymentTerms: { days: 30 }
        })
        .returning();

      const [testProduct] = await db.insert(schema.products)
        .values({
          sku: 'SKU-TEST-' + Date.now(),
          name: 'Test Product',
          unitPrice: '100.00',
          supplierId: testSupplier.id
        })
        .returning();

      // Create inventory record
      const [testInventory] = await db.insert(schema.inventory)
        .values({
          productId: testProduct.id,
          warehouseId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479', // Sample UUID
          quantityOnHand: 100,
          quantityAvailable: 100
        })
        .returning();

      // Create inventory movement with serial numbers
      const serialNumbers = ['SN001', 'SN002', 'SN003', 'SN004', 'SN005'];
      const [movement] = await db.insert(schema.inventoryMovements)
        .values({
          inventoryId: testInventory.id,
          productId: testProduct.id,
          warehouseId: testInventory.warehouseId,
          movementType: 'purchase',
          quantity: 5,
          serialNumbers: serialNumbers,
          quantityAfter: 105,
          runningTotal: 105
        })
        .returning();

      // Query JSONB array
      const result = await db.execute(sql`
        SELECT 
          jsonb_array_length(serial_numbers) as serial_count,
          serial_numbers->0 as first_serial,
          serial_numbers->-1 as last_serial
        FROM inventory_movements
        WHERE id = ${movement.id}
      `);

      expect(result.rows[0].serial_count).toBe(5);
      expect(result.rows[0].first_serial).toBe('SN001');
      expect(result.rows[0].last_serial).toBe('SN005');

      // Test JSONB array contains
      const containsResult = await db.execute(sql`
        SELECT * FROM inventory_movements
        WHERE serial_numbers @> '["SN003"]'::jsonb
        AND id = ${movement.id}
      `);

      expect(containsResult.rows.length).toBe(1);

      // Clean up
      await db.delete(schema.inventoryMovements)
        .where(sql`id = ${movement.id}`);
      await db.delete(schema.inventory)
        .where(sql`id = ${testInventory.id}`);
      await db.delete(schema.products)
        .where(sql`id = ${testProduct.id}`);
      await db.delete(schema.suppliers)
        .where(sql`id = ${testSupplier.id}`);
    }, TEST_TIMEOUT);

    test('should handle tier pricing JSONB in price_list_items', async () => {
      // Create a supplier and price list
      const [testSupplier] = await db.insert(schema.suppliers)
        .values({
          supplierCode: 'SUP-TIER-' + Date.now(),
          companyName: 'Tier Test Supplier',
          email: 'tier@test.com',
          contactDetails: {},
          paymentTerms: {}
        })
        .returning();

      const [testPriceList] = await db.insert(schema.priceLists)
        .values({
          supplierId: testSupplier.id,
          name: 'Test Price List',
          effectiveDate: new Date().toISOString().split('T')[0],
          status: 'active'
        })
        .returning();

      // Create price list item with tier pricing
      const tierPricing = [
        { minQty: 1, price: 100, discount: 0 },
        { minQty: 10, price: 95, discount: 5 },
        { minQty: 50, price: 90, discount: 10 },
        { minQty: 100, price: 85, discount: 15 }
      ];

      const [priceItem] = await db.insert(schema.priceListItems)
        .values({
          priceListId: testPriceList.id,
          sku: 'TIER-SKU-001',
          description: 'Tier Pricing Test Item',
          unitPrice: '100.00',
          tierPricing: tierPricing
        })
        .returning();

      // Query tier pricing
      const result = await db.execute(sql`
        SELECT 
          sku,
          unit_price,
          jsonb_array_length(tier_pricing) as tier_count,
          tier_pricing->2->>'minQty' as tier3_min_qty,
          tier_pricing->2->>'discount' as tier3_discount
        FROM price_list_items
        WHERE id = ${priceItem.id}
      `);

      expect(result.rows[0].tier_count).toBe(4);
      expect(result.rows[0].tier3_min_qty).toBe('50');
      expect(result.rows[0].tier3_discount).toBe('10');

      // Clean up
      await db.delete(schema.priceListItems)
        .where(sql`id = ${priceItem.id}`);
      await db.delete(schema.priceLists)
        .where(sql`id = ${testPriceList.id}`);
      await db.delete(schema.suppliers)
        .where(sql`id = ${testSupplier.id}`);
    }, TEST_TIMEOUT);
  });

  describe('Index Tests', () => {
    test('should have all required indexes', async () => {
      const expectedIndexes = [
        { table: 'customers', index: 'customer_code_idx' },
        { table: 'customers', index: 'customer_email_idx' },
        { table: 'suppliers', index: 'supplier_code_idx' },
        { table: 'products', index: 'product_sku_idx' },
        { table: 'inventory', index: 'inventory_product_warehouse_idx' },
        { table: 'inventory_movements', index: 'movement_inventory_idx' },
        { table: 'price_lists', index: 'price_list_supplier_idx' },
        { table: 'analytics_daily_aggregates', index: 'analytics_daily_date_dim_idx' }
      ];

      for (const { table, index } of expectedIndexes) {
        const result = await db.execute(sql`
          SELECT EXISTS (
            SELECT 1
            FROM pg_indexes
            WHERE schemaname = 'public'
            AND tablename = ${table}
            AND indexname = ${index}
          ) as exists
        `);

        expect(result.rows[0].exists).toBe(true);
      }
    }, TEST_TIMEOUT);
  });

  describe('Default Values and Constraints', () => {
    test('should have correct default values for inventory table', async () => {
      const result = await db.execute(sql`
        SELECT 
          column_name,
          column_default
        FROM information_schema.columns
        WHERE table_schema = 'public'
        AND table_name = 'inventory'
        AND column_default IS NOT NULL
      `);

      const defaults = result.rows.reduce((acc, row) => {
        acc[row.column_name] = row.column_default;
        return acc;
      }, {});

      expect(defaults.quantity_on_hand).toBe('0');
      expect(defaults.quantity_available).toBe('0');
      expect(defaults.quantity_reserved).toBe('0');
      expect(defaults.quantity_in_transit).toBe('0');
      expect(defaults.stock_status).toBe("'in_stock'::character varying");
    }, TEST_TIMEOUT);

    test('should have unique constraints', async () => {
      const uniqueConstraints = [
        { table: 'customers', column: 'customer_code' },
        { table: 'suppliers', column: 'supplier_code' },
        { table: 'products', column: 'sku' }
      ];

      for (const { table, column } of uniqueConstraints) {
        const result = await db.execute(sql`
          SELECT COUNT(*) as count
          FROM information_schema.table_constraints tc
          JOIN information_schema.constraint_column_usage ccu
            ON tc.constraint_name = ccu.constraint_name
          WHERE tc.table_schema = 'public'
            AND tc.table_name = ${table}
            AND ccu.column_name = ${column}
            AND tc.constraint_type = 'UNIQUE'
        `);

        expect(parseInt(result.rows[0].count)).toBeGreaterThan(0);
      }
    }, TEST_TIMEOUT);
  });

  describe('Data Type Tests', () => {
    test('should have correct data types for numeric fields', async () => {
      const numericFields = [
        { table: 'products', column: 'unit_price', precision: 10, scale: 2 },
        { table: 'inventory', column: 'average_cost', precision: 10, scale: 2 },
        { table: 'inventory_movements', column: 'total_cost', precision: 12, scale: 2 },
        { table: 'analytics_daily_aggregates', column: 'sales_revenue', precision: 12, scale: 2 }
      ];

      for (const field of numericFields) {
        const result = await db.execute(sql`
          SELECT 
            data_type,
            numeric_precision,
            numeric_scale
          FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ${field.table}
            AND column_name = ${field.column}
        `);

        expect(result.rows[0].data_type).toBe('numeric');
        expect(parseInt(result.rows[0].numeric_precision)).toBe(field.precision);
        expect(parseInt(result.rows[0].numeric_scale)).toBe(field.scale);
      }
    }, TEST_TIMEOUT);

    test('should have correct timestamp fields with timezone', async () => {
      const timestampFields = [
        { table: 'customers', columns: ['created_at', 'updated_at'] },
        { table: 'inventory', columns: ['created_at', 'updated_at', 'last_stock_check', 'last_movement'] },
        { table: 'time_series_events', columns: ['timestamp', 'created_at'] }
      ];

      for (const { table, columns } of timestampFields) {
        for (const column of columns) {
          const result = await db.execute(sql`
            SELECT 
              data_type,
              datetime_precision
            FROM information_schema.columns
            WHERE table_schema = 'public'
              AND table_name = ${table}
              AND column_name = ${column}
          `);

          if (result.rows.length > 0) {
            expect(result.rows[0].data_type).toBe('timestamp with time zone');
          }
        }
      }
    }, TEST_TIMEOUT);
  });
});