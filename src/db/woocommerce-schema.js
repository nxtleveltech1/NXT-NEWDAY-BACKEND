/**
 * Drizzle ORM Schema for WooCommerce Imported Data
 * Compatible with PostgreSQL
 * Generated: 2025-08-01
 */

import { 
  pgTable, 
  integer, 
  varchar, 
  text, 
  decimal, 
  boolean, 
  timestamp, 
  jsonb,
  index,
  foreignKey,
  unique
} from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';

// =============================================================================
// CUSTOMERS TABLE
// =============================================================================
export const customers = pgTable('customers', {
  id: integer('id').primaryKey(),
  firstName: varchar('first_name', { length: 100 }),
  lastName: varchar('last_name', { length: 100 }),
  email: varchar('email', { length: 255 }),
  username: varchar('username', { length: 100 }),
  billing: jsonb('billing'), // Billing address and info as JSON
  shipping: jsonb('shipping'), // Shipping address and info as JSON
  isPayingCustomer: boolean('is_paying_customer').default(false),
  avatarUrl: varchar('avatar_url', { length: 500 }),
  metaData: jsonb('meta_data'), // Additional metadata as JSON
  links: jsonb('_links'), // WooCommerce API links
  role: varchar('role', { length: 50 }),
  dateCreated: timestamp('date_created'),
  dateCreatedGmt: timestamp('date_created_gmt'),
  dateModified: timestamp('date_modified'),
  dateModifiedGmt: timestamp('date_modified_gmt'),
}, (table) => ({
  // Indexes for performance
  emailIdx: index('idx_customers_email').on(table.email),
  dateCreatedIdx: index('idx_customers_date_created').on(table.dateCreated),
  roleIdx: index('idx_customers_role').on(table.role),
  // Unique constraint on email
  emailUnique: unique('customers_email_unique').on(table.email),
}));

// =============================================================================
// PRODUCTS TABLE
// =============================================================================
export const products = pgTable('products', {
  id: integer('id').primaryKey(),
  name: varchar('name', { length: 255 }),
  slug: varchar('slug', { length: 255 }),
  permalink: text('permalink'),
  price: decimal('price', { precision: 10, scale: 2 }),
  sku: varchar('sku', { length: 100 }),
  stockQuantity: integer('stock_quantity'),
  stockStatus: varchar('stock_status', { length: 50 }),
  categories: jsonb('categories'), // Product categories as JSON array
  dateCreated: timestamp('date_created'),
  dateModified: timestamp('date_modified'),
}, (table) => ({
  // Indexes for performance
  skuIdx: index('idx_products_sku').on(table.sku),
  stockStatusIdx: index('idx_products_stock_status').on(table.stockStatus),
  dateCreatedIdx: index('idx_products_date_created').on(table.dateCreated),
  // Unique constraint on SKU
  skuUnique: unique('products_sku_unique').on(table.sku),
}));

// =============================================================================
// ORDERS TABLE
// =============================================================================
export const orders = pgTable('orders', {
  id: integer('id').primaryKey(),
  status: varchar('status', { length: 50 }),
  currency: varchar('currency', { length: 10 }),
  total: decimal('total', { precision: 10, scale: 2 }),
  customerId: integer('customer_id'),
  paymentMethodTitle: varchar('payment_method_title', { length: 100 }),
  dateCreated: timestamp('date_created'),
  dateModified: timestamp('date_modified'),
  billingAddress: text('billing_address'),
  shippingAddress: text('shipping_address'),
}, (table) => ({
  // Indexes for performance
  customerIdIdx: index('idx_orders_customer_id').on(table.customerId),
  statusIdx: index('idx_orders_status').on(table.status),
  dateCreatedIdx: index('idx_orders_date_created').on(table.dateCreated),
  totalIdx: index('idx_orders_total').on(table.total),
  // Foreign key constraint
  customerFk: foreignKey({
    columns: [table.customerId],
    foreignColumns: [customers.id],
    name: 'orders_customer_fk'
  }),
}));

