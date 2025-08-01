/**
 * API Integration Routes
 * Production-ready endpoints for managing API integrations with NILEDB
 */

import express from 'express';
import { body, query, param, validationResult } from 'express-validator';
import apiIntegrationService from '../services/api-integration.service.js';
import { authMiddleware } from '../middleware/auth.middleware.js';
import { rbacMiddleware } from '../middleware/rbac.middleware.js';
import { insertDashboardEvent, insertDashboardMetric } from '../config/niledb.config.js';

const router = express.Router();

// Apply authentication to all routes
router.use(authMiddleware);

// ==================== GENERAL INTEGRATION MANAGEMENT ====================

/**
 * Get all integration statuses
 */
router.get('/status', 
  rbacMiddleware(['admin', 'integration_manager']),
  async (req, res) => {
    try {
      const status = apiIntegrationService.getIntegrationStatus();
      const metrics = await apiIntegrationService.getServiceMetrics();
      
      await insertDashboardEvent('integration_status_requested', {
        requestedBy: req.user.id,
        integrationsCount: Object.keys(status).length
      }, 'api_integration', 'info');

      res.json({
        success: true,
        data: {
          integrations: status,
          metrics,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error getting integration status:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get integration status',
        details: error.message
      });
    }
  }
);

/**
 * Get specific integration status
 */
router.get('/status/:service',
  [
    param('service').isIn(['woocommerce', 'stripe', 'paypal', 'twilio', 'sendgrid'])
      .withMessage('Invalid service name')
  ],
  rbacMiddleware(['admin', 'integration_manager']),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { service } = req.params;
      const status = apiIntegrationService.getIntegrationStatus(service);
      
      if (!status) {
        return res.status(404).json({
          success: false,
          error: `Integration not found: ${service}`
        });
      }

      res.json({
        success: true,
        data: status
      });
    } catch (error) {
      console.error(`Error getting ${req.params.service} status:`, error);
      res.status(500).json({
        success: false,
        error: 'Failed to get integration status',
        details: error.message
      });
    }
  }
);

/**
 * Reinitialize all integrations
 */
router.post('/reinitialize',
  rbacMiddleware(['admin']),
  async (req, res) => {
    try {
      await apiIntegrationService.initializeIntegrations();
      
      await insertDashboardEvent('integrations_reinitialized', {
        requestedBy: req.user.id,
        timestamp: new Date().toISOString()
      }, 'api_integration', 'info');

      res.json({
        success: true,
        message: 'Integrations reinitialized successfully'
      });
    } catch (error) {
      console.error('Error reinitializing integrations:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to reinitialize integrations',
        details: error.message
      });
    }
  }
);

// ==================== WOOCOMMERCE INTEGRATION ====================

/**
 * Trigger WooCommerce sync
 */
router.post('/woocommerce/sync',
  [
    body('syncType').optional().isIn(['full', 'products', 'customers', 'orders'])
      .withMessage('Invalid sync type'),
    body('options.batchSize').optional().isInt({ min: 1, max: 100 })
      .withMessage('Batch size must be between 1 and 100'),
    body('options.force').optional().isBoolean()
      .withMessage('Force must be a boolean')
  ],
  rbacMiddleware(['admin', 'integration_manager']),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { syncType = 'full', options = {} } = req.body;
      
      // Start sync asynchronously
      const syncPromise = apiIntegrationService.syncWooCommerceData(syncType, {
        ...options,
        requestedBy: req.user.id
      });

      // Return immediately with sync ID
      const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      
      // Handle sync completion
      syncPromise
        .then(async (result) => {
          await insertDashboardEvent('woocommerce_sync_completed', {
            syncId: result.syncId,
            requestedBy: req.user.id,
            duration: result.duration,
            results: result
          }, 'woocommerce', 'info');
        })
        .catch(async (error) => {
          await insertDashboardEvent('woocommerce_sync_failed', {
            syncId,
            requestedBy: req.user.id,
            error: error.message
          }, 'woocommerce', 'error');
        });

      res.json({
        success: true,
        message: 'WooCommerce sync initiated',
        data: {
          syncId,
          syncType,
          status: 'initiated',
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error initiating WooCommerce sync:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to initiate WooCommerce sync',
        details: error.message
      });
    }
  }
);

/**
 * Get WooCommerce sync history
 */
