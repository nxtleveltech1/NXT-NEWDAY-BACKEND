const express = require('express');
const Joi = require('joi');
const logger = require('../utils/logger');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const router = express.Router();

// Rate limiting for dashboard endpoints
const rateLimiter = new RateLimiterMemory({
  keyGetter: (req) => req.ip,
  points: 100,
  duration: 60,
});

// Validation schemas
const dashboardCreateSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  description: Joi.string().max(500).optional(),
  widgets: Joi.array().items(
    Joi.object({
      type: Joi.string().valid('chart', 'metric', 'table', 'alert', 'text').required(),
      title: Joi.string().required(),
      config: Joi.object().required(),
      position: Joi.object({
        x: Joi.number().integer().min(0).required(),
        y: Joi.number().integer().min(0).required(),
        width: Joi.number().integer().min(1).required(),
        height: Joi.number().integer().min(1).required()
      }).required()
    })
  ).default([]),
  layout: Joi.object({
    columns: Joi.number().integer().min(1).max(24).default(12),
    rowHeight: Joi.number().integer().min(1).default(30)
  }).default({}),
  isPublic: Joi.boolean().default(false),
  refreshInterval: Joi.number().integer().min(5).max(3600).default(30)
});

const dashboardUpdateSchema = Joi.object({
  name: Joi.string().min(1).max(100).optional(),
  description: Joi.string().max(500).optional(),
  widgets: Joi.array().items(
    Joi.object({
      id: Joi.string().optional(),
      type: Joi.string().valid('chart', 'metric', 'table', 'alert', 'text').required(),
      title: Joi.string().required(),
      config: Joi.object().required(),
      position: Joi.object({
        x: Joi.number().integer().min(0).required(),
        y: Joi.number().integer().min(0).required(),
        width: Joi.number().integer().min(1).required(),
        height: Joi.number().integer().min(1).required()
      }).required()
    })
  ).optional(),
  layout: Joi.object({
    columns: Joi.number().integer().min(1).max(24).optional(),
    rowHeight: Joi.number().integer().min(1).optional()
  }).optional(),
  isPublic: Joi.boolean().optional(),
  refreshInterval: Joi.number().integer().min(5).max(3600).optional()
});

const widgetConfigSchema = Joi.object({
  type: Joi.string().valid('chart', 'metric', 'table', 'alert', 'text').required(),
  dataSource: Joi.string().required(),
  query: Joi.object().optional(),
  visualization: Joi.object().optional(),
  filters: Joi.object().optional(),
  timeRange: Joi.object({
    start: Joi.date().optional(),
    end: Joi.date().optional(),
    relative: Joi.string().valid('1h', '6h', '12h', '24h', '7d', '30d').optional()
  }).optional()
});

// Mock dashboard storage (in real implementation, this would be a database)
const dashboards = new Map();
let dashboardIdCounter = 1;

// Mock widget data generator
const generateMockData = (widgetType, config) => {
  const now = new Date();
  const data = [];

  switch (widgetType) {
    case 'chart':
      // Generate time series data
      for (let i = 0; i < 24; i++) {
        const timestamp = new Date(now.getTime() - (23 - i) * 60 * 60 * 1000);
        data.push({
          timestamp,
          value: Math.floor(Math.random() * 100) + 50,
          category: config.category || 'default'
        });
      }
      break;

    case 'metric':
      data.push({
        current: Math.floor(Math.random() * 1000) + 100,
        previous: Math.floor(Math.random() * 1000) + 100,
        trend: Math.random() > 0.5 ? 'up' : 'down',
        change: (Math.random() * 20 - 10).toFixed(2)
      });
      break;

    case 'table':
      for (let i = 0; i < 10; i++) {
        data.push({
          id: i + 1,
          name: `Item ${i + 1}`,
          value: Math.floor(Math.random() * 1000),
          status: Math.random() > 0.5 ? 'active' : 'inactive',
          lastUpdated: new Date(now.getTime() - Math.random() * 24 * 60 * 60 * 1000)
        });
      }
      break;

    case 'alert':
      const alertTypes = ['info', 'warning', 'error', 'success'];
      for (let i = 0; i < 5; i++) {
        data.push({
          id: i + 1,
          type: alertTypes[Math.floor(Math.random() * alertTypes.length)],
          message: `Alert message ${i + 1}`,
          timestamp: new Date(now.getTime() - Math.random() * 60 * 60 * 1000),
          resolved: Math.random() > 0.3
        });
      }
      break;

    case 'text':
      data.push({
        content: config.content || 'Default text content',
        lastUpdated: now
      });
      break;

    default:
      break;
  }

  return data;
};

