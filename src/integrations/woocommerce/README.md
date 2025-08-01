# WooCommerce Integration Hub

Complete bi-directional synchronization system for WooCommerce with real-time updates, conflict resolution, and comprehensive monitoring.

## 🚀 Features

### Core Integration
- **Bi-directional Sync**: Real-time synchronization between WooCommerce and NXT-ND
- **Entity Support**: Products, Customers, Orders, and Inventory
- **Real-time Updates**: Webhook-based real-time synchronization
- **Batch Processing**: Large-scale sync operations with queuing
- **Conflict Resolution**: Intelligent conflict detection and resolution
- **Error Recovery**: Automated error detection and recovery mechanisms
- **Monitoring Dashboard**: Real-time analytics and performance monitoring

### Services Architecture

```
WooCommerce Integration Hub
├── sync.service.js           # Core sync operations
├── webhook.service.js        # Real-time webhook processing
├── conflict-resolver.service.js  # Conflict detection & resolution
├── monitoring.service.js     # Real-time monitoring & analytics
├── batch-processor.service.js    # Batch operations & queuing
├── error-recovery.service.js     # Error handling & recovery
└── routes/
    └── integration.routes.js # API endpoints
```

## 📋 Installation & Setup

### 1. Environment Configuration

Add these environment variables to your `.env` file:

```env
# WooCommerce API Configuration
WOOCOMMERCE_SITE_URL=https://your-woocommerce-site.com
WOOCOMMERCE_CONSUMER_KEY=ck_your_consumer_key
WOOCOMMERCE_CONSUMER_SECRET=cs_your_consumer_secret
WOOCOMMERCE_WEBHOOK_SECRET=your_webhook_secret
WOOCOMMERCE_VERSION=wc/v3

# Integration Configuration
WOOCOMMERCE_ADMIN_EMAIL=admin@yourstore.com
API_BASE_URL=http://localhost:3000

# Optional Performance Settings
WOOCOMMERCE_BATCH_SIZE=50
WOOCOMMERCE_MAX_RETRIES=3
WOOCOMMERCE_RETRY_DELAY=1000
```

### 2. Database Setup

The integration automatically creates necessary tables on initialization:

- `wc_sync_sessions` - Sync session tracking
- `wc_sync_conflicts` - Conflict logging
- `wc_entity_mapping` - Entity relationship mapping
- `wc_webhook_events` - Webhook event processing
- `wc_monitoring_metrics` - Performance metrics
- `wc_batch_jobs` - Batch processing jobs
- `wc_error_log` - Error tracking and recovery

### 3. Initialize Integration

```javascript
const WooCommerceIntegration = require('./src/integrations/woocommerce');

// Initialize with default configuration
await WooCommerceIntegration.initialize();

// Or with custom configuration
await WooCommerceIntegration.initialize({
  enableRealTime: true,
  batchSize: 100,
  maxRetries: 5,
  enableSecurity: true
});
```

## 🔄 Usage Examples

### Full Bi-directional Sync

```javascript
// Execute complete sync
const result = await WooCommerceIntegration.fullSync({
  direction: 'both', // 'pull', 'push', or 'both'
  force: false,      // Force overwrite existing data
  batchSize: 50      // Items per batch
});

console.log(`Synced: ${result.products.pull + result.products.push} products`);
console.log(`Conflicts: ${result.totalConflicts}`);
console.log(`Duration: ${result.duration}ms`);
```

### Real-time Webhook Processing

```javascript
// Process incoming webhook
app.post('/wc-webhook/product', async (req, res) => {
  try {
    const result = await WooCommerceIntegration.processWebhook(
      'product.updated',
      req.body,
      req.headers['x-wc-webhook-signature'],
      req.ip
    );
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

### Batch Operations

```javascript
// Queue batch sync job
const job = await WooCommerceIntegration.batch.queueBatchSync('full_sync', {
  entityTypes: ['products', 'customers'],
  priority: 100,
  batchSize: 50
});

// Monitor job progress
const status = await WooCommerceIntegration.batch.getJobStatus(job.jobId);
console.log(`Progress: ${status.currentProgress?.progress_percent}%`);
```

### Monitoring & Analytics

```javascript
// Get real-time dashboard data
const dashboard = await WooCommerceIntegration.getDashboardData();

// Get comprehensive analytics
const analytics = await WooCommerceIntegration.getAnalytics('30d');

