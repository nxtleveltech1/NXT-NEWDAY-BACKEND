#!/usr/bin/env node

/**
 * LOAD TESTING SCRIPT
 * Comprehensive load testing to validate 1000+ concurrent user capacity
 * Target: nxtdotx.co.za performance validation
 */

import http from 'http';
import https from 'https';
import { performance } from 'perf_hooks';
import { Worker } from 'worker_threads';
import { cpus } from 'os';
import { EventEmitter } from 'events';
import dotenv from 'dotenv';

dotenv.config();

// Load test configuration
const config = {
  baseUrl: process.env.LOAD_TEST_URL || 'http://localhost:4000',
  maxConcurrentUsers: parseInt(process.env.MAX_CONCURRENT_USERS) || 1000,
  testDuration: parseInt(process.env.TEST_DURATION) || 300, // 5 minutes
  rampUpTime: parseInt(process.env.RAMP_UP_TIME) || 60, // 1 minute
  endpoints: [
    { path: '/health', weight: 10, method: 'GET' },
    { path: '/metrics', weight: 5, method: 'GET' },
    { path: '/api/fast-query', weight: 20, method: 'GET' },
    { path: '/api/cached-data', weight: 15, method: 'GET' },
    { path: '/api/load-test', weight: 50, method: 'GET' }
  ],
  workers: Math.min(cpus().length, 8),
  reportInterval: 10000 // 10 seconds
};

// Test metrics
const metrics = {
  startTime: 0,
  endTime: 0,
  totalRequests: 0,
  successfulRequests: 0,
  failedRequests: 0,
  responseTimes: [],
  errorTypes: new Map(),
  statusCodes: new Map(),
  concurrentUsers: 0,
  maxConcurrentUsers: 0,
  throughput: 0,
  
  // Performance thresholds
  thresholds: {
    avgResponseTime: 500, // ms
    p95ResponseTime: 1000, // ms
    p99ResponseTime: 2000, // ms
    errorRate: 5, // percentage
    minThroughput: 100 // requests per second
  }
};

// Event emitter for test coordination
const testEmitter = new EventEmitter();
testEmitter.setMaxListeners(0);

/**
 * HTTP request with timeout and retry
 */
function makeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https://');
    const httpModule = isHttps ? https : http;
    
    const requestOptions = {
      timeout: 10000, // 10 second timeout
      headers: {
        'User-Agent': 'LoadTest/1.0',
        'Accept': 'application/json',
        'Connection': 'keep-alive',
        ...options.headers
      },
      ...options
    };
    
    const startTime = performance.now();
    
    const req = httpModule.request(url, requestOptions, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        const endTime = performance.now();
        const responseTime = endTime - startTime;
        
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          data: data,
          responseTime: responseTime,
          success: res.statusCode >= 200 && res.statusCode < 400
        });
      });
    });
    
    req.on('error', (error) => {
      const endTime = performance.now();
      const responseTime = endTime - startTime;
      
      reject({
        error: error.message,
        responseTime: responseTime,
        success: false
      });
    });
    
    req.on('timeout', () => {
      req.destroy();
      const endTime = performance.now();
      const responseTime = endTime - startTime;
      
      reject({
        error: 'Request timeout',
        responseTime: responseTime,
        success: false
      });
    });
    
    req.end();
  });
}

/**
 * Weighted random endpoint selection
 */
function selectEndpoint() {
  const totalWeight = config.endpoints.reduce((sum, endpoint) => sum + endpoint.weight, 0);
  let random = Math.random() * totalWeight;
  
  for (const endpoint of config.endpoints) {
    random -= endpoint.weight;
    if (random <= 0) {
      return endpoint;
    }
  }
  
  return config.endpoints[0]; // Fallback
}

/**
 * Single user simulation
 */
