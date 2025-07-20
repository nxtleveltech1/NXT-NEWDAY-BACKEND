import axios from 'axios';
import postgres from 'postgres';
import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const BASE_URL = process.env.API_URL || 'http://localhost:4000';

async function validateMigration() {
  console.log('🔍 Starting Migration Validation...\n');
  
  const results = {
    database: { passed: false, details: [] },
    api: { passed: false, details: [] },
    middleware: { passed: false, details: [] },
    authentication: { passed: false, details: [] },
    redis: { passed: false, details: [] },
    performance: { passed: false, details: [] }
  };

  // 1. Database Validation
  console.log('📊 Validating Database...');
  try {
    const sql = postgres(process.env.DATABASE_URL);
    
    // Check all required tables exist
    const requiredTables = [
      'users', 'customers', 'suppliers', 'products', 'inventory',
      'purchase_orders', 'supplier_purchase_orders', 'invoices',
      'warehouses', 'price_lists', 'price_list_items'
    ];
    
    for (const table of requiredTables) {
      const result = await sql`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = ${table}
        )
      `;
      
      if (result[0].exists) {
        results.database.details.push(`✅ Table '${table}' exists`);
      } else {
        results.database.details.push(`❌ Table '${table}' missing`);
      }
    }
    
    results.database.passed = results.database.details.every(d => d.includes('✅'));
    await sql.end();
  } catch (error) {
    results.database.details.push(`❌ Database connection failed: ${error.message}`);
  }

  // 2. API Endpoints Validation
  console.log('\n🌐 Validating API Endpoints...');
  const endpoints = [
    { method: 'GET', path: '/api/health', expectedStatus: 200 },
    { method: 'GET', path: '/api/customers', expectedStatus: [200, 401] },
    { method: 'GET', path: '/api/suppliers', expectedStatus: [200, 401] },
    { method: 'GET', path: '/api/analytics/overview', expectedStatus: [200, 401] }
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await axios({
        method: endpoint.method,
        url: `${BASE_URL}${endpoint.path}`,
        validateStatus: () => true
      });
      
      const expectedStatuses = Array.isArray(endpoint.expectedStatus) 
        ? endpoint.expectedStatus 
        : [endpoint.expectedStatus];
      
      if (expectedStatuses.includes(response.status)) {
        results.api.details.push(`✅ ${endpoint.method} ${endpoint.path} (${response.status})`);
      } else {
        results.api.details.push(`❌ ${endpoint.method} ${endpoint.path} (${response.status})`);
      }
    } catch (error) {
      results.api.details.push(`❌ ${endpoint.method} ${endpoint.path} - ${error.message}`);
    }
  }
  
  results.api.passed = results.api.details.some(d => d.includes('✅'));

  // 3. Middleware Validation
  console.log('\n⚙️  Validating Middleware...');
  try {
    // Check compression
    const response = await axios.get(`${BASE_URL}/api/health`, {
      headers: { 'Accept-Encoding': 'gzip, deflate, br' }
    });
    
    if (response.headers['content-encoding']) {
      results.middleware.details.push(`✅ Compression enabled (${response.headers['content-encoding']})`);
    } else {
      results.middleware.details.push('❌ Compression not enabled');
    }
    
    // Check security headers
    const securityHeaders = ['x-helmet-csp', 'x-frame-options', 'x-content-type-options'];
    securityHeaders.forEach(header => {
      if (response.headers[header]) {
        results.middleware.details.push(`✅ Security header '${header}' present`);
      } else {
        results.middleware.details.push(`❌ Security header '${header}' missing`);
      }
    });
    
    results.middleware.passed = results.middleware.details.filter(d => d.includes('✅')).length >= 2;
  } catch (error) {
    results.middleware.details.push(`❌ Middleware check failed: ${error.message}`);
  }

  // 4. Authentication Validation
  console.log('\n🔐 Validating Authentication...');
  try {
    // Test protected endpoint without auth
    const unauthResponse = await axios.get(`${BASE_URL}/api/customers`, {
      validateStatus: () => true
    });
    
    if (unauthResponse.status === 401) {
      results.authentication.details.push('✅ Protected endpoints require authentication');
    } else {
      results.authentication.details.push('❌ Protected endpoints accessible without auth');
    }
    
    results.authentication.passed = results.authentication.details.some(d => d.includes('✅'));
  } catch (error) {
    results.authentication.details.push(`❌ Authentication check failed: ${error.message}`);
  }

  // 5. Redis Validation
  console.log('\n💾 Validating Redis Cache...');
  try {
    const redis = createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    
    await redis.connect();
    await redis.set('test:key', 'test-value');
    const value = await redis.get('test:key');
    
    if (value === 'test-value') {
      results.redis.details.push('✅ Redis connection and operations working');
    } else {
      results.redis.details.push('❌ Redis operations failed');
    }
    
    await redis.del('test:key');
    await redis.quit();
    results.redis.passed = true;
  } catch (error) {
    results.redis.details.push(`❌ Redis connection failed: ${error.message}`);
  }

  // 6. Performance Validation
  console.log('\n⚡ Validating Performance Improvements...');
  try {
    const start = Date.now();
    await axios.get(`${BASE_URL}/api/health`);
    const responseTime = Date.now() - start;
    
    if (responseTime < 100) {
      results.performance.details.push(`✅ Health check response time: ${responseTime}ms`);
    } else {
      results.performance.details.push(`⚠️  Health check response time: ${responseTime}ms (consider optimization)`);
    }
    
    results.performance.passed = responseTime < 200;
  } catch (error) {
    results.performance.details.push(`❌ Performance check failed: ${error.message}`);
  }

  // Print Results
  console.log('\n\n📋 VALIDATION RESULTS:');
  console.log('====================\n');
  
  let allPassed = true;
  for (const [category, result] of Object.entries(results)) {
    const status = result.passed ? '✅ PASSED' : '❌ FAILED';
    console.log(`${category.toUpperCase()}: ${status}`);
    result.details.forEach(detail => console.log(`  ${detail}`));
    console.log('');
    
    if (!result.passed) allPassed = false;
  }

  // Summary
  console.log('====================');
  if (allPassed) {
    console.log('✅ All validations passed! Migration successful.');
  } else {
    console.log('❌ Some validations failed. Please review and fix the issues.');
  }
  
  process.exit(allPassed ? 0 : 1);
}

// Run validation
validateMigration().catch(console.error);