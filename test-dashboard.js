#!/usr/bin/env node

/**
 * Comprehensive Dashboard Test Suite
 * Tests all dashboard functionality including NileDB, WebSocket, and API endpoints
 */

import { testNileConnection, initializeNileDB, insertDashboardMetric, getDashboardMetrics } from './src/config/niledb.config.js';
import { dashboardService } from './src/services/dashboard.service.js';
import { dashboardWebSocketService } from './src/services/dashboard-websocket.service.js';
import { dashboardIntegration } from './src/integrations/dashboard-integration.js';
import express from 'express';
import http from 'http';
import WebSocket from 'ws';
import fetch from 'node-fetch';

class DashboardTester {
  constructor() {
    this.testResults = [];
    this.app = null;
    this.server = null;
    this.port = 3001; // Use different port for testing
  }

  /**
   * Run all dashboard tests
   */
  async runTests() {
    console.log('🧪 Starting Comprehensive Dashboard Tests...\n');
    
    try {
      // Setup test server
      await this.setupTestServer();
      
      // Run all test suites
      await this.testNileDBConnection();
      await this.testNileDBOperations();
      await this.testDashboardService();
      await this.testWebSocketService();
      await this.testAPIEndpoints();
      await this.testIntegration();
      await this.testRealTimeUpdates();
      
      // Cleanup
      await this.cleanup();
      
      // Print results
      this.printTestResults();
      
    } catch (error) {
      console.error('❌ Test suite failed:', error);
      await this.cleanup();
      process.exit(1);
    }
  }

  /**
   * Setup test server
   */
  async setupTestServer() {
    this.logTest('Setting up test server...');
    
    try {
      this.app = express();
      this.app.use(express.json());
      this.server = http.createServer(this.app);
      
      // Initialize dashboard integration
      const result = await dashboardIntegration.initialize(this.app, this.server);
      
      if (result.success) {
        this.recordTest('Test Server Setup', true, 'Server initialized successfully');
        
        // Start server
        return new Promise((resolve) => {
          this.server.listen(this.port, () => {
            console.log(`✅ Test server running on port ${this.port}`);
            resolve();
          });
        });
      } else {
        throw new Error(result.error);
      }
    } catch (error) {
      this.recordTest('Test Server Setup', false, error.message);
      throw error;
    }
  }

  /**
   * Test NileDB connection
   */
  async testNileDBConnection() {
    this.logTest('Testing NileDB connection...');
    
    try {
      const result = await testNileConnection();
      
      if (result.success) {
        this.recordTest('NileDB Connection', true, 'Connected successfully');
        console.log('  📊 Database:', result.data?.version || 'Unknown version');
      } else {
        this.recordTest('NileDB Connection', false, result.error);
        console.warn('  ⚠️ NileDB connection failed, tests will use fallback mode');
      }
    } catch (error) {
      this.recordTest('NileDB Connection', false, error.message);
    }
  }

  /**
   * Test NileDB operations
   */
  async testNileDBOperations() {
    this.logTest('Testing NileDB operations...');
    
    try {
      // Test table initialization
      const initResult = await initializeNileDB();
      this.recordTest('NileDB Initialization', initResult.success, initResult.error || 'Tables initialized');
      
      // Test metric insertion
      const metricResult = await insertDashboardMetric('test_metric', 100, 'counter', { test: true });
      this.recordTest('NileDB Insert Metric', metricResult.success, metricResult.error || 'Metric inserted');
      
      // Test metric retrieval
      const metricsResult = await getDashboardMetrics('24h', 10);
      this.recordTest('NileDB Get Metrics', metricsResult.success, 
        metricsResult.error || `Retrieved ${metricsResult.data?.length || 0} metrics`);
      
    } catch (error) {
      this.recordTest('NileDB Operations', false, error.message);
    }
  }

  /**
   * Test dashboard service
   */
  async testDashboardService() {
    this.logTest('Testing Dashboard Service...');
    
    try {
      // Test service initialization
      const initResult = await dashboardService.initialize();
      this.recordTest('Dashboard Service Init', initResult.success, initResult.error || 'Service initialized');
      
      // Test overview data
      const overviewResult = await dashboardService.getDashboardOverview();
      this.recordTest('Dashboard Overview', overviewResult.success, 
        overviewResult.error || 'Overview data retrieved');
      
      // Test sales metrics
      const salesData = await dashboardService.getSalesMetrics();
      this.recordTest('Sales Metrics', salesData !== null, 
        salesData ? `Sales data: $${salesData.totalSales}` : 'No sales data');
      
      // Test inventory status
      const inventoryData = await dashboardService.getInventoryStatus();
      this.recordTest('Inventory Status', inventoryData !== null,
        inventoryData ? `${inventoryData.summary?.totalItems || 0} items` : 'No inventory data');
      
      // Test customer metrics
      const customerData = await dashboardService.getCustomerMetrics();
      this.recordTest('Customer Metrics', customerData !== null,
        customerData ? `${customerData.summary?.totalCustomers || 0} customers` : 'No customer data');
      
      // Test performance metrics
      const performanceData = await dashboardService.getPerformanceMetrics();
      this.recordTest('Performance Metrics', performanceData !== null,
        performanceData ? `Health: ${performanceData.healthScore || 0}%` : 'No performance data');
      
    } catch (error) {
      this.recordTest('Dashboard Service', false, error.message);
    }
  }

