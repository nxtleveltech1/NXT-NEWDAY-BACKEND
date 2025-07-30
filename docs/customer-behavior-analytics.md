# Customer Behavior Analytics Implementation

## Overview

This document describes the customer behavior tracking methods added to the AnalyticsService class as part of Story 1.5: Analytics Module & AI Integration, Task 2: Customer Analytics Implementation.

## New Methods Added

### 1. `analyzePurchaseFrequency(params)`

Analyzes purchase frequency patterns for customers across different time periods.

**Parameters:**
- `customerId` (string, optional): Specific customer ID to analyze
- `dateFrom` (string, optional): Start date for analysis (ISO string)
- `dateTo` (string, optional): End date for analysis (ISO string)
- `period` (string, default: 'weekly'): Analysis period - 'daily', 'weekly', 'monthly'
- `limit` (number, default: 100): Limit results

**Returns:**
```javascript
{
  purchasePatterns: Array, // Individual customer/period patterns
  frequencyStatistics: Object, // Overall frequency statistics
  period: string,
  dateRange: { from, to }
}
```

**Example Usage:**
```javascript
const frequency = await analyticsService.analyzePurchaseFrequency({
  period: 'weekly',
  dateFrom: '2024-01-01',
  limit: 50
});
```

### 2. `calculateAverageOrderValue(params)`

Calculates average order value (AOV) metrics for customers with statistical analysis.

**Parameters:**
- `customerId` (string, optional): Specific customer ID
- `dateFrom` (string, optional): Start date for calculation
- `dateTo` (string, optional): End date for calculation
- `groupBy` (string, default: 'customer'): Group by - 'customer', 'category', 'month'
- `limit` (number, default: 50): Limit results

**Returns:**
```javascript
{
  aovAnalysis: Array, // AOV data by grouping
  overallStatistics: Object, // Overall AOV statistics
  groupBy: string,
  dateRange: { from, to }
}
```

**Example Usage:**
```javascript
const aov = await analyticsService.calculateAverageOrderValue({
  groupBy: 'customer',
  dateFrom: '2024-01-01',
  limit: 100
});
```

### 3. `calculateCustomerLifetimeValue(params)`

Computes Customer Lifetime Value (CLV) using historical purchase data and projections.

**Parameters:**
- `customerId` (string, optional): Specific customer ID
- `dateFrom` (string, optional): Start date for historical data
- `dateTo` (string, optional): End date for historical data
- `projectionMonths` (number, default: 12): Months to project CLV
- `limit` (number, default: 100): Limit results

**Returns:**
```javascript
{
  customerCLV: Array, // Individual customer CLV data
  clvStatistics: Object, // CLV distribution statistics
  projectionMonths: number,
  dateRange: { from, to }
}
```

**CLV Calculation Model:**
```
CLV = AOV × Purchase Frequency × Projection Period × Retention Score
```

**Example Usage:**
```javascript
const clv = await analyticsService.calculateCustomerLifetimeValue({
  projectionMonths: 12,
  dateFrom: '2023-01-01'
});
```

### 4. `analyzeChurnRisk(params)`

Creates churn prediction indicators based on customer purchase patterns and recency.

**Parameters:**
- `customerId` (string, optional): Specific customer ID
- `inactiveDays` (number, default: 60): Days of inactivity to consider
- `churnThresholdDays` (number, default: 90): Days threshold for churn risk
- `limit` (number, default: 100): Limit results

**Returns:**
```javascript
{
  churnRiskAnalysis: Array, // Individual customer churn risk data
  churnStatistics: Object, // Churn risk distribution
  parameters: Object // Analysis parameters used
}
```

**Churn Risk Categories:**
- **High Risk**: No orders in churn threshold period (90+ days)
- **Medium Risk**: No orders in inactive period but within churn threshold (60-90 days)
- **Low Risk**: Recent activity within 30 days

**Example Usage:**
```javascript
const churnRisk = await analyticsService.analyzeChurnRisk({
  inactiveDays: 60,
  churnThresholdDays: 90
});
```

