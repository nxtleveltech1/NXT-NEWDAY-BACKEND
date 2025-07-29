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
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ==================== USER MANAGEMENT ====================

export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 255 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  emailIdx: index('user_email_idx').on(table.email),
}));

// ==================== CUSTOMER MANAGEMENT ====================

// Customers table with comprehensive tracking
export const customers = pgTable('customers', {
  id: uuid('id').primaryKey().defaultRandom(),
  customerCode: varchar('customer_code', { length: 50 }).unique().notNull(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  address: jsonb('address').default(sql`'{}'::jsonb`).notNull(),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
  purchaseHistory: jsonb('purchase_history').default(sql`'[]'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  customerCodeIdx: index('customer_code_idx').on(table.customerCode),
  emailIdx: index('customer_email_idx').on(table.email),
  companyNameIdx: index('customer_company_idx').on(table.companyName),
  createdAtIdx: index('customer_created_idx').on(table.createdAt),
}));

// ==================== SUPPLIER MANAGEMENT ====================

// Suppliers table (unified from vendor/supplier)
export const suppliers = pgTable('suppliers', {
  id: uuid('id').defaultRandom().primaryKey(),
  supplierCode: varchar('supplier_code', { length: 50 }).unique().notNull(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  website: varchar('website', { length: 255 }),
  
  // Address information
  address: jsonb('address').default(sql`'{}'::jsonb`).notNull(),
  
  // Contact details (enhanced)
  contactDetails: jsonb('contact_details').default(sql`'{}'::jsonb`).notNull(),
  
  // Financial terms
  paymentTerms: jsonb('payment_terms').default(sql`'{}'::jsonb`).notNull(),
  creditLimit: decimal('credit_limit', { precision: 12, scale: 2 }),
  taxId: varchar('tax_id', { length: 50 }),
  
  // Business classification
  supplierType: varchar('supplier_type', { length: 50 }).default('vendor'), // vendor, manufacturer, distributor, service_provider
  industry: varchar('industry', { length: 100 }),
  
  // Performance metrics
  performanceRating: decimal('performance_rating', { precision: 3, scale: 2 }).default('0'),
  leadTimeDays: integer('lead_time_days').default(0),
  
  // Vendor-specific consolidated fields
  vendorMetadata: jsonb('vendor_metadata').default(sql`'{}'::jsonb`).notNull(), // For legacy vendor data
  
  // Status and lifecycle
  isActive: boolean('is_active').default(true).notNull(),
  isApproved: boolean('is_approved').default(false).notNull(),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  approvedBy: uuid('approved_by'),
  
  // Audit trail
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  supplierCodeIdx: index('supplier_code_idx').on(table.supplierCode),
  companyNameIdx: index('supplier_company_idx').on(table.companyName),
  emailIdx: index('supplier_email_idx').on(table.email),
  isActiveIdx: index('supplier_active_idx').on(table.isActive),
  supplierTypeIdx: index('supplier_type_idx').on(table.supplierType),
  industryIdx: index('supplier_industry_idx').on(table.industry),
  performanceIdx: index('supplier_performance_idx').on(table.performanceRating),
  isApprovedIdx: index('supplier_approved_idx').on(table.isApproved),
}));

// ==================== PRODUCT CATALOG ====================

// Products table
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalId: integer('external_id').unique(),
  sku: varchar('sku', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 100 }),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull().default('0'),
  costPrice: decimal('cost_price', { precision: 10, scale: 2 }).default('0'),
  supplierId: uuid('supplier_id').references(() => suppliers.id),
  isActive: boolean('is_active').notNull().default(true),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  skuIdx: index('product_sku_idx').on(table.sku),
  nameIdx: index('product_name_idx').on(table.name),
  categoryIdx: index('product_category_idx').on(table.category),
  supplierIdx: index('product_supplier_idx').on(table.supplierId),
  activeIdx: index('product_active_idx').on(table.isActive),
  externalIdIdx: index('product_external_id_idx').on(table.externalId),
}));

// ==================== WAREHOUSE MANAGEMENT ====================

export const warehouses = pgTable('warehouses', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: varchar('code', { length: 50 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  address: jsonb('address').default(sql`'{}'::jsonb`),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  codeIdx: index('warehouse_code_idx').on(table.code),
}));

// ==================== INVENTORY MANAGEMENT ====================

// Main inventory table with real-time tracking fields
export const inventory = pgTable('inventory', {
  id: serial('id').primaryKey(),
  productId: uuid('product_id').notNull().references(() => products.id),
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
  stockStatus: varchar('stock_status', { length: 50 }).notNull().default('in_stock'),
  
  // Thresholds
  reorderPoint: integer('reorder_point').default(0),
  reorderQuantity: integer('reorder_quantity').default(0),
  maxStockLevel: integer('max_stock_level'),
  minStockLevel: integer('min_stock_level').default(0),
  
  // Cost tracking
  averageCost: decimal('average_cost', { precision: 10, scale: 2 }),
  lastPurchaseCost: decimal('last_purchase_cost', { precision: 10, scale: 2 }),
  
  // Metadata
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  productWarehouseIdx: index('inventory_product_warehouse_idx').on(table.productId, table.warehouseId),
  stockStatusIdx: index('inventory_stock_status_idx').on(table.stockStatus),
  reorderPointIdx: index('inventory_reorder_point_idx').on(table.reorderPoint),
  lastMovementIdx: index('inventory_last_movement_idx').on(table.lastMovement),
}));

// Inventory movements/history table
export const inventoryMovements = pgTable('inventory_movements', {
  id: uuid('id').defaultRandom().primaryKey(),
  inventoryId: integer('inventory_id').references(() => inventory.id).notNull(),
  productId: uuid('product_id').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  
  // Movement details
  movementType: varchar('movement_type', { length: 50 }).notNull(), // purchase, sale, transfer, adjustment, return, damage, expiry
  quantity: integer('quantity').notNull(), // positive for in, negative for out
  fromLocation: uuid('from_location'),
  toLocation: uuid('to_location'),
  
  // Financial impact
  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }),
  totalCost: decimal('total_cost', { precision: 12, scale: 2 }),
  
  // Reference information
  referenceType: varchar('reference_type', { length: 50 }), // order, invoice, adjustment_doc, etc
  referenceId: uuid('reference_id'),
  referenceNumber: varchar('reference_number', { length: 100 }),
  
  // Tracking
  performedBy: uuid('performed_by'),
  notes: text('notes'),
  batchNumber: varchar('batch_number', { length: 100 }),
  serialNumbers: jsonb('serial_numbers').default(sql`'[]'::jsonb`),
  expiryDate: date('expiry_date'),
  expectedDate: timestamp('expected_date', { withTimezone: true }), // For delivery performance tracking
  
  // Snapshots after movement
  quantityAfter: integer('quantity_after').notNull(),
  runningTotal: integer('running_total').notNull(),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  inventoryIdx: index('movement_inventory_idx').on(table.inventoryId),
  productIdx: index('movement_product_idx').on(table.productId),
  warehouseIdx: index('movement_warehouse_idx').on(table.warehouseId),
  movementTypeIdx: index('movement_type_idx').on(table.movementType),
  createdAtIdx: index('movement_created_idx').on(table.createdAt),
  referenceIdx: index('movement_reference_idx').on(table.referenceType, table.referenceId),
}));

// ==================== INVOICING SYSTEM ====================

// Purchase Orders table
export const purchaseOrders = pgTable('purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderNumber: varchar('order_number', { length: 100 }).unique().notNull(),
  supplierId: uuid('supplier_id').references(() => suppliers.id).notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  
  // Order details
  status: varchar('status', { length: 50 }).default('draft').notNull(), // draft, pending, approved, shipped, received, cancelled
  orderDate: timestamp('order_date', { withTimezone: true }).defaultNow().notNull(),
  expectedDeliveryDate: timestamp('expected_delivery_date', { withTimezone: true }),
  actualDeliveryDate: timestamp('actual_delivery_date', { withTimezone: true }),
  
  // Financial information
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).default('0').notNull(),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  shippingCost: decimal('shipping_cost', { precision: 12, scale: 2 }).default('0').notNull(),
  discountAmount: decimal('discount_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  
  // Addresses
  billingAddress: jsonb('billing_address').default(sql`'{}'::jsonb`).notNull(),
  shippingAddress: jsonb('shipping_address').default(sql`'{}'::jsonb`).notNull(),
  
  // Notes and metadata
  notes: text('notes'),
  internalNotes: text('internal_notes'),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
  
  // Audit fields
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  orderNumberIdx: index('po_order_number_idx').on(table.orderNumber),
  supplierIdx: index('po_supplier_idx').on(table.supplierId),
  customerIdx: index('po_customer_idx').on(table.customerId),
  statusIdx: index('po_status_idx').on(table.status),
  orderDateIdx: index('po_order_date_idx').on(table.orderDate),
  totalAmountIdx: index('po_total_amount_idx').on(table.totalAmount),
}));

// Purchase Order Items table
export const purchaseOrderItems = pgTable('purchase_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id).notNull(),
  productId: uuid('product_id').references(() => products.id).notNull(),
  
  // Item details
  quantity: integer('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
  lineTotal: decimal('line_total', { precision: 12, scale: 2 }).notNull(),
  
  // Tracking
  quantityReceived: integer('quantity_received').default(0).notNull(),
  quantityInvoiced: integer('quantity_invoiced').default(0).notNull(),
  
  // Product details at time of order
  productSku: varchar('product_sku', { length: 100 }).notNull(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  productDescription: text('product_description'),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  purchaseOrderIdx: index('poi_purchase_order_idx').on(table.purchaseOrderId),
  productIdx: index('poi_product_idx').on(table.productId),
}));

// Invoices table
export const invoices = pgTable('invoices', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceNumber: varchar('invoice_number', { length: 100 }).unique().notNull(),
  
  // Entity relationships
  supplierId: uuid('supplier_id').references(() => suppliers.id).notNull(),
  customerId: uuid('customer_id').references(() => customers.id),
  purchaseOrderId: uuid('purchase_order_id').references(() => purchaseOrders.id),
  
  // Invoice details
  invoiceType: varchar('invoice_type', { length: 50 }).default('purchase').notNull(), // purchase, sales, credit_note, debit_note
  status: varchar('status', { length: 50 }).default('draft').notNull(), // draft, pending, approved, paid, overdue, cancelled, disputed
  
  // Dates
  invoiceDate: timestamp('invoice_date', { withTimezone: true }).defaultNow().notNull(),
  dueDate: timestamp('due_date', { withTimezone: true }).notNull(),
  paidDate: timestamp('paid_date', { withTimezone: true }),
  
  // Financial information
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).default('0').notNull(),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  shippingCost: decimal('shipping_cost', { precision: 12, scale: 2 }).default('0').notNull(),
  discountAmount: decimal('discount_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  paidAmount: decimal('paid_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  balanceAmount: decimal('balance_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  
  // Payment terms
  paymentTerms: jsonb('payment_terms').default(sql`'{}'::jsonb`).notNull(),
  
  // Addresses
  billingAddress: jsonb('billing_address').default(sql`'{}'::jsonb`).notNull(),
  shippingAddress: jsonb('shipping_address').default(sql`'{}'::jsonb`).notNull(),
  
  // Document management
  documentPath: varchar('document_path', { length: 500 }),
  documentHash: varchar('document_hash', { length: 256 }),
  
  // Notes and metadata
  notes: text('notes'),
  internalNotes: text('internal_notes'),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
  
  // Audit fields
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  invoiceNumberIdx: index('invoice_number_idx').on(table.invoiceNumber),
  supplierIdx: index('invoice_supplier_idx').on(table.supplierId),
  customerIdx: index('invoice_customer_idx').on(table.customerId),
  purchaseOrderIdx: index('invoice_po_idx').on(table.purchaseOrderId),
  statusIdx: index('invoice_status_idx').on(table.status),
  invoiceTypeIdx: index('invoice_type_idx').on(table.invoiceType),
  invoiceDateIdx: index('invoice_date_idx').on(table.invoiceDate),
  dueDateIdx: index('invoice_due_date_idx').on(table.dueDate),
  totalAmountIdx: index('invoice_total_amount_idx').on(table.totalAmount),
}));

// Invoice Items table
export const invoiceItems = pgTable('invoice_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  invoiceId: uuid('invoice_id').references(() => invoices.id).notNull(),
  productId: uuid('product_id').references(() => products.id),
  purchaseOrderItemId: uuid('purchase_order_item_id').references(() => purchaseOrderItems.id),
  
  // Item details
  quantity: integer('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
  lineTotal: decimal('line_total', { precision: 12, scale: 2 }).notNull(),
  taxAmount: decimal('tax_amount', { precision: 10, scale: 2 }).default('0').notNull(),
  discountAmount: decimal('discount_amount', { precision: 10, scale: 2 }).default('0').notNull(),
  
  // Product details at time of invoice
  productSku: varchar('product_sku', { length: 100 }),
  productName: varchar('product_name', { length: 255 }).notNull(),
  productDescription: text('product_description'),
  
  // Custom line items support
  itemType: varchar('item_type', { length: 50 }).default('product').notNull(), // product, service, fee, discount
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  invoiceIdx: index('invoice_item_invoice_idx').on(table.invoiceId),
  productIdx: index('invoice_item_product_idx').on(table.productId),
  purchaseOrderItemIdx: index('invoice_item_po_item_idx').on(table.purchaseOrderItemId),
}));

// Payment Records table
export const payments = pgTable('payments', {
  id: uuid('id').primaryKey().defaultRandom(),
  paymentNumber: varchar('payment_number', { length: 100 }).unique().notNull(),
  invoiceId: uuid('invoice_id').references(() => invoices.id).notNull(),
  
  // Payment details
  paymentMethod: varchar('payment_method', { length: 50 }).notNull(), // bank_transfer, check, cash, credit_card, eft, wire_transfer
  paymentAmount: decimal('payment_amount', { precision: 12, scale: 2 }).notNull(),
  paymentDate: timestamp('payment_date', { withTimezone: true }).defaultNow().notNull(),
  
  // Banking information
  bankReference: varchar('bank_reference', { length: 100 }),
  checkNumber: varchar('check_number', { length: 50 }),
  transactionId: varchar('transaction_id', { length: 100 }),
  
  // Status and reconciliation
  status: varchar('status', { length: 50 }).default('pending').notNull(), // pending, cleared, bounced, cancelled
  reconciledAt: timestamp('reconciled_at', { withTimezone: true }),
  reconciledBy: uuid('reconciled_by'),
  
  // Notes and metadata
  notes: text('notes'),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
  
  // Audit fields
  createdBy: uuid('created_by'),
  updatedBy: uuid('updated_by'),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  paymentNumberIdx: index('payment_number_idx').on(table.paymentNumber),
  invoiceIdx: index('payment_invoice_idx').on(table.invoiceId),
  paymentMethodIdx: index('payment_method_idx').on(table.paymentMethod),
  paymentDateIdx: index('payment_date_idx').on(table.paymentDate),
  statusIdx: index('payment_status_idx').on(table.status),
}));

// ==================== PRICE MANAGEMENT ====================

// Price lists table
export const priceLists = pgTable('price_lists', {
  id: uuid('id').defaultRandom().primaryKey(),
  supplierId: uuid('supplier_id').references(() => suppliers.id).notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  
  // Date management
  effectiveDate: date('effective_date').notNull(),
  expiryDate: date('expiry_date'),
  
  // Status and lifecycle
  status: varchar('status', { length: 50 }).default('draft'), // draft, active, expired, archived
  
  // Version control
  version: varchar('version', { length: 50 }).default('1.0'),
  parentPriceListId: uuid('parent_price_list_id').references(() => priceLists.id),
  
  // Upload metadata
  uploadFormat: varchar('upload_format', { length: 50 }), // CSV, Excel, PDF, XML, JSON
  originalFilePath: text('original_file_path'),
  originalFileName: varchar('original_file_name', { length: 255 }),
  
  // Validation and approval
  validationStatus: varchar('validation_status', { length: 50 }).default('pending'), // pending, validated, failed
  validationErrors: jsonb('validation_errors').default(sql`'[]'::jsonb`),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  
  // Analytics
  itemCount: integer('item_count').default(0),
  currenciesSupported: jsonb('currencies_supported').default(sql`'["USD"]'::jsonb`),
  
  // Audit trail
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  supplierIdx: index('price_list_supplier_idx').on(table.supplierId),
  statusIdx: index('price_list_status_idx').on(table.status),
  effectiveDateIdx: index('price_list_effective_idx').on(table.effectiveDate),
  supplierStatusIdx: index('price_list_supplier_status_idx').on(table.supplierId, table.status),
  versionIdx: index('price_list_version_idx').on(table.version),
  validationStatusIdx: index('price_list_validation_idx').on(table.validationStatus),
  parentPriceListIdx: index('price_list_parent_idx').on(table.parentPriceListId),
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
  tierPricing: jsonb('tier_pricing').default(sql`'[]'::jsonb`), // Array of {minQty, price, discount}
}, (table) => ({
  priceListIdx: index('price_item_list_idx').on(table.priceListId),
  skuIdx: index('price_item_sku_idx').on(table.sku),
  listSkuIdx: index('price_item_list_sku_idx').on(table.priceListId, table.sku),
  minQuantityIdx: index('price_item_min_qty_idx').on(table.minQuantity),
}));

// Upload history tracking
export const uploadHistory = pgTable('upload_history', {
  id: uuid('id').defaultRandom().primaryKey(),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  fileName: varchar('file_name', { length: 255 }).notNull(),
  fileType: varchar('file_type', { length: 50 }).notNull(),
  fileSize: integer('file_size').notNull(),
  status: varchar('status', { length: 50 }).notNull(), // processing, completed, failed
  itemCount: integer('item_count').default(0),
  successCount: integer('success_count').default(0),
  errorCount: integer('error_count').default(0),
  errors: jsonb('errors').default(sql`'[]'::jsonb`),
  warnings: jsonb('warnings').default(sql`'[]'::jsonb`),
  uploadDate: timestamp('upload_date', { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  failedAt: timestamp('failed_at', { withTimezone: true }),
  uploadedBy: uuid('uploaded_by').notNull(),
  priceListId: uuid('price_list_id').references(() => priceLists.id),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  supplierIdx: index('upload_history_supplier_idx').on(table.supplierId),
  statusIdx: index('upload_history_status_idx').on(table.status),
  uploadDateIdx: index('upload_history_upload_date_idx').on(table.uploadDate),
  uploadedByIdx: index('upload_history_uploaded_by_idx').on(table.uploadedBy),
}));

// ==================== ANALYTICS & REPORTING ====================

// Daily aggregates for analytics
export const analyticsDailyAggregates = pgTable('analytics_daily_aggregates', {
  id: serial('id').primaryKey(),
  date: date('date').notNull(),
  dimension: varchar('dimension', { length: 50 }).notNull(), // product, category, warehouse, customer, supplier
  dimensionId: uuid('dimension_id').notNull(),
  
  // Sales metrics
  salesCount: integer('sales_count').notNull().default(0),
  salesQuantity: integer('sales_quantity').notNull().default(0),
  salesRevenue: decimal('sales_revenue', { precision: 12, scale: 2 }).notNull().default('0'),
  salesCost: decimal('sales_cost', { precision: 12, scale: 2 }).notNull().default('0'),
  salesProfit: decimal('sales_profit', { precision: 12, scale: 2 }).notNull().default('0'),
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
  
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  dateDimensionIdx: index('analytics_daily_date_dim_idx').on(table.date, table.dimension, table.dimensionId),
  dimensionIdx: index('analytics_daily_dimension_idx').on(table.dimension),
  dateIdx: index('analytics_daily_date_idx').on(table.date),
}));

// Monthly aggregates for trend analysis
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
  
  // Averages
  avgDailySales: decimal('avg_daily_sales', { precision: 10, scale: 2 }),
  avgOrderValue: decimal('avg_order_value', { precision: 10, scale: 2 }),
  avgInventoryLevel: decimal('avg_inventory_level', { precision: 10, scale: 2 }),
  
  // Inventory metrics
  inventoryTurnover: decimal('inventory_turnover', { precision: 5, scale: 2 }),
  daysOfInventory: integer('days_of_inventory'),
  
  // Customer metrics
  totalCustomers: integer('total_customers').default(0),
  activeCustomers: integer('active_customers').default(0),
  churnedCustomers: integer('churned_customers').default(0),
  customerRetention: decimal('customer_retention', { precision: 5, scale: 2 }),
  
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  yearMonthDimIdx: index('analytics_monthly_ym_dim_idx').on(table.year, table.month, table.dimension, table.dimensionId),
  yearMonthIdx: index('analytics_monthly_ym_idx').on(table.year, table.month),
}));

// ==================== SUPPLIER PURCHASE ORDERS ====================

// Supplier Purchase Orders (orders TO suppliers FROM us)
export const supplierPurchaseOrders = pgTable('supplier_purchase_orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  poNumber: varchar('po_number', { length: 100 }).unique().notNull(),
  supplierId: uuid('supplier_id').notNull().references(() => suppliers.id),
  
  // Dates
  orderDate: timestamp('order_date', { withTimezone: true }).defaultNow().notNull(),
  expectedDeliveryDate: timestamp('expected_delivery_date', { withTimezone: true }),
  requestedDeliveryDate: timestamp('requested_delivery_date', { withTimezone: true }),
  
  // Status tracking
  status: varchar('status', { length: 50 }).default('draft').notNull(), 
  // draft, pending_approval, approved, sent, acknowledged, in_transit, delivered, completed, cancelled
  approvalStatus: varchar('approval_status', { length: 50 }).default('pending').notNull(),
  // pending, approved, rejected, auto_approved
  
  // Financial information
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).default('0').notNull(),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  shippingAmount: decimal('shipping_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  discountAmount: decimal('discount_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).default('0').notNull(),
  currency: varchar('currency', { length: 3 }).default('USD').notNull(),
  
  // Payment and terms
  paymentTerms: varchar('payment_terms', { length: 50 }).default('NET30'),
  paymentStatus: varchar('payment_status', { length: 50 }).default('pending').notNull(),
  // pending, paid, partial, overdue, cancelled
  
  // Addresses
  deliveryAddress: jsonb('delivery_address').default(sql`'{}'::jsonb`).notNull(),
  billingAddress: jsonb('billing_address').default(sql`'{}'::jsonb`).notNull(),
  
  // Workflow tracking
  createdBy: uuid('created_by'),
  approvedBy: uuid('approved_by'),
  approvedAt: timestamp('approved_at', { withTimezone: true }),
  sentAt: timestamp('sent_at', { withTimezone: true }),
  acknowledgedAt: timestamp('acknowledged_at', { withTimezone: true }),
  
  // Delivery tracking
  deliveredAt: timestamp('delivered_at', { withTimezone: true }),
  receivedBy: uuid('received_by'),
  
  // References
  priceListId: uuid('price_list_id').references(() => priceLists.id),
  customerOrderId: uuid('customer_order_id').references(() => purchaseOrders.id), // If PO is for specific customer order
  requisitionNumber: varchar('requisition_number', { length: 100 }),
  
  // Communication
  notes: text('notes'),
  internalNotes: text('internal_notes'),
  supplierNotes: text('supplier_notes'),
  
  // Integration tracking
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  supplierIdx: index('supplier_po_supplier_idx').on(table.supplierId),
  orderDateIdx: index('supplier_po_order_date_idx').on(table.orderDate),
  statusIdx: index('supplier_po_status_idx').on(table.status),
  approvalStatusIdx: index('supplier_po_approval_status_idx').on(table.approvalStatus),
  poNumberIdx: index('supplier_po_number_idx').on(table.poNumber),
  expectedDeliveryIdx: index('supplier_po_expected_delivery_idx').on(table.expectedDeliveryDate),
  createdAtIdx: index('supplier_po_created_at_idx').on(table.createdAt),
  supplierStatusIdx: index('supplier_po_supplier_status_idx').on(table.supplierId, table.status),
  priceListIdx: index('supplier_po_price_list_idx').on(table.priceListId),
}));

// Supplier Purchase Order Items
export const supplierPurchaseOrderItems = pgTable('supplier_purchase_order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  supplierPurchaseOrderId: uuid('supplier_purchase_order_id').notNull().references(() => supplierPurchaseOrders.id, { onDelete: 'cascade' }),
  
  // Product information
  productId: uuid('product_id').references(() => products.id),
  sku: varchar('sku', { length: 100 }).notNull(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  description: text('description'),
  
  // Quantities
  quantityOrdered: integer('quantity_ordered').notNull(),
  quantityReceived: integer('quantity_received').default(0).notNull(),
  quantityAccepted: integer('quantity_accepted').default(0).notNull(),
  quantityRejected: integer('quantity_rejected').default(0).notNull(),
  
  // Pricing
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
  discountPercent: decimal('discount_percent', { precision: 5, scale: 2 }).default('0'),
  discountAmount: decimal('discount_amount', { precision: 10, scale: 2 }).default('0'),
  lineTotal: decimal('line_total', { precision: 12, scale: 2 }).notNull(),
  taxRate: decimal('tax_rate', { precision: 5, scale: 2 }).default('0'),
  taxAmount: decimal('tax_amount', { precision: 10, scale: 2 }).default('0'),
  
  // Delivery details
  warehouseId: uuid('warehouse_id'),
  locationId: uuid('location_id'),
  requestedDeliveryDate: timestamp('requested_delivery_date', { withTimezone: true }),
  
  // Reference to price list item that generated this
  priceListItemId: uuid('price_list_item_id').references(() => priceListItems.id),
  
  // Status
  status: varchar('status', { length: 50 }).default('pending').notNull(),
  // pending, ordered, in_transit, received, partially_received, completed, cancelled
  
  // Quality control
  qcStatus: varchar('qc_status', { length: 50 }).default('pending'),
  // pending, passed, failed, not_required
  qcNotes: text('qc_notes'),
  
  notes: text('notes'),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  supplierPoIdx: index('supplier_po_items_order_idx').on(table.supplierPurchaseOrderId),
  productIdx: index('supplier_po_items_product_idx').on(table.productId),
  skuIdx: index('supplier_po_items_sku_idx').on(table.sku),
  statusIdx: index('supplier_po_items_status_idx').on(table.status),
  priceListItemIdx: index('supplier_po_items_price_list_item_idx').on(table.priceListItemId),
}));

// Purchase Order Receipts (receiving goods)
export const purchaseOrderReceipts = pgTable('purchase_order_receipts', {
  id: uuid('id').primaryKey().defaultRandom(),
  receiptNumber: varchar('receipt_number', { length: 100 }).unique().notNull(),
  supplierPurchaseOrderId: uuid('supplier_purchase_order_id').notNull().references(() => supplierPurchaseOrders.id),
  
  // Receipt details
  receivedDate: timestamp('received_date', { withTimezone: true }).defaultNow().notNull(),
  receivedBy: uuid('received_by').notNull(),
  warehouseId: uuid('warehouse_id').notNull(),
  
  // Status
  status: varchar('status', { length: 50 }).default('draft').notNull(),
  // draft, in_progress, completed, discrepancies, resolved
  
  // Shipping information
  carrierName: varchar('carrier_name', { length: 255 }),
  trackingNumber: varchar('tracking_number', { length: 100 }),
  packingSlipNumber: varchar('packing_slip_number', { length: 100 }),
  invoiceNumber: varchar('invoice_number', { length: 100 }),
  
  // Quality control
  qcRequired: boolean('qc_required').default(false).notNull(),
  qcStatus: varchar('qc_status', { length: 50 }).default('not_required'),
  qcCompletedAt: timestamp('qc_completed_at', { withTimezone: true }),
  qcCompletedBy: uuid('qc_completed_by'),
  
  // Discrepancies
  hasDiscrepancies: boolean('has_discrepancies').default(false).notNull(),
  discrepancyNotes: text('discrepancy_notes'),
  
  notes: text('notes'),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  supplierPoIdx: index('po_receipts_supplier_po_idx').on(table.supplierPurchaseOrderId),
  receivedDateIdx: index('po_receipts_received_date_idx').on(table.receivedDate),
  statusIdx: index('po_receipts_status_idx').on(table.status),
  warehouseIdx: index('po_receipts_warehouse_idx').on(table.warehouseId),
  receiptNumberIdx: index('po_receipts_number_idx').on(table.receiptNumber),
}));

// Purchase Order Receipt Items
export const purchaseOrderReceiptItems = pgTable('purchase_order_receipt_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  receiptId: uuid('receipt_id').notNull().references(() => purchaseOrderReceipts.id, { onDelete: 'cascade' }),
  supplierPurchaseOrderItemId: uuid('supplier_purchase_order_item_id').notNull().references(() => supplierPurchaseOrderItems.id),
  
  // Product information
  productId: uuid('product_id'),
  sku: varchar('sku', { length: 100 }).notNull(),
  
  // Quantities
  quantityOrdered: integer('quantity_ordered').notNull(),
  quantityReceived: integer('quantity_received').notNull(),
  quantityAccepted: integer('quantity_accepted').notNull(),
  quantityRejected: integer('quantity_rejected').default(0).notNull(),
  
  // Location
  warehouseId: uuid('warehouse_id').notNull(),
  locationId: uuid('location_id'),
  
  // Quality control
  qcStatus: varchar('qc_status', { length: 50 }).default('pending'),
  qcNotes: text('qc_notes'),
  
  // Batch/lot tracking
  batchNumber: varchar('batch_number', { length: 100 }),
  lotNumber: varchar('lot_number', { length: 100 }),
  serialNumbers: jsonb('serial_numbers').default(sql`'[]'::jsonb`),
  expiryDate: date('expiry_date'),
  manufacturingDate: date('manufacturing_date'),
  
  // Cost tracking
  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }),
  totalCost: decimal('total_cost', { precision: 12, scale: 2 }),
  
  // Discrepancy tracking
  discrepancyType: varchar('discrepancy_type', { length: 50 }),
  // quantity_short, quantity_over, damaged, wrong_item, quality_issue
  discrepancyNotes: text('discrepancy_notes'),
  
  notes: text('notes'),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  receiptIdx: index('po_receipt_items_receipt_idx').on(table.receiptId),
  supplierPoItemIdx: index('po_receipt_items_supplier_po_item_idx').on(table.supplierPurchaseOrderItemId),
  productIdx: index('po_receipt_items_product_idx').on(table.productId),
  skuIdx: index('po_receipt_items_sku_idx').on(table.sku),
  warehouseIdx: index('po_receipt_items_warehouse_idx').on(table.warehouseId),
}));

// ==================== ROLE-BASED ACCESS CONTROL ====================

// Permissions table
export const permissions = pgTable('permissions', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 100 }).unique().notNull(),
  description: text('description'),
  category: varchar('category', { length: 50 }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  nameIdx: index('permission_name_idx').on(table.name),
  categoryIdx: index('permission_category_idx').on(table.category),
}));

// Roles table
export const roles = pgTable('roles', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: varchar('name', { length: 50 }).unique().notNull(),
  description: text('description'),
  level: integer('level').notNull().default(0),
  isSystemRole: boolean('is_system_role').default(false).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  nameIdx: index('role_name_idx').on(table.name),
  levelIdx: index('role_level_idx').on(table.level),
}));

// RolePermissions junction table (many-to-many between roles and permissions)
export const rolePermissions = pgTable('role_permissions', {
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  permissionId: uuid('permission_id').notNull().references(() => permissions.id, { onDelete: 'cascade' }),
}, (table) => ({
  compoundKey: primaryKey({ columns: [table.roleId, table.permissionId] })
}));

// UserRoles junction table (many-to-many between users and roles)
export const userRoles = pgTable('user_roles', {
  userId: uuid('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  roleId: uuid('role_id').notNull().references(() => roles.id, { onDelete: 'cascade' }),
  assignedAt: timestamp('assigned_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  compoundKey: primaryKey({ columns: [table.userId, table.roleId] }),
  userIdx: index('user_roles_user_idx').on(table.userId),
  roleIdx: index('user_roles_role_idx').on(table.roleId),
}));

// ==================== TIME SERIES DATA ====================

// Generic time series metrics table
export const timeSeriesMetrics = pgTable('time_series_metrics', {
  id: uuid('id').primaryKey().defaultRandom(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  metricName: varchar('metric_name', { length: 100 }).notNull(),
  metricType: varchar('metric_type', { length: 50 }).notNull(), // counter, gauge, histogram
  
  // Dimensions
  dimension1: varchar('dimension1', { length: 100 }),
  dimension2: varchar('dimension2', { length: 100 }),
  dimension3: varchar('dimension3', { length: 100 }),
  
  // Values
  value: real('value').notNull(),
  count: integer('count').default(1),
  sum: real('sum'),
  min: real('min'),
  max: real('max'),
  
  // Tags and metadata
  tags: jsonb('tags').default(sql`'{}'::jsonb`),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  timestampMetricIdx: index('ts_metrics_timestamp_metric_idx').on(table.timestamp, table.metricName),
  metricNameIdx: index('ts_metrics_name_idx').on(table.metricName),
  dimension1Idx: index('ts_metrics_dim1_idx').on(table.dimension1),
  createdAtIdx: index('ts_metrics_created_idx').on(table.createdAt),
}));

// Event tracking for analytics
export const timeSeriesEvents = pgTable('time_series_events', {
  id: uuid('id').primaryKey().defaultRandom(),
  timestamp: timestamp('timestamp', { withTimezone: true }).notNull(),
  eventType: varchar('event_type', { length: 100 }).notNull(),
  eventCategory: varchar('event_category', { length: 50 }).notNull(),
  
  // Actor information
  userId: uuid('user_id'),
  sessionId: varchar('session_id', { length: 100 }),
  
  // Event details
  entityType: varchar('entity_type', { length: 50 }),
  entityId: uuid('entity_id'),
  action: varchar('action', { length: 100 }),
  
  // Additional data
  properties: jsonb('properties').default(sql`'{}'::jsonb`),
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  
  // Performance tracking
  duration: integer('duration'), // milliseconds
  resultStatus: varchar('result_status', { length: 50 }),
  
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  timestampEventIdx: index('ts_events_timestamp_event_idx').on(table.timestamp, table.eventType),
  eventTypeIdx: index('ts_events_type_idx').on(table.eventType),
  userIdx: index('ts_events_user_idx').on(table.userId),
  entityIdx: index('ts_events_entity_idx').on(table.entityType, table.entityId),
}));

// Hourly metrics rollup
export const timeSeriesHourlyMetrics = pgTable('time_series_hourly_metrics', {
  id: serial('id').primaryKey(),
  hourTimestamp: timestamp('hour_timestamp', { withTimezone: true }).notNull(),
  metricName: varchar('metric_name', { length: 100 }).notNull(),
  
  // Aggregated values
  avgValue: real('avg_value'),
  minValue: real('min_value'),
  maxValue: real('max_value'),
  sumValue: real('sum_value'),
  countValue: integer('count_value'),
  
  // Percentiles
  p50: real('p50'),
  p95: real('p95'),
  p99: real('p99'),
  
  // Dimensions
  dimension1: varchar('dimension1', { length: 100 }),
  dimension2: varchar('dimension2', { length: 100 }),
  
  metadata: jsonb('metadata').default(sql`'{}'::jsonb`),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
}, (table) => ({
  hourMetricDimIdx: index('ts_hourly_hour_metric_dim_idx').on(
    table.hourTimestamp, 
    table.metricName, 
    table.dimension1, 
    table.dimension2
  ),
}));
