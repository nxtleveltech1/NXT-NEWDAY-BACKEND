#!/usr/bin/env node

/**
 * WooCommerce Sync Test Suite
 * Basic functionality testing for the bidirectional sync implementation
 */

const fetch = require('node-fetch');

const BASE_URL = process.env.NXT_API_URL || 'http://localhost:4000';
const API_BASE = `${BASE_URL}/api/woocommerce-sync`;

// Colors for console output
const colors = {
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  reset: '\x1b[0m',
  bold: '\x1b[1m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

async function makeRequest(endpoint, options = {}) {
  const url = `${API_BASE}${endpoint}`;
  
  try {
    const response = await fetch(url, {
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      },
      ...options
    });
    
    const data = await response.json();
    
    return {
      success: response.ok,
      status: response.status,
      data
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

async function testConnectionHealth() {
  log('blue', '\n🔍 Testing WooCommerce API Connection...');
  
  const result = await makeRequest('/connection/test');
  
  if (result.success && result.data.success) {
    log('green', '✅ Connection test passed');
    console.log('   Connected:', result.data.data.connected);
    console.log('   Store URL:', process.env.WOOCOMMERCE_SITE_URL || 'Not configured');
  } else {
    log('red', '❌ Connection test failed');
    console.log('   Error:', result.data?.error || result.error);
    console.log('   💡 Check your WooCommerce API credentials in .env file');
  }
  
  return result.success;
}

async function testSyncStatus() {
  log('blue', '\n📊 Testing Sync Status...');
  
  const result = await makeRequest('/status');
  
  if (result.success && result.data.success) {
    log('green', '✅ Sync status retrieved successfully');
    const data = result.data.data;
    
    console.log('   📈 Sync Statistics:');
    console.log(`      Customers: ${data.customers?.syncedCount || 0} synced`);
    console.log(`      Products: ${data.products?.syncedCount || 0} synced`);
    console.log(`      Orders: ${data.orders?.syncedCount || 0} synced`);
    console.log(`      Connection: ${data.connection?.connected ? 'Connected' : 'Disconnected'}`);
  } else {
    log('red', '❌ Sync status test failed');
    console.log('   Error:', result.data?.error || result.error);
  }
  
  return result.success;
}

async function testCustomerPull() {
  log('blue', '\n👥 Testing Customer Pull (First 5)...');
  
  const result = await makeRequest('/sync/customers/pull', {
    method: 'POST',
    body: JSON.stringify({
      force: false,
      limit: 5,
      page: 1
    })
  });
  
  if (result.success && result.data.success) {
    log('green', '✅ Customer pull test completed');
    const data = result.data.data;
    console.log(`   📥 Synced: ${data.synced}/${data.total} customers`);
    console.log(`   🔄 Has more pages: ${data.hasMore}`);
    
    if (data.errors?.length > 0) {
      log('yellow', `   ⚠️  ${data.errors.length} errors occurred`);
      data.errors.slice(0, 3).forEach(err => {
        console.log(`      - ${err.email}: ${err.error}`);
      });
    }
  } else {
    log('red', '❌ Customer pull test failed');
    console.log('   Error:', result.data?.error || result.error);
    
    if (result.status === 500) {
      log('yellow', '   💡 This might be due to missing WooCommerce credentials or API issues');
    }
  }
  
  return result.success;
}

async function testProductPull() {
  log('blue', '\n🛍️  Testing Product Pull (First 5)...');
  
  const result = await makeRequest('/sync/products/pull', {
    method: 'POST',
    body: JSON.stringify({
      force: false,
      limit: 5,
      page: 1,
      status: 'publish'
    })
  });
  
  if (result.success && result.data.success) {
    log('green', '✅ Product pull test completed');
    const data = result.data.data;
    console.log(`   📥 Synced: ${data.synced}/${data.total} products`);
    console.log(`   🔄 Has more pages: ${data.hasMore}`);
    
    if (data.errors?.length > 0) {
      log('yellow', `   ⚠️  ${data.errors.length} errors occurred`);
      data.errors.slice(0, 3).forEach(err => {
        console.log(`      - ${err.sku || err.name}: ${err.error}`);
      });
    }
  } else {
    log('red', '❌ Product pull test failed');
    console.log('   Error:', result.data?.error || result.error);
  }
  
  return result.success;
}

async function testWebhookEndpoint() {
  log('blue', '\n🔔 Testing Webhook Endpoint...');
  
  const testData = {
    event: 'product.updated',
    data: {
      id: 999,
      name: 'Test Product',
      sku: 'TEST-SKU-999',
      stock_quantity: 100,
      price: '29.99',
      manage_stock: true
    }
  };
  
  const result = await makeRequest('/webhook/test', {
    method: 'POST',
    body: JSON.stringify(testData)
  });
  
  if (result.success && result.data.success) {
    log('green', '✅ Webhook test completed');
    console.log('   📨 Test webhook processed successfully');
  } else {
    log('red', '❌ Webhook test failed');
    console.log('   Error:', result.data?.error || result.error);
  }
  
  return result.success;
}

async function testAnalytics() {
  log('blue', '\n📈 Testing Analytics...');
  
  const result = await makeRequest('/analytics?timeframe=30d');
  
  if (result.success && result.data.success) {
    log('green', '✅ Analytics test completed');
    const data = result.data.data;
    
    console.log('   📊 Analytics Data:');
    console.log(`      Timeframe: ${data.timeframe}`);
    console.log(`      Customer Stats: ${JSON.stringify(data.customerStats || {}, null, 2).slice(0, 100)}...`);
    console.log(`      Product Stats: ${JSON.stringify(data.productStats || {}, null, 2).slice(0, 100)}...`);
  } else {
    log('red', '❌ Analytics test failed');
    console.log('   Error:', result.data?.error || result.error);
  }
  
  return result.success;
}

async function runAllTests() {
  log('bold', '🚀 WooCommerce Sync Test Suite Starting...');
  log('blue', `📍 Testing API at: ${API_BASE}`);
  
  const tests = [
    { name: 'Connection Health', fn: testConnectionHealth },
    { name: 'Sync Status', fn: testSyncStatus },
    { name: 'Customer Pull', fn: testCustomerPull },
    { name: 'Product Pull', fn: testProductPull },
    { name: 'Webhook Endpoint', fn: testWebhookEndpoint },
    { name: 'Analytics', fn: testAnalytics }
  ];
  
  let passed = 0;
  let total = tests.length;
  
  for (const test of tests) {
    const success = await test.fn();
    if (success) passed++;
  }
  
  // Summary
  log('bold', '\n' + '='.repeat(50));
  log('bold', '📋 TEST SUMMARY');
  log('bold', '='.repeat(50));
  
  if (passed === total) {
    log('green', `✅ All ${total} tests passed! 🎉`);
  } else {
    log('yellow', `⚠️  ${passed}/${total} tests passed`);
    
    if (passed === 0) {
      log('red', '\n🚨 No tests passed. Check your configuration:');
      console.log('   1. Ensure NXT backend server is running');
      console.log('   2. Configure WooCommerce API credentials in .env');
      console.log('   3. Verify WooCommerce store is accessible');
      console.log('   4. Check database connectivity');
    }
  }
  
  log('blue', '\n📝 For detailed setup instructions, see: WOOCOMMERCE_SYNC_README.md');
  
  process.exit(passed === total ? 0 : 1);
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  log('yellow', '\n⚠️  Test suite interrupted');
  process.exit(1);
});

// Run tests if script is executed directly
if (require.main === module) {
  runAllTests().catch(error => {
    log('red', `\n💥 Test suite crashed: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  runAllTests,
  testConnectionHealth,
  testSyncStatus,
  testCustomerPull,
  testProductPull,
  testWebhookEndpoint,
  testAnalytics
};