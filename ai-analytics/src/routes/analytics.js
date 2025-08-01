const express = require('express');
const Joi = require('joi');
const logger = require('../utils/logger');
const AnalyticsEngine = require('../core/AnalyticsEngine');
const { RateLimiterMemory } = require('rate-limiter-flexible');

const router = express.Router();

// Rate limiting for analytics endpoints
const rateLimiter = new RateLimiterMemory({
  keyGetter: (req) => req.ip,
  points: 50, // Number of requests
  duration: 60, // Per 60 seconds
});

// Validation schemas
const analyticsSubmissionSchema = Joi.object({
  type: Joi.string().valid('user-behavior', 'performance', 'predictive', 'anomaly', 'clustering', 'time-series', 'general').required(),
  data: Joi.alternatives().try(
    Joi.array().items(Joi.object()),
    Joi.object()
  ).required(),
  metadata: Joi.object().optional(),
  clientId: Joi.string().optional()
});

const batchAnalyticsSchema = Joi.object({
  analyses: Joi.array().items(analyticsSubmissionSchema).min(1).max(10).required()
});

const querySchema = Joi.object({
  type: Joi.string().required(),
  filters: Joi.object().optional(),
  timeRange: Joi.object({
    start: Joi.date().required(),
    end: Joi.date().required()
  }).optional(),
  limit: Joi.number().integer().min(1).max(1000).default(100),
  offset: Joi.number().integer().min(0).default(0)
});

// Middleware for rate limiting
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

// Middleware for request validation
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

// Initialize analytics engine instance
let analyticsEngine;
const getAnalyticsEngine = () => {
  if (!analyticsEngine) {
    const EventBus = require('../core/EventBus');
    const eventBus = new EventBus();
    analyticsEngine = new AnalyticsEngine(eventBus);
  }
  return analyticsEngine;
};

/**
 * POST /api/analytics/submit
 * Submit data for analytics processing
 */