async function simulateUser(userId, duration) {
  const endTime = Date.now() + duration * 1000;
  let requestCount = 0;
  
  try {
    while (Date.now() < endTime) {
      const endpoint = selectEndpoint();
      const url = `${config.baseUrl}${endpoint.path}`;
      
      try {
        metrics.concurrentUsers++;
        if (metrics.concurrentUsers > metrics.maxConcurrentUsers) {
          metrics.maxConcurrentUsers = metrics.concurrentUsers;
        }
        
        const result = await makeRequest(url, { method: endpoint.method });
        
        // Record metrics
        metrics.totalRequests++;
        if (result.success) {
          metrics.successfulRequests++;
        } else {
          metrics.failedRequests++;
        }
        
        metrics.responseTimes.push(result.responseTime);
        
        // Track status codes
        const statusCode = result.statusCode || 'error';
        metrics.statusCodes.set(statusCode, (metrics.statusCodes.get(statusCode) || 0) + 1);
        
        requestCount++;
        
        // Small delay between requests (1-3 seconds)
        await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
        
      } catch (error) {
        metrics.totalRequests++;
        metrics.failedRequests++;
        
        // Track error types
        const errorType = error.error || 'unknown';
        metrics.errorTypes.set(errorType, (metrics.errorTypes.get(errorType) || 0) + 1);
        
        if (error.responseTime) {
          metrics.responseTimes.push(error.responseTime);
        }
        
        // Exponential backoff on errors
        await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
      } finally {
        metrics.concurrentUsers--;
      }
    }
    
    testEmitter.emit('userComplete', { userId, requestCount });
    
  } catch (error) {
    console.error(`User ${userId} simulation failed:`, error);
    testEmitter.emit('userError', { userId, error: error.message });
  }
}

/**
 * Worker thread for user simulation
 */
function createWorker(userIds, duration) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(`
      const { parentPort, workerData } = require('worker_threads');
      const http = require('http');
      const https = require('https');
      const { performance } = require('perf_hooks');
      
      const { userIds, duration, baseUrl, endpoints } = workerData;
      
      function makeRequest(url, options = {}) {
        return new Promise((resolve, reject) => {
          const isHttps = url.startsWith('https://');
          const httpModule = isHttps ? https : http;
          
          const requestOptions = {
            timeout: 10000,
            headers: {
              'User-Agent': 'LoadTest/1.0',
              'Accept': 'application/json',
              'Connection': 'keep-alive',
              ...options.headers
            },
            ...options
          };
          
          const startTime = performance.now();
          
          const req = httpModule.request(url, requestOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
              const responseTime = performance.now() - startTime;
              resolve({
                statusCode: res.statusCode,
                responseTime: responseTime,
                success: res.statusCode >= 200 && res.statusCode < 400
              });
            });
          });
          
          req.on('error', (error) => {
            const responseTime = performance.now() - startTime;
            reject({
              error: error.message,
              responseTime: responseTime,
              success: false
            });
          });
          
          req.on('timeout', () => {
            req.destroy();
            const responseTime = performance.now() - startTime;
            reject({
              error: 'Request timeout',
              responseTime: responseTime,
              success: false
            });
          });
          
          req.end();
        });
      }
      
      function selectEndpoint() {
        const totalWeight = endpoints.reduce((sum, endpoint) => sum + endpoint.weight, 0);
        let random = Math.random() * totalWeight;
        
        for (const endpoint of endpoints) {
          random -= endpoint.weight;
          if (random <= 0) {
            return endpoint;
          }
        }
        
        return endpoints[0];
      }
      
      async function simulateUsers() {
        const results = {
          totalRequests: 0,
          successfulRequests: 0,
          failedRequests: 0,
          responseTimes: [],
          errorTypes: {},
          statusCodes: {}
        };
        
        const endTime = Date.now() + duration * 1000;
        const userPromises = userIds.map(async (userId) => {
          let requestCount = 0;
          
          while (Date.now() < endTime) {
            const endpoint = selectEndpoint();
            const url = baseUrl + endpoint.path;
            
            try {
              const result = await makeRequest(url, { method: endpoint.method });
              
              results.totalRequests++;
              if (result.success) {
                results.successfulRequests++;
              } else {
                results.failedRequests++;
              }
              
              results.responseTimes.push(result.responseTime);
              
              const statusCode = result.statusCode || 'error';
              results.statusCodes[statusCode] = (results.statusCodes[statusCode] || 0) + 1;
              
              requestCount++;
              
              // Small delay
              await new Promise(resolve => setTimeout(resolve, 1000 + Math.random() * 2000));
              
            } catch (error) {
              results.totalRequests++;
              results.failedRequests++;
              
              const errorType = error.error || 'unknown';
              results.errorTypes[errorType] = (results.errorTypes[errorType] || 0) + 1;
              
              if (error.responseTime) {
                results.responseTimes.push(error.responseTime);
              }
              
              await new Promise(resolve => setTimeout(resolve, 2000 + Math.random() * 3000));
            }
          }
          
          return { userId, requestCount };
        });
        
        await Promise.all(userPromises);
        return results;
      }
      
      simulateUsers().then(results => {
        parentPort.postMessage({ success: true, results });
      }).catch(error => {
        parentPort.postMessage({ success: false, error: error.message });
      });
    `, {
      eval: true,
      workerData: {
        userIds,
        duration,
        baseUrl: config.baseUrl,
        endpoints: config.endpoints
      }
    });
    
    worker.on('message', (message) => {
      if (message.success) {
        resolve(message.results);
      } else {
        reject(new Error(message.error));
      }
    });
    
    worker.on('error', reject);
  });
}

