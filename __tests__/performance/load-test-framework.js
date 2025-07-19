/**
 * Comprehensive Load Testing Framework
 * 
 * Provides performance testing for all critical system components:
 * - API endpoint load testing
 * - Database performance under load
 * - Cache performance testing
 * - Memory and CPU usage monitoring
 * - Concurrent user simulation
 * - Stress testing scenarios
 */

import { performance } from 'perf_hooks';
import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import { EventEmitter } from 'events';
import os from 'os';
import { db } from '../../src/config/database.js';
import { analyticsCache } from '../../src/config/redis.js';

class LoadTestFramework extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = {
      maxConcurrentUsers: options.maxConcurrentUsers || 100,
      testDuration: options.testDuration || 60000, // 60 seconds
      rampUpTime: options.rampUpTime || 10000, // 10 seconds
      targetTPS: options.targetTPS || 50, // Transactions per second
      memoryThreshold: options.memoryThreshold || 512, // MB
      cpuThreshold: options.cpuThreshold || 80, // Percentage
      responseTimeThreshold: options.responseTimeThreshold || 2000, // ms
      errorRateThreshold: options.errorRateThreshold || 5, // Percentage
      ...options
    };

    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        errors: []
      },
      response_times: [],
      throughput: {
        tps: 0,
        peak_tps: 0
      },
      resources: {
        memory_usage: [],
        cpu_usage: [],
        db_connections: []
      },
      cache: {
        hits: 0,
        misses: 0,
        hit_ratio: 0
      },
      timestamps: {
        start: null,
        end: null,
        duration: 0
      }
    };

    this.workers = [];
    this.isRunning = false;
    this.monitoringInterval = null;
  }

  // ==================== MAIN TEST ORCHESTRATION ====================

  async runLoadTest(testScenarios) {
    console.log('Starting comprehensive load test...');
    this.metrics.timestamps.start = Date.now();
    this.isRunning = true;

    try {
      // Start system monitoring
      this.startSystemMonitoring();

      // Initialize test environment
      await this.initializeTestEnvironment();

      // Run test scenarios in parallel
      const testPromises = testScenarios.map(scenario => 
        this.executeScenario(scenario)
      );

      // Wait for all scenarios to complete or timeout
      const results = await Promise.allSettled(testPromises);

      // Stop monitoring
      this.stopSystemMonitoring();

      this.metrics.timestamps.end = Date.now();
      this.metrics.timestamps.duration = this.metrics.timestamps.end - this.metrics.timestamps.start;

      // Generate comprehensive report
      const report = await this.generatePerformanceReport(results);

      return report;
    } catch (error) {
      console.error('Load test failed:', error);
      throw error;
    } finally {
      this.isRunning = false;
      await this.cleanup();
    }
  }

  async executeScenario(scenario) {
    const {
      name,
      weight = 1,
      userCount = 10,
      duration = this.options.testDuration,
      operations = []
    } = scenario;

    console.log(`Executing scenario: ${name} with ${userCount} users`);

    const scenarioMetrics = {
      name,
      requests: { total: 0, successful: 0, failed: 0 },
      response_times: [],
      errors: [],
      start_time: Date.now()
    };

    // Create worker pool for this scenario
    const workers = [];
    const usersPerWorker = Math.ceil(userCount / os.cpus().length);

    for (let i = 0; i < Math.min(userCount, os.cpus().length); i++) {
      const worker = new Worker(__filename, {
        workerData: {
          scenario: {
            ...scenario,
            userCount: Math.min(usersPerWorker, userCount - (i * usersPerWorker))
          },
          options: this.options
        }
      });

      worker.on('message', (message) => {
        this.handleWorkerMessage(message, scenarioMetrics);
      });

      worker.on('error', (error) => {
        console.error(`Worker error in scenario ${name}:`, error);
        scenarioMetrics.errors.push(error);
      });

      workers.push(worker);
    }

    // Wait for scenario completion
    return new Promise((resolve) => {
      setTimeout(() => {
        // Terminate workers
        workers.forEach(worker => worker.terminate());
        
        scenarioMetrics.end_time = Date.now();
        scenarioMetrics.duration = scenarioMetrics.end_time - scenarioMetrics.start_time;
        
        resolve(scenarioMetrics);
      }, duration);
    });
  }

  handleWorkerMessage(message, scenarioMetrics) {
    const { type, data } = message;

    switch (type) {
      case 'request_completed':
        scenarioMetrics.requests.total++;
        this.metrics.requests.total++;
        
        if (data.success) {
          scenarioMetrics.requests.successful++;
          this.metrics.requests.successful++;
        } else {
          scenarioMetrics.requests.failed++;
          this.metrics.requests.failed++;
          scenarioMetrics.errors.push(data.error);
          this.metrics.requests.errors.push(data.error);
        }

        scenarioMetrics.response_times.push(data.response_time);
        this.metrics.response_times.push(data.response_time);
        break;

      case 'cache_stats':
        this.metrics.cache.hits += data.hits;
        this.metrics.cache.misses += data.misses;
        break;

      case 'worker_error':
        scenarioMetrics.errors.push(data);
        break;
    }

    // Emit real-time metrics
    this.emit('metrics_update', {
      scenario: scenarioMetrics.name,
      total_requests: this.metrics.requests.total,
      success_rate: (this.metrics.requests.successful / this.metrics.requests.total) * 100,
      avg_response_time: this.calculateAverage(this.metrics.response_times)
    });
  }

  // ==================== WORKER THREAD LOGIC ====================

  static async runWorkerScenario(scenario, options) {
    const { name, userCount, operations, duration } = scenario;
    const startTime = Date.now();
    const endTime = startTime + duration;

    // Simulate multiple concurrent users
    const userPromises = [];
    for (let userId = 0; userId < userCount; userId++) {
      userPromises.push(this.simulateUser(userId, operations, endTime, options));
    }

    await Promise.all(userPromises);
  }

  static async simulateUser(userId, operations, endTime, options) {
    while (Date.now() < endTime) {
      for (const operation of operations) {
        if (Date.now() >= endTime) break;

        const requestStart = performance.now();
        try {
          await this.executeOperation(operation, userId);
          const responseTime = performance.now() - requestStart;

          parentPort.postMessage({
            type: 'request_completed',
            data: {
              success: true,
              response_time: responseTime,
              operation: operation.name,
              user_id: userId
            }
          });
        } catch (error) {
          const responseTime = performance.now() - requestStart;

          parentPort.postMessage({
            type: 'request_completed',
            data: {
              success: false,
              response_time: responseTime,
              error: error.message,
              operation: operation.name,
              user_id: userId
            }
          });
        }

        // Add realistic delay between operations
        if (operation.delay) {
          await this.sleep(operation.delay);
        }
      }

      // Random delay between operation cycles
      await this.sleep(Math.random() * 1000);
    }
  }

  static async executeOperation(operation, userId) {
    const { type, config } = operation;

    switch (type) {
      case 'api_call':
        return await this.performApiCall(config, userId);
      
      case 'database_query':
        return await this.performDatabaseQuery(config, userId);
      
      case 'cache_operation':
        return await this.performCacheOperation(config, userId);
      
      case 'file_upload':
        return await this.performFileUpload(config, userId);
      
      case 'analytics_query':
        return await this.performAnalyticsQuery(config, userId);
      
      default:
        throw new Error(`Unknown operation type: ${type}`);
    }
  }

  static async performApiCall(config, userId) {
    const { endpoint, method = 'GET', data, headers } = config;
    
    // Simulate API call
    const response = await fetch(`http://localhost:4000${endpoint}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': `LoadTest-User-${userId}`,
        ...headers
      },
      body: data ? JSON.stringify(data) : undefined
    });

    if (!response.ok) {
      throw new Error(`API call failed: ${response.status} ${response.statusText}`);
    }

    return await response.json();
  }

  static async performDatabaseQuery(config, userId) {
    const { query, params } = config;
    
    // Execute database query
    const result = await db.execute(query, params);
    return result;
  }

  static async performCacheOperation(config, userId) {
    const { operation, key, value } = config;
    
    switch (operation) {
      case 'get':
        const result = await analyticsCache.get(`${key}_${userId}`);
        parentPort.postMessage({
          type: 'cache_stats',
          data: { hits: result ? 1 : 0, misses: result ? 0 : 1 }
        });
        return result;
      
      case 'set':
        return await analyticsCache.set(`${key}_${userId}`, value || `test_value_${Date.now()}`);
      
      case 'delete':
        return await analyticsCache.del(`${key}_${userId}`);
      
      default:
        throw new Error(`Unknown cache operation: ${operation}`);
    }
  }

  static async performFileUpload(config, userId) {
    const { size = 1024, filename } = config;
    
    // Simulate file upload by creating buffer
    const buffer = Buffer.alloc(size);
    buffer.fill(`test_data_user_${userId}`);
    
    // Simulate processing time
    await this.sleep(Math.random() * 100);
    
    return { uploaded: true, size, filename: filename || `test_file_${userId}.txt` };
  }

  static async performAnalyticsQuery(config, userId) {
    const { queryType, params } = config;
    
    // Simulate complex analytics query
    await this.sleep(Math.random() * 500); // Simulate processing time
    
    return {
      queryType,
      userId,
      result: `analytics_result_${Date.now()}`,
      params
    };
  }

  static async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ==================== SYSTEM MONITORING ====================

  startSystemMonitoring() {
    this.monitoringInterval = setInterval(async () => {
      const memUsage = process.memoryUsage();
      const cpuUsage = process.cpuUsage();
      
      this.metrics.resources.memory_usage.push({
        timestamp: Date.now(),
        rss: memUsage.rss / 1024 / 1024, // MB
        heapUsed: memUsage.heapUsed / 1024 / 1024, // MB
        heapTotal: memUsage.heapTotal / 1024 / 1024, // MB
        external: memUsage.external / 1024 / 1024 // MB
      });

      // Calculate CPU percentage (simplified)
      const cpuPercent = (cpuUsage.user + cpuUsage.system) / 1000000; // Convert to seconds
      this.metrics.resources.cpu_usage.push({
        timestamp: Date.now(),
        percent: cpuPercent
      });

      // Monitor database connections (if available)
      try {
        // This would need to be implemented based on your database driver
        // const dbStats = await db.getConnectionStats();
        // this.metrics.resources.db_connections.push(dbStats);
      } catch (error) {
        // Ignore if not available
      }

      // Check thresholds and emit warnings
      this.checkPerformanceThresholds();
    }, 1000); // Monitor every second
  }

  stopSystemMonitoring() {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
  }

  checkPerformanceThresholds() {
    const latestMemory = this.metrics.resources.memory_usage.slice(-1)[0];
    const latestCpu = this.metrics.resources.cpu_usage.slice(-1)[0];

    if (latestMemory && latestMemory.rss > this.options.memoryThreshold) {
      this.emit('threshold_exceeded', {
        type: 'memory',
        value: latestMemory.rss,
        threshold: this.options.memoryThreshold
      });
    }

    if (latestCpu && latestCpu.percent > this.options.cpuThreshold) {
      this.emit('threshold_exceeded', {
        type: 'cpu',
        value: latestCpu.percent,
        threshold: this.options.cpuThreshold
      });
    }

    // Check response time threshold
    const recentResponseTimes = this.metrics.response_times.slice(-100); // Last 100 requests
    if (recentResponseTimes.length > 0) {
      const avgResponseTime = this.calculateAverage(recentResponseTimes);
      if (avgResponseTime > this.options.responseTimeThreshold) {
        this.emit('threshold_exceeded', {
          type: 'response_time',
          value: avgResponseTime,
          threshold: this.options.responseTimeThreshold
        });
      }
    }

    // Check error rate threshold
    if (this.metrics.requests.total > 0) {
      const errorRate = (this.metrics.requests.failed / this.metrics.requests.total) * 100;
      if (errorRate > this.options.errorRateThreshold) {
        this.emit('threshold_exceeded', {
          type: 'error_rate',
          value: errorRate,
          threshold: this.options.errorRateThreshold
        });
      }
    }
  }

  // ==================== REPORT GENERATION ====================

  async generatePerformanceReport(scenarioResults) {
    // Calculate overall statistics
    const totalRequests = this.metrics.requests.total;
    const successRate = totalRequests > 0 ? (this.metrics.requests.successful / totalRequests) * 100 : 0;
    const errorRate = totalRequests > 0 ? (this.metrics.requests.failed / totalRequests) * 100 : 0;
    
    const responseTimes = this.metrics.response_times;
    const avgResponseTime = this.calculateAverage(responseTimes);
    const medianResponseTime = this.calculateMedian(responseTimes);
    const p95ResponseTime = this.calculatePercentile(responseTimes, 95);
    const p99ResponseTime = this.calculatePercentile(responseTimes, 99);

    const duration = this.metrics.timestamps.duration / 1000; // Convert to seconds
    const throughput = totalRequests / duration;

    // Calculate cache statistics
    const totalCacheOperations = this.metrics.cache.hits + this.metrics.cache.misses;
    const cacheHitRatio = totalCacheOperations > 0 ? (this.metrics.cache.hits / totalCacheOperations) * 100 : 0;

    // Resource utilization summary
    const memoryStats = this.calculateResourceStats(this.metrics.resources.memory_usage, 'rss');
    const cpuStats = this.calculateResourceStats(this.metrics.resources.cpu_usage, 'percent');

    const report = {
      test_summary: {
        duration_seconds: duration,
        total_requests: totalRequests,
        successful_requests: this.metrics.requests.successful,
        failed_requests: this.metrics.requests.failed,
        success_rate_percent: successRate,
        error_rate_percent: errorRate,
        throughput_tps: throughput
      },
      response_times: {
        average_ms: avgResponseTime,
        median_ms: medianResponseTime,
        p95_ms: p95ResponseTime,
        p99_ms: p99ResponseTime,
        min_ms: Math.min(...responseTimes),
        max_ms: Math.max(...responseTimes)
      },
      cache_performance: {
        total_operations: totalCacheOperations,
        hits: this.metrics.cache.hits,
        misses: this.metrics.cache.misses,
        hit_ratio_percent: cacheHitRatio
      },
      resource_utilization: {
        memory: memoryStats,
        cpu: cpuStats
      },
      scenario_breakdown: scenarioResults.map(result => ({
        status: result.status,
        scenario: result.value || result.reason
      })),
      performance_thresholds: {
        memory_threshold_mb: this.options.memoryThreshold,
        cpu_threshold_percent: this.options.cpuThreshold,
        response_time_threshold_ms: this.options.responseTimeThreshold,
        error_rate_threshold_percent: this.options.errorRateThreshold
      },
      errors: this.metrics.requests.errors.slice(0, 10), // Top 10 errors
      recommendations: this.generatePerformanceRecommendations({
        successRate,
        errorRate,
        avgResponseTime,
        throughput,
        cacheHitRatio,
        memoryStats,
        cpuStats
      }),
      timestamp: new Date().toISOString()
    };

    return report;
  }

  generatePerformanceRecommendations(stats) {
    const recommendations = [];

    if (stats.successRate < 95) {
      recommendations.push({
        type: 'reliability',
        severity: 'high',
        message: `Success rate is ${stats.successRate.toFixed(1)}%. Investigate error causes and improve error handling.`
      });
    }

    if (stats.avgResponseTime > 2000) {
      recommendations.push({
        type: 'performance',
        severity: 'high',
        message: `Average response time is ${stats.avgResponseTime.toFixed(0)}ms. Consider optimizing database queries and adding caching.`
      });
    }

    if (stats.cacheHitRatio < 80) {
      recommendations.push({
        type: 'caching',
        severity: 'medium',
        message: `Cache hit ratio is ${stats.cacheHitRatio.toFixed(1)}%. Review caching strategy and increase cache TTL for stable data.`
      });
    }

    if (stats.throughput < this.options.targetTPS) {
      recommendations.push({
        type: 'scalability',
        severity: 'medium',
        message: `Throughput is ${stats.throughput.toFixed(1)} TPS, below target of ${this.options.targetTPS}. Consider horizontal scaling.`
      });
    }

    if (stats.memoryStats.max > this.options.memoryThreshold) {
      recommendations.push({
        type: 'resources',
        severity: 'high',
        message: `Peak memory usage of ${stats.memoryStats.max.toFixed(0)}MB exceeds threshold. Investigate memory leaks and optimize memory usage.`
      });
    }

    if (stats.cpuStats.max > this.options.cpuThreshold) {
      recommendations.push({
        type: 'resources',
        severity: 'high',
        message: `Peak CPU usage of ${stats.cpuStats.max.toFixed(1)}% exceeds threshold. Optimize CPU-intensive operations.`
      });
    }

    return recommendations;
  }

  // ==================== UTILITY METHODS ====================

  calculateAverage(array) {
    return array.length > 0 ? array.reduce((sum, val) => sum + val, 0) / array.length : 0;
  }

  calculateMedian(array) {
    if (array.length === 0) return 0;
    const sorted = [...array].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
  }

  calculatePercentile(array, percentile) {
    if (array.length === 0) return 0;
    const sorted = [...array].sort((a, b) => a - b);
    const index = Math.ceil((percentile / 100) * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  }

  calculateResourceStats(resourceArray, field) {
    if (resourceArray.length === 0) return { min: 0, max: 0, average: 0 };
    
    const values = resourceArray.map(item => item[field]);
    return {
      min: Math.min(...values),
      max: Math.max(...values),
      average: this.calculateAverage(values)
    };
  }

  async initializeTestEnvironment() {
    // Clear any existing test data
    // Initialize caches
    if (analyticsCache) {
      await analyticsCache.flushAll();
    }
    
    console.log('Test environment initialized');
  }

  async cleanup() {
    // Terminate all workers
    this.workers.forEach(worker => worker.terminate());
    this.workers = [];
    
    // Clean up test data
    console.log('Load test cleanup completed');
  }
}

// Worker thread execution
if (!isMainThread) {
  const { scenario, options } = workerData;
  LoadTestFramework.runWorkerScenario(scenario, options).catch(error => {
    parentPort.postMessage({
      type: 'worker_error',
      data: error.message
    });
  });
}

export { LoadTestFramework };
export default LoadTestFramework;