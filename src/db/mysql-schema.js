import {
  mysqlTable,
  serial,
  text,
  timestamp,
  int,
  decimal,
  boolean,
  json,
  varchar,
  date,
  float,
  index,
  primaryKey,
  unique,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

// ==================== USER MANAGEMENT ====================

export const users = mysqlTable('users', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 255 }).notNull(),
  fullName: varchar('full_name', { length: 255 }),
  isActive: boolean('is_active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  emailIdx: index('user_email_idx').on(table.email),
}));

// ==================== CUSTOMER MANAGEMENT ====================

export const customers = mysqlTable('customers', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  customerCode: varchar('customer_code', { length: 50 }).unique().notNull(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  address: json('address').default({}),
  metadata: json('metadata').default({}),
  purchaseHistory: json('purchase_history').default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  customerCodeIdx: index('customer_code_idx').on(table.customerCode),
  emailIdx: index('customer_email_idx').on(table.email),
  companyNameIdx: index('customer_company_idx').on(table.companyName),
  createdAtIdx: index('customer_created_idx').on(table.createdAt),
}));

// ==================== SUPPLIER MANAGEMENT ====================

export const suppliers = mysqlTable('suppliers', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  supplierCode: varchar('supplier_code', { length: 50 }).unique().notNull(),
  companyName: varchar('company_name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull(),
  phone: varchar('phone', { length: 50 }),
  website: varchar('website', { length: 255 }),
  
  // Address information
  address: json('address').default({}),
  
  // Contact details
  contactDetails: json('contact_details').default({}),
  
  // Financial terms
  paymentTerms: json('payment_terms').default({}),
  creditLimit: decimal('credit_limit', { precision: 12, scale: 2 }),
  taxId: varchar('tax_id', { length: 50 }),
  
  // Business classification
  supplierType: varchar('supplier_type', { length: 50 }).default('vendor'),
  industry: varchar('industry', { length: 100 }),
  
  // Performance metrics
  performanceRating: decimal('performance_rating', { precision: 3, scale: 2 }).default('0'),
  leadTimeDays: int('lead_time_days').default(0),
  
  // Vendor-specific consolidated fields
  vendorMetadata: json('vendor_metadata').default({}),
  
  // Status and lifecycle
  isActive: boolean('is_active').default(true).notNull(),
  isApproved: boolean('is_approved').default(false).notNull(),
  approvedAt: timestamp('approved_at'),
  approvedBy: varchar('approved_by', { length: 36 }),
  
  // Audit trail
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  supplierCodeIdx: index('supplier_code_idx').on(table.supplierCode),
  companyNameIdx: index('supplier_company_idx').on(table.companyName),
  emailIdx: index('supplier_email_idx').on(table.email),
  isActiveIdx: index('supplier_active_idx').on(table.isActive),
  supplierTypeIdx: index('supplier_type_idx').on(table.supplierType),
  performanceIdx: index('supplier_performance_idx').on(table.performanceRating),
}));

// ==================== PRODUCT MANAGEMENT ====================

export const products = mysqlTable('products', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  sku: varchar('sku', { length: 100 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  description: text('description'),
  category: varchar('category', { length: 100 }),
  subcategory: varchar('subcategory', { length: 100 }),
  brand: varchar('brand', { length: 100 }),
  
  // Pricing
  basePrice: decimal('base_price', { precision: 10, scale: 2 }),
  sellingPrice: decimal('selling_price', { precision: 10, scale: 2 }),
  costPrice: decimal('cost_price', { precision: 10, scale: 2 }),
  
  // Physical properties
  weight: decimal('weight', { precision: 8, scale: 3 }),
  dimensions: json('dimensions').default({}),
  
  // Inventory
  stockQuantity: int('stock_quantity').default(0),
  reorderLevel: int('reorder_level').default(0),
  maxStockLevel: int('max_stock_level'),
  
  // Supplier relationship
  primarySupplierId: varchar('primary_supplier_id', { length: 36 }),
  supplierProductCode: varchar('supplier_product_code', { length: 100 }),
  
  // Product attributes
  attributes: json('attributes').default({}),
  specifications: json('specifications').default({}),
  
  // Status
  isActive: boolean('is_active').default(true).notNull(),
  isDiscontinued: boolean('is_discontinued').default(false).notNull(),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  skuIdx: index('product_sku_idx').on(table.sku),
  nameIdx: index('product_name_idx').on(table.name),
  categoryIdx: index('product_category_idx').on(table.category),
  supplierIdx: index('product_supplier_idx').on(table.primarySupplierId),
  isActiveIdx: index('product_active_idx').on(table.isActive),
  stockIdx: index('product_stock_idx').on(table.stockQuantity),
}));

