# Inventory Analytics Module

## Overview

The Inventory Analytics module provides comprehensive analytical capabilities for inventory management, including turnover analysis, stock optimization, dead stock identification, and reorder point calculations. This module is designed for high performance and supports various analytical methods to help optimize inventory operations.

## Features

### 1. Inventory Turnover Analysis
- **Turnover Ratio Calculation**: Cost of Goods Sold / Average Inventory Value
- **Annual Turnover Metrics**: Annualized turnover rates for performance assessment
- **Days of Inventory**: How many days of sales current inventory represents
- **Turnover Health Status**: Categorization (excellent, good, fair, poor, critical)
- **Trend Analysis**: Historical turnover patterns over time periods

### 2. Stock Level Optimization
- **Economic Order Quantity (EOQ)**: Optimal order quantities to minimize costs
- **Safety Stock Calculation**: Statistical safety stock based on demand variability
- **Min-Max Method**: Simple minimum and maximum stock level calculations
- **Fixed Period Review**: Periodic review system with optimized parameters
- **Cost Optimization**: Holding cost vs. ordering cost balance

### 3. ABC Analysis
- **Revenue-based Classification**: Products categorized by revenue contribution
- **Quantity-based Classification**: Products categorized by volume sold
- **Margin-based Classification**: Products categorized by profit margin
- **Strategic Recommendations**: Different management strategies for each class

### 4. Dead Stock Identification
- **Dead Stock Detection**: Items with no movement for specified periods
- **Slow-Moving Inventory**: Items with low velocity but some movement
- **Risk Assessment**: Financial impact and risk level evaluation
- **Liquidation Recommendations**: Suggested actions for problem inventory

### 5. Reorder Point Optimization
- **Statistical Method**: Z-score based calculations with service levels
- **Demand Forecasting**: Pattern analysis for demand prediction
- **Lead Time Optimization**: Lead time demand calculations
- **Service Level Management**: Configurable service level targets

## API Endpoints

### GET /api/analytics/inventory/turnover

Calculate inventory turnover metrics and trends.

**Query Parameters:**
- `warehouseId` (optional): Filter by specific warehouse
- `categoryFilter` (optional): Filter by product category
- `dateFrom` (optional): Start date for analysis
- `dateTo` (optional): End date for analysis
- `productId` (optional): Analyze specific product
- `groupBy` (optional): Grouping method (product, category, warehouse, all)
- `includeTrends` (optional): Include historical trend data
- `periodType` (optional): Trend period type (weekly, monthly, quarterly)
- `periodsBack` (optional): Number of periods to analyze

**Response:**
```json
{
  "turnover": [
    {
      "productId": "uuid",
      "productSku": "PROD001",
      "productName": "Product Name",
      "category": "Electronics",
      "turnoverRatio": 4.5,
      "annualTurnover": 18.2,
      "daysOfInventory": 20,
      "dailySalesRate": 5.2,
      "inventoryVelocity": 18.25,
      "turnoverHealth": "good",
      "cogsTotal": 45000,
      "avgInventoryValue": 10000,
      "currentInventoryValue": 12000
    }
  ],
  "trends": [
    {
      "period": "2024-01-01T00:00:00.000Z",
      "turnoverRatio": 4.2,
      "cogs": 15000,
      "avgInventoryValue": 3571,
      "unitsSold": 250,
      "avgStockLevel": 100
    }
  ],
  "summary": {
    "totalItems": 25,
    "avgTurnoverRatio": 6.8,
    "avgDaysOfInventory": 54,
    "totalInventoryValue": 150000,
    "totalCOGS": 890000,
    "healthDistribution": {
      "excellent": 5,
      "good": 8,
      "fair": 7,
      "poor": 3,
      "critical": 2
    }
  }
}
```

### GET /api/analytics/inventory/optimization

Get stock level optimization recommendations.

**Query Parameters:**
- `warehouseId` (optional): Filter by warehouse
- `productId` (optional): Analyze specific product
- `analysisMethod` (optional): Method (economic_order_quantity, safety_stock, abc_analysis)
- `lookbackDays` (optional): Analysis period in days
- `serviceLevel` (optional): Target service level (0-1)
- `leadTimeDays` (optional): Lead time in days
- `includeABC` (optional): Include ABC analysis
- `abcCriteria` (optional): ABC criteria (revenue, quantity, margin)
- `reorderMethod` (optional): Reorder calculation method

**Response:**
```json
{
  "optimization": [
    {
      "productId": "uuid",
      "productSku": "PROD001",
      "currentStock": 100,
      "optimizedReorderPoint": 45,
      "optimizedReorderQuantity": 75,
      "safetyStock": 15,
      "maxStock": 120,
      "currentAnnualCost": 2500,
      "optimizedAnnualCost": 2100,
      "potentialSavings": 400,
      "improvementPercentage": 16.0,
      "recommendation": "optimize_reorder_point"
    }
  ],
  "abcAnalysis": {
    "items": [...],
    "summary": {...}
  },
  "reorderOptimization": [...],
  "summary": {
    "totalItems": 50,
    "potentialSavings": 15000,
    "avgImprovementPercentage": 12.5,
    "recommendationDistribution": {...},
    "highPriorityItems": 8
  }
}
```

### GET /api/analytics/inventory/alerts

Get inventory alerts and warnings.

**Query Parameters:**
- `warehouseId` (optional): Filter by warehouse
- `categoryFilter` (optional): Filter by category
- `deadStockDays` (optional): Days for dead stock threshold
- `slowMovingDays` (optional): Days for slow-moving threshold
- `minQuantityThreshold` (optional): Minimum quantity to consider
- `includeSlowMoving` (optional): Include slow-moving items
- `alertTypes` (optional): Comma-separated alert types (dead_stock, reorder, overstock)

