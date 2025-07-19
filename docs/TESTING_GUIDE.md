# Testing Guide for NXT NEW DAY

## Overview

This guide covers the comprehensive testing strategy for the NXT NEW DAY platform, including unit tests, integration tests, performance tests, and quality assurance procedures.

## Testing Philosophy

Our testing approach follows the **Testing Pyramid**:
1. **Unit Tests** (70%) - Fast, isolated, component-level tests
2. **Integration Tests** (20%) - Module interaction and API tests
3. **End-to-End Tests** (10%) - Full workflow and user journey tests

## Test Environment Setup

### Prerequisites
```bash
# Install test dependencies
npm install

# Set up test database
cp .env.example .env.test
# Configure TEST_DATABASE_URL in .env.test

# Create test database
npm run db:create:test
npm run db:migrate:test
```

### Environment Configuration
```bash
# .env.test
NODE_ENV=test
DATABASE_URL=postgres://test_user:test_pass@localhost:5432/nxt_test
REDIS_URL=redis://localhost:6379/1
JWT_SECRET=test_secret_key
```

## Test Commands

### Basic Commands
```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run with coverage report
npm run test:coverage

# Run specific test suites
npm run test:unit
npm run test:integration
npm run test:performance
```

### Advanced Commands
```bash
# Run tests for specific module
npm test -- --testPathPattern=inventory

# Run tests with verbose output
npm test -- --verbose

# Run failed tests only
npm test -- --onlyFailures

# Update snapshots
npm test -- --updateSnapshot
```

## Unit Testing

### Test Structure

```javascript
// Example: src/db/__tests__/inventory-queries.test.js
import { describe, test, expect, beforeEach, afterEach } from '@jest/globals';
import { 
  getInventory, 
  recordMovement, 
  getInventoryById 
} from '../inventory-queries.js';
import { setupTestDatabase, cleanupTestDatabase } from '../../test-utils/database.js';

describe('Inventory Queries', () => {
  beforeEach(async () => {
    await setupTestDatabase();
  });

  afterEach(async () => {
    await cleanupTestDatabase();
  });

  describe('getInventory', () => {
    test('should return paginated inventory list', async () => {
      // Arrange
      const params = { page: 1, limit: 10 };
      
      // Act
      const result = await getInventory(params);
      
      // Assert
      expect(result).toHaveProperty('data');
      expect(result).toHaveProperty('pagination');
      expect(result.pagination.page).toBe(1);
      expect(result.data).toBeInstanceOf(Array);
    });

    test('should filter by warehouse', async () => {
      // Test implementation
    });

    test('should handle search queries', async () => {
      // Test implementation
    });
  });

  describe('recordMovement', () => {
    test('should record sale movement and update stock', async () => {
      // Arrange
      const movement = {
        inventoryId: 1,
        productId: 'test-product-uuid',
        warehouseId: 'test-warehouse-uuid',
        movementType: 'sale',
        quantity: -5,
        performedBy: 'test-user-uuid'
      };

      // Act
      const result = await recordMovement(movement);

      // Assert
      expect(result).toHaveProperty('movement');
      expect(result).toHaveProperty('inventory');
      expect(result.movement.quantity).toBe(-5);
      expect(result.inventory.quantityOnHand).toBeLessThan(25); // Assuming initial stock of 25
    });

    test('should throw error for insufficient stock', async () => {
      // Test error conditions
      const movement = {
        inventoryId: 1,
        quantity: -1000, // More than available
        movementType: 'sale'
      };

      await expect(recordMovement(movement)).rejects.toThrow('Insufficient available stock');
    });
  });
});
```

### Stock Calculation Tests

```javascript
// Test critical business logic
describe('Stock Calculations', () => {
  test('should calculate stock status correctly', () => {
    expect(calculateStockStatus(0, 10, 5)).toBe('out_of_stock');
    expect(calculateStockStatus(8, 10, 5)).toBe('low_stock');
    expect(calculateStockStatus(3, 10, 5)).toBe('critical_stock');
    expect(calculateStockStatus(15, 10, 5)).toBe('in_stock');
  });

  test('should calculate average cost correctly', () => {
    const movements = [
      { quantity: 10, unitCost: 15.00 },
      { quantity: 5, unitCost: 18.00 }
    ];
    
    const avgCost = calculateAverageCost(movements);
    expect(avgCost).toBeCloseTo(16.00, 2);
  });

  test('should handle turnover ratio calculations', () => {
    const turnover = calculateTurnoverRatio(100, 20); // Sales: 100, Avg Inventory: 20
    expect(turnover).toBe(5.0);
  });
});
```

### Analytics Tests

