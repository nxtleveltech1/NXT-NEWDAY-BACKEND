import express from 'express';
import { body, query, param, validationResult } from 'express-validator';
import rateLimit from 'express-rate-limit';
import { dashboardService } from '../services/dashboard.service.js';
import { dashboardWebSocketService } from '../services/dashboard-websocket.service.js';
import { 
  testNileConnection, 
  getNileConnectionStatus,
  initializeNileDB,
  insertDashboardEvent 
} from '../config/niledb.config.js';

const router = express.Router();

// Rate limiting for dashboard endpoints
const dashboardRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // Limit each IP to 1000 requests per windowMs
  message: {
    error: 'Too many dashboard requests from this IP',
    retryAfter: '15 minutes'
  },
  standardHeaders: true,
  legacyHeaders: false
});

// Real-time data rate limiting (more strict)
const realtimeRateLimit = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 120, // 2 requests per second max
  message: {
    error: 'Too many real-time data requests',
    retryAfter: '1 minute'
  }
});

// Validation middleware
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      error: 'Validation failed',
      details: errors.array()
    });
  }
  next();
};

/**
 * @route GET /api/dashboard/health
 * @desc Check dashboard system health
 * @access Public
 */
router.get('/health', async (req, res) => {
  try {
    const nileStatus = await testNileConnection();
    const wsStats = dashboardWebSocketService.getStats();
    
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      services: {
        niledb: {
          status: nileStatus.success ? 'connected' : 'disconnected',
          error: nileStatus.error || null
        },
        websocket: {
          status: wsStats.isRunning ? 'running' : 'stopped',
          clients: wsStats.totalClients,
          subscriptions: wsStats.totalSubscriptions
        },
        dashboard: {
          status: dashboardService.initialized ? 'initialized' : 'not_initialized'
        }
      }
    };

    res.json({
      success: true,
      data: health
    });
  } catch (error) {
    console.error('Dashboard health check error:', error);
    res.status(500).json({
      success: false,
      error: 'Health check failed',
      message: error.message
    });
  }
});

/**
 * @route POST /api/dashboard/initialize
 * @desc Initialize dashboard system
 * @access Admin
 */
router.post('/initialize', async (req, res) => {
  try {
    // Initialize NileDB tables
    const nileInit = await initializeNileDB();
    if (!nileInit.success) {
      console.warn('NileDB initialization failed:', nileInit.error);
    }

    // Initialize dashboard service
    const serviceInit = await dashboardService.initialize();
    if (!serviceInit.success) {
      return res.status(500).json({
        success: false,
        error: 'Dashboard service initialization failed',
        details: serviceInit.error
      });
    }

    // Log initialization event
    await insertDashboardEvent('system_initialized', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    }, 'api', 'info');

    res.json({
      success: true,
      message: 'Dashboard system initialized successfully',
      data: {
        niledb: nileInit.success,
        dashboard: serviceInit.success,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Dashboard initialization error:', error);
    res.status(500).json({
      success: false,
      error: 'Initialization failed',
      message: error.message
    });
  }
});

/**
 * @route GET /api/dashboard/overview
 * @desc Get comprehensive dashboard overview
 * @access Private
 */
router.get('/overview', dashboardRateLimit, async (req, res) => {
  try {
    const overview = await dashboardService.getDashboardOverview();
    
    if (!overview.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get dashboard overview',
        message: overview.error
      });
    }

    res.json({
      success: true,
      data: overview.data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Dashboard overview error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get dashboard overview',
      message: error.message
    });
  }
});

/**
 * @route GET /api/dashboard/widgets/:widgetType
 * @desc Get data for specific widget type
 * @access Private
 */
router.get('/widgets/:widgetType', [
  dashboardRateLimit,
  param('widgetType').isString().trim().isLength({ min: 1, max: 50 }),
  query('timeRange').optional().isIn(['1h', '6h', '12h', '24h', '7d', '30d']),
  query('limit').optional().isInt({ min: 1, max: 1000 }),
  query('refresh').optional().isBoolean(),
  handleValidationErrors
], async (req, res) => {
  try {
    const { widgetType } = req.params;
    const { timeRange = '24h', limit = 100, refresh = false } = req.query;

    const widgetData = await dashboardService.getWidgetData(widgetType, {
      timeRange,
      limit: parseInt(limit),
      refresh: refresh === 'true'
    });

    if (!widgetData.success) {
      return res.status(400).json({
        success: false,
        error: 'Failed to get widget data',
        message: widgetData.error
      });
    }

    // Log widget access
    await insertDashboardEvent('widget_accessed', {
      widgetType,
      timeRange,
      limit,
      ip: req.ip
    }, 'api', 'info');

    res.json({
      success: true,
      widgetType,
      data: widgetData.data,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Widget data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get widget data',
      message: error.message
    });
  }
});

/**
 * @route GET /api/dashboard/sales
 * @desc Get sales metrics and analytics
 * @access Private
 */
