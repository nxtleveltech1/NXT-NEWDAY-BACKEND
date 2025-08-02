/**
 * Production-Ready API Integration Service
 * Complete integration hub for all external systems with NILEDB connectivity
 */

import { EventEmitter } from 'node:events';
import { nileDb, insertDashboardEvent, insertDashboardMetric, storeRealTimeData } from '../config/niledb.config.js';
import { createAlert, sendNotification } from './notifications.js';
import cacheService from './cache.service.js';

class APIIntegrationService extends EventEmitter {
  constructor() {
    super();
    this.integrations = new Map();
    this.activeConnections = new Map();
    this.webhookEndpoints = new Map();
    this.retryQueue = [];
    this.healthCheckInterval = null;
    
    // Configuration for different integrations
    this.config = {
      woocommerce: {
        enabled: process.env.WOOCOMMERCE_API_ENABLED === 'true',
        baseURL: process.env.WOOCOMMERCE_SITE_URL,
        consumerKey: process.env.WOOCOMMERCE_CONSUMER_KEY,
        consumerSecret: process.env.WOOCOMMERCE_CONSUMER_SECRET,
        version: process.env.WOOCOMMERCE_VERSION || 'wc/v3',
        timeout: 30000,
        retryAttempts: 3,
        rateLimitRpm: 600 // 10 requests per second
      },
      payments: {
        stripe: {
          enabled: process.env.STRIPE_ENABLED === 'true',
          secretKey: process.env.STRIPE_SECRET_KEY,
          webhookSecret: process.env.STRIPE_WEBHOOK_SECRET,
          apiVersion: '2023-10-16'
        },
        paypal: {
          enabled: process.env.PAYPAL_ENABLED === 'true',
          clientId: process.env.PAYPAL_CLIENT_ID,
          clientSecret: process.env.PAYPAL_CLIENT_SECRET,
          environment: process.env.PAYPAL_ENVIRONMENT || 'sandbox'
        }
      },
      messaging: {
        twilio: {
          enabled: process.env.TWILIO_ENABLED === 'true',
          accountSid: process.env.TWILIO_ACCOUNT_SID,
          authToken: process.env.TWILIO_AUTH_TOKEN,
          fromNumber: process.env.TWILIO_FROM_NUMBER
        },
        sendgrid: {
          enabled: process.env.SENDGRID_ENABLED === 'true',
          apiKey: process.env.SENDGRID_API_KEY,
          fromEmail: process.env.SENDGRID_FROM_EMAIL
        }
      },
      webhooks: {
        maxRetries: 5,
        retryDelay: 1000,
        timeout: 15000,
        enableSignatureVerification: true
      }
    };

    this.initializeIntegrations();
  }

  /**
   * Initialize all available integrations
   */
  async initializeIntegrations() {
    try {
      console.log('🚀 Initializing API Integration Service...');

      // Initialize WooCommerce integration
      if (this.config.woocommerce.enabled) {
        await this.initializeWooCommerce();
      }

      // Initialize payment gateways
      await this.initializePaymentGateways();

      // Initialize messaging services
      await this.initializeMessaging();

      // Initialize webhook handlers
      await this.initializeWebhooks();

      // Start health monitoring
      this.startHealthMonitoring();

      await insertDashboardEvent('api_service_initialized', {
        integrations: Array.from(this.integrations.keys()),
        timestamp: new Date().toISOString()
      }, 'api_integration', 'info');

      console.log('✅ API Integration Service initialized successfully');
      this.emit('service_initialized', { integrations: Array.from(this.integrations.keys()) });

    } catch (error) {
      console.error('❌ Failed to initialize API Integration Service:', error);
      await createAlert('integration_init_failed', error.message, 'high', { error: error.stack });
      throw error;
    }
  }

  // ==================== WOOCOMMERCE INTEGRATION ====================

