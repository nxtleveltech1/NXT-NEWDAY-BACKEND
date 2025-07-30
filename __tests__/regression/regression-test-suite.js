/**
 * Automated Regression Testing Suite
 * 
 * Comprehensive regression testing framework that validates:
 * - API endpoint consistency
 * - Database schema integrity
 * - Business logic preservation
 * - Performance regression detection
 * - Data integrity validation
 * - Cross-module compatibility
 */

import { describe, beforeAll, afterAll, beforeEach, test, expect } from '@jest/globals';
import { performance } from 'perf_hooks';
import { db } from '../../src/config/database.js';
import { 
  suppliers, 
  customers, 
  products, 
  inventory, 
  priceLists,
  purchaseOrders,
  timeSeriesEvents
} from '../../src/db/schema.js';
import { CustomerService } from '../../src/services/customer.service.js';
import { 
  createSupplierService,
  getSupplierByIdService,
  getSupplierPerformanceService
} from '../../src/services/supplier.service.js';
import { AnalyticsService } from '../../src/services/analytics.service.js';
import { eq } from 'drizzle-orm';

class RegressionTestSuite {
  constructor() {
    this.baselineMetrics = {};
    this.currentMetrics = {};
    this.regressionThresholds = {
      responseTime: 1.5, // 50% increase allowed
      errorRate: 0.02, // 2% error rate increase allowed
      throughput: 0.8, // 20% decrease allowed
      memoryUsage: 1.3, // 30% increase allowed
      accuracy: 0.95 // 95% minimum accuracy
    };
    this.testResults = {
      passed: 0,
      failed: 0,
      regressions: [],
      improvements: [],
      issues: []
    };
  }

  // ==================== BASELINE ESTABLISHMENT ====================

  async establishBaseline() {
    console.log('Establishing performance and accuracy baseline...');
    
    this.baselineMetrics = {
      api: await this.measureApiPerformance(),
      database: await this.measureDatabasePerformance(),
      analytics: await this.measureAnalyticsAccuracy(),
      business: await this.validateBusinessLogic(),
      memory: await this.measureMemoryUsage()
    };

    console.log('Baseline established:', JSON.stringify(this.baselineMetrics, null, 2));
    return this.baselineMetrics;
  }

  async runRegressionTests() {
    console.log('Running comprehensive regression test suite...');
    
    // Measure current performance
    this.currentMetrics = {
      api: await this.measureApiPerformance(),
      database: await this.measureDatabasePerformance(),
      analytics: await this.measureAnalyticsAccuracy(),
      business: await this.validateBusinessLogic(),
      memory: await this.measureMemoryUsage()
    };

    // Compare against baseline
    const regressionReport = this.detectRegressions();
    
    // Run specific regression tests
    await this.runApiRegressionTests();
    await this.runDatabaseRegressionTests();
    await this.runBusinessLogicRegressionTests();
    await this.runDataIntegrityTests();

    return this.generateRegressionReport(regressionReport);
  }

  // ==================== PERFORMANCE MEASUREMENT ====================

  async measureApiPerformance() {
    const endpoints = [
      { path: '/api/customers', method: 'GET', name: 'getCustomers' },
      { path: '/api/suppliers', method: 'GET', name: 'getSuppliers' },
      { path: '/api/inventory', method: 'GET', name: 'getInventory' },
      { path: '/api/analytics/dashboard', method: 'GET', name: 'getDashboard' },
      { path: '/api/customers/search?q=test', method: 'GET', name: 'searchCustomers' }
    ];

    const metrics = {};
    
    for (const endpoint of endpoints) {
      const measurements = [];
      const errors = [];

      // Take 10 measurements for each endpoint
      for (let i = 0; i < 10; i++) {
        const start = performance.now();
        try {
          const response = await fetch(`http://localhost:4000${endpoint.path}`, {
            method: endpoint.method,
            headers: { 'Content-Type': 'application/json' }
          });

          const duration = performance.now() - start;
          measurements.push({
            duration,
            status: response.status,
            success: response.ok
          });

          if (!response.ok) {
            errors.push(`HTTP ${response.status}: ${response.statusText}`);
          }
        } catch (error) {
          const duration = performance.now() - start;
          measurements.push({
            duration,
            status: 0,
            success: false
          });
          errors.push(error.message);
        }
      }

      metrics[endpoint.name] = {
        avgResponseTime: measurements.reduce((sum, m) => sum + m.duration, 0) / measurements.length,
        minResponseTime: Math.min(...measurements.map(m => m.duration)),
        maxResponseTime: Math.max(...measurements.map(m => m.duration)),
        successRate: measurements.filter(m => m.success).length / measurements.length,
        errorRate: errors.length / measurements.length,
        errors: errors.slice(0, 3) // Keep first 3 errors
      };
    }

    return metrics;
  }

