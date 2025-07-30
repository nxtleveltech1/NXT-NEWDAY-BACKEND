const db = require('../config/database');

/**
 * WooCommerce Mapping Database Queries
 * Specialized queries for WooCommerce data mapping and synchronization
 */

class WooCommerceMappingQueries {
  
  // ==================== CUSTOMER MAPPING ====================

  /**
   * Find customers by WooCommerce ID or email
   */
  async findCustomerByWooCommerceData(wcId, email) {
    const query = `
      SELECT id, customer_code, company_name, email, metadata, updated_at
      FROM customers 
      WHERE (metadata->>'wc_id')::integer = $1 OR email = $2
      LIMIT 1
    `;
    const result = await db.query(query, [wcId, email]);
    return result.rows[0] || null;
  }

  /**
   * Get all WooCommerce-synced customers
   */
  async getWooCommerceCustomers(limit = 100, offset = 0) {
    const query = `
      SELECT 
        id, customer_code, company_name, email, phone, address, metadata, 
        created_at, updated_at,
        (metadata->>'wc_id')::integer as wc_id,
        metadata->>'is_paying_customer' as is_paying_customer
      FROM customers 
      WHERE (metadata->>'wc_id') IS NOT NULL
      ORDER BY updated_at DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await db.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Update customer WooCommerce metadata
   */
  async updateCustomerWooCommerceData(customerId, wcData) {
    const query = `
      UPDATE customers 
      SET metadata = metadata || $2::jsonb, updated_at = NOW()
      WHERE id = $1
      RETURNING id, metadata
    `;
    const result = await db.query(query, [customerId, JSON.stringify(wcData)]);
    return result.rows[0];
  }

  /**
   * Get customers modified since specific date for push sync
   */
  async getCustomersModifiedSince(since, hasWcId = true) {
    let query = `
      SELECT id, customer_code, company_name, email, phone, address, metadata, updated_at
      FROM customers 
      WHERE updated_at > $1
    `;
    
    if (hasWcId) {
      query += ` AND (metadata->>'wc_id') IS NOT NULL`;
    }
    
    query += ` ORDER BY updated_at DESC`;
    
    const result = await db.query(query, [since]);
    return result.rows;
  }

  // ==================== PRODUCT MAPPING ====================

  /**
   * Find product by WooCommerce ID or SKU
   */
  async findProductByWooCommerceData(wcId, sku) {
    const query = `
      SELECT id, sku, name, unit_price, cost_price, metadata, supplier_id, updated_at
      FROM products 
      WHERE (metadata->>'wc_id')::integer = $1 OR sku = $2
      LIMIT 1
    `;
    const result = await db.query(query, [wcId, sku]);
    return result.rows[0] || null;
  }

  /**
   * Get all WooCommerce-synced products with inventory
   */
  async getWooCommerceProductsWithInventory(limit = 100, offset = 0) {
    const query = `
      SELECT 
        p.id, p.sku, p.name, p.unit_price, p.cost_price, p.metadata, p.updated_at,
        (p.metadata->>'wc_id')::integer as wc_id,
        p.metadata->>'stock_status' as wc_stock_status,
        (p.metadata->>'stock_quantity')::integer as wc_stock_quantity,
        i.quantity_on_hand, i.stock_status as nxt_stock_status,
        i.updated_at as inventory_updated_at
      FROM products p
      LEFT JOIN inventory i ON p.id = i.product_id
      WHERE (p.metadata->>'wc_id') IS NOT NULL
      ORDER BY p.updated_at DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await db.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Get products with inventory discrepancies
   */
  async getInventoryDiscrepancies() {
    const query = `
      SELECT 
        p.id, p.sku, p.name,
        (p.metadata->>'wc_id')::integer as wc_id,
        (p.metadata->>'stock_quantity')::integer as wc_quantity,
        i.quantity_on_hand as nxt_quantity,
        (i.quantity_on_hand - (p.metadata->>'stock_quantity')::integer) as difference,
        p.updated_at as product_updated,
        i.updated_at as inventory_updated
      FROM products p
      JOIN inventory i ON p.id = i.product_id
      WHERE (p.metadata->>'wc_id') IS NOT NULL
        AND (p.metadata->>'stock_quantity')::integer != i.quantity_on_hand
      ORDER BY ABS(i.quantity_on_hand - (p.metadata->>'stock_quantity')::integer) DESC
    `;
    const result = await db.query(query);
    return result.rows;
  }

  /**
   * Update product inventory from WooCommerce data
   */
  async updateProductInventoryFromWC(productId, wcStockData) {
    const client = await db.getClient();
    
    try {
      await client.query('BEGIN');
      
      // Update product metadata
      await client.query(
        `UPDATE products 
         SET metadata = metadata || $2::jsonb, updated_at = NOW()
         WHERE id = $1`,
        [productId, JSON.stringify(wcStockData)]
      );

      // Get warehouse ID
      const warehouse = await client.query('SELECT id FROM warehouses LIMIT 1');
      if (warehouse.rows.length === 0) {
        throw new Error('No warehouse found');
      }
      const warehouseId = warehouse.rows[0].id;

      const stockQuantity = wcStockData.stock_quantity || 0;
      const stockStatus = stockQuantity > 0 ? 'in_stock' : 'out_of_stock';

      // Update or insert inventory
      const inventoryResult = await client.query(
        `INSERT INTO inventory (product_id, warehouse_id, quantity_on_hand, quantity_available, stock_status, updated_at)
         VALUES ($1, $2, $3, $3, $4, NOW())
         ON CONFLICT (product_id, warehouse_id) 
         DO UPDATE SET 
           quantity_on_hand = $3,
           quantity_available = $3,
           stock_status = $4,
           updated_at = NOW()
         RETURNING id, quantity_on_hand`,
        [productId, warehouseId, stockQuantity, stockStatus]
      );

      await client.query('COMMIT');
      return inventoryResult.rows[0];
      
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get products that need inventory push to WooCommerce
   */
  async getProductsForInventoryPush(modifiedSince = null) {
    let query = `
      SELECT 
        p.id, p.sku, 
        (p.metadata->>'wc_id')::integer as wc_id,
        i.quantity_on_hand, i.stock_status, i.updated_at as inventory_updated
      FROM products p
      JOIN inventory i ON p.id = i.product_id
      WHERE (p.metadata->>'wc_id') IS NOT NULL
    `;
    
    const params = [];
    
    if (modifiedSince) {
      query += ` AND i.updated_at > $1`;
      params.push(modifiedSince);
    }
    
    query += ` ORDER BY i.updated_at DESC`;
    
    const result = await db.query(query, params);
    return result.rows;
  }

  // ==================== ORDER MAPPING ====================

  /**
   * Find order by WooCommerce ID or order number
   */
  async findOrderByWooCommerceData(wcId, orderNumber) {
    const query = `
      SELECT id, order_number, supplier_id, customer_id, status, total_amount, metadata, updated_at
      FROM purchase_orders 
      WHERE (metadata->>'wc_id')::integer = $1 OR order_number = $2
      LIMIT 1
    `;
    const result = await db.query(query, [wcId, orderNumber]);
    return result.rows[0] || null;
  }

  /**
   * Get all WooCommerce orders with customer details
   */
  async getWooCommerceOrdersWithDetails(limit = 100, offset = 0) {
    const query = `
      SELECT 
        po.id, po.order_number, po.status, po.total_amount, po.order_date,
        (po.metadata->>'wc_id')::integer as wc_id,
        po.metadata->>'wc_status' as wc_status,
        c.company_name as customer_name, c.email as customer_email,
        COUNT(poi.id) as line_items_count
      FROM purchase_orders po
      LEFT JOIN customers c ON po.customer_id = c.id
      LEFT JOIN purchase_order_items poi ON po.id = poi.purchase_order_id
      WHERE (po.metadata->>'wc_id') IS NOT NULL
      GROUP BY po.id, c.company_name, c.email
      ORDER BY po.order_date DESC
      LIMIT $1 OFFSET $2
    `;
    const result = await db.query(query, [limit, offset]);
    return result.rows;
  }

  /**
   * Get order line items for WooCommerce order
   */
  async getOrderLineItems(orderId) {
    const query = `
      SELECT 
        poi.id, poi.product_id, poi.quantity, poi.unit_price, poi.line_total,
        poi.product_sku, poi.product_name,
        p.metadata->>'wc_id' as wc_product_id
      FROM purchase_order_items poi
      LEFT JOIN products p ON poi.product_id = p.id
      WHERE poi.purchase_order_id = $1
      ORDER BY poi.created_at
    `;
    const result = await db.query(query, [orderId]);
    return result.rows;
  }

  /**
   * Get orders with status mismatches
   */
  async getOrderStatusDiscrepancies() {
    const query = `
      SELECT 
        id, order_number,
        (metadata->>'wc_id')::integer as wc_id,
        status as nxt_status,
        metadata->>'wc_status' as wc_status,
        updated_at
      FROM purchase_orders
      WHERE (metadata->>'wc_id') IS NOT NULL
        AND status != CASE 
          WHEN metadata->>'wc_status' = 'pending' THEN 'pending'
          WHEN metadata->>'wc_status' = 'processing' THEN 'approved'
          WHEN metadata->>'wc_status' = 'completed' THEN 'received'
          WHEN metadata->>'wc_status' = 'cancelled' THEN 'cancelled'
          ELSE status
        END
      ORDER BY updated_at DESC
    `;
    const result = await db.query(query);
    return result.rows;
  }

  // ==================== SYNC ANALYTICS ====================

  /**
   * Get comprehensive sync statistics
   */
  async getSyncStatistics() {
    const query = `
      SELECT 
        'customers' as entity,
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as wc_synced,
        MAX(updated_at) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as last_wc_sync,
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '24 hours' AND (metadata->>'wc_id') IS NOT NULL) as synced_24h
      FROM customers
      
      UNION ALL
      
      SELECT 
        'products' as entity,
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as wc_synced,
        MAX(updated_at) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as last_wc_sync,
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '24 hours' AND (metadata->>'wc_id') IS NOT NULL) as synced_24h
      FROM products
      
      UNION ALL
      
      SELECT 
        'orders' as entity,
        COUNT(*) as total_records,
        COUNT(*) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as wc_synced,
        MAX(updated_at) FILTER (WHERE (metadata->>'wc_id') IS NOT NULL) as last_wc_sync,
        COUNT(*) FILTER (WHERE updated_at > NOW() - INTERVAL '24 hours' AND (metadata->>'wc_id') IS NOT NULL) as synced_24h
      FROM purchase_orders
    `;
    
    const result = await db.query(query);
    
    const stats = {};
    result.rows.forEach(row => {
      stats[row.entity] = {
        totalRecords: parseInt(row.total_records),
        wcSynced: parseInt(row.wc_synced),
        lastWcSync: row.last_wc_sync,
        synced24h: parseInt(row.synced_24h)
      };
    });
    
    return stats;
  }

  /**
   * Get sync performance metrics
   */
  async getSyncPerformanceMetrics(days = 7) {
    const query = `
      SELECT 
        DATE(created_at) as sync_date,
        event_type,
        COUNT(*) as event_count,
        AVG(CASE 
          WHEN data->>'duration' IS NOT NULL 
          THEN (data->>'duration')::integer 
          ELSE NULL 
        END) as avg_duration_ms
      FROM woocommerce_sync_log
      WHERE created_at >= NOW() - INTERVAL '${days} days'
      GROUP BY DATE(created_at), event_type
      ORDER BY sync_date DESC, event_count DESC
    `;
    
    const result = await db.query(query);
    return result.rows;
  }

  /**
   * Get recent sync errors
   */
  async getRecentSyncErrors(limit = 50) {
    const query = `
      SELECT 
        sync_id, event_type, data, created_at
      FROM woocommerce_sync_log
      WHERE event_type LIKE '%failed%' OR event_type LIKE '%error%'
      ORDER BY created_at DESC
      LIMIT $1
    `;
    
    const result = await db.query(query, [limit]);
    return result.rows;
  }

  // ==================== CONFLICT RESOLUTION ====================

  /**
   * Detect data conflicts between NXT and WooCommerce
   */
  async detectDataConflicts() {
    const conflicts = {
      customers: [],
      products: [],
      orders: []
    };

    // Customer conflicts (email mismatches, etc.)
    const customerConflicts = await db.query(`
      SELECT 
        id, customer_code, email,
        (metadata->>'wc_id')::integer as wc_id,
        metadata->>'first_name' as wc_first_name,
        metadata->>'last_name' as wc_last_name,
        updated_at
      FROM customers
      WHERE (metadata->>'wc_id') IS NOT NULL
        AND (
          email != COALESCE(metadata->>'email', email) OR
          company_name != COALESCE(
            CONCAT(metadata->>'first_name', ' ', metadata->>'last_name'), 
            company_name
          )
        )
    `);
    
    conflicts.customers = customerConflicts.rows;

    // Product conflicts (price mismatches, inventory discrepancies)
    conflicts.products = await this.getInventoryDiscrepancies();

    // Order conflicts (status mismatches)
    conflicts.orders = await this.getOrderStatusDiscrepancies();

    return conflicts;
  }

  /**
   * Get mapping suggestions for unmapped records
   */
  async getMappingSuggestions() {
    const suggestions = {
      customers: [],
      products: []
    };

    // Customers without WC ID that might match by email
    const customerSuggestions = await db.query(`
      SELECT 
        id, customer_code, company_name, email, created_at
      FROM customers
      WHERE (metadata->>'wc_id') IS NULL
        AND email LIKE '%@%'
      ORDER BY created_at DESC
      LIMIT 100
    `);
    
    suggestions.customers = customerSuggestions.rows;

    // Products without WC ID that might match by SKU pattern
    const productSuggestions = await db.query(`
      SELECT 
        id, sku, name, unit_price, created_at
      FROM products
      WHERE (metadata->>'wc_id') IS NULL
        AND (sku LIKE 'WC-%' OR sku ~ '^[0-9]+$')
      ORDER BY created_at DESC
      LIMIT 100
    `);
    
    suggestions.products = productSuggestions.rows;

    return suggestions;
  }

  // ==================== CLEANUP OPERATIONS ====================

  /**
   * Clean up orphaned WooCommerce references
   */
  async cleanupOrphanedReferences() {
    const results = {
      customersUpdated: 0,
      productsUpdated: 0,
      ordersUpdated: 0
    };

    // This would involve checking against WooCommerce API to verify
    // that referenced WC IDs still exist, and cleaning up metadata
    // for records that no longer exist in WooCommerce
    
    return results;
  }

  /**
   * Archive old sync logs
   */
  async archiveOldSyncLogs(olderThanDays = 90) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

    const result = await db.query(
      'DELETE FROM woocommerce_sync_log WHERE created_at < $1',
      [cutoffDate]
    );

    return {
      deletedCount: result.rowCount,
      cutoffDate: cutoffDate.toISOString()
    };
  }
}

module.exports = new WooCommerceMappingQueries();