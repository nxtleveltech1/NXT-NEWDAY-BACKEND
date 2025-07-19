import express from 'express';
import { analyticsService } from '../services/analytics.service.js';

const router = express.Router();

/**
 * Customer Segmentation Analytics Endpoint
 * GET /api/analytics/customers/segments
 * Returns customer segmentation data with filtering, pagination, and performance metrics
 */
router.get('/customers/segments', async (req, res) => {
  try {
    const {
      segmentType = 'RFM',
      dateFrom = null,
      dateTo = null,
      limit = 50,
      offset = 0,
      includeCustomers = 'false'
    } = req.query;

    // Validate segment type
    const validSegmentTypes = ['RFM', 'behavioral', 'geographic'];
    if (!validSegmentTypes.includes(segmentType)) {
      return res.status(400).json({
        error: 'Invalid segment type',
        validTypes: validSegmentTypes,
        provided: segmentType
      });
    }

    // Validate pagination parameters
    const parsedLimit = parseInt(limit);
    const parsedOffset = parseInt(offset);
    
    if (isNaN(parsedLimit) || parsedLimit < 1 || parsedLimit > 1000) {
      return res.status(400).json({
        error: 'Invalid limit parameter',
        message: 'Limit must be between 1 and 1000',
        provided: limit
      });
    }

    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({
        error: 'Invalid offset parameter',
        message: 'Offset must be 0 or greater',
        provided: offset
      });
    }

    // Validate date parameters
    if (dateFrom && isNaN(Date.parse(dateFrom))) {
      return res.status(400).json({
        error: 'Invalid dateFrom parameter',
        message: 'dateFrom must be a valid ISO date string',
        provided: dateFrom
      });
    }

    if (dateTo && isNaN(Date.parse(dateTo))) {
      return res.status(400).json({
        error: 'Invalid dateTo parameter',
        message: 'dateTo must be a valid ISO date string',
        provided: dateTo
      });
    }

    // Validate date range
    if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: 'dateFrom must be before dateTo',
        dateFrom,
        dateTo
      });
    }

    const startTime = Date.now();

    // Get customer segmentation data from analytics service
    const segmentationResult = await analyticsService.getCustomerSegmentation({
      segmentType,
      dateFrom,
      dateTo,
      limit: parsedLimit,
      offset: parsedOffset,
      includeCustomerList: includeCustomers === 'true'
    });

    const duration = Date.now() - startTime;

    // Check if response time meets target (< 2 seconds)
    if (duration > 2000) {
      console.warn(`Customer segments endpoint exceeded 2s target: ${duration}ms`);
    }

    res.json({
      success: true,
      data: segmentationResult.data,
      pagination: {
        limit: parsedLimit,
        offset: parsedOffset,
        totalCustomers: segmentationResult.data.totalCustomers,
        includeCustomers: includeCustomers === 'true'
      },
      performance: {
        queryDuration: `${duration}ms`,
        target: '<2000ms',
        fromCache: segmentationResult.fromCache || false,
        correlationId: segmentationResult.correlationId
      },
      metadata: {
        endpoint: '/api/analytics/customers/segments',
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        parameters: {
          segmentType,
          dateFrom,
          dateTo,
          limit: parsedLimit,
          offset: parsedOffset
        }
      }
    });

  } catch (error) {
    console.error('Error in customer segments endpoint:', error);
    
    // Handle specific analytics service errors
    if (error.message.includes('Analytics query failed')) {
      return res.status(500).json({
        error: 'Analytics service error',
        details: error.message,
        endpoint: '/api/analytics/customers/segments'
      });
    }

    // Handle database connection errors
    if (error.message.includes('connection') || error.message.includes('database')) {
      return res.status(503).json({
        error: 'Database service unavailable',
        message: 'Unable to connect to analytics database',
        retry: true
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'An unexpected error occurred while processing customer segmentation',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      endpoint: '/api/analytics/customers/segments'
    });
  }
});

/**
 * Customer Analytics Overview Endpoint
 * GET /api/analytics/customers/overview
 * Returns comprehensive customer analytics overview
 */