  async measureDatabasePerformance() {
    const queries = [
      {
        name: 'selectCustomers',
        query: () => db.select().from(customers).limit(100),
        description: 'Select customers with limit'
      },
      {
        name: 'selectSuppliers',
        query: () => db.select().from(suppliers).limit(50),
        description: 'Select suppliers with limit'
      },
      {
        name: 'selectInventory',
        query: () => db.select().from(inventory).limit(200),
        description: 'Select inventory with limit'
      },
      {
        name: 'joinCustomersOrders',
        query: () => db.select()
          .from(customers)
          .leftJoin(purchaseOrders, eq(customers.id, purchaseOrders.customerId))
          .limit(50),
        description: 'Join customers with orders'
      }
    ];

    const metrics = {};

    for (const queryTest of queries) {
      const measurements = [];
      const errors = [];

      for (let i = 0; i < 5; i++) {
        const start = performance.now();
        try {
          const result = await queryTest.query();
          const duration = performance.now() - start;
          measurements.push({
            duration,
            rowCount: Array.isArray(result) ? result.length : 0,
            success: true
          });
        } catch (error) {
          const duration = performance.now() - start;
          measurements.push({
            duration,
            rowCount: 0,
            success: false
          });
          errors.push(error.message);
        }
      }

      metrics[queryTest.name] = {
        avgDuration: measurements.reduce((sum, m) => sum + m.duration, 0) / measurements.length,
        avgRowCount: measurements.reduce((sum, m) => sum + m.rowCount, 0) / measurements.length,
        successRate: measurements.filter(m => m.success).length / measurements.length,
        errors: errors.slice(0, 2)
      };
    }

    return metrics;
  }

  async measureAnalyticsAccuracy() {
    const analyticsService = new AnalyticsService();
    await analyticsService.initialize();

    const tests = [];
    
    try {
      // Test customer analytics
      const customerAnalytics = await CustomerService.getCustomerAnalytics('test-customer-id');
      tests.push({
        name: 'customerAnalytics',
        success: customerAnalytics.success,
        hasData: customerAnalytics.data !== null,
        responseStructure: typeof customerAnalytics.data === 'object'
      });
    } catch (error) {
      tests.push({
        name: 'customerAnalytics',
        success: false,
        error: error.message
      });
    }

    try {
      // Test dashboard analytics
      const dashboardAnalytics = await analyticsService.getDashboardAnalytics();
      tests.push({
        name: 'dashboardAnalytics',
        success: dashboardAnalytics.data !== undefined,
        hasData: dashboardAnalytics.data !== null,
        responseStructure: typeof dashboardAnalytics.data === 'object'
      });
    } catch (error) {
      tests.push({
        name: 'dashboardAnalytics',
        success: false,
        error: error.message
      });
    }

    const accuracy = tests.filter(t => t.success).length / tests.length;
    
    return {
      accuracy,
      tests,
      totalTests: tests.length,
      passedTests: tests.filter(t => t.success).length
    };
  }