**Response:**
```json
{
  "alerts": [
    {
      "type": "dead_stock",
      "severity": "high",
      "productId": "uuid",
      "productSku": "PROD003",
      "productName": "Dead Product",
      "warehouseId": "uuid",
      "message": "Dead Product (PROD003): No sales for 200 days",
      "details": {
        "quantityOnHand": 50,
        "inventoryValue": 1500,
        "daysWithoutSale": 200,
        "daysOfInventory": 999,
        "recommendations": ["liquidate_high_value", "consider_disposal"]
      },
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "summary": {
    "totalAlerts": 15,
    "alertsByType": {
      "dead_stock": 3,
      "slow_moving": 5,
      "reorder_needed": 4,
      "overstock": 3
    },
    "alertsBySeverity": {
      "critical": 2,
      "high": 6,
      "medium": 5,
      "low": 2
    },
    "totalValueAtRisk": 25000,
    "totalPotentialSavings": 8000
  }
}
```

## Module Functions

### Core Analytics Functions

#### `calculateInventoryTurnover(params)`
Calculates inventory turnover ratios and related metrics.

**Parameters:**
- `warehouseId`: Filter by warehouse
- `categoryFilter`: Filter by category
- `dateFrom/dateTo`: Date range
- `productId`: Specific product
- `groupBy`: Grouping method

**Returns:** Array of turnover analysis objects

#### `calculateOptimalStockLevels(params)`
Calculates optimal stock levels using various methods.

**Parameters:**
- `analysisMethod`: EOQ, safety_stock, min_max, fixed_period
- `serviceLevel`: Target service level (0-1)
- `leadTimeDays`: Lead time in days
- `lookbackDays`: Analysis period

**Returns:** Array of optimization recommendations

#### `performABCAnalysis(params)`
Performs ABC analysis for inventory categorization.

**Parameters:**
- `criteriaType`: revenue, quantity, margin
- `lookbackDays`: Analysis period

**Returns:** Object with classified items and summary

#### `identifyDeadStock(params)`
Identifies dead and slow-moving inventory.

**Parameters:**
- `deadStockDays`: Threshold for dead stock
- `slowMovingDays`: Threshold for slow-moving
- `includeSlowMoving`: Include slow-moving items

**Returns:** Object with problem inventory and summary

#### `calculateOptimizedReorderPoints(params)`
Calculates optimized reorder points using statistical methods.

**Parameters:**
- `method`: statistical, min_max, fixed_period
- `serviceLevel`: Target service level
- `leadTimeDays`: Lead time in days

**Returns:** Array of reorder point recommendations

## Performance Considerations

### Database Optimization
- Indexed queries on key fields (productId, warehouseId, createdAt)
- Efficient joins using proper foreign key relationships
- Pagination support for large datasets
- Query optimization for complex aggregations

### Caching Strategy
- Results can be cached for frequently accessed data
- Consider implementing Redis caching for expensive calculations
- Time-based cache invalidation for real-time accuracy

### Memory Management
- Large datasets are processed in batches
- Streaming results for very large inventories
- Configurable limits to prevent memory issues

## Algorithm Details

### Economic Order Quantity (EOQ)
```
EOQ = √(2 × Annual Demand × Ordering Cost / Holding Cost)
```

### Safety Stock Calculation
```
Safety Stock = Z-score × √(Lead Time) × Demand Standard Deviation
```

### Reorder Point
```
Reorder Point = (Average Daily Demand × Lead Time) + Safety Stock
```

### Inventory Turnover Ratio
```
Turnover Ratio = Cost of Goods Sold / Average Inventory Value
```

### ABC Classification
- **Class A**: Top 80% of value (tight control)
- **Class B**: Next 15% of value (moderate control)
- **Class C**: Remaining 5% of value (simple control)

## Error Handling

The module includes comprehensive error handling:
- Input validation for all parameters
- Graceful handling of missing data
- Database connection error recovery
- Detailed error logging for debugging

## Testing

Comprehensive test suite includes:
- Unit tests for all calculation functions
- Integration tests for database operations
- Performance tests for large datasets
- Edge case testing for boundary conditions

Run tests with:
```bash
npm test src/db/__tests__/inventory-analytics.test.js
```

## Usage Examples

### Basic Turnover Analysis
```javascript
const turnover = await inventoryAnalytics.calculateInventoryTurnover({
  groupBy: 'category',
  lookbackDays: 90
});
```

### Dead Stock Identification
```javascript
const deadStock = await inventoryAnalytics.identifyDeadStock({
  deadStockDays: 180,
  slowMovingDays: 90,
  includeSlowMoving: true
});
```

### EOQ Optimization
```javascript
const optimization = await inventoryAnalytics.calculateOptimalStockLevels({
  analysisMethod: 'economic_order_quantity',
  serviceLevel: 0.95,
  leadTimeDays: 7
});
```

## Dependencies

- `drizzle-orm`: Database ORM for PostgreSQL
- `pg`: PostgreSQL client
- Database schema with `inventory`, `inventoryMovements`, `products`, and `suppliers` tables

## Future Enhancements

1. **Machine Learning Integration**: Demand forecasting using ML models
2. **Seasonal Analysis**: Seasonal demand pattern recognition
3. **Multi-location Optimization**: Cross-warehouse optimization
4. **Real-time Analytics**: Streaming analytics for real-time decisions
5. **Advanced Forecasting**: Time series forecasting models
6. **Cost Optimization**: Advanced cost modeling and optimization
7. **Supplier Performance**: Supplier lead time and reliability analytics