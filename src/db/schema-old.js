import {
  pgTable,
  serial,
  text,
  timestamp,
  integer,
  decimal,
  boolean,
  jsonb,
  uuid,
  index,
  primaryKey,
  varchar,
  date,
  real,
  bigint,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ==================== CUSTOMER MANAGEMENT ====================

// Customers table with comprehensive tracking
export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerCode: varchar('customer_code', { length: 50 }).unique().notNull(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  address: jsonb('address').default({}),
  metadata: jsonb('metadata').default({}), // 4 sets of metadata
  purchaseHistory: jsonb('purchase_history').default([]),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  customerCodeIdx: index('customer_code_idx').on(table.customerCode),
  emailIdx: index('customer_email_idx').on(table.email),
  companyNameIdx: index('customer_company_idx').on(table.companyName),
  createdAtIdx: index('customer_created_idx').on(table.createdAt),
}));

// ==================== PRODUCT CATALOG ====================

// Products table
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  sku: varchar('sku', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 100 }),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull().default('0'),
  costPrice: decimal('cost_price', { precision: 10, scale: 2 }).default('0'),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata').default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  skuIdx: index('product_sku_idx').on(table.sku),
  nameIdx: index('product_name_idx').on(table.name),
  categoryIdx: index('product_category_idx').on(table.category),
  supplierIdx: index('product_supplier_idx').on(table.supplierId),
  activeIdx: index('product_active_idx').on(table.isActive),
}));

// ==================== INVENTORY MANAGEMENT ====================

// Main inventory table with real-time tracking fields
export const inventory = pgTable('inventory', {
  id: serial('id').primaryKey(),
  productId: uuid('product_id').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  locationId: uuid('location_id'),
  
  // Stock levels
  quantityOnHand: integer('quantity_on_hand').notNull().default(0),
  quantityAvailable: integer('quantity_available').notNull().default(0),
  quantityReserved: integer('quantity_reserved').notNull().default(0),
  quantityInTransit: integer('quantity_in_transit').notNull().default(0),
  
  // Real-time tracking fields
  lastStockCheck: timestamp('last_stock_check', { withTimezone: true }),
  lastMovement: timestamp('last_movement', { withTimezone: true }),
  stockStatus: varchar('stock_status', { length: 50 }).notNull().default('in_stock'), // in_stock, low_stock, out_of_stock, discontinued
  
  // Thresholds
  reorderPoint: integer('reorder_point').default(0),
  reorderQuantity: integer('reorder_quantity').default(0),
  maxStockLevel: integer('max_stock_level'),
  minStockLevel: integer('min_stock_level').default(0),
  
  // Cost tracking
  averageCost: decimal('average_cost', { precision: 10, scale: 2 }),
  lastPurchaseCost: decimal('last_purchase_cost', { precision: 10, scale: 2 }),
  
  // Metadata
  metadata: jsonb('metadata'),
  isActive: boolean('is_active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  productWarehouseIdx: index('idx_inventory_product_warehouse').on(table.productId, table.warehouseId),
  warehouseIdx: index('idx_inventory_warehouse').on(table.warehouseId),
  stockStatusIdx: index('idx_inventory_stock_status').on(table.stockStatus),
  lastMovementIdx: index('idx_inventory_last_movement').on(table.lastMovement),
}));

