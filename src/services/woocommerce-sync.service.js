const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;
const cacheService = require('./cache.service');
const db = require('../config/database');
const { sql } = require('drizzle-orm');

/**
 * Enhanced WooCommerce Bidirectional Sync Service
 * Comprehensive sync solution for NXT-NEW-DAY backend integration
 * 
 * Features:
 * - Bidirectional sync (WooCommerce ↔ NXT)
 * - Real-time webhook support
 * - Advanced error handling and retry logic
 * - Sync status tracking and analytics
 * - Conflict resolution strategies
 * - Performance optimizations
 */

class WooCommerceSyncService {
  constructor() {
    this.api = null;
    this.config = {
      siteUrl: process.env.WOOCOMMERCE_SITE_URL,
      consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
      consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
      version: process.env.WOOCOMMERCE_VERSION || 'wc/v3',
      webhookSecret: process.env.WOOCOMMERCE_WEBHOOK_SECRET
    };
    
    this.retryConfig = {
      maxRetries: 3,
      retryDelay: 1000,
      backoffMultiplier: 2
    };

    this.syncLog = [];
    this.isConnected = false;
    
    if (this.config.siteUrl && this.config.consumerKey && this.config.consumerSecret) {
      this.initializeApi();
    }
  }

  initializeApi() {
    try {
      this.api = new WooCommerceRestApi({
        url: this.config.siteUrl,
        consumerKey: this.config.consumerKey,
        consumerSecret: this.config.consumerSecret,
        version: this.config.version,
        queryStringAuth: true
      });
      this.isConnected = true;
      console.log('✅ WooCommerce API initialized successfully');
    } catch (error) {
      console.error('❌ WooCommerce API initialization failed:', error.message);
      this.isConnected = false;
    }
  }