/**
 * Ramp up users gradually
 */
async function rampUpUsers(maxUsers, rampUpTime) {
  console.log(`🚀 Ramping up to ${maxUsers} users over ${rampUpTime} seconds...`);
  
  const usersPerSecond = maxUsers / rampUpTime;
  const workers = [];
  const usersPerWorker = Math.ceil(maxUsers / config.workers);
  
  for (let workerIndex = 0; workerIndex < config.workers; workerIndex++) {
    const startUserId = workerIndex * usersPerWorker;
    const endUserId = Math.min(startUserId + usersPerWorker, maxUsers);
    const userIds = Array.from({ length: endUserId - startUserId }, (_, i) => startUserId + i);
    
    if (userIds.length > 0) {
      // Stagger worker starts
      setTimeout(() => {
        const workerPromise = createWorker(userIds, config.testDuration);
        workers.push(workerPromise);
        
        workerPromise.then(results => {
          // Merge results into main metrics
          metrics.totalRequests += results.totalRequests;
          metrics.successfulRequests += results.successfulRequests;
          metrics.failedRequests += results.failedRequests;
          metrics.responseTimes.push(...results.responseTimes);
          
          // Merge error types
          for (const [errorType, count] of Object.entries(results.errorTypes)) {
            metrics.errorTypes.set(errorType, (metrics.errorTypes.get(errorType) || 0) + count);
          }
          
          // Merge status codes
          for (const [statusCode, count] of Object.entries(results.statusCodes)) {
            metrics.statusCodes.set(statusCode, (metrics.statusCodes.get(statusCode) || 0) + count);
          }
          
        }).catch(error => {
          console.error(`Worker ${workerIndex} failed:`, error);
        });
        
      }, (workerIndex * rampUpTime * 1000) / config.workers);
    }
  }
  
  return workers;
}

/**
 * Calculate performance statistics
 */
function calculateStats() {
  if (metrics.responseTimes.length === 0) {
    return {
      avgResponseTime: 0,
      minResponseTime: 0,
      maxResponseTime: 0,
      p50ResponseTime: 0,
      p95ResponseTime: 0,
      p99ResponseTime: 0
    };
  }
  
  const sortedTimes = [...metrics.responseTimes].sort((a, b) => a - b);
  const count = sortedTimes.length;
  
  const sum = sortedTimes.reduce((a, b) => a + b, 0);
  const avgResponseTime = sum / count;
  
  const minResponseTime = sortedTimes[0];
  const maxResponseTime = sortedTimes[count - 1];
  const p50ResponseTime = sortedTimes[Math.floor(count * 0.5)];
  const p95ResponseTime = sortedTimes[Math.floor(count * 0.95)];
  const p99ResponseTime = sortedTimes[Math.floor(count * 0.99)];
  
  return {
    avgResponseTime,
    minResponseTime,
    maxResponseTime,
    p50ResponseTime,
    p95ResponseTime,
    p99ResponseTime
  };
}

