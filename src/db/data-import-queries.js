import { db } from './db.js';
import { sql, eq, and, or } from 'drizzle-orm';
import { customers, suppliers, products, inventory, purchaseOrders, purchaseOrderItems } from './schema.js';

/**
 * Data Import Queries for NXT Database
 * 
 * This module provides bulk import operations for migrating data from
 * external systems (WooCommerce, Odoo, MySQL) to NXT PostgreSQL.
 */

// ==================== BATCH IMPORT UTILITIES ====================

/**
 * Generic batch insert with conflict resolution
 * @param {Object} table - Drizzle table schema
 * @param {Array} data - Array of records to insert
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Import results
 */
export async function batchInsertWithConflictResolution(table, data, options = {}) {
  const { batchSize = 100, onConflict = 'skip', conflictColumns = [] } = options;
  
  const results = {
    total: data.length,
    inserted: 0,
    updated: 0,
    skipped: 0,
    failed: 0,
    errors: []
  };

  try {
    // Process in batches
    for (let i = 0; i < data.length; i += batchSize) {
      const batch = data.slice(i, i + batchSize);
      
      try {
        if (onConflict === 'skip') {
          // Insert with ON CONFLICT DO NOTHING
          const inserted = await db
            .insert(table)
            .values(batch)
            .onConflictDoNothing()
            .returning({ id: table.id });
          
          results.inserted += inserted.length;
          results.skipped += batch.length - inserted.length;
        } else if (onConflict === 'update') {
          // Insert with ON CONFLICT DO UPDATE
          for (const record of batch) {
            try {
              const existing = await checkRecordExists(table, record, conflictColumns);
              if (existing) {
                await db
                  .update(table)
                  .set({ ...record, updatedAt: new Date() })
                  .where(eq(table.id, existing.id));
                results.updated++;
              } else {
                await db.insert(table).values(record);
                results.inserted++;
              }
            } catch (error) {
              results.failed++;
              results.errors.push({
                record: record,
                error: error.message
              });
            }
          }
        }
      } catch (batchError) {
        results.failed += batch.length;
        results.errors.push({
          batch: i / batchSize + 1,
          error: batchError.message
        });
      }
    }

    return results;
  } catch (error) {
    console.error('Batch insert error:', error);
    return {
      ...results,
      success: false,
      error: error.message
    };
  }
}

/**
 * Check if record exists based on conflict columns
 * @param {Object} table - Drizzle table schema
 * @param {Object} record - Record to check
 * @param {Array} conflictColumns - Columns to check for conflicts
 * @returns {Promise<Object|null>} Existing record or null
 */
async function checkRecordExists(table, record, conflictColumns) {
  if (!conflictColumns.length) return null;

  try {
    const conditions = conflictColumns.map(col => eq(table[col], record[col]));
    const existing = await db
      .select()
      .from(table)
      .where(and(...conditions))
      .limit(1);

    return existing[0] || null;
  } catch (error) {
    console.error('Error checking record existence:', error);
    return null;
  }
}

// ==================== CUSTOMER IMPORT ====================

/**
 * Import customers from CSV/JSON data
 * @param {Array} customersData - Array of customer records
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Import results
 */
