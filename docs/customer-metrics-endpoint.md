# Customer Metrics API Endpoint

## GET /api/analytics/customers/:id/metrics

This endpoint provides comprehensive analytics for a specific customer, useful for customer service and account management.

### Authentication
- **Required**: JWT token in Authorization header
- **Format**: `Authorization: Bearer <token>`

### URL Parameters
- `id` (required): Customer ID (UUID or string)

### Query Parameters
- `dateFrom` (optional): Start date for filtering data (YYYY-MM-DD format)
- `dateTo` (optional): End date for filtering data (YYYY-MM-DD format)
- `includeDetails` (optional): Include detailed raw metrics (true/false, default: false)

### Performance
- **Target Response Time**: < 2 seconds
- **Caching**: Private cache for 5 minutes (300 seconds)

### Response Structure

```json
{
  "customerId": "string",
  "customerInfo": {
    "customerCode": "string",
    "companyName": "string",
    "email": "string"
  },
  "purchaseHistorySummary": {
    "totalLifetimeOrders": "number",
    "totalLifetimeValue": "number",
    "averageOrderValue": "number",
    "lastPurchaseDate": "string|null",
    "firstPurchaseDate": "string|null",
    "customerLifespanDays": "number"
  },
  "lifetimeValue": {
    "historical": "number",
    "predicted": "number",
    "segment": "string"
  },
  "behaviorPatterns": {
    "purchaseFrequency": {
      "avgDaysBetweenOrders": "number|null",
      "ordersPerMonth": "number"
    },
    "preferredProducts": [
      {
        "productId": "string",
        "productSku": "string", 
        "productName": "string",
        "category": "string",
        "totalQuantityPurchased": "number",
        "totalSpent": "number",
        "orderCount": "number"
      }
    ],
    "seasonalPatterns": [
      {
        "period": "string",
        "periodLabel": "string",
        "totalOrders": "number",
        "totalValue": "number",
        "avgOrderValue": "number"
      }
    ]
  },
  "segmentClassification": {
    "segment": "string",
    "rfmProfile": {
      "recency": "number|null",
      "frequency": "number",
      "monetary": "number"
    }
  },
  "churnRiskScore": {
    "score": "number",
    "risk": "string",
    "indicators": ["string"],
    "daysSinceLastPurchase": "number|null"
  },
  "purchaseFrequency": {
    "avgDaysBetweenOrders": "number|null",
    "ordersPerMonth": "number",
    "totalDaysAsCustomer": "number"
  },
  "responseTime": "number",
  "generatedAt": "string",
  "dataScope": {
    "dateFrom": "string|null",
    "dateTo": "string|null",
    "includeDetails": "boolean"
  },
  "detailedMetrics": {
    // Only included when includeDetails=true
    "fullPurchaseFrequency": "object",
    "fullAverageOrderValue": "object", 
    "fullCustomerLifetimeValue": "object",
    "fullChurnPrediction": "object",
    "fullSalesVelocity": "array",
    "fullPurchasePatterns": "object"
  }
}
```

### Customer Segments
- **Champions**: High value, high frequency, recent purchases
- **Loyal Customers**: Consistent high-value customers
- **Potential Loyalists**: High value but infrequent
- **New Customers**: Recent customers with potential
- **Promising Customers**: New customers with good potential
- **Customers Needing Attention**: Declining activity
- **About to Sleep**: Moderate recency but declining
- **At Risk**: Low recency but previously active
- **Cannot Lose Them**: High value but at risk
- **Hibernating**: Long time since last purchase
- **Lost**: No recent activity

### Churn Risk Levels
- **Low**: Score 0-19 (healthy customer)
- **Medium**: Score 20-39 (monitor closely)
- **High**: Score 40-59 (intervention needed)
- **Critical**: Score 60+ (immediate action required)

### Error Responses

#### 404 - Customer Not Found
```json
{
  "error": "Customer not found",
  "customerId": "string"
}
```

#### 500 - Internal Server Error
```json
{
  "error": "Failed to fetch customer metrics",
  "details": "string",
  "customerId": "string"
}
```

### Example Usage

```bash
# Basic customer metrics
curl -H "Authorization: Bearer <token>" \
  "http://localhost:4000/api/analytics/customers/123/metrics"

# With date filtering
curl -H "Authorization: Bearer <token>" \
  "http://localhost:4000/api/analytics/customers/123/metrics?dateFrom=2024-01-01&dateTo=2024-12-31"

# With detailed metrics
curl -H "Authorization: Bearer <token>" \
  "http://localhost:4000/api/analytics/customers/123/metrics?includeDetails=true"
```

### Data Sources
The endpoint aggregates data from:
- Customer purchase history (`inventory_movements`)
- Customer profiles (`customers`)
- Product information (`products`)
- Inventory records (`inventory`)

### Performance Optimizations
1. **Parallel Query Execution**: All analytics queries run in parallel
2. **Private Caching**: Response cached for 5 minutes per customer
3. **Database Indexing**: Optimized queries with proper indexes
4. **Response Time Monitoring**: Warns if response exceeds 2 seconds
5. **Conditional Details**: Detailed metrics only included when requested

### Integration with Analytics Service
This endpoint utilizes the existing `analyticsService` and customer query functions:
- `calculatePurchaseFrequency()`
- `calculateAverageOrderValue()`
- `calculateCustomerLifetimeValue()`
- `calculateChurnPredictionIndicators()`
- `getCustomerSalesVelocity()`
- `analyzePurchasePatterns()`

### Business Use Cases
- **Customer Service**: Quick customer overview for support agents
- **Account Management**: Identify high-value customers needing attention
- **Sales Strategy**: Understand customer behavior patterns
- **Retention**: Identify customers at risk of churning
- **Upselling**: Find customers with growth potential
- **Segmentation**: Classify customers for targeted marketing