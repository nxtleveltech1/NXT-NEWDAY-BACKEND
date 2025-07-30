# Inventory Module Implementation Guide

## Overview

The Inventory Module provides comprehensive real-time inventory tracking, stock management, and analytics for the NXT NEW DAY platform. This module was built from scratch as it did not exist in the legacy system.

## Architecture

### Core Components

1. **Database Schema** (`src/db/schema.js`)
   - `inventory` - Main inventory records
   - `inventory_movements` - Movement history and audit trail
   - `products` - Product catalog integration
   - Analytics aggregation tables

2. **Service Layer** (`src/db/inventory-queries.js`)
   - Inventory CRUD operations
   - Stock movement tracking
   - Real-time updates
   - Analytics calculations

3. **Real-time Service** (`src/services/realtime-service.js`)
   - WebSocket notifications
   - Stock alert system
   - Conflict resolution

4. **Frontend Components** (`FRONTEND/src/views/admin/inventory/`)
   - Inventory list view with real-time updates
   - Stock management interfaces
   - Analytics dashboards

## Database Schema

### Inventory Table
```sql
CREATE TABLE inventory (
  id SERIAL PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id),
  warehouse_id UUID NOT NULL,
  location_id UUID,
  
  -- Stock levels
  quantity_on_hand INTEGER NOT NULL DEFAULT 0,
  quantity_available INTEGER NOT NULL DEFAULT 0,
  quantity_reserved INTEGER NOT NULL DEFAULT 0,
  quantity_in_transit INTEGER NOT NULL DEFAULT 0,
  
  -- Real-time tracking
  last_stock_check TIMESTAMP WITH TIME ZONE,
  last_movement TIMESTAMP WITH TIME ZONE,
  stock_status VARCHAR(50) NOT NULL DEFAULT 'in_stock',
  
  -- Thresholds
  reorder_point INTEGER DEFAULT 0,
  reorder_quantity INTEGER DEFAULT 0,
  max_stock_level INTEGER,
  min_stock_level INTEGER DEFAULT 0,
  
  -- Cost tracking
  average_cost DECIMAL(10,2),
  last_purchase_cost DECIMAL(10,2),
  
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

### Inventory Movements Table
```sql
CREATE TABLE inventory_movements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  inventory_id INTEGER REFERENCES inventory(id) NOT NULL,
  product_id UUID NOT NULL,
  warehouse_id UUID NOT NULL,
  
  -- Movement details
  movement_type VARCHAR(50) NOT NULL,
  quantity INTEGER NOT NULL,
  from_location UUID,
  to_location UUID,
  
  -- Financial impact
  unit_cost DECIMAL(10,2),
  total_cost DECIMAL(12,2),
  
  -- Reference information
  reference_type VARCHAR(50),
  reference_id UUID,
  reference_number VARCHAR(100),
  
  -- Tracking
  performed_by UUID,
  notes TEXT,
  batch_number VARCHAR(100),
  serial_numbers JSONB DEFAULT '[]'::jsonb,
  expiry_date DATE,
  
  -- Snapshots
  quantity_after INTEGER NOT NULL,
  running_total INTEGER NOT NULL,
  
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
```

## Core Features

### 1. Stock Level Management

#### Get Inventory with Filters
```javascript
const inventory = await getInventory({
  page: 1,
  limit: 10,
  search: 'product-name',
  warehouseId: 'warehouse-uuid',
  stockStatus: 'low_stock',
  belowReorderPoint: true,
  sortBy: 'quantityOnHand',
  sortOrder: 'asc'
});
```

#### Stock Status Types
- `in_stock` - Normal stock levels
- `low_stock` - Below reorder point
- `critical_stock` - Below minimum stock level
- `out_of_stock` - Zero quantity

### 2. Movement Tracking

#### Record Stock Movement
```javascript
const result = await recordMovement({
  inventoryId: 123,
  productId: 'product-uuid',
  warehouseId: 'warehouse-uuid',
  movementType: 'sale',
  quantity: -5,
  unitCost: 25.00,
  referenceType: 'order',
  referenceId: 'order-uuid',
  performedBy: 'user-uuid',
  notes: 'Customer order fulfillment'
});
```

#### Movement Types
- `purchase` - Inbound from supplier
- `sale` - Outbound to customer
- `transfer` - Between locations/warehouses
- `adjustment_in` - Positive stock adjustment
- `adjustment_out` - Negative stock adjustment
- `return` - Customer/supplier returns
- `damage` - Damaged goods removal
- `expiry` - Expired goods removal

### 3. Stock Reservation System

#### Reserve Stock for Orders
```javascript
const reserved = await reserveStock(
  productId,
  warehouseId,
  quantity
);
```

#### Release Reserved Stock
```javascript
const released = await releaseReservedStock(
  productId,
  warehouseId,
  quantity
);
```

### 4. Real-time Updates

The system provides real-time notifications for:
- Stock level changes
- Movement recording
- Stock alerts (low stock, out of stock)
- Reorder suggestions

#### WebSocket Events
```javascript
// Inventory change notification
{
  type: 'inventory_change',
  data: {
    id: inventoryId,
    productId,
    warehouseId,
    oldQuantity,
    newQuantity,
    quantityAvailable,
    stockStatus,
    changeReason
  }
}

// Stock alert notification
{
  type: 'stock_alert',
  data: {
    inventoryId,
    productId,
    productSku,
    productName,
    alertType: 'low_stock',
    priority: 'high',
    message: 'LOW STOCK: Product Name (SKU-123) - 5 remaining'
  }
}
```

### 5. Advanced Analytics

#### Inventory Analytics
```javascript
const analytics = await getInventoryAnalytics({
  warehouseId: 'warehouse-uuid',
  categoryFilter: 'Electronics'
});