/**
 * Generate detailed report
 */
function generateReport() {
  const duration = (metrics.endTime - metrics.startTime) / 1000;
  const stats = calculateStats();
  const errorRate = (metrics.failedRequests / metrics.totalRequests) * 100;
  const throughput = metrics.totalRequests / duration;
  
  const report = {
    timestamp: new Date().toISOString(),
    test_configuration: {
      target_url: config.baseUrl,
      max_concurrent_users: config.maxConcurrentUsers,
      test_duration: config.testDuration,
      ramp_up_time: config.rampUpTime,
      worker_threads: config.workers
    },
    results: {
      duration_seconds: Math.round(duration),
      total_requests: metrics.totalRequests,
      successful_requests: metrics.successfulRequests,
      failed_requests: metrics.failedRequests,
      error_rate_percentage: Math.round(errorRate * 100) / 100,
      max_concurrent_users: metrics.maxConcurrentUsers,
      throughput_rps: Math.round(throughput * 100) / 100
    },
    performance: {
      average_response_time_ms: Math.round(stats.avgResponseTime),
      min_response_time_ms: Math.round(stats.minResponseTime),
      max_response_time_ms: Math.round(stats.maxResponseTime),
      p50_response_time_ms: Math.round(stats.p50ResponseTime),
      p95_response_time_ms: Math.round(stats.p95ResponseTime),
      p99_response_time_ms: Math.round(stats.p99ResponseTime)
    },
    thresholds: {
      average_response_time: {
        threshold: metrics.thresholds.avgResponseTime,
        actual: Math.round(stats.avgResponseTime),
        passed: stats.avgResponseTime <= metrics.thresholds.avgResponseTime
      },
      p95_response_time: {
        threshold: metrics.thresholds.p95ResponseTime,
        actual: Math.round(stats.p95ResponseTime),
        passed: stats.p95ResponseTime <= metrics.thresholds.p95ResponseTime
      },
      p99_response_time: {
        threshold: metrics.thresholds.p99ResponseTime,
        actual: Math.round(stats.p99ResponseTime),
        passed: stats.p99ResponseTime <= metrics.thresholds.p99ResponseTime
      },
      error_rate: {
        threshold: metrics.thresholds.errorRate,
        actual: Math.round(errorRate * 100) / 100,
        passed: errorRate <= metrics.thresholds.errorRate
      },
      throughput: {
        threshold: metrics.thresholds.minThroughput,
        actual: Math.round(throughput * 100) / 100,
        passed: throughput >= metrics.thresholds.minThroughput
      }
    },
    status_codes: Object.fromEntries(metrics.statusCodes),
    error_types: Object.fromEntries(metrics.errorTypes)
  };
  
  // Calculate overall pass/fail
  const thresholdsPassed = Object.values(report.thresholds).filter(t => t.passed).length;
  const totalThresholds = Object.keys(report.thresholds).length;
  report.overall_result = {
    passed: thresholdsPassed === totalThresholds,
    score: `${thresholdsPassed}/${totalThresholds}`,
    grade: thresholdsPassed === totalThresholds ? 'PASS' : 
           thresholdsPassed >= totalThresholds * 0.8 ? 'MARGINAL' : 'FAIL'
  };
  
  return report;
}

/**
 * Print progress during test
 */
function printProgress() {
  const duration = (Date.now() - metrics.startTime) / 1000;
  const stats = calculateStats();
  const errorRate = metrics.totalRequests > 0 ? (metrics.failedRequests / metrics.totalRequests) * 100 : 0;
  const throughput = duration > 0 ? metrics.totalRequests / duration : 0;
  
  console.log(`📊 Progress: ${Math.round(duration)}s | Requests: ${metrics.totalRequests} | RPS: ${Math.round(throughput)} | Avg RT: ${Math.round(stats.avgResponseTime)}ms | Errors: ${Math.round(errorRate * 100) / 100}% | Concurrent: ${metrics.concurrentUsers}`);
}