router.get('/customers/overview', async (req, res) => {
  try {
    const {
      dateFrom = null,
      dateTo = null,
      includeSegmentation = 'true'
    } = req.query;

    const startTime = Date.now();

    // Get customer analytics overview
    const [customerAnalytics, segmentationData] = await Promise.all([
      analyticsService.getCustomerAnalytics({
        dateFrom,
        dateTo,
        includeDetails: false
      }),
      includeSegmentation === 'true' 
        ? analyticsService.getCustomerSegmentation({
            segmentType: 'RFM',
            dateFrom,
            dateTo,
            includeCustomerList: false
          })
        : Promise.resolve(null)
    ]);

    const duration = Date.now() - startTime;

    const overview = {
      analytics: customerAnalytics.data,
      segmentation: segmentationData ? {
        totalCustomers: segmentationData.data.totalCustomers,
        segmentCounts: segmentationData.data.segmentCounts,
        analysisDate: segmentationData.data.analysisDate
      } : null,
      generatedAt: new Date().toISOString(),
      dateRange: { dateFrom, dateTo }
    };

    res.json({
      success: true,
      data: overview,
      performance: {
        queryDuration: `${duration}ms`,
        target: '<2000ms',
        fromCache: customerAnalytics.fromCache || false
      },
      metadata: {
        endpoint: '/api/analytics/customers/overview',
        version: '1.0.0',
        parameters: { dateFrom, dateTo, includeSegmentation }
      }
    });

  } catch (error) {
    console.error('Error in customer overview endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to generate customer analytics overview',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Customer Performance Analytics Endpoint
 * GET /api/analytics/customers/performance
 * Returns customer performance metrics and trends
 */
router.get('/customers/performance', async (req, res) => {
  try {
    const {
      dateFrom = null,
      dateTo = null,
      metricTypes = 'sales_velocity,customer_acquisition'
    } = req.query;

    const startTime = Date.now();

    const metrics = metricTypes.split(',').map(m => m.trim());
    
    const performanceData = await analyticsService.getPerformanceMetrics({
      metricTypes: metrics,
      dateFrom,
      dateTo
    });

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      data: performanceData.data,
      performance: {
        queryDuration: `${duration}ms`,
        target: '<2000ms',
        fromCache: performanceData.fromCache || false
      },
      metadata: {
        endpoint: '/api/analytics/customers/performance',
        version: '1.0.0',
        parameters: { dateFrom, dateTo, metricTypes: metrics }
      }
    });

  } catch (error) {
    console.error('Error in customer performance endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to generate customer performance metrics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Advanced Customer Analytics Endpoint
 * GET /api/analytics/customers/advanced
 * Returns advanced customer analytics with trend analysis
 */
router.get('/customers/advanced', async (req, res) => {
  try {
    const {
      analysis_type = 'comprehensive',
      dateFrom = null,
      dateTo = null
    } = req.query;

    const startTime = Date.now();

    const advancedAnalytics = await analyticsService.getAdvancedAnalytics({
      analysis_type,
      dateFrom,
      dateTo
    });

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      data: advancedAnalytics.data,
      performance: {
        queryDuration: `${duration}ms`,
        target: '<2000ms',
        fromCache: advancedAnalytics.fromCache || false
      },
      metadata: {
        endpoint: '/api/analytics/customers/advanced',
        version: '1.0.0',
        parameters: { analysis_type, dateFrom, dateTo }
      }
    });

  } catch (error) {
    console.error('Error in advanced customer analytics endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to generate advanced customer analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Supplier Performance Analytics Endpoint
 * GET /api/analytics/suppliers/performance
 * Returns comprehensive supplier performance metrics and rankings
 */
router.get('/suppliers/performance', async (req, res) => {
  try {
    const {
      supplierId = null,
      dateFrom = null,
      dateTo = null,
      performanceThreshold = '80',
      includeRankings = 'true',
      includeComparisons = 'true'
    } = req.query;

    // Validate supplier ID if provided
    if (supplierId && !supplierId.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)) {
      return res.status(400).json({
        error: 'Invalid supplier ID format',
        message: 'Supplier ID must be a valid UUID',
        provided: supplierId
      });
    }

    // Validate performance threshold
    const parsedThreshold = parseFloat(performanceThreshold);
    if (isNaN(parsedThreshold) || parsedThreshold < 0 || parsedThreshold > 100) {
      return res.status(400).json({
        error: 'Invalid performance threshold',
        message: 'Performance threshold must be a number between 0 and 100',
        provided: performanceThreshold
      });
    }

    // Validate date parameters
    if (dateFrom && isNaN(Date.parse(dateFrom))) {
      return res.status(400).json({
        error: 'Invalid dateFrom parameter',
        message: 'dateFrom must be a valid ISO date string',
        provided: dateFrom
      });
    }

    if (dateTo && isNaN(Date.parse(dateTo))) {
      return res.status(400).json({
        error: 'Invalid dateTo parameter',
        message: 'dateTo must be a valid ISO date string',
        provided: dateTo
      });
    }

    // Validate date range
    if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: 'dateFrom must be before dateTo',
        dateFrom,
        dateTo
      });
    }

    // Validate boolean parameters
    const includeRankingsBool = includeRankings === 'true';
    const includeComparisonsBool = includeComparisons === 'true';

    const startTime = Date.now();

    // Get supplier performance data from analytics service
    const performanceResult = await analyticsService.getSupplierPerformance({
      supplierId,
      dateFrom,
      dateTo,
      performanceThreshold: parsedThreshold,
      includeRankings: includeRankingsBool,
      includeComparisons: includeComparisonsBool
    });

    const duration = Date.now() - startTime;

    // Check if response time meets target (< 2 seconds)
    if (duration > 2000) {
      console.warn(`Supplier performance endpoint exceeded 2s target: ${duration}ms`);
    }

    // Set appropriate cache headers (10-15 minutes)
    res.set({
      'Cache-Control': 'public, max-age=900', // 15 minutes
      'ETag': `"supplier-perf-${performanceResult.correlationId}"`
    });

    res.json({
      success: true,
      data: performanceResult.data,
      performance: {
        queryDuration: `${duration}ms`,
        target: '<2000ms',
        fromCache: performanceResult.fromCache || false,
        correlationId: performanceResult.correlationId
      },
      metadata: {
        endpoint: '/api/analytics/suppliers/performance',
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        parameters: {
          supplierId,
          dateFrom,
          dateTo,
          performanceThreshold: parsedThreshold,
          includeRankings: includeRankingsBool,
          includeComparisons: includeComparisonsBool
        }
      }
    });

  } catch (error) {
    console.error('Error in supplier performance endpoint:', error);
    
    // Handle specific analytics service errors
    if (error.message.includes('Analytics query failed')) {
      return res.status(500).json({
        error: 'Analytics service error',
        details: error.message,
        endpoint: '/api/analytics/suppliers/performance'
      });
    }

    // Handle database connection errors
    if (error.message.includes('connection') || error.message.includes('database')) {
      return res.status(503).json({
        error: 'Database service unavailable',
        message: 'Unable to connect to analytics database',
        retry: true
      });
    }

    // Handle supplier not found errors
    if (error.message.includes('supplier') && error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Supplier not found',
        message: 'The specified supplier ID does not exist',
        supplierId
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'An unexpected error occurred while processing supplier performance analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      endpoint: '/api/analytics/suppliers/performance'
    });
  }
});

/**
 * Supplier Price Trends Analytics Endpoint
 * GET /api/analytics/suppliers/price-trends
 * Returns price trend analysis for suppliers with filtering and comparisons
 */
router.get('/suppliers/price-trends', async (req, res) => {
  try {
    const {
      supplierId = null,
      productId = null,
      dateFrom = null,
      dateTo = null,
      timeframe = 'monthly'
    } = req.query;

    // Validate timeframe parameter
    const validTimeframes = ['daily', 'weekly', 'monthly'];
    if (!validTimeframes.includes(timeframe)) {
      return res.status(400).json({
        error: 'Invalid timeframe parameter',
        validTimeframes,
        provided: timeframe
      });
    }

    // Validate supplier ID if provided
    if (supplierId && (isNaN(parseInt(supplierId)) || parseInt(supplierId) < 1)) {
      return res.status(400).json({
        error: 'Invalid supplierId parameter',
        message: 'supplierId must be a positive integer',
        provided: supplierId
      });
    }

    // Validate product ID if provided
    if (productId && (isNaN(parseInt(productId)) || parseInt(productId) < 1)) {
      return res.status(400).json({
        error: 'Invalid productId parameter',
        message: 'productId must be a positive integer',
        provided: productId
      });
    }

    // Validate date parameters
    if (dateFrom && isNaN(Date.parse(dateFrom))) {
      return res.status(400).json({
        error: 'Invalid dateFrom parameter',
        message: 'dateFrom must be a valid ISO date string',
        provided: dateFrom
      });
    }

    if (dateTo && isNaN(Date.parse(dateTo))) {
      return res.status(400).json({
        error: 'Invalid dateTo parameter',
        message: 'dateTo must be a valid ISO date string',
        provided: dateTo
      });
    }

    // Validate date range
    if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: 'dateFrom must be before dateTo',
        dateFrom,
        dateTo
      });
    }

    const startTime = Date.now();

    // Get supplier price trends from analytics service
    const priceTrendsResult = await analyticsService.getSupplierPriceTrends({
      supplierId: supplierId ? parseInt(supplierId) : null,
      productId: productId ? parseInt(productId) : null,
      dateFrom,
      dateTo,
      timeframe
    });

    const duration = Date.now() - startTime;

    // Check if response time meets target (< 2 seconds)
    if (duration > 2000) {
      console.warn(`Supplier price trends endpoint exceeded 2s target: ${duration}ms`);
    }

    // Set appropriate cache headers (10-15 minutes)
    res.set({
      'Cache-Control': 'public, max-age=900', // 15 minutes
      'ETag': `"supplier-price-trends-${priceTrendsResult.correlationId}"`
    });

    res.json({
      success: true,
      data: priceTrendsResult.data,
      performance: {
        queryDuration: `${duration}ms`,
        target: '<2000ms',
        fromCache: priceTrendsResult.fromCache || false,
        correlationId: priceTrendsResult.correlationId
      },
      metadata: {
        endpoint: '/api/analytics/suppliers/price-trends',
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        parameters: {
          supplierId: supplierId ? parseInt(supplierId) : null,
          productId: productId ? parseInt(productId) : null,
          dateFrom,
          dateTo,
          timeframe
        }
      }
    });

  } catch (error) {
    console.error('Error in supplier price trends endpoint:', error);
    
    // Handle specific analytics service errors
    if (error.message.includes('Analytics query failed')) {
      return res.status(500).json({
        error: 'Analytics service error',
        details: error.message,
        endpoint: '/api/analytics/suppliers/price-trends'
      });
    }

    // Handle database connection errors
    if (error.message.includes('connection') || error.message.includes('database')) {
      return res.status(503).json({
        error: 'Database service unavailable',
        message: 'Unable to connect to analytics database',
        retry: true
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'An unexpected error occurred while processing supplier price trends',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      endpoint: '/api/analytics/suppliers/price-trends'
    });
  }
});

/**
 * Supplier Scorecard Analytics Endpoint
 * GET /api/analytics/suppliers/:id/scorecard
 * Returns comprehensive supplier scorecard with performance metrics and recommendations
 */
router.get('/suppliers/:id/scorecard', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      dateFrom = null,
      dateTo = null,
      includeRecommendations = 'true'
    } = req.query;

    // Validate supplier ID
    const supplierId = parseInt(id);
    if (isNaN(supplierId) || supplierId < 1) {
      return res.status(400).json({
        error: 'Invalid supplier ID',
        message: 'Supplier ID must be a positive integer',
        provided: id
      });
    }

    // Validate date parameters
    if (dateFrom && isNaN(Date.parse(dateFrom))) {
      return res.status(400).json({
        error: 'Invalid dateFrom parameter',
        message: 'dateFrom must be a valid ISO date string',
        provided: dateFrom
      });
    }

    if (dateTo && isNaN(Date.parse(dateTo))) {
      return res.status(400).json({
        error: 'Invalid dateTo parameter',
        message: 'dateTo must be a valid ISO date string',
        provided: dateTo
      });
    }

    // Validate date range
    if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: 'dateFrom must be before dateTo',
        dateFrom,
        dateTo
      });
    }

    const startTime = Date.now();

    // Get supplier scorecard from analytics service
    const scorecardResult = await analyticsService.getSupplierScorecard(supplierId, {
      dateFrom,
      dateTo,
      includeRecommendations: includeRecommendations === 'true'
    });

    const duration = Date.now() - startTime;

    // Check if response time meets target (< 2 seconds)
    if (duration > 2000) {
      console.warn(`Supplier scorecard endpoint exceeded 2s target: ${duration}ms`);
    }

    // Set appropriate cache headers (10-15 minutes)
    res.set({
      'Cache-Control': 'public, max-age=900', // 15 minutes
      'ETag': `"supplier-scorecard-${scorecardResult.correlationId}"`
    });

    res.json({
      success: true,
      data: scorecardResult.data,
      performance: {
        queryDuration: `${duration}ms`,
        target: '<2000ms',
        fromCache: scorecardResult.fromCache || false,
        correlationId: scorecardResult.correlationId
      },
      metadata: {
        endpoint: `/api/analytics/suppliers/${supplierId}/scorecard`,
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        parameters: {
          supplierId,
          dateFrom,
          dateTo,
          includeRecommendations: includeRecommendations === 'true'
        }
      }
    });

  } catch (error) {
    console.error('Error in supplier scorecard endpoint:', error);
    
    // Handle supplier not found errors
    if (error.message.includes('not found')) {
      return res.status(404).json({
        error: 'Supplier not found',
        message: error.message,
        supplierId: req.params.id
      });
    }

    // Handle specific analytics service errors
    if (error.message.includes('Analytics query failed')) {
      return res.status(500).json({
        error: 'Analytics service error',
        details: error.message,
        endpoint: `/api/analytics/suppliers/${req.params.id}/scorecard`
      });
    }

    // Handle database connection errors
    if (error.message.includes('connection') || error.message.includes('database')) {
      return res.status(503).json({
        error: 'Database service unavailable',
        message: 'Unable to connect to analytics database',
        retry: true
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'An unexpected error occurred while processing supplier scorecard',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      endpoint: `/api/analytics/suppliers/${req.params.id}/scorecard`
    });
  }
});