// Middleware
const applyRateLimit = async (req, res, next) => {
  try {
    await rateLimiter.consume(req.ip);
    next();
  } catch (rejRes) {
    res.status(429).json({
      error: 'Rate limit exceeded',
      resetTime: new Date(Date.now() + rejRes.msBeforeNext)
    });
  }
};

const validateRequest = (schema) => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req.body);
    if (error) {
      return res.status(400).json({
        error: 'Validation error',
        details: error.details.map(detail => detail.message)
      });
    }
    req.validatedBody = value;
    next();
  };
};

/**
 * GET /api/dashboard
 * Get all dashboards
 */
router.get('/', applyRateLimit, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { page = 1, limit = 20, search } = req.query;
    
    logger.debug('Dashboards list requested', { page, limit, search, ip: req.ip });

    let dashboardList = Array.from(dashboards.values());

    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      dashboardList = dashboardList.filter(dashboard => 
        dashboard.name.toLowerCase().includes(searchLower) ||
        dashboard.description?.toLowerCase().includes(searchLower)
      );
    }

    // Apply pagination
    const offset = (page - 1) * limit;
    const paginatedDashboards = dashboardList.slice(offset, offset + limit);

    const responseTime = Date.now() - startTime;
    
    logger.apiResponse('/api/dashboard', 200, responseTime, {
      count: paginatedDashboards.length,
      total: dashboardList.length
    });

    res.json({
      success: true,
      dashboards: paginatedDashboards.map(dashboard => ({
        id: dashboard.id,
        name: dashboard.name,
        description: dashboard.description,
        widgetCount: dashboard.widgets.length,
        isPublic: dashboard.isPublic,
        createdAt: dashboard.createdAt,
        updatedAt: dashboard.updatedAt
      })),
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total: dashboardList.length,
        pages: Math.ceil(dashboardList.length / limit)
      },
      timestamp: new Date()
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Get dashboards error', error, { ip: req.ip });
    
    res.status(500).json({
      error: 'Failed to retrieve dashboards',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/dashboard
 * Create new dashboard
 */
router.post('/', applyRateLimit, validateRequest(dashboardCreateSchema), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const dashboardData = req.validatedBody;
    
    logger.info('Dashboard creation requested', {
      name: dashboardData.name,
      widgetCount: dashboardData.widgets.length,
      ip: req.ip
    });

    // Generate dashboard ID and timestamps
    const dashboardId = (dashboardIdCounter++).toString();
    const now = new Date();

    // Add IDs to widgets
    const widgets = dashboardData.widgets.map((widget, index) => ({
      ...widget,
      id: `widget_${dashboardId}_${index + 1}`
    }));

    const dashboard = {
      id: dashboardId,
      ...dashboardData,
      widgets,
      createdAt: now,
      updatedAt: now,
      createdBy: req.user?.id || 'anonymous',
      version: 1
    };

    dashboards.set(dashboardId, dashboard);

    const responseTime = Date.now() - startTime;
    
    logger.apiResponse('/api/dashboard', 201, responseTime, {
      dashboardId,
      widgetCount: widgets.length
    });

    res.status(201).json({
      success: true,
      dashboard,
      message: 'Dashboard created successfully'
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Create dashboard error', error, {
      body: req.validatedBody,
      ip: req.ip
    });
    
    res.status(500).json({
      error: 'Failed to create dashboard',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/dashboard/:id
 * Get specific dashboard
 */
router.get('/:id', applyRateLimit, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    const { includeData = 'false' } = req.query;
    
    logger.debug('Dashboard requested', { dashboardId: id, includeData, ip: req.ip });

    const dashboard = dashboards.get(id);
    
    if (!dashboard) {
      const responseTime = Date.now() - startTime;
      logger.apiResponse('/api/dashboard/:id', 404, responseTime);
      
      return res.status(404).json({
        error: 'Dashboard not found'
      });
    }

    let responseData = { ...dashboard };

    // Include widget data if requested
    if (includeData === 'true') {
      responseData.widgets = dashboard.widgets.map(widget => ({
        ...widget,
        data: generateMockData(widget.type, widget.config)
      }));
    }

    const responseTime = Date.now() - startTime;
    
    logger.apiResponse('/api/dashboard/:id', 200, responseTime, {
      dashboardId: id,
      includeData: includeData === 'true'
    });

    res.json({
      success: true,
      dashboard: responseData
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Get dashboard error', error, {
      dashboardId: req.params.id,
      ip: req.ip
    });
    
    res.status(500).json({
      error: 'Failed to retrieve dashboard',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * PUT /api/dashboard/:id
 * Update dashboard
 */
router.put('/:id', applyRateLimit, validateRequest(dashboardUpdateSchema), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    const updateData = req.validatedBody;
    
    logger.info('Dashboard update requested', {
      dashboardId: id,
      fields: Object.keys(updateData),
      ip: req.ip
    });

    const dashboard = dashboards.get(id);
    
    if (!dashboard) {
      const responseTime = Date.now() - startTime;
      logger.apiResponse('/api/dashboard/:id', 404, responseTime);
      
      return res.status(404).json({
        error: 'Dashboard not found'
      });
    }

    // Update widgets with IDs if provided
    if (updateData.widgets) {
      updateData.widgets = updateData.widgets.map((widget, index) => ({
        ...widget,
        id: widget.id || `widget_${id}_${index + 1}`
      }));
    }

    // Merge updates
    const updatedDashboard = {
      ...dashboard,
      ...updateData,
      updatedAt: new Date(),
      version: dashboard.version + 1
    };

    dashboards.set(id, updatedDashboard);

    const responseTime = Date.now() - startTime;
    
    logger.apiResponse('/api/dashboard/:id', 200, responseTime, {
      dashboardId: id,
      version: updatedDashboard.version
    });

    res.json({
      success: true,
      dashboard: updatedDashboard,
      message: 'Dashboard updated successfully'
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Update dashboard error', error, {
      dashboardId: req.params.id,
      body: req.validatedBody,
      ip: req.ip
    });
    
    res.status(500).json({
      error: 'Failed to update dashboard',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * DELETE /api/dashboard/:id
 * Delete dashboard
 */
router.delete('/:id', applyRateLimit, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    
    logger.info('Dashboard deletion requested', { dashboardId: id, ip: req.ip });

    const dashboard = dashboards.get(id);
    
    if (!dashboard) {
      const responseTime = Date.now() - startTime;
      logger.apiResponse('/api/dashboard/:id', 404, responseTime);
      
      return res.status(404).json({
        error: 'Dashboard not found'
      });
    }

    dashboards.delete(id);

    const responseTime = Date.now() - startTime;
    
    logger.apiResponse('/api/dashboard/:id', 200, responseTime);

    res.json({
      success: true,
      message: 'Dashboard deleted successfully',
      deletedId: id
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Delete dashboard error', error, {
      dashboardId: req.params.id,
      ip: req.ip
    });
    
    res.status(500).json({
      error: 'Failed to delete dashboard',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/dashboard/:id/data
 * Get dashboard data for all widgets
 */
router.get('/:id/data', applyRateLimit, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    const { widgets } = req.query; // Comma-separated widget IDs
    
    logger.debug('Dashboard data requested', {
      dashboardId: id,
      widgets,
      ip: req.ip
    });

    const dashboard = dashboards.get(id);
    
    if (!dashboard) {
      const responseTime = Date.now() - startTime;
      logger.apiResponse('/api/dashboard/:id/data', 404, responseTime);
      
      return res.status(404).json({
        error: 'Dashboard not found'
      });
    }

    let targetWidgets = dashboard.widgets;
    
    // Filter widgets if specific ones requested
    if (widgets) {
      const widgetIds = widgets.split(',');
      targetWidgets = dashboard.widgets.filter(widget => widgetIds.includes(widget.id));
    }

    // Generate data for each widget
    const widgetData = {};
    
    for (const widget of targetWidgets) {
      widgetData[widget.id] = {
        type: widget.type,
        title: widget.title,
        data: generateMockData(widget.type, widget.config),
        lastUpdated: new Date()
      };
    }

    const responseTime = Date.now() - startTime;
    
    logger.apiResponse('/api/dashboard/:id/data', 200, responseTime, {
      dashboardId: id,
      widgetCount: Object.keys(widgetData).length
    });

    res.json({
      success: true,
      dashboardId: id,
      widgets: widgetData,
      timestamp: new Date()
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Get dashboard data error', error, {
      dashboardId: req.params.id,
      ip: req.ip
    });
    
    res.status(500).json({
      error: 'Failed to retrieve dashboard data',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/dashboard/:id/duplicate
 * Duplicate dashboard
 */
router.post('/:id/duplicate', applyRateLimit, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    const { name } = req.body;
    
    logger.info('Dashboard duplication requested', {
      sourceId: id,
      newName: name,
      ip: req.ip
    });

    const sourceDashboard = dashboards.get(id);
    
    if (!sourceDashboard) {
      const responseTime = Date.now() - startTime;
      logger.apiResponse('/api/dashboard/:id/duplicate', 404, responseTime);
      
      return res.status(404).json({
        error: 'Source dashboard not found'
      });
    }

    // Create duplicate
    const newDashboardId = (dashboardIdCounter++).toString();
    const now = new Date();
    
    const newWidgets = sourceDashboard.widgets.map((widget, index) => ({
      ...widget,
      id: `widget_${newDashboardId}_${index + 1}`
    }));

    const duplicatedDashboard = {
      ...sourceDashboard,
      id: newDashboardId,
      name: name || `${sourceDashboard.name} (Copy)`,
      widgets: newWidgets,
      createdAt: now,
      updatedAt: now,
      createdBy: req.user?.id || 'anonymous',
      version: 1
    };

    dashboards.set(newDashboardId, duplicatedDashboard);

    const responseTime = Date.now() - startTime;
    
    logger.apiResponse('/api/dashboard/:id/duplicate', 201, responseTime, {
      sourceId: id,
      newId: newDashboardId
    });

    res.status(201).json({
      success: true,
      dashboard: duplicatedDashboard,
      message: 'Dashboard duplicated successfully'
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Duplicate dashboard error', error, {
      dashboardId: req.params.id,
      ip: req.ip
    });
    
    res.status(500).json({
      error: 'Failed to duplicate dashboard',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/dashboard/templates
 * Get dashboard templates
 */
router.get('/templates', applyRateLimit, async (req, res) => {
  const startTime = Date.now();
  
  try {
    logger.debug('Dashboard templates requested', { ip: req.ip });

    const templates = [
      {
        id: 'analytics-overview',
        name: 'Analytics Overview',
        description: 'Comprehensive analytics dashboard with key metrics',
        category: 'analytics',
        widgets: [
          {
            type: 'metric',
            title: 'Total Users',
            config: { dataSource: 'users', metric: 'count' },
            position: { x: 0, y: 0, width: 3, height: 2 }
          },
          {
            type: 'chart',
            title: 'User Growth',
            config: { dataSource: 'users', chartType: 'line' },
            position: { x: 3, y: 0, width: 6, height: 4 }
          },
          {
            type: 'table',
            title: 'Top Pages',
            config: { dataSource: 'pageviews', limit: 10 },
            position: { x: 9, y: 0, width: 3, height: 4 }
          }
        ]
      },
      {
        id: 'performance-monitoring',
        name: 'Performance Monitoring',
        description: 'Monitor system performance and health',
        category: 'performance',
        widgets: [
          {
            type: 'metric',
            title: 'Response Time',
            config: { dataSource: 'performance', metric: 'response_time' },
            position: { x: 0, y: 0, width: 3, height: 2 }
          },
          {
            type: 'chart',
            title: 'Error Rate',
            config: { dataSource: 'errors', chartType: 'area' },
            position: { x: 3, y: 0, width: 6, height: 4 }
          },
          {
            type: 'alert',
            title: 'System Alerts',
            config: { dataSource: 'alerts', severity: 'high' },
            position: { x: 9, y: 0, width: 3, height: 4 }
          }
        ]
      }
    ];

    const responseTime = Date.now() - startTime;
    
    logger.apiResponse('/api/dashboard/templates', 200, responseTime, {
      templateCount: templates.length
    });

    res.json({
      success: true,
      templates,
      timestamp: new Date()
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Get dashboard templates error', error, { ip: req.ip });
    
    res.status(500).json({
      error: 'Failed to retrieve dashboard templates',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Error handling middleware
router.use((error, req, res, next) => {
  logger.error('Dashboard router error:', error);
  
  res.status(500).json({
    error: 'Dashboard service error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    timestamp: new Date()
  });
});

module.exports = router;