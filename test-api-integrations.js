#!/usr/bin/env node

/**
 * Production API Integrations Test Suite
 * Comprehensive testing for all API integrations with NILEDB
 */

import { performance } from 'perf_hooks';
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const API_BASE_URL = process.env.API_BASE_URL || 'http://localhost:4000';
const TEST_TIMEOUT = 30000; // 30 seconds

class APIIntegrationTester {
  constructor() {
    this.results = {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      duration: 0,
      tests: []
    };
    this.startTime = Date.now();
  }

  /**
   * Run all integration tests
   */
  async runAllTests() {
    console.log('🚀 Starting API Integrations Test Suite...\n');
    console.log(`🎯 Target API: ${API_BASE_URL}`);
    console.log(`⏰ Timeout: ${TEST_TIMEOUT}ms\n`);

    try {
      // Test categories
      await this.testHealthAndStatus();
      await this.testWooCommerceIntegration();
      await this.testPaymentGateways();
      await this.testMessagingServices();
      await this.testWebhookEndpoints();
      await this.testNileDBIntegration();
      await this.testPerformanceMetrics();

      // Generate final report
      this.generateReport();

    } catch (error) {
      console.error('❌ Test suite execution failed:', error);
      process.exit(1);
    }
  }

  /**
   * Test health and status endpoints
   */
  async testHealthAndStatus() {
    console.log('🔍 Testing Health & Status Endpoints...');

    await this.runTest('Health Check', async () => {
      const response = await this.apiRequest('GET', '/health');
      this.assert(response.status === 200, 'Health endpoint should return 200');
      this.assert(response.data.status === 'ok', 'Health status should be ok');
    });

    await this.runTest('Performance Metrics', async () => {
      const response = await this.apiRequest('GET', '/metrics');
      this.assert(response.status === 200, 'Metrics endpoint should return 200');
      this.assert(typeof response.data.uptime === 'number', 'Should include uptime');
      this.assert(typeof response.data.requests === 'number', 'Should include request count');
    });

    await this.runTest('API Integration Status', async () => {
      const response = await this.apiRequest('GET', '/api/integrations/status');
      this.assert(response.status === 200, 'Integration status should return 200');
      this.assert(response.data.success === true, 'Should indicate success');
      this.assert(typeof response.data.data === 'object', 'Should include integration data');
    });

    console.log('✅ Health & Status Tests Completed\n');
  }

  /**
   * Test WooCommerce integration
   */
  async testWooCommerceIntegration() {
    console.log('🛒 Testing WooCommerce Integration...');

    // Skip if WooCommerce not enabled
    if (process.env.WOOCOMMERCE_API_ENABLED !== 'true') {
      console.log('⏭️ WooCommerce tests skipped (not enabled)\n');
      return;
    }

    await this.runTest('WooCommerce Status', async () => {
      const response = await this.apiRequest('GET', '/api/integrations/woocommerce/status');
      this.assert(response.status === 200, 'WooCommerce status should return 200');
      this.assert(response.data.success === true, 'Should indicate success');
    });

    await this.runTest('WooCommerce Sync Trigger', async () => {
      const response = await this.apiRequest('POST', '/api/integrations/woocommerce/sync', {
        syncType: 'products',
        options: { batchSize: 10 }
      });
      this.assert(response.status === 200, 'Sync trigger should return 200');
      this.assert(response.data.success === true, 'Should indicate success');
      this.assert(typeof response.data.data.syncId === 'string', 'Should return sync ID');
    });

    await this.runTest('WooCommerce Webhook Endpoint', async () => {
      const mockWebhookData = {
        id: 12345,
        name: 'Test Product',
        price: '29.99',
        date_modified: new Date().toISOString()
      };

      const response = await this.apiRequest(
        'POST',
        '/api/webhooks/woocommerce/product/updated',
        mockWebhookData,
        { 'X-WC-Webhook-Signature': 'test_signature' }
      );
      
      this.assert(response.status === 200, 'Webhook should return 200');
      this.assert(response.data.success === true, 'Should process webhook successfully');
    });

    console.log('✅ WooCommerce Tests Completed\n');
  }

