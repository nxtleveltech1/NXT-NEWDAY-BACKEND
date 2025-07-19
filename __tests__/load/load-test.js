#!/usr/bin/env node

/**
 * Load Testing Suite for NXT Backend API
 * Tests production-grade performance under simulated traffic
 */

import autocannon from 'autocannon';
import { performance } from 'perf_hooks';
import fs from 'fs/promises';
import path from 'path';

class LoadTestSuite {
  constructor() {
    this.baseUrl = process.env.API_BASE_URL || 'http://localhost:4000';
    this.results = [];
    this.authToken = null;
  }

  /**
   * Initialize load testing environment
   */
  async initialize() {
    console.log('🚀 Initializing Load Test Suite');
    console.log('================================');
    console.log(`Target: ${this.baseUrl}`);
    
    // Get auth token for authenticated endpoints
    try {
      // In production, you would implement proper token retrieval
      // For testing, we'll use a mock token or skip auth-required tests
      this.authToken = process.env.TEST_AUTH_TOKEN || null;
      
      if (!this.authToken) {
        console.log('⚠️  No auth token provided - skipping authenticated endpoint tests');
      }
      
      console.log('✅ Load test environment initialized');
    } catch (error) {
      console.error('❌ Failed to initialize load test environment:', error.message);
      throw error;
    }
  }

  /**
   * Run load test with autocannon
   */
  async runLoadTest(config) {
    const {
      name,
      url,
      method = 'GET',
      headers = {},
      body = null,
      connections = 50,
      duration = 30,
      pipelining = 1,
      expectedResponseTime = 2000,
      expectedSuccessRate = 95
    } = config;

    console.log(`\n🧪 Running Load Test: ${name}`);
    console.log(`   URL: ${method} ${url}`);
    console.log(`   Connections: ${connections}, Duration: ${duration}s`);

    const startTime = performance.now();

    try {
      const result = await autocannon({
        url: `${this.baseUrl}${url}`,
        method,
        headers: {
          'Content-Type': 'application/json',
          ...(this.authToken && { 'Authorization': `Bearer ${this.authToken}` }),
          ...headers
        },
        body: body ? JSON.stringify(body) : undefined,
        connections,
        duration,
        pipelining,
        timeout: 30,
        bailout: 5000, // Bail out if we get 5000 errors
        workers: 1
      });

      const endTime = performance.now();
      const testDuration = endTime - startTime;

      // Calculate metrics
      const avgResponseTime = result.latency.mean;
      const p95ResponseTime = result.latency.p95;
      const p99ResponseTime = result.latency.p99;
      const successRate = ((result.requests.total - result.errors) / result.requests.total) * 100;
      const rps = result.requests.average;

      // Determine test result
      const passedResponseTime = avgResponseTime <= expectedResponseTime;
      const passedSuccessRate = successRate >= expectedSuccessRate;
      const passed = passedResponseTime && passedSuccessRate;

      const testResult = {
        name,
        url,
        method,
        passed,
        testDuration: Math.round(testDuration),
        metrics: {
          totalRequests: result.requests.total,
          requestsPerSecond: rps,
          avgResponseTime: Math.round(avgResponseTime),
          p95ResponseTime: Math.round(p95ResponseTime),
          p99ResponseTime: Math.round(p99ResponseTime),
          successRate: parseFloat(successRate.toFixed(2)),
          errors: result.errors,
          timeouts: result.timeouts,
          throughput: {
            bytes: result.throughput.total,
            bytesPerSecond: result.throughput.average
          }
        },
        thresholds: {
          expectedResponseTime,
          expectedSuccessRate,
          passedResponseTime,
          passedSuccessRate
        },
        raw: result
      };

      this.results.push(testResult);

      // Display results
      console.log(`   ✅ Completed in ${Math.round(testDuration)}ms`);
      console.log(`   📊 Results:`);
      console.log(`      Total Requests: ${result.requests.total}`);
      console.log(`      Requests/sec: ${rps.toFixed(2)}`);
      console.log(`      Avg Response Time: ${Math.round(avgResponseTime)}ms ${passedResponseTime ? '✅' : '❌'}`);
      console.log(`      95th Percentile: ${Math.round(p95ResponseTime)}ms`);
      console.log(`      99th Percentile: ${Math.round(p99ResponseTime)}ms`);
      console.log(`      Success Rate: ${successRate.toFixed(2)}% ${passedSuccessRate ? '✅' : '❌'}`);
      console.log(`      Errors: ${result.errors}`);
      console.log(`      Status: ${passed ? '✅ PASSED' : '❌ FAILED'}`);

      return testResult;
    } catch (error) {
      console.error(`❌ Load test failed: ${error.message}`);
      
      const failedResult = {
        name,
        url,
        method,
        passed: false,
        error: error.message,
        testDuration: performance.now() - startTime
      };
      
      this.results.push(failedResult);
      return failedResult;
    }
  }