/**
 * Warm up test
 */
async function warmUpTest() {
  console.log('🔥 Warming up server...');
  
  const warmupRequests = 10;
  const warmupPromises = [];
  
  for (let i = 0; i < warmupRequests; i++) {
    const endpoint = selectEndpoint();
    const url = `${config.baseUrl}${endpoint.path}`;
    warmupPromises.push(
      makeRequest(url, { method: endpoint.method }).catch(() => {})
    );
  }
  
  await Promise.all(warmupPromises);
  console.log('✅ Warmup completed');
}

/**
 * Main load test execution
 */
async function runLoadTest() {
  console.log('🚀 LOAD TEST STARTING');
  console.log('====================');
  console.log(`Target: ${config.baseUrl}`);
  console.log(`Max Concurrent Users: ${config.maxConcurrentUsers}`);
  console.log(`Test Duration: ${config.testDuration} seconds`);
  console.log(`Ramp Up Time: ${config.rampUpTime} seconds`);
  console.log(`Worker Threads: ${config.workers}`);
  console.log('====================\n');
  
  try {
    // Warm up
    await warmUpTest();
    
    // Start metrics
    metrics.startTime = Date.now();
    
    // Progress reporting
    const progressInterval = setInterval(printProgress, config.reportInterval);
    
    // Ramp up users
    const workers = await rampUpUsers(config.maxConcurrentUsers, config.rampUpTime);
    
    // Wait for all workers to complete
    console.log('⏳ Waiting for test completion...');
    await Promise.all(workers);
    
    // Stop progress reporting
    clearInterval(progressInterval);
    
    // Final metrics
    metrics.endTime = Date.now();
    
    // Generate and display report
    const report = generateReport();
    
    console.log('\n📋 LOAD TEST RESULTS');
    console.log('====================');
    console.log(`Duration: ${report.results.duration_seconds} seconds`);
    console.log(`Total Requests: ${report.results.total_requests}`);
    console.log(`Successful: ${report.results.successful_requests}`);
    console.log(`Failed: ${report.results.failed_requests}`);
    console.log(`Error Rate: ${report.results.error_rate_percentage}%`);
    console.log(`Max Concurrent Users: ${report.results.max_concurrent_users}`);
    console.log(`Throughput: ${report.results.throughput_rps} RPS`);
    console.log('');
    console.log('Response Times:');
    console.log(`  Average: ${report.performance.average_response_time_ms}ms`);
    console.log(`  Min: ${report.performance.min_response_time_ms}ms`);
    console.log(`  Max: ${report.performance.max_response_time_ms}ms`);
    console.log(`  P95: ${report.performance.p95_response_time_ms}ms`);
    console.log(`  P99: ${report.performance.p99_response_time_ms}ms`);
    console.log('');
    console.log('Threshold Results:');
    for (const [name, threshold] of Object.entries(report.thresholds)) {
      const status = threshold.passed ? '✅' : '❌';
      console.log(`  ${status} ${name}: ${threshold.actual} (threshold: ${threshold.threshold})`);
    }
    console.log('');
    console.log(`Overall Result: ${report.overall_result.grade} (${report.overall_result.score})`);
    console.log('====================\n');
    
    // Save report
    try {
      const fs = await import('fs/promises');
      const reportPath = `load-test-report-${Date.now()}.json`;
      await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
      console.log(`📄 Report saved to: ${reportPath}`);
    } catch (error) {
      console.warn('⚠️ Could not save report:', error.message);
    }
    
    // Exit with appropriate code
    process.exit(report.overall_result.passed ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Load test failed:', error);
    process.exit(1);
  }
}

// Handle process termination
process.on('SIGINT', () => {
  console.log('\n⚠️ Load test interrupted');
  metrics.endTime = Date.now();
  const report = generateReport();
  console.log('📊 Partial results:', report.results);
  process.exit(1);
});

// Run the load test
if (import.meta.url === `file://${process.argv[1]}`) {
  runLoadTest();
}

export default {
  runLoadTest,
  config,
  metrics
};