```javascript
describe('Analytics Calculations', () => {
  test('should generate aging analysis correctly', async () => {
    // Create test data with different ages
    await createTestInventory([
      { lastMovement: new Date('2024-01-01'), quantity: 10 }, // Old
      { lastMovement: new Date(), quantity: 20 } // Fresh
    ]);

    const analysis = await getAdvancedInventoryAnalytics({ analysisType: 'aging' });
    
    expect(analysis.agingAnalysis.summary).toContainEqual(
      expect.objectContaining({
        agingCategory: 'Fresh (0-30 days)',
        itemCount: 1
      })
    );
  });

  test('should calculate inventory turnover accurately', async () => {
    // Test with known data
    const result = await getAdvancedInventoryAnalytics({ analysisType: 'turnover' });
    
    expect(result.turnoverAnalysis).toBeInstanceOf(Array);
    expect(result.turnoverAnalysis[0]).toHaveProperty('turnoverRatio');
    expect(result.turnoverAnalysis[0]).toHaveProperty('daysOfInventory');
  });
});
```

## Integration Testing

### API Endpoint Tests

```javascript
// __tests__/integration/inventory-api.test.js
import request from 'supertest';
import { app } from '../../index.js';
import { getAuthToken } from '../helpers/auth.js';

describe('Inventory API Integration', () => {
  let authToken;

  beforeAll(async () => {
    authToken = await getAuthToken();
  });

  describe('GET /api/inventory', () => {
    test('should return inventory list with authentication', async () => {
      const response = await request(app)
        .get('/api/inventory')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.data).toBeInstanceOf(Array);
      expect(response.body.pagination).toBeDefined();
    });

    test('should reject requests without authentication', async () => {
      await request(app)
        .get('/api/inventory')
        .expect(401);
    });

    test('should handle query parameters correctly', async () => {
      const response = await request(app)
        .get('/api/inventory?page=2&limit=5&stockStatus=low_stock')
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(response.body.pagination.page).toBe(2);
      expect(response.body.pagination.limit).toBe(5);
    });
  });

  describe('POST /api/inventory/movements', () => {
    test('should record movement and update inventory', async () => {
      const movement = {
        inventoryId: 1,
        productId: 'test-product-uuid',
        warehouseId: 'test-warehouse-uuid',
        movementType: 'sale',
        quantity: -2,
        performedBy: 'test-user-uuid',
        notes: 'Test sale'
      };

      const response = await request(app)
        .post('/api/inventory/movements')
        .set('Authorization', `Bearer ${authToken}`)
        .send(movement)
        .expect(201);

      expect(response.body.success).toBe(true);
      expect(response.body.data.movement.quantity).toBe(-2);
      expect(response.body.data.inventory.quantityOnHand).toBeDefined();
    });

    test('should validate required fields', async () => {
      const invalidMovement = {
        movementType: 'sale'
        // Missing required fields
      };

      await request(app)
        .post('/api/inventory/movements')
        .set('Authorization', `Bearer ${authToken}`)
        .send(invalidMovement)
        .expect(400);
    });
  });
});
```

### Database Integration Tests

```javascript
describe('Database Integration', () => {
  test('should maintain referential integrity', async () => {
    // Test foreign key constraints
    const invalidMovement = {
      inventoryId: 99999, // Non-existent
      productId: 'non-existent-uuid',
      quantity: 5
    };

    await expect(recordMovement(invalidMovement))
      .rejects.toThrow();
  });

  test('should handle concurrent stock updates', async () => {
    const inventoryId = 1;
    const movements = [
      { inventoryId, quantity: -5, movementType: 'sale' },
      { inventoryId, quantity: -3, movementType: 'sale' },
      { inventoryId, quantity: 10, movementType: 'purchase' }
    ];

    // Execute movements concurrently
    const promises = movements.map(movement => recordMovement(movement));
    const results = await Promise.all(promises);

    // Verify final state
    const finalInventory = await getInventoryById(inventoryId);
    const expectedQuantity = movements.reduce((sum, m) => sum + m.quantity, 20); // Assuming initial 20
    
    expect(finalInventory.quantityOnHand).toBe(expectedQuantity);
  });
});
```

### Real-time Integration Tests

```javascript
describe('Real-time WebSocket Integration', () => {
  test('should send inventory change notifications', (done) => {
    const ws = new WebSocket('ws://localhost:4000/ws/inventory');
    
    ws.onopen = () => {
      // Authenticate
      ws.send(JSON.stringify({
        type: 'auth',
        token: authToken
      }));
    };

    ws.onmessage = (event) => {
      const message = JSON.parse(event.data);
      
      if (message.type === 'inventory_change') {
        expect(message.data).toHaveProperty('id');
        expect(message.data).toHaveProperty('oldQuantity');
        expect(message.data).toHaveProperty('newQuantity');
        ws.close();
        done();
      }
    };

    // Trigger a movement to generate notification
    setTimeout(async () => {
      await recordMovement({
        inventoryId: 1,
        quantity: -1,
        movementType: 'sale'
      });
    }, 100);
  });

  test('should send stock alerts for low stock', (done) => {
    // Test stock alert notifications
  });
});
```

