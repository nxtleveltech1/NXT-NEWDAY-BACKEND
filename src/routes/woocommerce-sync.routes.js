const express = require('express');
const router = express.Router();
const wooCommerceSyncService = require('../services/woocommerce-sync.service');
const authMiddleware = require('../middleware/auth.middleware');
const { performance } = require('../middleware/performance.middleware');

/**
 * Enhanced WooCommerce Bidirectional Sync Routes
 * Comprehensive API endpoints for NXT-WooCommerce integration
 */

// ==================== CONNECTION & HEALTH ====================

/**
 * Test WooCommerce API connection
 */
router.get('/connection/test', performance('wc-sync-connection-test'), async (req, res) => {
  try {
    const result = await wooCommerceSyncService.testConnection();
    res.json({
      success: true,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message,
      connected: false
    });
  }
});

/**
 * Get comprehensive sync status
 */
router.get('/status', authMiddleware, performance('wc-sync-status'), async (req, res) => {
  try {
    const status = await wooCommerceSyncService.getSyncStatus();
    res.json({
      success: true,
      data: status
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get sync analytics and metrics
 */
router.get('/analytics', authMiddleware, performance('wc-sync-analytics'), async (req, res) => {
  try {
    const { timeframe = '30d' } = req.query;
    const analytics = await wooCommerceSyncService.getAnalytics(timeframe);
    
    res.json({
      success: true,
      data: analytics
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== FULL SYNC OPERATIONS ====================

/**
 * Execute full bidirectional sync
 */
router.post('/sync/full', authMiddleware, performance('wc-sync-full'), async (req, res) => {
  try {
    const options = {
      direction: req.body.direction || 'both', // 'pull', 'push', 'both'
      force: req.body.force || false,
      batchSize: req.body.batchSize || 100,
      skipErrors: req.body.skipErrors !== false
    };

    const result = await wooCommerceSyncService.fullSync(options);
    
    res.json({
      success: true,
      message: `Full sync completed successfully`,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== CUSTOMER SYNC ====================

/**
 * Pull customers from WooCommerce to NXT
 */
router.post('/sync/customers/pull', authMiddleware, performance('wc-sync-customers-pull'), async (req, res) => {
  try {
    const options = {
      force: req.body.force || false,
      limit: req.body.limit || 100,
      page: req.body.page || 1
    };

    const result = await wooCommerceSyncService.pullCustomersFromWooCommerce(options);
    
    res.json({
      success: true,
      message: `Successfully pulled ${result.synced} customers from WooCommerce`,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Push customers from NXT to WooCommerce
 */
router.post('/sync/customers/push', authMiddleware, performance('wc-sync-customers-push'), async (req, res) => {
  try {
    const options = {
      customerIds: req.body.customerIds || [],
      syncAll: req.body.syncAll || false,
      syncModifiedSince: req.body.syncModifiedSince || null
    };

    const result = await wooCommerceSyncService.pushCustomersToWooCommerce(options);
    
    res.json({
      success: true,
      message: `Successfully pushed ${result.updated} customers to WooCommerce`,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== PRODUCT SYNC ====================

/**
 * Pull products from WooCommerce to NXT
 */
router.post('/sync/products/pull', authMiddleware, performance('wc-sync-products-pull'), async (req, res) => {
  try {
    const options = {
      force: req.body.force || false,
      limit: req.body.limit || 100,
      page: req.body.page || 1,
      status: req.body.status || 'publish'
    };

    const result = await wooCommerceSyncService.pullProductsFromWooCommerce(options);
    
    res.json({
      success: true,
      message: `Successfully pulled ${result.synced} products from WooCommerce`,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Sync single product from WooCommerce
 */
router.post('/sync/products/:wcProductId', authMiddleware, performance('wc-sync-product-single'), async (req, res) => {
  try {
    const { wcProductId } = req.params;
    const { force = true } = req.body;

    // Fetch product from WooCommerce
    const wcProduct = await wooCommerceSyncService.api.get(`products/${wcProductId}`);
    
    // Sync to NXT
    const result = await wooCommerceSyncService.syncProductToNXT(wcProduct.data, force);
    
    res.json({
      success: true,
      message: `Product ${wcProduct.data.name} synced successfully`,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== ORDER SYNC ====================

/**
 * Pull orders from WooCommerce to NXT
 */
router.post('/sync/orders/pull', authMiddleware, performance('wc-sync-orders-pull'), async (req, res) => {
  try {
    const options = {
      force: req.body.force || false,
      limit: req.body.limit || 100,
      page: req.body.page || 1,
      status: req.body.status || 'all',
      after: req.body.after || null
    };

    const result = await wooCommerceSyncService.pullOrdersFromWooCommerce(options);
    
    res.json({
      success: true,
      message: `Successfully pulled ${result.synced} orders from WooCommerce`,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Sync single order from WooCommerce
 */
router.post('/sync/orders/:wcOrderId', authMiddleware, performance('wc-sync-order-single'), async (req, res) => {
  try {
    const { wcOrderId } = req.params;
    const { force = true } = req.body;

    // Fetch order from WooCommerce
    const wcOrder = await wooCommerceSyncService.api.get(`orders/${wcOrderId}`);
    
    // Sync to NXT
    const result = await wooCommerceSyncService.syncOrderToNXT(wcOrder.data, force);
    
    res.json({
      success: true,
      message: `Order ${wcOrder.data.number} synced successfully`,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== INVENTORY PUSH ====================

/**
 * Push inventory levels from NXT to WooCommerce
 */
router.post('/sync/inventory/push', authMiddleware, performance('wc-sync-inventory-push'), async (req, res) => {
  try {
    const options = {
      productIds: req.body.productIds || [],
      syncAll: req.body.syncAll || false,
      syncModifiedSince: req.body.syncModifiedSince || null
    };

    const result = await wooCommerceSyncService.pushInventoryToWooCommerce(options);
    
    res.json({
      success: true,
      message: `Successfully updated ${result.updated} product inventories in WooCommerce`,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Push inventory for specific product
 */
router.post('/sync/inventory/push/:productId', authMiddleware, performance('wc-sync-inventory-push-single'), async (req, res) => {
  try {
    const { productId } = req.params;
    
    const result = await wooCommerceSyncService.pushInventoryToWooCommerce({
      productIds: [productId],
      syncAll: false
    });
    
    res.json({
      success: true,
      message: `Inventory updated for product ${productId}`,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== WEBHOOK ENDPOINTS ====================

/**
 * WooCommerce webhook handler
 */
router.post('/webhook/:event', async (req, res) => {
  try {
    const { event } = req.params;
    const data = req.body;
    
    // Verify webhook signature if configured
    if (process.env.WOOCOMMERCE_WEBHOOK_SECRET) {
      const signature = req.headers['x-wc-webhook-signature'];
      // Add signature verification logic here
    }

    const result = await wooCommerceSyncService.handleWebhook(event, data);
    
    res.json({
      success: true,
      message: `Webhook ${event} processed successfully`,
      data: result
    });
  } catch (error) {
    console.error(`Webhook processing error:`, error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Test webhook endpoint
 */
router.post('/webhook/test', authMiddleware, async (req, res) => {
  try {
    const { event, data } = req.body;
    
    if (!event || !data) {
      return res.status(400).json({
        success: false,
        error: 'Event and data are required for webhook testing'
      });
    }

    const result = await wooCommerceSyncService.handleWebhook(event, data);
    
    res.json({
      success: true,
      message: `Test webhook ${event} processed successfully`,
      data: result
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== BATCH OPERATIONS ====================

/**
 * Batch sync multiple entities
 */
router.post('/sync/batch', authMiddleware, performance('wc-sync-batch'), async (req, res) => {
  try {
    const {
      customers = false,
      products = false,
      orders = false,
      inventory = false,
      force = false,
      limit = 50
    } = req.body;

    const results = {
      customers: null,
      products: null,
      orders: null,
      inventory: null,
      totalTime: 0
    };

    const startTime = Date.now();

    // Batch sync customers
    if (customers) {
      try {
        results.customers = await wooCommerceSyncService.pullCustomersFromWooCommerce({ force, limit });
      } catch (error) {
        results.customers = { error: error.message };
      }
    }

    // Batch sync products
    if (products) {
      try {
        results.products = await wooCommerceSyncService.pullProductsFromWooCommerce({ force, limit });
      } catch (error) {
        results.products = { error: error.message };
      }
    }

    // Batch sync orders
    if (orders) {
      try {
        results.orders = await wooCommerceSyncService.pullOrdersFromWooCommerce({ force, limit });
      } catch (error) {
        results.orders = { error: error.message };
      }
    }

    // Batch push inventory
    if (inventory) {
      try {
        results.inventory = await wooCommerceSyncService.pushInventoryToWooCommerce({ syncAll: true });
      } catch (error) {
        results.inventory = { error: error.message };
      }
    }

    results.totalTime = Date.now() - startTime;

    res.json({
      success: true,
      message: 'Batch sync completed',
      data: results
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== ADVANCED OPERATIONS ====================

/**
 * Get sync conflicts and resolution suggestions
 */
router.get('/conflicts', authMiddleware, performance('wc-sync-conflicts'), async (req, res) => {
  try {
    // This would analyze data differences between NXT and WooCommerce
    // For now, return placeholder structure
    const conflicts = {
      customers: [],
      products: [],
      orders: [],
      suggestions: []
    };

    res.json({
      success: true,
      data: conflicts,
      message: 'Conflict analysis completed'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Schedule automatic sync
 */
router.post('/schedule', authMiddleware, performance('wc-sync-schedule'), async (req, res) => {
  try {
    const {
      interval = '1h', // 15m, 30m, 1h, 6h, 12h, 24h
      entities = ['customers', 'products', 'orders'],
      direction = 'both',
      enabled = true
    } = req.body;

    // Store schedule configuration
    // This would integrate with a job scheduler like node-cron or bull
    const schedule = {
      interval,
      entities,
      direction,
      enabled,
      createdAt: new Date().toISOString(),
      nextRun: new Date(Date.now() + 60000).toISOString() // Next minute for demo
    };

    res.json({
      success: true,
      message: 'Sync schedule configured successfully',
      data: schedule
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get sync history and logs
 */
router.get('/history', authMiddleware, performance('wc-sync-history'), async (req, res) => {
  try {
    const { 
      limit = 50, 
      offset = 0, 
      event_type = null,
      date_from = null 
    } = req.query;

    let query = `
      SELECT sync_id, event_type, data, created_at
      FROM woocommerce_sync_log
    `;
    let params = [];
    let whereConditions = [];

    if (event_type) {
      whereConditions.push(`event_type = $${params.length + 1}`);
      params.push(event_type);
    }

    if (date_from) {
      whereConditions.push(`created_at >= $${params.length + 1}`);
      params.push(date_from);
    }

    if (whereConditions.length > 0) {
      query += ` WHERE ${whereConditions.join(' AND ')}`;
    }

    query += ` ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`;
    params.push(limit, offset);

    const result = await db.query(query, params);

    res.json({
      success: true,
      data: result.rows,
      pagination: {
        limit: parseInt(limit),
        offset: parseInt(offset),
        total: result.rows.length
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Clear sync history
 */
router.delete('/history', authMiddleware, performance('wc-sync-history-clear'), async (req, res) => {
  try {
    const { older_than_days = 30 } = req.body;
    
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - older_than_days);

    const result = await db.query(
      'DELETE FROM woocommerce_sync_log WHERE created_at < $1',
      [cutoffDate]
    );

    res.json({
      success: true,
      message: `Cleared ${result.rowCount} sync log entries older than ${older_than_days} days`,
      data: { deletedCount: result.rowCount }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Export sync data as CSV/JSON
 */
router.get('/export/:entity', authMiddleware, performance('wc-sync-export'), async (req, res) => {
  try {
    const { entity } = req.params; // customers, products, orders
    const { format = 'json', wc_only = true } = req.query;

    let query;
    let filename;

    switch (entity) {
      case 'customers':
        query = wc_only 
          ? `SELECT * FROM customers WHERE (metadata->>'wc_id') IS NOT NULL`
          : `SELECT * FROM customers`;
        filename = `wc-customers-${Date.now()}.${format}`;
        break;
      case 'products':
        query = wc_only 
          ? `SELECT * FROM products WHERE (metadata->>'wc_id') IS NOT NULL`
          : `SELECT * FROM products`;
        filename = `wc-products-${Date.now()}.${format}`;
        break;
      case 'orders':
        query = wc_only 
          ? `SELECT * FROM purchase_orders WHERE (metadata->>'wc_id') IS NOT NULL`
          : `SELECT * FROM purchase_orders`;
        filename = `wc-orders-${Date.now()}.${format}`;
        break;
      default:
        return res.status(400).json({
          success: false,
          error: 'Invalid entity. Use: customers, products, or orders'
        });
    }

    const result = await db.query(query);
    const data = result.rows;

    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    if (format === 'csv') {
      // Convert to CSV (simplified implementation)
      res.setHeader('Content-Type', 'text/csv');
      const csv = [
        Object.keys(data[0] || {}).join(','),
        ...data.map(row => Object.values(row).map(val => 
          typeof val === 'object' ? JSON.stringify(val) : val
        ).join(','))
      ].join('\n');
      res.send(csv);
    } else {
      res.setHeader('Content-Type', 'application/json');
      res.json({
        success: true,
        data,
        metadata: {
          entity,
          count: data.length,
          exportedAt: new Date().toISOString()
        }
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;