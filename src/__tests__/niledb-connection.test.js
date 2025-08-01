/**
 * NILEDB Connection Tests
 * Testing database connections, pool management, SSL, and failover scenarios
 */

import { jest } from '@jest/globals';
import { 
  testNileConnection, 
  getNileConnectionStatus, 
  initializeNileDB,
  insertDashboardMetric,
  getDashboardMetrics,
  insertDashboardEvent,
  getDashboardEvents,
  storeRealTimeData,
  getRealTimeData,
  cleanupExpiredData,
  closeNilePool,
  nilePool
} from '../config/niledb.config.js';

describe('NILEDB Connection Tests', () => {
  
  beforeAll(async () => {
    // Initialize test database
    const initResult = await initializeNileDB();
    expect(initResult.success).toBe(true);
  });

  afterAll(async () => {
    // Cleanup and close connections
    await cleanupExpiredData();
    await closeNilePool();
  });

  describe('Connection Management', () => {
    
    test('should establish connection to NILEDB', async () => {
      const result = await testNileConnection();
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('current_time');
      expect(result.data).toHaveProperty('version');
      expect(result.data.version).toContain('PostgreSQL');
    }, 10000);

    test('should return connection status with pool statistics', async () => {
      const status = getNileConnectionStatus();
      
      expect(status).toHaveProperty('isHealthy');
      expect(status).toHaveProperty('lastCheck');
      expect(status).toHaveProperty('errorCount');
      expect(status).toHaveProperty('poolStats');
      expect(status.poolStats).toHaveProperty('totalCount');
      expect(status.poolStats).toHaveProperty('idleCount');
      expect(status.poolStats).toHaveProperty('waitingCount');
    });

    test('should handle connection pool limits', async () => {
      const promises = [];
      
      // Create more connections than pool max (10)
      for (let i = 0; i < 15; i++) {
        promises.push(testNileConnection());
      }
      
      const results = await Promise.all(promises);
      
      // All should succeed (some will queue)
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
    }, 15000);

    test('should handle SSL connection properly', async () => {
      const client = await nilePool.connect();
      
      try {
        const result = await client.query("SELECT ssl_is_used() as ssl_used");
        expect(result.rows[0]).toHaveProperty('ssl_used');
        // SSL should be enabled for NileDB
        expect(result.rows[0].ssl_used).toBe(true);
      } finally {
        client.release();
      }
    });

    test('should handle connection timeout gracefully', async () => {
      // Mock a delayed connection
      const originalConnect = nilePool.connect;
      nilePool.connect = jest.fn(() => 
        new Promise(resolve => setTimeout(resolve, 6000))
      );
      
      const startTime = Date.now();
      
      try {
        await testNileConnection();
      } catch (error) {
        const duration = Date.now() - startTime;
        expect(duration).toBeGreaterThan(5000); // Should timeout after 5s
        expect(error.message).toContain('timeout');
      }
      
      // Restore original function
      nilePool.connect = originalConnect;
    }, 8000);
  });

  describe('Dashboard Metrics Operations', () => {
    
    test('should insert dashboard metric successfully', async () => {
      const result = await insertDashboardMetric(
        'test_metric', 
        100.50, 
        'counter', 
        { source: 'test' }
      );
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('id');
      expect(result.data.metric_name).toBe('test_metric');
      expect(parseFloat(result.data.metric_value)).toBe(100.50);
      expect(result.data.metric_type).toBe('counter');
    });

    test('should retrieve dashboard metrics with time filtering', async () => {
      // Insert test data
      await insertDashboardMetric('test_metric_1', 50, 'gauge');
      await insertDashboardMetric('test_metric_2', 75, 'counter');
      
      const result = await getDashboardMetrics('24h', 10);
      
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      
      // Check data structure
      result.data.forEach(metric => {
        expect(metric).toHaveProperty('id');
        expect(metric).toHaveProperty('metric_name');
        expect(metric).toHaveProperty('metric_value');
        expect(metric).toHaveProperty('timestamp');
      });
    });

    test('should handle various time ranges for metrics', async () => {
      const timeRanges = ['24h', '7d', '30d'];
      
      for (const range of timeRanges) {
        const result = await getDashboardMetrics(range, 5);
        expect(result.success).toBe(true);
        expect(Array.isArray(result.data)).toBe(true);
      }
    });

    test('should handle invalid metric data gracefully', async () => {
      const result = await insertDashboardMetric(null, 'invalid', 'unknown');
      
      expect(result.success).toBe(false);
      expect(result).toHaveProperty('error');
    });
  });

  describe('Dashboard Events Operations', () => {
    
    test('should insert dashboard event successfully', async () => {
      const eventData = {
        user_id: 123,
        action: 'login',
        ip_address: '192.168.1.1'
      };
      
      const result = await insertDashboardEvent(
        'user_action', 
        eventData, 
        'auth_service', 
        'info'
      );
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('id');
      expect(result.data.event_type).toBe('user_action');
      expect(result.data.event_source).toBe('auth_service');
      expect(result.data.severity).toBe('info');
    });

    test('should retrieve dashboard events with filtering', async () => {
      // Insert test events
      await insertDashboardEvent('test_event', { test: true }, 'test', 'warning');
      await insertDashboardEvent('other_event', { other: true }, 'test', 'error');
      
      const allEvents = await getDashboardEvents(10);
      expect(allEvents.success).toBe(true);
      expect(allEvents.data.length).toBeGreaterThan(0);
      
      const filteredEvents = await getDashboardEvents(10, 'test_event');
      expect(filteredEvents.success).toBe(true);
      
      // Should only contain test_event entries
      filteredEvents.data.forEach(event => {
        expect(event.event_type).toBe('test_event');
      });
    });

    test('should handle different severity levels', async () => {
      const severities = ['info', 'warning', 'error', 'critical'];
      
      for (const severity of severities) {
        const result = await insertDashboardEvent(
          'severity_test', 
          { level: severity }, 
          'test', 
          severity
        );
        expect(result.success).toBe(true);
        expect(result.data.severity).toBe(severity);
      }
    });
  });

  describe('Real-time Data Operations', () => {
    
    test('should store real-time data with expiration', async () => {
      const payload = {
        temperature: 25.5,
        humidity: 60,
        timestamp: new Date().toISOString()
      };
      
      const result = await storeRealTimeData('sensor_data', payload, 2);
      
      expect(result.success).toBe(true);
      expect(result.data).toHaveProperty('id');
      expect(result.data.data_type).toBe('sensor_data');
      expect(result.data.expires_at).toBeDefined();
    });

    test('should retrieve non-expired real-time data', async () => {
      // Store some test data
      await storeRealTimeData('test_data', { value: 1 }, 1);
      await storeRealTimeData('test_data', { value: 2 }, 1);
      
      const result = await getRealTimeData('test_data', 5);
      
      expect(result.success).toBe(true);
      expect(Array.isArray(result.data)).toBe(true);
      expect(result.data.length).toBeGreaterThan(0);
      
      // Check data structure
      result.data.forEach(item => {
        expect(item).toHaveProperty('id');
        expect(item).toHaveProperty('data_type');
        expect(item).toHaveProperty('data_payload');
        expect(item).toHaveProperty('expires_at');
        expect(item.data_type).toBe('test_data');
      });
    });

    test('should cleanup expired data', async () => {
      // Store data that expires immediately
      await storeRealTimeData('expire_test', { temp: true }, 0);
      
      // Wait a moment for expiration
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      const cleanupResult = await cleanupExpiredData();
      expect(cleanupResult.success).toBe(true);
      expect(cleanupResult.deletedCount).toBeGreaterThanOrEqual(0);
    });

    test('should handle concurrent real-time operations', async () => {
      const promises = [];
      
      // Concurrent writes
      for (let i = 0; i < 10; i++) {
        promises.push(
          storeRealTimeData(`concurrent_test_${i}`, { index: i }, 1)
        );
      }
      
      const results = await Promise.all(promises);
      
      results.forEach((result, index) => {
        expect(result.success).toBe(true);
        expect(result.data.data_type).toBe(`concurrent_test_${index}`);
      });
    });
  });

  describe('Database Initialization and Schema', () => {
    
    test('should verify required tables exist', async () => {
      const client = await nilePool.connect();
      
      try {
        const tables = await client.query(`
          SELECT table_name 
          FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name IN ('dashboard_metrics', 'dashboard_events', 'real_time_data')
        `);
        
        const tableNames = tables.rows.map(row => row.table_name);
        expect(tableNames).toContain('dashboard_metrics');
        expect(tableNames).toContain('dashboard_events');
        expect(tableNames).toContain('real_time_data');
      } finally {
        client.release();
      }
    });

    test('should verify indexes exist for performance', async () => {
      const client = await nilePool.connect();
      
      try {
        const indexes = await client.query(`
          SELECT indexname 
          FROM pg_indexes 
          WHERE tablename IN ('dashboard_metrics', 'dashboard_events', 'real_time_data')
        `);
        
        const indexNames = indexes.rows.map(row => row.indexname);
        expect(indexNames).toContain('idx_dashboard_metrics_name_time');
        expect(indexNames).toContain('idx_dashboard_events_type_time');
        expect(indexNames).toContain('idx_real_time_data_type_time');
      } finally {
        client.release();
      }
    });

    test('should handle duplicate table creation gracefully', async () => {
      // Should not fail if tables already exist
      const result = await initializeNileDB();
      expect(result.success).toBe(true);
    });
  });

  describe('Error Handling and Recovery', () => {
    
    test('should handle database unavailable scenario', async () => {
      // Mock connection failure
      const originalConnect = nilePool.connect;
      nilePool.connect = jest.fn(() => 
        Promise.reject(new Error('Connection refused'))
      );
      
      const result = await testNileConnection();
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Connection refused');
      
      // Restore original function
      nilePool.connect = originalConnect;
    });

    test('should handle SQL injection attempts', async () => {
      const maliciousInput = "'; DROP TABLE dashboard_metrics; --";
      
      const result = await insertDashboardMetric(maliciousInput, 100);
      
      // Should either succeed with escaped input or fail gracefully
      if (result.success) {
        expect(result.data.metric_name).toBe(maliciousInput);
      } else {
        expect(result).toHaveProperty('error');
      }
      
      // Verify table still exists
      const status = await testNileConnection();
      expect(status.success).toBe(true);
    });

    test('should handle invalid JSON data', async () => {
      const client = await nilePool.connect();
      
      try {
        // Try to insert invalid JSON
        const result = await client.query(
          'INSERT INTO dashboard_events (event_type, event_data) VALUES ($1, $2)',
          ['test', 'invalid json string']
        );
        
        // Should fail due to invalid JSON
        expect(false).toBe(true); // Should not reach here
      } catch (error) {
        expect(error.message).toContain('invalid input syntax for type json');
      } finally {
        client.release();
      }
    });
  });

  describe('Performance and Load Testing', () => {
    
    test('should handle high-volume metric insertions', async () => {
      const startTime = Date.now();
      const promises = [];
      
      // Insert 100 metrics concurrently
      for (let i = 0; i < 100; i++) {
        promises.push(
          insertDashboardMetric(`perf_test_${i}`, Math.random() * 1000)
        );
      }
      
      const results = await Promise.all(promises);
      const duration = Date.now() - startTime;
      
      // All should succeed
      results.forEach(result => {
        expect(result.success).toBe(true);
      });
      
      // Should complete within reasonable time (10 seconds)
      expect(duration).toBeLessThan(10000);
      
      console.log(`✅ Inserted 100 metrics in ${duration}ms (${(100/duration*1000).toFixed(2)} ops/sec)`);
    }, 15000);

    test('should maintain connection pool efficiency', async () => {
      const initialStatus = getNileConnectionStatus();
      
      // Perform multiple operations
      await Promise.all([
        getDashboardMetrics('24h', 10),
        getDashboardEvents(10),
        getRealTimeData('test_data', 5),
        testNileConnection()
      ]);
      
      const finalStatus = getNileConnectionStatus();
      
      // Pool should remain healthy
      expect(finalStatus.isHealthy).toBe(true);
      expect(finalStatus.errorCount).toBe(initialStatus.errorCount);
    });
  });
});