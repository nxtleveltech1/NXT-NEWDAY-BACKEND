# WooCommerce Bidirectional Sync - Implementation Guide

## 🚀 Overview

The NXT-NEW-DAY backend now includes comprehensive bidirectional synchronization with WooCommerce stores. This implementation provides real-time data sync between your WooCommerce store and the NXT business management system.

## ✨ Features Implemented

### 🔄 Bidirectional Sync
- **PULL**: Import customers, products, orders FROM WooCommerce
- **PUSH**: Export inventory updates, order status TO WooCommerce  
- **SYNC**: Keep data synchronized between systems
- **WEBHOOKS**: Real-time updates via WooCommerce webhooks

### 📊 Data Entities Synced
- **Customers**: Full customer profiles with billing/shipping addresses
- **Products**: Complete product catalog with inventory levels
- **Orders**: Purchase orders with line items and status tracking
- **Inventory**: Real-time stock level synchronization

### 🛠 Advanced Features
- Retry logic with exponential backoff
- Conflict resolution strategies
- Comprehensive error handling and logging
- Performance optimization with batching
- Sync status tracking and analytics
- Webhook signature verification
- Rate limiting and caching

## 🔧 Installation & Setup

### 1. Environment Configuration

Copy the WooCommerce environment template:
```bash
cp .env.woocommerce.example .env.local
```

Update your `.env` file with WooCommerce credentials:
```env
WOOCOMMERCE_SITE_URL=https://your-store.com
WOOCOMMERCE_CONSUMER_KEY=ck_your_key_here
WOOCOMMERCE_CONSUMER_SECRET=cs_your_secret_here
WOOCOMMERCE_WEBHOOK_SECRET=your_webhook_secret
```

### 2. WooCommerce REST API Setup

1. Go to **WP Admin > WooCommerce > Settings > Advanced > REST API**
2. Click **Create an API Key**
3. Set permissions to **Read/Write**
4. Copy the Consumer Key and Consumer Secret to your `.env` file

### 3. Database Setup

The sync system uses existing NXT tables with enhanced metadata fields:
- `customers` table with `metadata` JSONB field for WC data
- `products` table with WC product information
- `purchase_orders` table for WC orders
- `inventory` table for stock synchronization

## 📡 API Endpoints

### Connection & Health
```http
GET /api/woocommerce-sync/connection/test
GET /api/woocommerce-sync/status
GET /api/woocommerce-sync/analytics?timeframe=30d
```

### Full Sync Operations
```http
POST /api/woocommerce-sync/sync/full
{
  "direction": "both", // "pull", "push", "both"
  "force": false,
  "batchSize": 100
}
```

### Customer Sync
```http
# Pull customers from WooCommerce
POST /api/woocommerce-sync/sync/customers/pull
{
  "force": false,
  "limit": 100,
  "page": 1
}

# Push customers to WooCommerce
POST /api/woocommerce-sync/sync/customers/push
{
  "customerIds": [],
  "syncAll": false,
  "syncModifiedSince": "2025-01-01T00:00:00Z"
}
```

### Product Sync
```http
# Pull products from WooCommerce
POST /api/woocommerce-sync/sync/products/pull
{
  "force": false,
  "limit": 100,
  "status": "publish"
}

# Sync single product
POST /api/woocommerce-sync/sync/products/:wcProductId
```

### Order Sync  
```http
# Pull orders from WooCommerce
POST /api/woocommerce-sync/sync/orders/pull
{
  "force": false,
  "limit": 100,
  "status": "all",
  "after": "2025-01-01T00:00:00Z"
}

# Sync single order
POST /api/woocommerce-sync/sync/orders/:wcOrderId
```

### Inventory Push
```http
# Push inventory to WooCommerce
POST /api/woocommerce-sync/sync/inventory/push
{
  "productIds": [],
  "syncAll": false,
  "syncModifiedSince": "2025-01-01T00:00:00Z"
}

# Push single product inventory
POST /api/woocommerce-sync/sync/inventory/push/:productId
```

### Webhooks
```http
# WooCommerce webhook handler (configured in WC admin)
POST /api/woocommerce-sync/webhook/:event

# Test webhook endpoint
POST /api/woocommerce-sync/webhook/test
{
  "event": "product.updated",
  "data": { ... }
}
```

### Batch Operations
```http
POST /api/woocommerce-sync/sync/batch
{
  "customers": true,
  "products": true,
  "orders": true,
  "inventory": true,
  "force": false,
  "limit": 50
}
```

### Analytics & Monitoring
```http
GET /api/woocommerce-sync/conflicts
GET /api/woocommerce-sync/history?limit=50&event_type=completed
GET /api/woocommerce-sync/export/customers?format=json&wc_only=true
```

## 🔗 Webhook Configuration

### Setup WooCommerce Webhooks

1. Go to **WP Admin > WooCommerce > Settings > Advanced > Webhooks**
2. Create webhooks for the following events:

**Customer Events:**
- Topic: `customer.created`
- Delivery URL: `https://your-nxt-domain.com/api/woocommerce-sync/webhook/customer.created`

- Topic: `customer.updated`  
- Delivery URL: `https://your-nxt-domain.com/api/woocommerce-sync/webhook/customer.updated`

**Product Events:**
- Topic: `product.created`
- Delivery URL: `https://your-nxt-domain.com/api/woocommerce-sync/webhook/product.created`

- Topic: `product.updated`
- Delivery URL: `https://your-nxt-domain.com/api/woocommerce-sync/webhook/product.updated`

**Order Events:**
- Topic: `order.created`
- Delivery URL: `https://your-nxt-domain.com/api/woocommerce-sync/webhook/order.created`