router.get('/sales', [
  dashboardRateLimit,
  query('period').optional().isIn(['today', 'week', 'month', 'quarter', 'year']),
  query('category').optional().isString().trim(),
  handleValidationErrors
], async (req, res) => {
  try {
    const { period = 'today', category } = req.query;
    
    const salesData = await dashboardService.getSalesMetrics();
    
    res.json({
      success: true,
      data: salesData,
      filters: { period, category },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Sales data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get sales data',
      message: error.message
    });
  }
});

/**
 * @route GET /api/dashboard/inventory
 * @desc Get inventory status and analytics
 * @access Private
 */
router.get('/inventory', [
  dashboardRateLimit,
  query('warehouse').optional().isString().trim(),
  query('category').optional().isString().trim(),
  query('status').optional().isIn(['in_stock', 'low_stock', 'out_of_stock']),
  handleValidationErrors
], async (req, res) => {
  try {
    const { warehouse, category, status } = req.query;
    
    const inventoryData = await dashboardService.getInventoryStatus();
    
    res.json({
      success: true,
      data: inventoryData,
      filters: { warehouse, category, status },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Inventory data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get inventory data',
      message: error.message
    });
  }
});

/**
 * @route GET /api/dashboard/customers
 * @desc Get customer metrics and analytics
 * @access Private
 */
router.get('/customers', [
  dashboardRateLimit,
  query('segment').optional().isString().trim(),
  query('region').optional().isString().trim(),
  query('timeframe').optional().isIn(['24h', '7d', '30d', '90d']),
  handleValidationErrors
], async (req, res) => {
  try {
    const { segment, region, timeframe = '30d' } = req.query;
    
    const customerData = await dashboardService.getCustomerMetrics();
    
    res.json({
      success: true,
      data: customerData,
      filters: { segment, region, timeframe },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Customer data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get customer data',
      message: error.message
    });
  }
});

/**
 * @route GET /api/dashboard/performance
 * @desc Get system performance metrics
 * @access Private
 */
router.get('/performance', dashboardRateLimit, async (req, res) => {
  try {
    const performanceData = await dashboardService.getPerformanceMetrics();
    
    res.json({
      success: true,
      data: performanceData,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Performance data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get performance data',
      message: error.message
    });
  }
});

/**
 * @route GET /api/dashboard/activity
 * @desc Get recent activity feed
 * @access Private
 */
router.get('/activity', [
  dashboardRateLimit,
  query('limit').optional().isInt({ min: 1, max: 100 }),
  query('type').optional().isString().trim(),
  handleValidationErrors
], async (req, res) => {
  try {
    const { limit = 25, type } = req.query;
    
    const activityData = await dashboardService.getRecentActivity();
    
    // Filter by type if specified
    let filteredActivity = activityData;
    if (type) {
      filteredActivity = activityData.filter(activity => activity.type === type);
    }
    
    // Apply limit
    filteredActivity = filteredActivity.slice(0, parseInt(limit));
    
    res.json({
      success: true,
      data: filteredActivity,
      filters: { limit: parseInt(limit), type },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Activity data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get activity data',
      message: error.message
    });
  }
});

/**
 * @route GET /api/dashboard/alerts
 * @desc Get system alerts and notifications
 * @access Private
 */
router.get('/alerts', [
  dashboardRateLimit,
  query('severity').optional().isIn(['low', 'medium', 'high', 'critical']),
  query('status').optional().isIn(['open', 'acknowledged', 'resolved']),
  query('limit').optional().isInt({ min: 1, max: 50 }),
  handleValidationErrors
], async (req, res) => {
  try {
    const { severity, status, limit = 20 } = req.query;
    
    const alertsData = await dashboardService.getSystemAlerts();
    
    // Apply filters
    let filteredAlerts = alertsData;
    if (severity) {
      filteredAlerts = filteredAlerts.filter(alert => alert.severity === severity);
    }
    if (status) {
      const statusFilter = status === 'open' ? !alert.resolved && !alert.acknowledged
        : status === 'acknowledged' ? alert.acknowledged && !alert.resolved
        : alert.resolved;
      filteredAlerts = filteredAlerts.filter(alert => statusFilter);
    }
    
    // Apply limit
    filteredAlerts = filteredAlerts.slice(0, parseInt(limit));
    
    res.json({
      success: true,
      data: filteredAlerts,
      filters: { severity, status, limit: parseInt(limit) },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Alerts data error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get alerts data',
      message: error.message
    });
  }
});

/**
 * @route GET /api/dashboard/realtime/:dataType
 * @desc Get real-time data stream
 * @access Private
 */
