import { describe, test, expect, jest, beforeAll, afterAll } from '@jest/globals';
import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';
import { SharedArray } from 'k6/data';
import { randomString, randomIntBetween } from 'https://jslib.k6.io/k6-utils/1.2.0/index.js';

// Custom metrics
const uploadSuccessRate = new Rate('upload_success_rate');
const uploadDuration = new Trend('upload_duration');
const priceListProcessingTime = new Trend('price_list_processing_time');
const concurrentUploadErrors = new Rate('concurrent_upload_errors');

// Test configuration
export const options = {
  scenarios: {
    // Scenario 1: Steady load test
    steady_load: {
      executor: 'constant-vus',
      vus: 10,
      duration: '5m',
      startTime: '0s'
    },
    // Scenario 2: Spike test
    spike_test: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '2m', target: 50 },
        { duration: '1m', target: 100 },
        { duration: '2m', target: 0 }
      ],
      startTime: '5m'
    },
    // Scenario 3: Stress test
    stress_test: {
      executor: 'ramping-arrival-rate',
      startRate: 10,
      timeUnit: '1s',
      preAllocatedVUs: 50,
      maxVUs: 200,
      stages: [
        { duration: '2m', target: 50 },
        { duration: '3m', target: 100 },
        { duration: '2m', target: 200 },
        { duration: '3m', target: 50 }
      ],
      startTime: '10m'
    },
    // Scenario 4: Concurrent upload test
    concurrent_uploads: {
      executor: 'per-vu-iterations',
      vus: 50,
      iterations: 5,
      maxDuration: '10m',
      startTime: '20m'
    }
  },
  thresholds: {
    http_req_duration: ['p(95)<500', 'p(99)<1000'],
    upload_success_rate: ['rate>0.95'],
    concurrent_upload_errors: ['rate<0.05'],
    http_req_failed: ['rate<0.05']
  }
};

// Test data generators
function generateCSVData(rows = 100) {
  let csv = 'SKU,Description,Unit Price,Currency,Min Order Qty,Unit of Measure\n';
  for (let i = 0; i < rows; i++) {
    csv += `PROD${i.toString().padStart(5, '0')},Product ${i},${(Math.random() * 100).toFixed(2)},USD,${randomIntBetween(1, 100)},EA\n`;
  }
  return csv;
}

function generateSupplierData() {
  return {
    supplierCode: `SUP-${randomString(8)}`,
    companyName: `Test Supplier ${randomString(5)}`,
    email: `supplier-${randomString(8)}@test.com`,
    contactPerson: `Contact ${randomString(5)}`,
    phone: `+1${randomIntBetween(1000000000, 9999999999)}`,
    address: `${randomIntBetween(100, 999)} Test Street`,
    paymentTerms: randomIntBetween(15, 60)
  };
}

// Shared test data
const testSuppliers = new SharedArray('suppliers', function() {
  const suppliers = [];
  for (let i = 0; i < 100; i++) {
    suppliers.push({
      id: `supplier-${i}`,
      email: `supplier${i}@test.com`
    });
  }
  return suppliers;
});

// Base URL (update with actual test environment)
const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

export function setup() {
  // Create test suppliers if needed
  console.log('Setting up test data...');
  
  // Verify API is accessible
  const healthCheck = http.get(`${BASE_URL}/api/health`);
  check(healthCheck, {
    'API is healthy': (r) => r.status === 200
  });
  
  return { startTime: new Date() };
}

export default function() {
  const scenario = __ENV.scenario || 'steady_load';
  
  switch(scenario) {
    case 'steady_load':
      steadyLoadTest();
      break;
    case 'spike_test':
      spikeTest();
      break;
    case 'stress_test':
      stressTest();
      break;
    case 'concurrent_uploads':
      concurrentUploadTest();
      break;
    default:
      steadyLoadTest();
  }
}