export async function importCustomers(customersData, options = {}) {
  const { source = 'manual', validateEmails = true } = options;
  
  // Transform and validate data
  const processedCustomers = customersData.map(customer => {
    // Validate required fields
    if (!customer.email && validateEmails) {
      throw new Error(`Customer missing email: ${JSON.stringify(customer)}`);
    }

    return {
      customerCode: customer.customerCode || customer.code || `IMP-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      companyName: customer.companyName || customer.company || `${customer.firstName || ''} ${customer.lastName || ''}`.trim() || 'Unknown',
      email: customer.email,
      phone: customer.phone,
      address: {
        street: customer.address || customer.street,
        city: customer.city,
        state: customer.state,
        zip: customer.zip || customer.zipCode || customer.postalCode,
        country: customer.country,
        import_source: source
      },
      metadata: {
        import_source: source,
        import_date: new Date(),
        original_data: customer,
        first_name: customer.firstName || customer.first_name,
        last_name: customer.lastName || customer.last_name
      },
      purchaseHistory: []
    };
  }).filter(customer => customer !== null);

  return await batchInsertWithConflictResolution(
    customers, 
    processedCustomers, 
    {
      ...options,
      conflictColumns: ['email']
    }
  );
}

// ==================== SUPPLIER IMPORT ====================

/**
 * Import suppliers from external data
 * @param {Array} suppliersData - Array of supplier records
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Import results
 */
export async function importSuppliers(suppliersData, options = {}) {
  const { source = 'manual' } = options;
  
  const processedSuppliers = suppliersData.map(supplier => ({
    supplierCode: supplier.supplierCode || supplier.code || `IMP-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
    companyName: supplier.companyName || supplier.name || supplier.company,
    email: supplier.email,
    phone: supplier.phone,
    website: supplier.website,
    address: {
      street: supplier.address || supplier.street,
      city: supplier.city,
      state: supplier.state,
      zip: supplier.zip || supplier.zipCode,
      country: supplier.country,
      import_source: source
    },
    contactDetails: {
      primary_contact: supplier.contactPerson || supplier.contact,
      phone: supplier.phone,
      email: supplier.email,
      import_source: source
    },
    paymentTerms: supplier.paymentTerms || {},
    supplierType: supplier.type || supplier.supplierType || 'vendor',
    industry: supplier.industry,
    vendorMetadata: {
      import_source: source,
      import_date: new Date(),
      original_data: supplier
    }
  }));

  return await batchInsertWithConflictResolution(
    suppliers, 
    processedSuppliers, 
    {
      ...options,
      conflictColumns: ['supplierCode']
    }
  );
}

// ==================== PRODUCT IMPORT ====================

/**
 * Import products from external data
 * @param {Array} productsData - Array of product records
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Import results
 */
export async function importProducts(productsData, options = {}) {
  const { source = 'manual', createMissingSku = true } = options;
  
  const processedProducts = productsData.map(product => {
    let sku = product.sku || product.code;
    
    if (!sku && createMissingSku) {
      sku = `IMP-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`;
    }
    
    if (!sku) {
      throw new Error(`Product missing SKU: ${JSON.stringify(product)}`);
    }

    return {
      externalId: product.id || product.externalId,
      sku: sku,
      name: product.name || product.title,
      description: product.description,
      category: product.category || product.categories,
      unitPrice: parseFloat(product.price || product.unitPrice) || 0,
      costPrice: parseFloat(product.costPrice || product.cost) || 0,
      metadata: {
        import_source: source,
        import_date: new Date(),
        original_data: product,
        stock_quantity: product.stockQuantity || product.stock,
        stock_status: product.stockStatus
      }
    };
  });

  return await batchInsertWithConflictResolution(
    products, 
    processedProducts, 
    {
      ...options,
      conflictColumns: ['sku']
    }
  );
}

// ==================== INVENTORY IMPORT ====================

/**
 * Import inventory data
 * @param {Array} inventoryData - Array of inventory records
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Import results
 */