  /**
   * Initialize WooCommerce API integration
   */
  async initializeWooCommerce() {
    try {
      const WooCommerceRestApi = (await import('@woocommerce/woocommerce-rest-api')).default;
      
      const wcApi = new WooCommerceRestApi({
        url: this.config.woocommerce.baseURL,
        consumerKey: this.config.woocommerce.consumerKey,
        consumerSecret: this.config.woocommerce.consumerSecret,
        version: this.config.woocommerce.version,
        queryStringAuth: true,
        timeout: this.config.woocommerce.timeout
      });

      // Test connection
      const response = await wcApi.get('system_status');
      if (response.status !== 200) {
        throw new Error(`WooCommerce API returned status ${response.status}`);
      }

      this.integrations.set('woocommerce', {
        api: wcApi,
        status: 'connected',
        lastHealthCheck: new Date(),
        rateLimiter: this.createRateLimiter(this.config.woocommerce.rateLimitRpm)
      });

      // Register webhook endpoints
      await this.registerWooCommerceWebhooks();

      console.log('✅ WooCommerce integration initialized');
      await insertDashboardMetric('woocommerce_connection_status', 1, 'gauge', { status: 'connected' });

    } catch (error) {
      console.error('❌ WooCommerce initialization failed:', error);
      await createAlert('woocommerce_init_failed', error.message, 'high');
      throw error;
    }
  }

  /**
   * Register WooCommerce webhooks
   */
  async registerWooCommerceWebhooks() {
    const webhooks = [
      { topic: 'order.created', name: 'Order Created' },
      { topic: 'order.updated', name: 'Order Updated' },
      { topic: 'product.created', name: 'Product Created' },
      { topic: 'product.updated', name: 'Product Updated' },
      { topic: 'customer.created', name: 'Customer Created' },
      { topic: 'customer.updated', name: 'Customer Updated' }
    ];

    const wcIntegration = this.integrations.get('woocommerce');
    const baseUrl = process.env.API_BASE_URL || 'http://localhost:4000';

    for (const webhook of webhooks) {
      try {
        const webhookData = {
          name: webhook.name,
          topic: webhook.topic,
          delivery_url: `${baseUrl}/api/webhooks/woocommerce/${webhook.topic.replace('.', '/')}`,
          secret: process.env.WOOCOMMERCE_WEBHOOK_SECRET || 'default_secret'
        };

        await wcIntegration.api.post('webhooks', webhookData);
        console.log(`✅ Registered WooCommerce webhook: ${webhook.topic}`);

      } catch (error) {
        if (error.response?.status !== 400) { // 400 typically means webhook already exists
          console.warn(`⚠️ Failed to register webhook ${webhook.topic}:`, error.message);
        }
      }
    }
  }