- Topic: `order.updated`
- Delivery URL: `https://your-nxt-domain.com/api/woocommerce-sync/webhook/order.updated`

### Webhook Security
- Set the **Secret** field to match your `WOOCOMMERCE_WEBHOOK_SECRET`
- API Version: **WP REST API Integration v3**
- Status: **Active**

## 🧪 Testing

### 1. Test Connection
```bash
curl -X GET http://localhost:4000/api/woocommerce-sync/connection/test
```

### 2. Test Full Sync
```bash
curl -X POST http://localhost:4000/api/woocommerce-sync/sync/full \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{"direction": "pull", "force": true, "batchSize": 10}'
```

### 3. Check Sync Status
```bash
curl -X GET http://localhost:4000/api/woocommerce-sync/status \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 4. Test Webhook
```bash
curl -X POST http://localhost:4000/api/woocommerce-sync/webhook/test \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -d '{
    "event": "product.updated",
    "data": {
      "id": 123,
      "name": "Test Product",
      "stock_quantity": 50
    }
  }'
```

## 📊 Sync Data Flow

### Customer Sync Flow
```
WooCommerce Customer → NXT Customer
- Maps WC customer to NXT customer record
- Stores WC ID in metadata for future updates
- Handles billing/shipping addresses
- Tracks paying customer status
```

### Product Sync Flow  
```
WooCommerce Product → NXT Product + Inventory
- Creates/updates product in NXT catalog
- Maps to WooCommerce supplier
- Syncs inventory levels to default warehouse
- Records inventory movements
```

### Order Sync Flow
```
WooCommerce Order → NXT Purchase Order + Line Items
- Maps WC order to NXT purchase order
- Links to synced customer record
- Creates line items for each product
- Tracks order status changes
```

### Inventory Push Flow
```
NXT Inventory → WooCommerce Stock Levels
- Monitors NXT inventory changes
- Pushes stock updates to WooCommerce
- Updates stock status (in stock/out of stock)
- Handles stock management settings
```

## 🚨 Error Handling

### Retry Logic
- Automatic retry with exponential backoff
- Maximum 3 retry attempts per API call
- Configurable retry delays

### Error Logging
- Comprehensive error logging to `woocommerce_sync_log` table
- Error categorization and metrics
- Failed sync item tracking

### Conflict Resolution
- Detects data conflicts between systems
- Provides resolution suggestions
- Supports force-sync for conflict override

## 🔍 Monitoring & Analytics

### Sync Statistics
- Total records synced per entity
- Sync success/failure rates
- Performance metrics and timing
- Recent sync activity

### Performance Metrics
- Average API response times
- Batch processing efficiency
- Error rates and patterns
- Webhook processing statistics

### Health Monitoring
- Connection status monitoring
- API rate limit tracking
- System resource usage
- Automated health checks

## 🔒 Security Features

### API Security
- JWT token authentication for admin endpoints
- API key validation for WooCommerce calls
- Rate limiting and request throttling
- Input validation and sanitization

### Webhook Security
- Signature verification using webhook secret
- IP whitelist support (optional)
- Request timestamp validation
- Replay attack prevention

## 🚀 Performance Optimization

### Batching
- Configurable batch sizes for large datasets
- Parallel processing where possible
- Memory-efficient data streaming
- Progress tracking for long operations

### Caching
- API response caching
- Metadata caching for frequent lookups
- Cache invalidation strategies
- Configurable TTL settings

### Database Optimization
- Indexed foreign keys for fast lookups
- Optimized queries for bulk operations
- Connection pooling
- Query performance monitoring

## 📈 Scaling Considerations

### High-Volume Stores
- Increase batch sizes for better throughput
- Implement queue-based processing
- Use database connection pooling
- Consider read replicas for analytics

### Multi-Store Support
- Multiple WooCommerce configurations
- Store-specific sync schedules
- Isolated error handling per store
- Consolidated reporting across stores

## 🔧 Troubleshooting

### Common Issues

**1. Connection Timeout**
- Check API credentials
- Verify store URL accessibility
- Review rate limiting settings

**2. Sync Conflicts**
- Use conflict detection endpoints
- Review data mapping logic
- Consider force-sync for resolution

**3. Webhook Failures**
- Verify webhook URLs and secrets
- Check server accessibility from WooCommerce
- Review webhook signature validation

**4. Performance Issues**
- Reduce batch sizes
- Increase API timeout values
- Enable caching for better performance

### Debug Mode
Enable detailed logging:
```env
WOOCOMMERCE_DEBUG_LOGGING=true
```

Check sync logs:
```bash
curl -X GET http://localhost:4000/api/woocommerce-sync/history?event_type=failed \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## 🎯 Next Steps

### Recommended Implementation Order
1. **Setup & Test Connection** - Verify API connectivity
2. **Initial Data Pull** - Import existing WooCommerce data
3. **Configure Webhooks** - Enable real-time sync
4. **Test Inventory Push** - Verify stock level updates
5. **Monitor & Optimize** - Fine-tune performance
6. **Schedule Automation** - Implement periodic sync jobs

### Future Enhancements
- Automated sync scheduling with cron jobs
- Advanced conflict resolution strategies  
- Multi-warehouse inventory support
- Custom field mapping configurations
- Bulk data transformation tools
- Advanced analytics and reporting

## 📞 Support

For technical support with the WooCommerce sync implementation:
1. Check the sync logs and error messages
2. Review the troubleshooting section
3. Test individual endpoints to isolate issues
4. Verify WooCommerce and NXT configurations

The bidirectional sync system is now ready for production use! 🎉