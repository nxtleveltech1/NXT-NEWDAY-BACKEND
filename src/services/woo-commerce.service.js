const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;
const cacheService = require('./cache.service');
const db = require('../config/database');

/**
 * WooCommerce Integration Service
 * Migrated from unified-extractor with PostgreSQL adaptation
 */

class WooCommerceService {
  constructor() {
    this.api = null;
    this.config = {
      siteUrl: process.env.WOOCOMMERCE_SITE_URL,
      consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
      consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
      version: process.env.WOOCOMMERCE_VERSION || 'wc/v3'
    };
    
    if (this.config.siteUrl && this.config.consumerKey && this.config.consumerSecret) {
      this.initializeApi();
    }
  }

  initializeApi() {
    this.api = new WooCommerceRestApi({
      url: this.config.siteUrl,
      consumerKey: this.config.consumerKey,
      consumerSecret: this.config.consumerSecret,
      version: this.config.version,
      queryStringAuth: true
    });
  }

  async configureApi(siteUrl, consumerKey, consumerSecret, version = 'wc/v3') {
    this.config = { siteUrl, consumerKey, consumerSecret, version };
    this.initializeApi();
    
    // Store configuration securely (encrypted in production)
    await db.query(
      `INSERT INTO system_config (key, value, encrypted, updated_at) 
       VALUES ($1, $2, $3, NOW()) 
       ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
      ['woocommerce_config', JSON.stringify(this.config), true]
    );
  }

  async checkApiHealth() {
    if (!this.api) return false;
    
    try {
      const response = await this.api.get('system_status');
      return response.status === 200;
    } catch (error) {
      console.error('WooCommerce API health check failed:', error.message);
      return false;
    }
  }

  // ==================== CUSTOMER SYNC ====================

  async syncCustomersToNXT(force = false, limit = 100) {
    if (!this.api) throw new Error('WooCommerce API not configured');

    try {
      // Get customers from WooCommerce
      const response = await this.api.get('customers', {
        per_page: limit,
        status: 'all'
      });

      const customers = response.data;
      let synced = 0;
      let errors = [];

      for (const wcCustomer of customers) {
        try {
          // Check if customer exists in NXT
          const existing = await db.query(
            'SELECT id FROM customers WHERE email = $1 OR external_id = $2',
            [wcCustomer.email, `wc_${wcCustomer.id}`]
          );

          if (existing.rows.length > 0 && !force) {
            continue; // Skip existing customers unless force is true
          }

          // Map WooCommerce customer to NXT format
          const nxtCustomer = {
            first_name: wcCustomer.first_name,
            last_name: wcCustomer.last_name,
            email: wcCustomer.email,
            phone: wcCustomer.billing.phone,
            external_id: `wc_${wcCustomer.id}`,
            external_source: 'woocommerce',
            billing_address: JSON.stringify(wcCustomer.billing),
            shipping_address: JSON.stringify(wcCustomer.shipping),
            is_paying_customer: wcCustomer.is_paying_customer,
            date_created: wcCustomer.date_created,
            meta_data: JSON.stringify(wcCustomer.meta_data)
          };

          if (existing.rows.length > 0) {
            // Update existing customer
            await db.query(
              `UPDATE customers SET 
               first_name = $1, last_name = $2, phone = $3,
               billing_address = $4, shipping_address = $5,
               is_paying_customer = $6, meta_data = $7, updated_at = NOW()
               WHERE id = $8`,
              [
                nxtCustomer.first_name, nxtCustomer.last_name, nxtCustomer.phone,
                nxtCustomer.billing_address, nxtCustomer.shipping_address,
                nxtCustomer.is_paying_customer, nxtCustomer.meta_data,
                existing.rows[0].id
              ]
            );
          } else {
            // Insert new customer
            await db.query(
              `INSERT INTO customers (
                first_name, last_name, email, phone, external_id, external_source,
                billing_address, shipping_address, is_paying_customer,
                date_created, meta_data, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())`,
              [
                nxtCustomer.first_name, nxtCustomer.last_name, nxtCustomer.email,
                nxtCustomer.phone, nxtCustomer.external_id, nxtCustomer.external_source,
                nxtCustomer.billing_address, nxtCustomer.shipping_address,
                nxtCustomer.is_paying_customer, nxtCustomer.date_created, nxtCustomer.meta_data
              ]
            );
          }

          synced++;
        } catch (error) {
          errors.push({
            customer_id: wcCustomer.id,
            email: wcCustomer.email,
            error: error.message
          });
        }
      }

      return {
        synced,
        total: customers.length,
        errors,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Customer sync failed: ${error.message}`);
    }
  }

  // ==================== PRODUCT SYNC ====================

  async syncProductsToNXT(force = false, limit = 100, updateInventory = true) {
    if (!this.api) throw new Error('WooCommerce API not configured');

    try {
      const response = await this.api.get('products', {
        per_page: limit,
        status: 'publish'
      });

      const products = response.data;
      let synced = 0;
      let errors = [];

      for (const wcProduct of products) {
        try {
          // Check if product exists in NXT
          const existing = await db.query(
            'SELECT id FROM products WHERE sku = $1 OR external_id = $2',
            [wcProduct.sku, `wc_${wcProduct.id}`]
          );

          if (existing.rows.length > 0 && !force) {
            continue;
          }

          // Map WooCommerce product to NXT format
          const nxtProduct = {
            name: wcProduct.name,
            sku: wcProduct.sku || `WC-${wcProduct.id}`,
            description: wcProduct.description,
            short_description: wcProduct.short_description,
            price: parseFloat(wcProduct.price) || 0,
            regular_price: parseFloat(wcProduct.regular_price) || 0,
            sale_price: parseFloat(wcProduct.sale_price) || null,
            external_id: `wc_${wcProduct.id}`,
            external_source: 'woocommerce',
            categories: wcProduct.categories.map(cat => cat.name).join(', '),
            images: JSON.stringify(wcProduct.images),
            attributes: JSON.stringify(wcProduct.attributes),
            meta_data: JSON.stringify(wcProduct.meta_data),
            stock_status: wcProduct.stock_status,
            stock_quantity: wcProduct.stock_quantity || 0,
            manage_stock: wcProduct.manage_stock,
            weight: wcProduct.weight || null,
            dimensions: JSON.stringify(wcProduct.dimensions)
          };

          if (existing.rows.length > 0) {
            // Update existing product
            await db.query(
              `UPDATE products SET 
               name = $1, description = $2, short_description = $3,
               price = $4, regular_price = $5, sale_price = $6,
               categories = $7, images = $8, attributes = $9,
               meta_data = $10, stock_status = $11, updated_at = NOW()
               WHERE id = $12`,
              [
                nxtProduct.name, nxtProduct.description, nxtProduct.short_description,
                nxtProduct.price, nxtProduct.regular_price, nxtProduct.sale_price,
                nxtProduct.categories, nxtProduct.images, nxtProduct.attributes,
                nxtProduct.meta_data, nxtProduct.stock_status, existing.rows[0].id
              ]
            );

            if (updateInventory && wcProduct.manage_stock) {
              // Update inventory levels
              await this.updateInventoryFromWooCommerce(existing.rows[0].id, wcProduct);
            }
          } else {
            // Insert new product
            const result = await db.query(
              `INSERT INTO products (
                name, sku, description, short_description, price, regular_price, sale_price,
                external_id, external_source, categories, images, attributes, meta_data,
                stock_status, weight, dimensions, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())
              RETURNING id`,
              [
                nxtProduct.name, nxtProduct.sku, nxtProduct.description, nxtProduct.short_description,
                nxtProduct.price, nxtProduct.regular_price, nxtProduct.sale_price,
                nxtProduct.external_id, nxtProduct.external_source, nxtProduct.categories,
                nxtProduct.images, nxtProduct.attributes, nxtProduct.meta_data,
                nxtProduct.stock_status, nxtProduct.weight, nxtProduct.dimensions
              ]
            );

            if (updateInventory && wcProduct.manage_stock) {
              await this.updateInventoryFromWooCommerce(result.rows[0].id, wcProduct);
            }
          }

          synced++;
        } catch (error) {
          errors.push({
            product_id: wcProduct.id,
            sku: wcProduct.sku,
            error: error.message
          });
        }
      }

      return {
        synced,
        total: products.length,
        errors,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Product sync failed: ${error.message}`);
    }
  }

  async updateInventoryFromWooCommerce(productId, wcProduct) {
    // Get default warehouse
    const warehouse = await db.query('SELECT id FROM warehouses LIMIT 1');
    if (warehouse.rows.length === 0) {
      throw new Error('No warehouse configured');
    }

    const warehouseId = warehouse.rows[0].id;

    // Check current inventory
    const currentInventory = await db.query(
      'SELECT on_hand FROM inventory WHERE product_id = $1 AND warehouse_id = $2',
      [productId, warehouseId]
    );

    const targetQuantity = wcProduct.stock_quantity || 0;

    if (currentInventory.rows.length === 0) {
      // Insert new inventory record
      await db.query(
        `INSERT INTO inventory (product_id, warehouse_id, on_hand, reserved, updated_at)
         VALUES ($1, $2, $3, 0, NOW())`,
        [productId, warehouseId, targetQuantity]
      );
    } else {
      // Update existing inventory
      await db.query(
        'UPDATE inventory SET on_hand = $1, updated_at = NOW() WHERE product_id = $2 AND warehouse_id = $3',
        [targetQuantity, productId, warehouseId]
      );
    }

    // Record inventory movement
    await db.query(
      `INSERT INTO inventory_movements (
        product_id, warehouse_id, movement_type, quantity, reference_type,
        reference_id, notes, performed_by, created_at
      ) VALUES ($1, $2, 'sync', $3, 'woocommerce_sync', $4, $5, 'system', NOW())`,
      [
        productId, warehouseId, targetQuantity,
        wcProduct.id, `WooCommerce inventory sync for product ${wcProduct.sku}`
      ]
    );
  }

  // ==================== ORDER SYNC ====================

  async syncOrdersToNXT(force = false, limit = 100, status = 'all') {
    if (!this.api) throw new Error('WooCommerce API not configured');

    try {
      const params = { per_page: limit };
      if (status !== 'all') {
        params.status = status;
      }

      const response = await this.api.get('orders', params);
      const orders = response.data;
      let synced = 0;
      let errors = [];

      for (const wcOrder of orders) {
        try {
          // Check if order exists
          const existing = await db.query(
            'SELECT id FROM orders WHERE external_id = $1',
            [`wc_${wcOrder.id}`]
          );

          if (existing.rows.length > 0 && !force) {
            continue;
          }

          // Get customer ID from NXT
          const customer = await db.query(
            'SELECT id FROM customers WHERE external_id = $1 OR email = $2',
            [`wc_${wcOrder.customer_id}`, wcOrder.billing.email]
          );

          const customerId = customer.rows.length > 0 ? customer.rows[0].id : null;

          const nxtOrder = {
            external_id: `wc_${wcOrder.id}`,
            external_source: 'woocommerce',
            customer_id: customerId,
            status: wcOrder.status,
            currency: wcOrder.currency,
            total: parseFloat(wcOrder.total),
            subtotal: parseFloat(wcOrder.subtotal || 0),
            tax_total: parseFloat(wcOrder.total_tax || 0),
            shipping_total: parseFloat(wcOrder.shipping_total || 0),
            payment_method: wcOrder.payment_method_title,
            billing_address: JSON.stringify(wcOrder.billing),
            shipping_address: JSON.stringify(wcOrder.shipping),
            line_items: JSON.stringify(wcOrder.line_items),
            meta_data: JSON.stringify(wcOrder.meta_data),
            date_created: wcOrder.date_created,
            date_modified: wcOrder.date_modified
          };

          if (existing.rows.length > 0) {
            // Update existing order
            await db.query(
              `UPDATE orders SET 
               status = $1, currency = $2, total = $3, subtotal = $4,
               tax_total = $5, shipping_total = $6, payment_method = $7,
               billing_address = $8, shipping_address = $9, line_items = $10,
               meta_data = $11, date_modified = $12, updated_at = NOW()
               WHERE id = $13`,
              [
                nxtOrder.status, nxtOrder.currency, nxtOrder.total, nxtOrder.subtotal,
                nxtOrder.tax_total, nxtOrder.shipping_total, nxtOrder.payment_method,
                nxtOrder.billing_address, nxtOrder.shipping_address, nxtOrder.line_items,
                nxtOrder.meta_data, nxtOrder.date_modified, existing.rows[0].id
              ]
            );
          } else {
            // Insert new order
            await db.query(
              `INSERT INTO orders (
                external_id, external_source, customer_id, status, currency,
                total, subtotal, tax_total, shipping_total, payment_method,
                billing_address, shipping_address, line_items, meta_data,
                date_created, date_modified, created_at, updated_at
              ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, NOW(), NOW())`,
              [
                nxtOrder.external_id, nxtOrder.external_source, nxtOrder.customer_id,
                nxtOrder.status, nxtOrder.currency, nxtOrder.total, nxtOrder.subtotal,
                nxtOrder.tax_total, nxtOrder.shipping_total, nxtOrder.payment_method,
                nxtOrder.billing_address, nxtOrder.shipping_address, nxtOrder.line_items,
                nxtOrder.meta_data, nxtOrder.date_created, nxtOrder.date_modified
              ]
            );
          }

          synced++;
        } catch (error) {
          errors.push({
            order_id: wcOrder.id,
            error: error.message
          });
        }
      }

      return {
        synced,
        total: orders.length,
        errors,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Order sync failed: ${error.message}`);
    }
  }

  // ==================== PUSH TO WOOCOMMERCE ====================

  async pushInventoryToWooCommerce(productIds = [], syncAll = false) {
    if (!this.api) throw new Error('WooCommerce API not configured');

    try {
      let query = `
        SELECT p.external_id, p.sku, i.on_hand, p.manage_stock
        FROM products p
        LEFT JOIN inventory i ON p.id = i.product_id
        WHERE p.external_source = 'woocommerce' AND p.external_id IS NOT NULL
      `;
      let params = [];

      if (!syncAll && productIds.length > 0) {
        query += ` AND p.id = ANY($1)`;
        params = [productIds];
      }

      const result = await db.query(query, params);
      const products = result.rows;

      let updated = 0;
      let errors = [];

      for (const product of products) {
        try {
          if (!product.external_id.startsWith('wc_')) continue;

          const wcProductId = product.external_id.replace('wc_', '');
          const stockQuantity = product.on_hand || 0;

          await this.api.put(`products/${wcProductId}`, {
            stock_quantity: stockQuantity,
            stock_status: stockQuantity > 0 ? 'instock' : 'outofstock'
          });

          updated++;
        } catch (error) {
          errors.push({
            product_sku: product.sku,
            external_id: product.external_id,
            error: error.message
          });
        }
      }

      return {
        updated,
        total: products.length,
        errors,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Inventory push failed: ${error.message}`);
    }
  }

  async pushPricesToWooCommerce(productIds = [], syncAll = false) {
    if (!this.api) throw new Error('WooCommerce API not configured');

    try {
      let query = `
        SELECT external_id, sku, price, regular_price, sale_price
        FROM products
        WHERE external_source = 'woocommerce' AND external_id IS NOT NULL
      `;
      let params = [];

      if (!syncAll && productIds.length > 0) {
        query += ` AND id = ANY($1)`;
        params = [productIds];
      }

      const result = await db.query(query, params);
      const products = result.rows;

      let updated = 0;
      let errors = [];

      for (const product of products) {
        try {
          if (!product.external_id.startsWith('wc_')) continue;

          const wcProductId = product.external_id.replace('wc_', '');
          
          const updateData = {
            regular_price: product.regular_price?.toString() || product.price?.toString() || '0',
            price: product.price?.toString() || '0'
          };

          if (product.sale_price && parseFloat(product.sale_price) > 0) {
            updateData.sale_price = product.sale_price.toString();
          }

          await this.api.put(`products/${wcProductId}`, updateData);
          updated++;
        } catch (error) {
          errors.push({
            product_sku: product.sku,
            external_id: product.external_id,
            error: error.message
          });
        }
      }

      return {
        updated,
        total: products.length,
        errors,
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Price push failed: ${error.message}`);
    }
  }

  // ==================== ANALYTICS & SEARCH ====================

  async getWooCommerceAnalytics(timeframe = '30d') {
    const days = parseInt(timeframe.replace('d', ''));
    const dateFrom = new Date();
    dateFrom.setDate(dateFrom.getDate() - days);

    try {
      const [customerStats, productStats, orderStats] = await Promise.all([
        this.getCustomerStats(),
        this.getProductStats(),
        this.getOrderStats()
      ]);

      return {
        timeframe,
        dateFrom: dateFrom.toISOString(),
        customerStats,
        productStats,
        orderStats,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Analytics generation failed: ${error.message}`);
    }
  }

  async getCustomerStats() {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_customers,
        COUNT(*) FILTER (WHERE is_paying_customer = true) as paying_customers,
        COUNT(*) FILTER (WHERE external_source = 'woocommerce') as wc_customers
      FROM customers
    `);

    return result.rows[0];
  }

  async getProductStats() {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_products,
        COUNT(*) FILTER (WHERE external_source = 'woocommerce') as wc_products,
        AVG(price) as average_price,
        SUM(CASE WHEN i.on_hand > 0 THEN i.on_hand ELSE 0 END) as total_inventory
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
    `);

    return result.rows[0];
  }

  async getOrderStats() {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE external_source = 'woocommerce') as wc_orders,
        AVG(total) as average_order_value,
        SUM(total) as total_revenue
      FROM orders
      WHERE date_created >= NOW() - INTERVAL '30 days'
    `);

    return result.rows[0];
  }

  async searchCustomers(query, limit = 50) {
    if (!this.api) throw new Error('WooCommerce API not configured');

    try {
      const response = await this.api.get('customers', {
        search: query,
        per_page: limit
      });

      return response.data;
    } catch (error) {
      throw new Error(`Customer search failed: ${error.message}`);
    }
  }

  async searchProducts(query, limit = 50) {
    if (!this.api) throw new Error('WooCommerce API not configured');

    try {
      const response = await this.api.get('products', {
        search: query,
        per_page: limit
      });

      return response.data;
    } catch (error) {
      throw new Error(`Product search failed: ${error.message}`);
    }
  }

  async getSyncStatus() {
    try {
      const result = await db.query(`
        SELECT 
          'customers' as entity,
          COUNT(*) FILTER (WHERE external_source = 'woocommerce') as synced_count,
          MAX(updated_at) FILTER (WHERE external_source = 'woocommerce') as last_sync
        FROM customers
        UNION ALL
        SELECT 
          'products' as entity,
          COUNT(*) FILTER (WHERE external_source = 'woocommerce') as synced_count,
          MAX(updated_at) FILTER (WHERE external_source = 'woocommerce') as last_sync
        FROM products
        UNION ALL
        SELECT 
          'orders' as entity,
          COUNT(*) FILTER (WHERE external_source = 'woocommerce') as synced_count,
          MAX(updated_at) FILTER (WHERE external_source = 'woocommerce') as last_sync
        FROM orders
      `);

      const status = {};
      result.rows.forEach(row => {
        status[row.entity] = {
          syncedCount: parseInt(row.synced_count),
          lastSync: row.last_sync
        };
      });

      return status;
    } catch (error) {
      throw new Error(`Sync status failed: ${error.message}`);
    }
  }
}

module.exports = new WooCommerceService();