  /**
   * Test suite for API endpoints
   */
  async runApiLoadTests() {
    console.log('\n📡 API Load Tests');
    console.log('==================');

    const tests = [
      // Health check - baseline test
      {
        name: 'Health Check',
        url: '/health',
        method: 'GET',
        connections: 100,
        duration: 30,
        expectedResponseTime: 100,
        expectedSuccessRate: 99
      },

      // Inventory endpoints
      {
        name: 'Inventory List',
        url: '/api/inventory?limit=50',
        method: 'GET',
        connections: 50,
        duration: 60,
        expectedResponseTime: 500,
        expectedSuccessRate: 95
      },

      {
        name: 'Inventory Analytics',
        url: '/api/inventory/analytics',
        method: 'GET',
        connections: 20,
        duration: 60,
        expectedResponseTime: 2000,
        expectedSuccessRate: 95
      },

      {
        name: 'Inventory Movements',
        url: '/api/inventory/movements?limit=100',
        method: 'GET',
        connections: 30,
        duration: 45,
        expectedResponseTime: 1000,
        expectedSuccessRate: 95
      },

      {
        name: 'Reorder Suggestions',
        url: '/api/inventory/reorder',
        method: 'GET',
        connections: 25,
        duration: 30,
        expectedResponseTime: 1500,
        expectedSuccessRate: 95
      },

      // Analytics endpoints (higher response time tolerance)
      {
        name: 'Analytics - Inventory Turnover',
        url: '/api/analytics/inventory/turnover',
        method: 'GET',
        connections: 10,
        duration: 45,
        expectedResponseTime: 2000,
        expectedSuccessRate: 90
      },

      {
        name: 'Analytics - Inventory Optimization',
        url: '/api/analytics/inventory/optimization',
        method: 'GET',
        connections: 8,
        duration: 60,
        expectedResponseTime: 3000,
        expectedSuccessRate: 90
      },

      {
        name: 'Analytics - Inventory Alerts',
        url: '/api/analytics/inventory/alerts',
        method: 'GET',
        connections: 15,
        duration: 30,
        expectedResponseTime: 1500,
        expectedSuccessRate: 95
      }
    ];

    // Only run authenticated tests if we have a token
    if (this.authToken) {
      tests.push(
        {
          name: 'Supplier Performance',
          url: '/api/suppliers?limit=25',
          method: 'GET',
          connections: 20,
          duration: 30,
          expectedResponseTime: 800,
          expectedSuccessRate: 95
        },
        {
          name: 'Customer Analytics',
          url: '/api/customers?limit=25',
          method: 'GET',
          connections: 20,
          duration: 30,
          expectedResponseTime: 800,
          expectedSuccessRate: 95
        }
      );
    }

    for (const test of tests) {
      await this.runLoadTest(test);
      
      // Small delay between tests to avoid overwhelming the server
      await new Promise(resolve => setTimeout(resolve, 2000));
    }
  }