## Performance Testing

### Load Testing

```javascript
// __tests__/performance/load-test.js
import autocannon from 'autocannon';

describe('Performance Tests', () => {
  test('inventory list endpoint performance', async () => {
    const result = await autocannon({
      url: 'http://localhost:4000/api/inventory',
      connections: 10,
      duration: 10,
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    expect(result.errors).toBe(0);
    expect(result.latency.average).toBeLessThan(100); // < 100ms average
    expect(result.requests.average).toBeGreaterThan(50); // > 50 req/sec
  });

  test('analytics endpoint performance', async () => {
    const result = await autocannon({
      url: 'http://localhost:4000/api/inventory/analytics',
      connections: 5,
      duration: 10,
      headers: {
        'Authorization': `Bearer ${authToken}`
      }
    });

    expect(result.errors).toBe(0);
    expect(result.latency.average).toBeLessThan(500); // < 500ms for analytics
  });
});
```

### Database Performance Tests

```javascript
describe('Database Performance', () => {
  test('large dataset pagination performance', async () => {
    // Create large test dataset
    await createLargeTestDataset(10000);

    const startTime = Date.now();
    const result = await getInventory({ page: 100, limit: 50 });
    const endTime = Date.now();

    expect(endTime - startTime).toBeLessThan(200); // < 200ms
    expect(result.data.length).toBe(50);
  });

  test('complex analytics query performance', async () => {
    const startTime = Date.now();
    const analytics = await getAdvancedInventoryAnalytics({
      analysisType: 'all',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31'
    });
    const endTime = Date.now();

    expect(endTime - startTime).toBeLessThan(1000); // < 1 second
    expect(analytics).toHaveProperty('turnoverAnalysis');
  });
});
```

## End-to-End Testing

### User Workflow Tests

```javascript
// __tests__/e2e/inventory-workflow.test.js
describe('Complete Inventory Workflow', () => {
  test('purchase to sale workflow', async () => {
    // 1. Record purchase
    const purchase = await recordMovement({
      inventoryId: 1,
      movementType: 'purchase',
      quantity: 100,
      unitCost: 15.00,
      referenceType: 'purchase_order',
      referenceNumber: 'PO-001'
    });

    expect(purchase.inventory.quantityOnHand).toBeGreaterThan(0);

    // 2. Reserve stock for order
    const reservation = await reserveStock(
      purchase.movement.productId,
      purchase.movement.warehouseId,
      5
    );

    expect(reservation.quantityReserved).toBe(5);

    // 3. Process sale
    const sale = await recordMovement({
      inventoryId: 1,
      movementType: 'sale',
      quantity: -5,
      unitCost: 25.00,
      referenceType: 'sales_order',
      referenceNumber: 'SO-001'
    });

    expect(sale.inventory.quantityOnHand).toBe(purchase.inventory.quantityOnHand - 5);

    // 4. Verify analytics
    const analytics = await getInventoryAnalytics();
    expect(analytics.summary.totalOnHand).toBeGreaterThan(0);
  });

  test('stock adjustment workflow', async () => {
    // Test physical count adjustment workflow
  });

  test('reorder suggestion workflow', async () => {
    // Test reorder point triggering and suggestions
  });
});
```

## Test Data Management

### Test Fixtures

```javascript
// test-utils/fixtures.js
export const testCustomers = [
  {
    id: 'customer-1-uuid',
    customerCode: 'TEST-CUST-001',
    companyName: 'Test Company 1',
    email: 'test1@example.com'
  }
];

export const testProducts = [
  {
    id: 'product-1-uuid',
    sku: 'TEST-PROD-001',
    name: 'Test Product 1',
    category: 'Electronics',
    unitPrice: 25.00,
    costPrice: 15.00
  }
];

export const testInventory = [
  {
    id: 1,
    productId: 'product-1-uuid',
    warehouseId: 'warehouse-1-uuid',
    quantityOnHand: 100,
    quantityAvailable: 95,
    quantityReserved: 5,
    reorderPoint: 20,
    averageCost: 15.00
  }
];
```

### Database Helpers