/**
 * Sales Analytics Performance Endpoint  
 * GET /api/analytics/sales/performance
 * Returns sales performance metrics including revenue, growth, and product analysis
 */
router.get('/sales/performance', async (req, res) => {
  try {
    const {
      dateFrom = null,
      dateTo = null,
      aggregation = 'daily',
      dimension = null,
      dimensionId = null
    } = req.query;

    // Validate aggregation parameter
    const validAggregations = ['daily', 'weekly', 'monthly'];
    if (!validAggregations.includes(aggregation)) {
      return res.status(400).json({
        error: 'Invalid aggregation parameter',
        validAggregations,
        provided: aggregation
      });
    }

    // Validate date parameters
    if (dateFrom && isNaN(Date.parse(dateFrom))) {
      return res.status(400).json({
        error: 'Invalid dateFrom parameter',
        message: 'dateFrom must be a valid ISO date string',
        provided: dateFrom
      });
    }

    if (dateTo && isNaN(Date.parse(dateTo))) {
      return res.status(400).json({
        error: 'Invalid dateTo parameter', 
        message: 'dateTo must be a valid ISO date string',
        provided: dateTo
      });
    }

    // Validate date range
    if (dateFrom && dateTo && new Date(dateFrom) > new Date(dateTo)) {
      return res.status(400).json({
        error: 'Invalid date range',
        message: 'dateFrom must be before dateTo',
        dateFrom,
        dateTo
      });
    }

    const startTime = Date.now();

    // Get sales performance metrics from analytics service
    const salesMetrics = await analyticsService.getSalesMetrics({
      dateFrom,
      dateTo,
      aggregation,
      dimension,
      dimensionId
    });

    const duration = Date.now() - startTime;

    // Check if response time meets target (< 2 seconds)
    if (duration > 2000) {
      console.warn(`Sales performance endpoint exceeded 2s target: ${duration}ms`);
    }

    // Set appropriate cache headers
    res.set({
      'Cache-Control': 'public, max-age=300', // 5 minutes for sales data
      'ETag': `"sales-perf-${salesMetrics.correlationId}"`
    });

    res.json({
      success: true,
      data: salesMetrics.data,
      performance: {
        queryDuration: `${duration}ms`,
        target: '<2000ms',
        fromCache: salesMetrics.fromCache || false,
        correlationId: salesMetrics.correlationId
      },
      metadata: {
        endpoint: '/api/analytics/sales/performance',
        version: '1.0.0',
        generatedAt: new Date().toISOString(),
        parameters: {
          dateFrom,
          dateTo,
          aggregation,
          dimension,
          dimensionId
        }
      }
    });

  } catch (error) {
    console.error('Error in sales performance endpoint:', error);
    
    // Handle specific analytics service errors
    if (error.message.includes('Analytics query failed')) {
      return res.status(500).json({
        error: 'Analytics service error',
        details: error.message,
        endpoint: '/api/analytics/sales/performance'
      });
    }

    // Handle database connection errors
    if (error.message.includes('connection') || error.message.includes('database')) {
      return res.status(503).json({
        error: 'Database service unavailable',
        message: 'Unable to connect to analytics database',
        retry: true
      });
    }

    res.status(500).json({
      error: 'Internal server error',
      message: 'An unexpected error occurred while processing sales performance analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined,
      endpoint: '/api/analytics/sales/performance'
    });
  }
});