  /**
   * Stress test with gradually increasing load
   */
  async runStressTest() {
    console.log('\n💪 Stress Test - Gradual Load Increase');
    console.log('=====================================');

    const baseEndpoint = '/api/inventory/analytics';
    const loadLevels = [
      { connections: 10, duration: 30, name: 'Low Load' },
      { connections: 25, duration: 30, name: 'Medium Load' },
      { connections: 50, duration: 30, name: 'High Load' },
      { connections: 100, duration: 30, name: 'Peak Load' },
      { connections: 200, duration: 30, name: 'Stress Load' }
    ];

    for (const level of loadLevels) {
      console.log(`\n🔥 ${level.name} - ${level.connections} connections`);
      
      const result = await this.runLoadTest({
        name: `Stress Test - ${level.name}`,
        url: baseEndpoint,
        method: 'GET',
        connections: level.connections,
        duration: level.duration,
        expectedResponseTime: 3000, // More lenient for stress test
        expectedSuccessRate: 85
      });

      // If error rate is too high, stop stress testing
      if (result.metrics && result.metrics.successRate < 50) {
        console.log('⚠️  High error rate detected, stopping stress test');
        break;
      }

      // Brief recovery period
      await new Promise(resolve => setTimeout(resolve, 5000));
    }
  }

  /**
   * Spike test - sudden load increase
   */
  async runSpikeTest() {
    console.log('\n⚡ Spike Test - Sudden Load Increase');
    console.log('===================================');

    // Normal load baseline
    await this.runLoadTest({
      name: 'Spike Test - Baseline',
      url: '/api/inventory?limit=25',
      method: 'GET',
      connections: 10,
      duration: 30,
      expectedResponseTime: 500,
      expectedSuccessRate: 95
    });

    // Brief pause
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Sudden spike
    await this.runLoadTest({
      name: 'Spike Test - Traffic Spike',
      url: '/api/inventory?limit=25',
      method: 'GET',
      connections: 200,
      duration: 60,
      expectedResponseTime: 2000, // More lenient during spike
      expectedSuccessRate: 80
    });

    // Recovery
    await new Promise(resolve => setTimeout(resolve, 5000));

    await this.runLoadTest({
      name: 'Spike Test - Recovery',
      url: '/api/inventory?limit=25',
      method: 'GET',
      connections: 10,
      duration: 30,
      expectedResponseTime: 500,
      expectedSuccessRate: 95
    });
  }

