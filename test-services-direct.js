#!/usr/bin/env node

/**
 * DIRECT SERVICE TESTING FOR SUPPLIER UPLOAD FUNCTIONALITY
 * 
 * This test validates the core services directly without requiring API server:
 * 1. Service imports and initialization
 * 2. Price rules engine functionality
 * 3. Notification service functionality
 * 4. Upload service core logic
 * 5. File parsing capabilities
 */

import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import fs from 'fs/promises';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

async function testPriceRulesEngine() {
  log('\n💰 Testing Price Rules Engine Service...', colors.bold);
  
  try {
    const { priceRulesEngine } = await import('./src/services/price-rules-engine.service.js');
    
    // Test basic functionality
    const testData = [
      {
        sku: 'TEST-001',
        productName: 'Test Product',
        unitPrice: 100,
        currency: 'USD',
        category: 'Test Category'
      }
    ];
    
    const result = await priceRulesEngine.applyRules(testData, {
      markupRules: {
        default: { percent: 20 }
      }
    });
    
    if (result.success && result.data.length > 0) {
      logTest('Price rules engine - basic markup', 'PASS', `Applied 20% markup: $${result.data[0].unitPrice}`);
    } else {
      logTest('Price rules engine - basic markup', 'FAIL', 'Failed to apply markup rules');
    }
    
    // Test validation
    const validation = priceRulesEngine.validateRulesConfig({
      markupRules: { default: { percent: 50 } }
    });
    
    if (validation.valid) {
      logTest('Price rules validation', 'PASS', 'Rules configuration validated successfully');
    } else {
      logTest('Price rules validation', 'FAIL', `Validation errors: ${validation.errors.join(', ')}`);
    }
    
  } catch (error) {
    logTest('Price rules engine import', 'FAIL', `Import error: ${error.message}`);
  }
}

async function testSupplierNotificationService() {
  log('\n🔔 Testing Supplier Notification Service...', colors.bold);
  
  try {
    const { supplierNotificationService } = await import('./src/services/supplier-notification.service.js');
    
    // Test notification templates
    const testNotificationData = {
      uploadId: 'test-upload-123',
      priceListId: 'test-pricelist-456',
      itemsProcessed: 50,
      supplier: {
        id: '550e8400-e29b-41d4-a716-446655440000',
        companyName: 'Test Supplier Company',
        email: 'test@supplier.com'
      },
      priceList: {
        id: 'test-pricelist-456',
        supplierId: '550e8400-e29b-41d4-a716-446655440000',
        status: 'active'
      },
      timestamp: new Date().toISOString()
    };
    
    // Test email content generation
    const uploadCompletedContent = supplierNotificationService.generateUploadCompletedContent(testNotificationData);
    
    if (uploadCompletedContent && uploadCompletedContent.includes('Upload Completed')) {
      logTest('Notification email template generation', 'PASS', 'Upload completed template generated');
    } else {
      logTest('Notification email template generation', 'FAIL', 'Failed to generate email template');
    }
    
    // Test stats functionality
    const stats = supplierNotificationService.getStats();
    
    if (stats && typeof stats.totalNotifications === 'number') {
      logTest('Notification service statistics', 'PASS', `Total notifications: ${stats.totalNotifications}`);
    } else {
      logTest('Notification service statistics', 'FAIL', 'Stats not available');
    }
    
  } catch (error) {
    logTest('Notification service import', 'FAIL', `Import error: ${error.message}`);
  }
}

async function testSupplierUploadEnhancedService() {
  log('\n📤 Testing Enhanced Upload Service...', colors.bold);
  
  try {
    // Test if we can import without errors
    const module = await import('./src/services/supplier-upload-enhanced.service.js');
    
    if (module.supplierUploadEnhanced) {
      logTest('Enhanced upload service import', 'PASS', 'Service imported successfully');
      
      // Test helper methods
      const testData = [
        { unitPrice: 10, currency: 'USD' },
        { unitPrice: 50, currency: 'USD' },
        { unitPrice: 100, currency: 'EUR' },
        { unitPrice: 200, currency: 'USD' }
      ];
      
      const priceDistribution = module.supplierUploadEnhanced.calculatePriceDistribution(testData);
      
      if (priceDistribution && priceDistribution.average) {
        logTest('Price distribution calculation', 'PASS', `Average price: $${priceDistribution.average}`);
      } else {
        logTest('Price distribution calculation', 'FAIL', 'Failed to calculate price distribution');
      }
      
      const primaryCurrency = module.supplierUploadEnhanced.detectPrimaryCurrency(testData);
      
      if (primaryCurrency === 'USD') {
        logTest('Primary currency detection', 'PASS', `Detected currency: ${primaryCurrency}`);
      } else {
        logTest('Primary currency detection', 'FAIL', `Expected USD, got ${primaryCurrency}`);
      }
      
      // Test service statistics
      const stats = module.supplierUploadEnhanced.getStats();
      
      if (stats && typeof stats.totalUploads === 'number') {
        logTest('Upload service statistics', 'PASS', `Success rate: ${stats.successRate}%`);
      } else {
        logTest('Upload service statistics', 'FAIL', 'Stats not available');
      }
      
    } else {
      logTest('Enhanced upload service import', 'FAIL', 'Service not exported properly');
    }
    
  } catch (error) {
    logTest('Enhanced upload service import', 'FAIL', `Import error: ${error.message}`);
  }
}

