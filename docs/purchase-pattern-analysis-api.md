# Purchase Pattern Analysis API Documentation

## Overview

The Purchase Pattern Analysis module provides comprehensive insights into customer purchasing behavior, seasonal trends, product affinities, and purchase cycles. All methods are optimized for performance with caching and target <2 second response times.

## Base Service

All methods are available through the `AnalyticsService` class:

```javascript
import { analyticsService } from './src/services/analytics.service.js';
await analyticsService.initialize();
```

## Core Methods

### 1. Seasonal Pattern Analysis

Analyzes seasonal purchasing patterns across months, weeks, and hours.

```javascript
const patterns = await analyticsService.analyzeSeasonalPatterns({
  customerId: 'uuid-string',        // Optional: specific customer
  productIds: ['uuid1', 'uuid2'],   // Optional: specific products
  categoryFilter: 'Electronics',    // Optional: product category
  timeframe: 'last_year'            // last_year, last_2_years, custom
});
```

**Response:**
```javascript
{
  data: {
    monthly: [
      {
        month: 1,
        monthName: 'January',
        totalOrders: 150,
        totalQuantity: 500,
        totalValue: '25000.00',
        avgOrderValue: '166.67',
        uniqueCustomers: 75,
        topProduct: 'uuid-string'
      }
      // ... 12 months
    ],
    weekly: [
      {
        dayOfWeek: 0,              // 0=Sunday, 1=Monday, etc.
        dayName: 'Sunday',
        totalOrders: 45,
        totalQuantity: 150,
        totalValue: '7500.00',
        avgOrderValue: '166.67'
      }
      // ... 7 days
    ],
    hourly: [
      {
        hour: 9,
        totalOrders: 12,
        totalQuantity: 40,
        totalValue: '2000.00'
      }
      // ... 24 hours
    ],
    insights: {
      peakMonth: { monthName: 'December', totalValue: '45000.00' },
      peakDay: { dayName: 'Friday', totalValue: '12000.00' },
      peakHour: { hour: 14, totalValue: '3500.00' }
    }
  },
  fromCache: false,
  duration: 850
}
```

### 2. Product Affinity Analysis

Identifies products frequently bought together using market basket analysis.

```javascript
const affinity = await analyticsService.analyzeProductAffinity({
  customerId: 'uuid-string',        // Optional: specific customer
  minSupport: 0.02,                 // 2% minimum support (frequency)
  minConfidence: 0.3,               // 30% minimum confidence
  dateFrom: '2024-01-01',          // Optional: start date
  dateTo: '2024-12-31'             // Optional: end date
});
```

**Response:**
```javascript
{
  data: {
    productPairs: [
      {
        productA: 'uuid-1',
        productAName: 'Laptop',
        productASku: 'LAP-001',
        productB: 'uuid-2',
        productBName: 'Mouse',
        productBSku: 'MOU-001',
        coOccurrences: 45,
        support: 0.05,                // 5% of all orders
        confidence: 0.75,             // 75% confidence
        lift: 2.3                     // 2.3x more likely together
      }
    ],
    categoryAffinity: [
      {
        categoryA: 'Electronics',
        categoryB: 'Accessories',
        coOccurrences: 120,
        support: 0.08,
        avgOrderValue: '450.00'
      }
    ],
    recommendations: [
      {
        recommendation: 'Customers who buy Laptop often also buy Mouse',
        confidence: 0.75,
        lift: 2.3,
        support: 0.05
      }
    ]
  },
  fromCache: false,
  duration: 1200
}
```

### 3. Purchase Cycle Analysis

Analyzes time patterns between purchases for customers, products, or categories.

```javascript
const cycles = await analyticsService.analyzePurchaseCycles({
  customerId: 'uuid-string',        // Optional: specific customer
  productIds: ['uuid1', 'uuid2'],   // Optional: specific products
  segmentBy: 'customer'             // customer, product, category
});
```

**Customer Segmentation Response:**
```javascript
{
  data: {
    customers: [
      {
        customerId: 'uuid-string',
        customerName: 'ACME Corp',
        totalOrders: 24,
        firstOrder: '2024-01-15T10:00:00Z',
        lastOrder: '2024-12-10T14:30:00Z',
        avgDaysBetweenOrders: 14.5,
        medianDaysBetweenOrders: 12.0,
        predictedNextOrder: '2024-12-24T14:30:00Z',
        totalValue: '125000.00',
        avgOrderValue: '5208.33'
      }
    ]
  },
  fromCache: false,
  duration: 900
}
```