## Performance Characteristics

### Response Time Targets
- All methods target < 2 second response time
- Optimized SQL queries with proper indexing
- Leverages existing correlation tracking system

### Caching Strategy
- Purchase Frequency: 5-minute cache TTL
- Average Order Value: 5-minute cache TTL
- Customer Lifetime Value: 10-minute cache TTL
- Churn Risk Analysis: 5-minute cache TTL

### Database Optimization
- Uses indexed fields for optimal performance:
  - `inventory_movements.created_at`
  - `inventory_movements.movement_type`
  - `inventory_movements.reference_id`
  - `inventory_movements.product_id`
- Leverages window functions for advanced analytics
- Implements efficient subqueries for statistical calculations

## Integration Examples

### API Endpoint Integration
```javascript
// Example Express.js endpoint
app.get('/api/analytics/customer-behavior/frequency', async (req, res) => {
  try {
    const { period, dateFrom, dateTo, limit } = req.query;
    
    const result = await analyticsService.analyzePurchaseFrequency({
      period,
      dateFrom,
      dateTo,
      limit: parseInt(limit) || 100
    });
    
    res.json({
      success: true,
      data: result.data,
      fromCache: result.fromCache,
      duration: result.duration
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});
```

### Dashboard Integration
```javascript
// Example dashboard data fetching
async function loadCustomerBehaviorDashboard() {
  const [frequency, aov, clv, churn] = await Promise.all([
    analyticsService.analyzePurchaseFrequency({ period: 'monthly' }),
    analyticsService.calculateAverageOrderValue({ groupBy: 'customer' }),
    analyticsService.calculateCustomerLifetimeValue({ projectionMonths: 12 }),
    analyticsService.analyzeChurnRisk({ limit: 50 })
  ]);
  
  return {
    frequency: frequency.data,
    aov: aov.data, 
    clv: clv.data,
    churnRisk: churn.data
  };
}
```

## Data Models

### Customer Frequency Analysis
```javascript
{
  customerId: "uuid",
  customerCode: "CUST001",
  customerName: "Acme Corp",
  period: "2024-01-01T00:00:00Z",
  orderCount: 5,
  totalValue: 15000.00,
  avgOrderValue: 3000.00,
  uniqueProducts: 12,
  purchaseFrequencyScore: "High"
}
```

### Customer Lifetime Value
```javascript
{
  customerId: "uuid",
  customerCode: "CUST001", 
  customerName: "Acme Corp",
  totalOrders: 25,
  totalRevenue: 75000.00,
  avgOrderValue: 3000.00,
  customerLifespanDays: 365,
  projectedCLV: 45000.00,
  valueSegment: "High Value",
  recentActivityScore: 1.0
}
```

### Churn Risk Analysis
```javascript
{
  customerId: "uuid",
  customerCode: "CUST001",
  customerName: "Acme Corp", 
  daysSinceLastOrder: 45,
  avgDaysBetweenOrders: 30,
  churnRiskScore: 0.2,
  churnRiskCategory: "Low Risk",
  productDiversityScore: 8,
  reorderProbability: "High"
}
```

## Testing

Run the test script to verify implementation:

```bash
node test-customer-behavior.js
```

This will validate that all methods are properly accessible and demonstrate expected usage patterns.

## Next Steps

1. **API Endpoints**: Create REST endpoints for each method
2. **Dashboard Integration**: Build visualization components
3. **Alert System**: Implement automated alerts for high churn risk customers
4. **ML Enhancement**: Add machine learning models for improved predictions
5. **Real-time Updates**: Consider implementing real-time analytics updates

## Monitoring

Use the built-in correlation tracking to monitor performance:

```javascript
// Get query performance metrics
const metrics = analyticsService.getQueryMetrics();
console.log('Average query duration:', metrics.averageDuration);
console.log('Slow queries:', metrics.slowQueries);
```

## Support

For questions or issues with the customer behavior analytics implementation, refer to the main AnalyticsService documentation or contact the development team.