```javascript
// test-utils/database.js
export async function setupTestDatabase() {
  // Clear existing data
  await cleanupTestDatabase();
  
  // Insert test fixtures
  await insertTestCustomers();
  await insertTestProducts();
  await insertTestSuppliers();
  await insertTestInventory();
}

export async function cleanupTestDatabase() {
  // Clean in reverse order due to foreign keys
  await db.delete(inventoryMovements);
  await db.delete(inventory);
  await db.delete(priceListItems);
  await db.delete(priceLists);
  await db.delete(products);
  await db.delete(suppliers);
  await db.delete(customers);
}

export async function createLargeTestDataset(count) {
  const products = Array.from({ length: count }, (_, i) => ({
    id: `test-product-${i}-uuid`,
    sku: `TEST-${i.toString().padStart(6, '0')}`,
    name: `Test Product ${i}`,
    category: 'Test Category',
    unitPrice: 25.00,
    costPrice: 15.00
  }));

  await db.insert(products).values(products);
}
```

## Continuous Integration

### GitHub Actions Configuration

```yaml
# .github/workflows/test.yml
name: Test Suite

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  test:
    runs-on: ubuntu-latest

    services:
      postgres:
        image: postgres:14
        env:
          POSTGRES_DB: nxt_test
          POSTGRES_USER: test_user
          POSTGRES_PASSWORD: test_pass
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5

    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Run database migrations
      run: npm run db:migrate:test
      env:
        DATABASE_URL: postgres://test_user:test_pass@localhost:5432/nxt_test
    
    - name: Run unit tests
      run: npm run test:unit
    
    - name: Run integration tests
      run: npm run test:integration
    
    - name: Run performance tests
      run: npm run test:performance
    
    - name: Generate coverage report
      run: npm run test:coverage
    
    - name: Upload coverage to Codecov
      uses: codecov/codecov-action@v3
```

## Quality Gates

### Coverage Requirements
- **Minimum Overall Coverage**: 80%
- **Unit Test Coverage**: 90%
- **Integration Test Coverage**: 70%
- **Critical Business Logic**: 95%

### Performance Requirements
- **API Response Time**: < 100ms (95th percentile)
- **Analytics Queries**: < 500ms (95th percentile)
- **Database Queries**: < 50ms (average)
- **Memory Usage**: < 512MB (sustained)

### Code Quality Requirements
- **ESLint**: No errors, warnings under 10
- **Prettier**: All files formatted
- **Security**: No high/critical vulnerabilities
- **Dependencies**: No outdated packages with known vulnerabilities

## Test Reporting

### Coverage Reports
```bash
# Generate detailed coverage report
npm run test:coverage

# View coverage in browser
open coverage/lcov-report/index.html
```

### Performance Reports
```bash
# Generate performance benchmark
npm run perf:benchmark

# View performance results
cat performance-report.json
```

### Test Results
```bash
# Generate JUnit XML for CI
npm test -- --reporters=jest-junit

# Generate HTML test report
npm test -- --reporters=jest-html-reporters
```

## Debugging Tests

### Debug Mode
```bash
# Run tests in debug mode
npm run test:debug

# Debug specific test
npm test -- --testNamePattern="should record movement" --debug
```

### Test Isolation
```bash
# Run single test file
npm test src/db/__tests__/inventory-queries.test.js

# Run tests matching pattern
npm test -- --testPathPattern=inventory
```

### Mock Debugging
```javascript
// Debug mock calls
console.log(mockFunction.mock.calls);
console.log(mockFunction.mock.results);

// Clear mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
});
```

## Best Practices

### Test Organization
1. **Arrange-Act-Assert** pattern for all tests
2. **Descriptive test names** that explain the behavior
3. **One assertion per test** when possible
4. **Independent tests** that can run in any order

### Test Data
1. **Use factories** for creating test data
2. **Cleanup after each test** to avoid interference
3. **Use realistic data** that represents production scenarios
4. **Avoid hardcoded values** where possible

### Performance
1. **Parallel test execution** where safe
2. **Efficient database operations** in test setup
3. **Mock external services** to improve speed
4. **Profile slow tests** and optimize

### Maintenance
1. **Regular test review** and cleanup
2. **Update tests** when requirements change
3. **Monitor test flakiness** and fix unstable tests
4. **Document complex test scenarios**

## Troubleshooting

### Common Issues

#### Flaky Tests
```javascript
// Use proper async/await
test('should handle async operation', async () => {
  await expect(asyncOperation()).resolves.toBeTruthy();
});

// Add proper timeouts
test('should complete within timeout', async () => {
  const result = await performOperation();
  expect(result).toBeDefined();
}, 10000); // 10 second timeout
```

#### Database Connection Issues
```bash
# Check database connection
npm run db:check:test

# Reset test database
npm run db:reset:test
```

#### Memory Leaks
```javascript
// Properly close connections
afterAll(async () => {
  await db.destroy();
  await closeAllConnections();
});
```

For additional testing support, refer to the Jest documentation and project-specific testing guidelines.