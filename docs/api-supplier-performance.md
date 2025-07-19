# Supplier Performance Analytics API

## Endpoint: GET /api/analytics/suppliers/performance

This endpoint provides comprehensive supplier performance metrics including on-time delivery rates, order fulfillment rates, price stability metrics, quality scores, and overall performance ratings.

### Request Parameters

| Parameter | Type | Required | Default | Description |
|-----------|------|----------|---------|-------------|
| `supplierId` | UUID | No | null | Filter by specific supplier ID |
| `dateFrom` | ISO Date | No | 90 days ago | Start date for analysis period |
| `dateTo` | ISO Date | No | today | End date for analysis period |
| `performanceThreshold` | Number | No | 80 | Threshold score for "excellent" classification (0-100) |
| `includeRankings` | Boolean | No | true | Include supplier rankings in response |
| `includeComparisons` | Boolean | No | true | Include comparative metrics in response |

### Example Requests

```bash
# Get all suppliers performance for last 90 days
GET /api/analytics/suppliers/performance

# Get specific supplier performance
GET /api/analytics/suppliers/performance?supplierId=550e8400-e29b-41d4-a716-446655440000

# Get performance with custom date range and threshold
GET /api/analytics/suppliers/performance?dateFrom=2024-01-01&dateTo=2024-03-31&performanceThreshold=85

# Get performance without rankings
GET /api/analytics/suppliers/performance?includeRankings=false
```

### Response Format

```json
{
  "success": true,
  "data": {
    "suppliers": [
      {
        "supplier": {
          "id": "550e8400-e29b-41d4-a716-446655440000",
          "code": "SUP001",
          "name": "Acme Corp",
          "type": "manufacturer",
          "industry": "Electronics",
          "isActive": true,
          "isApproved": true,
          "leadTimeDays": 7
        },
        "performance": {
          "currentRating": 85.5,
          "onTimeDeliveryRate": 94.2,
          "orderFulfillmentRate": 98.7,
          "priceStability": 88.3,
          "qualityScore": 92.1,
          "overallScore": 93.3,
          "status": "excellent"
        },
        "metrics": {
          "totalOrders": 156,
          "totalValue": 2450000.00,
          "averageOrderSize": 15706.41,
          "averageUnitCost": 45.23,
          "lastOrderDate": "2024-03-15T10:30:00Z",
          "priceUpdates": 3,
          "defectRate": 0.0012,
          "returnRate": 0.0008
        },
        "trends": {
          "orderVolumeChange": 12.5,
          "priceChangeFrequency": 0.15,
          "qualityTrend": "improving"
        },
        "ranking": {
          "overall": 1,
          "onTimeDelivery": 2,
          "quality": 1,
          "priceStability": 3
        }
      }
    ],
    "summary": {
      "totalSuppliers": 25,
      "averagePerformanceScore": 76.8,
      "suppliersAboveThreshold": 18,
      "topPerformer": { "name": "Acme Corp", "score": 93.3 },
      "performanceDistribution": {
        "excellent": 18,
        "good": 5,
        "fair": 2,
        "poor": 0
      },
      "keyMetrics": {
        "averageOnTimeRate": 87.4,
        "averageQualityScore": 84.2,
        "totalOrderValue": 12500000.00
      }
    },
    "filters": {
      "supplierId": null,
      "dateFrom": "2024-01-01T00:00:00.000Z",
      "dateTo": "2024-03-31T23:59:59.999Z",
      "performanceThreshold": 80,
      "includeRankings": true,
      "includeComparisons": true
    },
    "generatedAt": "2024-03-31T15:30:45.123Z"
  },
  "performance": {
    "queryDuration": "1247ms",
    "target": "<2000ms",
    "fromCache": false,
    "correlationId": "analytics_1647879045123_abc123def456"
  },
  "metadata": {
    "endpoint": "/api/analytics/suppliers/performance",
    "version": "1.0.0",
    "generatedAt": "2024-03-31T15:30:45.123Z",
    "parameters": {
      "supplierId": null,
      "dateFrom": "2024-01-01",
      "dateTo": "2024-03-31",
      "performanceThreshold": 80,
      "includeRankings": true,
      "includeComparisons": true
    }
  }
}
```

### Performance Metrics Explained

#### Core Metrics
- **On-Time Delivery Rate**: Percentage of orders delivered by expected date
- **Order Fulfillment Rate**: Percentage of order quantity successfully delivered
- **Price Stability**: Score based on frequency of price changes (100 = no changes)
- **Quality Score**: Composite score based on defect rates and customer satisfaction

#### Overall Score Calculation
The overall performance score is calculated using weighted averages:
- On-Time Delivery: 30%
- Order Fulfillment: 25%
- Price Stability: 20%
- Quality Score: 25%

#### Performance Status Classification
- **Excellent**: Score ≥ performance threshold (default 80)
- **Good**: Score ≥ 70
- **Fair**: Score ≥ 50
- **Poor**: Score < 50

### Error Responses

#### 400 Bad Request
```json
{
  "error": "Invalid supplier ID format",
  "message": "Supplier ID must be a valid UUID",
  "provided": "invalid-id"
}
```

#### 404 Not Found
```json
{
  "error": "Supplier not found",
  "message": "The specified supplier ID does not exist",
  "supplierId": "550e8400-e29b-41d4-a716-446655440000"
}
```

#### 500 Internal Server Error
```json
{
  "error": "Internal server error",
  "message": "An unexpected error occurred while processing supplier performance analytics",
  "endpoint": "/api/analytics/suppliers/performance"
}
```

### Caching

- **Cache Duration**: 15 minutes (900 seconds)
- **Cache Headers**: `Cache-Control: public, max-age=900`
- **ETag**: Includes correlation ID for cache validation
- **Performance Target**: < 2 seconds response time

### Use Cases

1. **Procurement Dashboard**: Display top-performing suppliers and identify underperformers
2. **Supplier Reviews**: Generate comprehensive performance reports for contract negotiations
3. **Supply Chain Optimization**: Identify bottlenecks and improvement opportunities
4. **Risk Management**: Monitor supplier performance trends and quality metrics
5. **Vendor Comparison**: Compare multiple suppliers across key performance indicators

### Integration Notes

- Requires existing analytics service and database schema
- Uses Redis caching for optimal performance
- Supports correlation tracking for request debugging
- Compatible with existing authentication middleware
- Follows established API response patterns

### Performance Considerations

- Query optimized with database indexes on supplier relationships
- Uses parallel query execution for multiple data sources
- Implements intelligent caching strategy
- Provides performance monitoring and alerting
- Scales efficiently with supplier count and date ranges