function steadyLoadTest() {
  // Test 1: Create supplier
  const supplierData = generateSupplierData();
  const createRes = http.post(
    `${BASE_URL}/api/suppliers`,
    JSON.stringify(supplierData),
    {
      headers: { 'Content-Type': 'application/json' }
    }
  );
  
  check(createRes, {
    'supplier created': (r) => r.status === 201,
    'has supplier id': (r) => r.json('id') !== undefined
  });
  
  if (createRes.status === 201) {
    const supplierId = createRes.json('id');
    
    // Test 2: Upload price list
    const csvData = generateCSVData(randomIntBetween(50, 200));
    const uploadStart = Date.now();
    
    const formData = {
      file: http.file(csvData, 'prices.csv', 'text/csv')
    };
    
    const uploadRes = http.post(
      `${BASE_URL}/api/suppliers/${supplierId}/price-lists/upload`,
      formData
    );
    
    const uploadEnd = Date.now();
    uploadDuration.add(uploadEnd - uploadStart);
    
    const uploadSuccess = check(uploadRes, {
      'upload accepted': (r) => r.status === 202,
      'has upload id': (r) => r.json('uploadId') !== undefined
    });
    
    uploadSuccessRate.add(uploadSuccess);
    
    // Test 3: Get supplier performance
    sleep(1);
    const perfRes = http.get(`${BASE_URL}/api/suppliers/${supplierId}/performance`);
    
    check(perfRes, {
      'performance retrieved': (r) => r.status === 200,
      'has metrics': (r) => r.json('leadTimeMetrics') !== undefined
    });
  }
  
  sleep(randomIntBetween(1, 3));
}

function spikeTest() {
  // Simulate sudden increase in supplier registrations
  const batchSize = 10;
  const suppliers = [];
  
  // Create multiple suppliers quickly
  for (let i = 0; i < batchSize; i++) {
    const supplierData = generateSupplierData();
    const res = http.post(
      `${BASE_URL}/api/suppliers`,
      JSON.stringify(supplierData),
      {
        headers: { 'Content-Type': 'application/json' }
      }
    );
    
    if (res.status === 201) {
      suppliers.push(res.json('id'));
    }
  }
  
  // Upload price lists for all suppliers
  const batch = [];
  suppliers.forEach(supplierId => {
    const csvData = generateCSVData(100);
    batch.push({
      method: 'POST',
      url: `${BASE_URL}/api/suppliers/${supplierId}/price-lists/upload`,
      body: http.file(csvData, 'prices.csv', 'text/csv')
    });
  });
  
  const responses = http.batch(batch);
  
  responses.forEach(res => {
    check(res, {
      'batch upload accepted': (r) => r.status === 202
    });
  });
}

function stressTest() {
  // Test system under extreme load
  const operations = [
    // 40% - Search suppliers
    () => {
      const searchRes = http.get(`${BASE_URL}/api/suppliers?search=test&limit=50`);
      check(searchRes, {
        'search successful': (r) => r.status === 200
      });
    },
    // 30% - Upload price lists
    () => {
      const supplier = testSuppliers[randomIntBetween(0, testSuppliers.length - 1)];
      const csvData = generateCSVData(randomIntBetween(100, 1000));
      
      const uploadRes = http.post(
        `${BASE_URL}/api/suppliers/${supplier.id}/price-lists/upload`,
        { file: http.file(csvData, 'prices.csv', 'text/csv') }
      );
      
      check(uploadRes, {
        'stress upload handled': (r) => r.status === 202 || r.status === 503
      });
    },
    // 20% - Get supplier details
    () => {
      const supplier = testSuppliers[randomIntBetween(0, testSuppliers.length - 1)];
      const detailRes = http.get(`${BASE_URL}/api/suppliers/${supplier.id}`);
      
      check(detailRes, {
        'details retrieved under stress': (r) => r.status === 200 || r.status === 404
      });
    },
    // 10% - Bulk updates
    () => {
      const updates = testSuppliers.slice(0, 10).map(s => ({
        id: s.id,
        updates: { paymentTerms: randomIntBetween(15, 60) }
      }));
      
      const bulkRes = http.post(
        `${BASE_URL}/api/suppliers/bulk-update`,
        JSON.stringify({ updates }),
        {
          headers: { 'Content-Type': 'application/json' }
        }
      );
      
      check(bulkRes, {
        'bulk update handled': (r) => r.status === 200 || r.status === 207
      });
    }
  ];
  
  // Execute random operation
  const operation = operations[randomIntBetween(0, operations.length - 1)];
  operation();
  
  sleep(0.1); // Minimal sleep to maximize load
}

