import express from 'express';
import { performSystemHealthCheck, performAutomatedRecovery } from '../services/integration-monitoring.service.js';
import { runIntegrationTestSuite } from '../services/integration-test.service.js';
import { supplyChainDashboardService } from '../services/supply-chain-dashboard.service.js';

const router = express.Router();

/**
 * Health Monitoring and Integration Testing Routes
 * Provides endpoints for system health checks, monitoring, and integration testing
 */

// ==================== HEALTH CHECKS ====================

/**
 * GET /health-monitoring/health-check
 * Perform comprehensive system health check
 */
router.get('/health-check', async (req, res) => {
  try {
    const options = {
      includeDetailedMetrics: req.query.detailed === 'true',
      checkExternalServices: req.query.external === 'true'
    };

    const healthCheck = await performSystemHealthCheck(options);

    if (healthCheck.success) {
      const statusCode = healthCheck.data.overallStatus === 'healthy' ? 200 : 
                        healthCheck.data.overallStatus === 'warning' ? 200 : 503;
      
      res.status(statusCode).json({
        status: 'success',
        data: healthCheck.data,
        message: healthCheck.message
      });
    } else {
      res.status(503).json({
        status: 'error',
        error: healthCheck.error,
        message: healthCheck.message
      });
    }
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      message: 'Health check failed'
    });
  }
});

/**
 * GET /health-monitoring/quick-health
 * Quick health check for load balancers
 */
router.get('/quick-health', async (req, res) => {
  try {
    // Simple database connectivity test
    const startTime = Date.now();
    const { db } = await import('../config/database.js');
    await db.execute('SELECT 1');
    const responseTime = Date.now() - startTime;

    if (responseTime > 5000) {
      res.status(503).json({
        status: 'unhealthy',
        message: 'Database response time too slow',
        responseTime
      });
    } else {
      res.status(200).json({
        status: 'healthy',
        message: 'System operational',
        responseTime
      });
    }
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
      message: 'Database connectivity failed'
    });
  }
});

// ==================== AUTOMATED RECOVERY ====================

/**
 * POST /health-monitoring/recovery
 * Trigger automated recovery procedures
 */
router.post('/recovery', async (req, res) => {
  try {
    const options = {
      recoveryLevel: req.body.level || 'basic', // basic, intermediate, aggressive
      dryRun: req.body.dryRun || false
    };

    const recoveryResult = await performAutomatedRecovery(options);

    res.status(200).json({
      status: recoveryResult.success ? 'success' : 'error',
      data: recoveryResult.data,
      message: recoveryResult.message
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      message: 'Automated recovery failed'
    });
  }
});

// ==================== INTEGRATION TESTING ====================

/**
 * POST /health-monitoring/integration-tests
 * Run integration test suite
 */
router.post('/integration-tests', async (req, res) => {
  try {
    const options = {
      includePerformanceTests: req.body.includePerformance || false,
      cleanupAfterTests: req.body.cleanup !== false, // Default to true
      testDataPrefix: req.body.prefix || 'INT_TEST_',
      skipSlowTests: req.body.skipSlow || false
    };

    const testResults = await runIntegrationTestSuite(options);

    const statusCode = testResults.failedTests === 0 ? 200 : 207; // 207 Multi-Status for partial success

    res.status(statusCode).json({
      status: testResults.failedTests === 0 ? 'success' : 'partial',
      data: testResults,
      message: `Integration tests complete: ${testResults.passedTests}/${testResults.totalTests} passed`
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      message: 'Integration test execution failed'
    });
  }
});

/**
 * GET /health-monitoring/integration-tests/status
 * Get integration test status and history
 */
router.get('/integration-tests/status', async (req, res) => {
  try {
    const { db } = await import('../config/database.js');
    const { timeSeriesEvents } = await import('../db/schema.js');
    const { gte, eq } = await import('drizzle-orm');

    // Get recent test events
    const twentyFourHoursAgo = new Date(Date.now() - (24 * 60 * 60 * 1000));
    
    const recentTests = await db
      .select()
      .from(timeSeriesEvents)
      .where(
        and(
          eq(timeSeriesEvents.eventType, 'integration_test_completed'),
          gte(timeSeriesEvents.timestamp, twentyFourHoursAgo)
        )
      )
      .orderBy(desc(timeSeriesEvents.timestamp))
      .limit(10);

    res.status(200).json({
      status: 'success',
      data: {
        recentTests,
        totalTestsLast24h: recentTests.length,
        lastTestTime: recentTests.length > 0 ? recentTests[0].timestamp : null
      },
      message: 'Integration test status retrieved'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      message: 'Failed to get integration test status'
    });
  }
});

// ==================== DASHBOARD METRICS ====================

/**
 * GET /health-monitoring/dashboard
 * Get supply chain dashboard data
 */
router.get('/dashboard', async (req, res) => {
  try {
    const timeRange = req.query.timeRange || '24h';
    const options = {
      includeDetailedMetrics: req.query.detailed === 'true'
    };

    const dashboardData = await supplyChainDashboardService.getDashboardData(timeRange, options);

    res.status(200).json({
      status: 'success',
      data: dashboardData,
      message: 'Dashboard data retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      message: 'Failed to retrieve dashboard data'
    });
  }
});