router.get('/realtime/:dataType', [
  realtimeRateLimit,
  param('dataType').isString().trim().isLength({ min: 1, max: 50 }),
  query('duration').optional().isInt({ min: 1, max: 3600 }),
  handleValidationErrors
], async (req, res) => {
  try {
    const { dataType } = req.params;
    const { duration = 300 } = req.query; // Default 5 minutes

    // Set up Server-Sent Events
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    });

    // Send initial data
    const initialData = await dashboardService.getWidgetData(dataType);
    res.write(`data: ${JSON.stringify({
      type: 'initial',
      dataType,
      data: initialData.success ? initialData.data : null,
      timestamp: new Date().toISOString()
    })}\n\n`);

    // Set up periodic updates
    const interval = setInterval(async () => {
      try {
        const data = await dashboardService.getWidgetData(dataType);
        res.write(`data: ${JSON.stringify({
          type: 'update',
          dataType,
          data: data.success ? data.data : null,
          timestamp: new Date().toISOString()
        })}\n\n`);
      } catch (error) {
        console.error('Real-time data update error:', error);
        res.write(`data: ${JSON.stringify({
          type: 'error',
          error: error.message,
          timestamp: new Date().toISOString()
        })}\n\n`);
      }
    }, 5000); // Update every 5 seconds

    // Clean up on client disconnect
    req.on('close', () => {
      clearInterval(interval);
      console.log(`Real-time stream closed for ${dataType}`);
    });

    // Auto-close after duration
    setTimeout(() => {
      clearInterval(interval);
      res.end();
    }, parseInt(duration) * 1000);

  } catch (error) {
    console.error('Real-time stream error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to start real-time stream',
      message: error.message
    });
  }
});

/**
 * @route POST /api/dashboard/notifications
 * @desc Send notification to dashboard users
 * @access Admin
 */
router.post('/notifications', [
  dashboardRateLimit,
  body('type').isString().trim().isLength({ min: 1, max: 50 }),
  body('title').isString().trim().isLength({ min: 1, max: 200 }),
  body('message').isString().trim().isLength({ min: 1, max: 1000 }),
  body('severity').optional().isIn(['info', 'warning', 'error', 'success']),
  body('targetStream').optional().isString().trim(),
  handleValidationErrors
], async (req, res) => {
  try {
    const { type, title, message, severity = 'info', targetStream = 'notifications' } = req.body;
    
    const notification = {
      type,
      title,
      message,
      severity,
      timestamp: new Date().toISOString(),
      source: 'admin',
      ip: req.ip
    };

    const result = await dashboardWebSocketService.sendNotification(type, notification, targetStream);
    
    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to send notification',
        message: result.error
      });
    }

    res.json({
      success: true,
      message: 'Notification sent successfully',
      data: notification
    });
  } catch (error) {
    console.error('Send notification error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to send notification',
      message: error.message
    });
  }
});

/**
 * @route GET /api/dashboard/websocket/stats
 * @desc Get WebSocket connection statistics
 * @access Admin
 */
router.get('/websocket/stats', dashboardRateLimit, async (req, res) => {
  try {
    const stats = dashboardWebSocketService.getStats();
    
    res.json({
      success: true,
      data: stats,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('WebSocket stats error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get WebSocket stats',
      message: error.message
    });
  }
});

/**
 * @route GET /api/dashboard/export/:format
 * @desc Export dashboard data
 * @access Private
 */
router.get('/export/:format', [
  dashboardRateLimit,
  param('format').isIn(['json', 'csv', 'xlsx']),
  query('dataTypes').optional().isString(),
  query('timeRange').optional().isIn(['24h', '7d', '30d']),
  handleValidationErrors
], async (req, res) => {
  try {
    const { format } = req.params;
    const { dataTypes = 'all', timeRange = '24h' } = req.query;

    // Get comprehensive dashboard data
    const overview = await dashboardService.getDashboardOverview();
    
    if (!overview.success) {
      return res.status(500).json({
        success: false,
        error: 'Failed to get dashboard data for export'
      });
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      timeRange,
      dataTypes: dataTypes.split(','),
      data: overview.data
    };

    // Set response headers based on format
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `dashboard-export-${timestamp}`;

    switch (format) {
      case 'json':
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.json"`);
        res.json(exportData);
        break;
      
      case 'csv':
        // Simplified CSV export
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
        
        let csvContent = 'Category,Metric,Value,Timestamp\n';
        const flattenData = (obj, prefix = '') => {
          Object.entries(obj).forEach(([key, value]) => {
            if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
              flattenData(value, `${prefix}${key}.`);
            } else {
              csvContent += `${prefix}${key},"${value}","${new Date().toISOString()}"\n`;
            }
          });
        };
        flattenData(overview.data);
        res.send(csvContent);
        break;
      
      default:
        res.status(400).json({
          success: false,
          error: 'Unsupported export format'
        });
    }

    // Log export event
    await insertDashboardEvent('data_exported', {
      format,
      dataTypes,
      timeRange,
      ip: req.ip
    }, 'api', 'info');

  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to export dashboard data',
      message: error.message
    });
  }
});

/**
 * @route DELETE /api/dashboard/cache
 * @desc Clear dashboard cache
 * @access Admin
 */
router.delete('/cache', dashboardRateLimit, async (req, res) => {
  try {
    dashboardService.clearCache();
    
    await insertDashboardEvent('cache_cleared', {
      ip: req.ip,
      userAgent: req.get('User-Agent')
    }, 'api', 'info');
    
    res.json({
      success: true,
      message: 'Dashboard cache cleared successfully',
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Clear cache error:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache',
      message: error.message
    });
  }
});

// Error handling middleware
router.use((error, req, res, next) => {
  console.error('Dashboard route error:', error);
  
  res.status(500).json({
    success: false,
    error: 'Dashboard service error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    timestamp: new Date().toISOString()
  });
});

export default router;