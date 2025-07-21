import express from 'express';
import aiService from '../services/ai.service.js';
import * as inventoryQueries from '../db/inventory-queries.js';
import * as supplierQueries from '../db/supplier-queries.js';
import * as priceListQueries from '../db/price-list-queries.js';

const router = express.Router();

/**
 * AI Analytics Query Endpoint
 * POST /api/analytics/ai/query
 * Processes natural language queries and returns analytics data
 */
router.post('/query', async (req, res) => {
  try {
    const { query, context } = req.body;

    if (!query || typeof query !== 'string') {
      return res.status(400).json({
        error: 'Query is required and must be a string',
        example: 'Show me products with low stock levels'
      });
    }

    // Process natural language query
    const queryResult = await aiService.processNaturalLanguageQuery(query);
    
    if (!queryResult.success) {
      // Use fallback query if AI processing fails
      if (queryResult.fallback) {
        queryResult.data = queryResult.fallback;
        queryResult.success = true;
        queryResult.usingFallback = true;
      } else {
        return res.status(500).json({
          error: 'Failed to process query',
          details: queryResult.error,
          originalQuery: query
        });
      }
    }

    // Translate to analytics query
    const analyticsQuery = aiService.translateToAnalyticsQuery(queryResult.data);
    
    // Execute the appropriate query based on intent
    let analyticsData;
    try {
      analyticsData = await executeAnalyticsQuery(analyticsQuery, req.user);
    } catch (error) {
      return res.status(500).json({
        error: 'Failed to execute analytics query',
        details: error.message,
        queryIntent: queryResult.data
      });
    }

    // Generate insights if AI is available
    let insights = [];
    if (aiService.isConfigured() && !queryResult.usingFallback) {
      const insightsResult = await aiService.generateInsights(analyticsData, context || 'query');
      if (insightsResult.success) {
        insights = insightsResult.insights;
      }
    }

    res.json({
      success: true,
      originalQuery: query,
      processedQuery: queryResult.data,
      analyticsData,
      insights,
      usingFallback: queryResult.usingFallback || false,
      timestamp: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error in AI query endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * AI Insights Generation Endpoint
 * GET /api/analytics/ai/insights
 * Generates AI-powered insights from current analytics data
 */
router.get('/insights', async (req, res) => {
  try {
    const { 
      context = 'general',
      warehouseId = null,
      timeframe = '30d',
      focus = 'inventory'
    } = req.query;

    if (!aiService.isConfigured()) {
      return res.status(503).json({
        error: 'AI service not configured',
        message: 'AI insights require OpenAI API configuration',
        fallback: {
          insights: aiService.getFallbackInsights({}, context),
          summary: 'AI service not available. Basic insights provided.'
        }
      });
    }

    // Gather relevant analytics data based on focus area
    let analyticsData = {};
    
    try {
      switch (focus) {
        case 'inventory':
          analyticsData = await inventoryQueries.getInventoryAnalytics({ warehouseId });
          break;
        case 'suppliers':
          const suppliersResult = await supplierQueries.getSuppliers({ 
            page: 1, 
            limit: 100, 
            isActive: true 
          });
          analyticsData = suppliersResult.data;
          break;
        case 'pricing':
          const priceListsResult = await priceListQueries.getPriceLists({
            page: 1,
            limit: 100,
            status: 'active'
          });
          analyticsData = priceListsResult.data;
          break;
        default:
          analyticsData = await inventoryQueries.getInventoryAnalytics({ warehouseId });
      }
    } catch (error) {
      console.error('Error gathering analytics data:', error);
      return res.status(500).json({
        error: 'Failed to gather analytics data',
        details: error.message
      });
    }

    // Generate AI insights
    const insightsResult = await aiService.generateInsights(analyticsData, context);
    
    if (!insightsResult.success) {
      return res.status(500).json({
        error: 'Failed to generate insights',
        details: insightsResult.error,
        fallback: {
          insights: aiService.getFallbackInsights(analyticsData, context),
          summary: 'AI insights unavailable. Basic analysis provided.'
        }
      });
    }

    res.json({
      success: true,
      context,
      focus,
      timeframe,
      ...insightsResult,
      dataScope: {
        recordCount: Array.isArray(analyticsData) ? analyticsData.length : Object.keys(analyticsData).length,
        warehouseId,
        generatedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Error in AI insights endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * AI Recommendations Endpoint
 * POST /api/analytics/ai/recommendations
 * Generates AI-powered recommendations based on current state
 */
router.post('/recommendations', async (req, res) => {
  try {
    const { 
      focusArea = 'inventory',
      priority = 'all',
      timeframe = 'short_term',
      includeAnalytics = true
    } = req.body;

    if (!aiService.isConfigured()) {
      return res.status(503).json({
        error: 'AI service not configured',
        message: 'AI recommendations require OpenAI API configuration',
        fallback: {
          recommendations: aiService.getFallbackRecommendations(focusArea),
          summary: 'AI service not available. Basic recommendations provided.'
        }
      });
    }

    // Gather comprehensive analytics data for recommendations with memory optimization
    let analyticsData = {};
    
    try {
      // Reduce concurrent queries and limit data size to prevent memory spikes
      const inventoryAnalytics = await inventoryQueries.getInventoryAnalytics({});
      const reorderSuggestions = await inventoryQueries.getReorderSuggestions();
      const suppliersData = await supplierQueries.getSuppliers({ page: 1, limit: 50, isActive: true }); // Reduced from 100 to 50

      analyticsData = {
        inventory: {
          summary: inventoryAnalytics.summary, // Only include summary to reduce memory usage
          categoryBreakdown: inventoryAnalytics.categoryBreakdown?.slice(0, 10) || [] // Limit categories
        },
        reorderSuggestions: reorderSuggestions.slice(0, 20), // Limit reorder suggestions to top 20
        suppliers: suppliersData.data?.slice(0, 20) || [], // Limit suppliers to top 20
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error gathering analytics data for recommendations:', error);
      return res.status(500).json({
        error: 'Failed to gather analytics data',
        details: error.message
      });
    }

    // Generate AI recommendations
    const recommendationsResult = await aiService.generateRecommendations(analyticsData, focusArea);
    
    if (!recommendationsResult.success) {
      return res.status(500).json({
        error: 'Failed to generate recommendations',
        details: recommendationsResult.error,
        fallback: {
          recommendations: aiService.getFallbackRecommendations(focusArea),
          summary: 'AI recommendations unavailable. Basic suggestions provided.'
        }
      });
    }

    // Filter recommendations by priority if specified
    let filteredRecommendations = recommendationsResult.recommendations;
    if (priority !== 'all') {
      filteredRecommendations = recommendationsResult.recommendations.filter(
        rec => rec.impact === priority || rec.priority === priority
      );
    }

    // Filter by timeframe if specified
    if (timeframe !== 'all') {
      filteredRecommendations = filteredRecommendations.filter(
        rec => rec.timeframe === timeframe
      );
    }

    const response = {
      success: true,
      focusArea,
      priority,
      timeframe,
      recommendations: filteredRecommendations,
      priorityMatrix: recommendationsResult.priorityMatrix,
      generatedAt: recommendationsResult.generatedAt,
      summary: `Generated ${filteredRecommendations.length} recommendations for ${focusArea}`
    };

    // Include analytics data if requested
    if (includeAnalytics) {
      response.analyticsSnapshot = analyticsData;
    }

    res.json(response);

  } catch (error) {
    console.error('Error in AI recommendations endpoint:', error);
    res.status(500).json({
      error: 'Internal server error',
      details: error.message
    });
  }
});

/**
 * AI Service Status Endpoint
 * GET /api/analytics/ai/status
 * Returns the current status and configuration of the AI service
 */
router.get('/status', async (req, res) => {
  try {
    const status = {
      configured: aiService.isConfigured(),
      model: process.env.OPENAI_MODEL || 'gpt-3.5-turbo',
      baseUrl: process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1',
      maxTokens: parseInt(process.env.OPENAI_MAX_TOKENS) || 1000,
      temperature: parseFloat(process.env.OPENAI_TEMPERATURE) || 0.7,
      features: {
        naturalLanguageQuery: aiService.isConfigured(),
        insightsGeneration: aiService.isConfigured(),
        recommendations: aiService.isConfigured(),
        fallbackMode: !aiService.isConfigured()
      },
      timestamp: new Date().toISOString()
    };

    // Test connectivity if configured
    if (aiService.isConfigured()) {
      try {
        const testResponse = await aiService.generateCompletion([
          { role: 'user', content: 'test' }
        ], { maxTokens: 10 });
        status.connectivity = 'connected';
        status.lastTestedAt = new Date().toISOString();
      } catch (error) {
        status.connectivity = 'error';
        status.connectivityError = error.message;
        status.lastTestedAt = new Date().toISOString();
      }
    } else {
      status.connectivity = 'not_configured';
    }

    res.json(status);
  } catch (error) {
    console.error('Error checking AI service status:', error);
    res.status(500).json({
      error: 'Failed to check AI service status',
      details: error.message
    });
  }
});

/**
 * Execute analytics query based on translated intent
 * @param {Object} queryConfig - Query configuration from AI translation
 * @param {Object} user - User context from JWT
 * @returns {Promise<Object>} Analytics data
 */
async function executeAnalyticsQuery(queryConfig, user) {
  const { type, endpoint, params, postProcess } = queryConfig;

  let data;

  // Execute the appropriate query function based on endpoint
  switch (endpoint) {
    case '/api/inventory':
      data = await inventoryQueries.getInventory(params);
      break;
    case '/api/inventory/reorder':
      data = await inventoryQueries.getReorderSuggestions();
      break;
    case '/api/inventory/analytics':
      data = await inventoryQueries.getInventoryAnalytics(params);
      break;
    case '/api/inventory/movements':
      data = await inventoryQueries.getMovements(params);
      break;
    case '/api/suppliers':
      data = await supplierQueries.getSuppliers(params);
      break;
    case '/api/price-lists':
      data = await priceListQueries.getPriceLists(params);
      break;
    default:
      throw new Error(`Unsupported endpoint: ${endpoint}`);
  }

  // Apply post-processing if specified
  if (postProcess && data) {
    data = await applyPostProcessing(data, postProcess, params);
  }

  return data;
}

/**
 * Apply post-processing to analytics data
 * @param {Object} data - Raw analytics data
 * @param {string} postProcess - Post-processing type
 * @param {Object} params - Additional parameters
 * @returns {Promise<Object>} Post-processed data
 */
async function applyPostProcessing(data, postProcess, params) {
  switch (postProcess) {
    case 'aggregateSupplierMetrics':
      if (Array.isArray(data.data)) {
        return {
          ...data,
          metrics: {
            totalSuppliers: data.data.length,
            activeSuppliers: data.data.filter(s => s.isActive).length,
            averageLeadTime: calculateAverageLeadTime(data.data),
            topPerformers: data.data.slice(0, 5)
          }
        };
      }
      break;
    case 'comparePrices':
      if (Array.isArray(data.data)) {
        return {
          ...data,
          priceComparison: generatePriceComparison(data.data)
        };
      }
      break;
    default:
      return data;
  }
  return data;
}

/**
 * Calculate average lead time for suppliers
 * @param {Array} suppliers - Supplier data
 * @returns {number} Average lead time in days
 */
function calculateAverageLeadTime(suppliers) {
  const validLeadTimes = suppliers
    .map(s => s.averageLeadTime)
    .filter(lt => lt && lt > 0);
  
  if (validLeadTimes.length === 0) return 0;
  
  return validLeadTimes.reduce((sum, lt) => sum + lt, 0) / validLeadTimes.length;
}

/**
 * Generate price comparison data
 * @param {Array} priceLists - Price list data
 * @returns {Object} Price comparison summary
 */
function generatePriceComparison(priceLists) {
  const activeLists = priceLists.filter(pl => pl.status === 'active');
  
  return {
    totalPriceLists: priceLists.length,
    activePriceLists: activeLists.length,
    averageDiscountRate: calculateAverageDiscount(activeLists),
    priceRanges: calculatePriceRanges(activeLists)
  };
}

/**
 * Calculate average discount rate
 * @param {Array} priceLists - Active price lists
 * @returns {number} Average discount percentage
 */
function calculateAverageDiscount(priceLists) {
  const validDiscounts = priceLists
    .map(pl => pl.discountRate)
    .filter(dr => dr && dr > 0);
  
  if (validDiscounts.length === 0) return 0;
  
  return validDiscounts.reduce((sum, dr) => sum + dr, 0) / validDiscounts.length;
}

/**
 * Calculate price ranges for analysis
 * @param {Array} priceLists - Active price lists
 * @returns {Object} Price range summary
 */
function calculatePriceRanges(priceLists) {
  if (priceLists.length === 0) {
    return { min: 0, max: 0, average: 0 };
  }

  // This is a simplified calculation - in reality you'd analyze the price list items
  return {
    listCount: priceLists.length,
    suppliers: [...new Set(priceLists.map(pl => pl.supplierId))].length,
    effectiveDates: priceLists.map(pl => pl.effectiveDate)
  };
}

export default router;