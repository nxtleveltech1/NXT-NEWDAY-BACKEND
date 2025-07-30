# Customer Segmentation Analytics - Usage Guide

## Overview

The Analytics Service now includes comprehensive customer segmentation capabilities that help identify high-value customers, at-risk customers, and opportunities for targeted marketing.

## Available Segmentation Methods

### 1. RFM Analysis (`getRFMAnalysis`)

Segments customers based on Recency, Frequency, and Monetary metrics:

```javascript
// Basic RFM analysis
const rfmResult = await analyticsService.getRFMAnalysis({
  dateFrom: '2023-01-01',
  dateTo: '2024-12-31',
  includeDetails: false
});

// With detailed customer data
const detailedRFM = await analyticsService.getRFMAnalysis({
  includeDetails: true
});
```

**RFM Segments:**
- `champions`: High RFM scores (recent, frequent, high-value customers)
- `loyal_customers`: High frequency and monetary, good recency
- `potential_loyalists`: Recent customers with potential
- `new_customers`: Recent first-time buyers
- `promising`: Good early indicators
- `customers_needing_attention`: Moderate across all metrics
- `about_to_sleep`: High value but decreasing activity
- `at_risk`: Previously good customers showing decline
- `cannot_lose_them`: High-value customers at risk
- `hibernating`: Low across all metrics
- `lost`: Very low scores, likely churned

### 2. Behavioral Segmentation (`getBehavioralSegmentation`)

Segments customers based on lifecycle stage and engagement patterns:

```javascript
const behavioralResult = await analyticsService.getBehavioralSegmentation({
  dateFrom: '2023-01-01',
  dateTo: '2024-12-31',
  includeDetails: true
});
```

**Behavioral Segments:**
- `vip`: High lifetime value with recent activity (>$10,000 + recent orders)
- `champions`: High engagement and value (≥10 orders, >$5,000, recent activity)
- `active`: Regular purchasers with recent activity
- `new`: Recently acquired customers (first order within 90 days)
- `promising`: Good early signs, needs nurturing
- `at_risk`: Previously active but declining
- `churned`: No recent activity, previously engaged
- `one_time`: Single purchase, no repeat business
- `dormant`: Registered but never purchased
- `inactive`: No recent activity

### 3. Geographic/Demographic Segmentation (`getGeographicSegmentation`)

Segments customers by location and company characteristics:

```javascript
const geoResult = await analyticsService.getGeographicSegmentation({
  includeDetails: false,
  groupByCountry: true,
  groupByRegion: true,
  groupByCity: false
});
```

**Geographic Segmentations:**
- `byCountry`: Customer distribution by country
- `byRegion`: Customer distribution by state/province/region
- `byIndustry`: Customer distribution by industry
- `byValue`: Customer distribution by value tier (enterprise, high_value, medium_value, low_value)

### 4. Comprehensive Metrics (`getSegmentMetrics`)

Calculates metrics across all segmentation approaches with recommendations:

```javascript
const metricsResult = await analyticsService.getSegmentMetrics({
  segmentType: 'all', // 'rfm', 'behavioral', 'geographic', or 'all'
  includeComparisons: true,
  includeRecommendations: true
});
```

### 5. Comprehensive Segmentation (`getComprehensiveSegmentation`)

Combines all segmentation approaches for complete customer insights:

```javascript
const comprehensiveResult = await analyticsService.getComprehensiveSegmentation({
  dateFrom: '2023-01-01',
  dateTo: '2024-12-31',
  includeDetails: false,
  includeRecommendations: true
});
```

## Response Structure

### RFM Analysis Response
```javascript
{
  data: {
    segments: [
      {
        name: 'champions',
        count: 25,
        percentage: 15.2,
        totalRevenue: 125000,
        avgRecency: 12.5,
        avgFrequency: 8.2,
        avgMonetary: 5000,
        customers: [] // if includeDetails: true
      }
    ],
    totalCustomers: 164,
    dateRange: { from: '2023-01-01', to: '2024-12-31' },
    metrics: {
      avgRecency: 45,
      avgFrequency: 3,
      avgMonetary: 2500,
      totalRevenue: 410000
    }
  },
  fromCache: false,
  duration: 1250,
  correlationId: 'analytics_1642581234567_abc123'
}
```

