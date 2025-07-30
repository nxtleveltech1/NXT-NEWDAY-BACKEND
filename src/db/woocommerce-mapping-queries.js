import { db } from './db.js';
import { sql, eq } from 'drizzle-orm';
import { customers, suppliers, products, inventory } from './schema.js';

/**
 * WooCommerce to NXT Database Mapping Queries
 * 
 * This module provides functions to map WooCommerce/MySQL data structures
 * to NXT PostgreSQL schema with external ID tracking for synchronization.
 */

// ==================== CUSTOMER MAPPING ====================

/**
 * Create or update customer from WooCommerce data
 * @param {Object} wooCustomer - WooCommerce customer object
 * @returns {Promise<Object>} Mapped customer record
 */
export async function createCustomerFromWooCommerce(wooCustomer) {
  try {
    const customerData = {
      customerCode: `WOO-${wooCustomer.id}`,
      companyName: `${wooCustomer.first_name} ${wooCustomer.last_name}`.trim() || 'Individual Customer',
      email: wooCustomer.email,
      phone: wooCustomer.billing?.phone || null,
      address: {
        billing: wooCustomer.billing || {},
        shipping: wooCustomer.shipping || {},
        woocommerce_id: wooCustomer.id
      },
      metadata: {
        woocommerce_id: wooCustomer.id,
        username: wooCustomer.username,
        is_paying_customer: wooCustomer.is_paying_customer,
        avatar_url: wooCustomer.avatar_url,
        role: wooCustomer.role,
        date_created_woo: wooCustomer.date_created,
        date_modified_woo: wooCustomer.date_modified,
        meta_data: wooCustomer.meta_data || [],
        original_data: wooCustomer
      },
      purchaseHistory: []
    };

    // Check if customer already exists by WooCommerce ID
    const existingCustomer = await db
      .select()
      .from(customers)
      .where(sql`metadata->>'woocommerce_id' = ${wooCustomer.id.toString()}`)
      .limit(1);

    if (existingCustomer.length > 0) {
      // Update existing customer
      const [updated] = await db
        .update(customers)
        .set({
          ...customerData,
          updatedAt: new Date()
        })
        .where(eq(customers.id, existingCustomer[0].id))
        .returning();
      
      return { success: true, action: 'updated', customer: updated };
    } else {
      // Create new customer
      const [created] = await db
        .insert(customers)
        .values(customerData)
        .returning();
      
      return { success: true, action: 'created', customer: created };
    }
  } catch (error) {
    console.error('Error creating/updating customer from WooCommerce:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Bulk import customers from WooCommerce
 * @param {Array} wooCustomers - Array of WooCommerce customer objects
 * @returns {Promise<Object>} Import results
 */
export async function bulkImportWooCommerceCustomers(wooCustomers) {
  const results = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: []
  };

  for (const wooCustomer of wooCustomers) {
    try {
      const result = await createCustomerFromWooCommerce(wooCustomer);
      if (result.success) {
        if (result.action === 'created') {
          results.created++;
        } else {
          results.updated++;
        }
      } else {
        results.failed++;
        results.errors.push({
          woo_id: wooCustomer.id,
          error: result.error
        });
      }
    } catch (error) {
      results.failed++;
      results.errors.push({
        woo_id: wooCustomer.id,
        error: error.message
      });
    }
  }

  return results;
}

// ==================== SUPPLIER MAPPING ====================

/**
 * Create supplier from WooCommerce/Odoo data
 * @param {Object} supplierData - External supplier data
 * @returns {Promise<Object>} Mapped supplier record
 */
export async function createSupplierFromExternal(supplierData) {
  try {
    const supplierRecord = {
      supplierCode: supplierData.code || `EXT-${supplierData.id}`,
      companyName: supplierData.name || supplierData.company_name,
      email: supplierData.email,
      phone: supplierData.phone,
      website: supplierData.website,
      address: {
        street: supplierData.street,
        city: supplierData.city,
        state: supplierData.state,
        zip: supplierData.zip,
        country: supplierData.country,
        external_id: supplierData.id
      },
      contactDetails: {
        primary_contact: supplierData.contact_person,
        phone: supplierData.phone,
        email: supplierData.email,
        external_source: supplierData.source || 'woocommerce'
      },
      paymentTerms: supplierData.payment_terms || {},
      supplierType: supplierData.type || 'vendor',
      industry: supplierData.industry,
      vendorMetadata: {
        external_id: supplierData.id,
        external_source: supplierData.source || 'woocommerce',
        original_data: supplierData
      }
    };

    // Check if supplier exists by external ID
    const existingSupplier = await db
      .select()
      .from(suppliers)
      .where(sql`vendor_metadata->>'external_id' = ${supplierData.id.toString()}`)
      .limit(1);

    if (existingSupplier.length > 0) {
      const [updated] = await db
        .update(suppliers)
        .set({
          ...supplierRecord,
          updatedAt: new Date()
        })
        .where(eq(suppliers.id, existingSupplier[0].id))
        .returning();
      
      return { success: true, action: 'updated', supplier: updated };
    } else {
      const [created] = await db
        .insert(suppliers)
        .values(supplierRecord)
        .returning();
      
      return { success: true, action: 'created', supplier: created };
    }
  } catch (error) {
    console.error('Error creating/updating supplier from external data:', error);
    return { success: false, error: error.message };
  }
}

// ==================== PRODUCT MAPPING ====================

/**
 * Create or update product from WooCommerce data
 * @param {Object} wooProduct - WooCommerce product object
 * @returns {Promise<Object>} Mapped product record
 */
export async function createProductFromWooCommerce(wooProduct) {
  try {
    const productData = {
      externalId: wooProduct.id,
      sku: wooProduct.sku || `WOO-${wooProduct.id}`,
      name: wooProduct.name,
      description: wooProduct.description || null,
      category: wooProduct.categories || null,
      unitPrice: parseFloat(wooProduct.price) || 0,
      costPrice: parseFloat(wooProduct.regular_price) || 0,
      metadata: {
        woocommerce_id: wooProduct.id,
        slug: wooProduct.slug,
        permalink: wooProduct.permalink,
        stock_status: wooProduct.stock_status,
        stock_quantity: wooProduct.stock_quantity,
        date_created_woo: wooProduct.date_created,
        date_modified_woo: wooProduct.date_modified,
        original_data: wooProduct
      }
    };

    // Check if product exists by external ID
    const existingProduct = await db
      .select()
      .from(products)
      .where(eq(products.externalId, wooProduct.id))
      .limit(1);

    if (existingProduct.length > 0) {
      const [updated] = await db
        .update(products)
        .set({
          ...productData,
          updatedAt: new Date()
        })
        .where(eq(products.id, existingProduct[0].id))
        .returning();
      
      return { success: true, action: 'updated', product: updated };
    } else {
      const [created] = await db
        .insert(products)
        .values(productData)
        .returning();
      
      return { success: true, action: 'created', product: created };
    }
  } catch (error) {
    console.error('Error creating/updating product from WooCommerce:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Bulk import products from WooCommerce
 * @param {Array} wooProducts - Array of WooCommerce product objects
 * @returns {Promise<Object>} Import results
 */
export async function bulkImportWooCommerceProducts(wooProducts) {
  const results = {
    created: 0,
    updated: 0,
    failed: 0,
    errors: []
  };

  for (const wooProduct of wooProducts) {
    try {
      const result = await createProductFromWooCommerce(wooProduct);
      if (result.success) {
        if (result.action === 'created') {
          results.created++;
        } else {
          results.updated++;
        }
      } else {
        results.failed++;
        results.errors.push({
          woo_id: wooProduct.id,
          error: result.error
        });
      }
    } catch (error) {
      results.failed++;
      results.errors.push({
        woo_id: wooProduct.id,
        error: error.message
      });
    }
  }

  return results;
}

// ==================== MAPPING UTILITY FUNCTIONS ====================

/**
 * Get customer by WooCommerce ID
 * @param {number} wooCommerceId - WooCommerce customer ID
 * @returns {Promise<Object|null>} Customer record or null
 */
export async function getCustomerByWooCommerceId(wooCommerceId) {
  try {
    const customer = await db
      .select()
      .from(customers)
      .where(sql`metadata->>'woocommerce_id' = ${wooCommerceId.toString()}`)
      .limit(1);
    
    return customer[0] || null;
  } catch (error) {
    console.error('Error getting customer by WooCommerce ID:', error);
    return null;
  }
}

/**
 * Get product by WooCommerce ID
 * @param {number} wooCommerceId - WooCommerce product ID
 * @returns {Promise<Object|null>} Product record or null
 */
export async function getProductByWooCommerceId(wooCommerceId) {
  try {
    const product = await db
      .select()
      .from(products)
      .where(eq(products.externalId, wooCommerceId))
      .limit(1);
    
    return product[0] || null;
  } catch (error) {
    console.error('Error getting product by WooCommerce ID:', error);
    return null;
  }
}

/**
 * Sync inventory levels from WooCommerce
 * @param {number} wooCommerceId - WooCommerce product ID
 * @param {number} stockQuantity - Stock quantity from WooCommerce
 * @param {string} warehouseId - Target warehouse ID
 * @returns {Promise<Object>} Sync result
 */
export async function syncInventoryFromWooCommerce(wooCommerceId, stockQuantity, warehouseId) {
  try {
    const product = await getProductByWooCommerceId(wooCommerceId);
    if (!product) {
      return { success: false, error: 'Product not found' };
    }

    // Update or create inventory record
    const existingInventory = await db
      .select()
      .from(inventory)
      .where(eq(inventory.productId, product.id))
      .where(eq(inventory.warehouseId, warehouseId))
      .limit(1);

    const inventoryData = {
      productId: product.id,
      warehouseId: warehouseId,
      quantityOnHand: stockQuantity || 0,
      quantityAvailable: stockQuantity || 0,
      lastStockCheck: new Date(),
      metadata: {
        woocommerce_sync: true,
        last_woo_sync: new Date(),
        woo_product_id: wooCommerceId
      }
    };

    if (existingInventory.length > 0) {
      const [updated] = await db
        .update(inventory)
        .set({
          ...inventoryData,
          updatedAt: new Date()
        })
        .where(eq(inventory.id, existingInventory[0].id))
        .returning();
      
      return { success: true, action: 'updated', inventory: updated };
    } else {
      const [created] = await db
        .insert(inventory)
        .values(inventoryData)
        .returning();
      
      return { success: true, action: 'created', inventory: created };
    }
  } catch (error) {
    console.error('Error syncing inventory from WooCommerce:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get synchronization status for all external integrations
 * @returns {Promise<Object>} Sync status report
 */
export async function getSyncStatus() {
  try {
    // Count customers with WooCommerce IDs
    const wooCustomersCount = await db
      .select({ count: sql`count(*)` })
      .from(customers)
      .where(sql`metadata ? 'woocommerce_id'`);

    // Count products with external IDs
    const externalProductsCount = await db
      .select({ count: sql`count(*)` })
      .from(products)
      .where(sql`external_id IS NOT NULL`);

    // Count suppliers with external IDs
    const externalSuppliersCount = await db
      .select({ count: sql`count(*)` })
      .from(suppliers)
      .where(sql`vendor_metadata ? 'external_id'`);

    return {
      success: true,
      woocommerce_customers: parseInt(wooCustomersCount[0]?.count || 0),
      external_products: parseInt(externalProductsCount[0]?.count || 0),
      external_suppliers: parseInt(externalSuppliersCount[0]?.count || 0),
      last_checked: new Date()
    };
  } catch (error) {
    console.error('Error getting sync status:', error);
    return { success: false, error: error.message };
  }
}