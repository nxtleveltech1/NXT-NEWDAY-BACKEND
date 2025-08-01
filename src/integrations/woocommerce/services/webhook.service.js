/**
 * WooCommerce Webhook Management Service
 * Handles real-time webhook events for bi-directional sync
 */

const crypto = require('crypto');
const db = require('../../../config/database');
const EventEmitter = require('events');

class WooCommerceWebhookService extends EventEmitter {
  constructor() {
    super();
    this.config = {};
    this.isReady = false;
    this.endpoints = new Map();
    this.eventQueue = [];
    this.processing = false;
    
    // Webhook event types we handle
    this.supportedEvents = [
      'customer.created',
      'customer.updated',
      'customer.deleted',
      'product.created', 
      'product.updated',
      'product.deleted',
      'order.created',
      'order.updated',
      'order.deleted',
      'coupon.created',
      'coupon.updated',
      'coupon.deleted'
    ];

    // Security configuration
    this.security = {
      validateSignature: true,
      allowedIPs: [], // Empty means allow all
      rateLimitWindow: 60000, // 1 minute
      rateLimitMax: 100 // Max 100 webhooks per minute
    };

    // Rate limiting storage
    this.rateLimitStore = new Map();
  }

  /**
   * Initialize webhook service
   */
  async initialize(config = {}) {
    try {
      this.config = {
        webhookSecret: config.webhookSecret || process.env.WOOCOMMERCE_WEBHOOK_SECRET,
        baseUrl: config.baseUrl || process.env.API_BASE_URL || 'http://localhost:3000',
        enableSecurity: config.enableSecurity !== false,
        ...config
      };

      if (!this.config.webhookSecret) {
        console.warn('⚠️ Webhook secret not configured - webhook validation disabled');
        this.security.validateSignature = false;
      }

      // Initialize webhook tracking table
      await this.initializeWebhookTables();
      
      // Setup default endpoints
      await this.setupDefaultEndpoints();
      
      this.isReady = true;
      console.log('✅ WooCommerce Webhook Service initialized');
      
      return { success: true };
    } catch (error) {
      console.error('❌ Webhook service initialization failed:', error);
      throw error;
    }
  }