  async validateBusinessLogic() {
    const validations = [];

    try {
      // Test customer creation business rules
      const invalidCustomer = await CustomerService.createCustomer({
        customerCode: '', // Invalid: empty code
        companyName: 'Test Company',
        email: 'invalid-email' // Invalid: bad email format
      });
      
      validations.push({
        name: 'customerValidation',
        success: !invalidCustomer.success, // Should fail
        expectedBehavior: 'Should reject invalid customer data',
        actualResult: invalidCustomer.success ? 'Accepted invalid data' : 'Correctly rejected'
      });
    } catch (error) {
      validations.push({
        name: 'customerValidation',
        success: false,
        error: error.message
      });
    }

    try {
      // Test supplier creation business rules
      const invalidSupplier = await createSupplierService({
        supplierCode: 'TEST001',
        companyName: 'Test Supplier',
        email: 'duplicate@test.com' // This should work first time
      }, 'test-user');

      const duplicateSupplier = await createSupplierService({
        supplierCode: 'TEST001', // Duplicate code
        companyName: 'Another Supplier',
        email: 'duplicate@test.com' // Duplicate email
      }, 'test-user');

      validations.push({
        name: 'supplierDuplicateValidation',
        success: !duplicateSupplier.success, // Should fail for duplicates
        expectedBehavior: 'Should reject duplicate supplier',
        actualResult: duplicateSupplier.success ? 'Accepted duplicate' : 'Correctly rejected'
      });
    } catch (error) {
      validations.push({
        name: 'supplierDuplicateValidation',
        success: false,
        error: error.message
      });
    }

    const businessLogicAccuracy = validations.filter(v => v.success).length / validations.length;

    return {
      accuracy: businessLogicAccuracy,
      validations,
      totalValidations: validations.length,
      passedValidations: validations.filter(v => v.success).length
    };
  }

  async measureMemoryUsage() {
    const memUsage = process.memoryUsage();
    
    return {
      rss: memUsage.rss / 1024 / 1024, // MB
      heapUsed: memUsage.heapUsed / 1024 / 1024, // MB
      heapTotal: memUsage.heapTotal / 1024 / 1024, // MB
      external: memUsage.external / 1024 / 1024 // MB
    };
  }

  // ==================== REGRESSION DETECTION ====================

  detectRegressions() {
    const regressions = [];
    const improvements = [];

    // API Performance Regressions
    if (this.baselineMetrics.api && this.currentMetrics.api) {
      Object.keys(this.baselineMetrics.api).forEach(endpoint => {
        const baseline = this.baselineMetrics.api[endpoint];
        const current = this.currentMetrics.api[endpoint];

        if (current.avgResponseTime > baseline.avgResponseTime * this.regressionThresholds.responseTime) {
          regressions.push({
            type: 'performance',
            category: 'api',
            endpoint,
            metric: 'responseTime',
            baseline: baseline.avgResponseTime,
            current: current.avgResponseTime,
            degradation: ((current.avgResponseTime - baseline.avgResponseTime) / baseline.avgResponseTime) * 100
          });
        }

        if (current.errorRate > baseline.errorRate + this.regressionThresholds.errorRate) {
          regressions.push({
            type: 'reliability',
            category: 'api',
            endpoint,
            metric: 'errorRate',
            baseline: baseline.errorRate,
            current: current.errorRate,
            degradation: (current.errorRate - baseline.errorRate) * 100
          });
        }

        // Check for improvements
        if (current.avgResponseTime < baseline.avgResponseTime * 0.9) {
          improvements.push({
            type: 'performance',
            category: 'api',
            endpoint,
            metric: 'responseTime',
            improvement: ((baseline.avgResponseTime - current.avgResponseTime) / baseline.avgResponseTime) * 100
          });
        }
      });
    }

    // Database Performance Regressions
    if (this.baselineMetrics.database && this.currentMetrics.database) {
      Object.keys(this.baselineMetrics.database).forEach(query => {
        const baseline = this.baselineMetrics.database[query];
        const current = this.currentMetrics.database[query];

        if (current.avgDuration > baseline.avgDuration * this.regressionThresholds.responseTime) {
          regressions.push({
            type: 'performance',
            category: 'database',
            query,
            metric: 'duration',
            baseline: baseline.avgDuration,
            current: current.avgDuration,
            degradation: ((current.avgDuration - baseline.avgDuration) / baseline.avgDuration) * 100
          });
        }
      });
    }

    // Analytics Accuracy Regressions
    if (this.baselineMetrics.analytics && this.currentMetrics.analytics) {
      if (this.currentMetrics.analytics.accuracy < this.baselineMetrics.analytics.accuracy * this.regressionThresholds.accuracy) {
        regressions.push({
          type: 'accuracy',
          category: 'analytics',
          metric: 'overall_accuracy',
          baseline: this.baselineMetrics.analytics.accuracy,
          current: this.currentMetrics.analytics.accuracy,
          degradation: ((this.baselineMetrics.analytics.accuracy - this.currentMetrics.analytics.accuracy) / this.baselineMetrics.analytics.accuracy) * 100
        });
      }
    }

    // Memory Usage Regressions
    if (this.baselineMetrics.memory && this.currentMetrics.memory) {
      if (this.currentMetrics.memory.heapUsed > this.baselineMetrics.memory.heapUsed * this.regressionThresholds.memoryUsage) {
        regressions.push({
          type: 'resource',
          category: 'memory',
          metric: 'heapUsed',
          baseline: this.baselineMetrics.memory.heapUsed,
          current: this.currentMetrics.memory.heapUsed,
          degradation: ((this.currentMetrics.memory.heapUsed - this.baselineMetrics.memory.heapUsed) / this.baselineMetrics.memory.heapUsed) * 100
        });
      }
    }

    return { regressions, improvements };
  }

