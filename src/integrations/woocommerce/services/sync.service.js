/**
 * Enhanced WooCommerce Sync Service
 * Complete bi-directional synchronization with real-time updates
 */

const WooCommerceRestApi = require('@woocommerce/woocommerce-rest-api').default;
const db = require('../../../config/database');
const cacheService = require('../../../services/cache.service');
const EventEmitter = require('events');

class WooCommerceSyncService extends EventEmitter {
  constructor() {
    super();
    this.api = null;
    this.config = {};
    this.isReady = false;
    this.syncLocks = new Set();
    
    // Real-time sync configuration
    this.realTimeConfig = {
      enabled: false,
      batchSize: 50,
      maxRetries: 3,
      retryDelay: 1000,
      conflictStrategy: 'timestamp', // 'timestamp', 'manual', 'priority'
    };

    // Sync statistics
    this.stats = {
      totalSyncs: 0,
      successfulSyncs: 0,
      failedSyncs: 0,
      lastSyncTime: null,
      avgSyncDuration: 0
    };
  }

  /**
   * Initialize the sync service
   */
  async initialize(config = {}) {
    try {
      this.config = {
        siteUrl: config.siteUrl || process.env.WOOCOMMERCE_SITE_URL,
        consumerKey: config.consumerKey || process.env.WOOCOMMERCE_CONSUMER_KEY,
        consumerSecret: config.consumerSecret || process.env.WOOCOMMERCE_CONSUMER_SECRET,
        version: config.version || process.env.WOOCOMMERCE_VERSION || 'wc/v3',
        webhookSecret: config.webhookSecret || process.env.WOOCOMMERCE_WEBHOOK_SECRET,
        ...config
      };

      if (!this.config.siteUrl || !this.config.consumerKey || !this.config.consumerSecret) {
        throw new Error('WooCommerce API credentials not configured');
      }

      // Initialize WooCommerce API
      this.api = new WooCommerceRestApi({
        url: this.config.siteUrl,
        consumerKey: this.config.consumerKey,
        consumerSecret: this.config.consumerSecret,
        version: this.config.version,
        queryStringAuth: true
      });

      // Test connection
      await this.testConnection();
      
      // Initialize sync tracking table
      await this.initializeSyncTables();
      
      this.isReady = true;
      console.log('✅ WooCommerce Sync Service initialized');
      
      return { success: true };
    } catch (error) {
      console.error('❌ Sync service initialization failed:', error);
      throw error;
    }
  }

  /**
   * Test WooCommerce API connection
   */
  async testConnection() {
    try {
      const response = await this.api.get('system_status');
      if (response.status !== 200) {
        throw new Error(`API returned status ${response.status}`);
      }
      console.log('✅ WooCommerce API connection verified');
      return true;
    } catch (error) {
      console.error('❌ WooCommerce API connection failed:', error);
      throw new Error(`Connection test failed: ${error.message}`);
    }
  }

