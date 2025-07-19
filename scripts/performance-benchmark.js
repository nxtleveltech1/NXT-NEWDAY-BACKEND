#!/usr/bin/env node

/**
 * Performance Benchmark Script for Analytics Module
 * Tests Story 1.5, Task 7: Performance Optimization & Legacy Validation
 */

import { performance } from 'perf_hooks';
import { AnalyticsService } from '../src/services/analytics.service.js';
import { testConnection } from '../src/config/database.js';

const TARGET_RESPONSE_TIME = 2000; // 2 seconds as per AC7

class PerformanceBenchmark {
  constructor() {
    this.analyticsService = new AnalyticsService();
    this.results = [];
  }

  async initialize() {
    console.log('🚀 Starting Analytics Performance Benchmark');
    console.log('================================================');
    
    // Test database connection
    console.log('📊 Testing database connection...');
    const dbStatus = await testConnection();
    if (!dbStatus.success) {
      throw new Error(`Database connection failed: ${dbStatus.error}`);
    }
    console.log('✅ Database connection successful');

    // Initialize analytics service
    console.log('🔧 Initializing analytics service...');
    await this.analyticsService.initialize();
    console.log('✅ Analytics service initialized');
    console.log('');
  }

  async runBenchmark(testName, testFunction, iterations = 5) {
    console.log(`🧪 Running ${testName} (${iterations} iterations)...`);
    
    const times = [];
    let errors = 0;
    
    for (let i = 0; i < iterations; i++) {
      try {
        const start = performance.now();
        await testFunction();
        const end = performance.now();
        const duration = end - start;
        times.push(duration);
        
        process.stdout.write(`  Iteration ${i + 1}: ${duration.toFixed(2)}ms`);
        if (duration > TARGET_RESPONSE_TIME) {
          process.stdout.write(' ⚠️  (exceeds 2s target)');
        } else {
          process.stdout.write(' ✅');
        }
        console.log('');
      } catch (error) {
        errors++;
        console.log(`  Iteration ${i + 1}: ERROR - ${error.message}`);
      }
    }

    const avgTime = times.reduce((a, b) => a + b, 0) / times.length;
    const minTime = Math.min(...times);
    const maxTime = Math.max(...times);
    
    const result = {
      testName,
      avgTime: parseFloat(avgTime.toFixed(2)),
      minTime: parseFloat(minTime.toFixed(2)),
      maxTime: parseFloat(maxTime.toFixed(2)),
      successRate: ((iterations - errors) / iterations * 100).toFixed(1),
      passesTarget: avgTime <= TARGET_RESPONSE_TIME,
      errors
    };

    this.results.push(result);
    
    console.log(`  📈 Average: ${avgTime.toFixed(2)}ms | Min: ${minTime.toFixed(2)}ms | Max: ${maxTime.toFixed(2)}ms`);
    console.log(`  ✅ Success Rate: ${result.successRate}% | Target: ${result.passesTarget ? 'PASS' : 'FAIL'}`);
    console.log('');
    
    return result;
  }

  async testCustomerAnalytics() {
    return await this.analyticsService.getCustomerAnalytics({
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      includeDetails: false
    });
  }

  async testSupplierPerformance() {
    return await this.analyticsService.getSupplierPerformance({
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      includeRankings: true,
      includeComparisons: true
    });
  }

  async testInventoryMetrics() {
    return await this.analyticsService.getInventoryMetrics({
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31'
    });
  }

  async testSalesMetrics() {
    return await this.analyticsService.getSalesMetrics({
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      aggregation: 'daily'
    });
  }

  async testAdvancedAnalytics() {
    return await this.analyticsService.getAdvancedAnalytics({
      analysis_type: 'comprehensive',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31'
    });
  }

  async testPurchasePatterns() {
    return await this.analyticsService.analyzePurchasePatterns({
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31',
      includeSeasonality: true,
      includeProductAffinity: true
    });
  }

  async testCustomerSegmentation() {
    return await this.analyticsService.getCustomerSegmentation({
      segmentType: 'RFM',
      dateFrom: '2024-01-01',
      dateTo: '2024-12-31'
    });
  }

  async testHealthCheck() {
    return await this.analyticsService.healthCheck();
  }