// Movement history table for inventory tracking
export const inventoryMovements = pgTable('inventory_movements', {
  id: serial('id').primaryKey(),
  movementId: uuid('movement_id').notNull().unique().default(sql`gen_random_uuid()`),
  
  // References
  inventoryId: integer('inventory_id').notNull().references(() => inventory.id),
  productId: uuid('product_id').notNull(),
  fromWarehouseId: uuid('from_warehouse_id'),
  toWarehouseId: uuid('to_warehouse_id'),
  fromLocationId: uuid('from_location_id'),
  toLocationId: uuid('to_location_id'),
  
  // Movement details
  movementType: varchar('movement_type', { length: 50 }).notNull(), // purchase, sale, transfer, adjustment, return, damage, expiry
  movementStatus: varchar('movement_status', { length: 50 }).notNull().default('pending'), // pending, in_transit, completed, cancelled
  quantity: integer('quantity').notNull(),
  
  // Financial impact
  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }),
  totalCost: decimal('total_cost', { precision: 10, scale: 2 }),
  
  // Reference to source document
  referenceType: varchar('reference_type', { length: 50 }), // order, transfer, adjustment, return
  referenceId: uuid('reference_id'),
  
  // Tracking
  batchNumber: varchar('batch_number', { length: 100 }),
  serialNumbers: jsonb('serial_numbers'),
  expiryDate: date('expiry_date'),
  
  // User and notes
  performedBy: uuid('performed_by').notNull(),
  approvedBy: uuid('approved_by'),
  notes: text('notes'),
  
  // Timestamps
  movementDate: timestamp('movement_date', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  productIdx: index('idx_movements_product').on(table.productId),
  movementDateIdx: index('idx_movements_date').on(table.movementDate),
  movementTypeIdx: index('idx_movements_type').on(table.movementType),
  fromWarehouseIdx: index('idx_movements_from_warehouse').on(table.fromWarehouseId),
  toWarehouseIdx: index('idx_movements_to_warehouse').on(table.toWarehouseId),
  referenceIdx: index('idx_movements_reference').on(table.referenceType, table.referenceId),
}));

// ==================== ANALYTICS AGGREGATION TABLES ====================

// Daily analytics aggregation
export const analyticsDailyAggregates = pgTable('analytics_daily_aggregates', {
  id: serial('id').primaryKey(),
  date: date('date').notNull(),
  dimension: varchar('dimension', { length: 50 }).notNull(), // product, category, warehouse, customer, channel
  dimensionId: uuid('dimension_id').notNull(),
  
  // Sales metrics
  salesCount: integer('sales_count').notNull().default(0),
  salesQuantity: integer('sales_quantity').notNull().default(0),
  salesRevenue: decimal('sales_revenue', { precision: 12, scale: 2 }).notNull().default('0'),
  salesCost: decimal('sales_cost', { precision: 12, scale: 2 }).notNull().default('0'),
  salesProfit: decimal('sales_profit', { precision: 12, scale: 2 }).notNull().default('0'),
  
  // Average metrics
  avgOrderValue: decimal('avg_order_value', { precision: 10, scale: 2 }),
  avgUnitPrice: decimal('avg_unit_price', { precision: 10, scale: 2 }),
  avgDiscount: decimal('avg_discount', { precision: 5, scale: 2 }),
  
  // Inventory metrics
  inventoryLevel: integer('inventory_level'),
  inventoryValue: decimal('inventory_value', { precision: 12, scale: 2 }),
  stockTurnover: decimal('stock_turnover', { precision: 5, scale: 2 }),
  
  // Customer metrics
  uniqueCustomers: integer('unique_customers').default(0),
  newCustomers: integer('new_customers').default(0),
  returningCustomers: integer('returning_customers').default(0),
  
  // Performance metrics
  conversionRate: decimal('conversion_rate', { precision: 5, scale: 2 }),
  returnRate: decimal('return_rate', { precision: 5, scale: 2 }),
  
  // Metadata
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  dateDimensionIdx: index('idx_daily_agg_date_dimension').on(table.date, table.dimension, table.dimensionId),
  dimensionIdx: index('idx_daily_agg_dimension').on(table.dimension, table.dimensionId),
  dateIdx: index('idx_daily_agg_date').on(table.date),
}));