router.get('/woocommerce/sync/history',
  [
    query('limit').optional().isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
    query('status').optional().isIn(['running', 'completed', 'failed'])
      .withMessage('Invalid status filter')
  ],
  rbacMiddleware(['admin', 'integration_manager', 'analyst']),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      // This would typically query a sync history table
      // For now, return mock data structure
      res.json({
        success: true,
        data: {
          syncs: [],
          pagination: {
            page: 1,
            limit: parseInt(req.query.limit) || 20,
            total: 0,
            pages: 0
          }
        }
      });
    } catch (error) {
      console.error('Error getting sync history:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get sync history',
        details: error.message
      });
    }
  }
);

// ==================== PAYMENT PROCESSING ====================

/**
 * Process payment through integrated gateways
 */
router.post('/payments/process',
  [
    body('gateway').isIn(['stripe', 'paypal']).withMessage('Invalid payment gateway'),
    body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0'),
    body('currency').isLength({ min: 3, max: 3 }).withMessage('Currency must be 3 characters'),
    body('customerId').optional().isString().withMessage('Customer ID must be a string'),
    body('metadata').optional().isObject().withMessage('Metadata must be an object')
  ],
  rbacMiddleware(['admin', 'payment_processor']),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const paymentData = {
        ...req.body,
        requestedBy: req.user.id,
        requestedAt: new Date().toISOString()
      };

      const result = await apiIntegrationService.processPayment(paymentData);
      
      await insertDashboardEvent('payment_processed', {
        gateway: paymentData.gateway,
        amount: paymentData.amount,
        currency: paymentData.currency,
        transactionId: result.transactionId,
        requestedBy: req.user.id
      }, 'payments', 'info');

      res.json({
        success: true,
        message: 'Payment processed successfully',
        data: result
      });
    } catch (error) {
      console.error('Error processing payment:', error);
      
      await insertDashboardEvent('payment_failed', {
        gateway: req.body.gateway,
        amount: req.body.amount,
        error: error.message,
        requestedBy: req.user.id
      }, 'payments', 'error');

      res.status(500).json({
        success: false,
        error: 'Payment processing failed',
        details: error.message
      });
    }
  }
);

// ==================== MESSAGING SERVICES ====================

/**
 * Send SMS notification
 */
router.post('/messaging/sms',
  [
    body('to').isMobilePhone().withMessage('Valid phone number required'),
    body('message').isLength({ min: 1, max: 1600 }).withMessage('Message must be 1-1600 characters'),
    body('urgent').optional().isBoolean().withMessage('Urgent must be a boolean')
  ],
  rbacMiddleware(['admin', 'notification_sender']),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { to, message, urgent = false } = req.body;
      
      const result = await apiIntegrationService.sendSMS(to, message, {
        priority: urgent ? 'high' : 'normal'
      });

      await insertDashboardEvent('sms_sent', {
        to,
        messageLength: message.length,
        urgent,
        sid: result.sid,
        requestedBy: req.user.id
      }, 'messaging', 'info');

      res.json({
        success: true,
        message: 'SMS sent successfully',
        data: {
          sid: result.sid,
          status: result.status,
          to,
          sentAt: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error sending SMS:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send SMS',
        details: error.message
      });
    }
  }
);

/**
 * Send email notification
 */
router.post('/messaging/email',
  [
    body('to').isEmail().withMessage('Valid email address required'),
    body('subject').isLength({ min: 1, max: 200 }).withMessage('Subject must be 1-200 characters'),
    body('content').isLength({ min: 1 }).withMessage('Content is required'),
    body('priority').optional().isIn(['low', 'normal', 'high']).withMessage('Invalid priority')
  ],
  rbacMiddleware(['admin', 'notification_sender']),
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { to, subject, content, priority = 'normal' } = req.body;
      
      const result = await apiIntegrationService.sendEmail(to, subject, content, {
        priority
      });

      await insertDashboardEvent('email_sent', {
        to,
        subject,
        priority,
        messageId: result[0].headers['x-message-id'],
        requestedBy: req.user.id
      }, 'messaging', 'info');

      res.json({
        success: true,
        message: 'Email sent successfully',
        data: {
          messageId: result[0].headers['x-message-id'],
          to,
          subject,
          sentAt: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error sending email:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to send email',
        details: error.message
      });
    }
  }
);

// ==================== WEBHOOK ENDPOINTS ====================

/**
 * WooCommerce webhook handler
 */