### Behavioral Segmentation Response
```javascript
{
  data: {
    segments: [
      {
        name: 'vip',
        count: 8,
        percentage: 4.9,
        totalRevenue: 95000,
        avgLifetimeRevenue: 11875,
        avgLifetimeOrders: 12.5,
        avgOrderValue: 950,
        customers: [] // if includeDetails: true
      }
    ],
    totalCustomers: 164,
    metrics: {
      totalRevenue: 410000,
      avgLifetimeValue: 2500,
      avgOrdersPerCustomer: 4.2
    }
  }
}
```

### Comprehensive Segmentation Response
```javascript
{
  data: {
    analysis: {
      rfm: { /* RFM analysis data */ },
      behavioral: { /* Behavioral analysis data */ },
      geographic: { /* Geographic analysis data */ }
    },
    metrics: {
      rfm: { /* RFM metrics */ },
      behavioral: { /* Behavioral metrics */ },
      geographic: { /* Geographic metrics */ }
    },
    recommendations: [
      {
        type: 'retention',
        priority: 'high',
        segment: 'champions',
        action: 'VIP loyalty program',
        description: '25 champion customers (15.2%) should be enrolled in a VIP program',
        expectedImpact: 'Increase retention and advocacy'
      }
    ],
    summary: {
      totalCustomers: 164,
      totalRevenue: 410000,
      dateRange: { from: '2023-01-01', to: '2024-12-31' },
      analysisTypes: ['RFM', 'Behavioral', 'Geographic'],
      generatedAt: '2024-07-19T10:30:00.000Z'
    },
    performance: {
      rfmDuration: 892,
      behavioralDuration: 745,
      geographicDuration: 623,
      totalDuration: 2260,
      fromCache: false
    }
  }
}
```

## Performance Characteristics

- **Target Performance**: < 2 seconds for all segmentation queries
- **Caching**: Results cached with appropriate TTLs:
  - RFM Analysis: 15 minutes
  - Behavioral Segmentation: 15 minutes
  - Geographic Segmentation: 15 minutes
  - Segment Metrics: 10 minutes
  - Comprehensive Analysis: 30 minutes
- **Parallel Execution**: Comprehensive segmentation runs all analyses in parallel
- **Query Optimization**: Uses indexed database queries with Drizzle ORM

## Use Cases

### 1. Marketing Campaign Targeting
```javascript
// Get at-risk customers for win-back campaign
const rfm = await analyticsService.getRFMAnalysis({ includeDetails: true });
const atRiskCustomers = rfm.data.segments
  .find(s => s.name === 'at_risk')?.customers || [];
```

### 2. Customer Lifetime Value Analysis
```javascript
// Identify high-value customer segments
const behavioral = await analyticsService.getBehavioralSegmentation();
const vipSegment = behavioral.data.segments.find(s => s.name === 'vip');
const championsSegment = behavioral.data.segments.find(s => s.name === 'champions');
```

### 3. Geographic Market Analysis
```javascript
// Analyze market penetration by geography
const geo = await analyticsService.getGeographicSegmentation({
  groupByCountry: true,
  groupByRegion: true
});
const topMarkets = Object.entries(geo.data.segmentations.byCountry)
  .sort((a, b) => b[1].totalRevenue - a[1].totalRevenue)
  .slice(0, 5);
```

### 4. Comprehensive Customer Insights
```javascript
// Get complete customer segmentation with recommendations
const comprehensive = await analyticsService.getComprehensiveSegmentation({
  includeRecommendations: true
});

// Extract actionable recommendations
const urgentActions = comprehensive.data.recommendations
  .filter(r => r.priority === 'urgent');
```

## Integration with Existing Analytics

The customer segmentation methods integrate seamlessly with existing analytics patterns:

- Uses the same `executeWithCache` pattern for consistent caching
- Follows the same error handling and correlation tracking
- Maintains performance monitoring and health checks
- Compatible with existing database schema and queries

## Error Handling

All segmentation methods include robust error handling:

```javascript
try {
  const result = await analyticsService.getRFMAnalysis();
  // Handle successful result
} catch (error) {
  // Error includes correlation ID for tracking
  console.error(`Segmentation failed: ${error.message}`);
}
```

## Cache Management

Invalidate segmentation cache when customer data changes:

```javascript
// Invalidate specific customer cache
await analyticsService.invalidateCache('analytics:customer*');

// Invalidate all analytics cache
await analyticsService.clearAllCache();
```