// Monthly analytics aggregation
export const analyticsMonthlyAggregates = pgTable('analytics_monthly_aggregates', {
  id: serial('id').primaryKey(),
  year: integer('year').notNull(),
  month: integer('month').notNull(),
  dimension: varchar('dimension', { length: 50 }).notNull(),
  dimensionId: uuid('dimension_id').notNull(),
  
  // Sales metrics
  salesCount: integer('sales_count').notNull().default(0),
  salesQuantity: integer('sales_quantity').notNull().default(0),
  salesRevenue: decimal('sales_revenue', { precision: 12, scale: 2 }).notNull().default('0'),
  salesCost: decimal('sales_cost', { precision: 12, scale: 2 }).notNull().default('0'),
  salesProfit: decimal('sales_profit', { precision: 12, scale: 2 }).notNull().default('0'),
  
  // Growth metrics
  revenueGrowth: decimal('revenue_growth', { precision: 8, scale: 2 }),
  quantityGrowth: decimal('quantity_growth', { precision: 8, scale: 2 }),
  customerGrowth: decimal('customer_growth', { precision: 8, scale: 2 }),
  
  // Average metrics
  avgDailySales: decimal('avg_daily_sales', { precision: 10, scale: 2 }),
  avgOrderValue: decimal('avg_order_value', { precision: 10, scale: 2 }),
  
  // Inventory metrics
  avgInventoryLevel: decimal('avg_inventory_level', { precision: 10, scale: 2 }),
  inventoryTurnover: decimal('inventory_turnover', { precision: 5, scale: 2 }),
  daysOfInventory: integer('days_of_inventory'),
  
  // Customer metrics
  totalCustomers: integer('total_customers').default(0),
  activeCustomers: integer('active_customers').default(0),
  churnedCustomers: integer('churned_customers').default(0),
  customerRetention: decimal('customer_retention', { precision: 5, scale: 2 }),
  
  // Metadata
  metadata: jsonb('metadata'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  yearMonthDimensionIdx: index('idx_monthly_agg_year_month_dimension').on(table.year, table.month, table.dimension, table.dimensionId),
  yearMonthIdx: index('idx_monthly_agg_year_month').on(table.year, table.month),
}));

// ==================== TIME-SERIES DATA TABLES ====================

// Real-time metrics time series
export const timeSeriesMetrics = pgTable('time_series_metrics', {
  id: serial('id').primaryKey(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  metricType: varchar('metric_type', { length: 50 }).notNull(), // sales, inventory, traffic, conversion, performance
  metricName: varchar('metric_name', { length: 100 }).notNull(),
  
  // Dimensions
  entityType: varchar('entity_type', { length: 50 }), // product, category, warehouse, channel, global
  entityId: uuid('entity_id'),
  
  // Metric values
  value: decimal('value', { precision: 20, scale: 4 }).notNull(),
  previousValue: decimal('previous_value', { precision: 20, scale: 4 }),
  
  // Additional metrics
  count: bigint('count', { mode: 'number' }),
  sum: decimal('sum', { precision: 20, scale: 4 }),
  min: decimal('min', { precision: 20, scale: 4 }),
  max: decimal('max', { precision: 20, scale: 4 }),
  avg: decimal('avg', { precision: 20, scale: 4 }),
  
  // Metadata
  tags: jsonb('tags'),
  metadata: jsonb('metadata'),
  
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  timestampTypeIdx: index('idx_ts_metrics_timestamp_type').on(table.timestamp, table.metricType),
  metricNameIdx: index('idx_ts_metrics_name').on(table.metricName),
  entityIdx: index('idx_ts_metrics_entity').on(table.entityType, table.entityId),
  timestampIdx: index('idx_ts_metrics_timestamp').on(table.timestamp),
}));

// Event-based analytics time series
export const timeSeriesEvents = pgTable('time_series_events', {
  id: serial('id').primaryKey(),
  eventId: uuid('event_id').notNull().unique().default(sql`gen_random_uuid()`),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  
  // Event identification
  eventType: varchar('event_type', { length: 50 }).notNull(), // page_view, add_to_cart, checkout, search, filter, etc.
  eventCategory: varchar('event_category', { length: 50 }).notNull(), // user_action, system_event, integration_event
  eventName: varchar('event_name', { length: 100 }).notNull(),
  
  // Context
  sessionId: uuid('session_id'),
  userId: uuid('user_id'),
  deviceId: uuid('device_id'),
  
  // Event properties
  properties: jsonb('properties').notNull().default('{}'),
  
  // Performance metrics
  duration: integer('duration'), // milliseconds
  
  // Source information
  source: varchar('source', { length: 50 }), // web, mobile, api, system
  userAgent: text('user_agent'),
  ipAddress: varchar('ip_address', { length: 45 }),
  
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  timestampTypeIdx: index('idx_ts_events_timestamp_type').on(table.timestamp, table.eventType),
  userIdx: index('idx_ts_events_user').on(table.userId),
  sessionIdx: index('idx_ts_events_session').on(table.sessionId),
  timestampIdx: index('idx_ts_events_timestamp').on(table.timestamp),
}));

