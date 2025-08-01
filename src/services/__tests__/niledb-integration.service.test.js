/**
 * NILEDB Integration Service Tests
 * Comprehensive unit tests for all NILEDB service integrations
 */

import { jest } from '@jest/globals';
import { 
  testNileConnection,
  insertDashboardMetric,
  getDashboardMetrics,
  insertDashboardEvent,
  storeRealTimeData,
  getRealTimeData
} from '../../config/niledb.config.js';

// Mock external dependencies
jest.mock('../../config/niledb.config.js');

describe('NILEDB Integration Service Tests', () => {
  
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Dashboard Metrics Service Integration', () => {
    
    test('should track user activity metrics', async () => {
      // Mock successful metric insertion
      insertDashboardMetric.mockResolvedValue({
        success: true,
        data: {
          id: 1,
          metric_name: 'user_login',
          metric_value: 1,
          timestamp: new Date()
        }
      });

      // Import service after mocking
      const { trackUserActivity } = await import('../dashboard.service.js');
      
      const result = await trackUserActivity('login', 'user123');
      
      expect(insertDashboardMetric).toHaveBeenCalledWith(
        'user_login',
        1,
        'counter',
        expect.objectContaining({
          user_id: 'user123',
          action: 'login'
        })
      );
      expect(result.success).toBe(true);
    });

    test('should aggregate performance metrics', async () => {
      const mockMetrics = [
        { metric_name: 'api_response_time', metric_value: 150, timestamp: new Date() },
        { metric_name: 'api_response_time', metric_value: 200, timestamp: new Date() },
        { metric_name: 'api_response_time', metric_value: 100, timestamp: new Date() }
      ];

      getDashboardMetrics.mockResolvedValue({
        success: true,
        data: mockMetrics
      });

      const { getPerformanceAnalytics } = await import('../analytics.service.js');
      
      const result = await getPerformanceAnalytics('api_response_time', '24h');
      
      expect(getDashboardMetrics).toHaveBeenCalledWith('24h', 1000);
      expect(result).toHaveProperty('average');
      expect(result).toHaveProperty('min');
      expect(result).toHaveProperty('max');
      expect(result.average).toBe(150); // (150+200+100)/3
    });

    test('should handle inventory level tracking', async () => {
      insertDashboardMetric.mockResolvedValue({
        success: true,
        data: { id: 2, metric_name: 'inventory_level' }
      });

      const { trackInventoryLevel } = await import('../inventory-sync.service.js');
      
      await trackInventoryLevel('ITEM001', 50, 'low_stock');
      
      expect(insertDashboardMetric).toHaveBeenCalledWith(
        'inventory_level',
        50,
        'gauge',
        expect.objectContaining({
          item_id: 'ITEM001',
          status: 'low_stock',
          category: 'inventory'
        })
      );
    });
  });

  describe('Real-time Data Service Integration', () => {
    
    test('should store live dashboard updates', async () => {
      storeRealTimeData.mockResolvedValue({
        success: true,
        data: { id: 1, data_type: 'dashboard_update' }
      });

      const { broadcastDashboardUpdate } = await import('../realtime-service.js');
      
      const updateData = {
        type: 'inventory_alert',
        message: 'Low stock warning',
        item_id: 'ITEM001',
        current_level: 5
      };

      await broadcastDashboardUpdate(updateData);
      
      expect(storeRealTimeData).toHaveBeenCalledWith(
        'dashboard_update',
        updateData,
        1 // 1 hour expiry
      );
    });

    test('should retrieve recent activity feed', async () => {
      const mockActivityData = [
        {
          id: 1,
          data_payload: { type: 'order_created', order_id: 'ORD001' },
          timestamp: new Date()
        },
        {
          id: 2,
          data_payload: { type: 'inventory_updated', item_id: 'ITEM001' },
          timestamp: new Date()
        }
      ];

      getRealTimeData.mockResolvedValue({
        success: true,
        data: mockActivityData
      });

      const { getActivityFeed } = await import('../realtime-service.js');
      
      const result = await getActivityFeed(10);
      
      expect(getRealTimeData).toHaveBeenCalledWith('activity_feed', 10);
      expect(result).toHaveLength(2);
      expect(result[0]).toHaveProperty('type', 'order_created');
    });

    test('should handle WebSocket connection data', async () => {
      storeRealTimeData.mockResolvedValue({ success: true, data: {} });

      const { storeWebSocketSession } = await import('../websocket.service.js');
      
      const sessionData = {
        session_id: 'ws_123',
        user_id: 'user456',
        connected_at: new Date(),
        ip_address: '192.168.1.1'
      };

      await storeWebSocketSession(sessionData);
      
      expect(storeRealTimeData).toHaveBeenCalledWith(
        'websocket_session',
        sessionData,
        24 // 24 hour expiry
      );
    });
  });

  describe('Event Tracking Service Integration', () => {
    
    test('should log user authentication events', async () => {
      insertDashboardEvent.mockResolvedValue({
        success: true,
        data: { id: 1, event_type: 'auth_event' }
      });

      const { logAuthenticationEvent } = await import('../auth.service.js');
      
      await logAuthenticationEvent('login_success', {
        user_id: 'user123',
        ip_address: '192.168.1.1',
        user_agent: 'Mozilla/5.0...'
      });
      
      expect(insertDashboardEvent).toHaveBeenCalledWith(
        'auth_event',
        expect.objectContaining({
          action: 'login_success',
          user_id: 'user123',
          ip_address: '192.168.1.1'
        }),
        'auth_service',
        'info'
      );
    });

    test('should track supplier upload events', async () => {
      insertDashboardEvent.mockResolvedValue({
        success: true,
        data: { id: 2, event_type: 'supplier_upload' }
      });

      const { trackSupplierUpload } = await import('../supplier-upload-enhanced.service.js');
      
      const uploadData = {
        supplier_id: 'SUP001',
        file_name: 'inventory.csv',
        file_size: 2048,
        records_processed: 150,
        success_count: 145,
        error_count: 5
      };

      await trackSupplierUpload(uploadData);
      
      expect(insertDashboardEvent).toHaveBeenCalledWith(
        'supplier_upload',
        uploadData,
        'upload_service',
        'info'
      );
    });

    test('should log error events with proper severity', async () => {
      insertDashboardEvent.mockResolvedValue({
        success: true,
        data: { id: 3, event_type: 'system_error' }
      });

      const { logSystemError } = await import('../analytics.service.js');
      
      const errorData = {
        error_code: 'DB_CONNECTION_FAILED',
        error_message: 'Failed to connect to database',
        stack_trace: 'Error: Connection refused...',
        service: 'inventory_service'
      };

      await logSystemError(errorData);
      
      expect(insertDashboardEvent).toHaveBeenCalledWith(
        'system_error',
        errorData,
        'system',
        'error'
      );
    });
  });

  describe('Integration Health Monitoring', () => {
    
    test('should monitor NILEDB connection health', async () => {
      testNileConnection.mockResolvedValue({
        success: true,
        data: { current_time: new Date(), version: 'PostgreSQL 13.0' }
      });

      const { checkNileDBHealth } = await import('../integration-monitoring.service.js');
      
      const result = await checkNileDBHealth();
      
      expect(testNileConnection).toHaveBeenCalled();
      expect(result.status).toBe('healthy');
      expect(result.response_time).toBeDefined();
      expect(result.database_version).toContain('PostgreSQL');
    });

    test('should handle connection failures gracefully', async () => {
      testNileConnection.mockResolvedValue({
        success: false,
        error: 'Connection timeout'
      });

      const { checkNileDBHealth } = await import('../integration-monitoring.service.js');
      
      const result = await checkNileDBHealth();
      
      expect(result.status).toBe('unhealthy');
      expect(result.error).toBe('Connection timeout');
      expect(result.last_successful_connection).toBeDefined();
    });

    test('should track integration performance metrics', async () => {
      insertDashboardMetric.mockResolvedValue({ success: true, data: {} });

      const { trackIntegrationPerformance } = await import('../integration-monitoring.service.js');
      
      await trackIntegrationPerformance('niledb_query', 150);
      
      expect(insertDashboardMetric).toHaveBeenCalledWith(
        'integration_performance',
        150,
        'histogram',
        expect.objectContaining({
          integration: 'niledb_query',
          timestamp: expect.any(String)
        })
      );
    });
  });

  describe('Data Consistency and Validation', () => {
    
    test('should validate metric data before insertion', async () => {
      const { validateMetricData } = await import('../data-validation.service.js');
      
      const validData = {
        name: 'test_metric',
        value: 100,
        type: 'counter'
      };

      const invalidData = {
        name: '',
        value: 'invalid',
        type: 'unknown'
      };

      expect(validateMetricData(validData)).toBe(true);
      expect(validateMetricData(invalidData)).toBe(false);
    });

    test('should sanitize event data for security', async () => {
      const { sanitizeEventData } = await import('../data-validation.service.js');
      
      const unsafeData = {
        message: '<script>alert("xss")</script>',
        user_input: 'SELECT * FROM users;'
      };

      const sanitized = sanitizeEventData(unsafeData);
      
      expect(sanitized.message).not.toContain('<script>');
      expect(sanitized.user_input).not.toContain('SELECT');
    });

    test('should ensure data consistency across operations', async () => {
      insertDashboardMetric.mockResolvedValue({ success: true, data: { id: 1 } });
      insertDashboardEvent.mockResolvedValue({ success: true, data: { id: 1 } });

      const { performConsistentUpdate } = await import('../data-consistency.service.js');
      
      const result = await performConsistentUpdate({
        metric: { name: 'test', value: 100 },
        event: { type: 'test_event', data: { test: true } }
      });

      expect(result.success).toBe(true);
      expect(insertDashboardMetric).toHaveBeenCalled();
      expect(insertDashboardEvent).toHaveBeenCalled();
    });
  });

  describe('Performance Optimization', () => {
    
    test('should batch multiple metric insertions', async () => {
      insertDashboardMetric.mockResolvedValue({ success: true, data: {} });

      const { batchInsertMetrics } = await import('../optimization.service.js');
      
      const metrics = [
        { name: 'metric1', value: 10 },
        { name: 'metric2', value: 20 },
        { name: 'metric3', value: 30 }
      ];

      await batchInsertMetrics(metrics);
      
      expect(insertDashboardMetric).toHaveBeenCalledTimes(3);
    });

    test('should implement caching for frequent queries', async () => {
      getDashboardMetrics.mockResolvedValue({
        success: true,
        data: [{ id: 1, metric_name: 'cached_metric' }]
      });

      const { getCachedMetrics } = await import('../cache.service.js');
      
      // First call should hit database
      await getCachedMetrics('test_metric', '1h');
      expect(getDashboardMetrics).toHaveBeenCalledTimes(1);
      
      // Second call should use cache
      await getCachedMetrics('test_metric', '1h');
      expect(getDashboardMetrics).toHaveBeenCalledTimes(1); // Still 1
    });

    test('should handle rate limiting for high-frequency operations', async () => {
      const { rateLimitedInsert } = await import('../rate-limiting.service.js');
      
      const promises = [];
      for (let i = 0; i < 100; i++) {
        promises.push(rateLimitedInsert('high_freq_metric', i));
      }

      const results = await Promise.allSettled(promises);
      
      // Some should be rejected due to rate limiting
      const rejected = results.filter(r => r.status === 'rejected');
      expect(rejected.length).toBeGreaterThan(0);
    });
  });

  describe('Error Recovery and Resilience', () => {
    
    test('should implement retry logic for failed operations', async () => {
      insertDashboardMetric
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockRejectedValueOnce(new Error('Connection failed'))
        .mockResolvedValueOnce({ success: true, data: {} });

      const { retryableInsertMetric } = await import('../resilience.service.js');
      
      const result = await retryableInsertMetric('retry_test', 100);
      
      expect(result.success).toBe(true);
      expect(insertDashboardMetric).toHaveBeenCalledTimes(3);
    });

    test('should implement circuit breaker pattern', async () => {
      const { CircuitBreaker } = await import('../circuit-breaker.service.js');
      
      const breaker = new CircuitBreaker(testNileConnection, {
        failureThreshold: 3,
        timeout: 5000
      });

      // Simulate failures
      testNileConnection.mockRejectedValue(new Error('Service unavailable'));
      
      for (let i = 0; i < 5; i++) {
        try {
          await breaker.execute();
        } catch (error) {
          // Expected to fail
        }
      }

      expect(breaker.state).toBe('OPEN');
    });

    test('should implement fallback mechanisms', async () => {
      getDashboardMetrics.mockRejectedValue(new Error('Database unavailable'));

      const { getMetricsWithFallback } = await import('../fallback.service.js');
      
      const result = await getMetricsWithFallback('test_metric');
      
      expect(result.source).toBe('fallback');
      expect(result.data).toBeDefined();
    });
  });

  describe('Security and Compliance', () => {
    
    test('should encrypt sensitive data before storage', async () => {
      const { encryptSensitiveData } = await import('../encryption.service.js');
      
      const sensitiveData = {
        user_id: 'user123',
        email: 'user@example.com',
        api_key: 'sk-1234567890'
      };

      const encrypted = await encryptSensitiveData(sensitiveData);
      
      expect(encrypted.email).not.toBe('user@example.com');
      expect(encrypted.api_key).not.toBe('sk-1234567890');
      expect(encrypted.user_id).toBe('user123'); // Non-sensitive, not encrypted
    });

    test('should audit all database operations', async () => {
      insertDashboardEvent.mockResolvedValue({ success: true, data: {} });

      const { auditDatabaseOperation } = await import('../audit.service.js');
      
      await auditDatabaseOperation('INSERT', 'dashboard_metrics', {
        user_id: 'user123',
        operation_id: 'op_456'
      });

      expect(insertDashboardEvent).toHaveBeenCalledWith(
        'database_audit',
        expect.objectContaining({
          operation: 'INSERT',
          table: 'dashboard_metrics',
          user_id: 'user123'
        }),
        'audit_service',
        'info'
      );
    });

    test('should implement access control for sensitive operations', async () => {
      const { authorizeMetricAccess } = await import('../rbac.service.js');
      
      const user = { id: 'user123', roles: ['analyst'] };
      const metric = { name: 'sensitive_metric', classification: 'confidential' };
      
      const hasAccess = await authorizeMetricAccess(user, metric);
      
      expect(hasAccess).toBe(false); // Analyst shouldn't access confidential
    });
  });
});