  /**
   * Generate comprehensive load test report
   */
  generateReport() {
    console.log('\n📊 LOAD TEST REPORT');
    console.log('===================');
    
    const passed = this.results.filter(r => r.passed).length;
    const total = this.results.length;
    const passRate = (passed / total * 100).toFixed(1);

    console.log(`Overall Results: ${passed}/${total} tests passed (${passRate}%)`);
    console.log('');

    // Summary table
    console.log('Test Summary:');
    console.log('-------------');
    this.results.forEach(result => {
      if (result.metrics) {
        const status = result.passed ? '✅ PASS' : '❌ FAIL';
        const name = result.name.padEnd(35);
        const rps = result.metrics.requestsPerSecond.toFixed(1).padStart(8);
        const avgTime = `${result.metrics.avgResponseTime}ms`.padStart(8);
        const successRate = `${result.metrics.successRate}%`.padStart(8);
        
        console.log(`${name} | ${rps} req/s | ${avgTime} | ${successRate} | ${status}`);
      } else {
        console.log(`${result.name.padEnd(35)} | ERROR: ${result.error}`);
      }
    });

    // Performance insights
    console.log('\nPerformance Insights:');
    console.log('--------------------');
    
    const validResults = this.results.filter(r => r.metrics);
    
    if (validResults.length > 0) {
      const avgResponseTime = validResults.reduce((sum, r) => sum + r.metrics.avgResponseTime, 0) / validResults.length;
      const totalRps = validResults.reduce((sum, r) => sum + r.metrics.requestsPerSecond, 0);
      const avgSuccessRate = validResults.reduce((sum, r) => sum + r.metrics.successRate, 0) / validResults.length;
      const totalRequests = validResults.reduce((sum, r) => sum + r.metrics.totalRequests, 0);
      const totalErrors = validResults.reduce((sum, r) => sum + r.metrics.errors, 0);

      console.log(`Average Response Time: ${Math.round(avgResponseTime)}ms`);
      console.log(`Total Requests Per Second: ${totalRps.toFixed(1)}`);
      console.log(`Average Success Rate: ${avgSuccessRate.toFixed(1)}%`);
      console.log(`Total Requests Processed: ${totalRequests.toLocaleString()}`);
      console.log(`Total Errors: ${totalErrors.toLocaleString()}`);

      // Recommendations
      console.log('\nRecommendations:');
      console.log('----------------');
      
      if (avgResponseTime > 1000) {
        console.log('⚠️  High average response time detected. Consider:');
        console.log('   - Database query optimization');
        console.log('   - Implementing response caching');
        console.log('   - Adding CDN for static assets');
      }
      
      if (avgSuccessRate < 95) {
        console.log('⚠️  Low success rate detected. Consider:');
        console.log('   - Reviewing error handling');
        console.log('   - Implementing circuit breakers');
        console.log('   - Adding request timeouts');
      }
      
      if (totalRps < 100) {
        console.log('⚠️  Low throughput detected. Consider:');
        console.log('   - Scaling horizontally');
        console.log('   - Optimizing database connections');
        console.log('   - Implementing connection pooling');
      }
    }

    const report = {
      summary: {
        totalTests: total,
        passedTests: passed,
        passRate: parseFloat(passRate),
        generatedAt: new Date().toISOString()
      },
      results: this.results,
      insights: validResults.length > 0 ? {
        avgResponseTime: Math.round(validResults.reduce((sum, r) => sum + r.metrics.avgResponseTime, 0) / validResults.length),
        totalRps: validResults.reduce((sum, r) => sum + r.metrics.requestsPerSecond, 0),
        avgSuccessRate: validResults.reduce((sum, r) => sum + r.metrics.successRate, 0) / validResults.length,
        totalRequests: validResults.reduce((sum, r) => sum + r.metrics.totalRequests, 0),
        totalErrors: validResults.reduce((sum, r) => sum + r.metrics.errors, 0)
      } : null
    };

    return report;
  }

  /**
   * Save report to file
   */
  async saveReport(report) {
    try {
      const timestamp = new Date().toISOString().split('T')[0];
      const filename = `load-test-report-${timestamp}.json`;
      
      await fs.writeFile(filename, JSON.stringify(report, null, 2));
      console.log(`\n📁 Load test report saved to: ${filename}`);
      
      // Also save a CSV summary
      const csvFilename = `load-test-summary-${timestamp}.csv`;
      const csvData = [
        'Test Name,Method,URL,Passed,Avg Response Time (ms),Requests/sec,Success Rate (%),Total Requests,Errors',
        ...this.results.filter(r => r.metrics).map(r => 
          `"${r.name}",${r.method},${r.url},${r.passed},${r.metrics.avgResponseTime},${r.metrics.requestsPerSecond.toFixed(2)},${r.metrics.successRate},${r.metrics.totalRequests},${r.metrics.errors}`
        )
      ].join('\n');
      
      await fs.writeFile(csvFilename, csvData);
      console.log(`📊 CSV summary saved to: ${csvFilename}`);
      
    } catch (error) {
      console.error('Error saving report:', error.message);
    }
  }
}

// Main execution
async function main() {
  const suite = new LoadTestSuite();
  
  try {
    await suite.initialize();
    
    // Run different types of load tests
    await suite.runApiLoadTests();
    await suite.runStressTest();
    await suite.runSpikeTest();
    
    // Generate and save report
    const report = suite.generateReport();
    await suite.saveReport(report);
    
    // Exit with appropriate code
    const overallPassRate = report.summary.passRate;
    console.log(`\n${overallPassRate >= 80 ? '🎉 LOAD TESTS PASSED' : '⚠️  LOAD TESTS FAILED'}`);
    process.exit(overallPassRate >= 80 ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Load test suite failed:', error.message);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default LoadTestSuite;