  /**
   * Initialize webhook tracking tables
   */
  async initializeWebhookTables() {
    try {
      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_webhook_events (
          id SERIAL PRIMARY KEY,
          webhook_id VARCHAR(100),
          event_type VARCHAR(50) NOT NULL,
          resource_id VARCHAR(100),
          payload JSONB NOT NULL,
          signature VARCHAR(255),
          source_ip VARCHAR(45),
          processing_status VARCHAR(20) DEFAULT 'pending',
          processed_at TIMESTAMP WITH TIME ZONE,
          error_details TEXT,
          retry_count INTEGER DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          INDEX(event_type),
          INDEX(resource_id),
          INDEX(processing_status),
          INDEX(created_at)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_webhook_endpoints (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          url VARCHAR(500) NOT NULL,
          event_types JSONB NOT NULL,
          secret VARCHAR(255),
          is_active BOOLEAN DEFAULT true,
          last_success TIMESTAMP WITH TIME ZONE,
          failure_count INTEGER DEFAULT 0,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          UNIQUE(name)
        )
      `);

      await db.query(`
        CREATE TABLE IF NOT EXISTS wc_webhook_deliveries (
          id SERIAL PRIMARY KEY,
          webhook_event_id INTEGER REFERENCES wc_webhook_events(id),
          endpoint_id INTEGER REFERENCES wc_webhook_endpoints(id),
          delivery_status VARCHAR(20) DEFAULT 'pending',
          http_status INTEGER,
          response_body TEXT,
          delivery_time INTEGER, -- milliseconds
          delivered_at TIMESTAMP WITH TIME ZONE,
          retry_count INTEGER DEFAULT 0,
          next_retry TIMESTAMP WITH TIME ZONE,
          created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
          INDEX(webhook_event_id),
          INDEX(endpoint_id),
          INDEX(delivery_status)
        )
      `);

      console.log('✅ Webhook tracking tables initialized');
    } catch (error) {
      console.error('❌ Failed to initialize webhook tables:', error);
      throw error;
    }
  }

  /**
   * Setup default webhook endpoints
   */
  async setupDefaultEndpoints() {
    const defaultEndpoints = [
      {
        name: 'customer_sync',
        url: `${this.config.baseUrl}/api/woocommerce/webhooks/customer`,
        event_types: ['customer.created', 'customer.updated', 'customer.deleted']
      },
      {
        name: 'product_sync',
        url: `${this.config.baseUrl}/api/woocommerce/webhooks/product`,
        event_types: ['product.created', 'product.updated', 'product.deleted']
      },
      {
        name: 'order_sync',
        url: `${this.config.baseUrl}/api/woocommerce/webhooks/order`,
        event_types: ['order.created', 'order.updated', 'order.deleted']
      }
    ];

    for (const endpoint of defaultEndpoints) {
      await this.registerEndpoint(endpoint);
      this.endpoints.set(endpoint.name, endpoint);
    }
  }

  /**
   * Register webhook endpoint
   */
  async registerEndpoint(endpoint) {
    try {
      await db.query(`
        INSERT INTO wc_webhook_endpoints (name, url, event_types, secret, is_active)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (name) 
        DO UPDATE SET url = $2, event_types = $3, updated_at = NOW()
      `, [
        endpoint.name,
        endpoint.url,
        JSON.stringify(endpoint.event_types),
        endpoint.secret || this.config.webhookSecret,
        endpoint.is_active !== false
      ]);

      console.log(`✅ Webhook endpoint registered: ${endpoint.name}`);
    } catch (error) {
      console.error(`❌ Failed to register endpoint ${endpoint.name}:`, error);
      throw error;
    }
  }

  /**
   * Process incoming webhook event
   */
  async processEvent(eventType, payload, signature = null, sourceIP = null) {
    try {
      console.log(`🔔 Processing webhook event: ${eventType}`);

      // Rate limiting check
      if (!this.checkRateLimit(sourceIP)) {
        throw new Error('Rate limit exceeded');
      }

      // Security validation
      if (this.config.enableSecurity) {
        await this.validateWebhookSecurity(payload, signature, sourceIP);
      }

      // Store webhook event
      const eventId = await this.storeWebhookEvent(eventType, payload, signature, sourceIP);

      // Add to processing queue
      this.eventQueue.push({
        id: eventId,
        eventType,
        payload,
        attempts: 0
      });

      // Start processing if not already running
      if (!this.processing) {
        this.startEventProcessing();
      }

      this.emit('webhookReceived', { eventType, eventId, payload });

      return {
        success: true,
        eventId,
        status: 'queued'
      };

    } catch (error) {
      console.error(`❌ Webhook processing failed for ${eventType}:`, error);
      
      // Store failed event
      const eventId = await this.storeWebhookEvent(eventType, payload, signature, sourceIP, 'failed', error.message);
      
      this.emit('webhookFailed', { eventType, eventId, error: error.message });
      
      throw error;
    }
  }

  /**
   * Validate webhook security
   */
  async validateWebhookSecurity(payload, signature, sourceIP) {
    // IP whitelist check
    if (this.security.allowedIPs.length > 0 && !this.security.allowedIPs.includes(sourceIP)) {
      throw new Error(`IP ${sourceIP} not allowed`);
    }

    // Signature validation
    if (this.security.validateSignature && signature) {
      const expectedSignature = this.generateSignature(payload);
      if (!this.verifySignature(signature, expectedSignature)) {
        throw new Error('Invalid webhook signature');
      }
    }
  }

  /**
   * Generate webhook signature
   */
  generateSignature(payload) {
    const payloadString = typeof payload === 'string' ? payload : JSON.stringify(payload);
    return crypto
      .createHmac('sha256', this.config.webhookSecret)
      .update(payloadString)
      .digest('base64');
  }

  /**
   * Verify webhook signature
   */
  verifySignature(receivedSignature, expectedSignature) {
    // Remove sha256= prefix if present
    const signature = receivedSignature.replace('sha256=', '');
    return crypto.timingSafeEqual(
      Buffer.from(signature, 'base64'),
      Buffer.from(expectedSignature, 'base64')
    );
  }

  /**
   * Check rate limiting
   */
  checkRateLimit(sourceIP) {
    if (!sourceIP) return true;

    const now = Date.now();
    const windowStart = now - this.security.rateLimitWindow;
    
    if (!this.rateLimitStore.has(sourceIP)) {
      this.rateLimitStore.set(sourceIP, []);
    }

    const requests = this.rateLimitStore.get(sourceIP);
    
    // Remove old requests outside the window
    const recentRequests = requests.filter(timestamp => timestamp > windowStart);
    
    if (recentRequests.length >= this.security.rateLimitMax) {
      return false;
    }

    // Add current request
    recentRequests.push(now);
    this.rateLimitStore.set(sourceIP, recentRequests);
    
    return true;
  }

  /**
   * Store webhook event
   */
  async storeWebhookEvent(eventType, payload, signature, sourceIP, status = 'pending', errorDetails = null) {
    try {
      const result = await db.query(`
        INSERT INTO wc_webhook_events (
          event_type, resource_id, payload, signature, source_ip, 
          processing_status, error_details
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING id
      `, [
        eventType,
        payload?.id?.toString() || null,
        JSON.stringify(payload),
        signature,
        sourceIP,
        status,
        errorDetails
      ]);

      return result.rows[0].id;
    } catch (error) {
      console.error('❌ Failed to store webhook event:', error);
      throw error;
    }
  }

  /**
   * Start event processing queue
   */
  async startEventProcessing() {
    if (this.processing) return;
    
    this.processing = true;
    console.log('🚀 Starting webhook event processing...');

    while (this.eventQueue.length > 0) {
      const event = this.eventQueue.shift();
      
      try {
        await this.processQueuedEvent(event);
        
        // Mark as processed
        await this.markEventProcessed(event.id, 'processed');
        
        this.emit('eventProcessed', event);
        
      } catch (error) {
        console.error(`❌ Event processing failed for ${event.eventType}:`, error);
        
        event.attempts++;
        
        if (event.attempts < 3) {
          // Retry with exponential backoff
          setTimeout(() => {
            this.eventQueue.unshift(event);
          }, Math.pow(2, event.attempts) * 1000);
        } else {
          // Mark as failed after max attempts
          await this.markEventProcessed(event.id, 'failed', error.message);
          this.emit('eventFailed', { ...event, error: error.message });
        }
      }
    }

    this.processing = false;
    console.log('✅ Webhook event processing completed');
  }

  /**
   * Process individual queued event
   */
  async processQueuedEvent(event) {
    const { eventType, payload } = event;

    switch (eventType) {
      case 'customer.created':
      case 'customer.updated':
        await this.handleCustomerWebhook(eventType, payload);
        break;
        
      case 'customer.deleted':
        await this.handleCustomerDeletion(payload);
        break;
        
      case 'product.created':
      case 'product.updated':
        await this.handleProductWebhook(eventType, payload);
        break;
        
      case 'product.deleted':
        await this.handleProductDeletion(payload);
        break;
        
      case 'order.created':
      case 'order.updated':
        await this.handleOrderWebhook(eventType, payload);
        break;
        
      case 'order.deleted':
        await this.handleOrderDeletion(payload);
        break;
        
      default:
        console.log(`⚠️ Unhandled webhook event type: ${eventType}`);
    }
  }

  /**
   * Handle customer webhook events
   */
  async handleCustomerWebhook(eventType, customerData) {
    try {
      // Import sync service dynamically to avoid circular dependency
      const SyncService = require('./sync.service');
      
      const result = await SyncService.syncCustomerFromWC(customerData, `webhook_${Date.now()}`, true);
      
      console.log(`✅ Customer ${eventType} processed: ${customerData.email}`);
      return result;
      
    } catch (error) {
      console.error(`❌ Customer webhook processing failed:`, error);
      throw error;
    }
  }

  /**
   * Handle customer deletion
   */
  async handleCustomerDeletion(customerData) {
    try {
      // Find and soft delete or mark inactive
      const result = await db.query(`
        UPDATE customers SET 
          is_active = false, 
          deleted_at = NOW(),
          metadata = jsonb_set(COALESCE(metadata, '{}'), '{deleted_from_wc}', 'true')
        WHERE (metadata->>'wc_id')::integer = $1
        RETURNING id
      `, [customerData.id]);

      if (result.rows.length > 0) {
        console.log(`✅ Customer deleted: WC ID ${customerData.id}`);
      }

      return { deleted: result.rows.length > 0 };
      
    } catch (error) {
      console.error(`❌ Customer deletion processing failed:`, error);
      throw error;
    }
  }

  /**
   * Handle product webhook events
   */
  async handleProductWebhook(eventType, productData) {
    try {
      const SyncService = require('./sync.service');
      
      const result = await SyncService.syncProductFromWC(productData, `webhook_${Date.now()}`, true);
      
      console.log(`✅ Product ${eventType} processed: ${productData.name}`);
      return result;
      
    } catch (error) {
      console.error(`❌ Product webhook processing failed:`, error);
      throw error;
    }
  }

  /**
   * Handle product deletion
   */
  async handleProductDeletion(productData) {
    try {
      const result = await db.query(`
        UPDATE products SET 
          is_active = false,
          deleted_at = NOW(),
          metadata = jsonb_set(COALESCE(metadata, '{}'), '{deleted_from_wc}', 'true')
        WHERE (metadata->>'wc_id')::integer = $1
        RETURNING id
      `, [productData.id]);

      if (result.rows.length > 0) {
        console.log(`✅ Product deleted: WC ID ${productData.id}`);
      }

      return { deleted: result.rows.length > 0 };
      
    } catch (error) {
      console.error(`❌ Product deletion processing failed:`, error);
      throw error;
    }
  }

  /**
   * Handle order webhook events
   */
  async handleOrderWebhook(eventType, orderData) {
    try {
      const SyncService = require('./sync.service');
      
      const result = await SyncService.syncOrderFromWC(orderData, `webhook_${Date.now()}`, true);
      
      console.log(`✅ Order ${eventType} processed: ${orderData.number}`);
      return result;
      
    } catch (error) {
      console.error(`❌ Order webhook processing failed:`, error);
      throw error;
    }
  }

  /**
   * Handle order deletion
   */
  async handleOrderDeletion(orderData) {
    try {
      const result = await db.query(`
        UPDATE purchase_orders SET 
          status = 'cancelled',
          notes = COALESCE(notes, '') || ' [Deleted from WooCommerce]',
          metadata = jsonb_set(COALESCE(metadata, '{}'), '{deleted_from_wc}', 'true'),
          updated_at = NOW()
        WHERE (metadata->>'wc_id')::integer = $1
        RETURNING id
      `, [orderData.id]);

      if (result.rows.length > 0) {
        console.log(`✅ Order deleted: WC ID ${orderData.id}`);
      }

      return { deleted: result.rows.length > 0 };
      
    } catch (error) {
      console.error(`❌ Order deletion processing failed:`, error);
      throw error;
    }
  }

  /**
   * Mark event as processed
   */
  async markEventProcessed(eventId, status, errorDetails = null) {
    try {
      await db.query(`
        UPDATE wc_webhook_events SET 
          processing_status = $1, 
          processed_at = NOW(),
          error_details = $3
        WHERE id = $2
      `, [status, eventId, errorDetails]);
    } catch (error) {
      console.error('❌ Failed to mark event as processed:', error);
    }
  }

  /**
   * Get webhook statistics
   */
  async getWebhookStats(timeframe = '24h') {
    try {
      const hours = parseInt(timeframe.replace('h', ''));
      const since = new Date();
      since.setHours(since.getHours() - hours);

      const result = await db.query(`
        SELECT 
          event_type,
          processing_status,
          COUNT(*) as event_count,
          AVG(EXTRACT(EPOCH FROM (processed_at - created_at))) as avg_processing_time
        FROM wc_webhook_events 
        WHERE created_at >= $1
        GROUP BY event_type, processing_status
        ORDER BY event_type, processing_status
      `, [since]);

      const stats = {
        timeframe,
        since: since.toISOString(),
        events: result.rows,
        summary: {
          total: 0,
          processed: 0,
          failed: 0,
          pending: 0
        }
      };

      // Calculate summary
      result.rows.forEach(row => {
        stats.summary.total += parseInt(row.event_count);
        stats.summary[row.processing_status] += parseInt(row.event_count);
      });

      return stats;
    } catch (error) {
      console.error('❌ Failed to get webhook stats:', error);
      throw error;
    }
  }

  /**
   * Get failed events for retry
   */
  async getFailedEvents(limit = 50) {
    try {
      const result = await db.query(`
        SELECT id, event_type, payload, error_details, retry_count, created_at
        FROM wc_webhook_events 
        WHERE processing_status = 'failed' AND retry_count < 5
        ORDER BY created_at DESC
        LIMIT $1
      `, [limit]);

      return result.rows;
    } catch (error) {
      console.error('❌ Failed to get failed events:', error);
      throw error;
    }
  }

  /**
   * Retry failed events
   */
  async retryFailedEvents(eventIds = []) {
    try {
      let query = `
        SELECT id, event_type, payload
        FROM wc_webhook_events 
        WHERE processing_status = 'failed' AND retry_count < 5
      `;
      let params = [];

      if (eventIds.length > 0) {
        query += ' AND id = ANY($1)';
        params = [eventIds];
      }

      query += ' ORDER BY created_at ASC LIMIT 100';

      const result = await db.query(query, params);
      const events = result.rows;

      let retried = 0;
      for (const event of events) {
        try {
          // Add to processing queue
          this.eventQueue.push({
            id: event.id,
            eventType: event.event_type,
            payload: JSON.parse(event.payload),
            attempts: 0
          });

          // Update retry count
          await db.query(`
            UPDATE wc_webhook_events SET 
              retry_count = retry_count + 1,
              processing_status = 'pending'
            WHERE id = $1
          `, [event.id]);

          retried++;
        } catch (error) {
          console.error(`❌ Failed to retry event ${event.id}:`, error);
        }
      }

      // Start processing if not already running
      if (!this.processing && this.eventQueue.length > 0) {
        this.startEventProcessing();
      }

      return { retried, total: events.length };
    } catch (error) {
      console.error('❌ Failed to retry failed events:', error);
      throw error;
    }
  }

  /**
   * Setup endpoints
   */
  async setupEndpoints() {
    // This method would typically register webhook endpoints with WooCommerce
    // For now, we'll just log that endpoints are ready
    console.log('🔗 Webhook endpoints ready for registration');
    return { success: true, endpoints: Array.from(this.endpoints.keys()) };
  }

  /**
   * Shutdown webhook service
   */
  async shutdown() {
    try {
      this.processing = false;
      this.eventQueue = [];
      this.rateLimitStore.clear();
      console.log('✅ Webhook service shutdown complete');
    } catch (error) {
      console.error('❌ Webhook service shutdown error:', error);
    }
  }

  /**
   * Get service readiness status
   */
  isReady() {
    return this.isReady;
  }
}

module.exports = new WooCommerceWebhookService();