// Get conflict statistics
const conflicts = await WooCommerceIntegration.conflicts.getConflictStats('24h');
```

## 🔧 API Endpoints

### Integration Management
- `POST /api/woocommerce/initialize` - Initialize integration
- `GET /api/woocommerce/status` - Get service status
- `GET /api/woocommerce/dashboard` - Get dashboard data
- `GET /api/woocommerce/analytics` - Get analytics data
- `GET /api/woocommerce/health` - Health check

### Sync Operations
- `POST /api/woocommerce/sync/full` - Execute full sync
- `POST /api/woocommerce/sync/batch` - Queue batch sync
- `GET /api/woocommerce/sync/job/:jobId` - Get job status

### Webhook Endpoints
- `POST /api/woocommerce/webhooks/customer` - Customer webhooks
- `POST /api/woocommerce/webhooks/product` - Product webhooks
- `POST /api/woocommerce/webhooks/order` - Order webhooks
- `GET /api/woocommerce/webhooks/stats` - Webhook statistics
- `POST /api/woocommerce/webhooks/retry` - Retry failed webhooks

### Conflict Management
- `GET /api/woocommerce/conflicts/stats` - Conflict statistics
- `GET /api/woocommerce/conflicts/pending` - Pending conflicts
- `POST /api/woocommerce/conflicts/:id/resolve` - Resolve conflict

### Error Recovery
- `GET /api/woocommerce/errors/stats` - Error recovery statistics

## 🛠️ Configuration Options

### Sync Service Configuration

```javascript
{
  siteUrl: 'https://your-site.com',
  consumerKey: 'ck_...',
  consumerSecret: 'cs_...',
  version: 'wc/v3',
  webhookSecret: 'secret',
  realTimeConfig: {
    enabled: true,
    batchSize: 50,
    maxRetries: 3,
    retryDelay: 1000,
    conflictStrategy: 'timestamp'
  }
}
```

### Webhook Service Configuration

```javascript
{
  enableSecurity: true,
  validateSignature: true,
  allowedIPs: [], // Empty = allow all
  rateLimitWindow: 60000,
  rateLimitMax: 100
}
```

### Conflict Resolution Configuration

```javascript
{
  defaultStrategy: 'timestamp',
  autoResolve: true,
  backupConflicts: true,
  fieldPriorities: {
    customer: {
      email: 'wc_wins',
      phone: 'nxt_wins',
      address: 'merge'
    },
    product: {
      name: 'wc_wins',
      price: 'nxt_wins',
      inventory: 'nxt_wins'
    }
  }
}
```

### Monitoring Configuration

```javascript
{
  enableRealTime: true,
  metricsInterval: 60000,
  alertsEnabled: true,
  dashboardRefresh: 30000,
  alertThresholds: {
    failureRate: 0.1,
    avgResponseTime: 5000,
    conflictRate: 0.05
  }
}
```

## 📊 Monitoring & Analytics

### Dashboard Widgets

The monitoring dashboard provides real-time insights:

1. **Sync Performance**
   - Total sync sessions
   - Success/failure rates
   - Average sync duration
   - Last sync timestamp

2. **Webhook Processing**
   - Events received/processed
   - Processing times
   - Failure rates
   - Queue status

3. **Conflict Resolution**
   - Total conflicts detected
   - Auto-resolution rate
   - Pending manual conflicts
   - Resolution patterns

4. **System Health**
   - API response times
   - Error rates
   - Circuit breaker status
   - Resource utilization

### Alerts & Notifications

Automatic alerts for:
- High sync failure rates
- API timeout issues
- Webhook processing delays
- Conflict escalations
- Circuit breaker activations

## 🔀 Conflict Resolution

The system provides intelligent conflict resolution with multiple strategies:

### Resolution Strategies

1. **Timestamp** - Most recent data wins
2. **Manual** - Requires human intervention
3. **Priority** - Configured field priorities
4. **Merge** - Intelligent data merging
5. **Source Wins** - WooCommerce or NXT always wins

### Conflict Types

- **Data Validation** - Missing or invalid fields
- **Timestamp Differences** - Concurrent modifications
- **Type Mismatches** - Data type inconsistencies
- **Business Rule Conflicts** - Constraint violations

## 🚨 Error Recovery

Automated error recovery with circuit breaker pattern:

### Recovery Strategies

- **API Timeouts** - Retry with increased timeout
- **Rate Limits** - Exponential backoff with retry-after
- **Network Errors** - Connection retry with backoff
- **Data Validation** - Automatic data fixing
- **Authentication** - Credential refresh handling

### Circuit Breaker

Prevents cascading failures by:
- Tracking failure rates per operation
- Opening circuit after threshold reached
- Half-open state for recovery testing
- Automatic reset on success

## 🔐 Security Features

### Webhook Security
- Signature validation using HMAC-SHA256
- IP whitelist support
- Rate limiting per source IP
- Request size limits

### API Security
- Encrypted credential storage
- Connection timeout limits
- Request retry limits
- SSL/TLS enforcement

## 📈 Performance Optimization

### Batch Processing
- Configurable batch sizes
- Priority-based job queuing
- Background processing
- Progress tracking

### Caching Strategy
- Entity mapping cache
- API response caching
- Conflict resolution cache
- Metrics aggregation cache

### Database Optimization
- Indexed tables for fast queries
- Partitioning for large datasets
- Automated cleanup of old data
- Connection pooling

## 🧪 Testing

### Unit Tests
```bash
npm test -- --grep "WooCommerce Integration"
```

### Integration Tests
```bash
npm run test:integration -- --grep "WooCommerce"
```

### Load Testing
```bash
npm run test:load -- --config woocommerce-load-test.yml
```

## 📚 Troubleshooting

### Common Issues

1. **Authentication Failures**
   - Verify API credentials
   - Check key permissions
   - Confirm site URL format

2. **Webhook Processing Errors**
   - Validate webhook secret
   - Check endpoint accessibility
   - Review payload format

3. **Sync Conflicts**
   - Review field priority configuration
   - Check data validation rules
   - Monitor conflict logs

4. **Performance Issues**
   - Adjust batch sizes
   - Optimize database queries
   - Review circuit breaker settings

### Debug Mode

Enable verbose logging:

```javascript
await WooCommerceIntegration.initialize({
  debug: true,
  logLevel: 'verbose'
});
```

### Health Checks

Regular health monitoring:

```bash
curl http://localhost:3000/api/woocommerce/health
```

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Add tests for new functionality
4. Update documentation
5. Submit pull request

## 📄 License

This integration is part of the NXT-ND backend system and follows the same license terms.

## 🆘 Support

For support and questions:
- Check the troubleshooting guide
- Review error logs in the dashboard
- Contact the development team
- Submit issues via the project repository

---

**Note**: This integration requires WooCommerce REST API v3 or higher and appropriate API permissions for the operations you wish to synchronize.