**Product Segmentation Response:**
```javascript
{
  data: {
    products: [
      {
        productId: 'uuid-string',
        productSku: 'PRD-001',
        productName: 'Office Chair',
        category: 'Furniture',
        uniqueCustomers: 45,
        totalOrders: 78,
        avgDaysBetweenPurchases: 90.5,
        medianDaysBetweenPurchases: 75.0,
        repeatCustomerRate: 0.67,      // 67% of customers buy again
        totalQuantitySold: 156,
        totalValue: '78000.00'
      }
    ]
  }
}
```

### 4. Trending Products Analysis

Identifies products with significant growth trends across time periods.

```javascript
const trending = await analyticsService.identifyTrendingProducts({
  timeWindow: '30_days',            // 7_days, 30_days, 90_days
  customerId: 'uuid-string',        // Optional: specific customer
  categoryFilter: 'Electronics',    // Optional: product category
  minGrowthRate: 0.1               // 10% minimum growth rate
});
```

**Response:**
```javascript
{
  data: {
    trendingProducts: [
      {
        productId: 'uuid-string',
        productSku: 'NEW-001',
        productName: 'Smart Watch',
        category: 'Electronics',
        currentQuantity: 150,
        currentRevenue: '45000.00',
        currentOrders: 75,
        currentCustomers: 65,
        previousQuantity: 100,
        previousRevenue: '30000.00',
        trend: 'rising',              // new, rising, declining, stable
        quantityGrowth: 0.50,         // 50% growth
        revenueGrowth: 0.50,
        orderGrowth: 0.36,
        customerGrowth: 0.30,
        trendScore: 45.5              // Composite trend score
      }
    ],
    categoryTrends: [
      {
        category: 'Electronics',
        trendingProducts: 12,
        avgTrendScore: 38.7,
        totalRevenue: '245000.00'
      }
    ],
    summary: {
      totalTrendingProducts: 25,
      newProducts: 5,
      risingProducts: 20,
      avgTrendScore: 42.3
    }
  },
  fromCache: false,
  duration: 750
}
```

### 5. Peak Purchase Times Analysis

Analyzes when customers make purchases by hour, day of week, and day of month.

```javascript
const peakTimes = await analyticsService.analyzePeakPurchaseTimes({
  customerId: 'uuid-string',        // Optional: specific customer
  productIds: ['uuid1', 'uuid2'],   // Optional: specific products
  categoryFilter: 'Electronics',    // Optional: product category
  timezone: 'America/New_York',     // Timezone for analysis
  dateFrom: '2024-01-01',          // Optional: start date
  dateTo: '2024-12-31'             // Optional: end date
});
```

**Response:**
```javascript
{
  data: {
    hourlyPeaks: [
      {
        hour: 14,                    // 2 PM
        totalOrders: 45,
        totalQuantity: 150,
        totalValue: '7500.00',
        avgOrderValue: '166.67',
        uniqueCustomers: 35
      }
      // ... 24 hours
    ],
    weeklyPeaks: [
      {
        dayOfWeek: 5,               // Friday
        dayName: 'Friday',
        totalOrders: 125,
        totalQuantity: 400,
        totalValue: '20000.00',
        avgOrderValue: '160.00',
        uniqueCustomers: 95
      }
      // ... 7 days
    ],
    monthlyDayPeaks: [
      {
        dayOfMonth: 15,             // 15th of month
        totalOrders: 85,
        totalValue: '12750.00',
        avgOrderValue: '150.00'
      }
      // ... 31 days
    ],
    insights: {
      peakHour: {
        hour: 14,
        description: '14:00',
        totalValue: '7500.00',
        orderCount: 45
      },
      peakDay: {
        dayOfWeek: 5,
        dayName: 'Friday',
        totalValue: '20000.00',
        orderCount: 125
      },
      peakMonthDay: {
        dayOfMonth: 15,
        description: 'Day 15 of month',
        totalValue: '12750.00',
        orderCount: 85
      },
      businessHours: {
        start: 9,                   // 9 AM
        end: 17                     // 5 PM
      }
    }
  },
  fromCache: false,
  duration: 950
}
```

### 6. Comprehensive Purchase Patterns

Combines all pattern analyses into a single comprehensive report with actionable insights.

```javascript
const patterns = await analyticsService.getComprehensivePurchasePatterns({
  customerId: 'uuid-string',        // Optional: specific customer
  includeSeasonality: true,         // Include seasonal analysis
  includeAffinity: true,           // Include product affinity
  includeCycles: true,             // Include purchase cycles
  includeTrending: true,           // Include trending products
  includePeakTimes: true           // Include peak times
});
```

