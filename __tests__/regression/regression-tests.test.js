/**
 * Regression Tests Runner
 * 
 * Executes the comprehensive regression test suite
 */

import { describe, beforeAll, afterAll, test, expect } from '@jest/globals';
import { RegressionTestSuite } from './regression-test-suite.js';

describe('Regression Test Suite', () => {
  let regressionSuite;
  let baselineReport;
  let regressionReport;

  beforeAll(async () => {
    regressionSuite = new RegressionTestSuite();
    console.log('Initializing regression test suite...');
  });

  afterAll(async () => {
    if (regressionReport) {
      console.log('\n' + '='.repeat(80));
      console.log('REGRESSION TEST SUMMARY');
      console.log('='.repeat(80));
      console.log(`Total Tests: ${regressionReport.summary.totalTests}`);
      console.log(`Passed: ${regressionReport.summary.passedTests}`);
      console.log(`Failed: ${regressionReport.summary.failedTests}`);
      console.log(`Success Rate: ${regressionReport.summary.successRate.toFixed(1)}%`);
      console.log(`Regressions Detected: ${regressionReport.summary.regressionsDetected}`);
      console.log(`Improvements Detected: ${regressionReport.summary.improvementsDetected}`);
      
      if (regressionReport.recommendations.length > 0) {
        console.log('\nRECOMMENDATIONS:');
        regressionReport.recommendations.forEach((rec, index) => {
          console.log(`${index + 1}. [${rec.severity.toUpperCase()}] ${rec.category}: ${rec.message}`);
          rec.actions.forEach(action => {
            console.log(`   - ${action}`);
          });
        });
      }
      
      console.log('='.repeat(80));
    }
  });

  // ==================== BASELINE ESTABLISHMENT ====================

  test('should establish performance and accuracy baseline', async () => {
    console.log('Establishing baseline metrics...');
    
    baselineReport = await regressionSuite.establishBaseline();
    
    expect(baselineReport).toBeDefined();
    expect(baselineReport.api).toBeDefined();
    expect(baselineReport.database).toBeDefined();
    expect(baselineReport.analytics).toBeDefined();
    expect(baselineReport.business).toBeDefined();
    expect(baselineReport.memory).toBeDefined();
    
    // Validate baseline metrics are reasonable
    if (baselineReport.api.getCustomers) {
      expect(baselineReport.api.getCustomers.avgResponseTime).toBeLessThan(5000); // 5 seconds max
      expect(baselineReport.api.getCustomers.successRate).toBeGreaterThan(0.5); // At least 50% success
    }
    
    if (baselineReport.memory) {
      expect(baselineReport.memory.heapUsed).toBeGreaterThan(0);
      expect(baselineReport.memory.heapUsed).toBeLessThan(1024); // Less than 1GB
    }
    
    console.log('Baseline established successfully');
    console.log(`API endpoints tested: ${Object.keys(baselineReport.api).length}`);
    console.log(`Database queries tested: ${Object.keys(baselineReport.database).length}`);
    console.log(`Analytics accuracy: ${(baselineReport.analytics.accuracy * 100).toFixed(1)}%`);
    console.log(`Business logic accuracy: ${(baselineReport.business.accuracy * 100).toFixed(1)}%`);
    console.log(`Memory usage: ${baselineReport.memory.heapUsed.toFixed(1)}MB`);
  }, 60000);

  // ==================== REGRESSION DETECTION ====================

  test('should detect performance regressions', async () => {
    expect(baselineReport).toBeDefined();
    
    console.log('Running regression detection...');
    
    regressionReport = await regressionSuite.runRegressionTests();
    
    expect(regressionReport).toBeDefined();
    expect(regressionReport.summary).toBeDefined();
    expect(regressionReport.performance).toBeDefined();
    expect(regressionReport.reliability).toBeDefined();
    
    // Check for critical regressions
    const criticalRegressions = regressionReport.details.all_regressions.filter(r => 
      r.degradation > 50 // More than 50% degradation
    );
    
    if (criticalRegressions.length > 0) {
      console.warn(`CRITICAL: ${criticalRegressions.length} severe performance regressions detected!`);
      criticalRegressions.forEach(regression => {
        console.warn(`  - ${regression.category}.${regression.endpoint || regression.query}: ${regression.metric} degraded by ${regression.degradation.toFixed(1)}%`);
      });
    }
    
    // Performance regression thresholds
    expect(regressionReport.summary.successRate).toBeGreaterThan(70); // At least 70% tests should pass
    
    // Log improvements
    if (regressionReport.summary.improvementsDetected > 0) {
      console.log(`GOOD NEWS: ${regressionReport.summary.improvementsDetected} performance improvements detected!`);
    }
  }, 120000);

  // ==================== API COMPATIBILITY TESTS ====================

  test('should validate API backward compatibility', async () => {
    expect(regressionReport).toBeDefined();
    
    const apiIssues = regressionReport.reliability.issues.filter(issue => 
      issue.type.includes('api')
    );
    
    // API should remain compatible
    expect(apiIssues.length).toBeLessThan(3); // Allow max 2 API issues
    
    // Check specific API regressions
    const apiRegressions = regressionReport.performance.regressions.filter(r => 
      r.category === 'api'
    );
    
    if (apiRegressions.length > 0) {
      console.log(`API Performance Regressions: ${apiRegressions.length}`);
      apiRegressions.forEach(regression => {
        console.log(`  - ${regression.endpoint}: ${regression.metric} ${regression.degradation.toFixed(1)}% slower`);
      });
    }
    
    // Ensure critical endpoints are working
    const criticalEndpoints = ['getCustomers', 'getSuppliers', 'getInventory'];
    const currentApiMetrics = regressionReport.performance.current.api;
    
    criticalEndpoints.forEach(endpoint => {
      if (currentApiMetrics[endpoint]) {
        expect(currentApiMetrics[endpoint].successRate).toBeGreaterThan(0.8); // 80% success rate minimum
        expect(currentApiMetrics[endpoint].avgResponseTime).toBeLessThan(10000); // 10 seconds max
      }
    });
  });

  // ==================== DATABASE INTEGRITY TESTS ====================

  test('should validate database schema integrity', async () => {
    expect(regressionReport).toBeDefined();
    
    const dbIssues = regressionReport.data_integrity.issues.filter(issue => 
      issue.type.includes('database')
    );
    
    // Database schema should be stable
    expect(dbIssues.length).toBe(0); // No database integrity issues allowed
    
    // Check database performance regressions
    const dbRegressions = regressionReport.performance.regressions.filter(r => 
      r.category === 'database'
    );
    
    if (dbRegressions.length > 0) {
      console.log(`Database Performance Regressions: ${dbRegressions.length}`);
      dbRegressions.forEach(regression => {
        console.log(`  - ${regression.query}: ${regression.metric} ${regression.degradation.toFixed(1)}% slower`);
      });
    }
    
    // Database queries should not degrade more than 100%
    dbRegressions.forEach(regression => {
      expect(regression.degradation).toBeLessThan(100); // No more than 100% degradation
    });
  });

  // ==================== BUSINESS LOGIC VALIDATION ====================

  test('should validate business logic consistency', async () => {
    expect(regressionReport).toBeDefined();
    
    const businessIssues = regressionReport.business_logic.issues;
    
    // Business logic should remain consistent
    expect(businessIssues.length).toBeLessThan(2); // Allow max 1 business logic issue
    
    // Analytics accuracy should not degrade significantly
    if (regressionReport.accuracy.baseline_accuracy > 0) {
      const accuracyDegradation = (regressionReport.accuracy.baseline_accuracy - regressionReport.accuracy.current_accuracy) / regressionReport.accuracy.baseline_accuracy;
      expect(accuracyDegradation).toBeLessThan(0.1); // No more than 10% accuracy loss
    }
    
    console.log(`Business Logic Accuracy: ${(regressionReport.accuracy.current_accuracy * 100).toFixed(1)}%`);
  });

  // ==================== MEMORY AND RESOURCE VALIDATION ====================

  test('should validate memory usage and resource consumption', async () => {
    expect(regressionReport).toBeDefined();
    
    const memoryRegressions = regressionReport.resources.regressions;
    
    // Memory usage should not increase dramatically
    if (memoryRegressions.length > 0) {
      console.log(`Memory Regressions: ${memoryRegressions.length}`);
      memoryRegressions.forEach(regression => {
        console.log(`  - ${regression.metric}: increased by ${regression.degradation.toFixed(1)}%`);
        
        // No more than 50% memory increase allowed
        expect(regression.degradation).toBeLessThan(50);
      });
    }
    
    // Current memory usage should be reasonable
    const currentMemory = regressionReport.resources.current_memory;
    if (currentMemory) {
      expect(currentMemory.heapUsed).toBeLessThan(1024); // Less than 1GB heap
      expect(currentMemory.rss).toBeLessThan(2048); // Less than 2GB RSS
    }
  });

  // ==================== DATA CONSISTENCY VALIDATION ====================

  test('should validate data consistency and integrity', async () => {
    expect(regressionReport).toBeDefined();
    
    const integrityIssues = regressionReport.data_integrity.issues;
    
    // Data integrity is critical - no issues allowed
    expect(integrityIssues.length).toBe(0);
    
    if (integrityIssues.length > 0) {
      console.error('Data Integrity Issues Detected:');
      integrityIssues.forEach((issue, index) => {
        console.error(`  ${index + 1}. ${issue.test}: ${issue.error || JSON.stringify(issue.result)}`);
      });
    }
  });

  // ==================== OVERALL REGRESSION ASSESSMENT ====================

  test('should pass overall regression assessment', async () => {
    expect(regressionReport).toBeDefined();
    
    const { summary } = regressionReport;
    
    // Overall success rate should be high
    expect(summary.successRate).toBeGreaterThan(85); // 85% minimum success rate
    
    // Critical regression limits
    const criticalRegressions = regressionReport.details.all_regressions.filter(r => 
      (r.type === 'reliability' && r.degradation > 5) || // 5% error rate increase
      (r.type === 'performance' && r.degradation > 100) || // 100% performance degradation
      (r.type === 'accuracy' && r.degradation > 10) || // 10% accuracy loss
      (r.type === 'resource' && r.degradation > 50) // 50% resource increase
    );
    
    expect(criticalRegressions.length).toBe(0); // No critical regressions allowed
    
    if (criticalRegressions.length > 0) {
      console.error('CRITICAL REGRESSIONS DETECTED:');
      criticalRegressions.forEach(regression => {
        console.error(`  - ${regression.type} regression in ${regression.category}: ${regression.degradation.toFixed(1)}% degradation`);
      });
    }
    
    // Generate final assessment
    const regressionScore = Math.max(0, 100 - (summary.regressionsDetected * 10));
    const overallScore = (summary.successRate + regressionScore) / 2;
    
    console.log(`\nFINAL REGRESSION ASSESSMENT:`);
    console.log(`Success Rate: ${summary.successRate.toFixed(1)}%`);
    console.log(`Regression Score: ${regressionScore}%`);
    console.log(`Overall Score: ${overallScore.toFixed(1)}%`);
    
    if (overallScore >= 90) {
      console.log('✅ EXCELLENT: No significant regressions detected');
    } else if (overallScore >= 80) {
      console.log('⚠️  GOOD: Minor regressions detected, monitor closely');
    } else if (overallScore >= 70) {
      console.log('⚠️  WARNING: Moderate regressions detected, investigation recommended');
    } else {
      console.log('❌ CRITICAL: Severe regressions detected, immediate action required');
    }
    
    expect(overallScore).toBeGreaterThan(75); // Minimum acceptable score
  });
});