// Hourly traffic and performance metrics
export const timeSeriesHourlyMetrics = pgTable('time_series_hourly_metrics', {
  id: serial('id').primaryKey(),
  hourTimestamp: timestamp('hour_timestamp', { withTimezone: true }).notNull(),
  
  // Traffic metrics
  pageViews: integer('page_views').notNull().default(0),
  uniqueVisitors: integer('unique_visitors').notNull().default(0),
  sessions: integer('sessions').notNull().default(0),
  bounceRate: decimal('bounce_rate', { precision: 5, scale: 2 }),
  avgSessionDuration: integer('avg_session_duration'), // seconds
  
  // Sales metrics
  orders: integer('orders').notNull().default(0),
  revenue: decimal('revenue', { precision: 12, scale: 2 }).notNull().default('0'),
  conversionRate: decimal('conversion_rate', { precision: 5, scale: 2 }),
  cartAbandonment: decimal('cart_abandonment', { precision: 5, scale: 2 }),
  
  // Performance metrics
  avgPageLoadTime: integer('avg_page_load_time'), // milliseconds
  avgApiResponseTime: integer('avg_api_response_time'), // milliseconds
  errorRate: decimal('error_rate', { precision: 5, scale: 2 }),
  
  // System metrics
  cpuUsage: decimal('cpu_usage', { precision: 5, scale: 2 }),
  memoryUsage: decimal('memory_usage', { precision: 5, scale: 2 }),
  activeConnections: integer('active_connections'),
  
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  hourTimestampIdx: index('idx_ts_hourly_timestamp').on(table.hourTimestamp),
}));

// ==================== SUPPLIER MANAGEMENT ====================

// Suppliers table (unified from vendor/supplier)
export const suppliers = pgTable('suppliers', {
  id: uuid('id').defaultRandom().primaryKey(),
  supplierCode: varchar('supplier_code', { length: 50 }).unique().notNull(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  contactDetails: jsonb('contact_details').default(sql`'{}'::jsonb`),
  paymentTerms: jsonb('payment_terms').default(sql`'{}'::jsonb`),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  companyNameIdx: index('idx_suppliers_company_name').on(table.companyName),
  emailIdx: index('idx_suppliers_email').on(table.email),
  isActiveIdx: index('idx_suppliers_is_active').on(table.isActive),
}));

// Price lists table
export const priceLists = pgTable('price_lists', {
  id: uuid('id').defaultRandom().primaryKey(),
  supplierId: uuid('supplier_id').references(() => suppliers.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  effectiveDate: date('effective_date').notNull(),
  expiryDate: date('expiry_date'),
  status: varchar('status', { length: 50 }).default('draft'), // draft, active, expired, archived
  uploadFormat: varchar('upload_format', { length: 50 }), // CSV, Excel, PDF, XML, JSON
  originalFilePath: text('original_file_path'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow(),
}, (table) => ({
  supplierIdIdx: index('idx_price_lists_supplier_id').on(table.supplierId),
  statusIdx: index('idx_price_lists_status').on(table.status),
  effectiveDateIdx: index('idx_price_lists_effective_date').on(table.effectiveDate),
  // Composite index for supplier price lookup
  supplierStatusIdx: index('idx_price_lists_supplier_status').on(table.supplierId, table.status),
}));

// Price list items table
export const priceListItems = pgTable('price_list_items', {
  id: uuid('id').defaultRandom().primaryKey(),
  priceListId: uuid('price_list_id').references(() => priceLists.id, { onDelete: 'cascade' }).notNull(),
  sku: varchar('sku', { length: 100 }).notNull(),
  description: text('description'),
  unitPrice: decimal('unit_price', { precision: 15, scale: 5 }).notNull(),
  currency: varchar('currency', { length: 3 }).default('USD'),
  minQuantity: integer('min_quantity').default(1),
  discountPercent: decimal('discount_percent', { precision: 5, scale: 2 }).default('0'),
  tierPricing: jsonb('tier_pricing'), // Flexible JSON for tier pricing rules
}, (table) => ({
  priceListIdIdx: index('idx_price_list_items_price_list_id').on(table.priceListId),
  skuIdx: index('idx_price_list_items_sku').on(table.sku),
  // Composite index for fast price lookups
  priceListSkuIdx: index('idx_price_list_items_price_list_sku').on(table.priceListId, table.sku),
  // Index for quantity-based price lookups
  minQuantityIdx: index('idx_price_list_items_min_quantity').on(table.minQuantity),
}));