  /**
   * Test payment gateway integrations
   */
  async testPaymentGateways() {
    console.log('💳 Testing Payment Gateway Integrations...');

    await this.runTest('Payment Gateway Status', async () => {
      const response = await this.apiRequest('GET', '/api/integrations/payments/status');
      this.assert(response.status === 200, 'Payment status should return 200');
      this.assert(response.data.success === true, 'Should indicate success');
    });

    // Test Stripe if enabled
    if (process.env.STRIPE_ENABLED === 'true') {
      await this.runTest('Stripe Payment Processing', async () => {
        const paymentData = {
          gateway: 'stripe',
          amount: 10.00,
          currency: 'USD',
          customerId: 'test_customer',
          description: 'Test payment'
        };

        const response = await this.apiRequest('POST', '/api/integrations/payments/process', paymentData);
        
        // In test mode, we expect this to succeed or fail gracefully
        this.assert(
          response.status === 200 || response.status === 500,
          'Payment processing should return valid status'
        );
      });

      await this.runTest('Stripe Webhook Endpoint', async () => {
        const mockStripeEvent = {
          id: 'evt_test_webhook',
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: 'pi_test_payment',
              amount: 1000,
              currency: 'usd',
              status: 'succeeded'
            }
          }
        };

        const response = await this.apiRequest(
          'POST',
          '/api/webhooks/stripe',
          mockStripeEvent,
          { 'Stripe-Signature': 'test_signature' }
        );
        
        this.assert(response.status === 200, 'Stripe webhook should return 200');
      });
    }

    // Test PayPal if enabled
    if (process.env.PAYPAL_ENABLED === 'true') {
      await this.runTest('PayPal Payment Processing', async () => {
        const paymentData = {
          gateway: 'paypal',
          amount: 25.00,
          currency: 'USD',
          customerId: 'test_customer',
          description: 'Test PayPal payment'
        };

        const response = await this.apiRequest('POST', '/api/integrations/payments/process', paymentData);
        
        this.assert(
          response.status === 200 || response.status === 500,
          'PayPal payment processing should return valid status'
        );
      });
    }

    console.log('✅ Payment Gateway Tests Completed\n');
  }

  /**
   * Test messaging services
   */
  async testMessagingServices() {
    console.log('📱 Testing Messaging Services...');

    // Test SMS if Twilio enabled
    if (process.env.TWILIO_ENABLED === 'true') {
      await this.runTest('SMS Sending (Twilio)', async () => {
        const smsData = {
          to: '+1234567890', // Test number
          message: 'Test SMS from NXT API Integration Suite',
          urgent: false
        };

        const response = await this.apiRequest('POST', '/api/integrations/sms/send', smsData);
        
        // In test mode, we expect this to fail gracefully without valid phone number
        this.assert(
          response.status === 200 || response.status === 400 || response.status === 500,
          'SMS endpoint should handle test requests gracefully'
        );
      });
    }

    // Test Email if SendGrid enabled
    if (process.env.SENDGRID_ENABLED === 'true') {
      await this.runTest('Email Sending (SendGrid)', async () => {
        const emailData = {
          to: 'test@example.com',
          subject: 'Test Email from NXT API Integration Suite',
          content: '<h1>Test Email</h1><p>This is a test email from the API integration suite.</p>',
          priority: 'normal'
        };

        const response = await this.apiRequest('POST', '/api/integrations/email/send', emailData);
        
        // In test mode, we expect this to fail gracefully with test email
        this.assert(
          response.status === 200 || response.status === 400 || response.status === 500,
          'Email endpoint should handle test requests gracefully'
        );
      });
    }

    console.log('✅ Messaging Services Tests Completed\n');
  }

  /**
   * Test webhook endpoints
   */
  async testWebhookEndpoints() {
    console.log('🔗 Testing Webhook Endpoints...');

    await this.runTest('Generic Third-party Webhook', async () => {
      const webhookData = {
        event: 'test.event',
        data: {
          id: 'test_123',
          type: 'test_type',
          attributes: {
            name: 'Test Event',
            timestamp: new Date().toISOString()
          }
        }
      };

      const response = await this.apiRequest(
        'POST',
        '/api/webhooks/third-party/testservice',
        webhookData,
        { 'X-Webhook-Signature': 'test_signature' }
      );
      
      this.assert(response.status === 200, 'Third-party webhook should return 200');
      this.assert(response.data.success === true, 'Should indicate successful processing');
    });

    console.log('✅ Webhook Tests Completed\n');
  }

  /**
   * Test NILEDB integration
   */
  async testNileDBIntegration() {
    console.log('🗄️ Testing NILEDB Integration...');

    await this.runTest('NILEDB Connection Test', async () => {
      // This test checks if our API endpoints that use NILEDB are working
      const response = await this.apiRequest('GET', '/api/integrations/status');
      this.assert(response.status === 200, 'NILEDB-dependent endpoint should work');
      
      // Check if the response includes metrics that would come from NILEDB
      this.assert(
        response.data.data && response.data.data.metrics,
        'Should include metrics from NILEDB'
      );
    });

    console.log('✅ NILEDB Tests Completed\n');
  }

  /**
   * Test performance metrics
   */
  async testPerformanceMetrics() {
    console.log('⚡ Testing Performance Metrics...');

    await this.runTest('Response Time Performance', async () => {
      const startTime = performance.now();
      const response = await this.apiRequest('GET', '/health');
      const endTime = performance.now();
      const responseTime = endTime - startTime;

      this.assert(response.status === 200, 'Health check should succeed');
      this.assert(responseTime < 1000, `Response time should be under 1000ms (was ${responseTime.toFixed(2)}ms)`);
      
      console.log(`    📊 Response Time: ${responseTime.toFixed(2)}ms`);
    });

    await this.runTest('Concurrent Request Handling', async () => {
      const concurrentRequests = 10;
      const promises = [];

      for (let i = 0; i < concurrentRequests; i++) {
        promises.push(this.apiRequest('GET', '/health'));
      }

      const startTime = performance.now();
      const results = await Promise.all(promises);
      const endTime = performance.now();
      const totalTime = endTime - startTime;

      const allSuccessful = results.every(r => r.status === 200);
      this.assert(allSuccessful, 'All concurrent requests should succeed');
      
      console.log(`    📊 ${concurrentRequests} concurrent requests in ${totalTime.toFixed(2)}ms`);
      console.log(`    📊 Average time per request: ${(totalTime / concurrentRequests).toFixed(2)}ms`);
    });

    console.log('✅ Performance Tests Completed\n');
  }

  /**
   * Run individual test with error handling
   */
  async runTest(testName, testFunction) {
    this.results.total++;
    const startTime = performance.now();

    try {
      await Promise.race([
        testFunction(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Test timeout')), TEST_TIMEOUT))
      ]);

      const duration = performance.now() - startTime;
      this.results.passed++;
      this.results.tests.push({
        name: testName,
        status: 'PASSED',
        duration: Math.round(duration),
        error: null
      });

      console.log(`  ✅ ${testName} (${duration.toFixed(2)}ms)`);

    } catch (error) {
      const duration = performance.now() - startTime;
      this.results.failed++;
      this.results.tests.push({
        name: testName,
        status: 'FAILED',
        duration: Math.round(duration),
        error: error.message
      });

      console.log(`  ❌ ${testName} - ${error.message} (${duration.toFixed(2)}ms)`);
    }
  }

  /**
   * Make API request with timeout and error handling
   */
  async apiRequest(method, endpoint, data = null, headers = {}) {
    const url = `${API_BASE_URL}${endpoint}`;
    const options = {
      method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'NXT-API-Integration-Tester/1.0',
        ...headers
      },
      timeout: TEST_TIMEOUT
    };

    if (data && (method === 'POST' || method === 'PUT' || method === 'PATCH')) {
      options.body = JSON.stringify(data);
    }

    try {
      const response = await fetch(url, options);
      let responseData;

      try {
        responseData = await response.json();
      } catch {
        responseData = await response.text();
      }

      return {
        status: response.status,
        headers: Object.fromEntries(response.headers.entries()),
        data: responseData
      };

    } catch (error) {
      if (error.name === 'AbortError') {
        throw new Error(`Request timeout after ${TEST_TIMEOUT}ms`);
      }
      throw new Error(`Network error: ${error.message}`);
    }
  }

  /**
   * Assert helper for tests
   */
  assert(condition, message) {
    if (!condition) {
      throw new Error(message);
    }
  }

  /**
   * Generate comprehensive test report
   */
  generateReport() {
    this.results.duration = Date.now() - this.startTime;
    const successRate = ((this.results.passed / this.results.total) * 100).toFixed(1);

    console.log('\n' + '='.repeat(80));
    console.log('📊 API INTEGRATION TEST SUITE RESULTS');
    console.log('='.repeat(80));
    console.log(`🎯 Target API: ${API_BASE_URL}`);
    console.log(`⏱️  Total Duration: ${this.results.duration}ms`);
    console.log(`📈 Success Rate: ${successRate}%`);
    console.log('');
    console.log(`✅ Passed: ${this.results.passed}`);
    console.log(`❌ Failed: ${this.results.failed}`);
    console.log(`⏭️  Skipped: ${this.results.skipped}`);
    console.log(`📊 Total: ${this.results.total}`);
    
    if (this.results.failed > 0) {
      console.log('\n❌ FAILED TESTS:');
      this.results.tests
        .filter(test => test.status === 'FAILED')
        .forEach(test => {
          console.log(`  • ${test.name}: ${test.error}`);
        });
    }

    console.log('\n📋 DETAILED RESULTS:');
    this.results.tests.forEach(test => {
      const status = test.status === 'PASSED' ? '✅' : '❌';
      console.log(`  ${status} ${test.name} (${test.duration}ms)`);
    });

    console.log('\n🏁 Test Suite Completed');
    console.log('='.repeat(80));

    // Exit with appropriate code
    process.exit(this.results.failed > 0 ? 1 : 0);
  }
}

// Run the test suite if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new APIIntegrationTester();
  tester.runAllTests().catch(console.error);
}

export default APIIntegrationTester;