// ==================== ORDER MANAGEMENT ====================

export const orders = mysqlTable('orders', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderNumber: varchar('order_number', { length: 50 }).unique().notNull(),
  customerId: varchar('customer_id', { length: 36 }).notNull(),
  
  // Order details
  orderDate: timestamp('order_date').defaultNow().notNull(),
  requiredDate: timestamp('required_date'),
  shippedDate: timestamp('shipped_date'),
  
  // Financial
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).default('0'),
  shippingAmount: decimal('shipping_amount', { precision: 12, scale: 2 }).default('0'),
  discountAmount: decimal('discount_amount', { precision: 12, scale: 2 }).default('0'),
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(),
  
  // Status
  status: varchar('status', { length: 50 }).default('pending').notNull(), // pending, confirmed, processing, shipped, delivered, cancelled
  paymentStatus: varchar('payment_status', { length: 50 }).default('pending').notNull(),
  
  // Shipping
  shippingAddress: json('shipping_address').default({}),
  billingAddress: json('billing_address').default({}),
  shippingMethod: varchar('shipping_method', { length: 100 }),
  trackingNumber: varchar('tracking_number', { length: 100 }),
  
  // Additional info
  notes: text('notes'),
  metadata: json('metadata').default({}),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  orderNumberIdx: index('order_number_idx').on(table.orderNumber),
  customerIdx: index('order_customer_idx').on(table.customerId),
  statusIdx: index('order_status_idx').on(table.status),
  orderDateIdx: index('order_date_idx').on(table.orderDate),
  paymentStatusIdx: index('order_payment_status_idx').on(table.paymentStatus),
}));

// ==================== ORDER ITEMS ====================

export const orderItems = mysqlTable('order_items', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  orderId: varchar('order_id', { length: 36 }).notNull(),
  productId: varchar('product_id', { length: 36 }).notNull(),
  
  // Product details at time of order
  productSku: varchar('product_sku', { length: 100 }).notNull(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  
  // Quantity and pricing
  quantity: int('quantity').notNull(),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal('total_price', { precision: 12, scale: 2 }).notNull(),
  
  // Discount
  discountPercent: decimal('discount_percent', { precision: 5, scale: 2 }).default('0'),
  discountAmount: decimal('discount_amount', { precision: 10, scale: 2 }).default('0'),
  
  // Additional info
  notes: text('notes'),
  metadata: json('metadata').default({}),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  orderIdx: index('order_item_order_idx').on(table.orderId),
  productIdx: index('order_item_product_idx').on(table.productId),
  skuIdx: index('order_item_sku_idx').on(table.productSku),
}));

// ==================== PURCHASE ORDERS ====================

export const purchaseOrders = mysqlTable('purchase_orders', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  poNumber: varchar('po_number', { length: 50 }).unique().notNull(),
  supplierId: varchar('supplier_id', { length: 36 }).notNull(),
  
  // Order details
  orderDate: timestamp('order_date').defaultNow().notNull(),
  expectedDate: timestamp('expected_date'),
  receivedDate: timestamp('received_date'),
  
  // Financial
  subtotal: decimal('subtotal', { precision: 12, scale: 2 }).notNull(),
  taxAmount: decimal('tax_amount', { precision: 12, scale: 2 }).default('0'),
  shippingAmount: decimal('shipping_amount', { precision: 12, scale: 2 }).default('0'),
  totalAmount: decimal('total_amount', { precision: 12, scale: 2 }).notNull(),
  
  // Status
  status: varchar('status', { length: 50 }).default('draft').notNull(), // draft, sent, confirmed, received, cancelled
  
  // Additional info
  notes: text('notes'),
  metadata: json('metadata').default({}),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  poNumberIdx: index('po_number_idx').on(table.poNumber),
  supplierIdx: index('po_supplier_idx').on(table.supplierId),
  statusIdx: index('po_status_idx').on(table.status),
  orderDateIdx: index('po_order_date_idx').on(table.orderDate),
}));

// ==================== PURCHASE ORDER ITEMS ====================