/**
 * GET /health-monitoring/dashboard/export
 * Export dashboard data
 */
router.get('/dashboard/export', async (req, res) => {
  try {
    const format = req.query.format || 'json'; // json, csv
    const timeRange = req.query.timeRange || '24h';
    const sections = req.query.sections ? req.query.sections.split(',') : [];

    let exportData;
    let contentType;
    let filename;

    if (format === 'csv') {
      exportData = await supplyChainDashboardService.exportToCsv(timeRange, sections);
      contentType = 'text/csv';
      filename = `supply-chain-dashboard-${timeRange}-${Date.now()}.csv`;
    } else {
      exportData = await supplyChainDashboardService.exportToJson(timeRange, sections);
      contentType = 'application/json';
      filename = `supply-chain-dashboard-${timeRange}-${Date.now()}.json`;
    }

    res.setHeader('Content-Type', contentType);
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.status(200).send(exportData);
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      message: 'Failed to export dashboard data'
    });
  }
});

// ==================== MONITORING ENDPOINTS ====================

/**
 * GET /health-monitoring/alerts
 * Get active alerts
 */
router.get('/alerts', async (req, res) => {
  try {
    const dashboardData = await supplyChainDashboardService.getDashboardData('1h');
    const alerts = dashboardData.alerts || [];

    res.status(200).json({
      status: 'success',
      data: {
        alerts,
        alertCount: alerts.length,
        criticalAlerts: alerts.filter(a => a.severity === 'critical').length,
        highAlerts: alerts.filter(a => a.severity === 'high').length,
        mediumAlerts: alerts.filter(a => a.severity === 'medium').length
      },
      message: 'Alerts retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      message: 'Failed to retrieve alerts'
    });
  }
});

/**
 * GET /health-monitoring/metrics/:metricName
 * Get specific metric data
 */
router.get('/metrics/:metricName', async (req, res) => {
  try {
    const { metricName } = req.params;
    const timeRange = req.query.timeRange || '24h';
    
    const { db } = await import('../config/database.js');
    const { timeSeriesMetrics } = await import('../db/schema.js');
    const { gte, eq } = await import('drizzle-orm');

    const timeRangeMs = parseTimeRange(timeRange);
    const startTime = new Date(Date.now() - timeRangeMs);

    const metrics = await db
      .select()
      .from(timeSeriesMetrics)
      .where(
        and(
          eq(timeSeriesMetrics.metricName, metricName),
          gte(timeSeriesMetrics.timestamp, startTime)
        )
      )
      .orderBy(timeSeriesMetrics.timestamp);

    res.status(200).json({
      status: 'success',
      data: {
        metricName,
        timeRange,
        dataPoints: metrics.length,
        metrics
      },
      message: 'Metric data retrieved successfully'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      message: 'Failed to retrieve metric data'
    });
  }
});

// ==================== WORKFLOW VALIDATION ====================

/**
 * POST /health-monitoring/validate-workflow
 * Validate specific workflow end-to-end
 */
router.post('/validate-workflow', async (req, res) => {
  try {
    const { workflowType, testData } = req.body;

    let validationResult;

    switch (workflowType) {
      case 'price-upload-to-po':
        const { testPriceUploadToPOCreationFlow } = await import('../services/integration-test.service.js');
        validationResult = await testPriceUploadToPOCreationFlow('VALIDATE_');
        break;
      
      case 'po-to-inventory':
        const { testPOToInventoryReceiptFlow } = await import('../services/integration-test.service.js');
        validationResult = await testPOToInventoryReceiptFlow('VALIDATE_');
        break;
      
      case 'order-to-shipment':
        const { testOrderToShipmentFlow } = await import('../services/integration-test.service.js');
        validationResult = await testOrderToShipmentFlow('VALIDATE_');
        break;
      
      case 'return-to-inventory':
        const { testReturnToInventoryFlow } = await import('../services/integration-test.service.js');
        validationResult = await testReturnToInventoryFlow('VALIDATE_');
        break;
      
      default:
        return res.status(400).json({
          status: 'error',
          error: 'Invalid workflow type',
          message: 'Supported workflows: price-upload-to-po, po-to-inventory, order-to-shipment, return-to-inventory'
        });
    }

    res.status(200).json({
      status: validationResult.status === 'passed' ? 'success' : 'error',
      data: validationResult,
      message: `Workflow validation ${validationResult.status}`
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message,
      message: 'Workflow validation failed'
    });
  }
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Parse time range string to milliseconds
 * @param {string} timeRange - Time range (e.g., '24h', '7d', '30m')
 * @returns {number} Milliseconds
 */
function parseTimeRange(timeRange) {
  const units = {
    'm': 60 * 1000,
    'h': 60 * 60 * 1000,
    'd': 24 * 60 * 60 * 1000
  };

  const match = timeRange.match(/^(\d+)([mhd])$/);
  if (!match) {
    return 24 * 60 * 60 * 1000; // Default to 24 hours
  }

  const [, amount, unit] = match;
  return parseInt(amount) * units[unit];
}

export default router;