function concurrentUploadTest() {
  // Test concurrent uploads for same supplier
  const supplierId = testSuppliers[__VU % testSuppliers.length].id;
  const uploadCount = 5;
  const uploads = [];
  
  // Prepare multiple CSV files
  for (let i = 0; i < uploadCount; i++) {
    const csvData = generateCSVData(randomIntBetween(50, 200));
    uploads.push({
      method: 'POST',
      url: `${BASE_URL}/api/suppliers/${supplierId}/price-lists/upload`,
      body: { file: http.file(csvData, `prices-${i}.csv`, 'text/csv') }
    });
  }
  
  // Send all uploads concurrently
  const startTime = Date.now();
  const responses = http.batch(uploads);
  const endTime = Date.now();
  
  let successCount = 0;
  let errorCount = 0;
  
  responses.forEach((res, index) => {
    if (res.status === 202) {
      successCount++;
      check(res, {
        [`concurrent upload ${index} accepted`]: (r) => r.json('uploadId') !== undefined
      });
    } else {
      errorCount++;
      console.error(`Upload ${index} failed: ${res.status} - ${res.body}`);
    }
  });
  
  concurrentUploadErrors.add(errorCount > 0);
  priceListProcessingTime.add(endTime - startTime);
  
  // Wait and check processing status
  sleep(5);
  
  const queueStatusRes = http.get(`${BASE_URL}/api/suppliers/upload-queue/status`);
  check(queueStatusRes, {
    'queue status available': (r) => r.status === 200,
    'queue not overloaded': (r) => r.json('queueLength') < 1000
  });
}

export function teardown(data) {
  console.log('Test completed');
  console.log(`Duration: ${new Date() - data.startTime}ms`);
  
  // Final health check
  const healthCheck = http.get(`${BASE_URL}/api/health`);
  check(healthCheck, {
    'API still healthy after load test': (r) => r.status === 200
  });
}

// Additional performance test scenarios
export function memoryLeakTest() {
  // Test for memory leaks during extended operation
  const iterations = 1000;
  const memorySnapshots = [];
  
  for (let i = 0; i < iterations; i++) {
    // Perform operations
    const supplier = generateSupplierData();
    const createRes = http.post(
      `${BASE_URL}/api/suppliers`,
      JSON.stringify(supplier),
      { headers: { 'Content-Type': 'application/json' } }
    );
    
    if (createRes.status === 201 && i % 100 === 0) {
      // Get memory stats
      const statsRes = http.get(`${BASE_URL}/api/system/stats`);
      if (statsRes.status === 200) {
        memorySnapshots.push({
          iteration: i,
          memory: statsRes.json('memory.heapUsed')
        });
      }
    }
    
    if (i % 10 === 0) {
      sleep(0.1); // Brief pause every 10 iterations
    }
  }
  
  // Analyze memory growth
  if (memorySnapshots.length > 2) {
    const firstSnapshot = memorySnapshots[0].memory;
    const lastSnapshot = memorySnapshots[memorySnapshots.length - 1].memory;
    const growthRate = (lastSnapshot - firstSnapshot) / firstSnapshot;
    
    check(growthRate, {
      'memory growth acceptable': (rate) => rate < 0.5 // Less than 50% growth
    });
  }
}

export function largeFileUploadTest() {
  // Test handling of large files
  const fileSizes = [1000, 5000, 10000, 50000]; // Number of rows
  const supplier = testSuppliers[randomIntBetween(0, testSuppliers.length - 1)];
  
  fileSizes.forEach(size => {
    const csvData = generateCSVData(size);
    const fileSize = csvData.length;
    
    const startTime = Date.now();
    const uploadRes = http.post(
      `${BASE_URL}/api/suppliers/${supplier.id}/price-lists/upload`,
      { file: http.file(csvData, `large-${size}.csv`, 'text/csv') }
    );
    const uploadTime = Date.now() - startTime;
    
    check(uploadRes, {
      [`${size} rows upload accepted`]: (r) => r.status === 202,
      [`${size} rows upload time reasonable`]: () => uploadTime < size * 2 // 2ms per row max
    });
    
    console.log(`Upload ${size} rows (${fileSize} bytes): ${uploadTime}ms`);
  });
}