#!/usr/bin/env node

/**
 * Comprehensive Validation Checklist Script
 * Tests all critical components of the NXT NEW DAY application
 */

const axios = require('axios');
const chalk = require('chalk');
const { Pool } = require('pg');
const fs = require('fs').promises;
const path = require('path');

// Configuration
const config = {
  apiBaseUrl: process.env.API_URL || 'http://localhost:5000',
  frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'nxt_db',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres'
  }
};

const pool = new Pool(config.database);

// Test results storage
const testResults = {
  passed: [],
  failed: [],
  warnings: []
};

// Helper functions
const logTest = (testName, status, message = '') => {
  const timestamp = new Date().toISOString();
  if (status === 'pass') {
    console.log(chalk.green(`✓ ${testName}`));
    testResults.passed.push({ test: testName, timestamp, message });
  } else if (status === 'fail') {
    console.log(chalk.red(`✗ ${testName}: ${message}`));
    testResults.failed.push({ test: testName, timestamp, message });
  } else if (status === 'warn') {
    console.log(chalk.yellow(`⚠ ${testName}: ${message}`));
    testResults.warnings.push({ test: testName, timestamp, message });
  }
};

const testWithTimeout = async (testFunc, timeout = 5000) => {
  return Promise.race([
    testFunc(),
    new Promise((_, reject) => 
      setTimeout(() => reject(new Error('Test timeout')), timeout)
    )
  ]);
};