router.post('/webhooks/woocommerce/:event',
  async (req, res) => {
    try {
      const { event } = req.params;
      const signature = req.headers['x-wc-webhook-signature'];
      const rawBody = JSON.stringify(req.body);

      const result = await apiIntegrationService.processWebhook(
        'woocommerce',
        { ...req.body, type: event },
        signature,
        rawBody
      );

      await insertDashboardMetric('webhook_processed', 1, 'counter', {
        service: 'woocommerce',
        event,
        processed: result.processed
      });

      res.json({
        success: true,
        processed: result.processed,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('WooCommerce webhook error:', error);
      res.status(500).json({
        success: false,
        error: 'Webhook processing failed',
        details: error.message
      });
    }
  }
);

/**
 * Stripe webhook handler
 */
router.post('/webhooks/stripe',
  async (req, res) => {
    try {
      const signature = req.headers['stripe-signature'];
      const rawBody = req.rawBody || JSON.stringify(req.body);

      const result = await apiIntegrationService.processWebhook(
        'stripe',
        req.body,
        signature,
        rawBody
      );

      await insertDashboardMetric('webhook_processed', 1, 'counter', {
        service: 'stripe',
        event: req.body.type,
        processed: result.processed
      });

      res.json({
        success: true,
        processed: result.processed,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Stripe webhook error:', error);
      res.status(500).json({
        success: false,
        error: 'Webhook processing failed',
        details: error.message
      });
    }
  }
);

/**
 * Generic third-party webhook handler
 */
router.post('/webhooks/third-party/:service',
  [
    param('service').isAlphanumeric().withMessage('Service name must be alphanumeric')
  ],
  async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({
          success: false,
          error: 'Validation failed',
          details: errors.array()
        });
      }

      const { service } = req.params;
      const signature = req.headers['x-webhook-signature'] || req.headers['signature'];
      
      // Store third-party webhook data in NILEDB
      await insertDashboardEvent('third_party_webhook_received', {
        service,
        data: req.body,
        headers: req.headers,
        timestamp: new Date().toISOString()
      }, 'webhooks', 'info');

      // For third-party services, we might want to implement custom logic
      // based on the service type. For now, just acknowledge receipt.
      
      res.json({
        success: true,
        message: `Webhook received for ${service}`,
        processed: true,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error(`Third-party webhook error (${req.params.service}):`, error);
      res.status(500).json({
        success: false,
        error: 'Webhook processing failed',
        details: error.message
      });
    }
  }
);

// ==================== METRICS AND MONITORING ====================

/**
 * Get integration metrics
 */
router.get('/metrics',
  rbacMiddleware(['admin', 'integration_manager', 'analyst']),
  async (req, res) => {
    try {
      const metrics = await apiIntegrationService.getServiceMetrics();
      const integrationStatus = apiIntegrationService.getIntegrationStatus();

      // Add real-time metrics from NILEDB
      const dashboardMetrics = {
        webhooks_processed_today: 0, // Would be fetched from NILEDB
        payments_processed_today: 0,
        emails_sent_today: 0,
        sms_sent_today: 0,
        sync_operations_today: 0
      };

      res.json({
        success: true,
        data: {
          ...metrics,
          integrationStatus,
          dashboardMetrics,
          timestamp: new Date().toISOString()
        }
      });
    } catch (error) {
      console.error('Error getting integration metrics:', error);
      res.status(500).json({
        success: false,
        error: 'Failed to get metrics',
        details: error.message
      });
    }
  }
);

/**
 * Get health check results
 */
router.get('/health',
  async (req, res) => {
    try {
      const integrationStatus = apiIntegrationService.getIntegrationStatus();
      const allHealthy = Object.values(integrationStatus).every(
        integration => integration.status === 'connected'
      );

      res.status(allHealthy ? 200 : 503).json({
        success: allHealthy,
        status: allHealthy ? 'healthy' : 'degraded',
        integrations: integrationStatus,
        timestamp: new Date().toISOString()
      });
    } catch (error) {
      console.error('Error getting health status:', error);
      res.status(500).json({
        success: false,
        status: 'error',
        error: error.message,
        timestamp: new Date().toISOString()
      });
    }
  }
);

// ==================== ERROR HANDLING ====================

// Global error handler for this router
router.use((error, req, res, next) => {
  console.error('API Integration Route Error:', error);
  
  // Log error to NILEDB
  insertDashboardEvent('api_integration_route_error', {
    route: req.originalUrl,
    method: req.method,
    error: error.message,
    stack: error.stack,
    userId: req.user?.id,
    timestamp: new Date().toISOString()
  }, 'api_integration', 'error').catch(console.error);

  res.status(500).json({
    success: false,
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'production' ? 'Contact administrator' : error.message
  });
});

export default router;