export async function importInventory(inventoryData, options = {}) {
  const { defaultWarehouseId, source = 'manual' } = options;
  
  const processedInventory = [];
  
  for (const item of inventoryData) {
    // Find product by SKU or external ID
    let product = null;
    
    if (item.sku) {
      const productBySku = await db
        .select()
        .from(products)
        .where(eq(products.sku, item.sku))
        .limit(1);
      product = productBySku[0];
    }
    
    if (!product && item.productId) {
      const productById = await db
        .select()
        .from(products)
        .where(eq(products.id, item.productId))
        .limit(1);
      product = productById[0];
    }
    
    if (!product) {
      console.warn(`Product not found for inventory item: ${JSON.stringify(item)}`);
      continue;
    }

    processedInventory.push({
      productId: product.id,
      warehouseId: item.warehouseId || defaultWarehouseId,
      locationId: item.locationId,
      quantityOnHand: parseInt(item.quantity || item.quantityOnHand) || 0,
      quantityAvailable: parseInt(item.quantityAvailable || item.quantity) || 0,
      quantityReserved: parseInt(item.quantityReserved) || 0,
      reorderPoint: parseInt(item.reorderPoint) || 0,
      reorderQuantity: parseInt(item.reorderQuantity) || 0,
      averageCost: parseFloat(item.cost || item.averageCost) || null,
      metadata: {
        import_source: source,
        import_date: new Date(),
        original_data: item
      }
    });
  }

  return await batchInsertWithConflictResolution(
    inventory, 
    processedInventory, 
    {
      ...options,
      conflictColumns: ['productId', 'warehouseId']
    }
  );
}

// ==================== ORDER IMPORT ====================

/**
 * Import purchase orders from external data
 * @param {Array} ordersData - Array of order records
 * @param {Object} options - Import options
 * @returns {Promise<Object>} Import results
 */