// Test Categories
const tests = {
  // 1. Database Connectivity and Schema
  async testDatabaseConnection() {
    try {
      const client = await pool.connect();
      const result = await client.query('SELECT NOW()');
      client.release();
      logTest('Database Connection', 'pass');
      return true;
    } catch (error) {
      logTest('Database Connection', 'fail', error.message);
      return false;
    }
  },

  async testDatabaseSchema() {
    try {
      const requiredTables = [
        'users', 'customers', 'suppliers', 'products', 'invoices',
        'purchase_orders', 'supplier_purchase_orders', 'price_lists',
        'inventory', 'customer_segments', 'customer_purchase_history'
      ];

      const client = await pool.connect();
      
      for (const table of requiredTables) {
        const result = await client.query(
          "SELECT EXISTS (SELECT FROM information_schema.tables WHERE table_name = $1)",
          [table]
        );
        
        if (!result.rows[0].exists) {
          logTest(`Table: ${table}`, 'fail', 'Table does not exist');
        } else {
          logTest(`Table: ${table}`, 'pass');
        }
      }
      
      client.release();
      return true;
    } catch (error) {
      logTest('Database Schema Check', 'fail', error.message);
      return false;
    }
  },

  // 2. API Endpoint Tests
  async testAPIEndpoints() {
    const endpoints = [
      { path: '/api/health', method: 'GET', description: 'Health Check' },
      { path: '/api/auth/login', method: 'POST', description: 'Authentication', requiresAuth: false },
      { path: '/api/customers', method: 'GET', description: 'Customers List' },
      { path: '/api/suppliers', method: 'GET', description: 'Suppliers List' },
      { path: '/api/products', method: 'GET', description: 'Products List' },
      { path: '/api/invoices', method: 'GET', description: 'Invoices List' },
      { path: '/api/purchase-orders', method: 'GET', description: 'Purchase Orders' },
      { path: '/api/analytics/dashboard', method: 'GET', description: 'Analytics Dashboard' },
      { path: '/api/reports/summary', method: 'GET', description: 'Reports Summary' }
    ];

    // First try to get auth token
    let authToken = null;
    try {
      const authResponse = await axios.post(`${config.apiBaseUrl}/api/auth/login`, {
        email: 'admin@nxtday.com',
        password: 'admin123'
      });
      authToken = authResponse.data.token;
      logTest('API Authentication', 'pass');
    } catch (error) {
      logTest('API Authentication', 'warn', 'Could not authenticate - some tests may fail');
    }

    for (const endpoint of endpoints) {
      try {
        const headers = authToken && endpoint.requiresAuth !== false 
          ? { Authorization: `Bearer ${authToken}` }
          : {};

        const response = await testWithTimeout(async () => {
          if (endpoint.method === 'GET') {
            return await axios.get(`${config.apiBaseUrl}${endpoint.path}`, { headers });
          } else if (endpoint.method === 'POST') {
            return await axios.post(`${config.apiBaseUrl}${endpoint.path}`, {}, { headers });
          }
        });

        if (response && response.status < 400) {
          logTest(`API Endpoint: ${endpoint.description}`, 'pass');
        } else {
          logTest(`API Endpoint: ${endpoint.description}`, 'fail', `Status: ${response.status}`);
        }
      } catch (error) {
        const message = error.response?.status === 401 ? 'Unauthorized' : error.message;
        logTest(`API Endpoint: ${endpoint.description}`, 'fail', message);
      }
    }
  },

  // 3. Middleware Validation
  async testMiddleware() {
    const middlewareTests = [
      {
        name: 'Rate Limiting',
        test: async () => {
          const promises = [];
          for (let i = 0; i < 150; i++) {
            promises.push(axios.get(`${config.apiBaseUrl}/api/health`));
          }
          
          try {
            await Promise.all(promises);
            return { pass: false, message: 'Rate limiting not working' };
          } catch (error) {
            if (error.response?.status === 429) {
              return { pass: true };
            }
            return { pass: false, message: error.message };
          }
        }
      },
      {
        name: 'CORS Headers',
        test: async () => {
          try {
            const response = await axios.get(`${config.apiBaseUrl}/api/health`, {
              headers: { 'Origin': 'http://localhost:3000' }
            });
            
            const corsHeaders = response.headers['access-control-allow-origin'];
            if (corsHeaders) {
              return { pass: true };
            }
            return { pass: false, message: 'CORS headers not set' };
          } catch (error) {
            return { pass: false, message: error.message };
          }
        }
      },
      {
        name: 'Security Headers',
        test: async () => {
          try {
            const response = await axios.get(`${config.apiBaseUrl}/api/health`);
            const requiredHeaders = [
              'x-content-type-options',
              'x-frame-options',
              'x-xss-protection'
            ];
            
            const missingHeaders = requiredHeaders.filter(h => !response.headers[h]);
            
            if (missingHeaders.length === 0) {
              return { pass: true };
            }
            return { pass: false, message: `Missing headers: ${missingHeaders.join(', ')}` };
          } catch (error) {
            return { pass: false, message: error.message };
          }
        }
      }
    ];

    for (const test of middlewareTests) {
      try {
        const result = await testWithTimeout(test.test);
        logTest(`Middleware: ${test.name}`, result.pass ? 'pass' : 'fail', result.message);
      } catch (error) {
        logTest(`Middleware: ${test.name}`, 'fail', error.message);
      }
    }
  },

  // 4. Performance Tests
  async testPerformance() {
    const performanceTests = [
      {
        name: 'API Response Time',
        endpoint: '/api/health',
        maxTime: 100 // ms
      },
      {
        name: 'Database Query Performance',
        query: 'SELECT COUNT(*) FROM customers',
        maxTime: 50 // ms
      },
      {
        name: 'Static Asset Loading',
        endpoint: '/',
        maxTime: 200 // ms
      }
    ];

    for (const test of performanceTests) {
      try {
        const startTime = Date.now();
        
        if (test.endpoint) {
          await axios.get(`${config.apiBaseUrl}${test.endpoint}`);
        } else if (test.query) {
          const client = await pool.connect();
          await client.query(test.query);
          client.release();
        }
        
        const endTime = Date.now();
        const duration = endTime - startTime;
        
        if (duration <= test.maxTime) {
          logTest(`Performance: ${test.name}`, 'pass', `${duration}ms`);
        } else {
          logTest(`Performance: ${test.name}`, 'warn', `${duration}ms (threshold: ${test.maxTime}ms)`);
        }
      } catch (error) {
        logTest(`Performance: ${test.name}`, 'fail', error.message);
      }
    }
  },

  // 5. Cache Service Tests
  async testCacheService() {
    try {
      // Test Redis connection if configured
      const cacheEndpoint = `${config.apiBaseUrl}/api/cache/health`;
      const response = await axios.get(cacheEndpoint);
      
      if (response.data.status === 'healthy') {
        logTest('Cache Service', 'pass');
      } else {
        logTest('Cache Service', 'warn', 'Cache service degraded');
      }
    } catch (error) {
      if (error.response?.status === 404) {
        logTest('Cache Service', 'warn', 'Cache endpoint not implemented');
      } else {
        logTest('Cache Service', 'fail', error.message);
      }
    }
  },

  // 6. Frontend Tests
  async testFrontend() {
    const frontendTests = [
      {
        name: 'Homepage Accessibility',
        url: config.frontendUrl
      },
      {
        name: 'API Integration',
        url: `${config.frontendUrl}/api/health`
      }
    ];

    for (const test of frontendTests) {
      try {
        const response = await testWithTimeout(
          () => axios.get(test.url),
          10000
        );
        
        if (response.status === 200) {
          logTest(`Frontend: ${test.name}`, 'pass');
        } else {
          logTest(`Frontend: ${test.name}`, 'fail', `Status: ${response.status}`);
        }
      } catch (error) {
        logTest(`Frontend: ${test.name}`, 'fail', error.message);
      }
    }
  },

  // 7. File System Tests
  async testFileSystem() {
    const requiredPaths = [
      { path: path.join(__dirname, '../../uploads'), type: 'directory' },
      { path: path.join(__dirname, '../../logs'), type: 'directory' },
      { path: path.join(__dirname, '../../.env'), type: 'file' }
    ];

    for (const item of requiredPaths) {
      try {
        const stats = await fs.stat(item.path);
        if (item.type === 'directory' && stats.isDirectory()) {
          logTest(`Path: ${item.path}`, 'pass');
        } else if (item.type === 'file' && stats.isFile()) {
          logTest(`Path: ${item.path}`, 'pass');
        } else {
          logTest(`Path: ${item.path}`, 'fail', 'Wrong type');
        }
      } catch (error) {
        if (error.code === 'ENOENT') {
          logTest(`Path: ${item.path}`, 'warn', 'Does not exist');
        } else {
          logTest(`Path: ${item.path}`, 'fail', error.message);
        }
      }
    }
  }
};

