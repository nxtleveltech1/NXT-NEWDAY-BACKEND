# Supplier Module Test Documentation

## Overview

This document provides comprehensive documentation for all test suites created for the supplier module. The test coverage includes unit tests, integration tests, performance tests, and specialized tests for file parsers, API endpoints, and database operations.

## Test Structure

### 1. File Parser Tests

#### Excel Parser Tests (`src/utils/file-parsers/__tests__/excel-parser.test.js`)
- **Purpose**: Test Excel file parsing capabilities
- **Coverage**: 
  - Valid Excel file parsing with price list data
  - Tier pricing column handling
  - Multiple sheet processing
  - Empty and corrupted file handling
  - Missing required columns detection
  - Various column name format support
  - Large file handling (10,000+ rows)
  - Different number format handling
  - Formula detection and rejection
  - Date format parsing
  - Special character handling in SKUs

#### Word Parser Tests (`src/utils/file-parsers/__tests__/word-parser.test.js`)
- **Purpose**: Test Word document parsing for price lists
- **Coverage**:
  - Table data extraction
  - Multiple table handling
  - Text-based price list parsing
  - Complex table structures with merged cells
  - Paragraph-based product information extraction
  - Various currency format recognition
  - Nested table handling
  - Document metadata handling (images, footnotes)
  - Password-protected document detection

#### Email Parser Tests (`src/utils/file-parsers/__tests__/email-parser.test.js`)
- **Purpose**: Test email parsing for price list extraction
- **Coverage**:
  - Price list extraction from email body
  - HTML table parsing in emails
  - CSV/Excel attachment handling
  - Multiple attachment processing
  - Structured text parsing
  - Forwarded email handling
  - Tier pricing extraction
  - Email validation and structure checking
  - Inline images and encrypted attachments
  - Reply chain parsing

### 2. Upload Queue Tests (`src/utils/__tests__/upload-queue.test.js`)

- **Purpose**: Test concurrent upload handling and queue management
- **Key Test Scenarios**:
  - Singleton queue instance creation
  - Priority-based upload handling
  - Concurrent upload processing (respecting max concurrent limit)
  - Upload cancellation
  - Retry mechanism for failed uploads
  - Event emission during upload lifecycle
  - CSV file processing workflow
  - Parsing and validation error handling
  - Database error recovery
  - Multiple users uploading simultaneously
  - Same supplier multiple uploads
  - Heavy load handling (100+ uploads)
  - Memory efficiency with large files
  - Network failure recovery
  - Permission error handling
  - Performance metric tracking
  - Health status monitoring

### 3. Supplier Route Tests (`src/routes/__tests__/supplier.routes.test.js`)

- **Purpose**: Test all supplier API endpoints
- **Endpoints Tested**:
  - `GET /api/suppliers` - List suppliers with pagination, search, and filtering
  - `GET /api/suppliers/:id` - Get supplier by ID
  - `POST /api/suppliers` - Create new supplier
  - `PUT /api/suppliers/:id` - Update supplier
  - `DELETE /api/suppliers/:id` - Deactivate supplier
  - `POST /api/suppliers/:id/price-lists/upload` - Upload price list
  - `GET /api/suppliers/:id/price-lists` - Get supplier price lists
  - `POST /api/suppliers/bulk-update` - Bulk update suppliers
  - `GET /api/suppliers/:id/performance` - Get performance metrics
- **Additional Coverage**:
  - Input validation
  - Duplicate checking (email, supplier code)
  - File type and size validation
  - Rate limiting enforcement
  - Error handling and sanitization
  - Multer file upload handling

### 4. Integration Tests (`__tests__/integration/supplier-workflow.test.js`)

- **Purpose**: Test complete supplier workflows end-to-end
- **Test Scenarios**:
  - Complete supplier onboarding (create → upload → process → activate)
  - Concurrent upload handling for multiple suppliers
  - Upload conflict resolution for same supplier
  - Large file upload efficiency (10,000 products)
  - File size limit enforcement
  - Database failure recovery
  - Parsing error handling
  - Real-time WebSocket updates during processing
  - Performance metric collection
  - Security validation (SQL injection, XSS prevention)
  - File header and structure validation

### 5. Performance Tests (`__tests__/performance/supplier-performance.test.js`)

- **Purpose**: Load testing and performance benchmarking using k6
- **Test Scenarios**:
  - **Steady Load Test**: 10 VUs for 5 minutes
  - **Spike Test**: Ramp from 0 to 100 VUs
  - **Stress Test**: Progressive load increase up to 200 requests/second
  - **Concurrent Upload Test**: 50 VUs uploading 5 files each
- **Additional Tests**:
  - Memory leak detection over 1000 iterations
  - Large file upload performance (1k to 50k rows)
  - Operation mix simulation (search, upload, details, bulk update)
- **Metrics Tracked**:
  - Upload success rate
  - Upload duration
  - Price list processing time
  - Concurrent upload error rate
  - HTTP request duration (p95, p99)

### 6. Advanced Database Query Tests (`src/db/__tests__/supplier-queries-advanced.test.js`)

- **Purpose**: Test complex database operations and edge cases
- **Coverage**:
  - Concurrent update handling with optimistic locking
  - Full-text search optimization
  - Supplier reliability score calculation
  - Duplicate SKU detection across suppliers
  - Index usage verification
  - Batch statistics calculation
  - Materialized view usage
  - Data integrity constraints (unique codes, email validation)
  - Referential integrity maintenance
  - Supplier diversity metrics
  - Clustering pattern identification
  - Demand forecasting
  - Query result caching
  - Cache invalidation on updates
  - Complex multi-table transactions
  - Transaction rollback handling
  - Row-level security
  - Sensitive operation auditing