  async testConnection() {
    if (!this.api) {
      throw new Error('WooCommerce API not configured');
    }

    try {
      const response = await this.api.get('system_status');
      this.isConnected = response.status === 200;
      return {
        connected: this.isConnected,
        status: response.status,
        data: response.data.settings || {},
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      this.isConnected = false;
      throw new Error(`Connection test failed: ${error.message}`);
    }
  }

  // ==================== SYNC ORCHESTRATION ====================

  /**
   * Full bidirectional sync - all entities
   */
  async fullSync(options = {}) {
    const {
      direction = 'both', // 'pull', 'push', 'both'
      force = false,
      batchSize = 100,
      skipErrors = true
    } = options;

    const syncId = `sync_${Date.now()}`;
    const startTime = Date.now();
    
    try {
      console.log(`🚀 Starting full sync (${direction}) - ID: ${syncId}`);
      
      const results = {
        syncId,
        direction,
        startTime: new Date().toISOString(),
        customers: { pulled: 0, pushed: 0, errors: [] },
        products: { pulled: 0, pushed: 0, errors: [] },
        orders: { pulled: 0, pushed: 0, errors: [] },
        inventory: { pushed: 0, errors: [] },
        totalErrors: 0,
        duration: 0
      };

      // Record sync start
      await this.recordSyncEvent(syncId, 'started', { options });

      if (direction === 'pull' || direction === 'both') {
        console.log('📥 Starting PULL operations...');
        
        // Pull customers
        try {
          const customerResult = await this.pullCustomersFromWooCommerce({ force, limit: batchSize });
          results.customers.pulled = customerResult.synced;
          if (!skipErrors) results.customers.errors = customerResult.errors;
        } catch (error) {
          results.customers.errors.push({ operation: 'pull', error: error.message });
        }

        // Pull products
        try {
          const productResult = await this.pullProductsFromWooCommerce({ force, limit: batchSize });
          results.products.pulled = productResult.synced;
          if (!skipErrors) results.products.errors = productResult.errors;
        } catch (error) {
          results.products.errors.push({ operation: 'pull', error: error.message });
        }

        // Pull orders
        try {
          const orderResult = await this.pullOrdersFromWooCommerce({ force, limit: batchSize });
          results.orders.pulled = orderResult.synced;
          if (!skipErrors) results.orders.errors = orderResult.errors;
        } catch (error) {
          results.orders.errors.push({ operation: 'pull', error: error.message });
        }
      }

      if (direction === 'push' || direction === 'both') {
        console.log('📤 Starting PUSH operations...');
        
        // Push inventory updates
        try {
          const inventoryResult = await this.pushInventoryToWooCommerce({ syncAll: true });
          results.inventory.pushed = inventoryResult.updated;
          if (!skipErrors) results.inventory.errors = inventoryResult.errors;
        } catch (error) {
          results.inventory.errors.push({ operation: 'push', error: error.message });
        }

        // Push customer updates
        try {
          const customerPushResult = await this.pushCustomersToWooCommerce({ syncAll: true });
          results.customers.pushed = customerPushResult.updated;
          if (!skipErrors) results.customers.errors.push(...customerPushResult.errors);
        } catch (error) {
          results.customers.errors.push({ operation: 'push', error: error.message });
        }
      }

      // Calculate totals
      results.totalErrors = 
        results.customers.errors.length + 
        results.products.errors.length + 
        results.orders.errors.length + 
        results.inventory.errors.length;

      results.duration = Date.now() - startTime;
      results.endTime = new Date().toISOString();

      // Record completion
      await this.recordSyncEvent(syncId, 'completed', results);

      console.log(`✅ Full sync completed in ${results.duration}ms`);
      return results;

    } catch (error) {
      const errorResult = {
        syncId,
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: new Date().toISOString()
      };
      
      await this.recordSyncEvent(syncId, 'failed', errorResult);
      throw error;
    }
  }

  // ==================== CUSTOMER SYNC ====================

  async pullCustomersFromWooCommerce(options = {}) {
    const { force = false, limit = 100, page = 1 } = options;
    
    if (!this.api) throw new Error('WooCommerce API not configured');

    try {
      console.log(`📥 Pulling customers from WooCommerce (limit: ${limit}, page: ${page})`);
      
      const response = await this.apiWithRetry('get', 'customers', {
        per_page: limit,
        page,
        status: 'all'
      });

      const customers = response.data;
      let synced = 0;
      let errors = [];

      for (const wcCustomer of customers) {
        try {
          const result = await this.syncCustomerToNXT(wcCustomer, force);
          if (result.synced) synced++;
        } catch (error) {
          errors.push({
            customer_id: wcCustomer.id,
            email: wcCustomer.email,
            error: error.message
          });
        }
      }

      const result = {
        synced,
        total: customers.length,
        errors,
        page,
        hasMore: customers.length === limit,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Customer pull completed: ${synced}/${customers.length} synced`);
      return result;

    } catch (error) {
      throw new Error(`Customer pull failed: ${error.message}`);
    }
  }

  async syncCustomerToNXT(wcCustomer, force = false) {
    try {
      // Check if customer exists
      const existing = await db.query(
        `SELECT id, updated_at FROM customers 
         WHERE email = $1 OR (metadata->>'wc_id')::integer = $2`,
        [wcCustomer.email, wcCustomer.id]
      );

      const existingCustomer = existing.rows[0];
      
      // Skip if exists and not forcing
      if (existingCustomer && !force) {
        return { synced: false, reason: 'exists' };
      }

      // Map WooCommerce customer to NXT format
      const nxtCustomer = {
        customer_code: `WC-${wcCustomer.id}`,
        company_name: wcCustomer.billing?.company || 
                     `${wcCustomer.first_name} ${wcCustomer.last_name}`.trim() || 
                     wcCustomer.email,
        email: wcCustomer.email,
        phone: wcCustomer.billing?.phone || '',
        address: {
          billing: wcCustomer.billing || {},
          shipping: wcCustomer.shipping || {}
        },
        metadata: {
          wc_id: wcCustomer.id,
          first_name: wcCustomer.first_name,
          last_name: wcCustomer.last_name,
          username: wcCustomer.username,
          is_paying_customer: wcCustomer.is_paying_customer,
          date_created: wcCustomer.date_created,
          date_modified: wcCustomer.date_modified,
          meta_data: wcCustomer.meta_data || [],
          avatar_url: wcCustomer.avatar_url,
          role: wcCustomer.role
        },
        purchase_history: []
      };

      if (existingCustomer) {
        // Update existing customer
        await db.query(
          `UPDATE customers SET 
           company_name = $1, phone = $2, address = $3, metadata = $4, updated_at = NOW()
           WHERE id = $5`,
          [
            nxtCustomer.company_name,
            nxtCustomer.phone,
            JSON.stringify(nxtCustomer.address),
            JSON.stringify(nxtCustomer.metadata),
            existingCustomer.id
          ]
        );
        
        console.log(`🔄 Updated customer: ${wcCustomer.email}`);
      } else {
        // Insert new customer
        await db.query(
          `INSERT INTO customers (
            customer_code, company_name, email, phone, address, metadata, 
            purchase_history, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())`,
          [
            nxtCustomer.customer_code,
            nxtCustomer.company_name,
            nxtCustomer.email,
            nxtCustomer.phone,
            JSON.stringify(nxtCustomer.address),
            JSON.stringify(nxtCustomer.metadata),
            JSON.stringify(nxtCustomer.purchase_history)
          ]
        );
        
        console.log(`➕ Created customer: ${wcCustomer.email}`);
      }

      return { synced: true, action: existingCustomer ? 'updated' : 'created' };

    } catch (error) {
      throw new Error(`Customer sync failed for ${wcCustomer.email}: ${error.message}`);
    }
  }

  async pushCustomersToWooCommerce(options = {}) {
    const { customerIds = [], syncAll = false, syncModifiedSince = null } = options;
    
    if (!this.api) throw new Error('WooCommerce API not configured');

    try {
      let query = `
        SELECT id, customer_code, company_name, email, phone, address, metadata, updated_at
        FROM customers 
        WHERE (metadata->>'wc_id') IS NOT NULL
      `;
      let params = [];

      if (!syncAll && customerIds.length > 0) {
        query += ` AND id = ANY($1)`;
        params = [customerIds];
      } else if (syncModifiedSince) {
        query += ` AND updated_at > $1`;
        params = [syncModifiedSince];
      }

      const result = await db.query(query, params);
      const customers = result.rows;

      let updated = 0;
      let errors = [];

      for (const customer of customers) {
        try {
          const wcId = customer.metadata?.wc_id;
          if (!wcId) continue;

          const updateData = {
            first_name: customer.metadata?.first_name || '',
            last_name: customer.metadata?.last_name || '',
            email: customer.email,
            billing: {
              ...customer.address?.billing,
              phone: customer.phone,
              company: customer.company_name
            }
          };

          await this.apiWithRetry('put', `customers/${wcId}`, updateData);
          updated++;
          
          console.log(`🔄 Updated WC customer: ${customer.email}`);

        } catch (error) {
          errors.push({
            customer_id: customer.id,
            email: customer.email,
            error: error.message
          });
        }
      }

      return {
        updated,
        total: customers.length,
        errors,
        timestamp: new Date().toISOString()
      };

    } catch (error) {
      throw new Error(`Customer push failed: ${error.message}`);
    }
  }

  // ==================== PRODUCT SYNC ====================

  async pullProductsFromWooCommerce(options = {}) {
    const { force = false, limit = 100, page = 1, status = 'publish' } = options;
    
    if (!this.api) throw new Error('WooCommerce API not configured');

    try {
      console.log(`📥 Pulling products from WooCommerce (limit: ${limit}, page: ${page})`);
      
      const response = await this.apiWithRetry('get', 'products', {
        per_page: limit,
        page,
        status
      });

      const products = response.data;
      let synced = 0;
      let errors = [];

      for (const wcProduct of products) {
        try {
          const result = await this.syncProductToNXT(wcProduct, force);
          if (result.synced) synced++;
        } catch (error) {
          errors.push({
            product_id: wcProduct.id,
            sku: wcProduct.sku,
            name: wcProduct.name,
            error: error.message
          });
        }
      }

      const result = {
        synced,
        total: products.length,
        errors,
        page,
        hasMore: products.length === limit,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Product pull completed: ${synced}/${products.length} synced`);
      return result;

    } catch (error) {
      throw new Error(`Product pull failed: ${error.message}`);
    }
  }

  async syncProductToNXT(wcProduct, force = false) {
    try {
      // Generate SKU if missing
      const productSku = wcProduct.sku || `WC-${wcProduct.id}`;
      
      // Check if product exists
      const existing = await db.query(
        `SELECT id, supplier_id FROM products 
         WHERE sku = $1 OR (metadata->>'wc_id')::integer = $2`,
        [productSku, wcProduct.id]
      );

      const existingProduct = existing.rows[0];
      
      // Skip if exists and not forcing
      if (existingProduct && !force) {
        return { synced: false, reason: 'exists' };
      }

      // Find or create supplier (WooCommerce as supplier)
      let supplierId = existingProduct?.supplier_id;
      if (!supplierId) {
        const supplier = await this.ensureWooCommerceSupplier();
        supplierId = supplier.id;
      }

      // Map WooCommerce product to NXT format
      const price = parseFloat(wcProduct.price) || parseFloat(wcProduct.regular_price) || 0;
      const costPrice = parseFloat(wcProduct.sale_price) || price * 0.7; // Estimate cost

      const nxtProduct = {
        sku: productSku,
        name: wcProduct.name,
        description: wcProduct.description || wcProduct.short_description || '',
        category: wcProduct.categories?.[0]?.name || 'WooCommerce',
        unit_price: price,
        cost_price: costPrice,
        supplier_id: supplierId,
        is_active: wcProduct.status === 'publish',
        metadata: {
          wc_id: wcProduct.id,
          short_description: wcProduct.short_description,
          regular_price: wcProduct.regular_price,
          sale_price: wcProduct.sale_price,
          stock_status: wcProduct.stock_status,
          stock_quantity: wcProduct.stock_quantity,
          manage_stock: wcProduct.manage_stock,
          weight: wcProduct.weight,
          dimensions: wcProduct.dimensions,
          categories: wcProduct.categories,
          tags: wcProduct.tags,
          images: wcProduct.images,
          attributes: wcProduct.attributes,
          meta_data: wcProduct.meta_data || []
        }
      };

      let productId;

      if (existingProduct) {
        // Update existing product
        await db.query(
          `UPDATE products SET 
           name = $1, description = $2, category = $3, unit_price = $4, 
           cost_price = $5, is_active = $6, metadata = $7, updated_at = NOW()
           WHERE id = $8`,
          [
            nxtProduct.name,
            nxtProduct.description,
            nxtProduct.category,
            nxtProduct.unit_price,
            nxtProduct.cost_price,
            nxtProduct.is_active,
            JSON.stringify(nxtProduct.metadata),
            existingProduct.id
          ]
        );
        
        productId = existingProduct.id;
        console.log(`🔄 Updated product: ${wcProduct.name}`);
      } else {
        // Insert new product
        const result = await db.query(
          `INSERT INTO products (
            sku, name, description, category, unit_price, cost_price, 
            supplier_id, is_active, metadata, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
          RETURNING id`,
          [
            nxtProduct.sku,
            nxtProduct.name,
            nxtProduct.description,
            nxtProduct.category,
            nxtProduct.unit_price,
            nxtProduct.cost_price,
            nxtProduct.supplier_id,
            nxtProduct.is_active,
            JSON.stringify(nxtProduct.metadata)
          ]
        );
        
        productId = result.rows[0].id;
        console.log(`➕ Created product: ${wcProduct.name}`);
      }

      // Sync inventory if product manages stock
      if (wcProduct.manage_stock && wcProduct.stock_quantity !== undefined) {
        await this.syncProductInventory(productId, wcProduct);
      }

      return { synced: true, action: existingProduct ? 'updated' : 'created', productId };

    } catch (error) {
      throw new Error(`Product sync failed for ${wcProduct.name}: ${error.message}`);
    }
  }

  async syncProductInventory(productId, wcProduct) {
    try {
      // Get default warehouse
      const warehouse = await db.query('SELECT id FROM warehouses LIMIT 1');
      if (warehouse.rows.length === 0) {
        console.log('⚠️ No warehouse found for inventory sync');
        return;
      }

      const warehouseId = warehouse.rows[0].id;
      const stockQuantity = parseInt(wcProduct.stock_quantity) || 0;

      // Check existing inventory
      const existing = await db.query(
        'SELECT id, quantity_on_hand FROM inventory WHERE product_id = $1 AND warehouse_id = $2',
        [productId, warehouseId]
      );

      if (existing.rows.length > 0) {
        // Update existing inventory
        const currentQuantity = existing.rows[0].quantity_on_hand;
        if (currentQuantity !== stockQuantity) {
          await db.query(
            `UPDATE inventory SET 
             quantity_on_hand = $1, quantity_available = $1, last_stock_check = NOW(), updated_at = NOW()
             WHERE id = $2`,
            [stockQuantity, existing.rows[0].id]
          );

          // Record movement
          await this.recordInventoryMovement({
            inventoryId: existing.rows[0].id,
            productId,
            warehouseId,
            movementType: 'wc_sync',
            quantity: stockQuantity - currentQuantity,
            quantityAfter: stockQuantity,
            notes: `WooCommerce sync - Product: ${wcProduct.name}`,
            referenceType: 'woocommerce_sync',
            referenceId: wcProduct.id.toString()
          });
        }
      } else {
        // Create new inventory record
        const result = await db.query(
          `INSERT INTO inventory (
            product_id, warehouse_id, quantity_on_hand, quantity_available,
            stock_status, last_stock_check, created_at, updated_at
          ) VALUES ($1, $2, $3, $3, $4, NOW(), NOW(), NOW())
          RETURNING id`,
          [
            productId,
            warehouseId,
            stockQuantity,
            stockQuantity > 0 ? 'in_stock' : 'out_of_stock'
          ]
        );

        // Record initial movement
        await this.recordInventoryMovement({
          inventoryId: result.rows[0].id,
          productId,
          warehouseId,
          movementType: 'initial_stock',
          quantity: stockQuantity,
          quantityAfter: stockQuantity,
          notes: `Initial stock from WooCommerce - Product: ${wcProduct.name}`,
          referenceType: 'woocommerce_sync',
          referenceId: wcProduct.id.toString()
        });
      }

      console.log(`📦 Synced inventory for ${wcProduct.name}: ${stockQuantity} units`);

    } catch (error) {
      console.error(`❌ Inventory sync failed for product ${productId}:`, error.message);
    }
  }

  // ==================== ORDER SYNC ====================

  async pullOrdersFromWooCommerce(options = {}) {
    const { force = false, limit = 100, page = 1, status = 'all', after = null } = options;
    
    if (!this.api) throw new Error('WooCommerce API not configured');

    try {
      console.log(`📥 Pulling orders from WooCommerce (limit: ${limit}, page: ${page})`);
      
      const params = {
        per_page: limit,
        page,
        orderby: 'date',
        order: 'desc'
      };

      if (status !== 'all') params.status = status;
      if (after) params.after = after;

      const response = await this.apiWithRetry('get', 'orders', params);
      const orders = response.data;
      let synced = 0;
      let errors = [];

      for (const wcOrder of orders) {
        try {
          const result = await this.syncOrderToNXT(wcOrder, force);
          if (result.synced) synced++;
        } catch (error) {
          errors.push({
            order_id: wcOrder.id,
            order_number: wcOrder.number,
            error: error.message
          });
        }
      }

      const result = {
        synced,
        total: orders.length,
        errors,
        page,
        hasMore: orders.length === limit,
        timestamp: new Date().toISOString()
      };

      console.log(`✅ Order pull completed: ${synced}/${orders.length} synced`);
      return result;

    } catch (error) {
      throw new Error(`Order pull failed: ${error.message}`);
    }
  }

  async syncOrderToNXT(wcOrder, force = false) {
    try {
      // Check if order exists
      const existing = await db.query(
        `SELECT id FROM purchase_orders 
         WHERE order_number = $1 OR (metadata->>'wc_id')::integer = $2`,
        [`WC-${wcOrder.number}`, wcOrder.id]
      );

      const existingOrder = existing.rows[0];
      
      // Skip if exists and not forcing
      if (existingOrder && !force) {
        return { synced: false, reason: 'exists' };
      }

      // Find customer
      const customer = await db.query(
        `SELECT id FROM customers 
         WHERE email = $1 OR (metadata->>'wc_id')::integer = $2`,
        [wcOrder.billing?.email, wcOrder.customer_id]
      );

      const customerId = customer.rows[0]?.id || null;

      // Find WooCommerce supplier
      const supplier = await this.ensureWooCommerceSupplier();

      // Map WooCommerce order to NXT purchase order format
      const nxtOrder = {
        order_number: `WC-${wcOrder.number}`,
        supplier_id: supplier.id,
        customer_id: customerId,
        status: this.mapWooCommerceStatus(wcOrder.status),
        order_date: wcOrder.date_created,
        subtotal: parseFloat(wcOrder.subtotal || 0),
        tax_amount: parseFloat(wcOrder.total_tax || 0),
        shipping_cost: parseFloat(wcOrder.shipping_total || 0),
        discount_amount: parseFloat(wcOrder.discount_total || 0),
        total_amount: parseFloat(wcOrder.total || 0),
        billing_address: wcOrder.billing || {},
        shipping_address: wcOrder.shipping || {},
        notes: wcOrder.customer_note || '',
        metadata: {
          wc_id: wcOrder.id,
          wc_order_key: wcOrder.order_key,
          wc_status: wcOrder.status,
          currency: wcOrder.currency,
          payment_method: wcOrder.payment_method,
          payment_method_title: wcOrder.payment_method_title,
          transaction_id: wcOrder.transaction_id,
          date_paid: wcOrder.date_paid,
          date_completed: wcOrder.date_completed,
          line_items: wcOrder.line_items || [],
          shipping_lines: wcOrder.shipping_lines || [],
          tax_lines: wcOrder.tax_lines || [],
          fee_lines: wcOrder.fee_lines || [],
          coupon_lines: wcOrder.coupon_lines || [],
          meta_data: wcOrder.meta_data || []
        }
      };

      let orderId;

      if (existingOrder) {
        // Update existing order
        await db.query(
          `UPDATE purchase_orders SET 
           status = $1, subtotal = $2, tax_amount = $3, shipping_cost = $4,
           discount_amount = $5, total_amount = $6, billing_address = $7,
           shipping_address = $8, notes = $9, metadata = $10, updated_at = NOW()
           WHERE id = $11`,
          [
            nxtOrder.status,
            nxtOrder.subtotal,
            nxtOrder.tax_amount,
            nxtOrder.shipping_cost,
            nxtOrder.discount_amount,
            nxtOrder.total_amount,
            JSON.stringify(nxtOrder.billing_address),
            JSON.stringify(nxtOrder.shipping_address),
            nxtOrder.notes,
            JSON.stringify(nxtOrder.metadata),
            existingOrder.id
          ]
        );
        
        orderId = existingOrder.id;
        console.log(`🔄 Updated order: WC-${wcOrder.number}`);
      } else {
        // Insert new order
        const result = await db.query(
          `INSERT INTO purchase_orders (
            order_number, supplier_id, customer_id, status, order_date,
            subtotal, tax_amount, shipping_cost, discount_amount, total_amount,
            billing_address, shipping_address, notes, metadata, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, NOW(), NOW())
          RETURNING id`,
          [
            nxtOrder.order_number,
            nxtOrder.supplier_id,
            nxtOrder.customer_id,
            nxtOrder.status,
            nxtOrder.order_date,
            nxtOrder.subtotal,
            nxtOrder.tax_amount,
            nxtOrder.shipping_cost,
            nxtOrder.discount_amount,
            nxtOrder.total_amount,
            JSON.stringify(nxtOrder.billing_address),
            JSON.stringify(nxtOrder.shipping_address),
            nxtOrder.notes,
            JSON.stringify(nxtOrder.metadata)
          ]
        );
        
        orderId = result.rows[0].id;
        console.log(`➕ Created order: WC-${wcOrder.number}`);
      }

      // Sync order line items
      await this.syncOrderLineItems(orderId, wcOrder.line_items || []);

      return { synced: true, action: existingOrder ? 'updated' : 'created', orderId };

    } catch (error) {
      throw new Error(`Order sync failed for WC-${wcOrder.number}: ${error.message}`);
    }
  }

  async syncOrderLineItems(orderId, lineItems) {
    try {
      // Clear existing items if updating
      await db.query('DELETE FROM purchase_order_items WHERE purchase_order_id = $1', [orderId]);

      for (const item of lineItems) {
        // Find product by SKU or WC ID
        const product = await db.query(
          `SELECT id, sku, name FROM products 
           WHERE sku = $1 OR (metadata->>'wc_id')::integer = $2`,
          [item.sku, item.product_id]
        );

        let productId = product.rows[0]?.id;
        let productSku = item.sku || `WC-${item.product_id}`;
        let productName = item.name;

        // If product doesn't exist, we might need to sync it first
        if (!productId) {
          console.log(`⚠️ Product not found for line item: ${productName} (${productSku})`);
          // Could trigger product sync here if needed
        }

        // Insert line item
        await db.query(
          `INSERT INTO purchase_order_items (
            purchase_order_id, product_id, quantity, unit_price, line_total,
            product_sku, product_name, product_description, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), NOW())`,
          [
            orderId,
            productId,
            item.quantity,
            parseFloat(item.price),
            parseFloat(item.total),
            productSku,
            productName,
            item.name || ''
          ]
        );
      }

      console.log(`📦 Synced ${lineItems.length} line items for order ${orderId}`);

    } catch (error) {
      console.error(`❌ Line items sync failed for order ${orderId}:`, error.message);
    }
  }

  // ==================== PUSH TO WOOCOMMERCE ====================

  async pushInventoryToWooCommerce(options = {}) {
    const { productIds = [], syncAll = false, syncModifiedSince = null } = options;
    
    if (!this.api) throw new Error('WooCommerce API not configured');

    try {
      let query = `
        SELECT p.id, p.sku, p.metadata, i.quantity_on_hand, i.stock_status
        FROM products p
        LEFT JOIN inventory i ON p.id = i.product_id
        WHERE (p.metadata->>'wc_id') IS NOT NULL
      `;
      let params = [];

      if (!syncAll && productIds.length > 0) {
        query += ` AND p.id = ANY($1)`;
        params = [productIds];
      } else if (syncModifiedSince) {
        query += ` AND (p.updated_at > $1 OR i.updated_at > $1)`;
        params = [syncModifiedSince];
      }

      const result = await db.query(query, params);
      const products = result.rows;

      let updated = 0;
      let errors = [];

      for (const product of products) {
        try {
          const wcId = product.metadata?.wc_id;
          if (!wcId) continue;

          const stockQuantity = product.quantity_on_hand || 0;
          const stockStatus = stockQuantity > 0 ? 'instock' : 'outofstock';

          const updateData = {
            stock_quantity: stockQuantity,
            stock_status: stockStatus,
            manage_stock: true
          };

          await this.apiWithRetry('put', `products/${wcId}`, updateData);
          updated++;
          
          console.log(`📦 Updated WC inventory for ${product.sku}: ${stockQuantity} units`);

        } catch (error) {
          errors.push({
            product_id: product.id,
            sku: product.sku,
            wc_id: product.metadata?.wc_id,
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

  // ==================== WEBHOOK SUPPORT ====================

  async handleWebhook(event, data) {
    try {
      console.log(`🔔 Processing webhook: ${event}`);
      
      switch (event) {
        case 'customer.created':
        case 'customer.updated':
          await this.syncCustomerToNXT(data, true);
          break;
          
        case 'product.created':
        case 'product.updated':
          await this.syncProductToNXT(data, true);
          break;
          
        case 'order.created':
        case 'order.updated':
          await this.syncOrderToNXT(data, true);
          break;
          
        default:
          console.log(`⚠️ Unhandled webhook event: ${event}`);
      }

      // Record webhook processing
      await this.recordSyncEvent(`webhook_${Date.now()}`, 'webhook_processed', {
        event,
        data_id: data.id,
        timestamp: new Date().toISOString()
      });

      return { success: true, event, processed: true };

    } catch (error) {
      console.error(`❌ Webhook processing failed for ${event}:`, error.message);
      
      // Record webhook error
      await this.recordSyncEvent(`webhook_error_${Date.now()}`, 'webhook_failed', {
        event,
        error: error.message,
        timestamp: new Date().toISOString()
      });

      throw error;
    }
  }

  // ==================== UTILITY METHODS ====================

  async ensureWooCommerceSupplier() {
    try {
      // Check if WooCommerce supplier exists
      const existing = await db.query(
        `SELECT id FROM suppliers WHERE supplier_code = 'WOOCOMMERCE'`
      );

      if (existing.rows.length > 0) {
        return existing.rows[0];
      }

      // Create WooCommerce supplier
      const result = await db.query(
        `INSERT INTO suppliers (
          supplier_code, company_name, email, phone, website,
          address, contact_details, supplier_type, industry,
          is_active, is_approved, approved_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW(), NOW())
        RETURNING id`,
        [
          'WOOCOMMERCE',
          'WooCommerce Store',
          process.env.WOOCOMMERCE_ADMIN_EMAIL || 'admin@woocommerce.local',
          '',
          this.config.siteUrl,
          JSON.stringify({ source: 'woocommerce' }),
          JSON.stringify({ type: 'automated_supplier' }),
          'e_commerce',
          'Online Retail',
          true,
          true
        ]
      );

      console.log('✅ Created WooCommerce supplier');
      return result.rows[0];

    } catch (error) {
      throw new Error(`Failed to ensure WooCommerce supplier: ${error.message}`);
    }
  }

  mapWooCommerceStatus(wcStatus) {
    const statusMap = {
      'pending': 'pending',
      'processing': 'approved',
      'on-hold': 'pending',
      'completed': 'received',
      'cancelled': 'cancelled',
      'refunded': 'cancelled',
      'failed': 'cancelled'
    };

    return statusMap[wcStatus] || 'draft';
  }

  async recordInventoryMovement(movement) {
    try {
      await db.query(
        `INSERT INTO inventory_movements (
          inventory_id, product_id, warehouse_id, movement_type, quantity,
          quantity_after, reference_type, reference_id, notes, performed_by, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())`,
        [
          movement.inventoryId,
          movement.productId,
          movement.warehouseId,
          movement.movementType,
          movement.quantity,
          movement.quantityAfter,
          movement.referenceType,
          movement.referenceId,
          movement.notes,
          'system'
        ]
      );
    } catch (error) {
      console.error('❌ Failed to record inventory movement:', error.message);
    }
  }

  async recordSyncEvent(syncId, eventType, data) {
    try {
      // Store in sync log table (create if needed)
      await db.query(`
        CREATE TABLE IF NOT EXISTS woocommerce_sync_log (
          id SERIAL PRIMARY KEY,
          sync_id VARCHAR(100) NOT NULL,
          event_type VARCHAR(50) NOT NULL,
          data JSONB NOT NULL,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
        )
      `);

      await db.query(
        `INSERT INTO woocommerce_sync_log (sync_id, event_type, data) VALUES ($1, $2, $3)`,
        [syncId, eventType, JSON.stringify(data)]
      );
    } catch (error) {
      console.error('❌ Failed to record sync event:', error.message);
    }
  }

  async apiWithRetry(method, endpoint, data = null) {
    let lastError;
    
    for (let attempt = 1; attempt <= this.retryConfig.maxRetries; attempt++) {
      try {
        if (method === 'get') {
          return await this.api.get(endpoint, data);
        } else if (method === 'post') {
          return await this.api.post(endpoint, data);
        } else if (method === 'put') {
          return await this.api.put(endpoint, data);
        } else if (method === 'delete') {
          return await this.api.delete(endpoint);
        }
      } catch (error) {
        lastError = error;
        
        if (attempt < this.retryConfig.maxRetries) {
          const delay = this.retryConfig.retryDelay * Math.pow(this.retryConfig.backoffMultiplier, attempt - 1);
          console.log(`⚠️ API call failed (attempt ${attempt}), retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  async getSyncStatus() {
    try {
      const result = await db.query(`
        SELECT 
          'customers' as entity,
          COUNT(*) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as synced_count,
          MAX(updated_at) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as last_sync
        FROM customers
        UNION ALL
        SELECT 
          'products' as entity,
          COUNT(*) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as synced_count,
          MAX(updated_at) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as last_sync
        FROM products
        UNION ALL
        SELECT 
          'orders' as entity,
          COUNT(*) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as synced_count,
          MAX(updated_at) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as last_sync
        FROM purchase_orders
      `);

      const status = {};
      result.rows.forEach(row => {
        status[row.entity] = {
          syncedCount: parseInt(row.synced_count) || 0,
          lastSync: row.last_sync
        };
      });

      // Add connection status
      status.connection = {
        connected: this.isConnected,
        apiConfigured: !!this.api,
        lastTest: await this.getLastConnectionTest()
      };

      return status;
    } catch (error) {
      throw new Error(`Failed to get sync status: ${error.message}`);
    }
  }

  async getLastConnectionTest() {
    try {
      const result = await db.query(`
        SELECT created_at FROM woocommerce_sync_log 
        WHERE event_type = 'connection_test' 
        ORDER BY created_at DESC LIMIT 1
      `);
      return result.rows[0]?.created_at || null;
    } catch (error) {
      return null;
    }
  }

  async getAnalytics(timeframe = '30d') {
    try {
      const days = parseInt(timeframe.replace('d', ''));
      const dateFrom = new Date();
      dateFrom.setDate(dateFrom.getDate() - days);

      const [customerStats, productStats, orderStats, syncStats] = await Promise.all([
        this.getCustomerAnalytics(dateFrom),
        this.getProductAnalytics(dateFrom),
        this.getOrderAnalytics(dateFrom),
        this.getSyncAnalytics(dateFrom)
      ]);

      return {
        timeframe,
        dateFrom: dateFrom.toISOString(),
        customerStats,
        productStats,
        orderStats,
        syncStats,
        generatedAt: new Date().toISOString()
      };
    } catch (error) {
      throw new Error(`Analytics generation failed: ${error.message}`);
    }
  }

  async getCustomerAnalytics(dateFrom) {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_customers,
        COUNT(*) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as wc_customers,
        COUNT(*) FILTER (WHERE (metadata->>'is_paying_customer')::boolean = true) as paying_customers,
        COUNT(*) FILTER (WHERE created_at >= $1) as new_customers
      FROM customers
    `, [dateFrom]);

    return result.rows[0];
  }

  async getProductAnalytics(dateFrom) {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_products,
        COUNT(*) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as wc_products,
        AVG(unit_price) as average_price,
        SUM(COALESCE(i.quantity_on_hand, 0)) as total_inventory_value,
        COUNT(*) FILTER (WHERE created_at >= $1) as new_products
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
    `, [dateFrom]);

    return result.rows[0];
  }

  async getOrderAnalytics(dateFrom) {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_orders,
        COUNT(*) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as wc_orders,
        AVG(total_amount) as average_order_value,
        SUM(total_amount) as total_revenue,
        COUNT(*) FILTER (WHERE order_date >= $1) as recent_orders
      FROM purchase_orders
      WHERE order_date >= $1
    `, [dateFrom]);

    return result.rows[0];
  }

  async getSyncAnalytics(dateFrom) {
    const result = await db.query(`
      SELECT 
        event_type,
        COUNT(*) as event_count,
        MAX(created_at) as last_occurrence
      FROM woocommerce_sync_log
      WHERE created_at >= $1
      GROUP BY event_type
      ORDER BY event_count DESC
    `, [dateFrom]);

    return result.rows;
  }
}

module.exports = new WooCommerceSyncService();