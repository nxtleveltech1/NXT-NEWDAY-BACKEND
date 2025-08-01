/**
 * WooCommerce Integration API Routes
 * Complete API endpoints for managing WooCommerce integration
 */

const express = require('express');
const router = express.Router();
const WooCommerceIntegration = require('../index');

// ==================== INTEGRATION MANAGEMENT ====================

/**
 * Initialize WooCommerce integration
 * POST /api/woocommerce/initialize
 */
router.post('/initialize', async (req, res) => {
  try {
    const config = req.body;
    const result = await WooCommerceIntegration.initialize(config);
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Failed to initialize WooCommerce integration'
    });
  }
});

/**
 * Get integration status
 * GET /api/woocommerce/status
 */
router.get('/status', async (req, res) => {
  try {
    const status = WooCommerceIntegration.getServiceStatus();
    res.json(status);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Get dashboard data
 * GET /api/woocommerce/dashboard
 */
router.get('/dashboard', async (req, res) => {
  try {
    const dashboardData = await WooCommerceIntegration.getDashboardData();
    res.json(dashboardData);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Get comprehensive analytics
 * GET /api/woocommerce/analytics?timeframe=30d
 */
router.get('/analytics', async (req, res) => {
  try {
    const { timeframe = '30d' } = req.query;
    const analytics = await WooCommerceIntegration.getAnalytics(timeframe);
    res.json(analytics);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==================== SYNC OPERATIONS ====================

/**
 * Execute full bi-directional sync
 * POST /api/woocommerce/sync/full
 */
router.post('/sync/full', async (req, res) => {
  try {
    const options = req.body || {};
    const result = await WooCommerceIntegration.fullSync(options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Full sync operation failed'
    });
  }
});

/**
 * Execute batch sync
 * POST /api/woocommerce/sync/batch
 */
router.post('/sync/batch', async (req, res) => {
  try {
    const { syncType, options = {} } = req.body;
    const result = await WooCommerceIntegration.batch.queueBatchSync(syncType, options);
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Batch sync queueing failed'
    });
  }
});

/**
 * Get sync job status
 * GET /api/woocommerce/sync/job/:jobId
 */
router.get('/sync/job/:jobId', async (req, res) => {
  try {
    const { jobId } = req.params;
    const status = await WooCommerceIntegration.batch.getJobStatus(jobId);
    res.json(status);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==================== WEBHOOK ENDPOINTS ====================

/**
 * Handle customer webhooks
 * POST /api/woocommerce/webhooks/customer
 */
router.post('/webhooks/customer', async (req, res) => {
  try {
    const signature = req.headers['x-wc-webhook-signature'];
    const sourceIP = req.ip || req.connection.remoteAddress;
    
    // Determine event type from headers or data
    const eventType = req.headers['x-wc-webhook-event'] || 
                     `customer.${req.body.action || 'updated'}`;
    
    const result = await WooCommerceIntegration.processWebhook(
      eventType, 
      req.body, 
      signature, 
      sourceIP
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Handle product webhooks
 * POST /api/woocommerce/webhooks/product
 */
router.post('/webhooks/product', async (req, res) => {
  try {
    const signature = req.headers['x-wc-webhook-signature'];
    const sourceIP = req.ip || req.connection.remoteAddress;
    
    const eventType = req.headers['x-wc-webhook-event'] || 
                     `product.${req.body.action || 'updated'}`;
    
    const result = await WooCommerceIntegration.processWebhook(
      eventType, 
      req.body, 
      signature, 
      sourceIP
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Handle order webhooks
 * POST /api/woocommerce/webhooks/order
 */
router.post('/webhooks/order', async (req, res) => {
  try {
    const signature = req.headers['x-wc-webhook-signature'];
    const sourceIP = req.ip || req.connection.remoteAddress;
    
    const eventType = req.headers['x-wc-webhook-event'] || 
                     `order.${req.body.action || 'updated'}`;
    
    const result = await WooCommerceIntegration.processWebhook(
      eventType, 
      req.body, 
      signature, 
      sourceIP
    );
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Get webhook statistics
 * GET /api/woocommerce/webhooks/stats?timeframe=24h
 */
router.get('/webhooks/stats', async (req, res) => {
  try {
    const { timeframe = '24h' } = req.query;
    const stats = await WooCommerceIntegration.webhooks.getWebhookStats(timeframe);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Retry failed webhooks
 * POST /api/woocommerce/webhooks/retry
 */
router.post('/webhooks/retry', async (req, res) => {
  try {
    const { eventIds = [] } = req.body;
    const result = await WooCommerceIntegration.webhooks.retryFailedEvents(eventIds);
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==================== CONFLICT MANAGEMENT ====================

/**
 * Get conflict statistics
 * GET /api/woocommerce/conflicts/stats?timeframe=24h
 */
router.get('/conflicts/stats', async (req, res) => {
  try {
    const { timeframe = '24h' } = req.query;
    const stats = await WooCommerceIntegration.conflicts.getConflictStats(timeframe);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Get pending conflicts
 * GET /api/woocommerce/conflicts/pending?limit=50
 */
router.get('/conflicts/pending', async (req, res) => {
  try {
    const { limit = 50 } = req.query;
    const conflicts = await WooCommerceIntegration.conflicts.getPendingConflicts(parseInt(limit));
    res.json(conflicts);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

/**
 * Resolve conflict manually
 * POST /api/woocommerce/conflicts/:conflictId/resolve
 */
router.post('/conflicts/:conflictId/resolve', async (req, res) => {
  try {
    const { conflictId } = req.params;
    const { strategy, resolvedValue, resolvedBy } = req.body;
    
    // This would need to be implemented in the conflict resolver
    const result = {
      success: true,
      conflictId,
      strategy,
      resolvedBy,
      message: 'Manual conflict resolution endpoint - implementation needed'
    };
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==================== ERROR RECOVERY ====================

/**
 * Get error recovery statistics
 * GET /api/woocommerce/errors/stats?timeframe=24h
 */
router.get('/errors/stats', async (req, res) => {
  try {
    const { timeframe = '24h' } = req.query;
    const stats = await WooCommerceIntegration.recovery.getRecoveryStats(timeframe);
    res.json(stats);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==================== MONITORING & HEALTH ====================

/**
 * Health check endpoint
 * GET /api/woocommerce/health
 */
router.get('/health', async (req, res) => {
  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: WooCommerceIntegration.getServiceStatus(),
      uptime: process.uptime()
    };
    
    res.json(health);
  } catch (error) {
    res.status(503).json({ 
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

/**
 * Get real-time metrics
 * GET /api/woocommerce/metrics/realtime
 */
router.get('/metrics/realtime', async (req, res) => {
  try {
    const metrics = {
      sync: WooCommerceIntegration.sync.getStats(),
      batch: WooCommerceIntegration.batch.getStats(),
      timestamp: new Date().toISOString()
    };
    
    res.json(metrics);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message 
    });
  }
});

// ==================== CONFIGURATION ====================

/**
 * Update integration configuration
 * PUT /api/woocommerce/config
 */
router.put('/config', async (req, res) => {
  try {
    const config = req.body;
    
    // Reinitialize with new config
    const result = await WooCommerceIntegration.initialize(config);
    
    res.json(result);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Configuration update failed'
    });
  }
});

/**
 * Test WooCommerce API connection
 * POST /api/woocommerce/test-connection
 */
router.post('/test-connection', async (req, res) => {
  try {
    const { siteUrl, consumerKey, consumerSecret } = req.body;
    
    // Create temporary test connection
    const testResult = await WooCommerceIntegration.sync.testConnection({
      siteUrl,
      consumerKey,
      consumerSecret
    });
    
    res.json(testResult);
  } catch (error) {
    res.status(500).json({ 
      success: false, 
      error: error.message,
      details: 'Connection test failed'
    });
  }
});

// ==================== MIDDLEWARE ====================

/**
 * Webhook signature validation middleware
 */
const validateWebhookSignature = (req, res, next) => {
  try {
    const signature = req.headers['x-wc-webhook-signature'];
    const webhookSecret = process.env.WOOCOMMERCE_WEBHOOK_SECRET;
    
    if (!webhookSecret) {
      console.warn('⚠️ Webhook secret not configured, skipping validation');
      return next();
    }
    
    if (!signature) {
      return res.status(401).json({ 
        success: false, 
        error: 'Missing webhook signature' 
      });
    }
    
    // Signature validation would be implemented here
    // For now, just proceed
    next();
  } catch (error) {
    res.status(401).json({ 
      success: false, 
      error: 'Webhook signature validation failed' 
    });
  }
};

// Apply webhook validation to webhook routes
router.use('/webhooks/*', validateWebhookSignature);

// ==================== ERROR HANDLER ====================

/**
 * Integration-specific error handler
 */
router.use((error, req, res, next) => {
  console.error('WooCommerce Integration Error:', error);
  
  res.status(error.status || 500).json({
    success: false,
    error: error.message || 'Internal server error',
    details: error.details || 'An unexpected error occurred in WooCommerce integration',
    timestamp: new Date().toISOString(),
    path: req.path
  });
});

module.exports = router;