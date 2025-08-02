#!/usr/bin/env node

/**
 * EMERGENCY TEST SUITE FOR SUPPLIER UPLOAD FUNCTIONALITY
 * 
 * This test suite validates all critical components of the supplier upload system:
 * 1. Routes functionality and validation
 * 2. Service integration and data processing
 * 3. File parsing capabilities
 * 4. Database operations
 * 5. Error handling and recovery
 * 6. Real file upload simulation
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import FormData from 'form-data';
import fetch from 'node-fetch';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Test configuration
const config = {
  API_BASE_URL: process.env.API_BASE_URL || 'http://localhost:3000/api',
  TEST_SUPPLIER_ID: process.env.TEST_SUPPLIER_ID || '550e8400-e29b-41d4-a716-446655440000',
  TEST_FILES_DIR: join(__dirname, 'test-files'),
  TIMEOUT: 30000
};

// Test results tracking
const testResults = {
  total: 0,
  passed: 0,
  failed: 0,
  errors: []
};

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(message, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

function logTest(testName, status, details = '') {
  const statusColor = status === 'PASS' ? colors.green : colors.red;
  const statusSymbol = status === 'PASS' ? '✅' : '❌';
  log(`${statusSymbol} ${testName}`, statusColor);
  if (details) {
    log(`   ${details}`, colors.cyan);
  }
  
  testResults.total++;
  if (status === 'PASS') {
    testResults.passed++;
  } else {
    testResults.failed++;
    testResults.errors.push({ test: testName, details });
  }
}

async function createTestFiles() {
  try {
    await fs.mkdir(config.TEST_FILES_DIR, { recursive: true });
    
    // Create test CSV file
    const csvContent = `SKU,Product Name,Description,Unit Price,Currency,Category,Minimum Order Quantity,Lead Time Days,Stock Level
AUDIO-001,Professional Headphones,High-quality studio headphones,299.99,USD,Audio Equipment,1,7,50
AUDIO-002,Wireless Microphone,Professional wireless microphone system,599.99,USD,Audio Equipment,1,10,25
CABLE-001,XLR Cable 5m,Professional XLR cable 5 meters,29.99,USD,Cables,10,3,100
CABLE-002,USB Cable Type-C,High-speed USB Type-C cable,19.99,USD,Cables,25,2,200
STAND-001,Microphone Stand,Adjustable microphone boom stand,89.99,USD,Stands,1,5,30`;

    await fs.writeFile(join(config.TEST_FILES_DIR, 'test-pricelist.csv'), csvContent);
    
    // Create test JSON file
    const jsonContent = {
      priceList: {
        supplier: "Test Supplier",
        currency: "USD",
        effectiveDate: "2025-01-01",
        items: [
          {
            sku: "JSON-001",
            productName: "JSON Test Product",
            description: "Product for JSON upload test",
            unitPrice: 149.99,
            currency: "USD",
            category: "Test Category",
            minimumOrderQuantity: 1,
            leadTimeDays: 5,
            stockLevel: 75
          }
        ]
      }
    };

    await fs.writeFile(join(config.TEST_FILES_DIR, 'test-pricelist.json'), JSON.stringify(jsonContent, null, 2));
    
    log('✅ Test files created successfully', colors.green);
    return true;
  } catch (error) {
    log(`❌ Failed to create test files: ${error.message}`, colors.red);
    return false;
  }
}

async function testRouteValidation() {
  log('\n📋 Testing Route Validation...', colors.bold);
  
  try {
    // Test invalid supplier ID
    const response = await fetch(`${config.API_BASE_URL}/suppliers/invalid-uuid/upload-enhanced`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({})
    });
    
    if (response.status === 400) {
      logTest('Invalid supplier ID validation', 'PASS', 'Returns 400 for invalid UUID');
    } else {
      logTest('Invalid supplier ID validation', 'FAIL', `Expected 400, got ${response.status}`);
    }
  } catch (error) {
    logTest('Route validation connection', 'FAIL', `Cannot connect to API: ${error.message}`);
  }
}

async function testFileUpload() {
  log('\n📤 Testing File Upload Functionality...', colors.bold);
  
  try {
    const csvPath = join(config.TEST_FILES_DIR, 'test-pricelist.csv');
    const fileExists = await fs.access(csvPath).then(() => true).catch(() => false);
    
    if (!fileExists) {
      logTest('CSV file exists', 'FAIL', 'Test CSV file not found');
      return;
    }

    const form = new FormData();
    form.append('file', createReadStream(csvPath), {
      filename: 'test-pricelist.csv',
      contentType: 'text/csv'
    });
    form.append('options', JSON.stringify({
      requirePreview: false,
      autoActivate: true,
      notifySupplier: false
    }));

    const response = await fetch(`${config.API_BASE_URL}/suppliers/${config.TEST_SUPPLIER_ID}/upload-enhanced`, {
      method: 'POST',
      body: form,
      timeout: config.TIMEOUT
    });

    const result = await response.json();
    
    if (response.ok && result.success) {
      logTest('CSV file upload', 'PASS', `Upload ID: ${result.uploadId}`);
      
      // Test status endpoint
      if (result.statusEndpoint) {
        const statusResponse = await fetch(`${config.API_BASE_URL}${result.statusEndpoint}`);
        const statusResult = await statusResponse.json();
        
        if (statusResponse.ok) {
          logTest('Upload status check', 'PASS', `Status: ${statusResult.status?.status || 'unknown'}`);
        } else {
          logTest('Upload status check', 'FAIL', 'Status endpoint not working');
        }
      }
      
    } else {
      logTest('CSV file upload', 'FAIL', `${result.error || 'Upload failed'}`);
    }
    
  } catch (error) {
    logTest('File upload test', 'FAIL', `Upload error: ${error.message}`);
  }
}

async function testBulkUpload() {
  log('\n📦 Testing Bulk Upload Functionality...', colors.bold);
  
  try {
    const csvPath = join(config.TEST_FILES_DIR, 'test-pricelist.csv');
    const jsonPath = join(config.TEST_FILES_DIR, 'test-pricelist.json');
    
    const form = new FormData();
    form.append('files', createReadStream(csvPath), 'test-pricelist1.csv');
    form.append('files', createReadStream(jsonPath), 'test-pricelist2.json');
    form.append('supplierIds', JSON.stringify([config.TEST_SUPPLIER_ID, config.TEST_SUPPLIER_ID]));
    form.append('options', JSON.stringify({
      requirePreview: false,
      batchOperation: true
    }));

    const response = await fetch(`${config.API_BASE_URL}/suppliers/bulk-upload-enhanced`, {
      method: 'POST',
      body: form,
      timeout: config.TIMEOUT
    });

    const result = await response.json();
    
    if (response.status === 202 && result.success) {
      logTest('Bulk upload', 'PASS', `Batch ID: ${result.batchId}, Success: ${result.summary?.successful}/${result.summary?.total}`);
    } else {
      logTest('Bulk upload', 'FAIL', `${result.error || 'Bulk upload failed'}`);
    }
    
  } catch (error) {
    logTest('Bulk upload test', 'FAIL', `Bulk upload error: ${error.message}`);
  }
}

async function testPriceRulesValidation() {
  log('\n💰 Testing Price Rules Engine...', colors.bold);
  
  try {
    const rulesConfig = {
      markupRules: {
        default: { percent: 20 },
        byCategory: {
          "Audio Equipment": { percent: 30 },
          "Cables": { percent: 15 }
        }
      },
      discountRules: {
        byVolume: [
          { minQuantity: 10, percent: 5 },
          { minQuantity: 50, percent: 10 }
        ]
      }
    };

    const response = await fetch(`${config.API_BASE_URL}/suppliers/${config.TEST_SUPPLIER_ID}/validate-price-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rulesConfig })
    });

    const result = await response.json();
    
    if (response.ok && result.success) {
      logTest('Price rules validation', 'PASS', `Valid: ${result.validation?.valid}`);
    } else {
      logTest('Price rules validation', 'FAIL', `${result.error || 'Validation failed'}`);
    }
    
  } catch (error) {
    logTest('Price rules test', 'FAIL', `Price rules error: ${error.message}`);
  }
}

async function testNotificationSystem() {
  log('\n🔔 Testing Notification System...', colors.bold);
  
  try {
    const response = await fetch(`${config.API_BASE_URL}/suppliers/${config.TEST_SUPPLIER_ID}/notifications/test`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        notificationType: 'upload_completed',
        email: 'test@example.com'
      })
    });

    const result = await response.json();
    
    if (response.ok && result.success) {
      logTest('Notification system', 'PASS', 'Test notification sent successfully');
    } else {
      logTest('Notification system', 'FAIL', `${result.error || 'Notification failed'}`);
    }
    
  } catch (error) {
    logTest('Notification test', 'FAIL', `Notification error: ${error.message}`);
  }
}

async function testUploadHistory() {
  log('\n📊 Testing Upload History...', colors.bold);
  
  try {
    const response = await fetch(`${config.API_BASE_URL}/suppliers/${config.TEST_SUPPLIER_ID}/uploads/history?limit=5`);
    const result = await response.json();
    
    if (response.ok && result.success) {
      logTest('Upload history retrieval', 'PASS', `Found ${result.uploads?.length || 0} uploads`);
    } else {
      logTest('Upload history retrieval', 'FAIL', `${result.error || 'History retrieval failed'}`);
    }
    
  } catch (error) {
    logTest('Upload history test', 'FAIL', `History error: ${error.message}`);
  }
}

async function testStatistics() {
  log('\n📈 Testing Statistics...', colors.bold);
  
  try {
    const response = await fetch(`${config.API_BASE_URL}/suppliers/uploads/statistics`);
    const result = await response.json();
    
    if (response.ok && result.success) {
      logTest('Upload statistics', 'PASS', 'Statistics retrieved successfully');
    } else {
      logTest('Upload statistics', 'FAIL', `${result.error || 'Statistics failed'}`);
    }
    
  } catch (error) {
    logTest('Statistics test', 'FAIL', `Statistics error: ${error.message}`);
  }
}

async function testErrorHandling() {
  log('\n🚨 Testing Error Handling...', colors.bold);
  
  try {
    // Test with invalid file
    const form = new FormData();
    form.append('file', Buffer.from('invalid,csv,data\nwith,missing,headers'), {
      filename: 'invalid.csv',
      contentType: 'text/csv'
    });

    const response = await fetch(`${config.API_BASE_URL}/suppliers/${config.TEST_SUPPLIER_ID}/upload-enhanced`, {
      method: 'POST',
      body: form
    });

    const result = await response.json();
    
    if (!response.ok && result.error) {
      logTest('Error handling for invalid file', 'PASS', 'Properly returns error for invalid data');
    } else {
      logTest('Error handling for invalid file', 'FAIL', 'Should reject invalid file data');
    }
    
  } catch (error) {
    logTest('Error handling test', 'FAIL', `Error handling test failed: ${error.message}`);
  }
}

async function testDependencyServices() {
  log('\n🔧 Testing Service Dependencies...', colors.bold);
  
  try {
    // Test if all required services can be imported
    const servicePaths = [
      './src/services/supplier-upload-enhanced.service.js',
      './src/services/price-rules-engine.service.js', 
      './src/services/supplier-notification.service.js',
      './src/db/upload-history-queries.js'
    ];

    for (const servicePath of servicePaths) {
      try {
        const fullPath = join(__dirname, servicePath);
        await fs.access(fullPath);
        logTest(`Service exists: ${servicePath}`, 'PASS');
      } catch (error) {
        logTest(`Service exists: ${servicePath}`, 'FAIL', 'File not found');
      }
    }
    
  } catch (error) {
    logTest('Service dependency check', 'FAIL', `Dependency check failed: ${error.message}`);
  }
}

async function performHealthCheck() {
  log('\n❤️  Performing System Health Check...', colors.bold);
  
  try {
    const response = await fetch(`${config.API_BASE_URL}/health`, { timeout: 5000 });
    
    if (response.ok) {
      logTest('API server health', 'PASS', 'Server is responding');
    } else {
      logTest('API server health', 'FAIL', `Server returned ${response.status}`);
    }
    
  } catch (error) {
    logTest('API server health', 'FAIL', `Cannot connect to server: ${error.message}`);
  }
}

function printSummary() {
  log('\n' + '='.repeat(60), colors.bold);
  log('🏁 TEST SUMMARY', colors.bold);
  log('='.repeat(60), colors.bold);
  
  const passRate = testResults.total > 0 ? ((testResults.passed / testResults.total) * 100).toFixed(1) : 0;
  
  log(`Total Tests: ${testResults.total}`, colors.cyan);
  log(`Passed: ${testResults.passed}`, colors.green);
  log(`Failed: ${testResults.failed}`, colors.red);
  log(`Pass Rate: ${passRate}%`, passRate >= 80 ? colors.green : colors.red);
  
  if (testResults.failed > 0) {
    log('\n❌ FAILED TESTS:', colors.red);
    testResults.errors.forEach((error, index) => {
      log(`${index + 1}. ${error.test}`, colors.red);
      if (error.details) {
        log(`   ${error.details}`, colors.yellow);
      }
    });
  }
  
  log('\n' + '='.repeat(60), colors.bold);
  
  if (passRate >= 80) {
    log('🎉 SYSTEM READY FOR PRODUCTION!', colors.green);
  } else {
    log('⚠️  SYSTEM NEEDS ATTENTION BEFORE PRODUCTION!', colors.red);
  }
}

async function main() {
  log('🚀 EMERGENCY SUPPLIER UPLOAD SYSTEM TEST', colors.bold + colors.blue);
  log('Testing all critical functionality for production readiness...', colors.cyan);
  
  // Create test files
  const filesCreated = await createTestFiles();
  if (!filesCreated) {
    log('❌ Cannot continue without test files', colors.red);
    process.exit(1);
  }
  
  // Run all tests
  await performHealthCheck();
  await testDependencyServices();
  await testRouteValidation();
  await testFileUpload();
  await testBulkUpload();
  await testPriceRulesValidation();
  await testNotificationSystem();
  await testUploadHistory();
  await testStatistics();
  await testErrorHandling();
  
  // Print summary
  printSummary();
  
  // Exit with appropriate code
  process.exit(testResults.failed > 0 ? 1 : 0);
}

// Handle uncaught errors
process.on('unhandledRejection', (reason, promise) => {
  log(`❌ Unhandled Rejection: ${reason}`, colors.red);
  process.exit(1);
});

process.on('uncaughtException', (error) => {
  log(`❌ Uncaught Exception: ${error.message}`, colors.red);
  process.exit(1);
});

// Run the test suite
main().catch(error => {
  log(`❌ Test suite failed: ${error.message}`, colors.red);
  process.exit(1);
});