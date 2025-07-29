/**
 * Supply Chain Integration Routes
 * 
 * Provides API endpoints for supply chain integration workflows:
 * - Price list processing and workflows
 * - Purchase order automation
 * - Inventory integration
 * - Order processing
 * - Integration monitoring and health checks
 * - Performance metrics and dashboards
 */

import express from 'express';
import { supplyChainIntegrationService } from '../services/supply-chain-integration.service.js';
import integrationMonitoringService from '../services/integration-monitoring.service.js';
import { workflowAutomationService } from '../services/workflow-automation.service.js';
import { db } from '../config/database.js';
import { 
  priceLists, 
  suppliers, 
  products, 
  inventory,
  purchaseOrders,
  supplierPurchaseOrders,
  timeSeriesEvents
} from '../db/schema.js';
import { eq, and, desc, gte, lte } from 'drizzle-orm';

const router = express.Router();

// ==================== PRICE LIST INTEGRATION ====================

/**
 * POST /api/supply-chain/price-lists/:id/process
 * Process price list upload and trigger workflows
 */
router.post('/price-lists/:id/process', async (req, res) => {
  try {
    const { id } = req.params;
    const options = {
      ...req.body,
      userId: req.user?.sub // Add user ID from JWT
    };

    console.log(`Processing price list: ${id}`);
    
    // Use workflow automation service for enhanced processing
    const result = await workflowAutomationService.processPriceListUploadWorkflow(id, options);
    
    res.json({
      success: true,
      data: result,
      message: result.status === 'pending_approval' 
        ? 'Price list requires approval before processing'
        : `Price list processed successfully. Updated ${result.updateResult?.updated || 0} items, created ${result.updateResult?.created || 0} items.`
    });

  } catch (error) {
    console.error('Price list processing error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: 'Failed to process price list upload'
    });
  }
});

/**
 * GET /api/supply-chain/price-lists/:id/impact-analysis
 * Analyze impact of price list changes before processing
 */
