/**
 * Performance Benchmarks and Load Tests
 * Testing critical operations under various load conditions
 */

import { jest } from '@jest/globals';
import { performance } from 'perf_hooks';
import { 
  testNileConnection,
  insertDashboardMetric,
  getDashboardMetrics,
  insertDashboardEvent,
  storeRealTimeData,
  getRealTimeData,
  nilePool 
} from '../config/niledb.config.js';

// Performance test configuration
const PERFORMANCE_THRESHOLDS = {
  CONNECTION_TIME: 1000,     // 1 second
  SINGLE_INSERT: 100,        // 100ms
  BULK_INSERT: 5000,         // 5 seconds for 1000 records
  QUERY_RESPONSE: 500,       // 500ms
  CONCURRENT_OPERATIONS: 10000, // 10 seconds for 100 concurrent ops
  MEMORY_USAGE: 100 * 1024 * 1024, // 100MB
};

describe('Performance Benchmarks and Load Tests', () => {

  beforeAll(async () => {
    // Ensure clean state
    await testNileConnection();
  });

  afterAll(async () => {
    // Cleanup test data if needed
    const client = await nilePool.connect();
    try {
      await client.query("DELETE FROM dashboard_metrics WHERE metric_name LIKE 'perf_test_%'");
      await client.query("DELETE FROM dashboard_events WHERE event_type LIKE 'perf_test_%'");
      await client.query("DELETE FROM real_time_data WHERE data_type LIKE 'perf_test_%'");
    } finally {
      client.release();
    }
  });

  describe('Connection Performance', () => {
    
    test('should establish connection within threshold', async () => {
      const startTime = performance.now();
      const result = await testNileConnection();
      const duration = performance.now() - startTime;
      
      expect(result.success).toBe(true);
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.CONNECTION_TIME);
      
      console.log(`✅ Connection established in ${duration.toFixed(2)}ms`);
    });

    test('should handle connection pool efficiently', async () => {
      const startTime = performance.now();
      const promises = [];
      
      // Create 20 concurrent connections
      for (let i = 0; i < 20; i++) {
        promises.push(testNileConnection());
      }
      
      const results = await Promise.all(promises);
      const duration = performance.now() - startTime;
      
      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
      
      // Should handle efficiently
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.CONNECTION_TIME * 2);
      
      console.log(`✅ 20 concurrent connections handled in ${duration.toFixed(2)}ms`);
    });

    test('should maintain connection pool health under load', async () => {
      const initialStatus = nilePool.totalCount;
      const promises = [];
      
      // Simulate heavy load
      for (let i = 0; i < 50; i++) {
        promises.push(
          (async () => {
            const client = await nilePool.connect();
            await new Promise(resolve => setTimeout(resolve, 100)); // Hold connection
            client.release();
          })()
        );
      }
      
      await Promise.all(promises);
      
      // Pool should return to normal state
      const finalStatus = nilePool.totalCount;
      expect(finalStatus).toBeLessThanOrEqual(initialStatus + 5); // Allow some growth
      
      console.log(`✅ Pool maintained health: ${initialStatus} -> ${finalStatus} connections`);
    });
  });

  describe('Single Operation Performance', () => {
    
    test('should insert metrics within threshold', async () => {
      const metrics = [];
      
      for (let i = 0; i < 10; i++) {
        const startTime = performance.now();
        const result = await insertDashboardMetric(`perf_test_single_${i}`, Math.random() * 1000);
        const duration = performance.now() - startTime;
        
        expect(result.success).toBe(true);
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.SINGLE_INSERT);
        
        metrics.push(duration);
      }
      
      const avgDuration = metrics.reduce((a, b) => a + b) / metrics.length;
      console.log(`✅ Average single insert: ${avgDuration.toFixed(2)}ms`);
    });

    test('should query metrics within threshold', async () => {
      // Insert some test data first
      for (let i = 0; i < 5; i++) {
        await insertDashboardMetric(`perf_test_query_${i}`, i * 10);
      }
      
      const queries = [];
      
      for (let i = 0; i < 10; i++) {
        const startTime = performance.now();
        const result = await getDashboardMetrics('24h', 100);
        const duration = performance.now() - startTime;
        
        expect(result.success).toBe(true);
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.QUERY_RESPONSE);
        
        queries.push(duration);
      }
      
      const avgDuration = queries.reduce((a, b) => a + b) / queries.length;
      console.log(`✅ Average query time: ${avgDuration.toFixed(2)}ms`);
    });

    test('should handle real-time data operations efficiently', async () => {
      const operations = [];
      
      for (let i = 0; i < 10; i++) {
        const startTime = performance.now();
        
        // Store data
        const storeResult = await storeRealTimeData(
          `perf_test_realtime_${i}`,
          { timestamp: new Date(), value: Math.random() }
        );
        
        // Retrieve data
        const retrieveResult = await getRealTimeData(`perf_test_realtime_${i}`);
        
        const duration = performance.now() - startTime;
        
        expect(storeResult.success).toBe(true);
        expect(retrieveResult.success).toBe(true);
        expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.SINGLE_INSERT * 2);
        
        operations.push(duration);
      }
      
      const avgDuration = operations.reduce((a, b) => a + b) / operations.length;
      console.log(`✅ Average real-time operation: ${avgDuration.toFixed(2)}ms`);
    });
  });

  describe('Bulk Operations Performance', () => {
    
    test('should handle bulk metric insertions efficiently', async () => {
      const startTime = performance.now();
      const promises = [];
      const batchSize = 1000;
      
      for (let i = 0; i < batchSize; i++) {
        promises.push(
          insertDashboardMetric(
            `perf_test_bulk_${i}`,
            Math.random() * 1000,
            'counter',
            { batch: 'bulk_test', index: i }
          )
        );
      }
      
      const results = await Promise.all(promises);
      const duration = performance.now() - startTime;
      
      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
      
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.BULK_INSERT);
      
      const throughput = (batchSize / duration) * 1000; // ops per second
      console.log(`✅ Bulk insert: ${batchSize} records in ${duration.toFixed(2)}ms (${throughput.toFixed(2)} ops/sec)`);
    });

    test('should handle bulk queries efficiently', async () => {
      const startTime = performance.now();
      const promises = [];
      const queryCount = 100;
      
      for (let i = 0; i < queryCount; i++) {
        promises.push(getDashboardMetrics('24h', 10));
      }
      
      const results = await Promise.all(promises);
      const duration = performance.now() - startTime;
      
      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
        expect(Array.isArray(result.data)).toBe(true);
      });
      
      const throughput = (queryCount / duration) * 1000; // queries per second
      console.log(`✅ Bulk queries: ${queryCount} queries in ${duration.toFixed(2)}ms (${throughput.toFixed(2)} qps)`);
    });

    test('should handle mixed workload efficiently', async () => {
      const startTime = performance.now();
      const promises = [];
      const operationCount = 500;
      
      for (let i = 0; i < operationCount; i++) {
        if (i % 3 === 0) {
          // Insert metric
          promises.push(
            insertDashboardMetric(`perf_test_mixed_${i}`, Math.random() * 100)
          );
        } else if (i % 3 === 1) {
          // Insert event
          promises.push(
            insertDashboardEvent(
              `perf_test_mixed_event`,
              { operation: i, timestamp: new Date() }
            )
          );
        } else {
          // Query data
          promises.push(getDashboardMetrics('1h', 5));
        }
      }
      
      const results = await Promise.all(promises);
      const duration = performance.now() - startTime;
      
      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
      
      const throughput = (operationCount / duration) * 1000;
      console.log(`✅ Mixed workload: ${operationCount} operations in ${duration.toFixed(2)}ms (${throughput.toFixed(2)} ops/sec)`);
    });
  });

  describe('Concurrent Operations Performance', () => {
    
    test('should handle concurrent reads efficiently', async () => {
      const startTime = performance.now();
      const concurrentReads = 100;
      const promises = [];
      
      for (let i = 0; i < concurrentReads; i++) {
        promises.push(getDashboardMetrics('24h', 50));
      }
      
      const results = await Promise.all(promises);
      const duration = performance.now() - startTime;
      
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.CONCURRENT_OPERATIONS);
      
      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
      
      console.log(`✅ ${concurrentReads} concurrent reads in ${duration.toFixed(2)}ms`);
    });

    test('should handle concurrent writes efficiently', async () => {
      const startTime = performance.now();
      const concurrentWrites = 100;
      const promises = [];
      
      for (let i = 0; i < concurrentWrites; i++) {
        promises.push(
          insertDashboardMetric(
            `perf_test_concurrent_${i}`,
            Math.random() * 1000,
            'counter',
            { concurrent_test: true, index: i }
          )
        );
      }
      
      const results = await Promise.all(promises);
      const duration = performance.now() - startTime;
      
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.CONCURRENT_OPERATIONS);
      
      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
      
      console.log(`✅ ${concurrentWrites} concurrent writes in ${duration.toFixed(2)}ms`);
    });

    test('should handle read-write contention efficiently', async () => {
      const startTime = performance.now();
      const promises = [];
      const operationCount = 200;
      
      // Mix of reads and writes
      for (let i = 0; i < operationCount; i++) {
        if (i % 2 === 0) {
          // Write operation
          promises.push(
            insertDashboardMetric(`perf_test_contention_${i}`, Math.random() * 100)
          );
        } else {
          // Read operation
          promises.push(getDashboardMetrics('1h', 10));
        }
      }
      
      const results = await Promise.all(promises);
      const duration = performance.now() - startTime;
      
      expect(duration).toBeLessThan(PERFORMANCE_THRESHOLDS.CONCURRENT_OPERATIONS);
      
      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
      
      console.log(`✅ ${operationCount} mixed concurrent operations in ${duration.toFixed(2)}ms`);
    });
  });

  describe('Memory Usage and Resource Management', () => {
    
    test('should manage memory efficiently during large operations', async () => {
      const initialMemory = process.memoryUsage();
      
      // Perform memory-intensive operations
      const promises = [];
      for (let i = 0; i < 1000; i++) {
        promises.push(
          insertDashboardMetric(
            `perf_test_memory_${i}`,
            Math.random() * 1000,
            'counter',
            { 
              large_metadata: {
                description: 'A'.repeat(1000), // Large string
                data: Array(100).fill(0).map(() => Math.random()),
                timestamp: new Date().toISOString()
              }
            }
          )
        );
      }
      
      await Promise.all(promises);
      
      // Force garbage collection
      if (global.gc) {
        global.gc();
      }
      
      const finalMemory = process.memoryUsage();
      const memoryIncrease = finalMemory.heapUsed - initialMemory.heapUsed;
      
      expect(memoryIncrease).toBeLessThan(PERFORMANCE_THRESHOLDS.MEMORY_USAGE);
      
      console.log(`✅ Memory increase: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
    });

    test('should clean up connections properly', async () => {
      const initialConnections = nilePool.totalCount;
      
      // Create and use many connections
      const clients = [];
      for (let i = 0; i < 20; i++) {
        const client = await nilePool.connect();
        clients.push(client);
        await client.query('SELECT NOW()');
      }
      
      // Release all connections
      clients.forEach(client => client.release());
      
      // Wait for cleanup
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const finalConnections = nilePool.totalCount;
      
      // Should not have significantly more connections
      expect(finalConnections).toBeLessThanOrEqual(initialConnections + 5);
      
      console.log(`✅ Connection cleanup: ${initialConnections} -> ${finalConnections}`);
    });
  });

  describe('Stress Testing', () => {
    
    test('should handle stress conditions gracefully', async () => {
      const stressTestDuration = 30000; // 30 seconds
      const startTime = performance.now();
      const operations = [];
      let operationCount = 0;
      let errorCount = 0;
      
      const stressTest = async () => {
        while (performance.now() - startTime < stressTestDuration) {
          try {
            operationCount++;
            
            // Random operation
            const operation = Math.floor(Math.random() * 3);
            
            if (operation === 0) {
              await insertDashboardMetric(
                `stress_test_${operationCount}`,
                Math.random() * 1000
              );
            } else if (operation === 1) {
              await getDashboardMetrics('1h', 10);
            } else {
              await storeRealTimeData(
                `stress_test_${operationCount}`,
                { value: Math.random(), timestamp: new Date() }
              );
            }
            
            // Small delay to prevent overwhelming
            await new Promise(resolve => setTimeout(resolve, 10));
            
          } catch (error) {
            errorCount++;
            console.warn(`Stress test error: ${error.message}`);
          }
        }
      };
      
      // Run multiple stress test workers
      const workers = [];
      for (let i = 0; i < 5; i++) {
        workers.push(stressTest());
      }
      
      await Promise.all(workers);
      
      const duration = performance.now() - startTime;
      const throughput = (operationCount / duration) * 1000;
      const errorRate = (errorCount / operationCount) * 100;
      
      console.log(`✅ Stress test completed:`);
      console.log(`   Operations: ${operationCount}`);
      console.log(`   Duration: ${duration.toFixed(2)}ms`);
      console.log(`   Throughput: ${throughput.toFixed(2)} ops/sec`);
      console.log(`   Error rate: ${errorRate.toFixed(2)}%`);
      
      // Error rate should be low
      expect(errorRate).toBeLessThan(5); // Less than 5% errors acceptable
    }, 35000); // Extend timeout for stress test
  });

  describe('Query Optimization Tests', () => {
    
    test('should benefit from database indexes', async () => {
      // Insert test data
      const testData = [];
      for (let i = 0; i < 1000; i++) {
        testData.push(
          insertDashboardMetric(
            `index_test_${i % 10}`, // Limited unique names to test index
            Math.random() * 1000,
            'counter',
            { category: `category_${i % 5}` }
          )
        );
      }
      
      await Promise.all(testData);
      
      // Test indexed query performance
      const startTime = performance.now();
      const result = await getDashboardMetrics('24h', 100);
      const indexedQueryTime = performance.now() - startTime;
      
      expect(result.success).toBe(true);
      expect(indexedQueryTime).toBeLessThan(PERFORMANCE_THRESHOLDS.QUERY_RESPONSE);
      
      console.log(`✅ Indexed query completed in ${indexedQueryTime.toFixed(2)}ms`);
    });

    test('should handle complex queries efficiently', async () => {
      const client = await nilePool.connect();
      
      try {
        const startTime = performance.now();
        
        // Complex aggregation query
        const result = await client.query(`
          SELECT 
            metric_name,
            COUNT(*) as count,
            AVG(metric_value) as avg_value,
            MIN(metric_value) as min_value,
            MAX(metric_value) as max_value,
            DATE_TRUNC('hour', timestamp) as hour
          FROM dashboard_metrics 
          WHERE timestamp >= NOW() - INTERVAL '24 hours'
            AND metric_name LIKE 'perf_test_%'
          GROUP BY metric_name, DATE_TRUNC('hour', timestamp)
          ORDER BY hour DESC, avg_value DESC
          LIMIT 100
        `);
        
        const queryTime = performance.now() - startTime;
        
        expect(result.rows).toBeDefined();
        expect(queryTime).toBeLessThan(PERFORMANCE_THRESHOLDS.QUERY_RESPONSE * 2); // Allow more time for complex query
        
        console.log(`✅ Complex query returned ${result.rows.length} rows in ${queryTime.toFixed(2)}ms`);
        
      } finally {
        client.release();
      }
    });
  });

  describe('Performance Regression Detection', () => {
    
    test('should detect performance regressions', async () => {
      const baselineResults = [];
      const currentResults = [];
      
      // Run baseline tests
      for (let i = 0; i < 10; i++) {
        const startTime = performance.now();
        await insertDashboardMetric(`regression_test_${i}`, Math.random() * 100);
        baselineResults.push(performance.now() - startTime);
      }
      
      // Simulate some load (to potentially affect performance)
      const loadPromises = [];
      for (let i = 0; i < 50; i++) {
        loadPromises.push(getDashboardMetrics('1h', 10));
      }
      await Promise.all(loadPromises);
      
      // Run current tests
      for (let i = 0; i < 10; i++) {
        const startTime = performance.now();
        await insertDashboardMetric(`regression_test_current_${i}`, Math.random() * 100);
        currentResults.push(performance.now() - startTime);
      }
      
      const baselineAvg = baselineResults.reduce((a, b) => a + b) / baselineResults.length;
      const currentAvg = currentResults.reduce((a, b) => a + b) / currentResults.length;
      
      const regressionThreshold = 1.5; // 50% increase is concerning
      const performanceRatio = currentAvg / baselineAvg;
      
      console.log(`Performance comparison:`);
      console.log(`   Baseline: ${baselineAvg.toFixed(2)}ms`);
      console.log(`   Current: ${currentAvg.toFixed(2)}ms`);
      console.log(`   Ratio: ${performanceRatio.toFixed(2)}x`);
      
      if (performanceRatio > regressionThreshold) {
        console.warn(`⚠️  Potential performance regression detected: ${performanceRatio.toFixed(2)}x slower`);
      } else {
        console.log(`✅ No significant performance regression`);
      }
      
      // Test should pass but warn about regressions
      expect(performanceRatio).toBeLessThan(3); // Fail if 3x slower
    });
  });
});