  async runAllTests() {
    const tests = [
      { name: 'Customer Analytics', fn: () => this.testCustomerAnalytics() },
      { name: 'Supplier Performance', fn: () => this.testSupplierPerformance() },
      { name: 'Inventory Metrics', fn: () => this.testInventoryMetrics() },
      { name: 'Sales Metrics', fn: () => this.testSalesMetrics() },
      { name: 'Advanced Analytics', fn: () => this.testAdvancedAnalytics() },
      { name: 'Purchase Patterns', fn: () => this.testPurchasePatterns() },
      { name: 'Customer Segmentation', fn: () => this.testCustomerSegmentation() },
      { name: 'Health Check', fn: () => this.testHealthCheck() }
    ];

    for (const test of tests) {
      await this.runBenchmark(test.name, test.fn, 3);
    }
  }

  generateReport() {
    console.log('📊 PERFORMANCE BENCHMARK REPORT');
    console.log('================================');
    console.log(`Target Response Time: ${TARGET_RESPONSE_TIME}ms`);
    console.log('');

    const passed = this.results.filter(r => r.passesTarget).length;
    const total = this.results.length;
    const overallPass = (passed / total * 100).toFixed(1);

    console.log('Test Results:');
    console.log('-------------');
    
    this.results.forEach(result => {
      const status = result.passesTarget ? '✅ PASS' : '❌ FAIL';
      console.log(`${result.testName.padEnd(25)} | ${result.avgTime.toString().padStart(8)}ms | ${status}`);
    });

    console.log('');
    console.log('Summary:');
    console.log('--------');
    console.log(`✅ Tests Passed: ${passed}/${total} (${overallPass}%)`);
    console.log(`⚡ Fastest Test: ${Math.min(...this.results.map(r => r.minTime)).toFixed(2)}ms`);
    console.log(`🐌 Slowest Test: ${Math.max(...this.results.map(r => r.maxTime)).toFixed(2)}ms`);
    console.log(`📊 Average Time: ${(this.results.reduce((a, r) => a + r.avgTime, 0) / total).toFixed(2)}ms`);

    // Cache performance analysis
    const cachableTests = this.results.filter(r => !r.testName.includes('Health'));
    if (cachableTests.length > 0) {
      console.log('');
      console.log('Cache Recommendations:');
      console.log('----------------------');
      cachableTests.forEach(result => {
        if (result.avgTime > 1000) {
          console.log(`⚠️  ${result.testName}: Consider increasing cache TTL (current avg: ${result.avgTime}ms)`);
        } else if (result.avgTime < 100) {
          console.log(`✅ ${result.testName}: Excellent performance (avg: ${result.avgTime}ms)`);
        }
      });
    }

    console.log('');
    if (overallPass >= 80) {
      console.log('🎉 BENCHMARK PASSED: Analytics module meets performance requirements!');
    } else {
      console.log('⚠️  BENCHMARK FAILED: Performance optimization needed for some endpoints.');
      console.log('');
      console.log('Recommendations:');
      console.log('- Review query optimization for failing tests');
      console.log('- Increase Redis cache TTL for slow queries');
      console.log('- Consider database indexing improvements');
      console.log('- Review data aggregation strategies');
    }

    return {
      overallPassRate: parseFloat(overallPass),
      passed,
      total,
      results: this.results
    };
  }

  async cleanup() {
    console.log('🧹 Cleaning up...');
    try {
      // Cleanup cache if needed
      if (this.analyticsService.cache && this.analyticsService.cache.flush) {
        await this.analyticsService.cache.flush();
      }
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.log(`⚠️  Cleanup warning: ${error.message}`);
    }
  }
}

// Main execution
async function main() {
  const benchmark = new PerformanceBenchmark();
  
  try {
    await benchmark.initialize();
    await benchmark.runAllTests();
    const report = benchmark.generateReport();
    
    // Save results to file
    const fs = await import('fs/promises');
    const reportFile = `performance-report-${new Date().toISOString().split('T')[0]}.json`;
    await fs.writeFile(reportFile, JSON.stringify(report, null, 2));
    console.log(`📁 Report saved to: ${reportFile}`);
    
    process.exit(report.overallPassRate >= 80 ? 0 : 1);
    
  } catch (error) {
    console.error('❌ Benchmark failed:', error.message);
    process.exit(1);
  } finally {
    await benchmark.cleanup();
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export default PerformanceBenchmark;