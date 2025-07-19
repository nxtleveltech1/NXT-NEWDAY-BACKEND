#!/usr/bin/env node

/**
 * Test Script for Purchase Pattern Analysis
 * Tests all new purchase pattern analysis methods in the analytics service
 */

import { analyticsService } from './src/services/analytics.service.js';

async function testPurchasePatternAnalysis() {
  console.log('🚀 Testing Purchase Pattern Analysis...\n');

  try {
    // Initialize the analytics service
    await analyticsService.initialize();
    console.log('✅ Analytics service initialized\n');

    // Test 1: Seasonal Pattern Analysis
    console.log('📅 Testing Seasonal Pattern Analysis...');
    const seasonalPatterns = await analyticsService.analyzeSeasonalPatterns({
      timeframe: 'last_year'
    });
    
    console.log(`   - Monthly patterns: ${seasonalPatterns.data.monthly?.length || 0} months`);
    console.log(`   - Weekly patterns: ${seasonalPatterns.data.weekly?.length || 0} days`);
    console.log(`   - Hourly patterns: ${seasonalPatterns.data.hourly?.length || 0} hours`);
    if (seasonalPatterns.data.insights?.peakMonth) {
      console.log(`   - Peak month: ${seasonalPatterns.data.insights.peakMonth.monthName} ($${parseFloat(seasonalPatterns.data.insights.peakMonth.totalValue).toFixed(2)})`);
    }
    console.log(`   ⏱️  Query time: ${seasonalPatterns.duration}ms\n`);

    // Test 2: Product Affinity Analysis
    console.log('🔗 Testing Product Affinity Analysis...');
    const productAffinity = await analyticsService.analyzeProductAffinity({
      minSupport: 0.01, // 1% support
      minConfidence: 0.2 // 20% confidence
    });
    
    console.log(`   - Product pairs found: ${productAffinity.data.productPairs?.length || 0}`);
    console.log(`   - Category affinities: ${productAffinity.data.categoryAffinity?.length || 0}`);
    console.log(`   - Recommendations: ${productAffinity.data.recommendations?.length || 0}`);
    if (productAffinity.data.recommendations?.length > 0) {
      console.log(`   - Top recommendation: ${productAffinity.data.recommendations[0].recommendation}`);
    }
    console.log(`   ⏱️  Query time: ${productAffinity.duration}ms\n`);

    // Test 3: Purchase Cycle Analysis - Customers
    console.log('🔄 Testing Purchase Cycle Analysis (Customers)...');
    const customerCycles = await analyticsService.analyzePurchaseCycles({
      segmentBy: 'customer'
    });
    
    console.log(`   - Customers analyzed: ${customerCycles.data.customers?.length || 0}`);
    if (customerCycles.data.customers?.length > 0) {
      const avgCycle = customerCycles.data.customers
        .filter(c => c.avgDaysBetweenOrders)
        .reduce((sum, c) => sum + parseFloat(c.avgDaysBetweenOrders), 0) / 
        customerCycles.data.customers.filter(c => c.avgDaysBetweenOrders).length;
      console.log(`   - Average purchase cycle: ${avgCycle.toFixed(1)} days`);
    }
    console.log(`   ⏱️  Query time: ${customerCycles.duration}ms\n`);

    // Test 4: Purchase Cycle Analysis - Products
    console.log('📦 Testing Purchase Cycle Analysis (Products)...');
    const productCycles = await analyticsService.analyzePurchaseCycles({
      segmentBy: 'product'
    });
    
    console.log(`   - Products analyzed: ${productCycles.data.products?.length || 0}`);
    if (productCycles.data.products?.length > 0) {
      const topProduct = productCycles.data.products[0];
      console.log(`   - Top product: ${topProduct.productName} (${topProduct.uniqueCustomers} customers)`);
    }
    console.log(`   ⏱️  Query time: ${productCycles.duration}ms\n`);

    // Test 5: Trending Products Analysis
    console.log('📈 Testing Trending Products Analysis...');
    const trendingProducts = await analyticsService.identifyTrendingProducts({
      timeWindow: '30_days',
      minGrowthRate: 0.05 // 5% growth
    });
    
    console.log(`   - Trending products: ${trendingProducts.data.summary?.totalTrendingProducts || 0}`);
    console.log(`   - New products: ${trendingProducts.data.summary?.newProducts || 0}`);
    console.log(`   - Rising products: ${trendingProducts.data.summary?.risingProducts || 0}`);
    console.log(`   - Category trends: ${trendingProducts.data.categoryTrends?.length || 0}`);
    if (trendingProducts.data.trendingProducts?.length > 0) {
      const topTrending = trendingProducts.data.trendingProducts[0];
      console.log(`   - Top trending: ${topTrending.productName} (${topTrending.trendScore.toFixed(1)}% score)`);
    }
    console.log(`   ⏱️  Query time: ${trendingProducts.duration}ms\n`);

    // Test 6: Peak Purchase Times Analysis
    console.log('⏰ Testing Peak Purchase Times Analysis...');
    const peakTimes = await analyticsService.analyzePeakPurchaseTimes({
      timezone: 'UTC'
    });
    
    console.log(`   - Hourly peaks: ${peakTimes.data.hourlyPeaks?.length || 0} hours`);
    console.log(`   - Weekly peaks: ${peakTimes.data.weeklyPeaks?.length || 0} days`);
    console.log(`   - Monthly day peaks: ${peakTimes.data.monthlyDayPeaks?.length || 0} days`);
    if (peakTimes.data.insights?.peakHour) {
      console.log(`   - Peak hour: ${peakTimes.data.insights.peakHour.description}`);
    }
    if (peakTimes.data.insights?.peakDay) {
      console.log(`   - Peak day: ${peakTimes.data.insights.peakDay.dayName.trim()}`);
    }
    console.log(`   ⏱️  Query time: ${peakTimes.duration}ms\n`);

    // Test 7: Comprehensive Purchase Patterns
    console.log('🎯 Testing Comprehensive Purchase Patterns...');
    const comprehensivePatterns = await analyticsService.getComprehensivePurchasePatterns({
      includeSeasonality: true,
      includeAffinity: true,
      includeCycles: true,
      includeTrending: true,
      includePeakTimes: true
    });
    
    console.log(`   - Generated insights: ${comprehensivePatterns.data.insights?.length || 0}`);
    console.log(`   - Analysis scope: ${comprehensivePatterns.data.metadata?.scope || 'unknown'}`);
    if (comprehensivePatterns.data.insights?.length > 0) {
      comprehensivePatterns.data.insights.slice(0, 3).forEach((insight, index) => {
        console.log(`   - Insight ${index + 1}: [${insight.type}] ${insight.message}`);
      });
    }
    console.log(`   ⏱️  Query time: ${comprehensivePatterns.duration}ms\n`);

    // Performance Summary
    console.log('📊 Performance Summary:');
    const metrics = analyticsService.getQueryMetrics();
    console.log(`   - Total queries executed: ${metrics.totalQueries}`);
    console.log(`   - Completed queries: ${metrics.completedQueries}`);
    console.log(`   - Average query time: ${metrics.averageDuration.toFixed(2)}ms`);
    console.log(`   - Slow queries (>2s): ${metrics.slowQueries.length}`);
    
    if (metrics.slowQueries.length > 0) {
      console.log('   - Slow query details:');
      metrics.slowQueries.forEach(query => {
        console.log(`     * ${query.queryType}: ${query.duration}ms`);
      });
    }

    // Health Check
    console.log('\n🏥 Running Health Check...');
    const health = await analyticsService.healthCheck();
    console.log(`   - Status: ${health.status}`);
    console.log(`   - Database: ${health.database ? '✅' : '❌'}`);
    console.log(`   - Cache: ${health.cache ? '✅' : '❌'}`);
    console.log(`   - Query time: ${health.queryTime}ms (target: ${health.target})`);

    console.log('\n✅ All purchase pattern analysis tests completed successfully!');
    
    // Check if all response times are under 2 seconds
    const allQueries = [
      seasonalPatterns, productAffinity, customerCycles, 
      productCycles, trendingProducts, peakTimes, comprehensivePatterns
    ];
    
    const slowQueries = allQueries.filter(query => query.duration > 2000);
    if (slowQueries.length > 0) {
      console.log(`\n⚠️  Warning: ${slowQueries.length} queries exceeded 2-second target`);
    } else {
      console.log('\n🎯 All queries met the <2 second response time target!');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error('Stack trace:', error.stack);
    process.exit(1);
  }
}

// Run the test
testPurchasePatternAnalysis().catch(console.error);