/**
 * Sales Growth Analytics Endpoint
 * GET /api/analytics/sales/growth
 * Returns sales growth rate calculations and trend analysis
 */
router.get('/sales/growth', async (req, res) => {
  try {
    const {
      dateFrom = null,
      dateTo = null,
      period = 'monthly',
      compareWith = 'previous_period'
    } = req.query;

    // Validate period parameter
    const validPeriods = ['daily', 'weekly', 'monthly', 'quarterly'];
    if (!validPeriods.includes(period)) {
      return res.status(400).json({
        error: 'Invalid period parameter',
        validPeriods,
        provided: period
      });
    }

    // Validate comparison parameter
    const validComparisons = ['previous_period', 'same_period_last_year'];
    if (!validComparisons.includes(compareWith)) {
      return res.status(400).json({
        error: 'Invalid compareWith parameter',
        validComparisons,
        provided: compareWith
      });
    }

    const startTime = Date.now();

    // Get sales growth analytics from service
    const growthAnalytics = await analyticsService.getAdvancedAnalytics({
      analysis_type: 'sales_growth',
      dateFrom,
      dateTo,
      period,
      compareWith
    });

    const duration = Date.now() - startTime;

    res.json({
      success: true,
      data: growthAnalytics.data,
      performance: {
        queryDuration: `${duration}ms`,
        target: '<2000ms',
        fromCache: growthAnalytics.fromCache || false
      },
      metadata: {
        endpoint: '/api/analytics/sales/growth',
        version: '1.0.0',
        parameters: { dateFrom, dateTo, period, compareWith }
      }
    });

  } catch (error) {
    console.error('Error in sales growth endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to generate sales growth analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

/**
 * Cross-Module Integration Analytics Endpoint
 * GET /api/analytics/cross-module
 * Returns unified analytics data across customers, suppliers, inventory, and sales
 */
router.get('/cross-module', async (req, res) => {
  try {
    const {
      dateFrom = null,
      dateTo = null,
      modules = 'customers,suppliers,inventory,sales'
    } = req.query;

    const moduleList = modules.split(',').map(m => m.trim());
    const validModules = ['customers', 'suppliers', 'inventory', 'sales'];
    
    // Validate modules parameter
    const invalidModules = moduleList.filter(m => !validModules.includes(m));
    if (invalidModules.length > 0) {
      return res.status(400).json({
        error: 'Invalid modules parameter',
        validModules,
        invalidModules,
        provided: modules
      });
    }

    const startTime = Date.now();

    // Get cross-module analytics with parallel execution
    const modulePromises = {};
    
    if (moduleList.includes('customers')) {
      modulePromises.customers = analyticsService.getCustomerAnalytics({
        dateFrom,
        dateTo,
        includeDetails: false
      });
    }
    
    if (moduleList.includes('suppliers')) {
      modulePromises.suppliers = analyticsService.getSupplierPerformance({
        dateFrom,
        dateTo,
        includeRankings: false,
        includeComparisons: false
      });
    }
    
    if (moduleList.includes('inventory')) {
      modulePromises.inventory = analyticsService.getInventoryMetrics({
        dateFrom,
        dateTo
      });
    }
    
    if (moduleList.includes('sales')) {
      modulePromises.sales = analyticsService.getSalesMetrics({
        dateFrom,
        dateTo,
        aggregation: 'daily'
      });
    }

    // Execute all queries in parallel
    const moduleResults = await Promise.allSettled(Object.entries(modulePromises).map(
      async ([module, promise]) => [module, await promise]
    ));

    // Process results and separate successful from failed
    const crossModuleData = {
      successful: {},
      failed: {},
      summary: {
        totalModules: moduleList.length,
        successfulModules: 0,
        failedModules: 0
      }
    };

    moduleResults.forEach(result => {
      if (result.status === 'fulfilled') {
        const [module, data] = result.value;
        crossModuleData.successful[module] = data;
        crossModuleData.summary.successfulModules++;
      } else {
        const failedModule = moduleList[moduleResults.indexOf(result)];
        crossModuleData.failed[failedModule] = {
          error: result.reason.message,
          timestamp: new Date().toISOString()
        };
        crossModuleData.summary.failedModules++;
      }
    });

    // Generate unified insights if we have data from multiple modules
    if (crossModuleData.summary.successfulModules >= 2) {
      crossModuleData.insights = await generateCrossModuleInsights(crossModuleData.successful);
    }

    const duration = Date.now() - startTime;

    res.json({
      success: crossModuleData.summary.successfulModules > 0,
      data: crossModuleData,
      performance: {
        queryDuration: `${duration}ms`,
        target: '<2000ms',
        parallelExecution: true
      },
      metadata: {
        endpoint: '/api/analytics/cross-module',
        version: '1.0.0',
        requestedModules: moduleList,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error in cross-module analytics endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      message: 'Failed to generate cross-module analytics',
      details: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
});

// Helper function to generate cross-module insights
async function generateCrossModuleInsights(moduleData) {
  const insights = [];

  // Customer-Sales correlation
  if (moduleData.customers && moduleData.sales) {
    const avgCustomerValue = moduleData.customers.data?.totalRevenue / moduleData.customers.data?.totalCustomers || 0;
    const avgOrderValue = moduleData.sales.data?.summary?.avgOrderValue || 0;
    
    insights.push({
      type: 'customer_sales_correlation',
      metric: 'Average Customer Lifetime Value vs Order Value',
      value: avgCustomerValue,
      comparison: avgOrderValue,
      insight: avgCustomerValue > avgOrderValue * 10 
        ? 'High customer lifetime value indicates strong customer retention'
        : 'Customer acquisition may need improvement'
    });
  }

  // Supplier-Inventory correlation  
  if (moduleData.suppliers && moduleData.inventory) {
    insights.push({
      type: 'supplier_inventory_correlation',
      metric: 'Supply Chain Efficiency',
      insight: 'Cross-reference inventory turnover with supplier performance for optimization opportunities'
    });
  }

  // Sales-Inventory correlation
  if (moduleData.sales && moduleData.inventory) {
    insights.push({
      type: 'sales_inventory_correlation', 
      metric: 'Sales vs Stock Levels',
      insight: 'Monitor sales velocity against inventory levels to optimize reorder points'
    });
  }

  return insights;
}

/**
 * Analytics Service Health Check Endpoint
 * GET /api/analytics/health
 * Returns health status of analytics service
 */
router.get('/health', async (req, res) => {
  try {
    const healthCheck = await analyticsService.healthCheck();
    
    const statusCode = healthCheck.status === 'healthy' ? 200 : 
                      healthCheck.status === 'degraded' ? 206 : 503;

    res.status(statusCode).json({
      success: healthCheck.status !== 'unhealthy',
      data: healthCheck,
      metadata: {
        endpoint: '/api/analytics/health',
        version: '1.0.0',
        checkedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error in analytics health check:', error);
    res.status(503).json({
      success: false,
      error: 'Health check failed',
      details: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

export default router;