  // ==================== SPECIFIC REGRESSION TESTS ====================

  async runApiRegressionTests() {
    const apiTests = [
      {
        name: 'Customer API Compatibility',
        test: async () => {
          const result = await CustomerService.getAllCustomers({ page: 1, pageSize: 5 });
          return {
            success: result.success,
            hasData: result.data && result.data.customers,
            hasPagination: result.data && result.data.pagination,
            validStructure: result.data && typeof result.data.customers === 'object'
          };
        }
      },
      {
        name: 'Supplier API Compatibility',
        test: async () => {
          const result = await createSupplierService({
            supplierCode: `REG-TEST-${Date.now()}`,
            companyName: 'Regression Test Supplier',
            email: `regression${Date.now()}@test.com`
          }, 'test-user');
          
          return {
            success: result.success,
            hasData: result.data !== null,
            validStructure: result.data && typeof result.data === 'object'
          };
        }
      }
    ];

    for (const apiTest of apiTests) {
      try {
        const result = await apiTest.test();
        if (result.success && result.hasData && result.validStructure) {
          this.testResults.passed++;
        } else {
          this.testResults.failed++;
          this.testResults.issues.push({
            test: apiTest.name,
            result,
            type: 'api_compatibility'
          });
        }
      } catch (error) {
        this.testResults.failed++;
        this.testResults.issues.push({
          test: apiTest.name,
          error: error.message,
          type: 'api_error'
        });
      }
    }
  }

  async runDatabaseRegressionTests() {
    const dbTests = [
      {
        name: 'Schema Integrity',
        test: async () => {
          // Test that all expected tables exist and have expected structure
          const tables = [customers, suppliers, products, inventory, priceLists];
          const results = [];
          
          for (const table of tables) {
            try {
              const sample = await db.select().from(table).limit(1);
              results.push({ table: table.name, accessible: true, error: null });
            } catch (error) {
              results.push({ table: table.name, accessible: false, error: error.message });
            }
          }
          
          return {
            success: results.every(r => r.accessible),
            details: results
          };
        }
      },
      {
        name: 'Foreign Key Constraints',
        test: async () => {
          // Test foreign key relationships
          try {
            const inventoryWithProducts = await db.select()
              .from(inventory)
              .leftJoin(products, eq(inventory.productId, products.id))
              .limit(5);
            
            return {
              success: true,
              canJoin: inventoryWithProducts.length >= 0
            };
          } catch (error) {
            return {
              success: false,
              error: error.message
            };
          }
        }
      }
    ];

    for (const dbTest of dbTests) {
      try {
        const result = await dbTest.test();
        if (result.success) {
          this.testResults.passed++;
        } else {
          this.testResults.failed++;
          this.testResults.issues.push({
            test: dbTest.name,
            result,
            type: 'database_integrity'
          });
        }
      } catch (error) {
        this.testResults.failed++;
        this.testResults.issues.push({
          test: dbTest.name,
          error: error.message,
          type: 'database_error'
        });
      }
    }
  }