// Main execution
async function runValidation() {
  console.log(chalk.blue('='.repeat(60)));
  console.log(chalk.blue.bold('NXT NEW DAY - Comprehensive Validation Checklist'));
  console.log(chalk.blue('='.repeat(60)));
  console.log();

  const startTime = Date.now();

  // Run all tests
  console.log(chalk.yellow.bold('1. Database Tests'));
  console.log(chalk.yellow('-'.repeat(40)));
  await tests.testDatabaseConnection();
  await tests.testDatabaseSchema();
  console.log();

  console.log(chalk.yellow.bold('2. API Endpoint Tests'));
  console.log(chalk.yellow('-'.repeat(40)));
  await tests.testAPIEndpoints();
  console.log();

  console.log(chalk.yellow.bold('3. Middleware Tests'));
  console.log(chalk.yellow('-'.repeat(40)));
  await tests.testMiddleware();
  console.log();

  console.log(chalk.yellow.bold('4. Performance Tests'));
  console.log(chalk.yellow('-'.repeat(40)));
  await tests.testPerformance();
  console.log();

  console.log(chalk.yellow.bold('5. Cache Service Tests'));
  console.log(chalk.yellow('-'.repeat(40)));
  await tests.testCacheService();
  console.log();

  console.log(chalk.yellow.bold('6. Frontend Tests'));
  console.log(chalk.yellow('-'.repeat(40)));
  await tests.testFrontend();
  console.log();

  console.log(chalk.yellow.bold('7. File System Tests'));
  console.log(chalk.yellow('-'.repeat(40)));
  await tests.testFileSystem();
  console.log();

  // Summary
  const endTime = Date.now();
  const duration = ((endTime - startTime) / 1000).toFixed(2);

  console.log(chalk.blue('='.repeat(60)));
  console.log(chalk.blue.bold('Validation Summary'));
  console.log(chalk.blue('='.repeat(60)));
  console.log(chalk.green(`✓ Passed: ${testResults.passed.length}`));
  console.log(chalk.yellow(`⚠ Warnings: ${testResults.warnings.length}`));
  console.log(chalk.red(`✗ Failed: ${testResults.failed.length}`));
  console.log(chalk.blue(`⏱ Duration: ${duration}s`));
  console.log();

  // Save results
  const reportPath = path.join(__dirname, `validation-report-${Date.now()}.json`);
  await fs.writeFile(reportPath, JSON.stringify(testResults, null, 2));
  console.log(chalk.gray(`Report saved to: ${reportPath}`));

  // Exit with appropriate code
  process.exit(testResults.failed.length > 0 ? 1 : 0);
}

// Handle errors
process.on('unhandledRejection', (error) => {
  console.error(chalk.red('Unhandled error:'), error);
  process.exit(1);
});

// Run validation
runValidation().catch(error => {
  console.error(chalk.red('Validation failed:'), error);
  process.exit(1);
});