// =============================================================================
// RELATIONS
// =============================================================================
export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
}));

export const ordersRelations = relations(orders, ({ one }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
}));

// =============================================================================
// IMPORT LOGGING TABLE
// =============================================================================
export const importLog = pgTable('import_log', {
  id: integer('id').primaryKey().generatedAlwaysAsIdentity(),
  tableName: varchar('table_name', { length: 50 }),
  operation: varchar('operation', { length: 20 }),
  recordsProcessed: integer('records_processed'),
  recordsFailed: integer('records_failed'),
  errorDetails: text('error_details'),
  importStarted: timestamp('import_started').defaultNow(),
  importCompleted: timestamp('import_completed'),
  status: varchar('status', { length: 20 }).default('PENDING'),
}, (table) => ({
  tableNameIdx: index('idx_import_log_table_name').on(table.tableName),
  statusIdx: index('idx_import_log_status').on(table.status),
  importStartedIdx: index('idx_import_log_import_started').on(table.importStarted),
}));

// =============================================================================
// TYPESCRIPT TYPES (for better type safety)
// =============================================================================

// Infer types from schema
export type Customer = typeof customers.$inferSelect;
export type NewCustomer = typeof customers.$inferInsert;

export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;

export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;

export type ImportLog = typeof importLog.$inferSelect;
export type NewImportLog = typeof importLog.$inferInsert;

// =============================================================================
// JSON FIELD TYPES (for better type safety with JSONB fields)
// =============================================================================

// Customer billing/shipping address structure
export interface CustomerAddress {
  first_name?: string;
  last_name?: string;
  company?: string;
  address_1?: string;
  address_2?: string;
  city?: string;
  state?: string;
  postcode?: string;
  country?: string;
  email?: string;
  phone?: string;
}

// Customer metadata structure
export interface CustomerMetaData {
  id?: number;
  key?: string;
  value?: string;
}

// Product category structure
export interface ProductCategory {
  id: number;
  name: string;
  slug: string;
}

// WooCommerce API links structure
export interface WooCommerceLinks {
  self?: Array<{
    href: string;
    targetHints?: {
      allow: string[];
    };
  }>;
  collection?: Array<{
    href: string;
  }>;
}

// =============================================================================
// QUERY HELPERS
// =============================================================================

// Common query patterns for imported data
export const queryHelpers = {
  // Get customers with their order count
  customersWithOrderCount: `
    SELECT 
      c.*,
      COUNT(o.id) as order_count,
      COALESCE(SUM(o.total), 0) as total_spent
    FROM customers c
    LEFT JOIN orders o ON c.id = o.customer_id
    GROUP BY c.id
    ORDER BY total_spent DESC
  `,

  // Get products by category
  productsByCategory: `
    SELECT 
      p.*,
      jsonb_array_elements(p.categories) as category
    FROM products p
    WHERE p.categories IS NOT NULL
  `,

  // Get orders with customer details
  ordersWithCustomer: `
    SELECT 
      o.*,
      c.first_name,
      c.last_name,
      c.email
    FROM orders o
    JOIN customers c ON o.customer_id = c.id
    ORDER BY o.date_created DESC
  `,

  // Import validation queries
  validateImport: `
    SELECT 
      'customers' as table_name,
      COUNT(*) as record_count,
      MIN(date_created) as earliest_date,
      MAX(date_created) as latest_date
    FROM customers
    
    UNION ALL
    
    SELECT 
      'products' as table_name,
      COUNT(*) as record_count,
      MIN(date_created) as earliest_date,
      MAX(date_created) as latest_date
    FROM products
    
    UNION ALL
    
    SELECT 
      'orders' as table_name,
      COUNT(*) as record_count,
      MIN(date_created) as earliest_date,
      MAX(date_created) as latest_date
    FROM orders
  `,
};

// Export all schemas for drizzle config
export const woocommerceSchemas = {
  customers,
  products,
  orders,
  importLog,
  customersRelations,
  ordersRelations,
};