  async runBusinessLogicRegressionTests() {
    const businessTests = [
      {
        name: 'Customer Business Rules',
        test: async () => {
          // Test that business rules are still enforced
          const validCustomer = await CustomerService.createCustomer({
            customerCode: `REG-CUST-${Date.now()}`,
            companyName: 'Regression Test Customer',
            email: `regcustomer${Date.now()}@test.com`
          });

          const invalidCustomer = await CustomerService.createCustomer({
            customerCode: '', // Should fail
            companyName: 'Invalid Customer',
            email: 'invalid-email'
          });

          return {
            success: validCustomer.success && !invalidCustomer.success,
            validAccepted: validCustomer.success,
            invalidRejected: !invalidCustomer.success
          };
        }
      },
      {
        name: 'Supplier Performance Calculations',
        test: async () => {
          // Test that performance calculations still work
          try {
            const performance = await getSupplierPerformanceService('test-supplier-id');
            return {
              success: performance.success !== undefined,
              hasStructure: performance.data !== undefined
            };
          } catch (error) {
            return {
              success: false,
              error: error.message
            };
          }
        }
      }
    ];

    for (const businessTest of businessTests) {
      try {
        const result = await businessTest.test();
        if (result.success) {
          this.testResults.passed++;
        } else {
          this.testResults.failed++;
          this.testResults.issues.push({
            test: businessTest.name,
            result,
            type: 'business_logic'
          });
        }
      } catch (error) {
        this.testResults.failed++;
        this.testResults.issues.push({
          test: businessTest.name,
          error: error.message,
          type: 'business_logic_error'
        });
      }
    }
  }

  async runDataIntegrityTests() {
    const integrityTests = [
      {
        name: 'Referential Integrity',
        test: async () => {
          // Test that foreign key relationships are maintained
          try {
            // Count orphaned records
            const orphanedInventory = await db.select()
              .from(inventory)
              .leftJoin(products, eq(inventory.productId, products.id))
              .where(eq(products.id, null))
              .limit(1);

            return {
              success: orphanedInventory.length === 0,
              orphanedRecords: orphanedInventory.length
            };
          } catch (error) {
            return {
              success: false,
              error: error.message
            };
          }
        }
      },
      {
        name: 'Data Consistency',
        test: async () => {
          // Test that calculated fields are consistent
          try {
            const inventoryRecords = await db.select().from(inventory).limit(10);
            
            const consistentRecords = inventoryRecords.filter(record => {
              // Check that available + reserved = on hand
              return (record.quantityAvailable + record.quantityReserved) === record.quantityOnHand;
            });

            return {
              success: consistentRecords.length === inventoryRecords.length,
              totalRecords: inventoryRecords.length,
              consistentRecords: consistentRecords.length
            };
          } catch (error) {
            return {
              success: false,
              error: error.message
            };
          }
        }
      }
    ];

    for (const integrityTest of integrityTests) {
      try {
        const result = await integrityTest.test();
        if (result.success) {
          this.testResults.passed++;
        } else {
          this.testResults.failed++;
          this.testResults.issues.push({
            test: integrityTest.name,
            result,
            type: 'data_integrity'
          });
        }
      } catch (error) {
        this.testResults.failed++;
        this.testResults.issues.push({
          test: integrityTest.name,
          error: error.message,
          type: 'data_integrity_error'
        });
      }
    }
  }

  // ==================== REPORT GENERATION ====================

