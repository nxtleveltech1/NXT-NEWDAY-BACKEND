/**
 * Performance Test Suite
 * 
 * Comprehensive performance testing using the load test framework
 * Tests various scenarios and system components under load
 */

import { describe, beforeAll, afterAll, test, expect } from '@jest/globals';
import { LoadTestFramework } from './load-test-framework.js';
import { db } from '../../src/config/database.js';
import { analyticsCache } from '../../src/config/redis.js';

describe('Performance Test Suite', () => {
  let loadTestFramework;
  let testResults = {};

  beforeAll(async () => {
    loadTestFramework = new LoadTestFramework({
      maxConcurrentUsers: 50,
      testDuration: 30000, // 30 seconds for faster tests
      targetTPS: 25,
      memoryThreshold: 256, // MB
      cpuThreshold: 70, // Percentage
      responseTimeThreshold: 1500, // ms
      errorRateThreshold: 5 // Percentage
    });

    // Set up event listeners for real-time monitoring
    loadTestFramework.on('metrics_update', (metrics) => {
      console.log(`Real-time metrics: ${metrics.total_requests} requests, ${metrics.success_rate.toFixed(1)}% success rate`);
    });

    loadTestFramework.on('threshold_exceeded', (threshold) => {
      console.warn(`Performance threshold exceeded: ${threshold.type} = ${threshold.value} (threshold: ${threshold.threshold})`);
    });
  });

  afterAll(async () => {
    // Generate final performance report
    console.log('\n' + '='.repeat(60));
    console.log('PERFORMANCE TEST SUMMARY');
    console.log('='.repeat(60));
    
    Object.entries(testResults).forEach(([testName, result]) => {
      console.log(`\n${testName}:`);
      console.log(`  Duration: ${result.test_summary.duration_seconds}s`);
      console.log(`  Total Requests: ${result.test_summary.total_requests}`);
      console.log(`  Success Rate: ${result.test_summary.success_rate_percent.toFixed(1)}%`);
      console.log(`  Throughput: ${result.test_summary.throughput_tps.toFixed(1)} TPS`);
      console.log(`  Avg Response Time: ${result.response_times.average_ms.toFixed(0)}ms`);
      console.log(`  P95 Response Time: ${result.response_times.p95_ms.toFixed(0)}ms`);
      
      if (result.recommendations.length > 0) {
        console.log(`  Recommendations: ${result.recommendations.length} issues found`);
        result.recommendations.forEach(rec => {
          console.log(`    - [${rec.severity.toUpperCase()}] ${rec.message}`);
        });
      }
    });
    
    console.log('\n' + '='.repeat(60));
  });

  // ==================== API ENDPOINT PERFORMANCE TESTS ====================

  describe('API Endpoint Performance', () => {
    test('should handle concurrent customer operations efficiently', async () => {
      const scenarios = [
        {
          name: 'customer_crud_operations',
          weight: 1,
          userCount: 20,
          duration: 30000,
          operations: [
            {
              name: 'get_customers',
              type: 'api_call',
              config: {
                endpoint: '/api/customers',
                method: 'GET'
              },
              delay: 100
            },
            {
              name: 'get_customer_analytics',
              type: 'api_call',
              config: {
                endpoint: '/api/customers/analytics',
                method: 'GET'
              },
              delay: 200
            },
            {
              name: 'search_customers',
              type: 'api_call',
              config: {
                endpoint: '/api/customers/search?q=test',
                method: 'GET'
              },
              delay: 150
            }
          ]
        }
      ];

      const result = await loadTestFramework.runLoadTest(scenarios);
      testResults['Customer API Performance'] = result;

      // Validate performance criteria
      expect(result.test_summary.success_rate_percent).toBeGreaterThan(95);
      expect(result.response_times.average_ms).toBeLessThan(1500);
      expect(result.test_summary.throughput_tps).toBeGreaterThan(5);
    }, 60000);

    test('should handle concurrent supplier operations efficiently', async () => {
      const scenarios = [
        {
          name: 'supplier_operations',
          weight: 1,
          userCount: 15,
          duration: 30000,
          operations: [
            {
              name: 'get_suppliers',
              type: 'api_call',
              config: {
                endpoint: '/api/suppliers',
                method: 'GET'
              },
              delay: 100
            },
            {
              name: 'get_supplier_performance',
              type: 'api_call',
              config: {
                endpoint: '/api/suppliers/performance',
                method: 'GET'
              },
              delay: 300
            },
            {
              name: 'get_reorder_suggestions',
              type: 'api_call',
              config: {
                endpoint: '/api/suppliers/reorder-suggestions',
                method: 'GET'
              },
              delay: 250
            }
          ]
        }
      ];

      const result = await loadTestFramework.runLoadTest(scenarios);
      testResults['Supplier API Performance'] = result;

      expect(result.test_summary.success_rate_percent).toBeGreaterThan(95);
      expect(result.response_times.average_ms).toBeLessThan(2000);
    }, 60000);

    test('should handle concurrent inventory operations efficiently', async () => {
      const scenarios = [
        {
          name: 'inventory_operations',
          weight: 1,
          userCount: 25,
          duration: 30000,
          operations: [
            {
              name: 'get_inventory',
              type: 'api_call',
              config: {
                endpoint: '/api/inventory',
                method: 'GET'
              },
              delay: 50
            },
            {
              name: 'get_inventory_analytics',
              type: 'api_call',
              config: {
                endpoint: '/api/inventory/analytics',
                method: 'GET'
              },
              delay: 200
            },
            {
              name: 'get_low_stock_items',
              type: 'api_call',
              config: {
                endpoint: '/api/inventory/low-stock',
                method: 'GET'
              },
              delay: 100
            }
          ]
        }
      ];

      const result = await loadTestFramework.runLoadTest(scenarios);
      testResults['Inventory API Performance'] = result;

      expect(result.test_summary.success_rate_percent).toBeGreaterThan(95);
      expect(result.response_times.average_ms).toBeLessThan(1000);
    }, 60000);
  });

  // ==================== DATABASE PERFORMANCE TESTS ====================

  describe('Database Performance', () => {
    test('should handle concurrent database queries efficiently', async () => {
      const scenarios = [
        {
          name: 'database_read_operations',
          weight: 1,
          userCount: 30,
          duration: 30000,
          operations: [
            {
              name: 'select_customers',
              type: 'database_query',
              config: {
                query: 'SELECT * FROM customers LIMIT 10',
                params: []
              },
              delay: 50
            },
            {
              name: 'select_inventory',
              type: 'database_query',
              config: {
                query: 'SELECT * FROM inventory WHERE quantity_on_hand > 0 LIMIT 20',
                params: []
              },
              delay: 75
            },
            {
              name: 'select_suppliers',
              type: 'database_query',
              config: {
                query: 'SELECT * FROM suppliers WHERE is_active = true LIMIT 15',
                params: []
              },
              delay: 100
            }
          ]
        }
      ];

      const result = await loadTestFramework.runLoadTest(scenarios);
      testResults['Database Read Performance'] = result;

      expect(result.test_summary.success_rate_percent).toBeGreaterThan(98);
      expect(result.response_times.average_ms).toBeLessThan(500);
    }, 60000);

    test('should handle concurrent analytics queries efficiently', async () => {
      const scenarios = [
        {
          name: 'analytics_queries',
          weight: 1,
          userCount: 10,
          duration: 30000,
          operations: [
            {
              name: 'sales_analytics',
              type: 'analytics_query',
              config: {
                queryType: 'sales_metrics',
                params: { dateFrom: '2024-01-01', dateTo: '2024-12-31' }
              },
              delay: 500
            },
            {
              name: 'inventory_analytics',
              type: 'analytics_query',
              config: {
                queryType: 'inventory_metrics',
                params: { warehouseId: 'all' }
              },
              delay: 300
            },
            {
              name: 'customer_segmentation',
              type: 'analytics_query',
              config: {
                queryType: 'customer_segmentation',
                params: { includeDetails: false }
              },
              delay: 1000
            }
          ]
        }
      ];

      const result = await loadTestFramework.runLoadTest(scenarios);
      testResults['Analytics Query Performance'] = result;

      expect(result.test_summary.success_rate_percent).toBeGreaterThan(90);
      expect(result.response_times.average_ms).toBeLessThan(3000);
    }, 60000);
  });

  // ==================== CACHE PERFORMANCE TESTS ====================

  describe('Cache Performance', () => {
    test('should demonstrate effective cache utilization', async () => {
      const scenarios = [
        {
          name: 'cache_operations',
          weight: 1,
          userCount: 40,
          duration: 30000,
          operations: [
            {
              name: 'cache_get',
              type: 'cache_operation',
              config: {
                operation: 'get',
                key: 'test_analytics_data'
              },
              delay: 10
            },
            {
              name: 'cache_set',
              type: 'cache_operation',
              config: {
                operation: 'set',
                key: 'test_analytics_data',
                value: JSON.stringify({ data: 'test_cache_value', timestamp: Date.now() })
              },
              delay: 20
            }
          ]
        }
      ];

      const result = await loadTestFramework.runLoadTest(scenarios);
      testResults['Cache Performance'] = result;

      expect(result.test_summary.success_rate_percent).toBeGreaterThan(99);
      expect(result.response_times.average_ms).toBeLessThan(100);
      expect(result.cache_performance.hit_ratio_percent).toBeGreaterThan(50);
    }, 60000);
  });

  // ==================== MIXED WORKLOAD TESTS ====================

  describe('Mixed Workload Performance', () => {
    test('should handle realistic mixed workload efficiently', async () => {
      const scenarios = [
        {
          name: 'read_heavy_workload',
          weight: 3,
          userCount: 20,
          duration: 30000,
          operations: [
            {
              name: 'get_customers',
              type: 'api_call',
              config: {
                endpoint: '/api/customers',
                method: 'GET'
              },
              delay: 100
            },
            {
              name: 'get_inventory',
              type: 'api_call',
              config: {
                endpoint: '/api/inventory',
                method: 'GET'
              },
              delay: 150
            }
          ]
        },
        {
          name: 'analytics_workload',
          weight: 1,
          userCount: 5,
          duration: 30000,
          operations: [
            {
              name: 'dashboard_analytics',
              type: 'analytics_query',
              config: {
                queryType: 'dashboard_analytics',
                params: {}
              },
              delay: 2000
            }
          ]
        },
        {
          name: 'cache_workload',
          weight: 2,
          userCount: 15,
          duration: 30000,
          operations: [
            {
              name: 'cache_operations',
              type: 'cache_operation',
              config: {
                operation: 'get',
                key: 'mixed_workload_cache'
              },
              delay: 50
            }
          ]
        }
      ];

      const result = await loadTestFramework.runLoadTest(scenarios);
      testResults['Mixed Workload Performance'] = result;

      expect(result.test_summary.success_rate_percent).toBeGreaterThan(90);
      expect(result.response_times.average_ms).toBeLessThan(2000);
      expect(result.test_summary.throughput_tps).toBeGreaterThan(10);
    }, 60000);
  });

  // ==================== STRESS TESTING ====================

  describe('Stress Testing', () => {
    test('should handle stress conditions gracefully', async () => {
      const stressFramework = new LoadTestFramework({
        maxConcurrentUsers: 100,
        testDuration: 20000, // Shorter duration for stress test
        targetTPS: 50,
        memoryThreshold: 512,
        cpuThreshold: 90,
        responseTimeThreshold: 5000, // More lenient for stress test
        errorRateThreshold: 10
      });

      const scenarios = [
        {
          name: 'stress_test_scenario',
          weight: 1,
          userCount: 80,
          duration: 20000,
          operations: [
            {
              name: 'concurrent_api_calls',
              type: 'api_call',
              config: {
                endpoint: '/api/customers',
                method: 'GET'
              },
              delay: 10 // Very short delay for stress
            },
            {
              name: 'concurrent_db_queries',
              type: 'database_query',
              config: {
                query: 'SELECT COUNT(*) FROM customers',
                params: []
              },
              delay: 5
            }
          ]
        }
      ];

      const result = await stressFramework.runLoadTest(scenarios);
      testResults['Stress Test'] = result;

      // More lenient expectations for stress test
      expect(result.test_summary.success_rate_percent).toBeGreaterThan(85);
      expect(result.response_times.average_ms).toBeLessThan(5000);
      
      // Verify system doesn't crash under stress
      expect(result.test_summary.total_requests).toBeGreaterThan(100);
    }, 45000);
  });

  // ==================== MEMORY LEAK DETECTION ====================

  describe('Memory Leak Detection', () => {
    test('should detect potential memory leaks during extended operation', async () => {
      const memoryTestFramework = new LoadTestFramework({
        maxConcurrentUsers: 20,
        testDuration: 45000, // Longer duration to detect leaks
        memoryThreshold: 300,
        cpuThreshold: 80
      });

      let memoryLeakDetected = false;
      let maxMemoryUsage = 0;

      memoryTestFramework.on('threshold_exceeded', (threshold) => {
        if (threshold.type === 'memory') {
          memoryLeakDetected = true;
          maxMemoryUsage = Math.max(maxMemoryUsage, threshold.value);
        }
      });

      const scenarios = [
        {
          name: 'memory_intensive_operations',
          weight: 1,
          userCount: 15,
          duration: 45000,
          operations: [
            {
              name: 'analytics_with_large_datasets',
              type: 'analytics_query',
              config: {
                queryType: 'comprehensive_analytics',
                params: { includeAll: true }
              },
              delay: 1000
            },
            {
              name: 'cache_intensive_operations',
              type: 'cache_operation',
              config: {
                operation: 'set',
                key: 'large_dataset',
                value: JSON.stringify(new Array(1000).fill({ data: 'memory_test' }))
              },
              delay: 500
            }
          ]
        }
      ];

      const result = await memoryTestFramework.runLoadTest(scenarios);
      testResults['Memory Leak Detection'] = result;

      // Analyze memory usage trend
      const memoryUsage = result.resource_utilization.memory;
      const memoryGrowthRate = (memoryUsage.max - memoryUsage.min) / memoryUsage.min;

      console.log(`Memory usage - Min: ${memoryUsage.min.toFixed(1)}MB, Max: ${memoryUsage.max.toFixed(1)}MB, Growth: ${(memoryGrowthRate * 100).toFixed(1)}%`);

      // Warn if memory growth is excessive (>50% growth might indicate a leak)
      if (memoryGrowthRate > 0.5) {
        console.warn('Potential memory leak detected: Memory usage increased by more than 50%');
      }

      expect(result.test_summary.success_rate_percent).toBeGreaterThan(90);
      expect(memoryGrowthRate).toBeLessThan(1.0); // Less than 100% growth
    }, 60000);
  });

  // ==================== CONCURRENT USER SIMULATION ====================

  describe('Concurrent User Simulation', () => {
    test('should simulate realistic user behavior patterns', async () => {
      const scenarios = [
        {
          name: 'power_users',
          weight: 1,
          userCount: 5,
          duration: 30000,
          operations: [
            {
              name: 'complex_analytics',
              type: 'analytics_query',
              config: {
                queryType: 'comprehensive_segmentation',
                params: { includeRecommendations: true }
              },
              delay: 3000
            },
            {
              name: 'bulk_operations',
              type: 'api_call',
              config: {
                endpoint: '/api/suppliers/bulk-update',
                method: 'POST',
                data: { updates: new Array(10).fill({ id: 'test', data: {} }) }
              },
              delay: 2000
            }
          ]
        },
        {
          name: 'regular_users',
          weight: 3,
          userCount: 15,
          duration: 30000,
          operations: [
            {
              name: 'browse_customers',
              type: 'api_call',
              config: {
                endpoint: '/api/customers',
                method: 'GET'
              },
              delay: 2000
            },
            {
              name: 'view_inventory',
              type: 'api_call',
              config: {
                endpoint: '/api/inventory',
                method: 'GET'
              },
              delay: 1500
            },
            {
              name: 'check_notifications',
              type: 'api_call',
              config: {
                endpoint: '/api/notifications',
                method: 'GET'
              },
              delay: 5000
            }
          ]
        },
        {
          name: 'casual_users',
          weight: 2,
          userCount: 10,
          duration: 30000,
          operations: [
            {
              name: 'dashboard_view',
              type: 'api_call',
              config: {
                endpoint: '/api/dashboard',
                method: 'GET'
              },
              delay: 10000
            },
            {
              name: 'search_products',
              type: 'api_call',
              config: {
                endpoint: '/api/products/search?q=test',
                method: 'GET'
              },
              delay: 8000
            }
          ]
        }
      ];

      const result = await loadTestFramework.runLoadTest(scenarios);
      testResults['Concurrent User Simulation'] = result;

      expect(result.test_summary.success_rate_percent).toBeGreaterThan(95);
      expect(result.response_times.average_ms).toBeLessThan(2500);
      expect(result.test_summary.total_requests).toBeGreaterThan(50);
    }, 60000);
  });
});