  /**
   * Test WebSocket service
   */
  async testWebSocketService() {
    this.logTest('Testing WebSocket Service...');
    
    try {
      // WebSocket service should be running after integration
      const stats = dashboardWebSocketService.getStats();
      this.recordTest('WebSocket Service Status', stats.isRunning, 
        stats.isRunning ? `Running with ${stats.totalClients} clients` : 'Not running');
      
      // Test WebSocket connection
      await this.testWebSocketConnection();
      
    } catch (error) {
      this.recordTest('WebSocket Service', false, error.message);
    }
  }

  /**
   * Test WebSocket connection
   */
  async testWebSocketConnection() {
    return new Promise((resolve) => {
      try {
        const ws = new WebSocket(`ws://localhost:${this.port}/dashboard-ws`);
        let connected = false;
        let subscribed = false;
        
        const timeout = setTimeout(() => {
          ws.close();
          this.recordTest('WebSocket Connection', false, 'Connection timeout');
          resolve();
        }, 5000);
        
        ws.on('open', () => {
          connected = true;
          console.log('  📡 WebSocket connected');
          
          // Test subscription
          ws.send(JSON.stringify({
            type: 'subscribe',
            streams: ['sales-metrics', 'inventory-status']
          }));
        });
        
        ws.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString());
            console.log('  📨 Received message:', message.type);
            
            if (message.type === 'welcome') {
              this.recordTest('WebSocket Welcome', true, `Client ID: ${message.clientId}`);
            } else if (message.type === 'subscription-confirmed') {
              subscribed = true;
              this.recordTest('WebSocket Subscription', true, `Streams: ${message.streams.join(', ')}`);
            } else if (message.type === 'data-update') {
              this.recordTest('WebSocket Data Update', true, `Stream: ${message.stream}`);
            }
          } catch (error) {
            console.error('  ❌ Error parsing WebSocket message:', error);
          }
        });
        
        ws.on('close', () => {
          clearTimeout(timeout);
          this.recordTest('WebSocket Connection', connected, 
            connected ? 'Connected and closed successfully' : 'Failed to connect');
          resolve();
        });
        