## Running Tests

### Run All Tests
```bash
npm test
```

### Run Tests with Coverage
```bash
npm test:coverage
```

### Run Supplier-Specific Tests
```bash
npm run test:supplier
```

### Run Supplier Tests with Coverage
```bash
npm run test:supplier:coverage
```

### Generate Coverage Report
```bash
npm run test:coverage:report
```

### Run Specific Test Categories
```bash
# Unit tests
npm run test:unit

# Integration tests
npm run test:integration

# Performance tests (k6)
k6 run __tests__/performance/supplier-performance.test.js

# File parser tests
npm test -- src/utils/file-parsers/__tests__

# Route tests
npm test -- src/routes/__tests__/supplier.routes.test.js

# Database tests
npm test -- src/db/__tests__
```

## Test Coverage Goals

### Overall Target: >90%

### Category-Specific Targets:
- **File Parsers**: >95% (critical for data integrity)
- **API Routes**: >90% (user-facing functionality)
- **Business Logic**: >90% (core functionality)
- **Database Queries**: >85% (complex scenarios)
- **Integration Tests**: >80% (end-to-end workflows)
- **Performance Tests**: >70% (load scenarios)

## Test Data

### Mock Data Patterns
- Supplier IDs: `supplier-{number}` or UUID format
- Supplier Codes: `SUP-{alphanumeric}`
- SKUs: `PROD{number}` or category-specific patterns
- Email addresses: `{name}@supplier.com`
- Currencies: USD, EUR, GBP, JPY, CAD

### File Size Test Cases
- Small: 50-200 rows
- Medium: 1,000-5,000 rows
- Large: 10,000-50,000 rows
- Size limit: 10MB

### Concurrent Test Scenarios
- Users: 3-50 concurrent users
- Uploads per supplier: 5-10 files
- Queue capacity: 100-1000 items
- Processing rate: 3 concurrent (configurable)

## Error Scenarios Covered

### File Processing Errors
- Corrupted files
- Invalid formats
- Missing required columns
- Malformed data
- Encoding issues
- Formula/macro detection
- Password-protected files

### System Errors
- Database connection failures
- Network timeouts
- Memory exhaustion
- Permission denied
- Queue overflow
- Rate limit exceeded

### Business Logic Errors
- Duplicate suppliers
- Invalid email formats
- Constraint violations
- Version conflicts
- Active price list deletion attempts
- Insufficient permissions

## Performance Benchmarks

### Target Metrics
- API Response Time: <500ms (p95), <1000ms (p99)
- Upload Acceptance: <5s for files up to 10MB
- Concurrent Upload Success Rate: >95%
- Queue Processing: 100 uploads/minute
- Memory Growth: <50% over extended operation
- Database Query Time: <100ms for complex queries

### Load Test Thresholds
- Steady State: 10 concurrent users
- Peak Load: 100 concurrent users
- Stress Test: 200 requests/second
- Upload Burst: 50 simultaneous uploads

## Monitoring and Observability

### Test Metrics Collection
- Coverage reports in HTML and Markdown formats
- Performance metrics via k6 output
- Memory usage snapshots
- Queue health monitoring
- Error rate tracking

### Continuous Integration
- Pre-commit: Unit tests
- Pull Request: Unit + Integration tests
- Main branch: Full test suite
- Nightly: Performance tests
- Weekly: Stress tests

## Best Practices

### Test Writing Guidelines
1. Use descriptive test names
2. Follow AAA pattern (Arrange, Act, Assert)
3. Mock external dependencies
4. Test edge cases and error scenarios
5. Keep tests isolated and independent
6. Use realistic test data
7. Clean up after tests

### Performance Test Guidelines
1. Use production-like data volumes
2. Simulate realistic user behavior
3. Test gradual load increases
4. Monitor system resources
5. Establish baseline metrics
6. Test recovery scenarios

## Maintenance

### Regular Updates Required
- Update test data patterns when business rules change
- Adjust performance thresholds based on SLAs
- Add tests for new features
- Remove tests for deprecated functionality
- Update mock data to reflect production patterns

### Quarterly Review
- Coverage report analysis
- Performance baseline updates
- Test suite optimization
- Flaky test identification and fixes
- Documentation updates

## Troubleshooting

### Common Issues
1. **Test Timeouts**: Increase Jest timeout for integration tests
2. **Mock Conflicts**: Clear mocks between tests
3. **Database State**: Use transactions for test isolation
4. **File System**: Clean up test files after execution
5. **Memory Leaks**: Monitor heap usage in long-running tests

### Debug Commands
```bash
# Run tests with verbose output
npm test -- --verbose

# Run single test file
npm test -- path/to/test.js

# Run tests matching pattern
npm test -- --testNamePattern="should handle"

# Debug with Chrome DevTools
node --inspect-brk node_modules/.bin/jest --runInBand
```

## Future Enhancements

### Planned Additions
1. Contract testing for API endpoints
2. Mutation testing for code quality
3. Visual regression testing for email parsing
4. Chaos engineering tests
5. Security penetration testing
6. Accessibility testing for generated reports
7. Cross-browser upload testing
8. Mobile device upload simulation

### Tool Upgrades
- Consider Artillery.io for advanced load testing
- Integrate with APM tools for production monitoring
- Add test result dashboards
- Implement test impact analysis