export async function importPurchaseOrders(ordersData, options = {}) {
  const { source = 'manual' } = options;
  
  const results = {
    orders: { created: 0, updated: 0, failed: 0, errors: [] },
    items: { created: 0, updated: 0, failed: 0, errors: [] }
  };

  for (const orderData of ordersData) {
    try {
      // Find or create supplier
      let supplier = null;
      if (orderData.supplierId) {
        const supplierRecord = await db
          .select()
          .from(suppliers)
          .where(eq(suppliers.id, orderData.supplierId))
          .limit(1);
        supplier = supplierRecord[0];
      } else if (orderData.supplierCode) {
        const supplierRecord = await db
          .select()
          .from(suppliers)
          .where(eq(suppliers.supplierCode, orderData.supplierCode))
          .limit(1);
        supplier = supplierRecord[0];
      }

      if (!supplier) {
        results.orders.failed++;
        results.orders.errors.push({
          order: orderData.orderNumber,
          error: 'Supplier not found'
        });
        continue;
      }

      // Create purchase order
      const orderRecord = {
        orderNumber: orderData.orderNumber || `IMP-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
        supplierId: supplier.id,
        customerId: orderData.customerId,
        status: orderData.status || 'draft',
        orderDate: new Date(orderData.orderDate) || new Date(),
        expectedDeliveryDate: orderData.expectedDeliveryDate ? new Date(orderData.expectedDeliveryDate) : null,
        subtotal: parseFloat(orderData.subtotal) || 0,
        taxAmount: parseFloat(orderData.taxAmount) || 0,
        shippingCost: parseFloat(orderData.shippingCost) || 0,
        totalAmount: parseFloat(orderData.totalAmount) || 0,
        metadata: {
          import_source: source,
          import_date: new Date(),
          original_data: orderData
        }
      };

      const [createdOrder] = await db
        .insert(purchaseOrders)
        .values(orderRecord)
        .returning();

      results.orders.created++;

      // Import order items
      if (orderData.items && Array.isArray(orderData.items)) {
        for (const itemData of orderData.items) {
          try {
            // Find product
            let product = null;
            if (itemData.sku) {
              const productRecord = await db
                .select()
                .from(products)
                .where(eq(products.sku, itemData.sku))
                .limit(1);
              product = productRecord[0];
            }

            if (!product) {
              results.items.failed++;
              results.items.errors.push({
                order: orderData.orderNumber,
                sku: itemData.sku,
                error: 'Product not found'
              });
              continue;
            }

            const itemRecord = {
              purchaseOrderId: createdOrder.id,
              productId: product.id,
              quantity: parseInt(itemData.quantity) || 0,
              unitPrice: parseFloat(itemData.unitPrice) || 0,
              lineTotal: parseFloat(itemData.lineTotal) || (itemData.quantity * itemData.unitPrice),
              productSku: product.sku,
              productName: product.name,
              productDescription: itemData.description || product.description
            };

            await db.insert(purchaseOrderItems).values(itemRecord);
            results.items.created++;

          } catch (itemError) {
            results.items.failed++;
            results.items.errors.push({
              order: orderData.orderNumber,
              error: itemError.message
            });
          }
        }
      }

    } catch (orderError) {
      results.orders.failed++;
      results.orders.errors.push({
        order: orderData.orderNumber,
        error: orderError.message
      });
    }
  }

  return results;
}

// ==================== DATA VALIDATION ====================

/**
 * Validate imported data integrity
 * @param {string} tableName - Table to validate
 * @returns {Promise<Object>} Validation results
 */
export async function validateImportedData(tableName) {
  const results = {
    table: tableName,
    totalRecords: 0,
    issues: [],
    recommendations: []
  };

  try {
    switch (tableName) {
      case 'customers':
        const customerIssues = await db.execute(sql`
          SELECT 
            COUNT(*) as total_customers,
            COUNT(CASE WHEN email IS NULL OR email = '' THEN 1 END) as missing_emails,
            COUNT(CASE WHEN company_name IS NULL OR company_name = '' THEN 1 END) as missing_company_names,
            COUNT(CASE WHEN customer_code IS NULL OR customer_code = '' THEN 1 END) as missing_codes
          FROM customers
        `);
        
        results.totalRecords = customerIssues[0].total_customers;
        if (customerIssues[0].missing_emails > 0) {
          results.issues.push(`${customerIssues[0].missing_emails} customers missing email addresses`);
        }
        break;

      case 'products':
        const productIssues = await db.execute(sql`
          SELECT 
            COUNT(*) as total_products,
            COUNT(CASE WHEN sku IS NULL OR sku = '' THEN 1 END) as missing_skus,
            COUNT(CASE WHEN name IS NULL OR name = '' THEN 1 END) as missing_names,
            COUNT(CASE WHEN unit_price IS NULL OR unit_price = 0 THEN 1 END) as zero_prices
          FROM products
        `);
        
        results.totalRecords = productIssues[0].total_products;
        if (productIssues[0].missing_skus > 0) {
          results.issues.push(`${productIssues[0].missing_skus} products missing SKUs`);
        }
        if (productIssues[0].zero_prices > 0) {
          results.recommendations.push(`${productIssues[0].zero_prices} products have zero prices`);
        }
        break;

      default:
        results.issues.push(`Validation not implemented for table: ${tableName}`);
    }

    return results;
  } catch (error) {
    console.error('Data validation error:', error);
    return {
      ...results,
      error: error.message
    };
  }
}

// ==================== IMPORT SUMMARY ====================

/**
 * Get import summary and statistics
 * @returns {Promise<Object>} Import statistics
 */
export async function getImportSummary() {
  try {
    const summary = {};

    // Count records by import source
    const customerStats = await db.execute(sql`
      SELECT 
        metadata->>'import_source' as source,
        COUNT(*) as count
      FROM customers 
      WHERE metadata ? 'import_source'
      GROUP BY metadata->>'import_source'
    `);

    const supplierStats = await db.execute(sql`
      SELECT 
        vendor_metadata->>'import_source' as source,
        COUNT(*) as count
      FROM suppliers 
      WHERE vendor_metadata ? 'import_source'
      GROUP BY vendor_metadata->>'import_source'
    `);

    const productStats = await db.execute(sql`
      SELECT 
        metadata->>'import_source' as source,
        COUNT(*) as count
      FROM products 
      WHERE metadata ? 'import_source'
      GROUP BY metadata->>'import_source'
    `);

    summary.customers = customerStats;
    summary.suppliers = supplierStats;
    summary.products = productStats;
    summary.generated_at = new Date();

    return summary;
  } catch (error) {
    console.error('Error generating import summary:', error);
    return { error: error.message };
  }
}