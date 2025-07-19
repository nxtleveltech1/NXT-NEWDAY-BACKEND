/**
 * Test script for the new supplier ranking algorithm
 * Story 1.5, Task 3: Supplier Analytics Implementation
 */

import { analyticsService } from './src/services/analytics.service.js';

async function testSupplierRanking() {
  console.log('🚀 Testing Enhanced Supplier Ranking Algorithm');
  console.log('='.repeat(50));
  
  try {
    // Initialize the analytics service
    await analyticsService.initialize();
    console.log('✅ Analytics service initialized');

    // Test 1: Basic enhanced supplier rankings
    console.log('\n📊 Test 1: Basic Enhanced Supplier Rankings');
    const basicRankings = await analyticsService.getSupplierRankingsEnhanced({
      businessPriority: 'balanced'
    });
    
    console.log(`✅ Retrieved ${basicRankings.data.suppliers.length} suppliers`);
    console.log(`📈 Average Score: ${basicRankings.data.summary.averageScore.toFixed(2)}/100`);
    console.log(`🏆 Top 3 Suppliers:`);
    
    basicRankings.data.suppliers.slice(0, 3).forEach((supplier, index) => {
      console.log(`   ${index + 1}. ${supplier.companyName} - ${supplier.weightedScore}/100 (${supplier.tier})`);
    });

    // Test 2: Cost-focused ranking
    console.log('\n💰 Test 2: Cost-Focused Ranking');
    const costRankings = await analyticsService.getSupplierRankingsEnhanced({
      businessPriority: 'cost'
    });
    
    console.log(`✅ Cost-focused weights applied:`);
    console.log(`   Price: ${(costRankings.data.summary.weightsUsed.priceCompetitiveness * 100).toFixed(0)}%`);
    console.log(`   Delivery: ${(costRankings.data.summary.weightsUsed.deliveryPerformance * 100).toFixed(0)}%`);
    console.log(`   Quality: ${(costRankings.data.summary.weightsUsed.qualityMetrics * 100).toFixed(0)}%`);

    // Test 3: Tier distribution
    console.log('\n🎯 Test 3: Tier Distribution Analysis');
    basicRankings.data.summary.tierDistribution.forEach(tier => {
      console.log(`   ${tier.tier}: ${tier.count} suppliers (${tier.percentage}%)`);
    });

    // Test 4: Recommendations and Alerts
    console.log('\n💡 Test 4: Recommendations and Alerts');
    console.log(`📋 Recommendations: ${basicRankings.data.recommendations.length}`);
    basicRankings.data.recommendations.forEach(rec => {
      console.log(`   ${rec.priority.toUpperCase()}: ${rec.title}`);
    });
    
    console.log(`🚨 Alerts: ${basicRankings.data.alerts.length}`);
    basicRankings.data.alerts.slice(0, 3).forEach(alert => {
      console.log(`   ${alert.severity.toUpperCase()}: ${alert.type}`);
    });

    // Test 5: Tier Summary
    console.log('\n📈 Test 5: Supplier Tier Summary');
    const tierSummary = await analyticsService.getSupplierTierSummary();
    
    Object.entries(tierSummary.data.tierMetrics).forEach(([tier, metrics]) => {
      console.log(`   ${tier}: ${metrics.count} suppliers, avg score: ${metrics.averageScore}/100`);
    });

    console.log('\n🎉 All tests completed successfully!');
    console.log('='.repeat(50));

    // Performance metrics
    const queryMetrics = analyticsService.getQueryMetrics();
    console.log(`📊 Performance Metrics:`);
    console.log(`   Total Queries: ${queryMetrics.totalQueries}`);
    console.log(`   Average Duration: ${queryMetrics.averageDuration.toFixed(2)}ms`);
    console.log(`   Slow Queries (>2s): ${queryMetrics.slowQueries.length}`);

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  }
}

// Run the test if this file is executed directly
if (process.argv[1].endsWith('test_supplier_ranking.js')) {
  testSupplierRanking();
}

export { testSupplierRanking };