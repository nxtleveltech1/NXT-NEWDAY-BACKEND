/**
 * Supplier Performance Analytics API Test Examples
 * 
 * This file demonstrates how to use the new supplier performance endpoint
 * Run these tests after the server is started
 */

const BASE_URL = 'http://localhost:3000/api/analytics';

// Test functions for the supplier performance endpoint
const testSupplierPerformance = {
  
  // Test 1: Get all suppliers performance
  async getAllSuppliers() {
    try {
      const response = await fetch(`${BASE_URL}/suppliers/performance`);
      const data = await response.json();
      
      console.log('✅ Get All Suppliers Performance:');
      console.log(`- Total suppliers: ${data.data.summary.totalSuppliers}`);
      console.log(`- Average score: ${data.data.summary.averagePerformanceScore}`);
      console.log(`- Query duration: ${data.performance.queryDuration}`);
      console.log(`- From cache: ${data.performance.fromCache}`);
      
      return data;
    } catch (error) {
      console.error('❌ Get All Suppliers failed:', error.message);
    }
  },

  // Test 2: Get specific supplier performance
  async getSpecificSupplier(supplierId) {
    try {
      const response = await fetch(`${BASE_URL}/suppliers/performance?supplierId=${supplierId}`);
      const data = await response.json();
      
      if (data.success && data.data.suppliers.length > 0) {
        const supplier = data.data.suppliers[0];
        console.log('✅ Get Specific Supplier Performance:');
        console.log(`- Supplier: ${supplier.supplier.name} (${supplier.supplier.code})`);
        console.log(`- Overall Score: ${supplier.performance.overallScore}`);
        console.log(`- On-Time Delivery: ${supplier.performance.onTimeDeliveryRate}%`);
        console.log(`- Quality Score: ${supplier.performance.qualityScore}`);
        console.log(`- Status: ${supplier.performance.status}`);
      } else {
        console.log('ℹ️ No supplier found or no data available');
      }
      
      return data;
    } catch (error) {
      console.error('❌ Get Specific Supplier failed:', error.message);
    }
  },

  // Test 3: Get performance with date range
  async getPerformanceWithDateRange() {
    try {
      const dateFrom = '2024-01-01';
      const dateTo = '2024-03-31';
      const response = await fetch(`${BASE_URL}/suppliers/performance?dateFrom=${dateFrom}&dateTo=${dateTo}`);
      const data = await response.json();
      
      console.log('✅ Get Performance with Date Range:');
      console.log(`- Date range: ${dateFrom} to ${dateTo}`);
      console.log(`- Suppliers analyzed: ${data.data.summary.totalSuppliers}`);
      console.log(`- Performance distribution:`, data.data.summary.performanceDistribution);
      
      return data;
    } catch (error) {
      console.error('❌ Get Performance with Date Range failed:', error.message);
    }
  },

  // Test 4: Get performance with custom threshold
  async getPerformanceWithThreshold(threshold = 85) {
    try {
      const response = await fetch(`${BASE_URL}/suppliers/performance?performanceThreshold=${threshold}`);
      const data = await response.json();
      
      console.log('✅ Get Performance with Custom Threshold:');
      console.log(`- Threshold: ${threshold}`);
      console.log(`- Suppliers above threshold: ${data.data.summary.suppliersAboveThreshold}`);
      console.log(`- Top performer: ${data.data.summary.topPerformer?.name || 'None'}`);
      
      return data;
    } catch (error) {
      console.error('❌ Get Performance with Threshold failed:', error.message);
    }
  },

  // Test 5: Test error handling
  async testErrorHandling() {
    try {
      // Test invalid supplier ID
      const response = await fetch(`${BASE_URL}/suppliers/performance?supplierId=invalid-uuid`);
      const data = await response.json();
      
      if (response.status === 400) {
        console.log('✅ Error Handling Test - Invalid UUID:');
        console.log(`- Status: ${response.status}`);
        console.log(`- Error: ${data.error}`);
      }
      
      return data;
    } catch (error) {
      console.error('❌ Error Handling Test failed:', error.message);
    }
  },

  // Test 6: Performance benchmark
  async benchmarkPerformance() {
    console.log('🚀 Running Performance Benchmark...');
    
    const startTime = Date.now();
    const response = await fetch(`${BASE_URL}/suppliers/performance`);
    const data = await response.json();
    const endTime = Date.now();
    
    const totalTime = endTime - startTime;
    const queryTime = parseInt(data.performance.queryDuration);
    
    console.log('📊 Performance Benchmark Results:');
    console.log(`- Total request time: ${totalTime}ms`);
    console.log(`- Query duration: ${queryTime}ms`);
    console.log(`- Network overhead: ${totalTime - queryTime}ms`);
    console.log(`- Target met: ${queryTime < 2000 ? '✅ Yes' : '❌ No'} (< 2000ms)`);
    console.log(`- Cache hit: ${data.performance.fromCache ? '✅ Yes' : '❌ No'}`);
    
    return { totalTime, queryTime, fromCache: data.performance.fromCache };
  },

  // Run all tests
  async runAllTests() {
    console.log('🧪 Starting Supplier Performance API Tests...\n');
    
    await this.getAllSuppliers();
    console.log('');
    
    await this.getPerformanceWithDateRange();
    console.log('');
    
    await this.getPerformanceWithThreshold(85);
    console.log('');
    
    await this.testErrorHandling();
    console.log('');
    
    await this.benchmarkPerformance();
    console.log('');
    
    console.log('✅ All tests completed!');
  }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = testSupplierPerformance;
}

// Auto-run tests if this file is executed directly
if (typeof window === 'undefined' && require.main === module) {
  testSupplierPerformance.runAllTests()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Test suite failed:', error);
      process.exit(1);
    });
}

/* Usage Examples:

1. Node.js usage:
   ```javascript
   const supplierTests = require('./supplier-performance-test.js');
   supplierTests.getAllSuppliers();
   ```

2. Browser usage:
   ```html
   <script src="supplier-performance-test.js"></script>
   <script>
     testSupplierPerformance.getAllSuppliers();
   </script>
   ```

3. Command line:
   ```bash
   node supplier-performance-test.js
   ```

4. cURL examples:
   ```bash
   # Get all suppliers
   curl "http://localhost:3000/api/analytics/suppliers/performance"
   
   # Get specific supplier
   curl "http://localhost:3000/api/analytics/suppliers/performance?supplierId=550e8400-e29b-41d4-a716-446655440000"
   
   # Get with date range
   curl "http://localhost:3000/api/analytics/suppliers/performance?dateFrom=2024-01-01&dateTo=2024-03-31"
   
   # Get with custom threshold
   curl "http://localhost:3000/api/analytics/suppliers/performance?performanceThreshold=85"
   ```
*/