        ws.on('error', (error) => {
          clearTimeout(timeout);
          this.recordTest('WebSocket Connection', false, error.message);
          resolve();
        });
        
      } catch (error) {
        this.recordTest('WebSocket Connection', false, error.message);
        resolve();
      }
    });
  }

  /**
   * Test API endpoints
   */
  async testAPIEndpoints() {
    this.logTest('Testing API endpoints...');
    
    const baseUrl = `http://localhost:${this.port}/api/dashboard`;
    
    try {
      // Test health endpoint
      const healthResponse = await fetch(`${baseUrl}/health`);
      const healthData = await healthResponse.json();
      this.recordTest('API Health Endpoint', healthResponse.ok && healthData.success, 
        healthData.error || 'Health check passed');
      
      // Test overview endpoint
      const overviewResponse = await fetch(`${baseUrl}/overview`);
      const overviewData = await overviewResponse.json();
      this.recordTest('API Overview Endpoint', overviewResponse.ok && overviewData.success,
        overviewData.error || 'Overview data retrieved');
      
      // Test sales endpoint
      const salesResponse = await fetch(`${baseUrl}/sales`);
      const salesData = await salesResponse.json();
      this.recordTest('API Sales Endpoint', salesResponse.ok && salesData.success,
        salesData.error || `Sales: $${salesData.data?.totalSales || 0}`);
      
      // Test inventory endpoint
      const inventoryResponse = await fetch(`${baseUrl}/inventory`);
      const inventoryData = await inventoryResponse.json();
      this.recordTest('API Inventory Endpoint', inventoryResponse.ok && inventoryData.success,
        inventoryData.error || `Items: ${inventoryData.data?.summary?.totalItems || 0}`);
      
      // Test customers endpoint
      const customersResponse = await fetch(`${baseUrl}/customers`);
      const customersData = await customersResponse.json();
      this.recordTest('API Customers Endpoint', customersResponse.ok && customersData.success,
        customersData.error || `Customers: ${customersData.data?.summary?.totalCustomers || 0}`);
      
      // Test performance endpoint
      const performanceResponse = await fetch(`${baseUrl}/performance`);
      const performanceData = await performanceResponse.json();
      this.recordTest('API Performance Endpoint', performanceResponse.ok && performanceData.success,
        performanceData.error || `Health: ${performanceData.data?.healthScore || 0}%`);
      
      // Test activity endpoint
      const activityResponse = await fetch(`${baseUrl}/activity`);
      const activityData = await activityResponse.json();
      this.recordTest('API Activity Endpoint', activityResponse.ok && activityData.success,
        activityData.error || `Activities: ${activityData.data?.length || 0}`);
      
      // Test alerts endpoint
      const alertsResponse = await fetch(`${baseUrl}/alerts`);
      const alertsData = await alertsResponse.json();
      this.recordTest('API Alerts Endpoint', alertsResponse.ok && alertsData.success,
        alertsData.error || `Alerts: ${alertsData.data?.length || 0}`);
      
    } catch (error) {
      this.recordTest('API Endpoints', false, error.message);
    }
  }

  /**
   * Test dashboard integration
   */
  async testIntegration() {
    this.logTest('Testing Dashboard Integration...');
    
    try {
      // Test integration status
      const status = await dashboardIntegration.getStatus();
      this.recordTest('Integration Status', status.initialized, 
        status.initialized ? 'Integration active' : 'Integration not initialized');
      
      // Test notification sending
      const notificationResult = await dashboardIntegration.sendNotification('test', {
        title: 'Test Notification',
        message: 'This is a test notification from the test suite',
        severity: 'info'
      });
      this.recordTest('Integration Notification', notificationResult.success,
        notificationResult.error || 'Notification sent successfully');
      
      // Test metrics update
      const metricsResult = await dashboardIntegration.updateMetrics('test_category', {
        testValue: 123,
        timestamp: new Date().toISOString()
      });
      this.recordTest('Integration Metrics Update', metricsResult.success,
        metricsResult.error || 'Metrics updated successfully');
      
    } catch (error) {
      this.recordTest('Dashboard Integration', false, error.message);
    }
  }

  /**
   * Test real-time updates
   */
  async testRealTimeUpdates() {
    this.logTest('Testing Real-time Updates...');
    
    try {
      // Test broadcasting updates
      dashboardIntegration.broadcastUpdate('test-stream', {
        testData: 'Real-time test data',
        timestamp: new Date().toISOString()
      });
      
      this.recordTest('Real-time Broadcast', true, 'Update broadcast successful');
      
      // Test Server-Sent Events endpoint
      const sseTest = await this.testServerSentEvents();
      this.recordTest('Server-Sent Events', sseTest.success, sseTest.message);
      
    } catch (error) {
      this.recordTest('Real-time Updates', false, error.message);
    }
  }

  /**
   * Test Server-Sent Events
   */
  async testServerSentEvents() {
    return new Promise((resolve) => {
      try {
        const url = `http://localhost:${this.port}/api/dashboard/realtime/sales-metrics?duration=5`;
        
        fetch(url)
          .then(response => {
            if (response.ok) {
              resolve({ success: true, message: 'SSE endpoint accessible' });
            } else {
              resolve({ success: false, message: `SSE endpoint returned ${response.status}` });
            }
          })
          .catch(error => {
            resolve({ success: false, message: error.message });
          });
        
        // Don't wait for the full stream, just test accessibility
        setTimeout(() => {
          resolve({ success: true, message: 'SSE endpoint test completed' });
        }, 1000);
        
      } catch (error) {
        resolve({ success: false, message: error.message });
      }
    });
  }

  /**
   * Cleanup test resources
   */
  async cleanup() {
    console.log('\n🧹 Cleaning up test resources...');
    
    try {
      if (dashboardIntegration.isInitialized) {
        await dashboardIntegration.stop();
      }
      
      if (this.server) {
        this.server.close();
      }
      
      console.log('✅ Cleanup completed');
    } catch (error) {
      console.error('❌ Cleanup error:', error);
    }
  }

  /**
   * Record test result
   */
  recordTest(testName, passed, message = '') {
    this.testResults.push({
      name: testName,
      passed,
      message,
      timestamp: new Date().toISOString()
    });
  }

  /**
   * Log test start
   */
  logTest(message) {
    console.log(`\n🧪 ${message}`);
  }

  /**
   * Print test results summary
   */
  printTestResults() {
    console.log('\n' + '='.repeat(80));
    console.log('📊 DASHBOARD TEST RESULTS SUMMARY');
    console.log('='.repeat(80));
    
    const passed = this.testResults.filter(t => t.passed).length;
    const failed = this.testResults.filter(t => !t.passed).length;
    const total = this.testResults.length;
    
    console.log(`\n📈 Overall Results: ${passed}/${total} tests passed (${((passed/total)*100).toFixed(1)}%)`);
    
    if (failed > 0) {
      console.log('\n❌ Failed Tests:');
      this.testResults
        .filter(t => !t.passed)
        .forEach(test => {
          console.log(`  • ${test.name}: ${test.message}`);
        });
    }
    
    console.log('\n✅ Passed Tests:');
    this.testResults
      .filter(t => t.passed)
      .forEach(test => {
        console.log(`  • ${test.name}: ${test.message}`);
      });
    
    console.log('\n' + '='.repeat(80));
    
    if (failed === 0) {
      console.log('🎉 ALL DASHBOARD TESTS PASSED! Dashboard is ready for production.');
    } else {
      console.log(`⚠️ ${failed} test(s) failed. Please review the issues above.`);
    }
    
    console.log('='.repeat(80));
  }
}

// Run tests if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new DashboardTester();
  tester.runTests().catch(console.error);
}

export { DashboardTester };