**Response:**
```javascript
{
  data: {
    seasonality: { /* Seasonal pattern data */ },
    productAffinity: { /* Product affinity data */ },
    purchaseCycles: { /* Purchase cycle data */ },
    trendingProducts: { /* Trending products data */ },
    peakTimes: { /* Peak times data */ },
    insights: [
      {
        type: 'seasonality',          // seasonality, cross_sell, retention, trending, timing
        priority: 'high',             // high, medium, low
        message: 'Peak sales occur in December with 245 orders and $125,000.00 revenue',
        actionable: true,
        recommendation: 'Consider increasing inventory and marketing efforts before peak season'
      },
      {
        type: 'cross_sell',
        priority: 'medium',
        message: 'Customers who buy Laptop often also buy Mouse',
        confidence: 0.75,
        actionable: true,
        recommendation: 'Implement product bundling or cross-sell campaigns'
      },
      {
        type: 'retention',
        priority: 'high',
        message: 'Average purchase cycle is 28.5 days',
        actionable: true,
        recommendation: 'Set up automated follow-up campaigns 23 days after purchase'
      }
    ],
    metadata: {
      generatedAt: '2024-07-19T10:30:00Z',
      customerId: 'uuid-string',
      scope: 'customer'               // customer or global
    }
  },
  fromCache: false,
  duration: 1850
}
```

## Performance Features

### Caching
- **Seasonal patterns**: 15-minute cache
- **Product affinity**: 30-minute cache  
- **Purchase cycles**: 10-minute cache
- **Trending products**: 5-minute cache
- **Peak times**: 10-minute cache
- **Comprehensive patterns**: 30-minute cache

### Performance Monitoring
```javascript
const metrics = analyticsService.getQueryMetrics();
console.log(`Average query time: ${metrics.averageDuration}ms`);
console.log(`Slow queries (>2s): ${metrics.slowQueries.length}`);
```

### Health Check
```javascript
const health = await analyticsService.healthCheck();
console.log(`Status: ${health.status}`);
console.log(`Query time: ${health.queryTime}ms`);
```

## Error Handling

All methods include comprehensive error handling:

```javascript
try {
  const patterns = await analyticsService.analyzeSeasonalPatterns(params);
  console.log('Success:', patterns.data);
} catch (error) {
  console.error('Analysis failed:', error.message);
  // Error includes correlation ID for tracking
}
```

## Integration Examples

### Customer-Specific Analysis
```javascript
// Analyze patterns for a specific customer
const customerPatterns = await analyticsService.getComprehensivePurchasePatterns({
  customerId: 'customer-uuid-here',
  includeSeasonality: true,
  includeCycles: true
});

// Use insights for personalized recommendations
customerPatterns.data.insights.forEach(insight => {
  if (insight.type === 'cross_sell' && insight.actionable) {
    console.log('Recommendation:', insight.recommendation);
  }
});
```

### Category Performance Analysis
```javascript
// Analyze trending products in Electronics category
const electronics = await analyticsService.identifyTrendingProducts({
  categoryFilter: 'Electronics',
  timeWindow: '30_days',
  minGrowthRate: 0.15
});

// Focus inventory on trending products
electronics.data.trendingProducts.forEach(product => {
  console.log(`${product.productName}: ${product.trendScore}% trend score`);
});
```

### Automated Marketing Triggers
```javascript
// Set up automated follow-up campaigns based on purchase cycles
const cycles = await analyticsService.analyzePurchaseCycles({
  segmentBy: 'customer'
});

cycles.data.customers.forEach(customer => {
  if (customer.avgDaysBetweenOrders) {
    const followUpDays = Math.floor(customer.avgDaysBetweenOrders * 0.8);
    console.log(`Set follow-up for ${customer.customerName} in ${followUpDays} days`);
  }
});
```

## Best Practices

1. **Use appropriate time windows** for trending analysis based on business needs
2. **Cache results** when possible to improve performance
3. **Filter by customer or category** to reduce query complexity
4. **Monitor query performance** using the built-in metrics
5. **Implement error handling** for production use
6. **Use insights array** for actionable business recommendations

## Database Requirements

The analysis uses the following tables:
- `inventory_movements` (primary data source)
- `products` (product information)
- `customers` (customer information)

Ensure proper indexing on:
- `inventory_movements.created_at`
- `inventory_movements.movement_type`
- `inventory_movements.reference_id`
- `inventory_movements.product_id`
- `products.category`