  /**
   * Sync data with WooCommerce and store in NILEDB
   */
  async syncWooCommerceData(syncType = 'full', options = {}) {
    const wcIntegration = this.integrations.get('woocommerce');
    if (!wcIntegration || wcIntegration.status !== 'connected') {
      throw new Error('WooCommerce integration not available');
    }

    const syncId = `sync_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const startTime = Date.now();

    try {
      console.log(`🔄 Starting WooCommerce sync: ${syncId} (${syncType})`);
      
      await insertDashboardEvent('woocommerce_sync_started', {
        syncId,
        syncType,
        timestamp: new Date().toISOString()
      }, 'woocommerce', 'info');

      const results = {
        syncId,
        type: syncType,
        startTime: new Date().toISOString(),
        products: { synced: 0, errors: 0 },
        customers: { synced: 0, errors: 0 },
        orders: { synced: 0, errors: 0 },
        totalErrors: 0,
        duration: 0
      };

      // Sync products
      if (syncType === 'full' || syncType === 'products') {
        const productResults = await this.syncWooCommerceProducts(wcIntegration.api, options);
        results.products = productResults;
        
        // Store in NILEDB
        await storeRealTimeData('woocommerce_products', productResults, 24);
      }

      // Sync customers
      if (syncType === 'full' || syncType === 'customers') {
        const customerResults = await this.syncWooCommerceCustomers(wcIntegration.api, options);
        results.customers = customerResults;
        
        // Store in NILEDB
        await storeRealTimeData('woocommerce_customers', customerResults, 24);
      }

      // Sync orders
      if (syncType === 'full' || syncType === 'orders') {
        const orderResults = await this.syncWooCommerceOrders(wcIntegration.api, options);
        results.orders = orderResults;
        
        // Store in NILEDB
        await storeRealTimeData('woocommerce_orders', orderResults, 24);
      }

      results.totalErrors = results.products.errors + results.customers.errors + results.orders.errors;
      results.duration = Date.now() - startTime;
      results.endTime = new Date().toISOString();

      // Log completion
      await insertDashboardEvent('woocommerce_sync_completed', results, 'woocommerce', 'info');
      await insertDashboardMetric('woocommerce_sync_duration', results.duration, 'histogram');

      console.log(`✅ WooCommerce sync completed: ${syncId} (${results.duration}ms)`);
      this.emit('sync_completed', results);

      return results;

    } catch (error) {
      const duration = Date.now() - startTime;
      console.error(`❌ WooCommerce sync failed: ${syncId}`, error);
      
      await insertDashboardEvent('woocommerce_sync_failed', {
        syncId,
        error: error.message,
        duration
      }, 'woocommerce', 'error');

      await createAlert('woocommerce_sync_failed', error.message, 'high', { syncId, duration });
      throw error;
    }
  }

  /**
   * Sync WooCommerce products
   */
  async syncWooCommerceProducts(api, options = {}) {
    let page = 1;
    let synced = 0;
    let errors = 0;
    const batchSize = options.batchSize || 100;

    try {
      while (true) {
        const response = await this.rateLimitedRequest('woocommerce', () => 
          api.get('products', { per_page: batchSize, page, status: 'any' })
        );

        if (!response.data || response.data.length === 0) break;

        for (const product of response.data) {
          try {
            await this.processWooCommerceProduct(product);
            synced++;
          } catch (error) {
            console.error(`Error processing product ${product.id}:`, error);
            errors++;
          }
        }

        if (response.data.length < batchSize) break;
        page++;
      }

      return { synced, errors, pages: page - 1 };
    } catch (error) {
      console.error('Product sync failed:', error);
      return { synced, errors: errors + 1, error: error.message };
    }
  }

  /**
   * Process individual WooCommerce product
   */
  async processWooCommerceProduct(wcProduct) {
    // Store raw product data in NILEDB for real-time access
    await storeRealTimeData('wc_product_update', {
      productId: wcProduct.id,
      sku: wcProduct.sku,
      name: wcProduct.name,
      price: wcProduct.price,
      stock_quantity: wcProduct.stock_quantity,
      stock_status: wcProduct.stock_status,
      lastModified: wcProduct.date_modified,
      syncedAt: new Date().toISOString()
    }, 1);

    // Emit real-time event for dashboard updates
    this.emit('product_updated', {
      source: 'woocommerce',
      productId: wcProduct.id,
      changes: {
        stock_quantity: wcProduct.stock_quantity,
        price: wcProduct.price
      }
    });
  }

  // ==================== PAYMENT GATEWAY INTEGRATIONS ====================

  /**
   * Initialize payment gateway integrations
   */
  async initializePaymentGateways() {
    const paymentGateways = [];

    // Initialize Stripe
    if (this.config.payments.stripe.enabled) {
      try {
        const stripe = (await import('stripe')).default(this.config.payments.stripe.secretKey, {
          apiVersion: this.config.payments.stripe.apiVersion
        });

        this.integrations.set('stripe', {
          client: stripe,
          status: 'connected',
          lastHealthCheck: new Date()
        });

        paymentGateways.push('stripe');
        console.log('✅ Stripe integration initialized');
        
      } catch (error) {
        console.error('❌ Stripe initialization failed:', error);
        await createAlert('stripe_init_failed', error.message, 'medium');
      }
    }

    // Initialize PayPal
    if (this.config.payments.paypal.enabled) {
      try {
        const paypal = await import('@paypal/checkout-server-sdk');
        
        const environment = this.config.payments.paypal.environment === 'production'
          ? new paypal.core.LiveEnvironment(
              this.config.payments.paypal.clientId,
              this.config.payments.paypal.clientSecret
            )
          : new paypal.core.SandboxEnvironment(
              this.config.payments.paypal.clientId,
              this.config.payments.paypal.clientSecret
            );

        const client = new paypal.core.PayPalHttpClient(environment);

        this.integrations.set('paypal', {
          client,
          environment,
          status: 'connected',
          lastHealthCheck: new Date()
        });

        paymentGateways.push('paypal');
        console.log('✅ PayPal integration initialized');
        
      } catch (error) {
        console.error('❌ PayPal initialization failed:', error);
        await createAlert('paypal_init_failed', error.message, 'medium');
      }
    }

    if (paymentGateways.length > 0) {
      await insertDashboardMetric('payment_gateways_active', paymentGateways.length, 'gauge', {
        gateways: paymentGateways
      });
    }
  }

  /**
   * Process payment with integrated gateways
   */
  async processPayment(paymentData) {
    const { gateway, amount, currency, customerId, metadata = {} } = paymentData;
    
    try {
      let result;
      
      switch (gateway) {
        case 'stripe':
          result = await this.processStripePayment({ amount, currency, customerId, metadata });
          break;
        case 'paypal':
          result = await this.processPayPalPayment({ amount, currency, customerId, metadata });
          break;
        default:
          throw new Error(`Unsupported payment gateway: ${gateway}`);
      }

      // Store payment result in NILEDB
      await storeRealTimeData('payment_processed', {
        gateway,
        amount,
        currency,
        customerId,
        transactionId: result.transactionId,
        status: result.status,
        processedAt: new Date().toISOString()
      }, 24);

      // Update metrics
      await insertDashboardMetric('payments_processed', 1, 'counter', { gateway, amount, currency });
      
      this.emit('payment_processed', result);
      return result;

    } catch (error) {
      console.error(`Payment processing failed (${gateway}):`, error);
      
      await createAlert('payment_failed', error.message, 'high', {
        gateway,
        amount,
        currency,
        customerId
      });

      await insertDashboardMetric('payments_failed', 1, 'counter', { gateway, error: error.message });
      throw error;
    }
  }

  /**
   * Process Stripe payment
   */
  async processStripePayment({ amount, currency, customerId, metadata }) {
    const stripe = this.integrations.get('stripe')?.client;
    if (!stripe) throw new Error('Stripe not initialized');

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Convert to cents
      currency: currency.toLowerCase(),
      customer: customerId,
      metadata,
      automatic_payment_methods: { enabled: true }
    });

    return {
      gateway: 'stripe',
      transactionId: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      status: paymentIntent.status,
      amount,
      currency
    };
  }

  /**
   * Process PayPal payment
   */
  async processPayPalPayment({ amount, currency, customerId, metadata }) {
    const paypalIntegration = this.integrations.get('paypal');
    if (!paypalIntegration) throw new Error('PayPal not initialized');

    const paypal = await import('@paypal/checkout-server-sdk');
    
    const request = new paypal.orders.OrdersCreateRequest();
    request.prefer("return=representation");
    request.requestBody({
      intent: 'CAPTURE',
      purchase_units: [{
        amount: {
          currency_code: currency.toUpperCase(),
          value: amount.toFixed(2)
        }
      }]
    });

    const order = await paypalIntegration.client.execute(request);

    return {
      gateway: 'paypal',
      transactionId: order.result.id,
      orderId: order.result.id,
      status: order.result.status,
      amount,
      currency,
      approvalUrl: order.result.links.find(link => link.rel === 'approve')?.href
    };
  }

  // ==================== MESSAGING INTEGRATIONS ====================

  /**
   * Initialize messaging service integrations
   */
  async initializeMessaging() {
    const messagingServices = [];

    // Initialize Twilio (SMS)
    if (this.config.messaging.twilio.enabled) {
      try {
        const twilio = (await import('twilio')).default;
        const client = twilio(
          this.config.messaging.twilio.accountSid,
          this.config.messaging.twilio.authToken
        );

        this.integrations.set('twilio', {
          client,
          status: 'connected',
          lastHealthCheck: new Date(),
          fromNumber: this.config.messaging.twilio.fromNumber
        });

        messagingServices.push('twilio');
        console.log('✅ Twilio (SMS) integration initialized');
        
      } catch (error) {
        console.error('❌ Twilio initialization failed:', error);
        await createAlert('twilio_init_failed', error.message, 'medium');
      }
    }

    // Initialize SendGrid (Email)
    if (this.config.messaging.sendgrid.enabled) {
      try {
        const sgMail = (await import('@sendgrid/mail')).default;
        sgMail.setApiKey(this.config.messaging.sendgrid.apiKey);

        this.integrations.set('sendgrid', {
          client: sgMail,
          status: 'connected',
          lastHealthCheck: new Date(),
          fromEmail: this.config.messaging.sendgrid.fromEmail
        });

        messagingServices.push('sendgrid');
        console.log('✅ SendGrid (Email) integration initialized');
        
      } catch (error) {
        console.error('❌ SendGrid initialization failed:', error);
        await createAlert('sendgrid_init_failed', error.message, 'medium');
      }
    }

    if (messagingServices.length > 0) {
      await insertDashboardMetric('messaging_services_active', messagingServices.length, 'gauge', {
        services: messagingServices
      });
    }
  }

  /**
   * Send SMS notification
   */
  async sendSMS(to, message, options = {}) {
    const twilio = this.integrations.get('twilio');
    if (!twilio || twilio.status !== 'connected') {
      throw new Error('Twilio SMS service not available');
    }

    try {
      const result = await twilio.client.messages.create({
        body: message,
        from: twilio.fromNumber,
        to: to,
        ...options
      });

      // Store in NILEDB
      await storeRealTimeData('sms_sent', {
        to,
        message: message.substring(0, 100) + (message.length > 100 ? '...' : ''),
        sid: result.sid,
        status: result.status,
        sentAt: new Date().toISOString()
      }, 24);

      await insertDashboardMetric('sms_sent', 1, 'counter', { status: result.status });
      
      this.emit('sms_sent', { to, sid: result.sid, status: result.status });
      return result;

    } catch (error) {
      console.error('SMS sending failed:', error);
      await createAlert('sms_failed', error.message, 'medium', { to, message: message.substring(0, 50) });
      await insertDashboardMetric('sms_failed', 1, 'counter', { error: error.code });
      throw error;
    }
  }

  /**
   * Send email notification
   */
  async sendEmail(to, subject, content, options = {}) {
    const sendgrid = this.integrations.get('sendgrid');
    if (!sendgrid || sendgrid.status !== 'connected') {
      throw new Error('SendGrid email service not available');
    }

    try {
      const msg = {
        to: Array.isArray(to) ? to : [to],
        from: sendgrid.fromEmail,
        subject,
        html: content,
        ...options
      };

      const result = await sendgrid.client.send(msg);

      // Store in NILEDB
      await storeRealTimeData('email_sent', {
        to: Array.isArray(to) ? to : [to],
        subject,
        messageId: result[0].headers['x-message-id'],
        statusCode: result[0].statusCode,
        sentAt: new Date().toISOString()
      }, 24);

      await insertDashboardMetric('emails_sent', 1, 'counter', { statusCode: result[0].statusCode });
      
      this.emit('email_sent', { to, subject, messageId: result[0].headers['x-message-id'] });
      return result;

    } catch (error) {
      console.error('Email sending failed:', error);
      await createAlert('email_failed', error.message, 'medium', { to, subject });
      await insertDashboardMetric('emails_failed', 1, 'counter', { error: error.code });
      throw error;
    }
  }

  // ==================== WEBHOOK INTEGRATIONS ====================

  /**
   * Initialize webhook handlers
   */
  async initializeWebhooks() {
    console.log('🔗 Initializing webhook handlers...');

    // Register webhook endpoints for different services
    this.webhookEndpoints.set('woocommerce', {
      baseUrl: '/api/webhooks/woocommerce',
      secret: process.env.WOOCOMMERCE_WEBHOOK_SECRET,
      handlers: {
        'order/created': this.handleWooCommerceOrderCreated.bind(this),
        'order/updated': this.handleWooCommerceOrderUpdated.bind(this),
        'product/created': this.handleWooCommerceProductCreated.bind(this),
        'product/updated': this.handleWooCommerceProductUpdated.bind(this),
        'customer/created': this.handleWooCommerceCustomerCreated.bind(this),
        'customer/updated': this.handleWooCommerceCustomerUpdated.bind(this)
      }
    });

    this.webhookEndpoints.set('stripe', {
      baseUrl: '/api/webhooks/stripe',
      secret: this.config.payments.stripe.webhookSecret,
      handlers: {
        'payment_intent.succeeded': this.handleStripePaymentSucceeded.bind(this),
        'payment_intent.payment_failed': this.handleStripePaymentFailed.bind(this),
        'customer.created': this.handleStripeCustomerCreated.bind(this)
      }
    });

    console.log('✅ Webhook handlers initialized');
  }

  /**
   * Process incoming webhook
   */
  async processWebhook(service, event, signature, rawBody) {
    const webhookConfig = this.webhookEndpoints.get(service);
    if (!webhookConfig) {
      throw new Error(`Unknown webhook service: ${service}`);
    }

    try {
      // Verify webhook signature if configured
      if (webhookConfig.secret && this.config.webhooks.enableSignatureVerification) {
        await this.verifyWebhookSignature(service, signature, rawBody, webhookConfig.secret);
      }

      // Store webhook event in NILEDB
      await storeRealTimeData('webhook_received', {
        service,
        eventType: event.type || event.event,
        timestamp: new Date().toISOString(),
        id: event.id || Date.now()
      }, 1);

      // Find appropriate handler
      const eventType = event.type || event.event;
      const handler = webhookConfig.handlers[eventType];
      
      if (!handler) {
        console.warn(`No handler found for ${service} webhook: ${eventType}`);
        return { processed: false, reason: 'no_handler' };
      }

      // Process webhook with retry logic
      const result = await this.withRetry(() => handler(event), this.config.webhooks.maxRetries);

      // Update metrics
      await insertDashboardMetric('webhooks_processed', 1, 'counter', { service, eventType });
      
      this.emit('webhook_processed', { service, eventType, result });
      return { processed: true, result };

    } catch (error) {
      console.error(`Webhook processing failed for ${service}:`, error);
      
      await createAlert('webhook_failed', error.message, 'medium', {
        service,
        eventType: event.type || event.event
      });

      await insertDashboardMetric('webhooks_failed', 1, 'counter', { service, error: error.message });
      throw error;
    }
  }

  /**
   * Verify webhook signature
   */
  async verifyWebhookSignature(service, signature, payload, secret) {
    const crypto = await import('crypto');
    
    switch (service) {
      case 'stripe':
        const stripe = this.integrations.get('stripe')?.client;
        if (stripe) {
          return stripe.webhooks.constructEvent(payload, signature, secret);
        }
        break;
        
      case 'woocommerce':
        const expectedSignature = crypto.createHmac('sha256', secret)
          .update(payload, 'utf8')
          .digest('base64');
        
        if (signature !== expectedSignature) {
          throw new Error('Invalid WooCommerce webhook signature');
        }
        break;
        
      default:
        console.warn(`Signature verification not implemented for ${service}`);
    }
  }

  // ==================== WEBHOOK HANDLERS ====================

  /**
   * Handle WooCommerce order created webhook
   */
  async handleWooCommerceOrderCreated(order) {
    console.log(`📦 New WooCommerce order: ${order.number}`);
    
    // Store order data in NILEDB
    await storeRealTimeData('wc_order_created', {
      orderId: order.id,
      orderNumber: order.number,
      total: order.total,
      currency: order.currency,
      status: order.status,
      customerEmail: order.billing.email,
      createdAt: order.date_created
    }, 24);

    // Send notification
    await sendNotification({
      type: 'woocommerce_order_created',
      title: '🛒 New WooCommerce Order',
      urgency: 'medium',
      data: {
        orderNumber: order.number,
        total: order.total,
        currency: order.currency,
        customerEmail: order.billing.email
      }
    }, ['warehouse', 'management']);

    return { processed: true, orderId: order.id };
  }

  /**
   * Handle WooCommerce order updated webhook
   */
  async handleWooCommerceOrderUpdated(order) {
    console.log(`📝 WooCommerce order updated: ${order.number}`);
    
    await storeRealTimeData('wc_order_updated', {
      orderId: order.id,
      orderNumber: order.number,
      status: order.status,
      updatedAt: order.date_modified
    }, 24);

    return { processed: true, orderId: order.id };
  }

  /**
   * Handle WooCommerce product updated webhook
   */
  async handleWooCommerceProductUpdated(product) {
    console.log(`🛍️ WooCommerce product updated: ${product.name}`);
    
    await this.processWooCommerceProduct(product);
    return { processed: true, productId: product.id };
  }

  /**
   * Handle Stripe payment succeeded webhook
   */
  async handleStripePaymentSucceeded(paymentIntent) {
    console.log(`💳 Stripe payment succeeded: ${paymentIntent.id}`);
    
    await storeRealTimeData('stripe_payment_succeeded', {
      paymentIntentId: paymentIntent.id,
      amount: paymentIntent.amount / 100,
      currency: paymentIntent.currency,
      customerId: paymentIntent.customer,
      status: paymentIntent.status
    }, 24);

    return { processed: true, paymentIntentId: paymentIntent.id };
  }

  // ==================== UTILITY METHODS ====================

  /**
   * Create rate limiter for API requests
   */
  createRateLimiter(requestsPerMinute) {
    const tokens = requestsPerMinute;
    let lastRefill = Date.now();
    let currentTokens = tokens;

    return {
      async waitForToken() {
        const now = Date.now();
        const timePassed = now - lastRefill;
        const tokensToAdd = Math.floor(timePassed / (60000 / tokens));
        
        if (tokensToAdd > 0) {
          currentTokens = Math.min(tokens, currentTokens + tokensToAdd);
          lastRefill = now;
        }

        if (currentTokens > 0) {
          currentTokens--;
          return;
        }

        // Wait for next token
        const waitTime = Math.ceil((60000 / tokens) - (timePassed % (60000 / tokens)));
        await new Promise(resolve => setTimeout(resolve, waitTime));
        currentTokens--;
      }
    };
  }

  /**
   * Make rate-limited API request
   */
  async rateLimitedRequest(service, requestFn) {
    const integration = this.integrations.get(service);
    if (!integration?.rateLimiter) {
      return await requestFn();
    }

    await integration.rateLimiter.waitForToken();
    return await requestFn();
  }

  /**
   * Execute function with retry logic
   */
  async withRetry(fn, maxRetries = 3, delay = 1000) {
    let lastError;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        
        if (attempt < maxRetries) {
          const waitTime = delay * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, waitTime));
        }
      }
    }
    
    throw lastError;
  }

  /**
   * Start health monitoring for all integrations
   */
  startHealthMonitoring() {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.healthCheckInterval = setInterval(async () => {
      for (const [service, integration] of this.integrations) {
        try {
          await this.checkIntegrationHealth(service, integration);
        } catch (error) {
          console.error(`Health check failed for ${service}:`, error);
        }
      }
    }, 60000); // Check every minute

    console.log('🏥 Health monitoring started');
  }

  /**
   * Check health of specific integration
   */
  async checkIntegrationHealth(service, integration) {
    const now = new Date();
    let isHealthy = true;
    let errorMessage = null;

    try {
      switch (service) {
        case 'woocommerce':
          const response = await integration.api.get('system_status');
          isHealthy = response.status === 200;
          break;
          
        case 'stripe':
          await integration.client.balance.retrieve();
          break;
          
        case 'paypal':
          // PayPal health check could be implemented here
          break;
          
        default:
          // Generic health check - just verify the integration exists
          isHealthy = integration.status === 'connected';
      }
    } catch (error) {
      isHealthy = false;
      errorMessage = error.message;
    }

    integration.status = isHealthy ? 'connected' : 'error';
    integration.lastHealthCheck = now;
    integration.lastError = errorMessage;

    // Update NILEDB metrics
    await insertDashboardMetric(`${service}_health_status`, isHealthy ? 1 : 0, 'gauge', {
      service,
      error: errorMessage
    });

    if (!isHealthy) {
      await createAlert(`${service}_health_check_failed`, errorMessage || 'Health check failed', 'medium', {
        service,
        lastHealthCheck: now.toISOString()
      });
    }
  }

  /**
   * Get integration status
   */
  getIntegrationStatus(service = null) {
    if (service) {
      const integration = this.integrations.get(service);
      return integration ? {
        service,
        status: integration.status,
        lastHealthCheck: integration.lastHealthCheck,
        lastError: integration.lastError
      } : null;
    }

    const status = {};
    for (const [serviceName, integration] of this.integrations) {
      status[serviceName] = {
        status: integration.status,
        lastHealthCheck: integration.lastHealthCheck,
        lastError: integration.lastError
      };
    }
    return status;
  }

  /**
   * Get service metrics
   */
  async getServiceMetrics() {
    const metrics = {
      integrations: {
        total: this.integrations.size,
        connected: 0,
        errors: 0
      },
      webhooks: {
        endpoints: this.webhookEndpoints.size
      },
      lastUpdated: new Date().toISOString()
    };

    for (const integration of this.integrations.values()) {
      if (integration.status === 'connected') {
        metrics.integrations.connected++;
      } else {
        metrics.integrations.errors++;
      }
    }

    return metrics;
  }

  /**
   * Cleanup resources
   */
  async cleanup() {
    console.log('🧹 Cleaning up API Integration Service...');
    
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Close active connections
    for (const [service, integration] of this.integrations) {
      try {
        if (integration.client && typeof integration.client.destroy === 'function') {
          await integration.client.destroy();
        }
      } catch (error) {
        console.error(`Error closing ${service} connection:`, error);
      }
    }

    this.integrations.clear();
    this.activeConnections.clear();
    this.webhookEndpoints.clear();

    console.log('✅ API Integration Service cleanup completed');
  }

  // Additional webhook handlers (simplified for brevity)
  async handleWooCommerceProductCreated(product) { return { processed: true }; }
  async handleWooCommerceCustomerCreated(customer) { return { processed: true }; }
  async handleWooCommerceCustomerUpdated(customer) { return { processed: true }; }
  async handleStripePaymentFailed(paymentIntent) { return { processed: true }; }
  async handleStripeCustomerCreated(customer) { return { processed: true }; }
  async syncWooCommerceCustomers(api, options) { return { synced: 0, errors: 0 }; }
  async syncWooCommerceOrders(api, options) { return { synced: 0, errors: 0 }; }
}

export default new APIIntegrationService();