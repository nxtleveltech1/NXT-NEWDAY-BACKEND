# API Integration Service - Production Documentation

## 🚀 Overview

The API Integration Service provides comprehensive, production-ready integration with multiple external systems including WooCommerce, payment gateways, messaging services, and third-party webhooks. All integrations are optimized for high performance and include full NILEDB connectivity for real-time monitoring and analytics.

## 📋 Table of Contents

- [Quick Start](#quick-start)
- [Architecture](#architecture)
- [WooCommerce Integration](#woocommerce-integration)
- [Payment Gateway Integration](#payment-gateway-integration)
- [Messaging Services](#messaging-services)
- [Webhook Management](#webhook-management)
- [NILEDB Integration](#niledb-integration)
- [API Endpoints](#api-endpoints)
- [Configuration](#configuration)
- [Testing](#testing)
- [Monitoring](#monitoring)
- [Troubleshooting](#troubleshooting)

## 🚀 Quick Start

### 1. Environment Setup

Copy the environment configuration template:

```bash
cp .env.integration.example .env
```

Configure your API credentials in `.env`:

```bash
# Essential WooCommerce settings
WOOCOMMERCE_API_ENABLED=true
WOOCOMMERCE_SITE_URL=https://yourstore.com
WOOCOMMERCE_CONSUMER_KEY=ck_your_key_here
WOOCOMMERCE_CONSUMER_SECRET=cs_your_secret_here

# Payment gateway credentials
STRIPE_ENABLED=true
STRIPE_SECRET_KEY=sk_live_your_stripe_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# Messaging services
TWILIO_ENABLED=true
TWILIO_ACCOUNT_SID=your_twilio_sid
TWILIO_AUTH_TOKEN=your_twilio_token
```

### 2. Start the Server

The API integration services automatically initialize when the main server starts:

```bash
npm start
```

### 3. Verify Integration Status

Check that all integrations are working:

```bash
curl http://localhost:4000/api/integrations/status
```

### 4. Run Integration Tests

Verify all integrations with the comprehensive test suite:

```bash
node test-api-integrations.js
```

## 🏗️ Architecture

### Core Components

```
┌─────────────────────────────────────────────────┐
│                NXT Backend API                  │
├─────────────────────────────────────────────────┤
│  API Integration Service (Central Orchestrator) │
├─────────────────┬───────────────┬───────────────┤
│   WooCommerce   │   Payments    │   Messaging   │
│   Sync Service  │   Gateway     │   Services    │
│                 │   Service     │               │
├─────────────────┼───────────────┼───────────────┤
│              NILEDB Integration                 │
│           (Real-time Analytics)                 │
├─────────────────────────────────────────────────┤
│                External APIs                    │
│  WooCommerce • Stripe • PayPal • Twilio        │
│  SendGrid • Square • Authorize.Net             │
└─────────────────────────────────────────────────┘
```

### Key Features

- **🚀 High Performance**: Fighter Jet server architecture with sub-millisecond response times
- **🔄 Real-time Sync**: Bi-directional WooCommerce synchronization with conflict resolution
- **💳 Multi-Gateway**: Support for Stripe, PayPal, Square, and Authorize.Net
- **📱 Messaging**: SMS (Twilio) and Email (SendGrid) integration
- **🔗 Webhooks**: Comprehensive webhook handling for all services
- **📊 Analytics**: Real-time monitoring via NILEDB integration
- **🛡️ Security**: Webhook signature verification and secure credential handling
- **🔧 Resilience**: Automatic retry, circuit breakers, and error handling

## 🛒 WooCommerce Integration

### Features

- **Bi-directional Sync**: Real-time synchronization between WooCommerce and NXT
- **Conflict Resolution**: Intelligent handling of data conflicts with configurable strategies
- **Webhook Support**: Real-time updates via WooCommerce webhooks
- **Batch Processing**: Efficient bulk data synchronization
- **Performance Optimization**: Rate limiting and connection pooling

### Sync Operations

#### Trigger Full Sync

```bash
POST /api/integrations/woocommerce/sync
Content-Type: application/json

{
  "syncType": "full",
  "direction": "bidirectional",
  "options": {
    "batchSize": 50,
    "force": false
  }
}
```

#### Sync Specific Data Types

```bash
# Sync only products
POST /api/integrations/woocommerce/sync
{
  "syncType": "products",
  "direction": "pull"
}

# Sync only customers
POST /api/integrations/woocommerce/sync
{
  "syncType": "customers",
  "direction": "push"
}

# Sync only orders
POST /api/integrations/woocommerce/sync
{
  "syncType": "orders",
  "direction": "pull"
}
```

#### Check Sync Status

```bash
GET /api/integrations/woocommerce/status
```

Response:
```json
{
  "success": true,
  "data": {
    "stats": {
      "totalSyncs": 45,
      "successfulSyncs": 43,
      "failedSyncs": 2,
      "lastSyncDuration": 2456,
      "avgSyncDuration": 2134
    },
    "syncState": {
      "isRunning": false,
      "activeSyncs": 0,
      "lastFullSync": "2025-08-01T06:00:00.000Z"
    },
    "config": {
      "realTimeEnabled": true,
      "batchSize": 50,
      "conflictResolution": "timestamp"
    }
  }
}
```

### Webhook Endpoints

WooCommerce webhooks are automatically registered and handled:

- `POST /api/webhooks/woocommerce/order/created`
- `POST /api/webhooks/woocommerce/order/updated`
- `POST /api/webhooks/woocommerce/product/created`
- `POST /api/webhooks/woocommerce/product/updated`
- `POST /api/webhooks/woocommerce/customer/created`
- `POST /api/webhooks/woocommerce/customer/updated`

### Configuration Options

```bash
# WooCommerce API Configuration
WOOCOMMERCE_API_ENABLED=true
WOOCOMMERCE_SITE_URL=https://yourstore.com
WOOCOMMERCE_CONSUMER_KEY=ck_your_key
WOOCOMMERCE_CONSUMER_SECRET=cs_your_secret
WOOCOMMERCE_VERSION=wc/v3

# Sync Configuration
WC_BATCH_SIZE=50
WC_MAX_RETRIES=3
WC_RETRY_DELAY=1000
WC_RATE_LIMIT_RPM=600
WC_REALTIME_ENABLED=true

# Conflict Resolution Strategy
WC_CONFLICT_RESOLUTION=timestamp  # timestamp, manual, wc_priority, nxt_priority
```

## 💳 Payment Gateway Integration

### Supported Gateways

1. **Stripe** - Complete integration with subscriptions, webhooks, and payment methods
2. **PayPal** - Full checkout and payment processing
3. **Square** - Point of sale and online payments
4. **Authorize.Net** - Traditional payment processing

### Payment Processing

#### Process Payment

```bash
POST /api/integrations/payments/process
Content-Type: application/json

{
  "gateway": "stripe",
  "amount": 99.99,
  "currency": "USD",
  "customerId": "cust_123",
  "paymentMethodId": "pm_card_visa",
  "description": "Order #12345",
  "metadata": {
    "orderId": "12345",
    "source": "online_store"
  }
}
```

Response:
```json
{
  "success": true,
  "message": "Payment processed successfully",
  "data": {
    "gateway": "stripe",
    "transactionId": "txn_1234567890",
    "gatewayTransactionId": "pi_1ABC2DEF3GHI456",
    "status": "succeeded",
    "amount": 99.99,
    "currency": "USD",
    "clientSecret": "pi_1ABC2DEF3GHI456_secret_xyz"
  }
}
```

#### Process Refund

```bash
POST /api/integrations/payments/refund
Content-Type: application/json

{
  "transactionId": "txn_1234567890",
  "amount": 50.00,
  "reason": "requested_by_customer",
  "metadata": {
    "refundRequestId": "ref_req_123"
  }
}
```

#### Get Payment Statistics

```bash
GET /api/integrations/payments/status
```

Response:
```json
{
  "success": true,
  "data": {
    "totalPayments": 1250,
    "successfulPayments": 1205,
    "failedPayments": 45,
    "totalVolume": 125450.75,
    "averageAmount": 100.36,
    "gateways": {
      "total": 3,
      "active": 2,
      "available": ["stripe", "paypal", "square"]
    },
    "byGateway": {
      "stripe": { "count": 800, "volume": 85234.50 },
      "paypal": { "count": 405, "volume": 40216.25 }
    }
  }
}
```

### Webhook Handling

Payment gateway webhooks are automatically processed:

- `POST /api/webhooks/stripe` - Stripe webhook events
- `POST /api/webhooks/paypal` - PayPal webhook events
- `POST /api/webhooks/square` - Square webhook events

### Gateway Configuration

```bash
# Stripe Configuration
STRIPE_ENABLED=true
STRIPE_SECRET_KEY=sk_live_your_stripe_secret_key
STRIPE_PUBLISHABLE_KEY=pk_live_your_stripe_publishable_key
STRIPE_WEBHOOK_SECRET=whsec_your_webhook_secret

# PayPal Configuration
PAYPAL_ENABLED=true
PAYPAL_CLIENT_ID=your_paypal_client_id
PAYPAL_CLIENT_SECRET=your_paypal_client_secret
PAYPAL_ENVIRONMENT=production  # or sandbox

# Square Configuration
SQUARE_ENABLED=true
SQUARE_ACCESS_TOKEN=your_square_access_token
SQUARE_APPLICATION_ID=your_square_application_id
SQUARE_LOCATION_ID=your_location_id
```

## 📱 Messaging Services

### SMS Integration (Twilio)

#### Send SMS

```bash
POST /api/integrations/sms/send
Content-Type: application/json

{
  "to": "+1234567890",
  "message": "Your order has been confirmed! Order #12345",
  "urgent": false
}
```

Response:
```json
{
  "success": true,
  "message": "SMS sent successfully",
  "data": {
    "sid": "SM1234567890abcdef",
    "status": "queued",
    "to": "+1234567890",
    "sentAt": "2025-08-01T12:00:00.000Z"
  }
}
```

### Email Integration (SendGrid)

#### Send Email

```bash
POST /api/integrations/email/send
Content-Type: application/json

{
  "to": "customer@example.com",
  "subject": "Order Confirmation - #12345",
  "content": "<h1>Thank you for your order!</h1><p>Your order #12345 has been confirmed.</p>",
  "priority": "normal"
}
```

Response:
```json
{
  "success": true,
  "message": "Email sent successfully",
  "data": {
    "messageId": "14c5d75ce93.dfd.64b469.6d61696c.3333.1234567890",
    "to": "customer@example.com",
    "subject": "Order Confirmation - #12345",
    "sentAt": "2025-08-01T12:00:00.000Z"
  }
}
```

### Configuration

```bash
# Twilio SMS Configuration
TWILIO_ENABLED=true
TWILIO_ACCOUNT_SID=your_twilio_account_sid
TWILIO_AUTH_TOKEN=your_twilio_auth_token
TWILIO_FROM_NUMBER=+1234567890

# SendGrid Email Configuration
SENDGRID_ENABLED=true
SENDGRID_API_KEY=SG.your_sendgrid_api_key
SENDGRID_FROM_EMAIL=noreply@yourcompany.com
```

## 🔗 Webhook Management

### Third-party Webhook Handler

Generic webhook endpoint for any third-party service:

```bash
POST /api/webhooks/third-party/{service}
Content-Type: application/json
X-Webhook-Signature: your_signature

{
  "event": "order.completed",
  "data": {
    "orderId": "12345",
    "status": "completed",
    "timestamp": "2025-08-01T12:00:00.000Z"
  }
}
```

### Webhook Security

All webhook endpoints support signature verification:

```bash
# Enable signature verification
WEBHOOK_SIGNATURE_VERIFICATION_ENABLED=true

# Configure retry settings
WEBHOOK_MAX_RETRIES=5
WEBHOOK_RETRY_DELAY=1000
WEBHOOK_TIMEOUT=15000
```

## 📊 NILEDB Integration

### Real-time Data Storage

All API operations are automatically logged to NILEDB for real-time monitoring:

- **Payment Transactions**: Real-time payment processing data
- **Sync Operations**: WooCommerce sync status and performance
- **Webhook Events**: All incoming webhook events
- **Performance Metrics**: API response times and success rates
- **Error Tracking**: Failed operations and error patterns

### Dashboard Metrics

Access real-time metrics through NILEDB:

```sql
-- Recent payment activity
SELECT * FROM real_time_data 
WHERE data_type = 'payment_processed' 
ORDER BY timestamp DESC 
LIMIT 100;

-- WooCommerce sync performance
SELECT * FROM dashboard_metrics 
WHERE metric_name LIKE 'wc_%' 
ORDER BY timestamp DESC;

-- Webhook processing stats
SELECT * FROM dashboard_events 
WHERE event_type = 'webhook_processed' 
ORDER BY timestamp DESC;
```

### Performance Monitoring

Real-time performance data includes:

- API response times
- Payment processing duration
- Sync operation metrics
- Error rates and patterns
- Gateway-specific performance

## 🔧 API Endpoints Reference

### Integration Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/integrations/status` | Get all integration statuses |
| GET | `/api/integrations/status/{service}` | Get specific service status |
| POST | `/api/integrations/reinitialize` | Reinitialize all integrations |

### WooCommerce Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/integrations/woocommerce/status` | Get sync statistics |
| POST | `/api/integrations/woocommerce/sync` | Trigger sync operation |
| GET | `/api/integrations/woocommerce/sync/history` | Get sync history |

### Payment Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/integrations/payments/status` | Get payment statistics |
| POST | `/api/integrations/payments/process` | Process payment |
| POST | `/api/integrations/payments/refund` | Process refund |

### Messaging Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/integrations/sms/send` | Send SMS message |
| POST | `/api/integrations/email/send` | Send email message |

### Webhook Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/webhooks/woocommerce/{event}` | WooCommerce webhooks |
| POST | `/api/webhooks/stripe` | Stripe webhooks |
| POST | `/api/webhooks/paypal` | PayPal webhooks |
| POST | `/api/webhooks/third-party/{service}` | Generic webhooks |

## ⚙️ Configuration

### Environment Variables

See `.env.integration.example` for complete configuration options.

### Key Settings

#### Performance Tuning
```bash
# API rate limiting
API_RATE_LIMIT_RPM=1000
API_TIMEOUT=30000

# Database connection pool
DB_POOL_MAX_CONNECTIONS=50
DB_POOL_MIN_CONNECTIONS=5

# Cache settings
CACHE_TTL_MINUTES=60
ENABLE_CACHE_COMPRESSION=true
```

#### Security Settings
```bash
# Webhook security
WEBHOOK_SIGNATURE_VERIFICATION_ENABLED=true
WEBHOOK_MAX_RETRIES=5

# Data encryption
ENCRYPT_SENSITIVE_DATA=true
PCI_COMPLIANCE_MODE=true
```

#### Monitoring & Logging
```bash
# Performance monitoring
ENABLE_PERFORMANCE_MONITORING=true
LOG_LEVEL=info
METRICS_COLLECTION_ENABLED=true

# Error reporting
ENABLE_ERROR_ALERTS=true
ERROR_ALERT_THRESHOLD=5
```

## 🧪 Testing

### Automated Test Suite

Run the comprehensive integration test suite:

```bash
# Run all tests
node test-api-integrations.js

# Run with specific API endpoint
API_BASE_URL=https://your-api.com node test-api-integrations.js

# Run with custom timeout
TEST_TIMEOUT=60000 node test-api-integrations.js
```

### Test Categories

1. **Health & Status Tests** - Basic connectivity and status endpoints
2. **WooCommerce Tests** - Sync operations and webhook handling
3. **Payment Gateway Tests** - Payment processing and webhook events
4. **Messaging Tests** - SMS and email sending capabilities
5. **Webhook Tests** - Third-party webhook processing
6. **NILEDB Tests** - Database integration and real-time data
7. **Performance Tests** - Response times and concurrent handling

### Manual Testing

#### Test WooCommerce Sync
```bash
curl -X POST http://localhost:4000/api/integrations/woocommerce/sync \
  -H "Content-Type: application/json" \
  -d '{"syncType": "products", "options": {"batchSize": 10}}'
```

#### Test Payment Processing
```bash
curl -X POST http://localhost:4000/api/integrations/payments/process \
  -H "Content-Type: application/json" \
  -d '{
    "gateway": "stripe",
    "amount": 10.00,
    "currency": "USD",
    "description": "Test payment"
  }'
```

#### Test SMS Sending
```bash
curl -X POST http://localhost:4000/api/integrations/sms/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "+1234567890",
    "message": "Test SMS from API"
  }'
```

## 📈 Monitoring

### Health Checks

Monitor integration health:

```bash
# Overall integration health
GET /api/integrations/health

# Specific service health
GET /api/integrations/status/woocommerce
GET /api/integrations/status/stripe
GET /api/integrations/status/twilio
```

### Performance Metrics

Access performance data:

```bash
# API metrics
GET /api/integrations/metrics

# NILEDB real-time data
SELECT * FROM dashboard_metrics 
WHERE metric_name IN ('api_response_time', 'payment_success_rate', 'sync_duration');
```

### Alerting

Configure alerts for:

- Failed payment processing
- WooCommerce sync failures
- High error rates
- Performance degradation
- Service downtime

## 🔧 Troubleshooting

### Common Issues

#### WooCommerce Connection Failed
```bash
# Check credentials
WOOCOMMERCE_API_ENABLED=true
WOOCOMMERCE_SITE_URL=https://correct-url.com
WOOCOMMERCE_CONSUMER_KEY=ck_correct_key
WOOCOMMERCE_CONSUMER_SECRET=cs_correct_secret

# Test connection
curl "https://yourstore.com/wp-json/wc/v3/system_status?consumer_key=ck_key&consumer_secret=cs_secret"
```

#### Payment Processing Errors
```bash
# Verify Stripe keys
STRIPE_SECRET_KEY=sk_live_...  # or sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_live_...  # or pk_test_...

# Check webhook endpoint
curl -X POST https://your-api.com/api/webhooks/stripe \
  -H "Stripe-Signature: test" \
  -d '{"type": "test.event"}'
```

#### SMS/Email Delivery Issues
```bash
# Verify Twilio credentials
TWILIO_ACCOUNT_SID=AC...
TWILIO_AUTH_TOKEN=...
TWILIO_FROM_NUMBER=+1...

# Verify SendGrid API key
SENDGRID_API_KEY=SG....
SENDGRID_FROM_EMAIL=valid@domain.com
```

### Debug Mode

Enable debug logging:

```bash
DEBUG_API_CALLS=true
LOG_LEVEL=debug
NODE_ENV=development
```

### Error Logs

Check service-specific logs:

```bash
# Application logs
tail -f logs/api-integration.log

# NILEDB logs
SELECT * FROM dashboard_events 
WHERE event_source = 'api_integration' 
AND severity = 'error' 
ORDER BY timestamp DESC;
```

## 🚀 Production Deployment

### Pre-deployment Checklist

- [ ] All environment variables configured
- [ ] SSL certificates installed
- [ ] Webhook endpoints accessible
- [ ] NILEDB connection established
- [ ] Integration tests passing
- [ ] Performance benchmarks met
- [ ] Security configuration verified
- [ ] Monitoring and alerting configured

### Performance Optimization

1. **Enable caching** for frequently accessed data
2. **Configure connection pooling** for databases
3. **Set appropriate rate limits** for external APIs
4. **Enable compression** for API responses
5. **Configure load balancing** for high availability

### Security Considerations

1. **Use HTTPS** for all webhook endpoints
2. **Verify webhook signatures** for all services
3. **Encrypt sensitive data** at rest and in transit
4. **Implement rate limiting** to prevent abuse
5. **Regular security audits** and credential rotation

---

## 📞 Support

For support and questions regarding the API Integration Service:

- **Documentation**: This file and inline code comments
- **Testing**: Run `node test-api-integrations.js` for diagnostics
- **Monitoring**: Check `/api/integrations/status` for service health
- **Logs**: Monitor NILEDB dashboard events and metrics

---

*Last updated: August 1, 2025*
*Version: 1.0.0*