router.post('/submit', applyRateLimit, validateRequest(analyticsSubmissionSchema), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { type, data, metadata = {}, clientId } = req.validatedBody;
    
    logger.info('Analytics submission received', {
      type,
      dataPoints: Array.isArray(data) ? data.length : 1,
      clientId,
      ip: req.ip
    });

    // Add request metadata
    const enrichedData = {
      ...data,
      metadata: {
        ...metadata,
        submittedAt: new Date(),
        source: 'api',
        clientId,
        ip: req.ip,
        userAgent: req.get('User-Agent')
      }
    };

    // Process analytics
    const engine = getAnalyticsEngine();
    const result = await engine.processData(enrichedData, type);

    const responseTime = Date.now() - startTime;
    
    logger.apiResponse('/api/analytics/submit', 200, responseTime, {
      analysisId: result.analysisId,
      type: result.type,
      insights: result.insights?.length || 0
    });

    res.json({
      success: true,
      analysisId: result.analysisId,
      type: result.type,
      timestamp: result.timestamp,
      processingTime: result.processingTime,
      insights: result.insights?.length || 0,
      summary: result.summary
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Analytics submission error', error, {
      body: req.validatedBody,
      ip: req.ip
    });

    logger.apiResponse('/api/analytics/submit', 500, responseTime, { error: error.message });

    res.status(500).json({
      error: 'Analytics processing failed',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/analytics/batch
 * Submit multiple analytics requests in batch
 */
router.post('/batch', applyRateLimit, validateRequest(batchAnalyticsSchema), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { analyses } = req.validatedBody;
    
    logger.info('Batch analytics submission received', {
      count: analyses.length,
      types: [...new Set(analyses.map(a => a.type))],
      ip: req.ip
    });

    const engine = getAnalyticsEngine();
    const results = [];
    const errors = [];

    // Process each analysis
    for (let i = 0; i < analyses.length; i++) {
      const analysis = analyses[i];
      
      try {
        const enrichedData = {
          ...analysis.data,
          metadata: {
            ...analysis.metadata,
            submittedAt: new Date(),
            source: 'api-batch',
            batchIndex: i,
            ip: req.ip,
            userAgent: req.get('User-Agent')
          }
        };

        const result = await engine.processData(enrichedData, analysis.type);
        results.push(result);
        
      } catch (error) {
        errors.push({
          index: i,
          type: analysis.type,
          error: error.message
        });
      }
    }

    const responseTime = Date.now() - startTime;
    
    logger.apiResponse('/api/analytics/batch', 200, responseTime, {
      successful: results.length,
      failed: errors.length
    });

    res.json({
      success: true,
      processed: results.length,
      failed: errors.length,
      results: results.map(r => ({
        analysisId: r.analysisId,
        type: r.type,
        timestamp: r.timestamp,
        processingTime: r.processingTime,
        insights: r.insights?.length || 0
      })),
      errors: errors.length > 0 ? errors : undefined
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Batch analytics error', error, {
      body: req.validatedBody,
      ip: req.ip
    });

    logger.apiResponse('/api/analytics/batch', 500, responseTime, { error: error.message });

    res.status(500).json({
      error: 'Batch analytics processing failed',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/analytics/result/:id
 * Get analytics result by ID
 */
router.get('/result/:id', applyRateLimit, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    
    logger.debug('Analytics result requested', { analysisId: id, ip: req.ip });

    const engine = getAnalyticsEngine();
    const result = await engine.getCachedResult(id);

    const responseTime = Date.now() - startTime;

    if (!result) {
      logger.apiResponse('/api/analytics/result/:id', 404, responseTime);
      return res.status(404).json({
        error: 'Analysis result not found',
        analysisId: id
      });
    }

    logger.apiResponse('/api/analytics/result/:id', 200, responseTime, {
      analysisId: id,
      type: result.type
    });

    res.json({
      success: true,
      result
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Get analytics result error', error, {
      analysisId: req.params.id,
      ip: req.ip
    });

    logger.apiResponse('/api/analytics/result/:id', 500, responseTime, { error: error.message });

    res.status(500).json({
      error: 'Failed to retrieve analytics result',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * POST /api/analytics/query
 * Query historical analytics data
 */
router.post('/query', applyRateLimit, validateRequest(querySchema), async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { type, filters = {}, timeRange, limit, offset } = req.validatedBody;
    
    logger.info('Analytics query received', {
      type,
      filters,
      timeRange,
      limit,
      offset,
      ip: req.ip
    });

    // This would typically query a database or cache
    // For now, return mock data structure
    const mockResults = {
      total: 100,
      limit,
      offset,
      data: [],
      aggregations: {
        count: 100,
        averages: {},
        trends: {}
      }
    };

    const responseTime = Date.now() - startTime;
    
    logger.apiResponse('/api/analytics/query', 200, responseTime, {
      type,
      results: mockResults.data.length
    });

    res.json({
      success: true,
      ...mockResults,
      processingTime: responseTime,
      timestamp: new Date()
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Analytics query error', error, {
      body: req.validatedBody,
      ip: req.ip
    });

    logger.apiResponse('/api/analytics/query', 500, responseTime, { error: error.message });

    res.status(500).json({
      error: 'Analytics query failed',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/analytics/metrics
 * Get analytics engine metrics
 */
router.get('/metrics', applyRateLimit, async (req, res) => {
  const startTime = Date.now();
  
  try {
    logger.debug('Analytics metrics requested', { ip: req.ip });

    const engine = getAnalyticsEngine();
    const metrics = engine.getMetrics();

    const responseTime = Date.now() - startTime;
    
    logger.apiResponse('/api/analytics/metrics', 200, responseTime);

    res.json({
      success: true,
      metrics,
      timestamp: new Date()
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Get analytics metrics error', error, { ip: req.ip });

    logger.apiResponse('/api/analytics/metrics', 500, responseTime, { error: error.message });

    res.status(500).json({
      error: 'Failed to retrieve analytics metrics',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/analytics/health
 * Get analytics engine health status
 */
router.get('/health', async (req, res) => {
  const startTime = Date.now();
  
  try {
    logger.debug('Analytics health check requested', { ip: req.ip });

    const engine = getAnalyticsEngine();
    const health = await engine.getHealth();

    const responseTime = Date.now() - startTime;
    const statusCode = health.status === 'healthy' ? 200 : 503;
    
    logger.apiResponse('/api/analytics/health', statusCode, responseTime);

    res.status(statusCode).json({
      success: health.status === 'healthy',
      ...health,
      timestamp: new Date()
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Analytics health check error', error, { ip: req.ip });

    logger.apiResponse('/api/analytics/health', 500, responseTime, { error: error.message });

    res.status(500).json({
      success: false,
      status: 'unhealthy',
      error: error.message,
      timestamp: new Date()
    });
  }
});

/**
 * DELETE /api/analytics/result/:id
 * Delete analytics result
 */
router.delete('/result/:id', applyRateLimit, async (req, res) => {
  const startTime = Date.now();
  
  try {
    const { id } = req.params;
    
    logger.info('Analytics result deletion requested', { analysisId: id, ip: req.ip });

    // This would typically delete from cache/database
    // For now, just acknowledge the request
    const responseTime = Date.now() - startTime;
    
    logger.apiResponse('/api/analytics/result/:id', 200, responseTime);

    res.json({
      success: true,
      message: 'Analysis result deleted',
      analysisId: id,
      timestamp: new Date()
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Delete analytics result error', error, {
      analysisId: req.params.id,
      ip: req.ip
    });

    logger.apiResponse('/api/analytics/result/:id', 500, responseTime, { error: error.message });

    res.status(500).json({
      error: 'Failed to delete analytics result',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

/**
 * GET /api/analytics/types
 * Get available analytics types
 */
router.get('/types', async (req, res) => {
  const startTime = Date.now();
  
  try {
    const types = [
      {
        type: 'user-behavior',
        description: 'Analyze user interaction patterns and behavior flows',
        capabilities: ['session-analysis', 'flow-analysis', 'behavior-prediction']
      },
      {
        type: 'performance',
        description: 'Analyze system and application performance metrics',
        capabilities: ['response-time-analysis', 'resource-usage', 'error-analysis']
      },
      {
        type: 'predictive',
        description: 'Generate predictions using machine learning models',
        capabilities: ['time-series-forecast', 'demand-prediction', 'churn-prediction']
      },
      {
        type: 'anomaly',
        description: 'Detect anomalies and outliers in data',
        capabilities: ['statistical-detection', 'ml-detection', 'time-based-detection']
      },
      {
        type: 'clustering',
        description: 'Perform clustering analysis to identify patterns',
        capabilities: ['k-means', 'hierarchical', 'density-based']
      },
      {
        type: 'time-series',
        description: 'Analyze time-based data for trends and patterns',
        capabilities: ['trend-analysis', 'seasonality-detection', 'forecasting']
      },
      {
        type: 'general',
        description: 'General statistical analysis and insights',
        capabilities: ['descriptive-stats', 'correlation-analysis', 'outlier-detection']
      }
    ];

    const responseTime = Date.now() - startTime;
    logger.apiResponse('/api/analytics/types', 200, responseTime);

    res.json({
      success: true,
      types,
      timestamp: new Date()
    });

  } catch (error) {
    const responseTime = Date.now() - startTime;
    logger.errorWithContext('Get analytics types error', error, { ip: req.ip });

    res.status(500).json({
      error: 'Failed to retrieve analytics types',
      message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error'
    });
  }
});

// Error handling middleware for this router
router.use((error, req, res, next) => {
  logger.error('Analytics router error:', error);
  
  res.status(500).json({
    error: 'Analytics service error',
    message: process.env.NODE_ENV === 'development' ? error.message : 'Internal server error',
    timestamp: new Date()
  });
});

module.exports = router;