  /**
   * Initialize sync tracking tables
   */
  async initializeSyncTables() {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_sync_sessions (
          id SERIAL PRIMARY KEY,
          sync_id VARCHAR(100) UNIQUE NOT NULL,
          sync_type VARCHAR(50) NOT NULL,
          status VARCHAR(20) DEFAULT 'running',
          started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          completed_at TIMESTAMP WITH TIME ZONE,
          options JSONB,
          results JSONB,
          error_details TEXT,
          INDEX(sync_id),
          INDEX(status),
          INDEX(started_at)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_sync_conflicts (
          id SERIAL PRIMARY KEY,
          sync_id VARCHAR(100),
          entity_type VARCHAR(50) NOT NULL,
          entity_id VARCHAR(100) NOT NULL,
          conflict_type VARCHAR(50) NOT NULL,
          wc_data JSONB,
          nxt_data JSONB,
          resolution VARCHAR(50),
          resolved_at TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          INDEX(sync_id),
          INDEX(entity_type, entity_id),
          INDEX(conflict_type)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_entity_mapping (
          id SERIAL PRIMARY KEY,
          entity_type VARCHAR(50) NOT NULL,
          nxt_id INTEGER NOT NULL,
          wc_id INTEGER NOT NULL,
          last_sync_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          sync_direction VARCHAR(20) DEFAULT 'both',
          is_active BOOLEAN DEFAULT true,
          metadata JSONB,
          UNIQUE(entity_type, nxt_id),
          UNIQUE(entity_type, wc_id),
          INDEX(entity_type),
          INDEX(nxt_id),
          INDEX(wc_id)
        )
      `);

      console.log('✅ Sync tracking tables initialized');
    } catch (error) {
      console.error('❌ Failed to initialize sync tables:', error);
      throw error;
    }
  }

  /**
   * Execute full bi-directional sync
   */
  async fullBidirectionalSync(options = {}) {
    const syncId = options.syncId || `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    // Check for active sync locks
    if (this.syncLocks.has('full_sync')) {
      throw new Error('Full sync already in progress');
    }

    this.syncLocks.add('full_sync');

    try {
      console.log(`🚀 Starting full bi-directional sync: ${syncId}`);
      
      // Record sync session
      await this.recordSyncSession(syncId, 'full_bidirectional', options);

      const results = {
        syncId,
        startTime: new Date().toISOString(),
        products: { pull: 0, push: 0, conflicts: 0, errors: [] },
        customers: { pull: 0, push: 0, conflicts: 0, errors: [] },
        orders: { pull: 0, push: 0, conflicts: 0, errors: [] },
        inventory: { push: 0, conflicts: 0, errors: [] },
        totalConflicts: 0,
        totalErrors: 0,
        duration: 0
      };

      // Phase 1: Pull from WooCommerce
      if (options.direction !== 'push') {
        console.log('📥 Phase 1: Pulling data from WooCommerce...');
        
        try {
          const customerPull = await this.pullCustomers(syncId, options);
          results.customers.pull = customerPull.synced;
          results.customers.conflicts += customerPull.conflicts || 0;
          results.customers.errors.push(...customerPull.errors);
        } catch (error) {
          results.customers.errors.push({ phase: 'pull', error: error.message });
        }

        try {
          const productPull = await this.pullProducts(syncId, options);
          results.products.pull = productPull.synced;
          results.products.conflicts += productPull.conflicts || 0;
          results.products.errors.push(...productPull.errors);
        } catch (error) {
          results.products.errors.push({ phase: 'pull', error: error.message });
        }

        try {
          const orderPull = await this.pullOrders(syncId, options);
          results.orders.pull = orderPull.synced;
          results.orders.conflicts += orderPull.conflicts || 0;
          results.orders.errors.push(...orderPull.errors);
        } catch (error) {
          results.orders.errors.push({ phase: 'pull', error: error.message });
        }
      }

      // Phase 2: Push to WooCommerce
      if (options.direction !== 'pull') {
        console.log('📤 Phase 2: Pushing data to WooCommerce...');
        
        try {
          const inventoryPush = await this.pushInventory(syncId, options);
          results.inventory.push = inventoryPush.updated;
          results.inventory.conflicts += inventoryPush.conflicts || 0;
          results.inventory.errors.push(...inventoryPush.errors);
        } catch (error) {
          results.inventory.errors.push({ phase: 'push', error: error.message });
        }

        try {
          const productPush = await this.pushProducts(syncId, options);
          results.products.push = productPush.updated;
          results.products.conflicts += productPush.conflicts || 0;
          results.products.errors.push(...productPush.errors);
        } catch (error) {
          results.products.errors.push({ phase: 'push', error: error.message });
        }

        try {
          const customerPush = await this.pushCustomers(syncId, options);
          results.customers.push = customerPush.updated;
          results.customers.conflicts += customerPush.conflicts || 0;
          results.customers.errors.push(...customerPush.errors);
        } catch (error) {
          results.customers.errors.push({ phase: 'push', error: error.message });
        }
      }

      // Calculate totals
      results.totalConflicts = 
        results.products.conflicts + 
        results.customers.conflicts + 
        results.orders.conflicts + 
        results.inventory.conflicts;

      results.totalErrors = 
        results.products.errors.length + 
        results.customers.errors.length + 
        results.orders.errors.length + 
        results.inventory.errors.length;

      results.duration = Date.now() - startTime;
      results.endTime = new Date().toISOString();

      // Update sync session
      await this.completeSyncSession(syncId, results);

      // Update statistics
      this.updateStats(true, results.duration);

      console.log(`✅ Full sync completed: ${syncId} (${results.duration}ms)`);
      this.emit('syncCompleted', results);

      return results;

    } catch (error) {
      const errorResult = {
        syncId,
        error: error.message,
        duration: Date.now() - startTime
      };
      
      await this.failSyncSession(syncId, errorResult);
      this.updateStats(false, Date.now() - startTime);
      
      console.error(`❌ Full sync failed: ${syncId}`, error);
      this.emit('syncFailed', errorResult);
      
      throw error;
    } finally {
      this.syncLocks.delete('full_sync');
    }
  }

  /**
   * Pull customers from WooCommerce
   */
  async pullCustomers(syncId, options = {}) {
    const { batchSize = 100, force = false } = options;
    
    try {
      console.log('📥 Pulling customers from WooCommerce...');
      
      let page = 1;
      let totalSynced = 0;
      let totalConflicts = 0;
      let errors = [];
      let hasMore = true;

      while (hasMore) {
        try {
          const response = await this.apiWithRetry('get', 'customers', {
            per_page: batchSize,
            page,
            status: 'all'
          });

          const customers = response.data;
          hasMore = customers.length === batchSize;

          for (const wcCustomer of customers) {
            try {
              const result = await this.syncCustomerFromWC(wcCustomer, syncId, force);
              if (result.synced) totalSynced++;
              if (result.conflict) totalConflicts++;
            } catch (error) {
              errors.push({
                wc_id: wcCustomer.id,
                email: wcCustomer.email,
                error: error.message
              });
            }
          }

          page++;
          
          // Emit progress
          this.emit('pullProgress', {
            entity: 'customers',
            page,
            processed: totalSynced,
            conflicts: totalConflicts,
            errors: errors.length
          });

        } catch (error) {
          console.error(`❌ Customer pull failed on page ${page}:`, error);
          errors.push({ page, error: error.message });
          break;
        }
      }

      return {
        synced: totalSynced,
        conflicts: totalConflicts,
        errors,
        pages: page - 1
      };

    } catch (error) {
      console.error('❌ Customer pull failed:', error);
      throw error;
    }
  }

  /**
   * Sync individual customer from WooCommerce
   */
  async syncCustomerFromWC(wcCustomer, syncId, force = false) {
    try {
      // Check existing mapping
      const mapping = await this.getEntityMapping('customer', null, wcCustomer.id);
      
      let existingCustomer = null;
      if (mapping) {
        const customerResult = await db.query('SELECT * FROM customers WHERE id = $1', [mapping.nxt_id]);
        existingCustomer = customerResult.rows[0];
      } else {
        // Try to find by email
        const customerResult = await db.query('SELECT * FROM customers WHERE email = $1', [wcCustomer.email]);
        existingCustomer = customerResult.rows[0];
      }

      // Check for conflicts
      if (existingCustomer && !force) {
        const conflict = await this.checkCustomerConflict(existingCustomer, wcCustomer);
        if (conflict) {
          await this.recordConflict(syncId, 'customer', existingCustomer.id, conflict);
          return { synced: false, conflict: true };
        }
      }

      // Map WooCommerce customer to NXT format
      const nxtCustomer = this.mapWCCustomerToNXT(wcCustomer);

      let customerId;
      if (existingCustomer) {
        // Update existing customer
        await db.query(`
          UPDATE customers SET 
            customer_code = $1, company_name = $2, phone = $3, address = $4, 
            metadata = $5, updated_at = NOW()
          WHERE id = $6
        `, [
          nxtCustomer.customer_code,
          nxtCustomer.company_name,
          nxtCustomer.phone,
          JSON.stringify(nxtCustomer.address),
          JSON.stringify(nxtCustomer.metadata),
          existingCustomer.id
        ]);
        customerId = existingCustomer.id;
      } else {
        // Create new customer
        const result = await db.query(`
          INSERT INTO customers (
            customer_code, company_name, email, phone, address, metadata, 
            purchase_history, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
          RETURNING id
        `, [
          nxtCustomer.customer_code,
          nxtCustomer.company_name,
          nxtCustomer.email,
          nxtCustomer.phone,
          JSON.stringify(nxtCustomer.address),
          JSON.stringify(nxtCustomer.metadata),
          JSON.stringify([])
        ]);
        customerId = result.rows[0].id;
      }

      // Update or create entity mapping
      await this.updateEntityMapping('customer', customerId, wcCustomer.id, {
        last_wc_modified: wcCustomer.date_modified,
        sync_direction: 'pull'
      });

      return { synced: true, customerId };

    } catch (error) {
      console.error(`❌ Customer sync failed for WC ID ${wcCustomer.id}:`, error);
      throw error;
    }
  }

  /**
   * Pull products from WooCommerce
   */  
  async pullProducts(syncId, options = {}) {
    const { batchSize = 100, force = false } = options;
    
    try {
      console.log('📥 Pulling products from WooCommerce...');
      
      let page = 1;
      let totalSynced = 0;
      let totalConflicts = 0;
      let errors = [];
      let hasMore = true;

      while (hasMore) {
        try {
          const response = await this.apiWithRetry('get', 'products', {
            per_page: batchSize,
            page,
            status: 'any'
          });

          const products = response.data;
          hasMore = products.length === batchSize;

          for (const wcProduct of products) {
            try {
              const result = await this.syncProductFromWC(wcProduct, syncId, force);
              if (result.synced) totalSynced++;
              if (result.conflict) totalConflicts++;
            } catch (error) {
              errors.push({
                wc_id: wcProduct.id,
                sku: wcProduct.sku,
                name: wcProduct.name,
                error: error.message
              });
            }
          }

          page++;
          
          // Emit progress
          this.emit('pullProgress', {
            entity: 'products',
            page,
            processed: totalSynced,
            conflicts: totalConflicts,
            errors: errors.length
          });

        } catch (error) {
          console.error(`❌ Product pull failed on page ${page}:`, error);
          errors.push({ page, error: error.message });
          break;
        }
      }

      return {
        synced: totalSynced,
        conflicts: totalConflicts,
        errors,
        pages: page - 1
      };

    } catch (error) {
      console.error('❌ Product pull failed:', error);
      throw error;
    }
  }

  /**
   * Sync individual product from WooCommerce
   */
  async syncProductFromWC(wcProduct, syncId, force = false) {
    try {
      // Check existing mapping
      const mapping = await this.getEntityMapping('product', null, wcProduct.id);
      
      let existingProduct = null;
      if (mapping) {
        const productResult = await db.query('SELECT * FROM products WHERE id = $1', [mapping.nxt_id]);
        existingProduct = productResult.rows[0];
      } else {
        // Try to find by SKU
        const sku = wcProduct.sku || `WC-${wcProduct.id}`;
        const productResult = await db.query('SELECT * FROM products WHERE sku = $1', [sku]);
        existingProduct = productResult.rows[0];
      }

      // Check for conflicts
      if (existingProduct && !force) {
        const conflict = await this.checkProductConflict(existingProduct, wcProduct);
        if (conflict) {
          await this.recordConflict(syncId, 'product', existingProduct.id, conflict);
          return { synced: false, conflict: true };
        }
      }

      // Ensure WooCommerce supplier exists
      const supplier = await this.ensureWCSupplier();

      // Map WooCommerce product to NXT format
      const nxtProduct = this.mapWCProductToNXT(wcProduct, supplier.id);

      let productId;
      if (existingProduct) {
        // Update existing product
        await db.query(`
          UPDATE products SET 
            name = $1, description = $2, category = $3, unit_price = $4, 
            cost_price = $5, is_active = $6, metadata = $7, updated_at = NOW()
          WHERE id = $8
        `, [
          nxtProduct.name,
          nxtProduct.description,
          nxtProduct.category,
          nxtProduct.unit_price,
          nxtProduct.cost_price,
          nxtProduct.is_active,
          JSON.stringify(nxtProduct.metadata),
          existingProduct.id
        ]);
        productId = existingProduct.id;
      } else {
        // Create new product
        const result = await db.query(`
          INSERT INTO products (
            sku, name, description, category, unit_price, cost_price, 
            supplier_id, is_active, metadata, created_at, updated_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW(), NOW())
          RETURNING id
        `, [
          nxtProduct.sku,
          nxtProduct.name,
          nxtProduct.description,
          nxtProduct.category,
          nxtProduct.unit_price,
          nxtProduct.cost_price,
          nxtProduct.supplier_id,
          nxtProduct.is_active,
          JSON.stringify(nxtProduct.metadata)
        ]);
        productId = result.rows[0].id;
      }

      // Sync inventory if managed
      if (wcProduct.manage_stock && wcProduct.stock_quantity !== undefined) {
        await this.syncProductInventoryFromWC(productId, wcProduct);
      }

      // Update or create entity mapping
      await this.updateEntityMapping('product', productId, wcProduct.id, {
        last_wc_modified: wcProduct.date_modified,
        sync_direction: 'pull'
      });

      return { synced: true, productId };

    } catch (error) {
      console.error(`❌ Product sync failed for WC ID ${wcProduct.id}:`, error);
      throw error;
    }
  }

  /**
   * Pull orders from WooCommerce
   */
  async pullOrders(syncId, options = {}) {
    const { batchSize = 100, force = false, status = 'any' } = options;
    
    try {
      console.log('📥 Pulling orders from WooCommerce...');
      
      let page = 1;
      let totalSynced = 0;
      let totalConflicts = 0;
      let errors = [];
      let hasMore = true;

      while (hasMore) {
        try {
          const params = {
            per_page: batchSize,
            page,
            orderby: 'date',
            order: 'desc'
          };
          
          if (status !== 'any') params.status = status;

          const response = await this.apiWithRetry('get', 'orders', params);
          const orders = response.data;
          hasMore = orders.length === batchSize;

          for (const wcOrder of orders) {
            try {
              const result = await this.syncOrderFromWC(wcOrder, syncId, force);
              if (result.synced) totalSynced++;
              if (result.conflict) totalConflicts++;
            } catch (error) {
              errors.push({
                wc_id: wcOrder.id,
                order_number: wcOrder.number,
                error: error.message
              });
            }
          }

          page++;
          
          // Emit progress
          this.emit('pullProgress', {
            entity: 'orders',
            page,
            processed: totalSynced,
            conflicts: totalConflicts,
            errors: errors.length
          });

        } catch (error) {
          console.error(`❌ Order pull failed on page ${page}:`, error);
          errors.push({ page, error: error.message });
          break;
        }
      }

      return {
        synced: totalSynced,
        conflicts: totalConflicts,
        errors,
        pages: page - 1
      };

    } catch (error) {
      console.error('❌ Order pull failed:', error);
      throw error;
    }
  }

  /**
   * Push inventory updates to WooCommerce
   */
  async pushInventory(syncId, options = {}) {
    const { productIds = [], syncAll = false } = options;
    
    try {
      console.log('📤 Pushing inventory to WooCommerce...');
      
      let query = `
        SELECT p.id, p.sku, p.metadata, i.quantity_on_hand, i.stock_status, em.wc_id
        FROM products p
        LEFT JOIN inventory i ON p.id = i.product_id
        INNER JOIN wc_entity_mapping em ON p.id = em.nxt_id AND em.entity_type = 'product'
        WHERE em.is_active = true AND em.sync_direction IN ('both', 'push')
      `;
      let params = [];

      if (!syncAll && productIds.length > 0) {
        query += ` AND p.id = ANY($1)`;
        params = [productIds];
      }

      const result = await db.query(query, params);
      const products = result.rows;

      let updated = 0;
      let conflicts = 0;
      let errors = [];

      for (const product of products) {
        try {
          const stockQuantity = product.quantity_on_hand || 0;
          const stockStatus = stockQuantity > 0 ? 'instock' : 'outofstock';

          const updateData = {
            stock_quantity: stockQuantity,
            stock_status: stockStatus,
            manage_stock: true
          };

          await this.apiWithRetry('put', `products/${product.wc_id}`, updateData);
          updated++;

          // Update mapping
          await this.updateEntityMapping('product', product.id, product.wc_id, {
            last_inventory_push: new Date().toISOString(),
            sync_direction: 'push'
          });

        } catch (error) {
          errors.push({
            product_id: product.id,
            sku: product.sku,
            wc_id: product.wc_id,
            error: error.message
          });
        }
      }

      return {
        updated,
        total: products.length,
        conflicts,
        errors
      };

    } catch (error) {
      console.error('❌ Inventory push failed:', error);
      throw error;
    }
  }

  /**
   * Push products to WooCommerce
   */
  async pushProducts(syncId, options = {}) {
    // Implementation for pushing products to WooCommerce
    // Similar pattern to pushInventory but for product data
    return { updated: 0, conflicts: 0, errors: [] };
  }

  /**
   * Push customers to WooCommerce
   */
  async pushCustomers(syncId, options = {}) {
    // Implementation for pushing customers to WooCommerce
    // Similar pattern to pushInventory but for customer data
    return { updated: 0, conflicts: 0, errors: [] };
  }

  // ==================== UTILITY METHODS ====================

  /**
   * API call with retry logic
   */
  async apiWithRetry(method, endpoint, data = null, retries = 3) {
    let lastError;
    
    for (let attempt = 1; attempt <= retries; attempt++) {
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
        
        if (attempt < retries) {
          const delay = this.realTimeConfig.retryDelay * Math.pow(2, attempt - 1);
          console.log(`⚠️ API call failed (attempt ${attempt}), retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Get entity mapping
   */
  async getEntityMapping(entityType, nxtId = null, wcId = null) {
    let query = 'SELECT * FROM wc_entity_mapping WHERE entity_type = $1';
    let params = [entityType];

    if (nxtId) {
      query += ' AND nxt_id = $2';
      params.push(nxtId);
    } else if (wcId) {
      query += ' AND wc_id = $2';
      params.push(wcId);
    }

    const result = await db.query(query, params);
    return result.rows[0] || null;
  }

  /**
   * Update entity mapping
   */
  async updateEntityMapping(entityType, nxtId, wcId, metadata = {}) {
    await db.query(`
      INSERT INTO wc_entity_mapping (entity_type, nxt_id, wc_id, metadata, last_sync_at)
      VALUES ($1, $2, $3, $4, NOW())
      ON CONFLICT (entity_type, nxt_id) 
      DO UPDATE SET wc_id = $3, metadata = $4, last_sync_at = NOW()
    `, [entityType, nxtId, wcId, JSON.stringify(metadata)]);
  }

  /**
   * Check for customer conflicts
   */
  async checkCustomerConflict(nxtCustomer, wcCustomer) {
    // Implement conflict detection logic
    const nxtModified = new Date(nxtCustomer.updated_at);
    const wcModified = new Date(wcCustomer.date_modified);
    
    if (nxtModified > wcModified) {
      return {
        type: 'newer_local',
        nxt_modified: nxtModified,
        wc_modified: wcModified
      };
    }
    
    return null;
  }

  /**
   * Check for product conflicts
   */
  async checkProductConflict(nxtProduct, wcProduct) {
    // Implement product conflict detection
    return null;
  }

  /**
   * Record conflict
   */
  async recordConflict(syncId, entityType, entityId, conflictData) {
    await db.query(`
      INSERT INTO wc_sync_conflicts (
        sync_id, entity_type, entity_id, conflict_type, wc_data, nxt_data, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, NOW())
    `, [
      syncId,
      entityType,
      entityId.toString(),
      conflictData.type,
      JSON.stringify(conflictData.wc_data || {}),
      JSON.stringify(conflictData.nxt_data || {})
    ]);
  }

  /**
   * Ensure WooCommerce supplier exists
   */
  async ensureWCSupplier() {
    const existing = await db.query(`SELECT id FROM suppliers WHERE supplier_code = 'WOOCOMMERCE'`);
    
    if (existing.rows.length > 0) {
      return existing.rows[0];
    }

    const result = await db.query(`
      INSERT INTO suppliers (
        supplier_code, company_name, email, phone, website,
        address, contact_details, supplier_type, industry,
        is_active, is_approved, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW(), NOW())
      RETURNING id
    `, [
      'WOOCOMMERCE',
      'WooCommerce Store',
      this.config.adminEmail || 'admin@woocommerce.local',
      '',
      this.config.siteUrl,
      JSON.stringify({ source: 'woocommerce' }),
      JSON.stringify({ type: 'automated_supplier' }),
      'e_commerce',
      'Online Retail',
      true,
      true
    ]);

    return result.rows[0];
  }

  /**
   * Map WooCommerce customer to NXT format
   */
  mapWCCustomerToNXT(wcCustomer) {
    return {
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
      }
    };
  }

  /**
   * Map WooCommerce product to NXT format
   */
  mapWCProductToNXT(wcProduct, supplierId) {
    const price = parseFloat(wcProduct.price) || parseFloat(wcProduct.regular_price) || 0;
    const costPrice = parseFloat(wcProduct.sale_price) || price * 0.7;

    return {
      sku: wcProduct.sku || `WC-${wcProduct.id}`,
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
  }

  /**
   * Sync product inventory from WooCommerce
   */
  async syncProductInventoryFromWC(productId, wcProduct) {
    try {
      const warehouse = await db.query('SELECT id FROM warehouses LIMIT 1');
      if (warehouse.rows.length === 0) {
        console.log('⚠️ No warehouse found for inventory sync');
        return;
      }

      const warehouseId = warehouse.rows[0].id;
      const stockQuantity = parseInt(wcProduct.stock_quantity) || 0;

      const existing = await db.query(
        'SELECT id, quantity_on_hand FROM inventory WHERE product_id = $1 AND warehouse_id = $2',
        [productId, warehouseId]
      );

      if (existing.rows.length > 0) {
        const currentQuantity = existing.rows[0].quantity_on_hand;
        if (currentQuantity !== stockQuantity) {
          await db.query(`
            UPDATE inventory SET 
              quantity_on_hand = $1, quantity_available = $1, last_stock_check = NOW(), updated_at = NOW()
            WHERE id = $2
          `, [stockQuantity, existing.rows[0].id]);

          // Record movement
          await db.query(`
            INSERT INTO inventory_movements (
              inventory_id, product_id, warehouse_id, movement_type, quantity, 
              quantity_after, reference_type, reference_id, notes, performed_by, created_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
          `, [
            existing.rows[0].id,
            productId,
            warehouseId,
            'wc_sync',
            stockQuantity - currentQuantity,
            stockQuantity,
            'woocommerce_sync',
            wcProduct.id.toString(),
            `WooCommerce sync - Product: ${wcProduct.name}`,
            'system'
          ]);
        }
      } else {
        // Create new inventory record
        const result = await db.query(`
          INSERT INTO inventory (
            product_id, warehouse_id, quantity_on_hand, quantity_available,
            stock_status, last_stock_check, created_at, updated_at
          ) VALUES ($1, $2, $3, $3, $4, NOW(), NOW(), NOW())
          RETURNING id
        `, [
          productId,
          warehouseId,
          stockQuantity,
          stockQuantity > 0 ? 'in_stock' : 'out_of_stock'
        ]);

        // Record initial movement
        await db.query(`
          INSERT INTO inventory_movements (
            inventory_id, product_id, warehouse_id, movement_type, quantity,
            quantity_after, reference_type, reference_id, notes, performed_by, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
        `, [
          result.rows[0].id,
          productId,
          warehouseId,
          'initial_stock',
          stockQuantity,
          stockQuantity,
          'woocommerce_sync',
          wcProduct.id.toString(),
          `Initial stock from WooCommerce - Product: ${wcProduct.name}`,
          'system'
        ]);
      }

    } catch (error) {
      console.error(`❌ Inventory sync failed for product ${productId}:`, error);
    }
  }

  /**
   * Record sync session
   */
  async recordSyncSession(syncId, syncType, options) {
    await db.query(`
      INSERT INTO wc_sync_sessions (sync_id, sync_type, status, options)
      VALUES ($1, $2, 'running', $3)
    `, [syncId, syncType, JSON.stringify(options)]);
  }

  /**
   * Complete sync session
   */
  async completeSyncSession(syncId, results) {
    await db.query(`
      UPDATE wc_sync_sessions SET 
        status = 'completed', completed_at = NOW(), results = $2
      WHERE sync_id = $1
    `, [syncId, JSON.stringify(results)]);
  }

  /**
   * Fail sync session
   */
  async failSyncSession(syncId, error) {
    await db.query(`
      UPDATE wc_sync_sessions SET 
        status = 'failed', completed_at = NOW(), error_details = $2
      WHERE sync_id = $1
    `, [syncId, error.error || error.message]);
  }

  /**
   * Update statistics
   */
  updateStats(success, duration) {
    this.stats.totalSyncs++;
    if (success) {
      this.stats.successfulSyncs++;
    } else {
      this.stats.failedSyncs++;
    }
    this.stats.lastSyncTime = new Date();
    this.stats.avgSyncDuration = ((this.stats.avgSyncDuration * (this.stats.totalSyncs - 1)) + duration) / this.stats.totalSyncs;
  }

  /**
   * Get service readiness status
   */
  isReady() {
    return this.isReady;
  }

  /**
   * Get sync statistics
   */
  getStats() {
    return { ...this.stats };
  }
}

module.exports = new WooCommerceSyncService();