// Returns:
// - Total items and value
// - Category breakdown
// - Stock status distribution
```

#### Advanced Analytics
```javascript
const advanced = await getAdvancedInventoryAnalytics({
  analysisType: 'all', // 'turnover', 'aging', 'trends', 'forecast'
  warehouseId: 'warehouse-uuid',
  dateFrom: '2024-01-01',
  dateTo: '2024-12-31'
});

// Returns:
// - Turnover analysis with ratios
// - Stock aging analysis
// - Movement trends
// - Basic forecasting
```

#### Key Analytics Metrics
- **Inventory Turnover Ratio**: Sales quantity ÷ Average inventory
- **Days of Inventory**: (Current stock × 365) ÷ Annual sales
- **Stock Aging Categories**:
  - Fresh (0-30 days)
  - Recent (31-90 days)
  - Aging (91-180 days)
  - Stale (181-365 days)
  - Dead Stock (>365 days)

### 6. Reorder Management

#### Get Reorder Suggestions
```javascript
const suggestions = await getReorderSuggestions();

// Returns items where:
// - quantity_available <= reorder_point
// - product is active
// - ordered by urgency
```

#### Stock Adjustment
```javascript
const adjusted = await adjustStock(
  inventoryId,
  newQuantity,
  'Physical count adjustment',
  performedByUserId,
  'Annual inventory count'
);
```

## API Endpoints

### Inventory Management
```
GET    /api/inventory              # List inventory with filters
GET    /api/inventory/:id          # Get single inventory record
POST   /api/inventory/movements    # Record stock movement
PUT    /api/inventory/:id/adjust   # Adjust stock levels
```

### Analytics
```
GET    /api/inventory/analytics           # Basic analytics
GET    /api/inventory/analytics/advanced  # Advanced analytics
GET    /api/inventory/reorder             # Reorder suggestions
```

### Real-time
```
WebSocket: /ws/inventory           # Real-time inventory updates
```

## Frontend Implementation

### Main Components

#### 1. Inventory List View (`index.jsx`)
- Real-time inventory table
- Filtering and sorting
- Stock status indicators
- WebSocket integration

#### 2. Analytics Dashboard (`InventoryAnalyticsDashboard.jsx`)
- Key metrics summary
- Turnover analysis charts
- Stock aging visualization
- Movement trends

#### 3. Stock Adjustment Form (`StockAdjustmentForm.jsx`)
- Stock level adjustments
- Reason tracking
- Validation and confirmation

#### 4. Movement History (`MovementHistory.jsx`)
- Complete audit trail
- Movement filtering
- Export capabilities

### Real-time Features
- Live stock level updates
- Instant stock alerts
- Real-time movement notifications
- Optimistic UI updates

## Integration Points

### Customer Module Integration
- Stock deduction on sales
- Reservation for pending orders
- Sales velocity tracking
- Backorder management

### Supplier Module Integration
- Purchase order receiving
- Stock replenishment
- Lead time tracking
- Supplier performance metrics

### Analytics Integration
- Daily/monthly aggregations
- Performance metrics
- Trend analysis
- Forecasting data

## Performance Optimizations

### Database Optimizations
- Strategic indexes on lookup fields
- Efficient joins with products table
- Pagination for large datasets
- Query result caching

### Real-time Optimizations
- WebSocket connection pooling
- Event batching for high volume
- Optimistic locking for conflicts
- Selective notification targeting

### Frontend Optimizations
- Virtual scrolling for large lists
- Debounced search inputs
- Optimistic UI updates
- Component memoization

## Testing Strategy

### Unit Tests
- Individual function testing
- Stock calculation validation
- Movement logic verification
- Analytics accuracy tests

### Integration Tests
- End-to-end workflow testing
- Cross-module integration
- Real-time notification testing
- Concurrency handling

### Performance Tests
- Large dataset handling
- Concurrent user scenarios
- WebSocket load testing
- Query performance benchmarks

## Security Considerations

### Access Control
- Role-based permissions
- Warehouse-level access control
- Movement authorization
- Audit trail integrity

### Data Protection
- Input validation and sanitization
- SQL injection prevention
- XSS protection in frontend
- Secure WebSocket connections

## Deployment Considerations

### Environment Setup
- Database connection pooling
- WebSocket server configuration
- Real-time service scaling
- Monitoring and alerting

### Monitoring
- Stock alert systems
- Performance metrics tracking
- Error logging and reporting
- Capacity planning

## Troubleshooting

### Common Issues

1. **Stock Discrepancies**
   ```javascript
   // Check movement history
   const movements = await getMovements({ inventoryId });
   
   // Verify calculations
   const calculated = movements.reduce((sum, m) => sum + m.quantity, 0);
   ```

2. **Real-time Connection Issues**
   ```javascript
   // Check WebSocket status
   console.log(ws.readyState);
   
   // Reconnect if needed
   if (ws.readyState === WebSocket.CLOSED) {
     connectWebSocket();
   }
   ```

3. **Performance Issues**
   ```bash
   # Check query performance
   npm run perf:analytics
   
   # Profile database operations
   npm run perf:profile
   ```

## Future Enhancements

### Planned Features
- Barcode scanning integration
- Mobile inventory management
- Advanced forecasting models
- Multi-currency support
- Batch/lot tracking
- Integration with external WMS systems

### Scalability Improvements
- Horizontal scaling for WebSocket servers
- Database sharding strategies
- Caching layer implementation
- Event-driven architecture

For additional support, refer to the main database documentation and API reference guides.