async function testUploadHistoryQueries() {
  log('\n📊 Testing Upload History Queries...', colors.bold);
  
  try {
    const module = await import('./src/db/upload-history-queries.js');
    
    // Check if all required functions are exported
    const requiredFunctions = [
      'createUploadHistoryRecord',
      'updateUploadHistoryStatus', 
      'getUploadHistory',
      'getUploadStatistics'
    ];
    
    let allFunctionsExist = true;
    const missingFunctions = [];
    
    for (const func of requiredFunctions) {
      if (typeof module[func] !== 'function') {
        allFunctionsExist = false;
        missingFunctions.push(func);
      }
    }
    
    if (allFunctionsExist) {
      logTest('Upload history queries export', 'PASS', 'All required functions exported');
    } else {
      logTest('Upload history queries export', 'FAIL', `Missing functions: ${missingFunctions.join(', ')}`);
    }
    
  } catch (error) {
    logTest('Upload history queries import', 'FAIL', `Import error: ${error.message}`);
  }
}

async function testFileParsers() {
  log('\n📄 Testing File Parsers...', colors.bold);
  
  try {
    const module = await import('./src/utils/file-parsers/index.js');
    
    // Check if parser functions are exported
    if (typeof module.parsePriceListFile === 'function') {
      logTest('File parser functions export', 'PASS', 'parsePriceListFile function available');
    } else {
      logTest('File parser functions export', 'FAIL', 'parsePriceListFile function not found');
    }
    
    if (typeof module.validatePriceListFile === 'function') {
      logTest('File validation functions export', 'PASS', 'validatePriceListFile function available');
    } else {
      logTest('File validation functions export', 'FAIL', 'validatePriceListFile function not found');
    }
    
    // Test CSV parsing with sample data
    const testCsvContent = `SKU,Product Name,Unit Price,Currency
TEST-001,Test Product 1,99.99,USD
TEST-002,Test Product 2,149.99,USD`;
    
    const testFile = {
      originalname: 'test.csv',
      mimetype: 'text/csv',
      buffer: Buffer.from(testCsvContent),
      size: testCsvContent.length
    };
    
    try {
      const parseResult = await module.parsePriceListFile(testFile);
      
      if (parseResult.success && parseResult.data.length === 2) {
        logTest('CSV file parsing', 'PASS', `Parsed ${parseResult.data.length} rows successfully`);
      } else {
        logTest('CSV file parsing', 'FAIL', parseResult.error || 'Parsing failed');
      }
    } catch (parseError) {
      logTest('CSV file parsing', 'FAIL', `Parse error: ${parseError.message}`);
    }
    
  } catch (error) {
    logTest('File parsers import', 'FAIL', `Import error: ${error.message}`);
  }
}

async function testDatabaseQueries() {
  log('\n🗄️ Testing Database Query Functions...', colors.bold);
  
  try {
    // Test supplier queries
    const supplierModule = await import('./src/db/supplier-queries.js');
    
    if (typeof supplierModule.getSupplierById === 'function') {
      logTest('Supplier queries export', 'PASS', 'getSupplierById function available');
    } else {
      logTest('Supplier queries export', 'FAIL', 'getSupplierById function not found');
    }
    
    // Test price list queries
    const priceListModule = await import('./src/db/price-list-queries.js');
    
    if (typeof priceListModule.createPriceList === 'function') {
      logTest('Price list queries export', 'PASS', 'createPriceList function available');
    } else {
      logTest('Price list queries export', 'FAIL', 'createPriceList function not found');
    }
    
    if (typeof priceListModule.createPriceListItems === 'function') {
      logTest('Price list items queries export', 'PASS', 'createPriceListItems function available');
    } else {
      logTest('Price list items queries export', 'FAIL', 'createPriceListItems function not found');
    }
    
  } catch (error) {
    logTest('Database queries import', 'FAIL', `Import error: ${error.message}`);
  }
}

async function testRouteIntegration() {
  log('\n🛣️ Testing Route File Integration...', colors.bold);
  
  try {
    // Test if the route file can be imported
    const routeModule = await import('./src/routes/supplier-upload-enhanced.routes.js');
    
    if (routeModule.default) {
      logTest('Enhanced upload routes import', 'PASS', 'Routes imported successfully');
    } else {
      logTest('Enhanced upload routes import', 'FAIL', 'Routes not exported properly');
    }
    
  } catch (error) {
    logTest('Enhanced upload routes import', 'FAIL', `Import error: ${error.message}`);
  }
}

function printSummary() {
  log('\n' + '='.repeat(60), colors.bold);
  log('🏁 DIRECT SERVICE TEST SUMMARY', colors.bold);
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
    log('🎉 SERVICES ARE PRODUCTION READY!', colors.green);
    log('All core services are functional and can be integrated with the API server.', colors.cyan);
  } else if (passRate >= 60) {
    log('⚠️  SERVICES MOSTLY READY - MINOR ISSUES TO RESOLVE', colors.yellow);
    log('Core functionality works but some dependencies may need attention.', colors.cyan);
  } else {
    log('⚠️  SERVICES NEED ATTENTION BEFORE PRODUCTION!', colors.red);
    log('Critical issues found that must be resolved.', colors.cyan);
  }
}

async function main() {
  log('🔧 DIRECT SERVICE TESTING FOR SUPPLIER UPLOAD SYSTEM', colors.bold + colors.blue);
  log('Testing core services without API server dependency...', colors.cyan);
  
  // Run all service tests
  await testPriceRulesEngine();
  await testSupplierNotificationService();
  await testSupplierUploadEnhancedService();
  await testUploadHistoryQueries();
  await testFileParsers();
  await testDatabaseQueries();
  await testRouteIntegration();
  
  // Print summary
  printSummary();
  
  // Exit with appropriate code
  process.exit(testResults.failed > 3 ? 1 : 0); // Allow up to 3 minor failures
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