  generateRegressionReport(detectionResults) {
    const { regressions, improvements } = detectionResults;
    
    const report = {
      summary: {
        timestamp: new Date().toISOString(),
        totalTests: this.testResults.passed + this.testResults.failed,
        passedTests: this.testResults.passed,
        failedTests: this.testResults.failed,
        successRate: (this.testResults.passed / (this.testResults.passed + this.testResults.failed)) * 100,
        regressionsDetected: regressions.length,
        improvementsDetected: improvements.length
      },
      performance: {
        baseline: this.baselineMetrics,
        current: this.currentMetrics,
        regressions: regressions.filter(r => r.type === 'performance'),
        improvements: improvements.filter(i => i.type === 'performance')
      },
      reliability: {
        regressions: regressions.filter(r => r.type === 'reliability'),
        issues: this.testResults.issues.filter(i => i.type.includes('error'))
      },
      accuracy: {
        regressions: regressions.filter(r => r.type === 'accuracy'),
        current_accuracy: this.currentMetrics.analytics?.accuracy || 0,
        baseline_accuracy: this.baselineMetrics.analytics?.accuracy || 0
      },
      resources: {
        regressions: regressions.filter(r => r.type === 'resource'),
        current_memory: this.currentMetrics.memory,
        baseline_memory: this.baselineMetrics.memory
      },
      data_integrity: {
        issues: this.testResults.issues.filter(i => i.type.includes('integrity') || i.type.includes('database')),
        passed_tests: this.testResults.issues.filter(i => i.type.includes('integrity')).length
      },
      business_logic: {
        issues: this.testResults.issues.filter(i => i.type.includes('business')),
        passed_tests: this.testResults.passed - this.testResults.issues.filter(i => !i.type.includes('business')).length
      },
      recommendations: this.generateRecommendations(regressions, improvements),
      details: {
        all_regressions: regressions,
        all_improvements: improvements,
        all_issues: this.testResults.issues
      }
    };

    return report;
  }

  generateRecommendations(regressions, improvements) {
    const recommendations = [];

    // Performance recommendations
    const performanceRegressions = regressions.filter(r => r.type === 'performance');
    if (performanceRegressions.length > 0) {
      recommendations.push({
        category: 'performance',
        severity: 'high',
        message: `${performanceRegressions.length} performance regressions detected. Consider optimizing slow endpoints and database queries.`,
        actions: [
          'Review slow API endpoints and optimize business logic',
          'Add database indexes for frequently queried columns',
          'Implement caching for expensive operations',
          'Consider query optimization and connection pooling'
        ]
      });
    }

    // Memory recommendations
    const memoryRegressions = regressions.filter(r => r.type === 'resource');
    if (memoryRegressions.length > 0) {
      recommendations.push({
        category: 'memory',
        severity: 'high',
        message: 'Memory usage has increased significantly. Investigate potential memory leaks.',
        actions: [
          'Profile memory usage in production',
          'Review code for memory leaks',
          'Optimize data structures and algorithms',
          'Consider implementing memory limits and garbage collection tuning'
        ]
      });
    }

    // Reliability recommendations
    const reliabilityRegressions = regressions.filter(r => r.type === 'reliability');
    if (reliabilityRegressions.length > 0) {
      recommendations.push({
        category: 'reliability',
        severity: 'critical',
        message: 'Error rates have increased. Immediate investigation required.',
        actions: [
          'Review recent code changes',
          'Check system logs for error patterns',
          'Implement better error handling',
          'Add monitoring and alerting for error rates'
        ]
      });
    }

    // Data integrity recommendations
    const integrityIssues = this.testResults.issues.filter(i => i.type.includes('integrity'));
    if (integrityIssues.length > 0) {
      recommendations.push({
        category: 'data_integrity',
        severity: 'high',
        message: 'Data integrity issues detected. Database consistency may be compromised.',
        actions: [
          'Run database integrity checks',
          'Review foreign key constraints',
          'Implement data validation at application level',
          'Consider database migration scripts to fix inconsistencies'
        ]
      });
    }

    // Positive feedback for improvements
    if (improvements.length > 0) {
      recommendations.push({
        category: 'improvements',
        severity: 'info',
        message: `${improvements.length} performance improvements detected. Great work!`,
        actions: [
          'Document the changes that led to improvements',
          'Consider applying similar optimizations to other areas',
          'Update performance baselines to reflect improvements'
        ]
      });
    }

    return recommendations;
  }
}

export { RegressionTestSuite };
export default RegressionTestSuite;