router.get('/price-lists/:id/impact-analysis', async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get price list details
    const priceList = await db.select()
      .from(priceLists)
      .where(eq(priceLists.id, id))
      .limit(1);

    if (!priceList.length) {
      return res.status(404).json({
        success: false,
        error: 'Price list not found'
      });
    }

    // Analyze potential impact
    const impact = await analyzeePriceListImpact(id);
    
    res.json({
      success: true,
      data: impact
    });

  } catch (error) {
    console.error('Price list impact analysis error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== PURCHASE ORDER AUTOMATION ====================

/**
 * POST /api/supply-chain/reorder-suggestions
 * Generate reorder suggestions for suppliers
 */
router.post('/reorder-suggestions', async (req, res) => {
  try {
    const { supplierId, options = {} } = req.body;

    if (!supplierId) {
      return res.status(400).json({
        success: false,
        error: 'supplierId is required'
      });
    }

    const suggestions = await supplyChainIntegrationService.generateReorderSuggestions(
      supplierId, 
      options
    );
    
    res.json({
      success: true,
      data: suggestions
    });

  } catch (error) {
    console.error('Reorder suggestions error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/supply-chain/purchase-orders/create
 * Create supplier purchase order from suggestions
 */
router.post('/purchase-orders/create', async (req, res) => {
  try {
    const { supplierId, items, options = {} } = req.body;

    if (!supplierId || !items || !Array.isArray(items)) {
      return res.status(400).json({
        success: false,
        error: 'supplierId and items array are required'
      });
    }

    const result = await supplyChainIntegrationService.createSupplierPurchaseOrder(
      supplierId, 
      items, 
      options
    );
    
    res.json({
      success: true,
      data: result,
      message: `Purchase order ${result.summary.poNumber} created successfully`
    });

  } catch (error) {
    console.error('Purchase order creation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/supply-chain/purchase-orders/:id/receive
 * Process purchase order receipt
 */
router.post('/purchase-orders/:id/receive', async (req, res) => {
  try {
    const { id } = req.params;
    const receiptData = {
      ...req.body,
      purchaseOrderId: id
    };

    const result = await supplyChainIntegrationService.processPurchaseOrderReceipt(
      receiptData
    );
    
    res.json({
      success: true,
      data: result,
      message: `Purchase order receipt processed. ${result.items.length} items received.`
    });

  } catch (error) {
    console.error('Purchase order receipt error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== CUSTOMER ORDER INTEGRATION ====================

/**
 * POST /api/supply-chain/customer-orders/process
 * Process customer order and allocate inventory
 */
router.post('/customer-orders/process', async (req, res) => {
  try {
    const orderData = req.body;
    const options = req.query;

    const result = await supplyChainIntegrationService.processCustomerOrder(
      orderData, 
      options
    );
    
    res.json({
      success: true,
      data: result,
      message: `Order ${result.order.orderNumber} processed successfully`
    });

  } catch (error) {
    console.error('Customer order processing error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/supply-chain/inventory-availability/:productId
 * Check inventory availability for order allocation
 */
router.get('/inventory-availability/:productId', async (req, res) => {
  try {
    const { productId } = req.params;
    const { warehouseId, quantity } = req.query;

    if (!warehouseId || !quantity) {
      return res.status(400).json({
        success: false,
        error: 'warehouseId and quantity parameters are required'
      });
    }

    const availability = await checkInventoryAvailabilityExternal(
      productId, 
      parseInt(quantity), 
      warehouseId
    );
    
    res.json({
      success: true,
      data: availability
    });

  } catch (error) {
    console.error('Inventory availability check error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== MONITORING AND HEALTH ====================

/**
 * GET /api/supply-chain/health
 * Get supply chain integration health status
 */
router.get('/health', async (req, res) => {
  try {
    const healthStatus = await integrationMonitoringService.performHealthCheck();
    
    const statusCode = healthStatus.healthy ? 200 : 503;
    
    res.status(statusCode).json({
      success: healthStatus.healthy,
      data: healthStatus
    });

  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({
      success: false,
      error: error.message,
      healthy: false
    });
  }
});

/**
 * GET /api/supply-chain/monitoring/dashboard
 * Get monitoring dashboard data
 */
router.get('/monitoring/dashboard', async (req, res) => {
  try {
    const { timeRange = '24h' } = req.query;
    
    const dashboardData = await integrationMonitoringService.getDashboardData(timeRange);
    
    res.json({
      success: true,
      data: dashboardData
    });

  } catch (error) {
    console.error('Dashboard data error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/supply-chain/monitoring/start
 * Start integration monitoring
 */
router.post('/monitoring/start', async (req, res) => {
  try {
    const options = req.body || {};
    
    await integrationMonitoringService.startMonitoring(options);
    
    res.json({
      success: true,
      message: 'Integration monitoring started',
      data: {
        interval: options.interval || 60000,
        startedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Start monitoring error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/supply-chain/monitoring/stop
 * Stop integration monitoring
 */
router.post('/monitoring/stop', async (req, res) => {
  try {
    integrationMonitoringService.stopMonitoring();
    
    res.json({
      success: true,
      message: 'Integration monitoring stopped',
      data: {
        stoppedAt: new Date()
      }
    });

  } catch (error) {
    console.error('Stop monitoring error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== WORKFLOW MANAGEMENT ====================

/**
 * GET /api/supply-chain/workflows/:id/status
 * Get workflow status
 */
router.get('/workflows/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    
    const status = workflowAutomationService.getWorkflowStatus(id);
    
    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Workflow not found'
      });
    }
    
    res.json({
      success: true,
      data: status
    });

  } catch (error) {
    console.error('Workflow status error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/supply-chain/workflows/active
 * Get all active workflows
 */
router.get('/workflows/active', async (req, res) => {
  try {
    const workflows = workflowAutomationService.getActiveWorkflows();
    
    res.json({
      success: true,
      data: workflows
    });

  } catch (error) {
    console.error('Active workflows error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/supply-chain/workflows/:id/approve
 * Approve a pending workflow
 */
router.post('/workflows/:id/approve', async (req, res) => {
  try {
    const { id } = req.params;
    const { comments } = req.body;
    const approvedBy = req.user?.sub || 'unknown';
    
    const result = await workflowAutomationService.approveWorkflow(id, approvedBy, comments);
    
    res.json({
      success: true,
      data: result,
      message: 'Workflow approved successfully'
    });

  } catch (error) {
    console.error('Workflow approval error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * POST /api/supply-chain/workflows/:id/reject
 * Reject a pending workflow
 */
router.post('/workflows/:id/reject', async (req, res) => {
  try {
    const { id } = req.params;
    const { reason } = req.body;
    const rejectedBy = req.user?.sub || 'unknown';
    
    if (!reason) {
      return res.status(400).json({
        success: false,
        error: 'Rejection reason is required'
      });
    }
    
    const result = await workflowAutomationService.rejectWorkflow(id, rejectedBy, reason);
    
    res.json({
      success: true,
      data: result,
      message: 'Workflow rejected successfully'
    });

  } catch (error) {
    console.error('Workflow rejection error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== ANALYTICS AND REPORTING ====================

/**
 * GET /api/supply-chain/analytics/workflow-performance
 * Get workflow performance analytics
 */
router.get('/analytics/workflow-performance', async (req, res) => {
  try {
    const { 
      timeRange = '7d',
      workflow,
      dimension
    } = req.query;

    const analytics = await getWorkflowPerformanceAnalytics({
      timeRange,
      workflow,
      dimension
    });
    
    res.json({
      success: true,
      data: analytics
    });

  } catch (error) {
    console.error('Workflow performance analytics error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * GET /api/supply-chain/analytics/integration-metrics
 * Get integration metrics and KPIs
 */
router.get('/analytics/integration-metrics', async (req, res) => {
  try {
    const { timeRange = '24h' } = req.query;
    
    const metrics = await getIntegrationMetrics(timeRange);
    
    res.json({
      success: true,
      data: metrics
    });

  } catch (error) {
    console.error('Integration metrics error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// ==================== HELPER FUNCTIONS ====================

/**
 * Analyze price list impact before processing
 */
async function analyzeePriceListImpact(priceListId) {
  // Implementation for price list impact analysis
  // This would compare new prices with existing prices
  // and estimate the impact on margins, costs, etc.
  
  return {
    priceListId,
    analysis: 'Price list impact analysis not yet implemented',
    // TODO: Implement detailed impact analysis
    estimatedChanges: 0,
    affectedProducts: 0,
    estimatedCostImpact: 0
  };
}

/**
 * Check inventory availability (external helper)
 */
async function checkInventoryAvailabilityExternal(productId, quantity, warehouseId) {
  const inventoryData = await db.select()
    .from(inventory)
    .where(and(
      eq(inventory.productId, productId),
      eq(inventory.warehouseId, warehouseId)
    ))
    .limit(1);

  if (!inventoryData.length) {
    return {
      available: false,
      availableQuantity: 0,
      requestedQuantity: quantity,
      shortage: quantity
    };
  }

  const stock = inventoryData[0];
  const availableQuantity = stock.quantityAvailable;
  const available = availableQuantity >= quantity;

  return {
    available,
    availableQuantity,
    requestedQuantity: quantity,
    shortage: available ? 0 : quantity - availableQuantity,
    inventory: stock
  };
}

/**
 * Get workflow performance analytics
 */
async function getWorkflowPerformanceAnalytics(options) {
  // Implementation for workflow performance analytics
  return {
    timeRange: options.timeRange,
    workflow: options.workflow,
    metrics: {
      // TODO: Implement detailed workflow analytics
      totalWorkflows: 0,
      successRate: 0,
      averageDuration: 0,
      errorRate: 0
    }
  };
}

/**
 * Get integration metrics
 */
async function getIntegrationMetrics(timeRange) {
  const timeRangeMs = parseTimeRange(timeRange);
  const startTime = new Date(Date.now() - timeRangeMs);

  const events = await db.select()
    .from(timeSeriesEvents)
    .where(and(
      gte(timeSeriesEvents.timestamp, startTime),
      eq(timeSeriesEvents.eventCategory, 'integration')
    ))
    .orderBy(desc(timeSeriesEvents.timestamp));

  return {
    timeRange,
    generatedAt: new Date(),
    totalEvents: events.length,
    events: events.slice(0, 100), // Limit to latest 100 events
    summary: {
      priceListUploads: events.filter(e => e.eventType.includes('price_upload')).length,
      orderProcessing: events.filter(e => e.eventType.includes('order')).length,
      inventoryUpdates: events.filter(e => e.eventType.includes('inventory')).length,
      errors: events.filter(e => e.resultStatus === 'error').length
    }
  };
}

/**
 * Parse time range string to milliseconds
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