export const purchaseOrderItems = mysqlTable('purchase_order_items', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  purchaseOrderId: varchar('purchase_order_id', { length: 36 }).notNull(),
  productId: varchar('product_id', { length: 36 }).notNull(),
  
  // Product details
  productSku: varchar('product_sku', { length: 100 }).notNull(),
  productName: varchar('product_name', { length: 255 }).notNull(),
  
  // Quantity and pricing
  quantity: int('quantity').notNull(),
  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }).notNull(),
  totalCost: decimal('total_cost', { precision: 12, scale: 2 }).notNull(),
  
  // Receiving info
  receivedQuantity: int('received_quantity').default(0),
  receivedDate: timestamp('received_date'),
  
  // Additional info
  notes: text('notes'),
  metadata: json('metadata').default({}),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  poIdx: index('po_item_po_idx').on(table.purchaseOrderId),
  productIdx: index('po_item_product_idx').on(table.productId),
  skuIdx: index('po_item_sku_idx').on(table.productSku),
}));

// ==================== INVENTORY TRACKING ====================

export const inventory = mysqlTable('inventory', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  productId: varchar('product_id', { length: 36 }).notNull(),
  warehouseId: varchar('warehouse_id', { length: 36 }),
  locationCode: varchar('location_code', { length: 50 }),
  
  // Quantity tracking
  quantityOnHand: int('quantity_on_hand').notNull().default(0),
  quantityReserved: int('quantity_reserved').notNull().default(0),
  quantityAvailable: int('quantity_available').notNull().default(0),
  
  // Cost tracking
  averageCost: decimal('average_cost', { precision: 10, scale: 2 }),
  lastCost: decimal('last_cost', { precision: 10, scale: 2 }),
  
  // Thresholds
  reorderPoint: int('reorder_point').default(0),
  maxLevel: int('max_level'),
  
  // Last inventory update
  lastCountDate: timestamp('last_count_date'),
  lastMovementDate: timestamp('last_movement_date'),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  productIdx: index('inventory_product_idx').on(table.productId),
  warehouseIdx: index('inventory_warehouse_idx').on(table.warehouseId),
  locationIdx: index('inventory_location_idx').on(table.locationCode),
  qtyIdx: index('inventory_qty_idx').on(table.quantityOnHand),
}));

// ==================== INVENTORY MOVEMENTS ====================

export const inventoryMovements = mysqlTable('inventory_movements', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  productId: varchar('product_id', { length: 36 }).notNull(),
  movementType: varchar('movement_type', { length: 50 }).notNull(), // IN, OUT, ADJUSTMENT, TRANSFER
  
  // Movement details
  quantity: int('quantity').notNull(),
  unitCost: decimal('unit_cost', { precision: 10, scale: 2 }),
  totalCost: decimal('total_cost', { precision: 12, scale: 2 }),
  
  // Reference information
  referenceType: varchar('reference_type', { length: 50 }), // ORDER, PURCHASE_ORDER, ADJUSTMENT, etc.
  referenceId: varchar('reference_id', { length: 36 }),
  referenceNumber: varchar('reference_number', { length: 100 }),
  
  // Location
  warehouseId: varchar('warehouse_id', { length: 36 }),
  locationCode: varchar('location_code', { length: 50 }),
  
  // Additional info
  reason: varchar('reason', { length: 255 }),
  notes: text('notes'),
  metadata: json('metadata').default({}),
  
  // Timestamps
  movementDate: timestamp('movement_date').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (table) => ({
  productIdx: index('movement_product_idx').on(table.productId),
  typeIdx: index('movement_type_idx').on(table.movementType),
  dateIdx: index('movement_date_idx').on(table.movementDate),
  referenceIdx: index('movement_reference_idx').on(table.referenceId),
}));

// ==================== WAREHOUSES ====================

export const warehouses = mysqlTable('warehouses', {
  id: varchar('id', { length: 36 }).primaryKey().$defaultFn(() => crypto.randomUUID()),
  code: varchar('code', { length: 50 }).unique().notNull(),
  name: varchar('name', { length: 255 }).notNull(),
  
  // Address
  address: json('address').default({}),
  
  // Contact
  contactDetails: json('contact_details').default({}),
  
  // Warehouse properties
  totalCapacity: int('total_capacity'),
  usedCapacity: int('used_capacity').default(0),
  
  // Status
  isActive: boolean('is_active').default(true).notNull(),
  
  // Additional info
  notes: text('notes'),
  metadata: json('metadata').default({}),
  
  // Timestamps
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().onUpdateNow().notNull(),
}, (table) => ({
  codeIdx: index('warehouse_code_idx').on(table.code),
  nameIdx: index('warehouse_name_idx').on(table.name),
  isActiveIdx: index('warehouse_active_idx').on(table.isActive),
}));

// Export all tables for use in services
export const allTables = {
  users,
  customers,
  suppliers,
  products,
  orders,
  orderItems,
  purchaseOrders,
  purchaseOrderItems,
  inventory,
  inventoryMovements,
  warehouses,
};

export default allTables;